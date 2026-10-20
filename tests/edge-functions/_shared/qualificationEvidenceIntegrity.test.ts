// Q2 — EVIDENCE INTEGRITY.
//
// The canonical decision may only rest on evidence that is (1) undisputed by an
// equally authoritative source, (2) dated inside the customer's own window by
// the EVENT's date, (3) this company's own, and (4) about the requirement the
// customer actually stated (a first hire is not any hire). Each rule has a
// positive control: Q2 must not turn a real match into a miss.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkCriterion, evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { eventWithinWindow, type EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { canStillQualify, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const criterion = (dimension: MissionCriterion["dimension"], value: unknown, over: Partial<MissionCriterion> = {}): MissionCriterion => ({
  id: `${dimension}:q2`, dimension, kind: "hard", value, label: String(value), source: "user_explicit",
  user_phrase: String(value), rationale: "customer requirement", status: "ok", ...over,
});
let seq = 0;
const item = (dimension: EvidenceItem["dimension"], value: unknown, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  evidence_id: `q2_${dimension}_${++seq}`, company_key: "co", dimension, value, status: "proven",
  source: { provider: "fixture", actor: `provider-${seq}`, provider_call_id: null, url: null, excerpt: null },
  method: "provider_field", observed_at: NOW.toISOString(), valid_until: null, confidence: "high",
  derived_from: [], mission_id: null, origin: "lead_mission", ...over,
});
const hq = (place: string) => item("geography", place, { authority: { claim: "headquarters", level: "proven" } as never });
const graph = (items: EvidenceItem[]) => buildCompanyEvidenceGraph("co", items, { now: NOW });
const US_HQ = criterion("geography", "United States", { geography_scope: "headquarters" });
const SMALL = criterion("company_size", { min: 11, max: 50 });

// ═════════════════════════════════════════════════ authoritative conflicts ══

Deno.test("Q2 conflicts: two authoritative HQ records disagree — unknown and blocked, in either arrival order (G01)", () => {
  for (const order of [[hq("Boston, United States"), hq("Toronto, Canada")], [hq("Toronto, Canada"), hq("Boston, United States")]]) {
    const check = checkCriterion(US_HQ, graph(order));
    assertEquals([check.result, check.blocked], ["unknown", "conflict:geography"], check.reason);
    const e = evaluateEligibility([US_HQ], graph(order));
    assertEquals(e.eligibility, "pending");
    // Nothing is bought to settle it: the same kind of source cannot.
    const gaps = evidenceGapsFor(e.checks, graph(order));
    assertEquals(gaps.map((g) => g.next), ["blocked"]);
    assertEquals(canStillQualify(gaps), false);
  }
});

Deno.test("Q2 conflicts: two authoritative size bands disagree — unknown, not the first-sorted band (G02)", () => {
  const g = graph([item("company_size_band", { min: 11, max: 50 }), item("company_size_band", { min: 201, max: 500 })]);
  assertEquals(checkCriterion(SMALL, g).result, "unknown");
  assertEquals(evaluateEligibility([SMALL], g).eligibility, "pending");
});

Deno.test("Q2 conflicts: controls — agreement passes, an immaterial difference decides nothing, a weaker source never overturns", () => {
  assertEquals(checkCriterion(US_HQ, graph([hq("Boston, United States"), hq("Boston, MA, United States")])).result, "pass",
    "two US HQ records: different wording, same answer");
  assertEquals(checkCriterion(SMALL, graph([item("company_size_band", { min: 11, max: 50 }), item("company_size_band", { min: 11, max: 50 })])).result, "pass");
  assertEquals(checkCriterion(SMALL, graph([item("company_size_band", { min: 11, max: 50 }), item("company_size_band", { min: 1, max: 10 })])).result,
    "unknown", "a different band that ALSO changes this criterion's answer is material");
  // A reported (plausible) Canadian HQ beside a proven US one: the graph's order stands.
  assertEquals(checkCriterion(US_HQ, graph([hq("Boston, United States"), { ...hq("Toronto, Canada"), status: "plausible" as const }])).result, "pass");
  // A lower method (model extraction) does not dispute a provider field.
  assertEquals(checkCriterion(US_HQ, graph([hq("Boston, United States"), { ...hq("Toronto, Canada"), method: "model_extraction" as const }])).result, "pass");
});

