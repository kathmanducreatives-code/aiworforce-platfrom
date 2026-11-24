// Q4 — THE QUALIFICATION ACCEPTANCE MATRIX (docs/launch/qualification-acceptance/README.md).
//
// Every case runs one customer request through the real compiler, graph,
// feasibility, engine, claim-verification phase (funding, business model,
// open role), evaluator parser, canonical decision, Workbench, persistence
// projection, notice, terminal and a resume (`q4/acceptanceHarness.ts`). Only
// external answers are synthetic. Each case asserts the decision AND every
// downstream flag: they must all say the same thing (`assertConsistent`).
//
// KNOWN GAPS are real defects this matrix found, kept visible: ignored by
// default, red with `Q4_ASSERT_GAPS=1`, the same convention as the A7 and Q3
// lanes. The first two it found (Q4-EXCLUSION-INVERTED, Q4-PREFERENCE-HARD,
// both older than the Q1–Q3 stack) are fixed, with their controls in
// q4ExclusionAndPreference.test.ts; their cases below now run by default.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AcceptanceCase, type AcceptanceFlags, KEY, runAcceptanceCase } from "./q4/acceptanceHarness.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluatorAnswered, parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { buildCompanyEvidence } from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

/** Defects the matrix found whose fix has not landed. */
const KNOWN_GAPS = new Set<string>([]);
const gap = (id: string) => ({ ignore: KNOWN_GAPS.has(id) && Deno.env.get("Q4_ASSERT_GAPS") !== "1" });

const AE = "Find 1 B2B software company hiring Account Executives within the last 30 days.";
const FUNDING = { strategies: ["funding"], capabilities: ["funding_event_discovery", "company_semantic_evaluation"] };
const FOUNDER_CAPS = ["general_company_discovery", "embedded_hiring_evidence", "offer_founder_unlock"];
const AGENCY = { name: "Acceptance Recruiting", industries: ["Staffing and Recruiting"],
  description: "We recruit staff for business customers and are hiring our own internal Account Executive." };
/** Actors no case may ever run: social, technology and news routes are not executable. */
const NEVER = /post|comment|builtwith|google_news|people/;

/**
 * THE SAME ANSWER EVERYWHERE. The canonical keys, the Workbench count, the
 * persistence plan, the notice, the terminal settlement and a resume from the
 * final checkpoint agree — and the resume buys and evaluates nothing.
 */
function assertConsistent(f: AcceptanceFlags) {
  const n = f.qualifiedKeys.length;
  assertEquals(f.workbench.qualified, n, `${f.id}: Workbench`);
  assertEquals(f.persisted.length, n, `${f.id}: persistence plan`);
  assertEquals(f.persisted.map((r) => r.company_key).sort(), [...f.qualifiedKeys].sort(), `${f.id}: persisted rows are the qualified ones`);
  assertEquals(f.notice.qualified, n, `${f.id}: notice count`);
  assert(new RegExp(`\\b${n} qualified\\b`).test(f.notice.text) || (n === 0 && /No company reached qualification/.test(f.notice.text)),
    `${f.id}: notice text — ${f.notice.text}`);
  if (f.refused) return;
  assertEquals(f.terminal.delivered, n, `${f.id}: terminal`);
  assertEquals(f.terminal.terminal, n >= 1 ? "completed" : "search_exhausted", `${f.id}: terminal state`);
  for (const d of f.canonical) {
    const qualified = f.qualifiedKeys.includes(d.company_key);
    assertEquals(d.label !== null, qualified, `${f.id}: only a qualified company carries a label`);
    if (!qualified) assert(["pending", "ineligible", "screened_out"].includes(d.bucket), `${f.id}: bucket ${d.bucket}`);
  }
  assertEquals(f.resume!.keys, f.qualifiedKeys, `${f.id}: a resume reaches the same decision`);
  assertEquals([f.resume!.providerCallsAdded, f.resume!.evaluatorCallsAdded], [0, 0], `${f.id}: a resume buys nothing`);
  assertFalse(f.providerCalls.some((c) => NEVER.test(c.actor)), `${f.id}: no unexecutable route ran`);
}

