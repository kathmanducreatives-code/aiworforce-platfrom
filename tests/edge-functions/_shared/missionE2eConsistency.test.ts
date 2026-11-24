// END TO END: one request, every component, the same meaning (owner's phase-5 example).
//
// "Find US companies hiring Account Executives, but exclude SDRs." and paraphrases of it
// are compiled under contract v3 (the model step is a recorded v3 reading — the live
// study measures the model itself), then followed through every layer: canonical criteria
// → frozen → the ATLAS planner spec and the job titles it searches → ORION's vocabulary and
// posting matcher → qualification on evidence. Genuinely different requests must not
// collapse into the same mission.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { criteriaFreezeState, criteriaOf, hiringRequirementOf, hiringTitleMatcher } from "../../../supabase/functions/_shared/missionCriteriaReader.ts";
import { discoveryJobTitles, specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { buildQualificationContext } from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { EvidenceDimension, EvidenceItem } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { canonicalTitleOf } from "../../../supabase/functions/_shared/roleFamilies.ts";
import { summarise } from "../../../scripts/dev/interpretation-corpus.ts";
import { BLANK } from "../../../scripts/dev/interpretation-fuzz.ts";

const AE = "account_executive", SDR = "sales_development_representative";
const R = (span: string, title: string, relation: "required" | "excluded" = "required") => ({ span, title, family: null, relation });
const P = (span: string) => ({ span, place: "united states", other_place: null, scope: "headquarters", necessity: "required" });
const U = (roles: unknown[], place: string, signal: string) => ({
  roles, role_match: "any", places: [P(place)], industries: [], signals: [{ span: signal, kind: "hiring", necessity: "required" }],
  signal_logic: "all", ambiguities: [], unsupported: [],
});
const PHRASINGS: [string, unknown][] = [
  ["Find US companies hiring Account Executives, but exclude SDRs.",
    U([R("Account Executives", AE), R("exclude SDRs", SDR, "excluded")], "US", "hiring Account Executives")],
  ["us cos hiring AEs - no SDRs pls",
    U([R("AEs", AE), R("no SDRs", SDR, "excluded")], "us", "hiring AEs")],
  ["Looking for American companies with open account exec roles; leave out SDR positions",
    U([R("account exec", AE), R("leave out SDR positions", SDR, "excluded")], "American", "open account exec roles")],
  ["Find companies HQ'd in the US recruiting acount executives (not sdrs)",
    U([R("acount executives", AE), R("not sdrs", SDR, "excluded")], "HQ'd in the US", "recruiting acount executives")],
];
const compile = (q: string, understanding: unknown) => compileLeadMission({
  originalUserQuery: q, requestedCount: 5, contract: "v3",
  proposal: { ...BLANK, hard_constraints: [], understanding } as never,
}).final_mission as unknown as Record<string, unknown>;

const NOW = new Date("2026-10-01T00:00:00.000Z");
let seq = 0;
const ev = (dimension: EvidenceDimension, value: unknown, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  evidence_id: `ev_${dimension}_${++seq}`, company_key: "c1", dimension, value, status: "proven",
  source: { provider: "apify", actor: "apify_linkedin_job_search", provider_call_id: "pc", url: null, excerpt: null },
  method: "provider_field", observed_at: "2026-09-30T00:00:00.000Z", valid_until: null, confidence: "high",
  derived_from: [], mission_id: "t", origin: "lead_mission", ...over,
} as EvidenceItem);
const HQ = () => ev("geography", "Austin, TX, United States", { source: { provider: "apify", actor: "apify_linkedin_company_details", provider_call_id: "pc", url: null, excerpt: null },
  authority: { version: "evidence-authority-v1", claim: "headquarters", level: "proven", rule: "li_record_single_headquarters_flag", reason: "flagged" } as never });
const posting = (title: string) => [
  ev("hiring", { open_role: true, role_families: ["gtm_sales"], titles: [title] }),
  ev("job", { title, posted_date: "2026-09-25T00:00:00.000Z", location: "Austin, TX" }),
];

