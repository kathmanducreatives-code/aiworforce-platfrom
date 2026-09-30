// CANARY 1 REGRESSIONS — production, 2026-09-30.
//
// Three release defects surfaced by the first production canary (Wordware):
//
//   1. "Qualify https://www.linkedin.com/company/wordware. It must…" was refused
//      at compile (`url:known_companies[0]`): the user's slug was read as
//      `wordware.`, so the model's correct `…/company/wordware` did not match.
//   2. LinkedIn redirects /company/wordware to /company/saunabywordware. The
//      company-details Actor returned the redirected url, the record was mapped
//      back by that url alone, attached to nobody, and the company stayed
//      `empty` — so qualification never reached it and no verifier ran.
//   3. An answered-but-empty enrichment was never counted as a TRIED route, so
//      the size gap stayed "cheap, not yet tried" forever: the funding verifier
//      waited on it while the continuation gate counted the company as
//      verifiable — three barren slices to `search_exhausted`.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scanProposalForViolations } from "../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  missionCandidatesFrom, requestedCompanyUrlOf, runCapabilityPlan,
} from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";
import type { LeadMissionV1 } from "../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../supabase/functions/_shared/hiringActorInputs.ts";

// ── 1. THE USER'S SLUG ENDS WHERE THE SENTENCE DOES ─────────────────────────

const URL = "https://www.linkedin.com/company/wordware";

Deno.test("1a. a LinkedIn url followed by a period is the user's own url", () => {
  const said = `Qualify ${URL}. It must have raised Seed funding within the last 2 years.`;
  assertEquals(scanProposalForViolations({ known_companies: [URL] }, said), []);
});

Deno.test("1b. …and by a comma, semicolon or closing punctuation", () => {
  for (const tail of [",", ";", ":", "!", "?"]) {
    const said = `Qualify ${URL}${tail} it must have raised Seed funding.`;
    assertEquals(scanProposalForViolations({ known_companies: [URL] }, said), [],
      `a url followed by "${tail}" must still be recognised`);
  }
});

Deno.test("1c. the model still cannot introduce a company the user never typed", () => {
  const said = `Qualify ${URL}. It must have raised Seed funding.`;
  const v = scanProposalForViolations(
    { known_companies: ["https://www.linkedin.com/company/someoneelse"] }, said);
  assertEquals(v.map((x) => `${x.path}:${x.kind}`), ["known_companies[0]:url"]);
});

// ── 2 & 3. THE ENGINE ───────────────────────────────────────────────────────

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(
    "Find B2B SaaS companies in the United Kingdom hiring sales representatives. Return 5 qualified leads.");
  return {
    ...m, requested_count: 5,
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
};
const BRAIN = {
  employee_min: 20, employee_max: 200,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
} as never;

const searchRow = (i: number) => ({
  companyName: `Co${i}`,
  linkedinUrl: `https://www.linkedin.com/company/co-${i}`,
  website: `https://co-${i}.com`,
  employeeCount: 60,
  description: `Co${i} is a B2B SaaS platform sold on subscription.`,
});

type Details = (asked: string[]) => Record<string, unknown>[];

const run = async (details: Details) => {
  const asked: string[][] = [];
  const result = await runCapabilityPlan({
    invoke: (call: CompiledActorCall<unknown>) => {
      const input = (call as unknown as { input: Record<string, unknown> }).input ?? {};
      if (call.actorKey === "apify_linkedin_company_details") {
        const urls = (input.companies as string[] ?? []);
        asked.push(urls);
        return Promise.resolve(details(urls));
      }
      return Promise.resolve(Array.from({ length: 4 }, (_, i) => searchRow(i)) as Record<string, unknown>[]);
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "pass" }),
    planDiscovery: () => Promise.resolve([{
      actor_key: "apify_linkedin_company_search", role: "primary",
      input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
    }]),
  } as never, {
    mission: mission(), plan: buildCapabilityGraph(mission() as never),
    brain: BRAIN, maxCandidates: 50, remainingLeads: 5, readEnv: () => undefined,
  } as never);
  const companies = (result as unknown as {
    companies: Array<{ key: string; enriched: unknown; enrichment_outcome: string }>;
  }).companies;
  return { asked: asked.flat(), companies, result };
};

