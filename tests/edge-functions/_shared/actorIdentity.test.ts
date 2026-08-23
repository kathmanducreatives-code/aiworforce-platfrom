// WHY THIS FILE EXISTS.
//
// The repo named every Actor twice — `apify_yc_companies_memo23` for the
// capability graph, `memo23/y-combinator-scraper` for the Store — and nothing
// joined them. Two names for one thing meant a scenario and a capability could
// reference the same Actor and never be comparable, so a planner could satisfy
// one authority while violating the other.
//
// That defect reproduced itself DURING this work: the moment the scenario matrix
// moved to Store ids, `signalsUnservedByStrategy` began comparing Store ids
// against repo keys and reported every signal as unserved, including ones the
// run was actually serving. These tests pin the resolver that ends it.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  describedButNotExecutable, executableRepoKeys, executableWithoutIntelligence,
  identityDrift, identityTable, isStoreId, resolveActor, sameActor,
  toRepoKey, toStoreId,
} from "../../../supabase/functions/_shared/actorIdentity.ts";

Deno.test("1. the two vocabularies resolve to one identity", () => {
  assertEquals(toStoreId("apify_yc_companies_memo23"), "memo23/y-combinator-scraper");
  assertEquals(toRepoKey("memo23/y-combinator-scraper"), "apify_yc_companies_memo23");
  assert(sameActor("apify_yc_companies_memo23", "memo23/y-combinator-scraper"));
  assert(!sameActor("apify_yc_companies_memo23", "harvestapi/linkedin-company-search"));
});

Deno.test("2. resolution is idempotent in both directions", () => {
  // A name already in the target vocabulary must pass through unchanged, or
  // callers have to know which vocabulary they hold — which is the problem.
  for (const n of ["apify_linkedin_company_search", "harvestapi/linkedin-company-search"]) {
    const id = resolveActor(n)!;
    assertEquals(toStoreId(id.store_id), id.store_id);
    assertEquals(toRepoKey(id.repo_key!), id.repo_key);
  }
});

Deno.test("3. an unknown name resolves to nothing, in either vocabulary", () => {
  // The case that must never become a paid call.
  assertEquals(resolveActor("apify/invented-by-a-model"), null);
  assertEquals(resolveActor("apify_not_a_real_key"), null);
  assertEquals(toStoreId("nonsense"), null);
  assertEquals(toRepoKey("nonsense/nonsense"), null);
  assertEquals(sameActor("nonsense", "nonsense"), false, "unknown never equals unknown");
});

Deno.test("4. described and executable are different states", () => {
  // Knowing an Actor exists and being allowed to call it are not the same. An
  // Actor with no repo key is not executable however well documented it is.
  const crunchbase = resolveActor("memo23/crunchbase-scraper")!;
  assertEquals(crunchbase.has_intelligence, true);
  assertEquals(crunchbase.repo_key, null);
  assertEquals(crunchbase.executable, false);

  const memo23 = resolveActor("memo23/y-combinator-scraper")!;
  assertEquals(memo23.executable, true);
  assertEquals(memo23.has_intelligence, true);
});

Deno.test("5. the described-but-not-callable gap is visible", () => {
  // A scenario promising a funding source that no capability declares would
  // otherwise plan a step that silently never runs.
  // The news source LEFT this list in Phase 5 when it was carded — which is the
  // transition the list exists to make visible. Crunchbase is still on it: it is
  // described, its schema has been read, and no capability declares it.
  const gap = describedButNotExecutable();
  assert(gap.includes("memo23/crunchbase-scraper"));
  assert(gap.includes("apidojo/google-search-scraper"));
  assertFalse(gap.includes("data_xplorer/google-news-scraper-fast"),
    "a carded Actor must leave the described-but-not-callable list");
  for (const id of gap) assertEquals(toRepoKey(id), null);
});

Deno.test("6. resolving a mixed list keeps what runs and explains what does not", () => {
  const { keys, skipped } = executableRepoKeys([
    "memo23/y-combinator-scraper",      // Store id, executable
    "apify_linkedin_company_search",    // repo key, executable
    "memo23/crunchbase-scraper",        // described, not declared
    "apify/invented",                   // unknown
  ]);

  assertEquals(keys, ["apify_yc_companies_memo23", "apify_linkedin_company_search"]);
  assertEquals(skipped.length, 2);
  assert(skipped.find((s) => s.name === "memo23/crunchbase-scraper")!
    .reason.includes("containment guard"));
  assert(skipped.find((s) => s.name === "apify/invented")!
    .reason.includes("neither vocabulary"));
});

Deno.test("7. a duplicate resolution is impossible", () => {
  // Two repo keys pointing at one Store id would make `toRepoKey` lossy and the
  // containment guard ambiguous.
  const table = identityTable();
  const storeIds = table.map((t) => t.store_id);
  assertEquals(new Set(storeIds).size, storeIds.length, "a Store id claimed twice");
  const repoKeys = table.map((t) => t.repo_key);
  assertEquals(new Set(repoKeys).size, repoKeys.length);
});

Deno.test("8. the two sources do not disagree about any Actor", () => {
  // The whole point. Anything here is a naming drift that would let a planner
  // satisfy one authority while violating the other.
  assertEquals(identityDrift(), []);
});

Deno.test("9. a repo key never looks like a Store id, and vice versa", () => {
  // The discriminator the resolver branches on. If a repo key ever contained a
  // slash, every lookup would take the wrong path silently.
  for (const { repo_key, store_id } of identityTable()) {
    assertEquals(isStoreId(repo_key), false, `${repo_key} must not contain "/"`);
    assertEquals(isStoreId(store_id), true, `${store_id} must contain "/"`);
  }
});

Deno.test("10. the verification backlog is reported, not hidden", () => {
  // Executable Actors with no intelligence record are a knowledge gap, not
  // drift: the names agree and the engine has always called them, but the
  // pipeline spends with no verified adoption or price behind the decision.
  // Kept separate from drift so the drift check stays green and therefore read.
  const backlog = executableWithoutIntelligence();
  for (const entry of backlog) {
    assert(/\(.+\/.+\)/.test(entry), `${entry} must name both vocabularies`);
  }
  // The four discovery-path Actors are verified; the enrichment/people ones are
  // the remaining backlog. If that ever reaches zero, this test still passes.
  for (const verified of ["apify_yc_companies_memo23", "apify_linkedin_company_search",
    "apify_linkedin_job_search", "apify_yc_companies_solidcode"]) {
    assertEquals(backlog.some((b) => b.startsWith(verified)), false,
      `${verified} is on the discovery path and must be verified`);
  }
});