Deno.test("Q2 conflicts: a proven disagreement that still FAILS is not hidden as unknown", () => {
  assertEquals(checkCriterion(US_HQ, graph([hq("Toronto, Canada"), hq("Vancouver, Canada")])).result, "fail",
    "both authoritative records rule the US out");
});

// ═══════════════════════════════════════════════════ event-dated windows ══

const EXPANSION_7 = criterion("expansion", "new facility", {
  time_window: { days: 7, basis: "observed", source: "user_explicit", enforced: true } as never,
});

Deno.test("Q2 windows: the customer's window is judged on the EVENT's date (G14)", () => {
  assertEquals(checkCriterion(EXPANSION_7, graph([item("expansion", true, { occurred_at: daysAgo(3) })])).result, "pass", "3 days old, 7-day window");
  const old = checkCriterion(EXPANSION_7, graph([item("expansion", true, { occurred_at: daysAgo(45) })]));
  assertEquals(old.result, "unknown");
  assert(/outside the 7-day window/.test(old.reason), old.reason);
  // Observed (fetched) today, event undated: not inside any window.
  assertEquals(checkCriterion(EXPANSION_7, graph([item("expansion", true)])).result, "unknown");
  // No window asked for: presence still answers it, as before.
  assertEquals(checkCriterion(criterion("expansion", "new facility"), graph([item("expansion", true)])).result, "pass");
});

Deno.test("Q2 windows: missing, unreadable and future event dates are never inside a window", () => {
  for (const d of [null, undefined, "bad-date", daysAgo(-3)]) assertEquals(eventWithinWindow(d, 30, NOW.getTime()).inside, false, String(d));
  assertEquals(eventWithinWindow(daysAgo(30), 30, NOW.getTime()).inside, true, "the boundary day is inside");
  assertEquals(eventWithinWindow(daysAgo(31), 30, NOW.getTime()).inside, false);
});

// ═══════════════════════════════════════════ registry: dates and ownership ══

const ROW = {
  id: "co", name: "Example", description: "Example builds software for revenue teams at business customers.",
  linkedinUrl: "https://www.linkedin.com/company/example", website: "https://example.invalid",
  employeeCountRange: { start: 11, end: 50 },
  locations: [{ country: "United States", city: "Boston", isHeadquarter: true }],
};
const registry = (over: Record<string, unknown> = {}) => buildEvidenceRegistry({
  evidence: buildCompanyEvidence({ company_key: "co", company: normalizeLinkedInCompanyEnriched(ROW), source_capability: "company_enrichment", identity_state: "resolved" }),
  now: NOW.getTime(), ...over,
} as never);
const job = (employer: string, posted = daysAgo(2)) => ({
  job_id: employer, job_url: `https://jobs.invalid/${employer}`, title: "VP of Sales", company_name: employer,
  company_linkedin_url: `https://www.linkedin.com/company/${employer}`, company_source_id: employer, location: "US",
  workplace_mode: null, posted_date: posted, description: "hiring", source: "job_provider", retrieved_at: NOW.toISOString(), missing_fields: [],
});

Deno.test("Q2 ownership: another employer's posting is kept as invalid, never relabelled as this company's (G03)", () => {
  const r = registry({ jobs: [job("example"), job("other-employer")] });
  const own = r.items.find((x) => x.evidence_type === "job_posting" && x.metadata.company_linkedin_url === "https://www.linkedin.com/company/example")!;
  const foreign = r.items.find((x) => x.evidence_type === "job_posting" && x.metadata.company_linkedin_url !== own.metadata.company_linkedin_url)!;
  assertEquals([own.verification_state, own.occurred_at], ["verified", own.structured_value && (own.structured_value as { posted_date: string }).posted_date]);
  assertEquals([foreign.verification_state, foreign.metadata.ownership], ["invalid", "foreign_employer"]);
  // A receipt citing it cannot pass the hiring requirement.
  const c = criterion("hiring", "VP of Sales");
  const parse = (id: string) => parseMissionEvaluationStrict({
    mission_fit: "pass", hiring_fit: "verified", reasoning: "x", unknown_fields: [], failed_requirements: [],
    matched_requirements: [{ requirement: c.label, evidence_id: id, excerpt: "VP of Sales" }],
    criterion_verdicts: [{ criterion_id: c.id, result: "pass", reason: "x", evidence: [{ evidence_id: id, excerpt: "VP of Sales" }] }],
  }, r, [c]).evaluation.criterion_verdicts![0].result;
  assertEquals(parse(foreign.evidence_id), "unknown");
  assertEquals(parse(own.evidence_id), "pass", "the company's own posting still proves it");
});

