// THE INVARIANT THE WHOLE PROVIDER LAYER RESTS ON, CHECKED EXHAUSTIVELY:
// a provider's discovery row — Apollo, LeadOcean or Apify's own site checks —
// can never PROVE a fact, and so can never on its own satisfy a hard
// requirement in the shared engine (`evaluateEligibility`). Only canonical
// evidence (the company record, the funding pair, dated postings) can.
//
// A future AUTHORITY_RULES entry naming a discovery source fails here until it
// is reviewed and this test is changed with it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AUTHORITY_RULES } from "../../../../supabase/functions/_shared/evidenceAuthority.ts";
import type { MissionCriterion } from "../../../../supabase/functions/_shared/missionCriteria.ts";
import { mergeRecords } from "../../../../supabase/functions/_shared/discoveryProviders/normalize.ts";
import {
  discoverySource, evidenceFromCompany, qualifyCompany, SITE_CHECK_SOURCE,
} from "../../../../supabase/functions/_shared/discoveryProviders/sharedQualification.ts";
import type { ProviderCompany, ProviderId } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";

const NOW = new Date("2026-10-30T12:00:00Z");
const AT = "2026-10-30T11:00:00Z";
const PROVIDERS: ProviderId[] = ["apollo", "leadocean", "apify"];

/** Every field a provider row can carry, all populated, all "matching" the criteria below. */
const full = (provider: ProviderId): ProviderCompany => ({
  provider, recordId: `${provider}-1`, retrievedAt: AT, providerUpdatedAt: AT, name: "Acme Robotics",
  domain: "acmerobotics.example", linkedinUrl: "https://www.linkedin.com/company/acme-robotics",
  industry: ["Industrial Automation"], naicsSector: "33", naicsPrimary: "333922", keywords: ["robotics"],
  hqCountry: "United States", hqRegion: "Ohio", hqCity: "Dayton", employeeCount: 40, employeeRange: { min: 11, max: 50 },
  foundedYear: 2019,
  funding: { lastRoundType: "Series A", lastRoundYear: 2026, roundDate: "2026-09-15", totalUsd: 15_000_000, lastRoundUsd: 12_000_000 },
  assertedFilters: ["geography_hq", "employee_range", "industry"],
});
const SITE = [
  { domain: "acmerobotics.example", kind: "open_roles" as const, url: "https://acmerobotics.example/careers", text: null, count: 4, at: AT, runId: "r1" },
  { domain: "acmerobotics.example", kind: "site_text" as const, url: "https://acmerobotics.example", text: "We sell robots to factories.", at: AT, runId: "r2" },
];

const crit = (c: Partial<MissionCriterion> & Pick<MissionCriterion, "id" | "dimension" | "value">): MissionCriterion => ({
  kind: "hard", label: c.id, source: "user_explicit", user_phrase: c.id, rationale: "test", status: "ok", ...c,
} as MissionCriterion);
const EVERY_HARD: MissionCriterion[] = [
  crit({ id: "geo", dimension: "geography", value: ["United States"], geography_scope: "headquarters" }),
  crit({ id: "size", dimension: "company_size", value: { min: 11, max: 50 } }),
  crit({ id: "industry", dimension: "industry", value: "Industrial Automation" }),
  crit({ id: "funding", dimension: "funding", value: { event: "funding" }, time_window: { days: 180 } as never }),
  crit({ id: "hiring", dimension: "hiring", value: { event: "hiring" }, time_window: { days: 30 } as never }),
];

Deno.test("no authority rule names a discovery source — so no provider row can be weighed above plausible", () => {
  const discovery = [...PROVIDERS.map(discoverySource), SITE_CHECK_SOURCE];
  for (const r of AUTHORITY_RULES) {
    for (const s of discovery) assert(!r.sources.includes(s), `${r.id} names ${s}: review before allowing a provider to prove a fact`);
  }
});

for (const p of PROVIDERS) {
  Deno.test(`${p}: a fully populated row yields no PROVEN fact except identity`, () => {
    const merged = mergeRecords([full(p)], []);
    const items = evidenceFromCompany(merged.companies[0], p === "apify" ? SITE : [], null, NOW);
    assert(items.length >= 5, `${items.length} items`);
    assert(items.some((e) => e.dimension === "funding" && e.occurred_at === "2026-09-15"), "the dated round is present — and still not proof");
    const proven = items.filter((e) => e.status === "proven").map((e) => e.dimension);
    assertEquals([...new Set(proven)], ["identity"]);
  });

  Deno.test(`${p}: provider-only evidence never makes a company ELIGIBLE, for any hard dimension`, () => {
    const merged = mergeRecords([full(p)], []);
    for (const c of EVERY_HARD) {
      const q = qualifyCompany(merged.companies[0], p === "apify" ? SITE : [], { criteria: [c], missionId: null, now: NOW });
      assert(q.eligibility !== "eligible", `${c.dimension}: ${q.eligibility} — ${JSON.stringify(q.checks)}`);
    }
  });
}
