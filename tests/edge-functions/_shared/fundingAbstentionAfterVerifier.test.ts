// A DATED ROUND RESOLVES THE EVALUATOR'S GENUINE ABSTENTION — AND NOTHING ELSE.
//
// On the job-first route the funding verifier (Atomus) runs AFTER the mission
// evaluator. The evaluator, seeing no round yet, answers the funding criterion
// "unknown"; Atomus then records a Series A inside the window. Under #113's
// "verdicts only lower" that stale abstention held the company pending, so the
// first-canary rehearsal bought the funding data and qualified nobody
// (tests/db-contract/canaryFundingRehearsal.contract.test.ts).
//
// REVIEW BLOCKER B1 (on fed35777): that fix keyed on the PARSED verdict
// (`unknown`, no receipts). The strict parser produces exactly that shape when
// it REJECTS a model's `fail` — stale, conflicting, invalid, foreign or
// unquoted receipts — so a rejected `fail` was promoted to eligible. The rule
// now reads the verdict's provenance (`origin`, set by the parser): only the
// model's own receipt-free `unknown` (`abstained`) may be resolved, and only by
// a clean, dated funding record inside the window.
//
// Every verdict below goes through the REAL strict parser. Pure. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fundingRecordEvidenceItem, normalizeAtomusFunding } from "../../../supabase/functions/_shared/fundingCorroboration.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { type CriterionVerdict, parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import type { EvidenceItem, EvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const KEY = "https://www.linkedin.com/company/fundly";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const FUNDING = {
  id: "funding:recent", kind: "hard", dimension: "funding", value: { event: "funding", subject: "company", qualifier: {} },
  label: "Funding", source: "user_explicit", user_phrase: "raised funding within the last six months", rationale: "", status: "ok",
  time_window: { days: 180, basis: "announced", source: "user_explicit", enforced: true },
} as never;

// ── the evaluator's evidence (what the model may cite) ─────────────────────────
const TEXT = "Fundly has not raised outside capital since its 2019 seed round.";
const item = (id: string, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  evidence_id: id, company_key: KEY, evidence_type: "funding_signal", source: "news", source_url: "https://news.example.com/fundly",
  structured_value: null, source_text: TEXT, observed_at: new Date().toISOString(), occurred_at: null,
  freshness: "current", verification_state: "reported", metadata: {}, ...over,
});
const REGISTRY: EvidenceRegistry = {
  version: "lead-evidence-registry-v1" as never, company_key: KEY, hard_facts: {} as never,
  items: [
    item("ev_current"),
    item("ev_stale", { freshness: "stale" }),
    item("ev_conflicting", { verification_state: "conflicting" }),
    item("ev_invalid", { verification_state: "invalid" }),
    item("ev_foreign", { company_key: "https://www.linkedin.com/company/someone-else" }),
  ],
};
/** The model's answer for the funding criterion, through the real strict parser. */
function parsed(row: Record<string, unknown> | null, raw?: unknown): CriterionVerdict {
  const answer = raw ?? { decision: "insufficient_evidence", mission_fit: "review", reasoning: "r",
    criterion_verdicts: row ? [{ criterion_id: "funding:recent", reason: "the model's reason", ...row }] : [] };
  const v = parseMissionEvaluationStrict(answer, REGISTRY, [FUNDING]).evaluation.criterion_verdicts?.[0];
  assert(v, "the parser returns one verdict per judged criterion");
  return v;
}
const cite = (id: string, excerpt = "has not raised outside capital") => [{ evidence_id: id, excerpt }];

// ── the graph after the funding verifier ──────────────────────────────────────
function graphWith(daysOld: number | null) {
  if (daysOld === null) return buildCompanyEvidenceGraph(KEY, [], {});
  const record = normalizeAtomusFunding({ input: KEY, status: "success",
    summary: { name: "Fundly", linkedin_url: KEY, domain: "fundly.example" },
    company: { financial: { funding: { type: "SERIES_A", num_funding_rounds: 1,
      rounds: [{ announced_at: daysAgo(daysOld), raised_amount: 5_000_000, type: "SERIES_A" }], date: daysAgo(daysOld) } } } }).record!;
  return buildCompanyEvidenceGraph(KEY, [fundingRecordEvidenceItem({ company_key: KEY, record, mission_id: "m", observed_at: new Date().toISOString() })], {});
}
const check = (v: CriterionVerdict | null, graph = graphWith(60)) =>
  evaluateEligibility([FUNDING], graph, v ? [v] : undefined).checks[0];

// ══════════════════════════════ B1: the reviewer's case, and its variants ══

for (const [label, id] of [["STALE", "ev_stale"], ["CONFLICTING", "ev_conflicting"], ["INVALID", "ev_invalid"], ["FOREIGN-COMPANY", "ev_foreign"]] as const) {
  Deno.test(`B1 REPRO: a funding FAIL citing ${label} evidence is stripped to unknown by the parser — and is NEVER promoted`, () => {
    const v = parsed({ result: "fail", evidence: cite(id) });
    // The shape that fooled fed35777: unknown, no surviving receipt…
    assertEquals([v.result, v.evidence.length], ["unknown", 0]);
    // …now carrying what really happened.
    assertEquals([v.origin, v.model_result, v.rejected_receipts], ["downgraded", "fail", 1]);
    const c = check(v);
    assertEquals(c.result, "unknown", `a rejected fail must not become eligible: ${c.reason}`);
  });
}