Deno.test("2a. a redirected company page is attached by the url it was asked for", async () => {
  // The Actor answers with the page LinkedIn redirected to, and echoes the url
  // it was asked for — exactly the production Wordware row.
  const { asked, companies } = await run((urls) => urls.map((u, i) => ({
    name: `Rebranded ${i}`, linkedinUrl: `${u}-rebranded/`, website: `https://co-${i}.com`,
    employeeCount: 54, description: "A B2B SaaS platform sold on subscription.",
    originalQuery: { search: u, location: "" },
  })));
  assert(asked.length > 0, "the test is vacuous unless enrichment was asked for someone");
  const sent = companies.filter((c) => c.enrichment_outcome !== "not_attempted");
  assert(sent.length > 0, "somebody must have been sent for enrichment");
  for (const c of sent) {
    assertEquals(c.enrichment_outcome, "success", `${c.key} must be enriched through the redirect`);
    assert(c.enriched, `${c.key} must carry the enriched record`);
  }
});

Deno.test("2b. a row asked for a url OUTSIDE the batch attaches to nobody", async () => {
  // Provenance, not a guess: an echo that names a url we did not send in this
  // batch must never pull a record onto one of our companies.
  const { asked, companies } = await run((urls) => urls.map((_u, i) => ({
    name: `Stranger ${i}`, linkedinUrl: `https://www.linkedin.com/company/stranger-${i}/`,
    employeeCount: 54, originalQuery: { search: `https://www.linkedin.com/company/not-asked-${i}` },
  })));
  assert(asked.length > 0, "the test is vacuous unless enrichment was asked for someone");
  for (const c of companies.filter((x) => x.enrichment_outcome !== "not_attempted")) {
    assertEquals(c.enrichment_outcome, "empty", `${c.key} must not adopt a record it never asked for`);
    assertEquals(c.enriched ?? null, null);
  }
});

Deno.test("2c. requestedCompanyUrlOf reads only the echoed request, canonically", () => {
  assertEquals(requestedCompanyUrlOf({ originalQuery: { search: "https://linkedin.com/company/WordWare/" } }),
    "https://www.linkedin.com/company/wordware");
  assertEquals(requestedCompanyUrlOf({ originalQuery: "https://www.linkedin.com/company/x" }),
    "https://www.linkedin.com/company/x");
  assertEquals(requestedCompanyUrlOf({ originalQuery: { search: "wordware" } }), null);
  assertEquals(requestedCompanyUrlOf({}), null);
});

Deno.test("3. an answered-but-empty enrichment is a TRIED route", async () => {
  const { result } = await run(() => []);
  const candidates = missionCandidatesFrom(result as never, { missionId: "t" });
  const emptied = (result as unknown as { companies: Array<{ key: string; enrichment_outcome: string }> })
    .companies.filter((c) => c.enrichment_outcome === "empty").map((c) => c.key);
  assert(emptied.length > 0, "the test is vacuous unless some enrichment came back empty");
  for (const c of candidates.filter((x) => emptied.includes(x.company_key))) {
    assert((c.attempted_routes ?? []).includes("apify_linkedin_company_details"),
      `${c.company_key}: enrichment answered, so its route has been tried`);
  }
  for (const c of candidates.filter((x) => !emptied.includes(x.company_key))) {
    const co = (result as unknown as { companies: Array<{ key: string; enrichment_outcome: string }> })
      .companies.find((k) => k.key === c.company_key)!;
    if (co.enrichment_outcome === "not_attempted") {
      assert(!(c.attempted_routes ?? []).includes("apify_linkedin_company_details"),
        `${c.company_key}: never asked, so never tried`);
    }
  }
});
