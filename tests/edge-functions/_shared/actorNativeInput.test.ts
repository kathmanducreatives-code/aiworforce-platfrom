// EXACT actor-native contract tests. Proves what leaves Agentory for
// curious_coder/linkedin-jobs-scraper and harvestapi/linkedin-profile-search.
// ZERO network (run without --allow-net).

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import {
  buildCuriousCoderLinkedInJobsInput, buildLinkedInJobsSearchUrls, buildLinkedInJobsSearchUrl,
  describeJobsNativeInput, CURIOUS_CODER_JOBS_ADAPTER_VERSION,
} from "../../../supabase/functions/_shared/curiousCoderJobsInput.ts";
import { buildProviderEnvelope, nativePayloadIsClean, WRAPPER_ONLY_KEYS } from "../../../supabase/functions/_shared/providerEvidenceMode.ts";
import { buildScopedPeopleInput } from "../../../supabase/functions/_shared/runAgentCompoundPeopleAdapter.ts";
import { buildHarvestApiPeopleInput } from "../../../supabase/functions/_shared/harvestApiPeople.ts";
import { buildPeopleScope } from "../../../supabase/functions/_shared/scopedPeopleSearch.ts";
import { resolveCompanyIdentity } from "../../../supabase/functions/_shared/companyIdentity.ts";
import { ACTOR_REGISTRY, getActorByKey } from "../../../supabase/functions/_shared/actorRegistry.ts";
import { runAgentCompoundExecution } from "../../../supabase/functions/_shared/runAgentCompoundExecution.ts";

const SAAS = "Founders of SaaS startups hiring Sales Operations in the United States";
const intent = compileLeadEntityIntent(SAAS);
const spec = intent.job_search_spec;

const jobsNative = () =>
  buildCuriousCoderLinkedInJobsInput({ urls: buildLinkedInJobsSearchUrls(spec.keyword_queries, spec.location), maxResults: 25 });