Deno.test("Q2 ownership: the graph refuses an item keyed to another company; an unassigned item stays (G04)", () => {
  const bm = criterion("business_model", "b2b_software");
  assertEquals(evaluateEligibility([bm], graph([item("business_model", "b2b_software", { company_key: "other" })])).eligibility, "pending");
  assertEquals(evaluateEligibility([bm], graph([item("business_model", "b2b_software", { company_key: null })])).eligibility, "eligible");
  assertEquals(evaluateEligibility([bm], graph([item("business_model", "b2b_software")])).eligibility, "eligible");
});

Deno.test("Q2 timestamps: a page's freshness comes from a valid fetch date; a fetch date is never an event date (G05–G07)", () => {
  const page = (fetched_at: string | null) => registry({ web_pages: [{ source_url: "https://example.invalid/news", page_intent: "news",
    source_text: "We are opening our new Berlin facility this month.", fetched_at }] }).items.find((x) => x.evidence_type === "web_page")!;
  assertEquals(page("2020-01-01T00:00:00Z").freshness, "stale");
  assertEquals(page(null).freshness, "unknown");
  assertEquals(page("bad-date").freshness, "unknown");
  assertEquals(page(NOW.toISOString()).freshness, "current");
  for (const p of [page("2020-01-01T00:00:00Z"), page(NOW.toISOString())]) assertEquals(p.occurred_at, null, "no event date on a page");
  // So no page receipt proves a windowed requirement; a dated article does.
  const c = criterion("expansion", true, { time_window: { days: 30, basis: "observed", source: "user_explicit", enforced: true } as never });
  const cite = (r: ReturnType<typeof registry>, type: string) => {
    const it = r.items.find((x) => x.evidence_type === type)!;
    return parseMissionEvaluationStrict({
      mission_fit: "pass", reasoning: "x", unknown_fields: [], failed_requirements: [],
      matched_requirements: [{ requirement: c.label, evidence_id: it.evidence_id, excerpt: it.source_text! }],
      criterion_verdicts: [{ criterion_id: c.id, result: "pass", reason: "x", evidence: [{ evidence_id: it.evidence_id, excerpt: it.source_text! }] }],
    }, r, [c]).evaluation.criterion_verdicts![0].result;
  };
  assertEquals(cite(registry({ web_pages: [{ source_url: "https://example.invalid/n", page_intent: "news",
    source_text: "We are opening our new Berlin facility this month.", fetched_at: NOW.toISOString() }] }), "web_page"), "unknown");
  const article = (published_at: string) => registry({ expansion_evidence: [{ title: "Example opens Berlin facility", url: "https://news.invalid/a", source: "publisher", published_at }] });
  assertEquals(cite(article(daysAgo(5)), "expansion_signal"), "pass", "a dated article inside the window");
  assertEquals(cite(article(daysAgo(45)), "expansion_signal"), "unknown", "the same article outside it");
});

// ══════════════════════════════════════════════════════ first-hire claims ══

const FIRST_SALES = criterion("hiring", { qualifier: { role_families: ["sales"], first_in_function: { phrase: "its first sales representative", source: "user_explicit" } } });
const opening = () => item("hiring", true);
const team = (first_in_function: string, status: EvidenceItem["status"] = "proven") =>
  item("team_composition", { first_in_function, source: "job_posting", quote: "you will be our first sales hire" }, { status });

Deno.test("Q2 first hire: an ordinary opening does not prove 'its FIRST sales representative' (Codex H03)", () => {
  const c = checkCriterion(FIRST_SALES, graph([opening()]));
  assertEquals([c.result, c.blocked], ["unknown", "unproven:first_in_function"]);
  assertEquals(canStillQualify(evidenceGapsFor([c], graph([opening()]))), false, "nothing is bought for it");
});

Deno.test("Q2 first hire: the posting's own first-hire words prove it (H02); a contradiction fails it", () => {
  assertEquals(checkCriterion(FIRST_SALES, graph([opening(), team("supported")])).result, "pass");
  assertEquals(checkCriterion(FIRST_SALES, graph([opening(), team("contradicted", "disproven")])).result, "fail");
  // A requirement without first-hire words is unchanged by any of this.
  assertEquals(checkCriterion(criterion("hiring", { qualifier: { role_families: ["sales"] } }), graph([opening()])).result, "pass");
});
