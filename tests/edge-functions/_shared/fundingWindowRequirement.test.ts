// A STATED FUNDING WINDOW IS A REQUIREMENT — WHEN THE PAIR CAN PROVE IT.
//
// "…that has raised funding in the last 2 years" compiled as a TARGET: it
// ranked and never rejected, the claim phase (which only verifies HARD gaps)
// never asked the READY funding pair, and request feasibility refused the
// mission as unprovable (2026-09-23, local general-discovery canary). The
// `must` elevation could not rescue it: both parsers record the whole sentence
// as the signal's phrase, so nothing precedes it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic, type LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria, type MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { PRODUCTION_READINESS, readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { verifiedAfterEligibility } from "../../../supabase/functions/_shared/claimPlan.ts";

const funding = (m: LeadMissionV1, policy = PRODUCTION_READINESS): MissionCriterion =>
  deriveMissionCriteria(m, policy).find((c) => c.dimension === "funding")!;
const PAIR_NOT_READY = readinessPolicy({ overrides: {
  "apify_funding_atomus|funding_verification": "EXPERIMENTAL",
  "apify_funding_pvalyou|funding_verification": "EXPERIMENTAL",
} });
/** A mission as Pilot compiles it: the user's window carried (`window_from_user_words`). */
const withWindow = (q: string, days: number): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(q);
  return { ...m, required_signals: m.required_signals.map((s) => ({ ...s, timeframe_days: days })) };
};

Deno.test("a user-stated funding window the READY pair can verify is HARD, and verifiable after eligibility", () => {
  const m = withWindow("Find software companies in Germany that have raised funding in the last 2 years", 730);
  const f = funding(m);
  assertEquals([f.kind, f.time_window?.days, f.time_window?.source], ["hard", 730, "user_explicit"]);
  assert(f.rationale.includes("funding pair can verify"), f.rationale);
  const v = verifiedAfterEligibility(m, "general_company_discovery");
  assert(v.some((x) => x.claim === "recently_funded" && x.verified_by.includes("funding_verification")),
    "feasibility's established-after-eligibility path now sees it");
});

Deno.test("a DEFAULT window stays a target: 'recently raised' names no window", () => {
  const f = funding(parseLeadMissionDeterministic("Find software companies in Germany that recently raised funding"));
  assertEquals([f.kind, f.time_window?.source], ["target", "system_default"]);
  assertEquals(funding(parseLeadMissionDeterministic("Find software companies in Germany that raised funding")).kind, "target");
});

Deno.test("a carried window that is NOT the user's window stays a target — never a hard requirement on the wrong days", () => {
  // The deterministic parser labels "in the last 2 years" user-stated while
  // carrying the 180-day default; hard on 180 days would reject a company the
  // user asked for.
  const misread = parseLeadMissionDeterministic("Find software companies in Germany that raised funding in the last 2 years");
  const f = funding(misread);
  assertEquals([f.kind, f.time_window?.days, f.time_window?.source], ["target", 180, "user_explicit"]);
  // Where the carried days ARE the stated days, it holds.
  const six = funding(parseLeadMissionDeterministic("Find software companies in Germany that raised funding in the last 6 months"));
  assertEquals([six.kind, six.time_window?.days], ["hard", 180]);
});

Deno.test("an unready funding pair cannot make a window a requirement", () => {
  const m = withWindow("Find software companies in Germany that have raised funding in the last 2 years", 730);
  assertEquals(funding(m, PAIR_NOT_READY).kind, "target");
});

// ═══════════════════════ the verifier answers a recency gap with atomus alone ══

import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import type { VerifierCall, VerifierDeps } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import type { EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";

const ATOMUS_ROW = JSON.parse(Deno.readTextFileSync(new URL(
  "../../../docs/audits/live-validation-2026-09-21/probe_atomus.json", import.meta.url)))[0] as Record<string, unknown>;
const KEY = "https://www.linkedin.com/company/wordware";

async function recencyRun(withPage = true) {
  const calls: VerifierCall[] = [];
  const deps: VerifierDeps = {
    call: (c) => {
      calls.push(c);
      return Promise.resolve(c.actor_key === "apify_funding_atomus"
        ? { status: "ok" as const, rows: [{ ...ATOMUS_ROW, input: (c.input.companies as string[])[0] }], provider_call_id: "pc_atomus" }
        : { status: "ok" as const, rows: [], provider_call_id: "pc_pvalyou" });
    },
    ready: () => true, now: () => "2026-09-23T12:00:00.000Z", log: () => {},
  };
  const r = await fundingStageVerifier().verify([{
    company_key: KEY, name: null, domain: "wordware.ai", linkedin_url: withPage ? KEY : null,
    criterion: { criterion_id: "funding:x", dimension: "funding", value: { event: "funding", subject: "company", qualifier: {} } },
    graph: buildCompanyEvidenceGraph(KEY, []),
  }], deps, { mission_id: "t", pending: [] });
  return { r, calls };
}
const recencyCriterion = (days: number) => ({
  id: "funding:x", kind: "hard", dimension: "funding", value: { event: "funding", subject: "company", qualifier: {} },
  label: "Funding", source: "user_explicit", user_phrase: "", rationale: "", status: "ok",
  time_window: { days, basis: "announced", source: "user_explicit", enforced: false },
}) as unknown as MissionCriterion;

Deno.test("RECENCY: the verifier buys atomus only, records its dated history, and never decides a stage", async () => {
  const { r, calls } = await recencyRun();
  assertEquals(calls.map((c) => c.actor_key), ["apify_funding_atomus"], "no pvalyou: recency never needs a citation");
  const [f] = r.findings;
  assert(f.answered);
  assertEquals(f.item?.dimension, "funding");
  assertEquals(f.item?.source.provider_call_id, "pc_atomus");
  assertEquals([f.detail.stage, f.detail.claim, f.detail.history_complete], ["atomus_recency", "recently_funded", true]);
  assert(!JSON.stringify(f).includes("[object Object]"), "no stage verdict read from a signal value");
  assertEquals(f.supporting, undefined);

  // Eligibility decides the window from the record alone.
  const graph = buildCompanyEvidenceGraph(KEY, [f.item as EvidenceItem], { now: new Date("2026-09-23T12:00:00Z") });
  assertEquals(checkCriterion(recencyCriterion(730), graph).result, "pass", "Seed 2024-11-21 is inside two years");
  assertEquals(checkCriterion(recencyCriterion(180), graph).result, "fail", "a complete history with nothing in six months");
});

Deno.test("RECENCY: no LinkedIn page means no atomus read, and the claim stays PENDING — never a fail", async () => {
  const { r, calls } = await recencyRun(false);
  assertEquals(calls, []);
  assertEquals([r.findings[0].item, r.findings[0].answered], [null, true]);
});
