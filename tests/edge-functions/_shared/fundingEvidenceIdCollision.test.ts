// A FUNDING RECORD'S EVIDENCE ID NEVER COLLIDES WITH ANOTHER PROVIDER'S.
//
// Canary 11 (2026-09-25, task 80e46ba1): Pvalyou returned Salvo Software's
// 2024-06-06 debt round, yet the Workbench said "no funding record was
// retrieved". The id was `fdr_<key>_<actor>_<date>_<type>` cut to 64
// characters; for a LinkedIn slug of 12+ characters the cut fell inside
// "apify_funding_", so Atomus and Pvalyou both became
// `fdr_https://www.linkedin.com/company/salvosoftware_apify_funding`, and the
// graph (first of an id wins) and `fundingRecordsInGraph` dropped Pvalyou.
// There the verdict was unchanged (the round was outside the window); for a
// round INSIDE the window, the Pvalyou PASS was silently lost.
//
// Ids are now bounded without collisions: a readable prefix plus a hash of the
// whole id. Observation ids built from them are bounded the same way, and a
// checkpoint written before the change is still replaced, not duplicated.
//
// Pure. The provider is scripted; no network.

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fundingStageVerifier } from "../../../supabase/functions/_shared/fundingStageVerifier.ts";
import type { VerificationTarget, VerifierCallOutcome, VerifierFinding } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { fundingRecordEvidenceItem, fundingRecordsInGraph } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import type { FundingRecordFact } from "../../../supabase/functions/_shared/fundingStageClaim.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { boundedId, MAX_STABLE_ID_LENGTH } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  applyVerifierFinding, companyEvidenceItems, type EngineCompany,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const NOW = new Date("2026-09-25T14:38:48.000Z");
const ATOMUS = "apify_funding_atomus", PVALYOU = "apify_funding_pvalyou";
const LI = (slug: string) => `https://www.linkedin.com/company/${slug}`;
type Row = Record<string, unknown>;

// ── the recorded shapes (canary 11: Atomus found Salvo with no rounds) ──
const atomusEmpty = (slug: string): Row => ({ input: slug, status: "success",
  summary: { name: slug, linkedin_url: LI(slug), domain: `${slug}.com` }, company: { financial: {} } });
const pvalyouRow = (domain: string, round: { date: string; type: string; non_equity: boolean }): Row => ({
  query: domain, status: "active", domain, record_as_of: "2026-09-25T14:36:13Z",
  record: { funding: { rounds_count: null, last_round_date: null, rounds: [{
    round_index: 1, round_type: round.type, round_title: round.type, round_date: round.date, round_date_precision: "day",
    round_amount_m: 0.15, is_non_equity: round.non_equity, source_urls: [`https://pitchbook.com/profiles/company/${domain}`], investors: [],
  }] } } });

const FUNDING_VALUE = { event: "funding", subject: "company", qualifier: {} };
const FUNDING_CRITERION = { criterion_id: "funding:recent", dimension: "funding", value: FUNDING_VALUE, window_days: 365 };
const HARD_FUNDING = [{ id: "funding:recent", kind: "hard", dimension: "funding", value: FUNDING_VALUE,
  label: "Funding", source: "user_explicit", user_phrase: "", rationale: "", status: "ok",
  time_window: { days: 365, basis: "announced", source: "user_explicit", enforced: false } } as never];

const engineCompany = (slug: string): EngineCompany => ({
  key: LI(slug), observations: [], completed_operations: [],
  company: { company_name: slug, linkedin_company_url: LI(slug), canonical_domain: `${slug}.com`, website: `https://${slug}.com` },
} as unknown as EngineCompany);
const target = (slug: string): VerificationTarget => ({
  company_key: LI(slug), name: slug, domain: `${slug}.com`, linkedin_url: LI(slug), criterion: FUNDING_CRITERION,
  graph: buildCompanyEvidenceGraph(LI(slug), [], { now: NOW }),
});

/** The real verifier: Atomus finds the company empty, Pvalyou answers with `pv`. */
async function recency(slug: string, pv: { date: string; type: string; non_equity: boolean }): Promise<VerifierFinding> {
  let n = 0;
  const res = await fundingStageVerifier().verify([target(slug)], {
    call: (c) => {
      n++;
      const list = (c.input.companies as string[]) ?? [];
      const rows = c.actor_key === ATOMUS ? list.map((u) => atomusEmpty(u.split("/company/")[1])) : list.map((d) => pvalyouRow(d, pv));
      return Promise.resolve({ status: "ok", rows, provider_call_id: `pc_${c.actor_key}_${n}` } as VerifierCallOutcome);
    },
    ready: () => true, now: () => NOW.toISOString(), log: () => {},
  }, { mission_id: "m", pending: [] });
  assertEquals(res.findings.length, 1);
  assertEquals(res.findings[0].detail.stage, "atomus_then_pvalyou");
  return res.findings[0];
}
/** As the engine records it, and as the Workbench's eligibility then reads it. */
const recordedFundingCheck = (c: EngineCompany) =>
  evaluateEligibility(HARD_FUNDING, buildCompanyEvidenceGraph(c.key, companyEvidenceItems(c), { now: NOW })).checks[0];
