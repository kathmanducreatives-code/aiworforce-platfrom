// The evidence contract: each kind of fact apart, with provenance, freshness and
// a status that only the shared engine's canonical evidence can raise.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { observationFromCompany } from "../../../../supabase/functions/_shared/candidateObservation.ts";
import type { MissionCriterion } from "../../../../supabase/functions/_shared/missionCriteria.ts";
import { leadEvidence } from "../../../../supabase/functions/_shared/discoveryProviders/evidenceContract.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { evidenceFromCompany, qualifyCompany } from "../../../../supabase/functions/_shared/discoveryProviders/sharedQualification.ts";
import { verifyLeads } from "../../../../supabase/functions/_shared/discoveryProviders/verify.ts";
import type { ProviderCompany, ProviderPerson } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";

const NOW = new Date("2026-10-30T12:00:00Z");
const AT = "2026-10-30T11:00:00Z";
const crit = (c: Partial<MissionCriterion> & Pick<MissionCriterion, "id" | "dimension" | "value">): MissionCriterion =>
  ({ kind: "hard", label: c.id, source: "user_explicit", user_phrase: c.id, rationale: "t", status: "ok", ...c } as MissionCriterion);
const GEO = crit({ id: "geo", dimension: "geography", value: ["United States"], geography_scope: "headquarters" });
const FUNDED_6M = crit({ id: "funded", dimension: "funding", value: "recently funded",
  time_window: { days: 180, basis: "event_date", source: "user_explicit", enforced: true } as never });

const co = (over: Partial<ProviderCompany> = {}): ProviderCompany => ({
  provider: "leadocean", recordId: "lo-1", retrievedAt: AT, name: "Acme Robotics", domain: "acme.example",
  linkedinUrl: "https://www.linkedin.com/company/acme", hqCountry: "United States", hqRegion: "Ohio", hqCity: "Dayton",
  employeeRange: { min: 51, max: 200 }, industry: ["Software Development"], ...over,
});
const person = (over: Partial<ProviderPerson> = {}): ProviderPerson => ({
  provider: "leadocean", recordId: "lo-p-1", retrievedAt: AT, fullName: "Pat Doe", title: "VP Sales",
  linkedinUrl: "https://www.linkedin.com/in/patdoe", company: co(), employerIsCurrent: true, hasPhone: true,
  contactPoints: [{ kind: "phone", value: "digest:x", type: "mobile", provider: "leadocean", recordId: "lo-p-1", verification: "provider_supplied_unverified", retrievedAt: AT }],
  ...over,
});
const mission = (criteria: MissionCriterion[]) => ({ original_user_query: "q", target_entity: "company", requested_count: 1, criteria, directives: {}, decision_makers: { roles: ["VP Sales"] } });
function record(hq: string, country: string) {
  return observationFromCompany({
    external_source_id: "li_company:1", company_name: "Acme Robotics", canonical_domain: "acme.example",
    linkedin_company_url: "https://www.linkedin.com/company/acme", website: "https://acme.example", description: null,
    provider_industry: null, industry_ids: [], linkedin_associated_member_count: null,
    company_size_band: { min: 51, max: 200, source: "linkedin_declared" }, employee_range_advisory: null,
    geography: hq, location_entries: [{ text: hq, is_headquarters: true, country }], company_type: null,
    startup_evidence: null, hiring_status: null, source_provenance: "x", raw_ref: { source_id: "1" },
  } as never, { capability: "company_details_enrichment", actor_key: "apify_linkedin_company_details", provider: "apify",
    route_id: null, plan_version: null, provider_call_id: "c1", mission_id: null, observed_at: AT }).evidence;
}
const lead = (criteria: MissionCriterion[], rows: ProviderCompany[], people: ProviderPerson[] = [], canonical?: ReturnType<typeof record>) =>
  verifyLeads(requirementsFromMission(mission(criteria) as never), mergeRecords(rows, people), [], { now: () => NOW, canonicalEvidence: canonical ? () => canonical : undefined })[0];