// ============================ LinkedIn Jobs =================================
Deno.test("1. the SaaS regression compiles to three role-focused keyword variants", () => {
  assertEquals(spec.keyword_queries, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
});
Deno.test("2/3/4/5. native payload = urls + count + scrapeCompany + explicit defaults", () => {
  const n = jobsNative();
  assert(Array.isArray(n.urls) && n.urls.length === 3);
  assertEquals(n.count, 25);
  assertEquals(n.scrapeCompany, true);
  assertEquals(n.useIncognitoMode, false);
  assertEquals(n.splitByLocation, false);
});
Deno.test("6/7/8/9. native payload carries NO Agentory wrapper fields", () => {
  const n = jobsNative() as unknown as Record<string, unknown>;
  for (const k of ["query", "keywords", "max_results", "defer_persistence", "location", "role_keywords", "selected_actor_key"]) {
    assertFalse(k in n, `native payload leaked wrapper field: ${k}`);
  }
  assert(nativePayloadIsClean(n));
});
Deno.test("10/11/12. every URL is a valid LinkedIn Jobs search URL with decoded keywords + location", () => {
  const n = jobsNative();
  const decoded = n.urls.map((u) => new URL(u));
  for (const u of decoded) {
    assertEquals(u.origin + u.pathname, "https://www.linkedin.com/jobs/search/");
    assertEquals(u.searchParams.get("location"), "United States");
  }
  assertEquals(decoded.map((u) => u.searchParams.get("keywords")), ["Sales Operations", "Revenue Operations", "GTM Operations"]);
});
Deno.test("13/14/15. no URL carries the original sentence, 'Founders of', or SaaS as a job title", () => {
  for (const u of jobsNative().urls) {
    const kw = (new URL(u).searchParams.get("keywords") ?? "").toLowerCase();
    assertFalse(kw.includes("founders of"));
    assertFalse(kw.includes("saas"));
    assertFalse(kw.includes("startups"));
    assert(kw.length < 40);
    assertFalse(decodeURIComponent(u).toLowerCase().includes(SAAS.toLowerCase()));
  }
});
Deno.test("16. ONE shared count spans all three URLs (not 3 x 25)", () => {
  const n = jobsNative();
  assertEquals(n.count, 25);
  assertEquals(n.urls.length, 3);
  // Actor minimum is honoured without inflating the ceiling per URL.
  assertEquals(buildCuriousCoderLinkedInJobsInput({ urls: n.urls, maxResults: 3 }).count, 10);
});
Deno.test("URL values are encoded, never concatenated", () => {
  const u = new URL(buildLinkedInJobsSearchUrl("R&D Ops / GTM", "New York, NY"));
  assertEquals(u.searchParams.get("keywords"), "R&D Ops / GTM");
  assertEquals(u.searchParams.get("location"), "New York, NY");
});

// ============================== Harvest =====================================
const scope = buildPeopleScope(
  resolveCompanyIdentity({ name: "BigID", linkedin_url: "linkedin.com/company/bigid" }),
  { requestedRole: "founder", queryIntent: SAAS, location: "United States" },
)!;
const peopleNative = () => {
  const env = buildProviderEnvelope("apify_people_search", buildScopedPeopleInput(scope, 2, spec.requested_person_roles), 2);
  return buildHarvestApiPeopleInput({ query: null, location: null, role_keywords: null, max_results: env.max_results, user_input: env.input });
};

Deno.test("18/19/20/21/22. Harvest native input is company-scoped and bounded", () => {
  const n = peopleNative();
  assertEquals(n.currentCompanies, ["https://www.linkedin.com/company/bigid"]);
  assertEquals(n.currentJobTitles, ["Founder", "Co-Founder", "CEO"]);
  assertEquals(n.searchQuery, "Founder OR Co-Founder OR CEO");
  assertEquals(n.maxItems, 2);
  assertEquals(n.profileScraperMode, "Full");
});
Deno.test("23/24. a domain or plain company name is never used as currentCompanies", () => {
  const n = buildHarvestApiPeopleInput({
    query: null, location: null, role_keywords: null, max_results: 2,
    user_input: { currentCompanies: ["bigid.com", "BigID"] },
  });
  assertEquals(n.currentCompanies, undefined); // non-URL company filters are dropped
});
Deno.test("25/26. the compound sentence is not searchQuery and no wrapper field leaks", () => {
  const n = peopleNative() as Record<string, unknown>;
  assertFalse(String(n.searchQuery).toLowerCase().includes("founders of"));
  assertFalse(String(n.searchQuery).toLowerCase().includes("saas"));
  for (const k of WRAPPER_ONLY_KEYS) assertFalse(k in n, `Harvest native leaked ${k}`);
  assertFalse("max_results" in n);
  assertFalse("role_keywords" in n);
  for (const k of Object.keys(n)) assertFalse(k.startsWith("_scope_"), `provenance key leaked: ${k}`);
});
Deno.test("27. a company with no verified LinkedIn URL yields NO scope (never an unscoped lookup)", () => {
  const nameOnly = buildPeopleScope(resolveCompanyIdentity({ name: "Unknown Co" }), { requestedRole: "founder", queryIntent: SAAS });
  assertEquals(nameOnly, null);
});

// ============================== Registry ====================================
Deno.test("28/29. each actor key maps to its own actor id", () => {
  assertEquals(getActorByKey("apify_jobs")?.actor_id, "curious_coder/linkedin-jobs-scraper");
  assertEquals(getActorByKey("apify_people_search")?.actor_id, "harvestapi/linkedin-profile-search");
});
Deno.test("30. jobs and people do NOT share a serializer", () => {
  const j = jobsNative() as unknown as Record<string, unknown>;
  const p = peopleNative();
  assert("urls" in j && !("urls" in p));
  assert("profileScraperMode" in p && !("profileScraperMode" in j));
  assert("count" in j && !("count" in p));
  assert("maxItems" in p && !("maxItems" in j));
});
Deno.test("31. an unknown actor key resolves to nothing (fails explicitly)", () => {
  assertEquals(getActorByKey("apify_not_a_real_actor"), null);
  assertEquals(getActorByKey(null), null);
  assert(Object.keys(ACTOR_REGISTRY).includes("apify_jobs"));
});
Deno.test("33. observability reports actor/adapter/url metadata without secrets", () => {
  const d = describeJobsNativeInput(jobsNative(), "curious_coder/linkedin-jobs-scraper", "defer_persistence");
  assertEquals(d.adapter_version, CURIOUS_CODER_JOBS_ADAPTER_VERSION);
  assertEquals(d.url_count, 3);
  assertEquals(d.keywords, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(d.location, "United States");
  assertEquals(d.persistence_mode, "defer_persistence");
  const blob = JSON.stringify(d);
  assertFalse(/apify_api_|eyJ|Bearer /i.test(blob));
});

// ===================== 32/34 end-to-end, zero DB writes =====================
Deno.test("32/34. full chain: spec -> native urls -> mocked provider -> qualified persist, ZERO provider-side writes", async () => {
  const dbWrites: string[] = [];
  const persisted: string[] = [];
  let jobsEnvelope: Record<string, unknown> | null = null;
  let peopleEnvelope: Record<string, unknown> | null = null;

  /** Stands in for runTool: writes leads unless defer_persistence is set. */
  const runToolLike = (envelope: Record<string, unknown>, items: unknown[]) => {
    if (envelope.defer_persistence !== true) items.forEach(() => dbWrites.push("accounts+lead_candidates.insert"));
    return items;
  };

  const res = await runAgentCompoundExecution(intent, {
    invokeJobs: async (env) => {
      jobsEnvelope = env;
      return runToolLike(env, [
        { title: "Customer Service Representative - Remote", companyName: "Sundayy", companyWebsite: "https://sundayy.com", location: "United States", jobUrl: "https://j/junk", companyDescription: "job discovery", id: "x1" },
        { title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com", companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States", jobUrl: "https://j/bigid", descriptionText: "US revenue operations", companyDescription: "B2B SaaS platform", id: "j1" },
      ]);
    },
    invokePeople: async (env) => {
      peopleEnvelope = env;
      return runToolLike(env, [{
        fullName: "Dimitri Sirota", headline: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/d",
        experience: [{ companyName: "BigID", companyUrl: "https://linkedin.com/company/bigid", companyDomain: "bigid.com", title: "Co-Founder & CEO", current: true }],
      }]);
    },
    persist: async (plan) => { persisted.push(`${plan.account?.name}:${plan.verdict}`); return { ok: true, accountId: "acc-1", contactId: null, leadCandidateId: "lc-1" }; },
  }, { now: "2026-07-25T00:00:00Z", workspaceId: "ws-1" });

  // exact jobs payload
  const jn = (jobsEnvelope!.input) as Record<string, unknown>;
  assertEquals((jn.urls as string[]).length, 3);
  assertEquals(jn.count, 25);
  assertEquals(jobsEnvelope!.defer_persistence, true);
  assertEquals(jobsEnvelope!.max_results, 25);   // TOP level, where runTool reads it

  // exact Harvest payload
  const pn = buildHarvestApiPeopleInput({
    query: null, location: null, role_keywords: null,
    max_results: peopleEnvelope!.max_results as number,
    user_input: peopleEnvelope!.input as Record<string, unknown>,
  });
  assertEquals(pn.currentCompanies, ["https://www.linkedin.com/company/bigid"]);
  assertEquals(peopleEnvelope!.defer_persistence, true);

  // boundary + outcome
  assertEquals(dbWrites.length, 0);
  assertEquals(res.writeBoundary.providerSideWrites, 0);
  assertEquals(res.writeBoundary.invariantViolation, null);
  assertFalse(persisted.some((p) => p.startsWith("Sundayy")));   // junk never persisted
  assert(persisted.some((p) => p.startsWith("BigID")));

  // the raw sentence reached NEITHER native input
  const both = JSON.stringify([jn, pn]).toLowerCase();
  assertFalse(both.includes("founders of"));
  assertFalse(both.includes(SAAS.toLowerCase()));
});

Deno.test("17. duplicate jobs across keyword URLs deduplicate to one company", async () => {
  const dup = (id: string) => ({ title: "Sales Operations Manager", companyName: "BigID", companyWebsite: "https://bigid.com", companyLinkedinUrl: "https://linkedin.com/company/bigid", location: "New York, United States", jobUrl: "https://j/bigid", descriptionText: "revenue operations", companyDescription: "B2B SaaS platform", id });
  const res = await runAgentCompoundExecution(intent, {
    invokeJobs: async () => [dup("a"), dup("b"), dup("c")],  // same job URL from 3 variants
    invokePeople: async () => [],
    persist: async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }),
  }, { now: "2026-07-25T00:00:00Z", workspaceId: "ws-1" });
  assertEquals(res.run?.diagnostics.verifiedCompanies, 1);
});