/** One case: the qualified count, then every downstream flag. */
async function accept(c: AcceptanceCase, qualified: 0 | 1): Promise<AcceptanceFlags> {
  const f = await runAcceptanceCase(c);
  assertEquals(f.qualifiedKeys.length, qualified, `${c.id}: canonical decision`);
  assertConsistent(f);
  return f;
}
const hard = (f: AcceptanceFlags, dim: string) => f.canonical[0]?.hard_checks?.[dim];
const check = (f: AcceptanceFlags, dim: string) => f.eligibility[0]?.checks.find((x) => x.dimension === dim);
const calls = (f: AcceptanceFlags, actor: string) => f.providerCalls.filter((c) => c.actor === actor).length;
const refusedBeforeAnyProvider = (f: AcceptanceFlags) => {
  assertEquals(f.refused, "feasibility");
  assertEquals(f.providerCalls, [], "no Actor ran");
  assert(f.feasibility.refusals.length > 0 && f.feasibility.declared_gaps.length > 0, "the customer is told why");
};

// ═══════════════════════════════════════════════════════ 1. SaaS hiring ══

Deno.test("Q4.1 hiring: an AE posted 2 days ago qualifies — evaluator, canonical and every count agree", async () => {
  const f = await accept({ id: "1-ae", request: AE, signal: ["hiring Account Executives"] }, 1);
  assertEquals(f.entry, "job_discovery");
  assertEquals(f.evaluator[0].decision, "qualified");
  const v = f.evaluator[0].verdicts.find((x) => x.criterion_id.startsWith("hiring:"));
  assertEquals(v.result, "pass");
  assert(v.evidence.length > 0, "the raw hiring verdict carries its posting receipt");
  assertEquals([hard(f, "industry"), hard(f, "hiring")], ["pass", "pass"]);
});

Deno.test("Q4.1 hiring: an SDR posting is not an AE when the role may not be broadened", async () => {
  const f = await accept({ id: "1-sdr", request: AE, signal: ["hiring Account Executives"], proposal: { disallowed_broadening: ["role"] },
    jobs: [{ title: "Sales Development Representative", postedDaysAgo: 2 }] }, 0);
  assertEquals(hard(f, "hiring"), "unknown");
  assertEquals(f.evaluator.length, 0, "no model call for a company without the role");
});

Deno.test("Q4.1 hiring: 'its FIRST sales rep' — an ordinary opening stays pending and buys nothing; a first-hire posting qualifies", async () => {
  const q = "Find 1 B2B software company that must be hiring its first sales representative within the last 30 days.";
  const ordinary = await accept({ id: "1-first-ordinary", request: q, signal: ["hiring first sales representative"],
    jobs: [{ title: "Sales Representative", postedDaysAgo: 2 }] }, 0);
  assertEquals(check(ordinary, "hiring")?.blocked, "unproven:first_in_function");
  assertEquals(ordinary.eligibility[0].gaps, [], "nothing is bought for it");
  assertEquals(ordinary.evaluator[0].decision, "qualified", "the model's optimism does not decide it");
  await accept({ id: "1-first", request: q, signal: ["hiring first sales representative"], jobs: [{ title: "Sales Representative", postedDaysAgo: 2,
    description: "You will be our first sales hire, building the sales function from scratch." }] }, 1);
});

Deno.test("Q4.1 hiring: stale, closed, undated and another employer's postings never qualify", async () => {
  for (const [id, job] of [
    ["1-stale", { title: "Account Executive", postedDaysAgo: 65 }],
    ["1-closed", { title: "Account Executive", postedDaysAgo: 2, closed: true }],
    ["1-undated", { title: "Account Executive", postedDaysAgo: null }],
    ["1-wrong-employer", { title: "Account Executive", postedDaysAgo: 2, employerUrl: "https://www.linkedin.com/company/foreign-employer",
      description: "Employer: Foreign Employer\nWe are hiring an Account Executive." }],
  ] as const) {
    const f = await accept({ id, request: AE, signal: ["hiring Account Executives"], jobs: [job] }, 0);
    if (f.canonical.length) assert(hard(f, "hiring") !== "pass", `${id}: hiring is never passed`);
  }
});