Deno.test("funding: a provider's dated round last month does NOT pass a six-month funding criterion", () => {
  const recent = co({ funding: { lastRoundType: "Series A", lastRoundYear: 2026, roundDate: "2026-09-15", totalUsd: 12_000_000, lastRoundUsd: 12_000_000 } });
  const q = qualifyCompany(mergeRecords([recent], []).companies[0], [], { criteria: [FUNDED_6M], missionId: null, now: NOW });
  const check = q.checks.find((c) => c.criterion_id === "funded")!;
  assertEquals(check.result, "unknown");
  assert(check.reason.includes("not proven"), check.reason);
  // It is weighed as a funding claim and stays below proof.
  const item = evidenceFromCompany(mergeRecords([recent], []).companies[0], [], null, NOW).find((e) => e.dimension === "funding")!;
  assertEquals([item.status, item.authority?.rule, item.occurred_at], ["plausible", "no_proving_rule", "2026-09-15"]);
  assertFalse((item.value as Record<string, unknown>).claim === "funding_record", "never the canonical funding-pair shape");
});

Deno.test("funding: a year is not a date — no occurred_at from a year-only round", () => {
  const c = mergeRecords([co({ funding: { lastRoundType: "Seed", lastRoundYear: 2026, roundDate: null, totalUsd: null, lastRoundUsd: null } })], []).companies[0];
  const item = evidenceFromCompany(c, [], null, NOW).find((e) => e.dimension === "funding")!;
  assertEquals(item.occurred_at, undefined);
});

Deno.test("funding: two providers naming different rounds is a recorded conflict, never averaged", () => {
  const m = mergeRecords([
    co({ funding: { lastRoundType: "Series A", lastRoundYear: 2025, roundDate: null, totalUsd: null, lastRoundUsd: null } }),
    co({ provider: "apollo", recordId: "ap-1", funding: { lastRoundType: "Series B", lastRoundYear: 2025, roundDate: null, totalUsd: null, lastRoundUsd: null } }),
  ], []);
  assertEquals(m.companies[0].conflicts.map((c) => c.field), ["funding"]);
  assertEquals(m.companies[0].funding.length, 2);
});

Deno.test("contract: provider-only facts are provider_reported, each with provider, record, field, time and validity", () => {
  const ev = leadEvidence(lead([GEO], [co()]), ["VP Sales"]);
  assertEquals(ev.company.headquarters.status, "provider_reported");
  assertEquals(ev.company.headquarters.claims[0].value, { country: "United States", region: "Ohio", city: "Dayton" });
  assertEquals(ev.company.headquarters.claims[0].provenance.provider, "leadocean");
  assertEquals(ev.company.headquarters.claims[0].provenance.recordId, "lo-1");
  assertEquals(ev.company.headquarters.claims[0].provenance.validUntil, null, "HQ is durable in the shared table");
  assertEquals(ev.company.employeeRange.claims[0].provenance.validUntil, "2027-01-28T11:00:00.000Z", "a size band holds 90 days");
  assertEquals(ev.company.hiring.status, "unknown", "no provider here returns dated postings");
  assertEquals(ev.qualification.eligibility, "pending");
});

Deno.test("contract: only canonical evidence verifies — and it can contradict", () => {
  const ok = leadEvidence(lead([GEO], [co()], [], record("Dayton, Ohio, United States", "United States")), []);
  assertEquals(ok.company.headquarters.status, "independently_verified");
  assertEquals(ok.company.headquarters.verifiedBy!.actor, "apify_linkedin_company_details");
  const no = leadEvidence(lead([GEO], [co()], [], record("Toronto, Ontario, Canada", "Canada")), []);
  assertEquals(no.company.headquarters.status, "contradicted");
});

Deno.test("contract: employment, decision-maker and contacts are the provider's word — and carry no contact values", () => {
  const l = lead([GEO], [co()], [person()]);
  const ev = leadEvidence(l, ["VP Sales"]);
  const p = ev.people[0];
  assertEquals(p.employment.status, "provider_reported");
  assertEquals(p.employment.claims[0].value.current, true);
  assertEquals(p.employment.claims[0].value.title, "VP Sales");
  assertEquals([p.decisionMaker.matched, p.decisionMaker.status], [true, "provider_reported"]);
  assertEquals(p.contact.phone, { available: true, verification: ["provider_supplied_unverified"], independentlyVerifiedDirect: false });
  assertFalse(JSON.stringify(ev).includes("digest:x"), "no contact value in the evidence record");
});
