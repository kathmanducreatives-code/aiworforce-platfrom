// One qualification engine for every provider: Apollo / LeadOcean rows are
// weighed by the shared authority layer and decided by `evaluateEligibility`,
// exactly as the Apify engine's own candidates are.
//
// Canonical evidence here is produced by the Apify engine's own
// `observationFromCompany` with the company-record actor, so the test feeds
// the shape that engine really emits — not a hand-made imitation of it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { observationFromCompany } from "../../../../supabase/functions/_shared/candidateObservation.ts";
import type { MissionCriterion } from "../../../../supabase/functions/_shared/missionCriteria.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import { verifyLeads } from "../../../../supabase/functions/_shared/discoveryProviders/verify.ts";
import {
  evidenceFromCompany, qualifyCompany, discoverySource,
} from "../../../../supabase/functions/_shared/discoveryProviders/sharedQualification.ts";
import type { ProviderCompany } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";

const NOW = new Date("2026-10-30T12:00:00Z");
const AT = "2026-10-30T11:00:00Z";

const crit = (c: Partial<MissionCriterion> & Pick<MissionCriterion, "id" | "dimension" | "value">): MissionCriterion => ({
  kind: "hard", label: c.id, source: "user_explicit", user_phrase: c.id, rationale: "test", status: "ok", ...c,
} as MissionCriterion);

const CRITERIA: MissionCriterion[] = [
  crit({ id: "geo", dimension: "geography", value: ["United States"], geography_scope: "headquarters" }),
  crit({ id: "size", dimension: "company_size", value: { min: null, max: 100 } }),
];
const MISSION = { original_user_query: "US companies under 100 employees", target_entity: "company", requested_count: 1, criteria: CRITERIA, directives: { disallowed_broadening: [] } };

function loCompany(over: Partial<ProviderCompany> = {}): ProviderCompany {
  return {
    provider: "leadocean", recordId: "lo-co-1", retrievedAt: AT, name: "Acme Robotics", domain: "acmerobotics.example",
    linkedinUrl: "https://www.linkedin.com/company/acme-robotics", hqCountry: "United States", hqRegion: "Ohio",
    hqCity: "Dayton", employeeRange: { min: 11, max: 50 }, industry: ["Industrial Automation"],
    assertedFilters: ["geography_hq", "employee_range"], ...over,
  };
}

/** What the Apify engine's company-record read (by canonical LinkedIn URL) says. */
function companyRecord(o: { hq: string; country: string; band: { min: number; max: number | null }; li?: string; domain?: string }) {
  return observationFromCompany({
    external_source_id: "li_company:42", company_name: "Acme Robotics",
    canonical_domain: o.domain ?? "acmerobotics.example", linkedin_company_url: o.li ?? "https://www.linkedin.com/company/acme-robotics",
    website: `https://${o.domain ?? "acmerobotics.example"}`, description: null, provider_industry: null, industry_ids: [],
    linkedin_associated_member_count: null, company_size_band: { ...o.band, source: "linkedin_declared" }, employee_range_advisory: null,
    geography: o.hq, location_entries: [{ text: o.hq, is_headquarters: true, country: o.country }],
    company_type: null, startup_evidence: null, hiring_status: null, source_provenance: "apify_linkedin_company_details",
    raw_ref: { source_id: "42" },
  } as never, {
    capability: "company_details_enrichment", actor_key: "apify_linkedin_company_details", provider: "apify",
    route_id: "r1", plan_version: 1, provider_call_id: "call-1", mission_id: null, observed_at: AT,
  }).evidence;
}

const run = (rows: ProviderCompany[], canonical: ReturnType<typeof companyRecord> | null = null) =>
  verifyLeads(requirementsFromMission(MISSION as never), mergeRecords(rows, []), [], {
    now: () => NOW, canonicalEvidence: canonical ? () => canonical : undefined,
  });

Deno.test("shared: a provider's discovery row is weighed by the authority layer and proves nothing", () => {
  const merged = mergeRecords([loCompany()], []);
  const items = evidenceFromCompany(merged.companies[0], [], null, NOW);
  const geo = items.find((e) => e.dimension === "geography")!;
  assertEquals(geo.source.actor, discoverySource("leadocean"));
  assertEquals(geo.status, "plausible");
  assertEquals(geo.authority!.rule, "no_proving_rule");
  assertEquals(items.find((e) => e.dimension === "company_size_band")!.status, "plausible");
  // A bare provider count speaks to no size claim the engine can prove.
  assert(items.every((e) => e.status !== "proven" || e.dimension === "identity"));
});

