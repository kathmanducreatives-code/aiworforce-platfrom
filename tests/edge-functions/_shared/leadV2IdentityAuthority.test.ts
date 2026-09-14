// LEAD V2 RUN 4250f181 — WHY 13 IDENTITY SEARCHES RESOLVED NOTHING, PINNED.
//
// The audited production run discovered real, well-matched companies, searched
// LinkedIn for each, and resolved 0 of 13. Three defects compounded:
//
//   1. the search bought SHORT rows, and short rows carry no `website`;
//   2. the resolver verifies only on a website domain, so a correct name hit
//      could reach `ambiguous` at best;
//   3. the mission's hard US geography lived in `hard_constraints`, which the
//      location helper never read, so every search ran worldwide;
//
// and the diagnostics reported "11 accepted" from a second matcher the resolver
// then overruled. These tests pin the fixes against the run's own rows.
//
// PURE. No network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  acceptLinkedInMatch,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";
import {
  identityIsActionable, resolveIdentityAgainstLookups,
} from "../../../supabase/functions/_shared/companyIdentityResolution.ts";
import {
  buildIdentitySearchInput, identitySearchLocations, missionGeographyIsHard,
  recordMatchDecisions, SEARCH_SCRAPER_MODE,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

/** The run's compiled mission, as far as identity reads it. */
const MISSION = {
  company_profile: { stages: ["startup"], locations: ["United States"], verticals: ["b2b saas"] },
  hard_constraints: {
    stage: { value: "seed-stage", operator: "eq" },
    "company_profile.locations": { value: ["United States"], operator: "in" },
  },
} as never;

/** A YC company, as prequalification holds it. */
const yc = (name: string, domain: string) => ({
  name, canonical_domain: domain, company_key: domain, one_liner: null,
} as never);

/** Rows exactly as SHORT mode returned them in run 4250f181 (no website field). */
const SHORT_ROWS: Record<string, Array<{ name: string; linkedinUrl: string }>> = {
  FurtherAI: [{ name: "FurtherAI", linkedinUrl: "https://www.linkedin.com/company/furtherai/" }],
  Auctor: [
    { name: "Auctor", linkedinUrl: "https://www.linkedin.com/company/getauctor/" },
    { name: "Auctor", linkedinUrl: "https://www.linkedin.com/company/auctorholdings/" },
  ],
  "Fuse AI": [
    { name: "FUSE AI", linkedinUrl: "https://www.linkedin.com/company/fuseaiapp/" },
    { name: "Fuse AI", linkedinUrl: "https://www.linkedin.com/company/fuse-ai-1/" },
    { name: "Fuse AI", linkedinUrl: "https://www.linkedin.com/company/fuseaicom/" },
  ],
  Every: [{ name: "Every Inc.", linkedinUrl: "https://www.linkedin.com/company/everyinc/" }],
};
const DOMAINS: Record<string, string> = {
  FurtherAI: "furtherai.com", Auctor: "getauctor.com", "Fuse AI": "fuseai.com", Every: "every.io",
};

function authoritative(name: string, rows: Array<{ name: string; linkedinUrl: string; website?: string | null }>) {
  const company = yc(name, DOMAINS[name] ?? `${name.toLowerCase()}.com`);
  const decisions = rows.map((r) => acceptLinkedInMatch(company, {
    name: r.name, linkedinUrl: r.linkedinUrl, website: r.website ?? null,
  }));
  const accepted = rows.filter((_, i) => decisions[i].accepted);
  const identity = resolveIdentityAgainstLookups({
    company_key: DOMAINS[name], name, website: `https://${DOMAINS[name]}`,
    canonical_domain: DOMAINS[name], linkedin_company_url: null,
  }, accepted.map((r) => ({ name: r.name, linkedinUrl: r.linkedinUrl, website: r.website ?? null })));
  return { decisions, identity };
}

// ═══ RETRIEVAL ═════════════════════════════════════════════════════════════

Deno.test("the identity search is FULL, named, and carries the mission's hard US geography", () => {
  assertEquals(SEARCH_SCRAPER_MODE, "full");
  assert(missionGeographyIsHard(MISSION), "hard_constraints carries the geography");
  assertEquals(identitySearchLocations(MISSION), ["United States"]);
  const compiled = buildIdentitySearchInput(
    { prequalified: { name: "FurtherAI", canonical_domain: "furtherai.com" } as never }, MISSION);
  assert(compiled.ok, JSON.stringify(compiled));
  const input = (compiled as { input: Record<string, unknown> }).input;
  assertEquals(input.scraperMode, "full", "planned full mode is not overwritten by execution");
  assertEquals(input.locations, ["United States"], "the location filter survives into the provider request");
  assertEquals(input.searchQuery, "FurtherAI", "a name, never the domain");
});

Deno.test("a soft or absent geography still sends no filter", () => {
  assertEquals(identitySearchLocations({ company_profile: { locations: ["United States"] } } as never), []);
  assertEquals(identitySearchLocations({
    company_profile: { locations: [] },
    hard_constraints: { "company_profile.locations": { value: [], operator: "in" } },
  } as never), []);
});

// ═══ ONE AUTHORITY ═════════════════════════════════════════════════════════

Deno.test("run 4250f181's short rows: the matcher and the resolver now agree — unresolved", () => {
  for (const name of Object.keys(SHORT_ROWS)) {
    const { decisions, identity } = authoritative(name, SHORT_ROWS[name]);
    assertEquals(decisions.some((d) => d.accepted), false, `${name}: no website, no identity`);
    assertFalse(identityIsActionable(identity), name);
  }
});

Deno.test("matching name + matching website domain resolves; the same row without a website does not", () => {
  const withSite = authoritative("FurtherAI", [{
    name: "FurtherAI", linkedinUrl: "https://www.linkedin.com/company/furtherai/",
    website: "https://www.furtherai.com/",
  }]);
  assert(withSite.decisions[0].accepted);
  assertEquals(withSite.identity.status, "verified_match");
  assertEquals(withSite.identity.linkedin_company_url, "https://www.linkedin.com/company/furtherai");

  const nameOnly = authoritative("FurtherAI", SHORT_ROWS.FurtherAI);
  assertFalse(nameOnly.decisions[0].accepted, "name-only matching remains insufficient");
  assertFalse(identityIsActionable(nameOnly.identity));
});

Deno.test("Every Inc. is not every.io — the prefix slug that would have attached the wrong company", () => {
  const { decisions, identity } = authoritative("Every", [{
    name: "Every Inc.", linkedinUrl: "https://www.linkedin.com/company/everyinc/",
    website: "https://every.to",
  }]);
  assertEquals(decisions[0].accepted, false);
  assertEquals(decisions[0].code, "domain_mismatch");
  assertFalse(identityIsActionable(identity));
});

Deno.test("two verified-looking candidates are still ambiguous, and the matcher does not overrule it", () => {
  const { decisions, identity } = authoritative("Fuse AI", [
    { name: "Fuse AI", linkedinUrl: "https://www.linkedin.com/company/fuse-ai-1/", website: "https://fuseai.com" },
    { name: "Fuse AI", linkedinUrl: "https://www.linkedin.com/company/fuseaicom/", website: "https://www.fuseai.com" },
  ]);
  assertEquals(decisions.filter((d) => d.accepted).length, 2);
  assertEquals(identity.status, "ambiguous");
  // The diagnostics count the RESOLVER's verdict, not the matcher's.
  const state = {} as never as Parameters<typeof recordMatchDecisions>[0];
  recordMatchDecisions(state, { key: "fuseai.com", company: { company_name: "Fuse AI", canonical_domain: "fuseai.com" } },
    decisions.map((d, rank) => ({
      code: d.code, accepted: d.accepted, candidate_name: "Fuse AI", candidate_slug: "fuseai",
      candidate_domain: "fuseai.com", rank, retrieval_mode: "full",
    })), { authoritativeVerified: identityIsActionable(identity) });
  const d = (state as { identity_match_diagnostics: { companies_accepted: number; companies_rejected: number } })
    .identity_match_diagnostics;
  assertEquals(d.companies_accepted, 0, "accepted may never exceed resolved");
  assertEquals(d.companies_rejected, 1);
});

Deno.test("the engine records diagnostics only after the resolver has spoken", () => {
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  const resolveAt = src.indexOf("c.identity = resolveIdentityAgainstLookups(");
  const recordAt = src.indexOf("recordMatchDecisions(state, c, matchRecord");
  assert(resolveAt > 0 && recordAt > resolveAt, "diagnostics must follow the authoritative verdict");
  assert(src.includes("authoritativeVerified: identityIsActionable(c.identity)"));
});