Deno.test("B1: a FAIL whose excerpt is not in the source, or that cites nothing, is downgraded and never promoted", () => {
  for (const v of [parsed({ result: "fail", evidence: cite("ev_current", "raised a Series A") }), parsed({ result: "fail", evidence: [] })]) {
    assertEquals([v.result, v.origin, v.model_result], ["unknown", "downgraded", "fail"]);
    assertEquals(check(v).result, "unknown");
  }
});

Deno.test("B1: an unknown CITING rejected receipts, a missing row, an unparsed answer and a legacy verdict are unresolved, never promoted", () => {
  const rejected = parsed({ result: "unknown", evidence: cite("ev_conflicting") });
  assertEquals([rejected.origin, rejected.rejected_receipts], ["receipts_rejected", 1]);
  const missing = parsed(null);
  assertEquals(missing.origin, "missing");
  const unparsed = parsed(null, "not json at all");
  assertEquals(unparsed.origin, "unparsed");
  const legacy: CriterionVerdict = { criterion_id: "funding:recent", result: "unknown", reason: "written before origin existed", evidence: [] };
  const garbled = parsed({ result: "maybe", evidence: [] });
  assertEquals([garbled.origin, garbled.model_result], ["downgraded", "maybe"]);
  for (const v of [rejected, missing, unparsed, legacy, garbled]) assertEquals(check(v).result, "unknown", String(v.origin));
});

// ══════════════════════════ the legitimate correction is kept, tightly ══

Deno.test("THE CANARY CASE: the model's own receipt-free abstention is resolved by Atomus's dated round inside the window", () => {
  const v = parsed({ result: "unknown", evidence: [] });
  assertEquals([v.result, v.origin, v.model_result, v.rejected_receipts], ["unknown", "abstained", "unknown", undefined]);
  assertEquals(check(v).result, "pass", check(v).reason);
});

Deno.test("an abstention is NOT resolved by contradictory, stale or disproven funding evidence", () => {
  const v = parsed({ result: "unknown", evidence: [] });
  const conflicted = graphWith(60);
  conflicted.conflicts.push("funding");
  assertEquals(check(v, conflicted).result, "unknown", "a funding conflict stays unresolved");
  const contradicted = graphWith(60);
  const claim = contradicted.claims.find((c) => c.dimension === "funding")!;
  claim.conflicting.push({ ...claim.current!, value: false });
  assertEquals(check(v, contradicted).result, "unknown", "a disagreeing funding item stays unresolved");
  const withStale = graphWith(60);
  const s = withStale.claims.find((c) => c.dimension === "funding")!;
  s.stale.push({ ...s.current! });
  assertEquals(check(v, withStale).result, "unknown", "a stale funding item stays unresolved");
  const disproven = graphWith(60);
  const d = disproven.claims.find((c) => c.dimension === "funding")!;
  d.supporting.push({ ...d.current!, status: "disproven" });
  assertEquals(check(v, disproven).result, "unknown", "a disproven funding item stays unresolved");
});

Deno.test("an abstention on a WINDOWLESS funding criterion is not resolved (only a dated window decision may)", () => {
  const windowless = { ...(FUNDING as Record<string, unknown>), time_window: null } as never;
  const v = parsed({ result: "unknown", evidence: [] });
  assertEquals(evaluateEligibility([windowless], graphWith(60), [{ ...v }]).checks[0].result, "unknown");
});

// ══════════════════════════════════════ #113 and the window, unchanged ══

Deno.test("UNCHANGED: a legitimate pass — the dated round alone, or with the evaluator's cited pass — passes", () => {
  assertEquals(check(null).result, "pass");
  const passed = parsed({ result: "pass", evidence: cite("ev_current") });
  assertEquals([passed.result, passed.origin], ["pass", "answered"]);
  assertEquals(check(passed).result, "pass");
});

Deno.test("UNCHANGED: an evaluator's receipt-backed FAIL still lowers the dated round", () => {
  const failed = parsed({ result: "fail", evidence: cite("ev_current") });
  assertEquals([failed.result, failed.origin], ["fail", "answered"]);
  assertEquals(check(failed).result, "fail");
});

Deno.test("UNCHANGED: a stale round fails and missing evidence stays unknown, whatever the evaluator said", () => {
  const abstained = parsed({ result: "unknown", evidence: [] });
  const passed = parsed({ result: "pass", evidence: cite("ev_current") });
  assertEquals(check(abstained, graphWith(300)).result, "fail", "a round outside the window is never promoted");
  assertEquals(check(passed, graphWith(300)).result, "fail", "verdicts never upgrade");
  assertEquals(check(abstained, graphWith(null)).result, "unknown", "no record, no answer");
  assertEquals(check(passed, graphWith(null)).result, "unknown", "verdicts never upgrade missing facts");
});
