// CLAIM-SPECIFIC EVIDENCE AUTHORITY — how strong a normalized fact is FOR A CLAIM.
//
// The rows are real harvestapi company records (fixture run-1e52d43c): Tara AI
// (27 employees, single US headquarters) and Uplane (a Berlin office, a US
// headquarters). The same LinkedIn record proves headcount and presence, and
// proves neither industry nor business model, nor funding, nor an open role.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorityForEvidence, AUTHORITY_RULES,
} from "../../../supabase/functions/_shared/evidenceAuthority.ts";
import {
  observationFromCompany, type EvidenceItem, type ObservationContext,
} from "../../../supabase/functions/_shared/candidateObservation.ts";
import { normalizeLinkedInCompanyEnriched } from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { checkCriterion, evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import type { MissionCriterion } from "../../../supabase/functions/_shared/missionCriteria.ts";

const RUNS = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/lead-v2/run-1e52d43c/apify_runs.json", import.meta.url)));
const rowNamed = (name: string, count?: number): Record<string, unknown> => {
  for (const run of Object.values(RUNS) as Array<{ dataset_items?: Record<string, unknown>[] }>) {
    // The LinkedIn COMPANY record (exact count + structured locations), not the
    // YC directory row of the same name.
    const hit = (run.dataset_items ?? []).find((r) => r.name === name && typeof r.employeeCount === "number" &&
      Array.isArray(r.locations) && typeof r.linkedinUrl === "string" && (count === undefined || r.employeeCount === count));
    if (hit) return structuredClone(hit);
  }
  throw new Error(`fixture row ${name} not found`);
};
const TARA = rowNamed("Tara AI");          // 27 employees, HQ San Jose (US), Software Development
const UPLANE = rowNamed("Uplane", 19);     // Berlin office (not HQ) + San Francisco HQ

const NOW = new Date("2026-09-24T12:00:00.000Z");
const ctx = (actor: string, observed_at = NOW.toISOString()): ObservationContext => ({
  capability: actor === "apify_linkedin_company_details" ? "company_enrichment" : "general_company_discovery",
  actor_key: actor, provider: "apify", route_id: null, plan_version: null,
  provider_call_id: "pc_test", mission_id: "t", observed_at,
});
const DETAILS = "apify_linkedin_company_details";
const SEARCH = "apify_linkedin_company_search";
const itemsFor = (row: Record<string, unknown>, actor = DETAILS, observed?: string) =>
  observationFromCompany(normalizeLinkedInCompanyEnriched(row), ctx(actor, observed)).evidence;
const dim = (items: EvidenceItem[], d: string) => items.find((i) => i.dimension === d)!;
const graphOf = (key: string, items: EvidenceItem[]) => buildCompanyEvidenceGraph(key, items, { now: NOW });
const criterion = (dimension: string, value: unknown, kind: "hard" | "target" = "hard"): MissionCriterion => ({
  id: `${dimension}:x`, kind, dimension, value, label: dimension, source: "user_explicit",
  user_phrase: "", rationale: "", status: "ok",
}) as unknown as MissionCriterion;

// ══════════════════════════════════════════════════════════════ headcount ══

Deno.test("1. a fresh exact employeeCount on the company record PROVES headcount", () => {
  const a = authorityForEvidence({ claim: "headcount", source: DETAILS, field: "employee_count",
    observed_at: NOW.toISOString(), quality: { exact: true }, now: NOW });
  assertEquals([a.authority, a.rule], ["proven", "li_record_exact_headcount"]);
  const h = dim(itemsFor(TARA), "headcount");
  assertEquals([h.value, h.status, h.authority?.rule], [27, "proven", "li_record_exact_headcount"]);
});

Deno.test("2. an employee RANGE alone stays plausible", () => {
  const a = authorityForEvidence({ claim: "headcount", source: DETAILS, field: "employee_count_range",
    observed_at: NOW.toISOString(), quality: { exact: false }, now: NOW });
  assertEquals(a.authority, "plausible");
  // …and a count that is not exact does not prove either.
  assertEquals(authorityForEvidence({ claim: "headcount", source: DETAILS, field: "employee_count",
    observed_at: NOW.toISOString(), quality: { exact: false }, now: NOW }).authority, "plausible");
  // The record's range is never turned into a headcount item at all.
  assert(!itemsFor(TARA).some((i) => i.dimension === "headcount" && typeof i.value === "string"));
});

Deno.test("3. a proven employeeCount deterministically proves the size band (27 → 11–50 PASS, 51–200 FAIL)", () => {
  const g = graphOf("tara", itemsFor(TARA));
  const inBand = checkCriterion(criterion("company_size", { min: 11, max: 50 }), g);
  assertEquals([inBand.result, inBand.reason], ["pass", "headcount 27 is within range"]);
  assertEquals(checkCriterion(criterion("company_size", { min: 51, max: 200 }), g).result, "fail");
  assertEquals(authorityForEvidence({ claim: "company_size", source: DETAILS, field: "employee_count",
    observed_at: NOW.toISOString(), quality: { exact: true }, now: NOW }).authority, "proven");
});

// ══════════════════════════════════════════════════════ country vs HQ ══

Deno.test("4. unambiguous structured locations PROVE country — as presence", () => {
  const geo = dim(itemsFor(TARA), "geography");
  assertEquals([geo.status, geo.authority?.rule], ["proven", "li_record_structured_country"]);
  const g = graphOf("tara", itemsFor(TARA));
  assertEquals(checkCriterion(criterion("geography", "United States"), g).result, "pass");
  assertEquals(checkCriterion(criterion("geography", "Germany"), g).result, "fail", "no office there, stated structurally");
  // Uplane's Berlin office is real presence in Germany, though it is not the HQ.
  assertEquals(checkCriterion(criterion("geography", "Germany"), graphOf("uplane", itemsFor(UPLANE))).result, "pass");
  // Free-text locations with no structured country do not prove.
  const loose = { ...TARA, locations: [{ parsed: { text: "Somewhere, Planet" } }] };
  assertEquals(dim(itemsFor(loose), "geography").status, "plausible");
});

Deno.test("5. multiple company locations do NOT prove headquarters", () => {
  const offices = authorityForEvidence({ claim: "headquarters", source: DETAILS, field: "location_entries",
    observed_at: NOW.toISOString(), quality: { structured_country: true }, now: NOW });
  assertEquals(offices.authority, "insufficient", "an office list says where a company is, not where it is headquartered");
  const noFlag = authorityForEvidence({ claim: "headquarters", source: DETAILS, field: "headquarters_flag",
    observed_at: NOW.toISOString(), quality: { single_headquarters_flag: false }, now: NOW });
  assertEquals(noFlag.authority, "plausible");
  const flagged = authorityForEvidence({ claim: "headquarters", source: DETAILS, field: "headquarters_flag",
    observed_at: NOW.toISOString(), quality: { single_headquarters_flag: true }, now: NOW });
  assertEquals(flagged.authority, "proven", "only the provider's own single HQ flag");
  // The geography item is presence and says so; it is never read as an HQ.
  assert(dim(itemsFor(UPLANE), "geography").authority?.reason.includes("not headquarters"));
});

// ═══════════════════════════════════════════════ industry, business model ══

Deno.test("6. a LinkedIn industry label stays plausible — and cannot pass a hard industry rule", () => {
  const ind = dim(itemsFor(TARA), "industry");
  assertEquals([ind.value, ind.status, ind.authority?.rule], ["Software Development", "plausible", "no_proving_rule"]);
  assertEquals(checkCriterion(criterion("industry", "software development"), graphOf("tara", itemsFor(TARA))).result, "unknown");
});

Deno.test("7. a LinkedIn description / tagline / specialties cannot prove business_model", () => {
  const a = authorityForEvidence({ claim: "business_model", source: DETAILS, field: "profile_text",
    observed_at: NOW.toISOString(), now: NOW });
  assertEquals(a.authority, "plausible");
  assertEquals(authorityForEvidence({ claim: "business_model", source: SEARCH, field: "profile_text",
    observed_at: NOW.toISOString(), now: NOW }).authority, "plausible");
});

Deno.test("8. a grounded website statement can PROVE or DISPROVE business_model; a review cannot", () => {
  const accepted = authorityForEvidence({ claim: "business_model", source: "grounded_evidence_evaluation",
    field: "grounded_statement", observed_at: NOW.toISOString(), quality: { grounding: "accepted" }, now: NOW });
  assertEquals(accepted.authority, "proven");
  assertEquals(authorityForEvidence({ claim: "business_model", source: "grounded_evidence_evaluation",
    field: "grounded_statement", observed_at: NOW.toISOString(), quality: { grounding: "review" }, now: NOW }).authority,
    "plausible");
  const grounded = (value: string): EvidenceItem => ({
    evidence_id: `grd_${value}`, company_key: "c", dimension: "business_model", value, status: "proven",
    source: { provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null, url: "https://c.test", excerpt: null },
    method: "model_extraction", observed_at: NOW.toISOString(), valid_until: null, confidence: "medium",
    derived_from: [], mission_id: "t", origin: "web",
  });
  assertEquals(checkCriterion(criterion("business_model", "b2b saas"), graphOf("c", [grounded("b2b saas")])).result, "pass");
  assertEquals(checkCriterion(criterion("business_model", "b2b saas"), graphOf("c", [grounded("consumer")])).result, "fail");
});

// ═════════════════════════════════════════════════ funding, open role ══

Deno.test("9. company enrichment cannot prove funding_stage; the canonical pair can", () => {
  for (const field of ["funding_record", "profile_text", "employee_count"] as const) {
    assertEquals(authorityForEvidence({ claim: "funding_stage", source: DETAILS, field,
      observed_at: NOW.toISOString(), now: NOW }).authority, "insufficient", field);
  }
  assertEquals(authorityForEvidence({ claim: "funding_stage", source: "funding_corroboration", field: "funding_record",
    observed_at: NOW.toISOString(), now: NOW }).authority, "proven");
});

Deno.test("10. company enrichment cannot prove open_role; job evidence can", () => {
  assertEquals(authorityForEvidence({ claim: "open_role", source: DETAILS, field: "job_posting",
    observed_at: NOW.toISOString(), now: NOW }).authority, "insufficient");
  assertEquals(authorityForEvidence({ claim: "open_role", source: "apify_linkedin_job_search", field: "job_posting",
    observed_at: NOW.toISOString(), now: NOW }).authority, "proven");
});

// ═══════════════════════════════════════════════════ freshness, pending ══

Deno.test("11. stale evidence loses proving authority — by the canonical validity table", () => {
  const old = new Date(NOW.getTime() - 120 * 86_400_000).toISOString(); // headcount validity is 90 days
  const a = authorityForEvidence({ claim: "headcount", source: DETAILS, field: "employee_count",
    observed_at: old, quality: { exact: true }, now: NOW });
  assertEquals([a.authority, a.rule], ["plausible", "li_record_exact_headcount:stale"]);
  // Job evidence (30 days) and funding (365) expire on the same table.
  const jobOld = new Date(NOW.getTime() - 45 * 86_400_000).toISOString();
  assertEquals(authorityForEvidence({ claim: "open_role", source: "apify_linkedin_job_search", field: "job_posting",
    observed_at: jobOld, now: NOW }).authority, "plausible");
  // And a proven item past its valid_until no longer speaks in the graph.
  const h = dim(itemsFor(TARA, DETAILS, old), "headcount");
  const g = buildCompanyEvidenceGraph("tara", [{ ...h, status: "proven" }], { now: NOW });
  const check = checkCriterion(criterion("company_size", { min: 11, max: 50 }), g);
  assertEquals([check.result, check.reason], ["unknown", "the only headcount evidence has expired"]);
});

Deno.test("12. a hard claim resting only on plausible evidence stays PENDING", () => {
  const g = graphOf("tara", itemsFor(TARA));
  const e = evaluateEligibility([
    criterion("geography", "United States"), criterion("company_size", { min: 11, max: 50 }),
    criterion("industry", "software development"),
  ], g);
  assertEquals(e.eligibility, "pending", "industry is only a LinkedIn label");
});

Deno.test("13. a discovery search row alone cannot make a company eligible", () => {
  const items = itemsFor(TARA, SEARCH);
  for (const d of ["geography", "headcount", "industry"]) {
    assertEquals(dim(items, d).status, "plausible", `${d} from a search row`);
  }
  const e = evaluateEligibility([
    criterion("geography", "United States"), criterion("company_size", { min: 11, max: 50 }),
  ], graphOf("tara", items));
  assertEquals(e.eligibility, "pending");
  // No proving rule names a discovery source.
  const discovery = [SEARCH, "apify_linkedin_job_search_discovery", "apify_yc_companies_memo23"];
  assert(!AUTHORITY_RULES.some((r) => r.field !== "job_posting" && r.sources.some((s) => discovery.includes(s))));
});
