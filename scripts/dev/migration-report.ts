// HISTORICAL MISSION MIGRATION — REPORT AND DRY-RUN PLAN (mission reliability S5).
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/migration-report.ts --release-dir <checkout of the LIVE release> \
//     [--missions <owner export.json>] [--out <dir>]
//
// NEVER CONNECTS TO A DATABASE AND NEVER WRITES ONE. Missions come from the repository's
// persisted fixtures and, when given, an owner-run read-only export
// (`[{ "location": {"table","id","step"}, "mission": {...} }]`, the shape run-agent reads:
// task_plans.steps[step].metadata.tool_input.lead_mission).
//
// For every stored mission it reports:
//   * the criteria PRODUCTION executes today (the live release re-derives at run time),
//   * the criteria this code would execute if deployed WITHOUT migration (re-derivation),
//   * the stored copy the approval card showed (when one exists),
//   * each semantic difference, classified NARROWS / BROADENS / NEUTRAL,
//   * the stored-candidate verdict impact (verdict replay, when the mission has candidates),
//   * the owner's options and the rollback for each.
//
// And it produces a DRY-RUN PLAN for the recommended option (A): freeze every stored
// mission at the meaning production runs today (S3's `freezeCriteria`), so deploying this
// code changes NO stored mission's meaning. The plan is verified here before it is
// written: each frozen mission reads back as "frozen", its executed criteria equal the
// live release's, and its `missionHash` (approvals, tokens) is unchanged. Applying it is
// an owner action; the rollback plan restores every touched field exactly.

import { persistedMissions } from "./mission-semantics.ts";
import { missionSemantics, semanticDiff } from "../../supabase/functions/_shared/missionSemantics.ts";
import { deriveMissionCriteria } from "../../supabase/functions/_shared/missionCriteria.ts";
import { criteriaFreezeState, criteriaOf, freezeCriteria } from "../../supabase/functions/_shared/missionCriteriaReader.ts";
import { missionHash } from "../../supabase/functions/_shared/leadMission.ts";
import { buildQualificationContext } from "../../supabase/functions/_shared/missionQualificationContext.ts";

type Derive = (m: never) => unknown[];

/**
 * A mission as production READS it: Postgres `jsonb` stores object keys ordered by length,
 * then bytewise. Criterion ids are built from JSON and so depend on key order (a latent
 * fragility, reported); deriving from the stored order makes the frozen ids exactly the
 * ids production computes — the ids checkpoints and verdicts refer to.
 */
export function jsonbOrder<T>(v: T): T {
  if (Array.isArray(v)) return v.map(jsonbOrder) as T;
  if (v && typeof v === "object") {
    const enc = new TextEncoder();
    const cmp = (a: string, b: string) => {
      const x = enc.encode(a), y = enc.encode(b);
      if (x.length !== y.length) return x.length - y.length;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
      return 0;
    };
    return Object.fromEntries(Object.keys(v as object).sort(cmp).map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])])) as T;
  }
  return v;
}
export type Direction = "narrows" | "broadens" | "neutral";

/** What one semantic difference does to who can qualify. */
export function directionOf(line: string): Direction {
  if (/geography_scope - → headquarters/.test(line)) return "narrows"; // unscoped → HQ proof only
  if (/geography_scope - → presence/.test(line)) return "neutral"; // states the reading presence evidence already met
  if (/kind hard → target/.test(line)) return "broadens";
  if (/kind target → hard/.test(line)) return "narrows";
  if (/^removed hard /.test(line)) return "broadens";
  if (/^removed (target|hypothesis|opportunity_signal) /.test(line)) return "neutral";
  if (/^added hard /.test(line)) return "narrows";
  if (/^added /.test(line)) return "neutral";
  if (/status ok → (unprovable_today|unrecognised|unrepresentable)/.test(line)) return "narrows"; // a hard gap no evidence closes
  if (/status (unprovable_today|unrecognised|unrepresentable) → ok/.test(line)) return "broadens";
  if (/any_of changed/.test(line)) return "broadens"; // an either/or group accepts more
  return "neutral";
}

export interface MissionReport {
  key: string; query: string;
  hasStoredCriteria: boolean;
  production: unknown[]; deployedWithoutMigration: unknown[]; storedCopy: unknown[] | null;
  diff: { line: string; direction: Direction }[];
  overall: Direction | "unchanged";
  storedCopyDiffers: boolean;
  verdictImpact: { candidates: number; eligibilityChanged: number; checksChanged: string[] } | null;
}