// ══════════════════════════════════════════════════ 2. Recruiting agencies ══

const AGENCY_Q = "Find 1 recruiting agency hiring its own Account Executives within the last 30 days.";

Deno.test("Q4.2 agencies: an agency's own internal hiring qualifies; a client posting it advertises never does", async () => {
  const own = await accept({ id: "2-own", request: AGENCY_Q, signal: ["hiring Account Executives"], companyTypes: ["recruiting agency"], company: AGENCY }, 1);
  assertEquals(hard(own, "industry"), "pass", "the interpretive industry, answered from the company's own words");
  const client = await accept({ id: "2-client", request: AGENCY_Q, signal: ["hiring Account Executives"], companyTypes: ["recruiting agency"],
    company: { ...AGENCY, description: "We recruit staff for business customers." },
    jobs: [{ title: "Account Executive", postedDaysAgo: 2, description: "On behalf of our client we are hiring an Account Executive." }] }, 0);
  assert(hard(client, "hiring") !== "pass");
});

// ═══════════════════════════════════════════ 3. Manufacturing expansion ══
//
// No expansion route is executable in production, so the request is refused
// before any spend. The window rule the route will need is proven here at the
// decision layer: a dated announcement inside the window passes, outside it
// does not, and an undated page never proves a windowed claim.

Deno.test("Q4.3 expansion: refused before any Actor while no route can prove it", async () => {
  refusedBeforeAnyProvider(await runAcceptanceCase({ id: "3-expansion", request: "Find 1 manufacturing company that opened a new facility in the last 90 days.",
    signal: ["opened a new facility"], companyTypes: ["manufacturing"], strategies: ["news"], capabilities: ["general_company_discovery", "expansion_evidence"] }));
});

Deno.test("Q4.3 expansion: a dated announcement inside the window is proof; outside it, or undated, is not", () => {
  const NOW = Date.now();
  const c: MissionCriterion = { id: "expansion:q4", dimension: "expansion", kind: "hard", value: true, label: "Opened a new facility",
    source: "user_explicit", user_phrase: "opened a new facility", rationale: "x", status: "ok",
    time_window: { days: 90, basis: "observed", source: "user_explicit", enforced: true } as never };
  const verdict = (registry: ReturnType<typeof buildEvidenceRegistry>, type: string) => {
    const it = registry.items.find((x) => x.evidence_type === type)!;
    return parseMissionEvaluationStrict({ mission_fit: "pass", reasoning: "x", unknown_fields: [], failed_requirements: [],
      matched_requirements: [{ requirement: c.label, evidence_id: it.evidence_id, excerpt: it.source_text! }],
      criterion_verdicts: [{ criterion_id: c.id, result: "pass", reason: "x", evidence: [{ evidence_id: it.evidence_id, excerpt: it.source_text! }] }],
    }, registry, [c]).evaluation.criterion_verdicts![0].result;
  };
  const evidence = buildCompanyEvidence({ company_key: "co", source_capability: "company_enrichment", identity_state: "resolved",
    company: normalizeLinkedInCompanyEnriched({ id: "co", name: "Acceptance Co", linkedinUrl: KEY, website: "https://acceptance.example",
      description: "We make industrial parts.", employeeCountRange: { start: 51, end: 200 }, industries: [{ name: "Manufacturing" }],
      locations: [{ country: "United States", city: "Dayton", isHeadquarter: true }] }) } as never);
  const article = (daysAgo: number) => buildEvidenceRegistry({ now: NOW, evidence, expansion_evidence: [{ title: "Acceptance Co opens new Ohio facility",
    url: "https://news.invalid/a", source: "publisher", published_at: new Date(NOW - daysAgo * 86_400_000).toISOString() }] } as never);
  assertEquals(verdict(article(20), "expansion_signal"), "pass");
  assertEquals(verdict(article(200), "expansion_signal"), "unknown");
  const page = buildEvidenceRegistry({ now: NOW, evidence, web_pages: [{ source_url: "https://acceptance.example/news", page_intent: "news",
    source_text: "We opened our new Ohio facility.", fetched_at: new Date(NOW).toISOString() }] } as never);
  assertEquals(verdict(page, "web_page"), "unknown", "a fetch date is not an event date");
  assertEquals(evaluateEligibility([c], buildCompanyEvidenceGraph("co", [], { now: new Date(NOW) })).eligibility, "pending");
});