const record = (actor: string, date: string | null, call: string): FundingRecordFact => ({
  provider: "apify", actor, source_url: null, observed_at: "2026-09-25", provider_call_id: call, provider_call_ids: [call],
  completeness: null, history_complete: null, reported_round_count: null,
  rounds: date ? [{ announced_date: date, round_type: "Seed", amount_usd: 1e6, investors: [], source_urls: ["https://x.example/a"], method: "provider_field", provenance: [] }] : [],
} as unknown as FundingRecordFact);

// ═══════════════════════════════════════════════════════════════ the ids ══

Deno.test("CANARY 11: Atomus and Pvalyou records for salvosoftware get DIFFERENT ids, each within the bound", () => {
  const key = LI("salvosoftware");
  const a = fundingRecordEvidenceItem({ company_key: key, record: record(ATOMUS, null, "pc_a"), mission_id: "m", observed_at: NOW.toISOString() });
  const p = fundingRecordEvidenceItem({ company_key: key, record: record(PVALYOU, "2024-06-06", "pc_p"), mission_id: "m", observed_at: NOW.toISOString() });
  assertNotEquals(a.evidence_id, p.evidence_id);
  for (const id of [a.evidence_id, p.evidence_id]) assert(id.length <= MAX_STABLE_ID_LENGTH, id);
  // The one the canary stored, for both: the collision this fixes.
  assertNotEquals(p.evidence_id, "fdr_https://www.linkedin.com/company/salvosoftware_apify_funding");
});

Deno.test("EVERY LENGTH: two actors, and two rounds from one actor, never share an id — for slugs of 1 to 60 characters", () => {
  for (let n = 1; n <= 60; n++) {
    const key = LI("s".repeat(n));
    const ids = [
      [ATOMUS, "2025-01-01"], [PVALYOU, "2025-01-01"], [ATOMUS, "2024-02-02"], [ATOMUS, null],
    ].map(([actor, date]) => fundingRecordEvidenceItem({ company_key: key, record: record(actor!, date, "pc"), mission_id: "m", observed_at: "t" }).evidence_id);
    assertEquals(new Set(ids).size, ids.length, `slug length ${n}: ${ids.join(" | ")}`);
    for (const id of ids) assert(id.length <= MAX_STABLE_ID_LENGTH, id);
  }
});

Deno.test("STABLE: the same fact gets the same id on every reading; an id that already fits is unchanged", () => {
  const key = LI("salvosoftware");
  const once = () => fundingRecordEvidenceItem({ company_key: key, record: record(PVALYOU, "2024-06-06", "pc_1"), mission_id: "m", observed_at: "t1" }).evidence_id;
  assertEquals(once(), once());
  const short = fundingRecordEvidenceItem({ company_key: "c1", record: record(ATOMUS, "2025-01-01", "pc"), mission_id: "m", observed_at: "t" });
  assertEquals(short.evidence_id, "fdr_c1_apify_funding_atomus_2025-01-01_seed");
  assertEquals(boundedId("x".repeat(64)), "x".repeat(64));
  assertEquals(boundedId("x".repeat(65)).length, 64);
  assertNotEquals(boundedId("x".repeat(65)), boundedId("x".repeat(66)));
});

// ═══════════════════════════════════════════ what eligibility now reads ══

Deno.test("CANARY 11 REPLAY (Salvo): the Pvalyou round reaches eligibility — still UNKNOWN (outside the window, Pvalyou cannot FAIL), but no longer 'no funding record'", async () => {
  const f = await recency("salvosoftware", { date: "2024-06-06", type: "Debt Financing", non_equity: true });
  const c = engineCompany("salvosoftware");
  applyVerifierFinding(c, f, fundingStageVerifier());
  const graph = buildCompanyEvidenceGraph(c.key, companyEvidenceItems(c), { now: NOW });
  assertEquals(fundingRecordsInGraph(graph).map((r) => r.actor).sort(), [ATOMUS, PVALYOU]);
  const check = recordedFundingCheck(c);
  assertEquals(check.result, "unknown", check.reason);
  assert(!/no funding record/.test(check.reason), check.reason);
});