export async function buildReport(missions: [string, Record<string, unknown>][], releaseDerive: Derive, verdictChanges: VerdictChange[] = []) {
  const reports: MissionReport[] = [];
  for (const [key, raw] of missions) {
    const m = jsonbOrder(raw);
    const production = releaseDerive(m as never);
    const deployed = criteriaOf(m as never, { legacy: "rederive" }) as unknown[];
    const before = missionSemantics(m as never, production as never), after = missionSemantics(m as never, deployed as never);
    const diff = semanticDiff(before, after).map((line) => ({ line, direction: directionOf(line) }));
    const dirs = new Set(diff.map((d) => d.direction));
    const overall = !diff.length ? "unchanged" : dirs.has("narrows") && dirs.has("broadens") ? "narrows" : dirs.has("narrows") ? "narrows" : dirs.has("broadens") ? "broadens" : "neutral";
    const stored = Array.isArray(m.criteria) && m.criteria.length ? m.criteria as unknown[] : null;
    const fixture = /fixtures\/(?:[^#]*\/)?([^/#]+)\.json#/.exec(key)?.[1] ?? null;
    const vs = fixture ? verdictChanges.filter((v) => v.key.startsWith(`${fixture}#`)) : [];
    reports.push({
      key, query: String(m.original_user_query ?? ""), hasStoredCriteria: !!stored,
      production, deployedWithoutMigration: deployed, storedCopy: stored, diff, overall,
      storedCopyDiffers: !!stored && JSON.stringify(stored) !== JSON.stringify(production),
      verdictImpact: vs.length ? { candidates: vs.length, eligibilityChanged: vs.filter((v) => v.eligibilityChanged).length,
        checksChanged: [...new Set(vs.flatMap((v) => v.checks))] } : null,
    });
  }
  return reports;
}

export interface VerdictChange { key: string; eligibilityChanged: boolean; checks: string[] }

/**
 * Option A, the recommended migration: freeze each stored mission at the criteria the
 * live release executes today. Verified before it is returned.
 */
export async function freezePlan(missions: [string, Record<string, unknown>][], releaseDerive: Derive) {
  const plan: { key: string; set: Record<string, unknown> }[] = [];
  const rollback: { key: string; restore: Record<string, unknown> }[] = [];
  const failures: string[] = [];
  const skipped: string[] = [];
  for (const [key, raw] of missions) {
    const m = jsonbOrder(raw);
    if (criteriaFreezeState(m as never) === "frozen") continue; // already frozen: nothing to do
    const production = releaseDerive(m as never);
    if (!production.length) { skipped.push(key); continue; } // no requirement either way: nothing to freeze
    const frozen = freezeCriteria({ ...m, criteria: production }, "migration") as Record<string, unknown>;
    // Verification: frozen, means exactly what production runs, approvals untouched.
    if (criteriaFreezeState(frozen as never) !== "frozen") failures.push(`${key}: does not read back as frozen`);
    if (JSON.stringify(criteriaOf(frozen as never, { legacy: "rederive" })) !== JSON.stringify(production)) failures.push(`${key}: executed criteria ≠ production`);
    if (await missionHash(frozen as never) !== await missionHash(m as never)) failures.push(`${key}: missionHash would change`);
    // ORION's search vocabulary must not change either (a compile-frozen mission sources
    // it from criteria; a migration-frozen one keeps the vocabulary it ran with).
    const vocab = (x: unknown) => JSON.stringify(buildQualificationContext(x as never, { criteriaAuthority: true }).role_vocabulary);
    if (vocab(frozen) !== vocab(m)) failures.push(`${key}: ORION's role vocabulary would change`);
    plan.push({ key, set: { criteria: production, criteria_contract_version: frozen.criteria_contract_version, criteria_fingerprint: frozen.criteria_fingerprint, criteria_freeze_origin: "migration" } });
    rollback.push({ key, restore: { criteria: m.criteria ?? null, criteria_contract_version: m.criteria_contract_version ?? null, criteria_fingerprint: m.criteria_fingerprint ?? null, criteria_freeze_origin: m.criteria_freeze_origin ?? null } });
  }
  return { plan, rollback, failures, skipped };
}

function md(reports: MissionReport[], plan: Awaited<ReturnType<typeof freezePlan>>, release: string, verdicts: VerdictChange[]): string {
  const changed = reports.filter((r) => r.overall !== "unchanged");
  const count = (d: string) => changed.filter((r) => r.overall === d).length;
  const short = (k: string) => k.replace(/^persisted:/, "").replace(/^tests\//, "");
  const lines = [
    "# Historical missions: semantic compatibility and migration (S5)",
    "",
    `Generated by \`scripts/dev/migration-report.ts\` against the live release \`${release}\`. Offline: no database is read or written.`,
    "",
    "## Summary",
    "",
    "| | Missions |",
    "|---|---|",
    `| Stored missions examined | ${reports.length} |`,
    `| Meaning would change if this code were deployed **without** migration | **${changed.length}** |`,
    `| — narrows who can qualify | ${count("narrows")} |`,
    `| — broadens | ${count("broadens")} |`,
    `| — neutral (stated scope, ranking-only) | ${count("neutral")} |`,
    `| Stored approval-card copy differs from what production executes today | ${reports.filter((r) => r.storedCopyDiffers).length} |`,
    `| Stored candidates whose check results change (verdict replay) | ${verdicts.length} (eligibility changes: ${verdicts.filter((v) => v.eligibilityChanged).length}) |`,
    "",
    "## Owner decision (nothing is applied without it)",
    "",
    "| Option | What production runs after deploy | Writes | Rollback |",
    "|---|---|---|---|",
    "| **A (recommended): freeze at today's production meaning** | exactly what it runs today, for every stored mission (0 of the changes below happen) | per mission: `criteria`, `criteria_contract_version`, `criteria_fingerprint` in `task_plans.steps[i].metadata.tool_input.lead_mission` | restore the three fields from the rollback plan (re-derivation resumes) |",
    "| B: deploy without migration | each mission below changes as listed, on the first run after deploy | none | redeploy the previous run-agent release |",
    "| C: per-mission | approve listed changes individually in `tests/fixtures/mission-semantics/production-replay-approved.json`; freeze the rest (A) | as A, minus approved ones | as A |",
    "",
    `Option A's plan is verified before it is written: ${plan.plan.length} missions; each reads back as frozen, executes exactly the live release's criteria, and keeps its \`missionHash\` (approvals and signed plan tokens unchanged). Verification failures: **${plan.failures.length}**. Missions with no criteria at all (nothing to freeze, unchanged either way): ${plan.skipped.length}.`,
    "",
    "Quality-run **Z08** (D4) is a separate decision: its stored mission carries the collapsed role list (`aes`), so Option A preserves the narrowed meaning it already runs with. Re-compiling it from the user's words (S1 fixed D4) would restore \"salespeople, sales reps, account executives, AEs\" — a broadening, owner's call.",
    "",
    "## Every mission whose meaning would change without migration",
    "",
    "| Mission | Request | Difference | Effect | Stored-candidate impact |",
    "|---|---|---|---|---|",
    ...changed.map((r) => `| \`${short(r.key)}\` | ${r.query.replace(/\|/g, "/").slice(0, 90)}${r.query.length > 90 ? "…" : ""} | ${r.diff.map((d) => `${d.line.replace(/\|/g, "/")} (**${d.direction}**)`).join("<br>")} | **${r.overall}** | ${r.verdictImpact ? `${r.verdictImpact.candidates} candidates; eligibility changes ${r.verdictImpact.eligibilityChanged}; checks: ${r.verdictImpact.checksChanged.join(", ") || "none"}` : "no stored candidates"} |`),
    "",
    "Original and proposed criteria for every mission are in the machine-readable report beside this file (`production` = original, `deployedWithoutMigration` = proposed, `storedCopy` = the approval card's).",
    "",
  ];
  return lines.join("\n");
}

function arg(name: string): string | undefined { const i = Deno.args.indexOf(name); return i >= 0 ? Deno.args[i + 1] : undefined; }

export type ExportRow = { location?: { table?: string; id?: string; step?: number }; mission: Record<string, unknown> };

/**
 * Reviewable SQL for option A and its rollback, for an owner export. One transaction each;
 * every statement applies only if the stored mission is exactly the one expected (the
 * export for the freeze, the frozen mission for the rollback), so a mission changed since
 * is left alone.
 *
 * THE ROLLBACK WRITES BACK THE EXPORTED MISSION ITSELF, byte for byte. It used to merge the
 * restore fields and then drop EVERY null-valued key, which also deleted the mission's own
 * null fields (e.g. `requested_count: null`, covered by missionHash): 54 of 83 rehearsal
 * missions did not round-trip (Postgres rehearsal, 2026-11-05).
 */
export function migrationSql(rows: ExportRow[], plan: { plan: { key: string; set: Record<string, unknown> }[] }): { freeze: string; rollback: string } {
  const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  const path = (step: number) => `'{${step},metadata,tool_input,lead_mission}'`;
  const stmts = (which: "set" | "restore") => rows.flatMap((r, i) => {
    const loc = r.location;
    if (loc?.table !== "task_plans" || !loc.id || typeof loc.step !== "number") return [`-- skipped row ${i}: no task_plans location`];
    const key = `stored:${JSON.stringify(loc)}`;
    const set = plan.plan.find((p) => p.key === key)?.set;
    if (!set) return [`-- ${key}: nothing to change`];
    const frozen = { ...r.mission, ...set };
    const [target, expected] = which === "set" ? [frozen, r.mission] : [r.mission, frozen];
    return [`update public.task_plans set steps = jsonb_set(steps, ${path(loc.step)}, ${lit(target)}) where id = '${loc.id}' and steps #> ${path(loc.step)} = ${lit(expected)};`];
  });
  return {
    freeze: ["-- OPTION A: freeze stored missions at today's production meaning. Review, then run in ONE transaction.", "begin;", ...stmts("set"), "commit;", ""].join("\n"),
    rollback: ["-- Rollback of option A: writes back each exported mission exactly. Run in ONE transaction.", "begin;", ...stmts("restore"), "commit;", ""].join("\n"),
  };
}

if (import.meta.main) {
  const dir = arg("--release-dir");
  if (!dir) { console.error("--release-dir <checkout of the live release> is required"); Deno.exit(2); }
  const release = (await import(new URL(`file://${Deno.realPathSync(dir)}/supabase/functions/_shared/missionCriteria.ts`).href)) as { deriveMissionCriteria: Derive };
  const missions = await persistedMissions();
  const exported = arg("--missions");
  if (exported) {
    const rows = JSON.parse(await Deno.readTextFile(exported)) as { location?: unknown; id?: string; mission: Record<string, unknown> }[];
    rows.forEach((r, i) => missions.push([`stored:${JSON.stringify(r.location ?? r.id ?? i)}`, r.mission]));
  }
  // Verdict impact: the recorded verdict replay against the live release, when available.
  let verdicts: VerdictChange[] = [];
  const vr = arg("--verdicts");
  if (vr) verdicts = (JSON.parse(await Deno.readTextFile(vr)).verdicts?.changed ?? []) as VerdictChange[];
  const reports = await buildReport(missions, release.deriveMissionCriteria, verdicts);
  const plan = await freezePlan(missions, release.deriveMissionCriteria);
  const out = arg("--out") ?? "docs/architecture/mission-migration";
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(`${out}/report.md`, md(reports, plan, arg("--release") ?? dir, verdicts) + "\n");
  await Deno.writeTextFile(`${out}/report.json`, JSON.stringify(reports, null, 1) + "\n");
  await Deno.writeTextFile(`${out}/freeze-plan.json`, JSON.stringify({ option: "A", verified: plan.failures.length === 0, failures: plan.failures, plan: plan.plan }, null, 1) + "\n");
  await Deno.writeTextFile(`${out}/rollback-plan.json`, JSON.stringify({ option: "A", rollback: plan.rollback }, null, 1) + "\n");
  // For an owner export: reviewable SQL for option A and its rollback (migrationSql).
  if (exported) {
    const sql = migrationSql(JSON.parse(await Deno.readTextFile(exported)) as ExportRow[], plan);
    await Deno.writeTextFile(`${out}/freeze.sql`, sql.freeze);
    await Deno.writeTextFile(`${out}/rollback.sql`, sql.rollback);
  }
  const changed = reports.filter((r) => r.overall !== "unchanged");
  console.log(JSON.stringify({ missions: reports.length, changedWithoutMigration: changed.length,
    narrows: changed.filter((r) => r.overall === "narrows").length, broadens: changed.filter((r) => r.overall === "broadens").length,
    neutral: changed.filter((r) => r.overall === "neutral").length, storedCopyDiffers: reports.filter((r) => r.storedCopyDiffers).length,
    freezePlan: plan.plan.length, freezeVerificationFailures: plan.failures.length }));
  if (plan.failures.length) { console.error(plan.failures.join("\n")); Deno.exit(1); }
}
