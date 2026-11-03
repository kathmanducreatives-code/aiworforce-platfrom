// PRODUCTION SEMANTIC REPLAY GATE — would deploying this commit change what a stored mission means?
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/production-replay.ts \
//     --release-dir <checkout of the LIVE release> [--candidate-dir <checkout about to deploy>] \
//     [--missions <export.json>] [--report <out.json>]
//
// --candidate-dir defaults to this checkout. The production workflow passes both, so the
// gate (this file, from launch/hardening) can judge a release older than the gate itself.
//
// Stage 7 of Option E. run-agent DERIVES a stored mission's criteria at run time from the
// persisted mission (it never reads them back), so a compiler change silently changes the
// meaning of every mission already stored in production the moment run-agent is redeployed.
// This replays each stored mission through BOTH the deployed release's compiler and this
// commit's, and compares the meaning (missionSemantics.ts), offline.
//
// The gate FAILS when any mission's meaning changes and that exact change is not listed in
// tests/fixtures/mission-semantics/production-replay-approved.json — an owner-reviewed file:
// approving a semantic change to existing missions is the owner's decision, never CI's.
//
// Missions come from the repository's persisted lead-mission-v1 fixtures and, when given,
// `--missions`: a JSON array of stored missions exported read-only from the target project
// by the owner-run production workflow. This script never connects to any database.

import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { type MissionSemantics, missionSemantics, semanticDiff, semanticsFingerprint } from "../../supabase/functions/_shared/missionSemantics.ts";
import { persistedMissions } from "./mission-semantics.ts";
import { diffVerdicts, verdicts } from "./verdict-replay.ts";

const ROOT = new URL("../../", import.meta.url);
export const APPROVED_PATH = "tests/fixtures/mission-semantics/production-replay-approved.json";

type Derive = (mission: never) => unknown[];

export interface ReplayEntry { key: string; query: string; before: string; after: string; diff: string[] }
export interface ReplayReport { release: string; missions: number; changed: ReplayEntry[]; unapproved: ReplayEntry[] }

/** One approval names the mission and the exact before → after meaning the owner accepted. */
export interface Approval { key: string; before: string; after: string; reason: string; approvedBy: string }

export function replay(missions: [string, Record<string, unknown>][], releaseDerive: Derive, currentDerive: Derive, approved: Approval[], release = "release"): ReplayReport {
  const ok = new Set(approved.map((a) => `${a.key}|${a.before}|${a.after}`));
  const changed: ReplayEntry[] = [];
  for (const [key, m] of missions) {
    const before: MissionSemantics = missionSemantics(m as never, releaseDerive(m as never) as never);
    const after: MissionSemantics = missionSemantics(m as never, currentDerive(m as never) as never);
    const [fb, fa] = [semanticsFingerprint(before), semanticsFingerprint(after)];
    if (fb !== fa) changed.push({ key, query: String(m.original_user_query ?? ""), before: fb, after: fa, diff: semanticDiff(before, after) });
  }
  return { release, missions: missions.length, changed, unapproved: changed.filter((c) => !ok.has(`${c.key}|${c.before}|${c.after}`)) };
}

/** The kind of each difference, for the summary ("geography_scope", "status", ...). */
export function categories(r: ReplayReport): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of r.changed) for (const d of new Set(c.diff.map(categoryOf))) out[d] = (out[d] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([, a], [, b]) => b - a));
}
function categoryOf(line: string): string {
  const m = /^(?:criterion )?([a-z_:.]+)/i.exec(line.trim());
  const field = /\b(geography_scope|status|value|time_window|any_of|elevated_by|kind|dimension)\b/.exec(line);
  return field ? `${m?.[1] ?? "criterion"} → ${field[1]}` : (m?.[1] ?? line.slice(0, 40));
}

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

if (import.meta.main) {
  const dir = arg("--release-dir");
  if (!dir) { console.error("--release-dir <checkout of the deployed release> is required"); Deno.exit(2); }
  const releaseUrl = new URL(`file://${Deno.realPathSync(dir)}/supabase/functions/_shared/missionCriteria.ts`);
  const release = (await import(releaseUrl.href)) as { deriveMissionCriteria: Derive };
  const missions = await persistedMissions();
  const exported = arg("--missions");
  if (exported) {
    const rows = JSON.parse(await Deno.readTextFile(exported)) as { id?: string; mission: Record<string, unknown> }[];
    rows.forEach((r, i) => missions.push([`stored:${r.id ?? i}`, r.mission]));
  }
  let approved: Approval[] = [];
  let approvedVerdicts: { key: string; before: string; after: string }[] = [];
  try {
    const f = JSON.parse(await Deno.readTextFile(new URL(APPROVED_PATH, ROOT)));
    approved = f.approved ?? [];
    approvedVerdicts = f.approvedVerdicts ?? [];
  } catch { /* none approved */ }
  const cand = arg("--candidate-dir");
  const candidate = cand
    ? ((await import(new URL(`file://${Deno.realPathSync(cand)}/supabase/functions/_shared/missionCriteria.ts`).href)) as { deriveMissionCriteria: Derive }).deriveMissionCriteria
    : deriveMissionCriteria as Derive;
  const r = replay(missions, release.deriveMissionCriteria, candidate, approved, arg("--release") ?? dir);

  // QUALIFICATION VERDICTS (ATLAS review Stage 0). Criteria replay cannot see a change to the
  // shared qualification engine; this replays the engine on every stored production
  // candidate (scripts/dev/verdict-replay.ts), each side with its own code. A change of a
  // candidate's ELIGIBILITY must be approved like a change of meaning; check-level changes
  // that leave eligibility alone are reported.
  const verdictBefore = await verdicts(dir);
  const verdictAfter = await verdicts(cand ?? undefined);
  const vd = diffVerdicts(verdictBefore, verdictAfter);
  const okVerdict = new Set(approvedVerdicts.map((a) => `${a.key}|${a.before}|${a.after}`));
  const unapprovedVerdicts = vd.filter((c) => c.eligibilityChanged && !okVerdict.has(`${c.key}|${c.before?.eligibility ?? "-"}|${c.after?.eligibility ?? "-"}`));

  const out = arg("--report");
  if (out) await Deno.writeTextFile(out, JSON.stringify({ ...r, categories: categories(r), verdicts: { changed: vd, unapproved: unapprovedVerdicts } }, null, 1) + "\n");
  console.log(JSON.stringify({ missions: r.missions, changed: r.changed.length, unapproved: r.unapproved.length, categories: categories(r),
    verdicts: { candidates: Object.keys(verdictAfter).length, changed: vd.length, eligibilityChanged: vd.filter((c) => c.eligibilityChanged).length, unapproved: unapprovedVerdicts.length } }));
  for (const c of r.unapproved) console.log(`UNAPPROVED ${c.key}\n   ${c.diff.join(" | ")}`);
  for (const c of unapprovedVerdicts) console.log(`UNAPPROVED VERDICT ${c.key}: ${c.before?.eligibility ?? "-"} → ${c.after?.eligibility ?? "-"}\n   ${c.checks.join(" | ")}`);
  if (r.unapproved.length || unapprovedVerdicts.length) Deno.exit(1);
}