// ═══════════════════════════════════════════════════════════ 4. Funding ══

const RECENT = "Find 1 B2B software company with a recent funding announcement within the last 90 days.";
const VENTURE = "Find 1 B2B software company that has raised venture funding in the last 90 days.";
const STAGES = "Find 1 B2B software company that must be Seed or Series A stage.";

Deno.test("Q4.4 funding: a round inside the window qualifies; one outside it rules the company out", async () => {
  const inside = await accept({ id: "4-inside", request: RECENT, signal: ["funding in the last 90 days"], ...FUNDING, rounds: [{ type: "Seed", daysAgo: 15 }] }, 1);
  assertEquals([hard(inside, "funding"), hard(inside, "industry")], ["pass", "pass"]);
  assertEquals(calls(inside, "firecrawl"), 1, "the business model is verified from the company's own pages, once");
  const outside = await accept({ id: "4-outside", request: RECENT, signal: ["funding in the last 90 days"], ...FUNDING, rounds: [{ type: "Seed", daysAgo: 200 }] }, 0);
  assertEquals(hard(outside, "funding"), "fail");
  assertEquals(calls(outside, "firecrawl"), 0, "nothing more is bought for a company already ruled out");
});

Deno.test("Q4.4 funding: venture funding means equity — a grant is not one", async () => {
  const grant = await accept({ id: "4-grant", request: VENTURE, signal: ["venture funding in the last 90 days"], ...FUNDING,
    rounds: [{ type: "Grant", daysAgo: 20, nonEquity: true }] }, 0);
  assertEquals(hard(grant, "funding"), "fail");
  await accept({ id: "4-venture", request: VENTURE, signal: ["venture funding in the last 90 days"], ...FUNDING, rounds: [{ type: "Series A", daysAgo: 20 }] }, 1);
});

Deno.test("Q4.4 funding: a stage set ('Seed or Series A') is one requirement; a later round rules it out", async () => {
  const caps = { strategies: ["funding"], capabilities: ["general_company_discovery", "company_semantic_evaluation"] };
  await accept({ id: "4-stage-seed", request: STAGES, signal: [], ...caps, rounds: [{ type: "Seed", daysAgo: 100 }] }, 1);
  const later = await accept({ id: "4-stage-b", request: STAGES, signal: [], ...caps, rounds: [{ type: "Seed", daysAgo: 900 }, { type: "Series B", daysAgo: 100 }] }, 0);
  assertEquals(hard(later, "company_stage"), "fail");
});

// ═══════════════════════════════════════════════ 5. LinkedIn social ══

Deno.test("Q4.5 social: a social-only request is refused before any Actor while social proof is unsupported", async () => {
  refusedBeforeAnyProvider(await runAcceptanceCase({ id: "5-social", request: "Find founders commenting on LinkedIn about problems with outbound sales in the last 30 days.",
    signal: ["founders commenting about outbound sales problems"], capabilities: ["offer_founder_unlock"], companyTypes: [], strategies: ["social"],
    proposal: { output_intent: "social_posts" } }));
});

Deno.test("Q4.5 social: a mixed mission never drops its mandatory founder clause — hiring alone does not qualify", async () => {
  const f = await accept({ id: "5-mixed", request: "Find 1 B2B software company that must be hiring Account Executives AND whose founder must have discussed outbound problems on LinkedIn.",
    signal: ["hiring Account Executives", "founder comments about outbound problems"], capabilities: FOUNDER_CAPS, strategies: ["hiring", "multi_signal"] }, 0);
  assertEquals(f.criteria.find((c) => c.dimension === "social_activity")?.kind, "hard");
  assertEquals([hard(f, "hiring"), hard(f, "social_activity")], ["pass", "unknown"]);
  assertEquals(f.evaluator[0].decision, "insufficient_evidence");
});

// ═══════════════════════════════════════════════════ 6. Mixed AND / OR ══