for (const [query, understanding] of PHRASINGS) {
  Deno.test(`E2E "${query}": every component carries the same requirement, exclusion kept`, () => {
    const m = compile(query, understanding);
    // 1–3. the compiler preserved the meaning in the canonical criteria
    const criteria = criteriaOf(m as never);
    const req = hiringRequirementOf(criteria)!;
    assertEquals(req.hard, true);
    assertEquals(req.roleTerms.map(canonicalTitleOf), [AE]);
    assertEquals(req.excludedRoleTerms.map(canonicalTitleOf), [SDR]);
    const geo = criteria.find((c) => c.dimension === "geography")!;
    assertEquals([geo.kind, geo.value, geo.geography_scope], ["hard", "United States", "headquarters"]);
    // 4. frozen
    assertEquals(criteriaFreezeState(m as never), "frozen");
    // 5. ATLAS: the planner spec and the titles it searches
    const spec = specFromMission(m as never, { defaultCount: 5 });
    const sh = spec.signals.find((s) => s.kind === "hiring")!;
    assertEquals(sh.hard, true);
    assertEquals(sh.roleTerms.map(canonicalTitleOf), [AE]);
    assertEquals((sh.excludedRoleTerms ?? []).map(canonicalTitleOf), [SDR]);
    assertFalse(discoveryJobTitles(spec).some((t) => canonicalTitleOf(t) === SDR), "ATLAS never searches the excluded role");
    assert(spec.geography.map((g) => g.toLowerCase()).includes("united states"));
    // 6–7. ORION: same roles, exclusion carried, never searched, never matched
    const vocab = buildQualificationContext(m as never, { criteriaAuthority: true }).role_vocabulary;
    assertEquals(vocab.from, "criteria");
    assertFalse(vocab.required_titles.some((t) => canonicalTitleOf(t) === SDR));
    assert((vocab.excluded_titles ?? []).some((t) => canonicalTitleOf(t) === SDR));
    const matches = hiringTitleMatcher(req, vocab.required_titles);
    assert(matches("Senior Account Executive"));
    assertFalse(matches("Sales Development Representative"));
    assertFalse(matches("SDR (Outbound)"));
    // 8–10. qualification on evidence, with reasons
    const judge = (items: EvidenceItem[]) => evaluateEligibility(criteria.filter((c) => c.kind === "hard"), buildCompanyEvidenceGraph("c1", items, { now: NOW }));
    const aeCo = judge([HQ(), ...posting("Senior Account Executive")]);
    assertEquals(aeCo.eligibility, "eligible", JSON.stringify(aeCo.checks));
    const sdrCo = judge([HQ(), ...posting("Sales Development Representative")]);
    assert(sdrCo.eligibility !== "eligible", "an SDR-only company never qualifies");
    const hiringCheck = sdrCo.checks.find((c) => c.dimension === "hiring")!;
    assert(hiringCheck.result !== "pass" && hiringCheck.reason.length > 0, hiringCheck.reason);
    const unknownCo = judge([HQ()]);
    assertEquals(unknownCo.eligibility, "pending", "missing hiring evidence is never proof");
    assert(unknownCo.checks.every((c) => c.reason.length > 0), "every check explains itself");
  });
}

Deno.test("E2E: the paraphrases are ONE meaning; different requests are not", () => {
  const sums = PHRASINGS.map(([q, u]) => JSON.stringify(summarise(compile(q, u))));
  assertEquals(new Set(sums).size, 1, "equivalent requests → equivalent canonical requirements");
  const or = summarise(compile("Find US companies hiring Account Executives or SDRs.",
    U([R("Account Executives", AE), R("SDRs", SDR)], "US", "hiring Account Executives or SDRs")));
  const sdrOnly = summarise(compile("Find US companies hiring SDRs.", U([R("SDRs", SDR)], "US", "hiring SDRs")));
  for (const other of [or, sdrOnly]) assert(JSON.stringify(other) !== sums[0], JSON.stringify(other));
  assertEquals(or.excluded, []);
});