Deno.test("THE LOST PASS: a long-slug company whose only in-window round comes from Pvalyou now PASSES funding", async () => {
  const f = await recency("salvosoftware", { date: "2026-06-15", type: "Seed", non_equity: false });
  assertEquals(f.detail.verdict_after, "pass");
  const c = engineCompany("salvosoftware");
  applyVerifierFinding(c, f, fundingStageVerifier());
  const check = recordedFundingCheck(c);
  assertEquals(check.result, "pass", check.reason);
});

Deno.test("SHORT SLUGS behaved already, and still do (GeekWire's length)", async () => {
  const f = await recency("geekwire", { date: "2026-06-15", type: "Seed", non_equity: false });
  const c = engineCompany("geekwire");
  applyVerifierFinding(c, f, fundingStageVerifier());
  assertEquals(recordedFundingCheck(c).result, "pass");
});

// ══════════════════════════════════════════════════════ observation ids ══

Deno.test("OBSERVATIONS: a re-answer for the same record REPLACES its observation; a different record's answer stands BESIDE it", () => {
  const c = engineCompany("salvosoftware");
  const item = (actor: string, date: string | null) =>
    fundingRecordEvidenceItem({ company_key: c.key, record: record(actor, date, `pc_${actor}`), mission_id: "m", observed_at: "t" });
  const v = fundingStageVerifier();
  // The screen's Atomus reading, then the recency answer that re-carries it with Pvalyou beside it.
  applyVerifierFinding(c, { company_key: c.key, item: item(ATOMUS, null), answered: true, detail: {} }, v);
  applyVerifierFinding(c, { company_key: c.key, item: item(ATOMUS, null), supporting: [item(PVALYOU, "2024-06-06")], answered: true, detail: {} }, v);
  assertEquals(c.observations!.length, 1, "the same record: replaced");
  assertEquals(c.observations![0].evidence.length, 2);
  // A different record (a Pvalyou-only answer) is its own observation.
  applyVerifierFinding(c, { company_key: c.key, item: item(PVALYOU, "2025-03-03"), answered: true, detail: {} }, v);
  assertEquals(c.observations!.length, 2);
  for (const o of c.observations!) assert(o.observation_id.length <= MAX_STABLE_ID_LENGTH, o.observation_id);
});

Deno.test("RESUME ACROSS THE CHANGE: an observation stored under the old cut id is REPLACED by the new answer, not duplicated", () => {
  const c = engineCompany("salvosoftware");
  const stage = (verdict: string) => ({
    evidence_id: `fnd_${c.key}_funding_stage`.slice(0, 64), company_key: c.key, dimension: "company_stage", value: { verdict },
    status: "unknown", source: { provider: "apify", actor: ATOMUS, provider_call_id: "pc", url: null, excerpt: null },
    method: "provider_field", observed_at: "t", valid_until: null, confidence: "medium", derived_from: [], mission_id: "m", origin: "lead_mission",
  } as never);
  const v = fundingStageVerifier();
  applyVerifierFinding(c, { company_key: c.key, item: stage("pending"), answered: true, detail: {} }, v);
  // Rewrite it as a checkpoint written BEFORE the change stored it: the raw id cut to 64.
  const legacy = `obs_vfy_${`fnd_${c.key}_funding_stage`.slice(0, 64)}`.slice(0, 64);
  c.observations![0] = { ...c.observations![0], observation_id: legacy };
  applyVerifierFinding(c, { company_key: c.key, item: stage("fail"), answered: true, detail: {} }, v);
  assertEquals(c.observations!.length, 1, "replaced, not stood beside");
  assertEquals((c.observations![0].evidence[0].value as { verdict: string }).verdict, "fail", "the fresh answer wins");
});

Deno.test("RESUME ACROSS THE CHANGE, FUNDING RECORDS: the pre-change Atomus copy stays beside the new one — the same fact, and Pvalyou's PASS is still read", async () => {
  const c = engineCompany("salvosoftware");
  // Canary 11's checkpoint: the screen's Atomus reading under the old cut ids.
  const old = fundingRecordEvidenceItem({ company_key: c.key, record: record(ATOMUS, null, "pc_atomus"), mission_id: "m", observed_at: "t" });
  const cut = `fdr_${c.key}_${ATOMUS}_undated_x`.slice(0, 64);
  applyVerifierFinding(c, { company_key: c.key, item: { ...old, evidence_id: cut }, answered: true, detail: {} }, fundingStageVerifier());
  c.observations![0] = { ...c.observations![0], observation_id: `obs_vfy_${cut}`.slice(0, 64) };
  // Resumed after the change: the recency answer carries Atomus again, and an in-window Pvalyou round.
  const f = await recency("salvosoftware", { date: "2026-06-15", type: "Seed", non_equity: false });
  applyVerifierFinding(c, f, fundingStageVerifier());
  assertEquals(c.observations!.length, 2);
  const check = recordedFundingCheck(c);
  assertEquals(check.result, "pass", check.reason);
});