const OR = "Find 1 B2B software company hiring Account Executives OR having raised funding in the last 90 days.";
const AND = "Find 1 B2B software company hiring Account Executives AND having raised funding in the last 90 days.";
const MIXED = { signal: ["hiring Account Executives", "recent funding"], strategies: ["hiring", "funding"] };

Deno.test("Q4.6 OR: hiring alone satisfies 'hiring OR funding' — through the postings, nothing bought for funding", async () => {
  const f = await accept({ id: "6-or", request: OR, ...MIXED }, 1);
  assertEquals(f.entry, "job_discovery");
  assertEquals(calls(f, "apify_funding_atomus") + calls(f, "apify_funding_pvalyou"), 0);
  assertEquals(hard(f, "funding"), "pass", "answered by the alternative");
});

Deno.test("Q4.6 AND: hiring with no funding record stays pending; both proven qualifies", async () => {
  const none = await accept({ id: "6-and-none", request: AND, ...MIXED }, 0);
  assert(none.canonical.every((d) => d.bucket === "pending"));
  await accept({ id: "6-and-both", request: AND, ...MIXED, rounds: [{ type: "Series A", daysAgo: 20 }] }, 1);
});

const EXCLUDING = "Find 1 B2B software company hiring Account Executives within the last 30 days, excluding recruiting agencies.";

Deno.test("Q4.6 exclusion: 'excluding recruiting agencies' never qualifies a recruiting agency", gap("Q4-EXCLUSION-INVERTED"), async () => {
  const f = await runAcceptanceCase({ id: "6-exclusion", request: EXCLUDING, signal: ["hiring Account Executives"], company: AGENCY });
  assertFalse(f.criteria.some((c) => c.kind === "hard" && /recruit/i.test(String(c.value))), "an exclusion is never a requirement");
  assertEquals(f.qualifiedKeys.length, 0);
});

Deno.test("Q4.6 exclusion: a B2B software company under the exclusion qualifies — the stated industry kept, the exclusion answered", async () => {
  const f = await accept({ id: "6-exclusion-software", request: EXCLUDING, signal: ["hiring Account Executives"] }, 1);
  assertEquals([hard(f, "industry"), hard(f, "exclusion"), hard(f, "hiring")], ["pass", "pass", "pass"]);
});

Deno.test("Q4.6 exclusion control: without the exclusion, the stated industry still decides", async () => {
  await accept({ id: "6-exclusion-control", request: AE, signal: ["hiring Account Executives"] }, 1);
});

Deno.test("Q4.6 preference: 'ideally in the US' never rejects a company headquartered elsewhere", gap("Q4-PREFERENCE-HARD"), async () => {
  const f = await runAcceptanceCase({ id: "6-preference", request: "Find 1 B2B software company hiring Account Executives within the last 30 days, ideally in the US.",
    signal: ["hiring Account Executives"], details: "hq_conflict", proposal: { geographies: ["United States"], geography_is_hard: false } });
  assert(f.criteria.find((c) => c.dimension === "geography")?.kind !== "hard", "a preference is not a requirement");
  assertEquals(f.qualifiedKeys.length, 1);
});

// ═════════════════════════════════════════ 7. Contradictory evidence ══

const US_HQ = "Find 1 US-headquartered B2B software company hiring Account Executives in the last 30 days.";
const HQ = { signal: ["hiring Account Executives"], proposal: { geographies: ["United States"], geography_is_hard: true } };

Deno.test("Q4.7 contradiction: the company record's Canadian HQ rules out a US-HQ request; a US HQ qualifies", async () => {
  const canada = await accept({ id: "7-canada", request: US_HQ, ...HQ, details: "hq_conflict" }, 0);
  assertEquals(hard(canada, "geography"), "fail");
  assertEquals(canada.evaluator[0]?.decision, "qualified", "the posting's optimism never outranks the company record");
  await accept({ id: "7-us", request: US_HQ, ...HQ }, 1);
});

Deno.test("Q4.7 contradiction: a company record that resolves to a different company never qualifies the posting's employer", async () => {
  await accept({ id: "7-foreign", request: AE, signal: ["hiring Account Executives"], details: "foreign" }, 0);
});

// ═══════════════════════════════════════════════ 8. Different windows ══