Deno.test("shared: provider-only — passes every provider check, stays needs_verification, pending in the shared engine", () => {
  const [lead] = run([loCompany()]);
  assertEquals(lead.providerStatus, "qualified");
  assertEquals(lead.status, "needs_verification");
  assertEquals(lead.shared!.eligibility, "pending");
  assertEquals(lead.shared!.gaps.sort(), ["company_size_band", "geography"]);
  assertEquals(lead.verification, null);
});

Deno.test("shared: canonical company record proves HQ and size band → qualified on evidence", () => {
  const [lead] = run([loCompany()], companyRecord({ hq: "Dayton, Ohio, United States", country: "United States", band: { min: 11, max: 50 } }));
  assertEquals(lead.shared!.eligibility, "eligible");
  assertEquals(lead.status, "qualified");
  assertEquals(lead.verification, "evidence");
  assert(lead.shared!.checks.every((c) => c.actor === "apify_linkedin_company_details"));
});

Deno.test("shared: a proven disqualification rejects whatever the provider said (basis: proven)", () => {
  const [lead] = run([loCompany()], companyRecord({ hq: "Toronto, Ontario, Canada", country: "Canada", band: { min: 11, max: 50 } }));
  assertEquals(lead.providerStatus, "qualified");
  assertEquals(lead.status, "rejected");
  assertEquals(lead.rejectionBasis, "proven");
  assert(lead.reasons[0].startsWith("geography: disproven"));
});

Deno.test("shared: proof outranks a provider's contradicting report in the other direction too", () => {
  const [lead] = run([loCompany({ hqCountry: "Canada", hqRegion: null, hqCity: null })],
    companyRecord({ hq: "Dayton, Ohio, United States", country: "United States", band: { min: 11, max: 50 } }));
  assertEquals(lead.providerStatus, "rejected");
  assertEquals(lead.status, "qualified");
  assert(lead.reasons[0].includes("recorded, not acted on"));
});

Deno.test("shared: without canonical proof a provider-reported contradiction discards, labelled provider_reported", () => {
  const [lead] = run([loCompany({ hqCountry: "Canada", hqRegion: null, hqCity: null })]);
  assertEquals(lead.status, "rejected");
  assertEquals(lead.rejectionBasis, "provider_reported");
});

Deno.test("shared: canonical evidence for ANOTHER company is refused, never re-keyed onto this one", () => {
  const other = companyRecord({ hq: "Dayton, Ohio, United States", country: "United States", band: { min: 11, max: 50 },
    li: "https://www.linkedin.com/company/someone-else", domain: "someone-else.example" });
  const [lead] = run([loCompany()], other);
  assertEquals(lead.status, "needs_verification");
  assertEquals(lead.shared!.canonical_refused!.count, other.length);
  assertEquals(lead.shared!.evidence_sources.apify_linkedin_company_details, undefined);
});

Deno.test("shared: a platform hold keeps an otherwise eligible company pending", () => {
  const merged = mergeRecords([loCompany()], []);
  const record = companyRecord({ hq: "Dayton, Ohio, United States", country: "United States", band: { min: 11, max: 50 } });
  const q = qualifyCompany(merged.companies[0], [], {
    criteria: CRITERIA, missionId: null, now: NOW, canonicalEvidence: () => record,
    holds: () => [{ code: "verified_fact_rejected", reason: "an existing Lead already covers this company" }],
  });
  assertEquals(q.eligibility, "pending");
  assertEquals(q.held, ["verified_fact_rejected"]);
});

Deno.test("shared: canonical evidence past its validity stops proving (the shared table decides which facts expire)", () => {
  const old = companyRecord({ hq: "Dayton, Ohio, United States", country: "United States", band: { min: 11, max: 50 } })
    .map((e) => ({ ...e, observed_at: "2025-01-01T00:00:00Z", valid_until: e.valid_until ? "2025-04-01T00:00:00Z" : null }));
  const [lead] = run([loCompany()], old);
  assertEquals(lead.status, "needs_verification");
  // Headquarters is durable in the shared validity table; a size band holds for 90 days.
  const by = Object.fromEntries(lead.shared!.checks.map((c) => [c.criterion_id, c]));
  assertEquals([by.geo.result, by.geo.actor], ["pass", "apify_linkedin_company_details"]);
  // The expired band no longer speaks; the fresh provider row is all that is left, and it is not proof.
  assertEquals([by.size.result, by.size.actor], ["unknown", "leadocean_discovery"]);
});

Deno.test("shared: a mission without compiled criteria qualifies nothing (fail closed)", () => {
  const leads = verifyLeads({ ...requirementsFromMission(MISSION as never), criteria: [] }, mergeRecords([loCompany()], []), [], { now: () => NOW });
  assertEquals(leads[0].shared, null);
  assertEquals(leads[0].status, "needs_verification");
});
