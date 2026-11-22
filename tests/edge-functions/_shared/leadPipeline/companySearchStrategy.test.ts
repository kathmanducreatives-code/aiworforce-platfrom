// COMPANY-FIRST DISCOVERY UNDER V4 (2026-11-20): V2's company search, reused — never a
// second engine. These pin the safety properties the owner asked for:
//   · OFF by default: no flag, no company search (the request is refused as before)
//   · a hiring signal still discovers by job search, flag or not
//   · REQUIRED filters only: a preference never narrows the search
//   · never a concept in the company-NAME index (no searchQuery, ever)
//   · a REQUIRED industry with no reviewed code is refused, never searched wider
//   · REQUIRED requirements survive into the plan; industry stays unverifiable (review-only)
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { chainFor, companySearchInput, planStrategy, specFromMission, type StrategyContext } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { COMPANY_SEARCH_ACTOR, PIPELINE_ACTORS } from "../../../../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";

const US = { span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" };
async function spec(query: string, u: Record<string, unknown>, size: unknown = null) {
  const { contract } = contractFromProposal(query, {
    understanding: { roles: [], role_match: "any", places: [US], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...u },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: size, funding_stages: [], forbid_broadening: [],
  } as never);
  return specFromMission(await compileContract(contract) as never, { defaultCount: 5 });
}
const ctx = (companySearch: boolean, allowReviewOnly = true): StrategyContext => ({
  providers: { apify: { enabled: true, connected: true, authorized: true } },
  budget: { maxLeadoceanRecords: 50, maxApifyUsd: 0.25 }, user: { allowReviewOnly }, companySearch,
});
const MFG = { industries: [{ span: "manufacturers", industry: "manufacturing", necessity: "required" }] };
const REQ_SIZE = { min: 20, max: 200, necessity: "required", span: "20–200 employees" };

Deno.test("the Actor is priced from Apify's live card: $0.001 start + $0.002 per short-mode company", () => {
  assertEquals(PIPELINE_ACTORS[COMPANY_SEARCH_ACTOR.key], { actorId: "harvestapi/linkedin-company-search", perItemUsd: 0.002, perStartUsd: 0.001, emptyUsd: 0 });
});

Deno.test("OFF by default: without the flag a company-first request is refused exactly as before", async () => {
  const s = await spec("Find 5 US manufacturers with 20–200 employees.", MFG, REQ_SIZE);
  assertEquals(chainFor("apify_only", s)[0], "apify.linkedin_job_search");
  const p = planStrategy(s, ctx(false));
  assertEquals(p.status, "blocked");
  assert(p.candidates.some((c) => c.refusals.some((r) => r.includes("names none"))));
});

Deno.test("ON: company search seeds the chain, prices the run and keeps every REQUIRED requirement", async () => {
  const s = await spec("Find 5 US manufacturers with 20–200 employees.", MFG, REQ_SIZE);
  const p = planStrategy(s, ctx(true));
  assertEquals(p.status, "ready");
  assertEquals(p.steps.map((x) => x.capability), ["apify.linkedin_company_search", "apify.linkedin_company_record"]);
  assertEquals(p.steps[0].estimate.apifyUsd, 0.021); // 10 short-mode companies + start
  // The REQUIRED requirements are all still hard in the spec the engine judges by:
  assertEquals(s.geography.length, 1); assertEquals(s.industry, ["manufacturing"]); assertEquals(s.employees, { min: 20, max: 200 });
});

Deno.test("…and without review-only it is refused: industry is never verified by a taxonomy label", async () => {
  const s = await spec("Find 5 US manufacturers with 20–200 employees.", MFG, REQ_SIZE);
  const p = planStrategy(s, ctx(true, false));
  assertEquals(p.status, "blocked");
  assert(p.candidates.some((c) => c.refusals.some((r) => r.includes("no lead could become qualified"))));
});

Deno.test("a hiring signal still discovers by job search, with the flag on", async () => {
  const s = await spec("Find 5 US manufacturers hiring Account Executives.", {
    ...MFG, roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }],
    signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
  });
  assertEquals(chainFor("apify_only", s, { companySearch: true })[0], "apify.linkedin_job_search");
});

Deno.test("REQUIRED filters only: a PREFERRED size never narrows the search", async () => {
  const preferred = await spec("Find 5 US manufacturers, ideally 20–200 employees.", MFG, { ...REQ_SIZE, necessity: "preferred", span: "ideally 20–200 employees" });
  assertFalse("companySize" in companySearchInput(preferred, 10).input);
  const required = await spec("Find 5 US manufacturers with 20–200 employees.", MFG, REQ_SIZE);
  assertEquals(companySearchInput(required, 10).input.companySize, ["11-50", "51-200"]);
});

Deno.test("never a concept in the company-NAME index, and several industries widen only to their own codes", async () => {
  const s = await spec("Find 5 US commercial contractors, industrial distributors or manufacturers.", {
    industries: [
      { span: "commercial contractors", industry: "commercial contracting", necessity: "required" },
      { span: "industrial distributors", industry: "industrial distribution", necessity: "required" },
      { span: "manufacturers", industry: "manufacturing", necessity: "required" },
    ],
  });
  const cs = companySearchInput(s, 10);
  assertFalse("searchQuery" in cs.input);
  assertEquals(cs.input.industryIds, ["48", "413", "435", "1187", "49", "1178", "25"]);
  assert(cs.compiled.ok);
});

Deno.test("a REQUIRED industry with no reviewed code is refused by name — never searched wider", async () => {
  const s = await spec("Find 5 US craft breweries.", { industries: [{ span: "craft breweries", industry: "craft brewing", necessity: "required" }] });
  const p = planStrategy(s, ctx(true));
  assertEquals(p.status, "blocked");
  assert(p.candidates.some((c) => c.refusals.some((r) => r.includes('cannot narrow by industry "craft brewing"'))));
});