const SEVEN = "Find 1 B2B software company hiring Account Executives in the last 7 days.";

Deno.test("Q4.8 windows: a 7-day hiring window rejects a 10-day-old posting and accepts a 3-day-old one", async () => {
  await accept({ id: "8-out", request: SEVEN, signal: ["hiring Account Executives"], jobs: [{ title: "Account Executive", postedDaysAgo: 10 }] }, 0);
  const inside = await accept({ id: "8-in", request: SEVEN, signal: ["hiring Account Executives"], jobs: [{ title: "Account Executive", postedDaysAgo: 3 }] }, 1);
  assertEquals(inside.criteria.find((c) => c.dimension === "hiring")?.time_window?.days, 7);
});

Deno.test("Q4.8 windows: 7-day hiring and 30-day founder comments keep their own windows; the unproven social clause holds it", async () => {
  const f = await accept({ id: "8-two-windows", request: "Find 1 B2B software company hiring Account Executives in the last 7 days AND whose founder must have commented on outbound in the last 30 days.",
    signal: ["hiring Account Executives", "founder comments about outbound"], capabilities: FOUNDER_CAPS, strategies: ["hiring", "multi_signal"] }, 0);
  assertEquals(["hiring", "social_activity"].map((d) => f.criteria.find((c) => c.dimension === d)?.time_window?.days), [7, 30]);
});

// ═════════════════════════════════════════ 9. Unsupported providers ══

Deno.test("Q4.9 unavailable provider: refused before any Actor — no substitute purchase", async () => {
  refusedBeforeAnyProvider(await runAcceptanceCase({ id: "9-unavailable", request: AE, signal: ["hiring Account Executives"],
    unavailable: ["apify_linkedin_job_search"] }));
});

Deno.test("Q4.9 evaluator: a FAIL verdict holds a company every fact passes; no evaluator answer qualifies nothing", async () => {
  const fail = await accept({ id: "9-eval-fail", request: AE, signal: ["hiring Account Executives"], evaluator: "fail" }, 0);
  assertEquals(fail.eligibility[0].eligibility, "eligible", "every fact passes");
  assertEquals(fail.evaluator[0].decision, "not_qualified");
  await accept({ id: "9-eval-timeout", request: AE, signal: ["hiring Account Executives"], evaluator: "timeout" }, 0);
});

Deno.test("Q4.9b canary session 2: a FAILED evaluator call is never `model_evaluated` and fabricates no verdict", async () => {
  // run-agent parses a failed call's `null`; the strict parser answers with an
  // `unknown` row for every criterion (origin "unparsed"). Those rows used to be
  // recorded as the model's evaluation and lowered every evidence-proven check.
  const f = await accept({ id: "9-eval-http-error", request: AE, signal: ["hiring Account Executives"], evaluator: "http_error" }, 0);
  for (const [k, path] of Object.entries(f.evaluation_paths)) {
    assert(path !== "model_evaluated", `${k}: a failed call is not an evaluation (${path})`);
  }
  const stored = Object.entries(f.mission_evaluations);
  assert(stored.length > 0);
  for (const [k, e] of stored) {
    assertFalse(evaluatorAnswered(e as never), `${k}: what a resume restores is not an answer`);
    assertEquals(((e?.criterion_verdicts ?? []) as Array<{ origin?: string }>).filter((v) => v.origin === "unparsed").length, 0,
      `${k}: no fabricated "not_an_object" verdict is stored to lower a check`);
  }
});

// ══════════════════════════════════════ 10. Interrupted and resumed ══

Deno.test("Q4.10 interrupted: a slice that runs out of time after discovery resumes to the same decision, buying nothing twice", async () => {
  const f = await accept({ id: "10-interrupted", request: AE, signal: ["hiring Account Executives"], interrupt: true }, 1);
  assert(f.execution.slices >= 2, "the work finished in a later slice");
  assertFalse((f.execution.completed as string[]).includes("company_enrichment"), "the first slice stopped before enrichment");
  assertEquals([calls(f, "apify_linkedin_job_search"), calls(f, "apify_linkedin_company_details")], [1, 1], "each purchase made once");
  assertEquals(f.qualifiedKeys, [KEY]);
});
