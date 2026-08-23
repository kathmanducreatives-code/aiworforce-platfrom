// THE PHASE 5 SIGNALS, AND THE LINES THEY MUST NOT CROSS.
//
// ── THE FINDING THAT SHAPED THIS FILE ───────────────────────────────────────
//
// `harvestapi/linkedin-company-posts` and `harvestapi/linkedin-profile-posts`
// have IDENTICAL input schemas, verified field by field on 2026-08-22. Both
// take `targetUrls`; both accept a `/company/` URL and an `/in/` URL; the
// company Actor's own prefill ships a personal profile.
//
// So the company/person boundary CANNOT come from which Actor is called. Two
// Actors that do the same thing cannot enforce a distinction between them, and
// every guarantee that rests on the distinction — the unlock boundary, the
// separation of a company post from a leadership post, the refusal to answer
// "what did the CEO say" with "here is what the company page said" — rests on
// the URL check in the compilers instead.
//
// These tests are that boundary, plus the three other places Phase 5 could have
// quietly faked a signal: expansion from a job location, a launch from an
// undated headline, and growth from a single snapshot.
//
// PURE. No network, no Actor run, no model call.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HIRING_ACTOR_CATALOG,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  compileCompanyPostsInput, compileProfilePostsInput, compilePostSearchInput,
  compileGoogleNewsInput, compileBuiltWithInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  normalizeSocialPost, normalizeSocialComment, normalizeNewsArticle,
  normalizeTechnologyProfile, authorTypeFromUrl, splitPostSearchRows,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  evaluateHeadcountGrowth, evaluateGtmGrowth, HEADCOUNT_SNAPSHOT_STORAGE_NOTE,
  type HeadcountSnapshot,
} from "../../../supabase/functions/_shared/headcountGrowth.ts";
import {
  resolveSignalSupport, isUnlockGatedActor,
} from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import {
  describeSignal,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import {
  catalogueForPrompt,
} from "../../../supabase/functions/_shared/leadCapabilityCatalogue.ts";

const COMPANY_URL = "https://www.linkedin.com/company/vaultline";
const PERSON_URL = "https://www.linkedin.com/in/jane-doe";

// ═══════════════ 1-4. THE SUBJECT BOUNDARY IS THE URL, NOT THE ACTOR ═══════

Deno.test("1. THE FINDING: the two post Actors have the same schema and both accept both URL shapes", () => {
  // If this ever stops being true the boundary could move to the Actor choice.
  // While it IS true, the compilers are the only thing separating a company
  // post from a leadership post.
  const c = HIRING_ACTOR_CATALOG.apify_linkedin_company_posts;
  const p = HIRING_ACTOR_CATALOG.apify_linkedin_profile_posts;
  assertEquals([...c.supported_filters].sort(), [...p.supported_filters].sort());
  assert(c.known_defects.some((d) => d.id === "company_posts_accepts_person_urls"),
    "the card must record that the schema does not enforce scope");
});

Deno.test("2. the company compiler REFUSES a person URL, and says why", () => {
  const ok = compileCompanyPostsInput({ targetUrls: [COMPANY_URL], maxPosts: 10 });
  assert(ok.ok, JSON.stringify(!ok.ok ? ok.errors : []));

  const bad = compileCompanyPostsInput({ targetUrls: [PERSON_URL], maxPosts: 10 });
  assertFalse(bad.ok, "a person URL must never be read under a company capability");
  assert(!bad.ok && bad.errors.some((e) => /PERSON URL/.test(e) && /company-scoped/.test(e)));

  // Mixed input is refused whole, not partially accepted.
  const mixed = compileCompanyPostsInput({
    targetUrls: [COMPANY_URL, PERSON_URL], maxPosts: 10,
  });
  assertFalse(mixed.ok);
});

Deno.test("3. the profile compiler REFUSES a company URL", () => {
  const ok = compileProfilePostsInput({ targetUrls: [PERSON_URL], maxPosts: 10 });
  assert(ok.ok, JSON.stringify(!ok.ok ? ok.errors : []));

  const bad = compileProfilePostsInput({ targetUrls: [COMPANY_URL], maxPosts: 10 });
  assertFalse(bad.ok);
  assert(!bad.ok && bad.errors.some((e) => /COMPANY URL/.test(e) && /person-scoped/.test(e)));
});

Deno.test("4. the author's own URL decides the subject, not the provider's label", () => {
  // A provider can mislabel a row. A `/company/` URL is a page and an `/in/`
  // URL is a person, and that is the one thing it cannot get wrong.
  assertEquals(authorTypeFromUrl(COMPANY_URL), "company");
  assertEquals(authorTypeFromUrl(PERSON_URL), "person");
  // The claimed type loses to the URL.
  assertEquals(authorTypeFromUrl(PERSON_URL, "company"), "person");
  // With no URL, the claim is all there is — and "unknown" is a legal answer.
  assertEquals(authorTypeFromUrl(null, "organization"), "company");
  assertEquals(authorTypeFromUrl(null, null), "unknown");

  // THE REAL ROW SHAPE from run 34dB6dpHJr34h8bIr: the URL is `linkedinUrl` and
  // `postedAt` is an object. The README shape produced a null URL and null date.
  const post = normalizeSocialPost({
    linkedinUrl: "https://www.linkedin.com/posts/x",
    postedAt: { date: "2026-08-10T09:00:00.000Z", timestamp: 1786439400000 },
    content: "We are opening a New York office.",
    author: { name: "Vaultline", linkedinUrl: COMPANY_URL, type: "person" },
  }, "apify_linkedin_company_posts");
  assertEquals(post.author_type, "company", "the URL must win over the claimed type");
  assert(post.is_evidence);
});

// ═══════════════ 5-7. SPEND AND SCOPE GUARDS ON THE POST ACTORS ════════════

Deno.test("5. the unbounded-spend sentinels are refused", () => {
  // `maxPosts: 0` means ALL POSTS on these Actors — an unbounded bill, not an
  // empty run. `maxRequestsPerCrawl` defaults to 10,000,000 on BuiltWith.
  assertFalse(compileCompanyPostsInput({ targetUrls: [COMPANY_URL], maxPosts: 0 }).ok);
  assertFalse(compilePostSearchInput({ searchQueries: ["ai"], maxPosts: 0 }).ok);
  assertFalse(compileGoogleNewsInput({ keywords: ["acme"], maxArticles: 0 }).ok);
  assertFalse(compileBuiltWithInput({ startDomains: ["acme.com"], maxRequestsPerCrawl: 0 }).ok);

  // And each has a ceiling.
  assertFalse(compileCompanyPostsInput({ targetUrls: [COMPANY_URL], maxPosts: 5000 }).ok);
  assertFalse(compileGoogleNewsInput({ keywords: ["acme"], maxArticles: 5000 }).ok);
});

Deno.test("6. reactions are forbidden, and comment volume is capped", () => {
  // A reaction is billed at the price of a post and proves nothing this
  // architecture uses.
  assertFalse(compileCompanyPostsInput({
    targetUrls: [COMPANY_URL], maxPosts: 5, scrapeReactions: true,
  }).ok);
  assertFalse(compilePostSearchInput({
    searchQueries: ["ai"], maxPosts: 5, scrapeReactions: true,
  }).ok);

  // Comments ARE allowed and ARE bounded — they cost the same as a post.
  assertFalse(compilePostSearchInput({
    searchQueries: ["ai"], maxPosts: 5, scrapeComments: true, maxComments: 500,
  }).ok);
  const ok = compilePostSearchInput({
    searchQueries: ["ai"], maxPosts: 5, scrapeComments: true, maxComments: 5,
  });
  assert(ok.ok);
  // The multiplied worst case is stated rather than discovered on the invoice.
  assert(ok.ok && ok.warnings.some((w) => /billable items/.test(w)));
});

Deno.test("7. a company's received comments are not a statement BY the company", () => {
  // The distinction that keeps engagement received from becoming authorship.
  const r = compileCompanyPostsInput({
    targetUrls: [COMPANY_URL], maxPosts: 5, scrapeComments: true, maxComments: 3,
  });
  assert(r.ok);
  assert(r.ok && r.warnings.some((w) => /engagement RECEIVED/.test(w)));
  assert(HIRING_ACTOR_CATALOG.apify_linkedin_company_posts.not_for
    .some((n) => /comments here are engagement RECEIVED/.test(n)));
});

// ═══════════════ 8-10. COMMENTS ARE REAL, AND GATED ════════════════════════

Deno.test("8. comment evidence needs a commenter identity and a date", () => {
  const good = normalizeSocialComment({
    text: "We did this last year — happy to compare notes.",
    postedAt: "2026-08-12T10:00:00Z",
    author: { name: "Jane Doe", linkedinUrl: PERSON_URL, headline: "CEO at Vaultline" },
  }, "apify_linkedin_post_search", "https://www.linkedin.com/posts/parent");
  assert(good.is_evidence);
  assertEquals(good.commenter_url, PERSON_URL);
  assertEquals(good.parent_post_url, "https://www.linkedin.com/posts/parent");

  // No identity: there is no person, so there is no "a CEO said".
  const anon = normalizeSocialComment({
    text: "nice", postedAt: "2026-08-12T10:00:00Z", author: {},
  }, "apify_linkedin_post_search");
  assertFalse(anon.is_evidence);

  // No date: there is no "recently".
  const undated = normalizeSocialComment({
    text: "nice", author: { name: "Jane Doe", linkedinUrl: PERSON_URL },
  }, "apify_linkedin_post_search");
  assertFalse(undated.is_evidence);
});

Deno.test("9. comments are SUPPORTED but unlock-gated — a real capability, not a gap", () => {
  // The audit asked for comments to be left a gap if they could not genuinely be
  // produced. They can: `scrapeComments` + `commentsProfileScraperMode` return
  // each comment with its author's profile. So this is not a gap — it is work
  // that identifies people, and therefore work that waits for authorisation.
  const support = resolveSignalSupport(describeSignal("comment", "leadership"));
  assertEquals(support.status, "requires_unlock");
  assertEquals(support.dependencies[0].capability, "offer_founder_unlock");
  assertEquals(support.discovery_actors, [], "gated work is never presented as runnable");
  assert(isUnlockGatedActor("apify_linkedin_post_search"));
  assert(isUnlockGatedActor("apify_linkedin_profile_posts"));
  assertFalse(isUnlockGatedActor("apify_linkedin_company_posts"));
});

Deno.test("10. a company post is supported outright; a leadership post is not", () => {
  const companyPost = resolveSignalSupport(describeSignal("post", "company"));
  const leaderPost = resolveSignalSupport(describeSignal("post", "leadership"));

  assertEquals(companyPost.status, "supported");
  assertEquals(companyPost.verification_actors, ["apify_linkedin_company_posts"]);
  assertEquals(companyPost.dependencies.length, 0);

  assertEquals(leaderPost.status, "requires_unlock");
  // AND THE COMPANY SOURCE MUST NOT BE OFFERED AS A SUBSTITUTE.
  assertFalse(
    [...leaderPost.discovery_actors, ...leaderPost.verification_actors]
      .includes("apify_linkedin_company_posts"));
});

// ═══════════════ 11-13. EXPANSION AND LAUNCH NEED REAL EVIDENCE ════════════

Deno.test("11. a news article is evidence only with a followable URL and a date", () => {
  const good = normalizeNewsArticle({
    title: "Vaultline opens New York office",
    link: "https://example.test/vaultline-ny",
    source: { name: "TechCrunch" },
    publishedAt: "2026-08-14T08:00:00Z",
    description: "The Berlin security firm said it is entering the US market.",
  });
  assert(good.is_evidence);
  assertEquals(good.source, "TechCrunch");

  // A headline with no article behind it cannot be checked.
  assertFalse(normalizeNewsArticle({
    title: "Vaultline opens New York office", publishedAt: "2026-08-14T08:00:00Z",
  }).is_evidence);
  // An undated article cannot support "recently".
  assertFalse(normalizeNewsArticle({
    title: "x", link: "https://example.test/x", source: "TechCrunch",
  }).is_evidence);
});

Deno.test("12. THE CONFLATION: a job search may never verify an expansion", () => {
  // A US-located opening at a company with a decade-old US office would have
  // satisfied the old gate. Expansion needs an explicit dated statement of a new
  // market, so the job source is not among its providers and the news source is.
  const expansion = resolveSignalSupport(describeSignal("expansion", "company"));
  assertEquals(expansion.status, "supported");
  const all = [...expansion.discovery_actors, ...expansion.verification_actors];
  assertFalse(all.includes("apify_linkedin_job_search"),
    "a job posting's location is not a statement that a company entered a market");
  assert(all.includes("apify_google_news"));

  // The news source carries the region qualifier; a launch does not need one.
  assertEquals(expansion.unhonoured_qualifiers, []);
  const regional = resolveSignalSupport(
    describeSignal("expansion", "company", { region: "us", topic: "US expansion" }));
  assertEquals(regional.unhonoured_qualifiers, []);
});

Deno.test("13. the news compiler forces a followable citation and warns about topic pages", () => {
  const r = compileGoogleNewsInput({
    keywords: ['"Vaultline" (expansion OR "new office")'], maxArticles: 20, timeframe: "30d",
  });
  assert(r.ok);
  // A Google redirect is not a citation anybody can check.
  assertEquals((r.ok ? r.input : {} as Record<string, unknown>).decodeUrls, true);
  assert(r.ok && r.warnings.some((w) => /a name is not an identity/.test(w)));

  // `timeframe` is ignored on topic pages — the vendor says so, and a silent
  // ignore would make an old article look recent.
  const topical = compileGoogleNewsInput({
    topics: ["TECHNOLOGY"], maxArticles: 10, timeframe: "1d",
  });
  assert(topical.ok);
  assert(topical.ok && topical.warnings.some((w) => /topic pages return their own/.test(w)));
});

// ═══════════════ 14-15. TECHNOLOGY IS VERIFICATION, PERMANENTLY ════════════

Deno.test("14. technology can be verified and can never be discovered", () => {
  const tech = resolveSignalSupport(describeSignal("technology", "company"));
  assertEquals(tech.status, "supported");
  assertEquals(tech.discovery_actors, [],
    "BuiltWith takes a domain list and has no query field — there is no reverse lookup");
  assertEquals(tech.verification_actors, ["apify_builtwith_technology"]);

  // A recency qualifier is DISCLOSED as unhonoured rather than silently met: a
  // detection is present-tense and carries no adoption date.
  const profile = normalizeTechnologyProfile({
    domain: "https://www.vaultline.io/", technologies: ["Segment", "Snowflake"],
  });
  assert(profile.is_evidence);
  assertEquals(profile.domain, "vaultline.io");
  assertEquals(profile.adopted_at, null);

  assertFalse(normalizeTechnologyProfile({ domain: "vaultline.io" }).is_evidence,
    "a domain with no detected technology proves nothing");
});

Deno.test("15. the BuiltWith compiler refuses a search and refuses the 10,000,000 default", () => {
  assertFalse(compileBuiltWithInput({ startDomains: [], maxRequestsPerCrawl: 10 }).ok);
  assertFalse(compileBuiltWithInput({
    startDomains: ["not a domain"], maxRequestsPerCrawl: 10,
  }).ok);
  assertFalse(compileBuiltWithInput({
    startDomains: ["acme.com"], maxRequestsPerCrawl: 10_000_000,
  }).ok, "the Actor's own default must never be inherited");
  assert(compileBuiltWithInput({ startDomains: ["acme.com"], maxRequestsPerCrawl: 5 }).ok);
});

// ═══════════════ 16-19. GROWTH IS A DELTA, NOT A SNAPSHOT ══════════════════

const snap = (d: string, n: number): HeadcountSnapshot =>
  ({ observed_at: d, employee_count: n, source: "apify_linkedin_company_details" });

Deno.test("16. THE GATE: one snapshot is size, never growth", () => {
  const none = evaluateHeadcountGrowth([]);
  assertEquals(none.verdict, "insufficient_evidence");
  assert(none.reason.includes(HEADCOUNT_SNAPSHOT_STORAGE_NOTE.slice(0, 40)));

  const one = evaluateHeadcountGrowth([snap("2026-08-01", 50)]);
  assertEquals(one.verdict, "insufficient_evidence");
  assert(/only ONE headcount reading/.test(one.reason));
  assertEquals(one.percent_change, null, "no delta may be computed from one reading");
});

Deno.test("17. two dated readings produce a real verdict, either way", () => {
  const now = new Date("2026-08-22T00:00:00Z");

  const grew = evaluateHeadcountGrowth(
    [snap("2026-05-01", 50), snap("2026-08-01", 70)], {}, now);
  assertEquals(grew.verdict, "growth_confirmed");
  assertEquals(grew.absolute_change, 20);
  assertEquals(grew.percent_change, 40);
  assert(/2026-05-01/.test(grew.reason) && /2026-08-01/.test(grew.reason),
    "the verdict must cite the readings it used");

  // A MEASURED NON-RESULT is not a missing one, and must not be reported as one.
  const flat = evaluateHeadcountGrowth(
    [snap("2026-05-01", 50), snap("2026-08-01", 51)], {}, now);
  assertEquals(flat.verdict, "no_growth");
  assert(/measured NON-result/.test(flat.reason));
});

Deno.test("18. readings too close together, or too old, are insufficient — not growth", () => {
  const now = new Date("2026-08-22T00:00:00Z");

  // Days apart is noise, however large the jump looks.
  const noisy = evaluateHeadcountGrowth(
    [snap("2026-08-18", 50), snap("2026-08-20", 90)], {}, now);
  assertEquals(noisy.verdict, "insufficient_evidence");
  assert(/days apart/.test(noisy.reason));

  // A stale latest reading describes a company that may no longer exist so.
  const stale = evaluateHeadcountGrowth(
    [snap("2024-01-01", 50), snap("2024-06-01", 200)], {}, now);
  assertEquals(stale.verdict, "insufficient_evidence");
  assert(/days old/.test(stale.reason));
});

Deno.test("19. GTM growth needs COMMERCIAL growth, not company growth", () => {
  const now = new Date("2026-08-22T00:00:00Z");
  const growing = evaluateHeadcountGrowth(
    [snap("2026-05-01", 50), snap("2026-08-01", 70)], {}, now);

  // Growth plus engineering hiring is company growth. Reporting it as GTM growth
  // would answer a commercial question with a headcount fact.
  const engOnly = evaluateGtmGrowth({
    headcount: growing, hiring_role_families: ["engineering"],
  });
  assertEquals(engOnly.verdict, "no_gtm_growth");
  assert(/not GTM growth/.test(engOnly.reason));

  // Growth plus commercial hiring is GTM growth.
  const gtm = evaluateGtmGrowth({
    headcount: growing, hiring_role_families: ["engineering", "gtm_sales"],
  });
  assertEquals(gtm.verdict, "gtm_growth_confirmed");
  assertEquals(gtm.matched_families, ["gtm_sales"]);

  // Commercial hiring WITHOUT a growth series is insufficient, and says which
  // half is missing so the user knows whether waiting would help.
  const noSeries = evaluateGtmGrowth({
    headcount: evaluateHeadcountGrowth([]),
    hiring_role_families: ["gtm_sales"],
  });
  assertEquals(noSeries.verdict, "insufficient_evidence");
  assert(/Commercial hiring IS proven/.test(noSeries.reason));
});

// ═══════════════ 20. GPT SEES THE CAPABILITIES, NOT THE ACTORS ═════════════

Deno.test("20. the new capabilities are offered in outcome language, naming their limits", () => {
  const cat = catalogueForPrompt();
  const byId = Object.fromEntries(cat.map((c) => [c.capability, c]));

  for (const id of [
    "company_post_evidence", "expansion_evidence", "product_launch_evidence",
    "technology_evidence",
  ]) {
    assert(byId[id], `${id} must be visible to the planner`);
  }

  // Each names the thing it CANNOT do, because that is what stops a model
  // choosing it for the wrong question.
  assert(/cannot read what a founder or an employee posted/i
    .test(byId.company_post_evidence.description));
  assert(/job advertised in a country is NOT expansion evidence/i
    .test(byId.expansion_evidence.description));
  assert(/CANNOT find companies by technology/i
    .test(byId.technology_evidence.description));

  // Person-authored evidence is reachable only through the unlock offer, and the
  // offer says so.
  assert(/PERSON posted or commented/i.test(byId.offer_founder_unlock.description));

  // AND NO ACTOR NAME LEAKS. The containment property is unchanged: the model
  // has no field in which to write a provider.
  for (const c of cat) {
    assertFalse(
      /harvestapi|datahyena|builtwith|data_xplorer|memo23|apify_/i.test(c.description),
      `${c.capability}: a provider name leaked into the model-facing catalogue`);
  }
});

// ═══════════════ 21-24. PINNED TO REAL OBSERVED OUTPUT ═════════════════════
//
// Every normalizer in this phase was written from vendor documentation and every
// one of them was WRONG about the field names. These tests hold the corrected
// readings against rows copied verbatim from the validation runs, so a future
// "tidy-up" that reverts to the documented names fails here instead of silently
// returning `is_evidence: false` for every row in production.

Deno.test("21. REAL ROW: a company post reads from linkedinUrl and postedAt.date", () => {
  // Verbatim from run 34dB6dpHJr34h8bIr (2026-08-22).
  const post = normalizeSocialPost({
    linkedinUrl: "https://www.linkedin.com/posts/stripe_krak-card-has-landed-activity-7496332962540589056-lVmi",
    type: "post",
    content: "Kraken is launching Krak Cards in the US, powered by Stripe Issuing.",
    postedAt: {
      timestamp: 1787265053401, date: "2026-08-20T22:30:53.401Z",
      postedAgoShort: "1d", postedAgoText: "1 day ago",
    },
    author: {
      id: "2135371", universalName: "stripe", type: "company", name: "Stripe",
      linkedinUrl: "https://www.linkedin.com/company/stripe/posts",
      info: "1,649,614 followers",
    },
    engagement: { likes: 80, comments: 6, shares: 4, reactions: [{ type: "LIKE", count: 74 }] },
  }, "apify_linkedin_company_posts");

  assert(post.is_evidence, "the documented field names produced is_evidence=false here");
  assertEquals(post.posted_at, "2026-08-20T22:30:53.401Z");
  assertEquals(post.author_type, "company");
  // `engagement.reactions` is an ARRAY of breakdowns; the scalar total is `likes`.
  assertEquals(post.reaction_count, 80);
  assertEquals(post.comment_count, 6);
  // A follower count is NOT a headline, and must never be presented as one.
  assertEquals(post.author_headline, null);
});

Deno.test("22. REAL ROW: a news article reads from `url` and a string `source`", () => {
  // Verbatim from run ak9nBcyYkolVrLQhM (2026-08-22).
  const a = normalizeNewsArticle({
    title: "Global law firm with aerospace and defense clients opens office in Huntsville",
    url: "https://www.al.com/news/huntsville/2026/08/global-law-firm-opens-office.html",
    source: "AL.com",
    publishedAt: "2026-08-13T17:42:00Z",
    publishedTimestamp: 1786642920000,
    metadata: { keyword: '"opens office" OR "expands into" startup', sourceType: "keyword" },
  });
  assert(a.is_evidence);
  assertEquals(a.source, "AL.com", "source is a plain string, not an object");
  assertEquals(a.published_at, "2026-08-13T17:42:00.000Z");
  // `decodeUrls` worked: a real publisher URL, not a Google redirect.
  assertFalse(a.url!.includes("news.google.com"));
  // The run returned NO description, which is why the compiler forces
  // `extractDescriptions` — the claim text is the evidence.
  assertEquals(a.description, null);
  assert(a.missing_fields.includes("description"));
});

Deno.test("23. REAL ROW: BuiltWith categories come from inside techs[]", () => {
  // Verbatim shape from run PD0F1XtytK3Z7juwM (2026-08-22).
  const t = normalizeTechnologyProfile({
    domain: "notion.so",
    techs: [
      { name: "Cloudflare", tag: "cdn", categories: [], link: "https://www.cloudflare.com/" },
      { name: "React", tag: "javascript", categories: ["JavaScript Library", "UI"], link: "https://reactjs.org/" },
      { name: "Smart App Banner", tag: "widgets", categories: ["Mobile", "UI"], link: "https://developer.apple.com/" },
    ],
  });
  assert(t.is_evidence);
  assertEquals(t.technologies, ["Cloudflare", "React", "Smart App Banner"]);
  // Flattened AND deduped — "UI" appears on two technologies.
  assertEquals(t.categories, ["JavaScript Library", "UI", "Mobile"]);
  // A detection is present-tense. There is no adoption date and there never is.
  assertEquals(t.adopted_at, null);
});

Deno.test("24. the validated cards record what the runs actually showed", () => {
  // Confidence is evidence, not optimism: it moves only when a run moves it, and
  // the news source stays `low` because its RELEVANCE was poor even though its
  // transport was fine.
  assertEquals(HIRING_ACTOR_CATALOG.apify_linkedin_company_posts.confidence, "medium");
  assertEquals(HIRING_ACTOR_CATALOG.apify_builtwith_technology.confidence, "medium");
  assertEquals(HIRING_ACTOR_CATALOG.apify_google_news.confidence, "low");

  // Validated in the second round (run 8Ks7TvqIiejDct5ha).
  assertEquals(HIRING_ACTOR_CATALOG.apify_linkedin_profile_posts.confidence, "medium");

  // Validated in round 3 (run 6YHiwmXEcP933uqst), once credit was available.
  assertEquals(HIRING_ACTOR_CATALOG.apify_linkedin_post_search.confidence, "medium");

  // EVERY carded Actor has now been run at least once, so no card may still
  // claim its output is unobserved. A future addition must be validated or say
  // plainly that it has not been.
  for (const [key, card] of Object.entries(HIRING_ACTOR_CATALOG)) {
    assertFalse(
      card.known_defects.some((d) => /_output_unobserved$/.test(d.id)),
      `${key} still claims its output is unobserved`);
  }

  // The observed defects are on the cards, with their run ids as evidence.
  assert(HIRING_ACTOR_CATALOG.apify_google_news.known_defects
    .some((d) => d.id === "news_keyword_matching_is_literal_not_semantic" &&
      /ak9nBcyYkolVrLQhM/.test(d.evidence_ref)));
  assert(HIRING_ACTOR_CATALOG.apify_linkedin_company_posts.known_defects
    .some((d) => d.id === "company_posts_field_names_differ_from_docs"));
});

// ═══════════════ 25-28. POST SEARCH: THE COMMENT SHAPE, VALIDATED ══════════
//
// Run 6YHiwmXEcP933uqst (2026-08-22) settled the one shape that had been
// guessed at through three phases: what a COMMENT actually looks like. It is
// not a post with different names — it is a separate dataset item whose author,
// text, date and parent all live under different keys.

Deno.test("25. REAL ROW: comments are separate items with `type`, and are split before use", () => {
  // Read as posts, 23 of 28 rows would have normalised to nulls — and been
  // billed regardless.
  const rows = [
    { type: "post", id: "p1", linkedinUrl: "https://x/p1", content: "…",
      postedAt: { date: "2026-08-02T19:48:56.195Z" }, author: { name: "A" } },
    { type: "comment", id: "c1", postId: "p1", commentary: "…",
      createdAt: "2026-08-03T09:39:32.084Z", actor: { name: "B" } },
    { type: "comment", id: "c2", postId: "p1", commentary: "…",
      createdAt: "2026-08-04T09:39:32.084Z", actor: { name: "C" } },
  ];
  const { posts, comments } = splitPostSearchRows(rows);
  assertEquals(posts.length, 1);
  assertEquals(comments.length, 2);
});

Deno.test("26. REAL ROW: a comment reads from actor/commentary/createdAt/postId", () => {
  // Verbatim from run 6YHiwmXEcP933uqst — the highest-signal comment in the run.
  const c = normalizeSocialComment({
    type: "comment",
    id: "7489978250908139520",
    postId: "7489769224043704320",
    linkedinUrl: "https://www.linkedin.com/feed/update/urn:li:ugcPost:7489769223548805122?commentUrn=x",
    createdAt: "2026-08-03T09:39:32.084Z",
    actor: {
      id: "ACoAADD8gP0BQ0vUWClMLeNO6g5ID78u15scZ8I",
      type: "profile", name: "Krutarth Shirvekar",
      linkedinUrl: "https://www.linkedin.com/in/kayshirvekar",
      position: "Founder-led selling works right up until you hire someone | Co-founder, TriForge Labs",
      author: false,
    },
    commentary: "Honest one from month six: three email campaigns earlier this " +
      "summer, not a single reply. I still can't tell you if that's channel, " +
      "list quality, or us.",
    query: { post: "https://www.linkedin.com/posts/pmosenson_activity-7489769224043704320-loN5" },
  }, "apify_linkedin_post_search");

  assert(c.is_evidence);
  assertEquals(c.commenter_name, "Krutarth Shirvekar");
  // The commenter URL is CLEAN here, unlike a post author's.
  assertEquals(c.commenter_url, "https://www.linkedin.com/in/kayshirvekar");
  // `actor.position` is the headline, and it names the role and the company —
  // which is how founder identity is proposed from a comment.
  assert(c.commenter_headline!.includes("Co-founder"));
  assertEquals(c.commenter_member_id, "ACoAADD8gP0BQ0vUWClMLeNO6g5ID78u15scZ8I");
  assertEquals(c.posted_at, "2026-08-03T09:39:32.084Z");
  // BOTH parent references survive: a comment without its post has no subject.
  assertEquals(c.parent_post_id, "7489769224043704320");
  assert(c.parent_post_url!.includes("pmosenson"));
  assertFalse(c.is_post_author, "a third party, not the OP replying to themselves");
});

Deno.test("27. THE GATE: a comment with no parent is not evidence, however well identified", () => {
  const base = {
    type: "comment", id: "c1", createdAt: "2026-08-03T09:39:32.084Z",
    commentary: "we have exactly this problem",
    actor: { id: "x", name: "Jane Doe", linkedinUrl: "https://www.linkedin.com/in/jane", position: "CEO" },
  };
  // Fully identified, dated, and unanchored: the words mean nothing without
  // knowing what they were said about.
  assertFalse(normalizeSocialComment(base, "apify_linkedin_post_search").is_evidence);

  // With a parent, it is evidence.
  assert(normalizeSocialComment(
    { ...base, postId: "p1" }, "apify_linkedin_post_search").is_evidence);

  // Anonymous or undated is still refused.
  assertFalse(normalizeSocialComment(
    { ...base, postId: "p1", actor: {} }, "apify_linkedin_post_search").is_evidence);
  assertFalse(normalizeSocialComment(
    { ...base, postId: "p1", createdAt: undefined }, "apify_linkedin_post_search").is_evidence);
});

Deno.test("28. the post-search card records what the comments actually looked like", () => {
  const c = HIRING_ACTOR_CATALOG.apify_linkedin_post_search;
  assertEquals(c.confidence, "medium");
  for (const id of [
    "post_search_comments_are_separate_items_with_a_different_shape",
    "post_search_comment_noise_is_the_dominant_failure_mode",
    "post_search_commenters_are_mostly_sellers_not_buyers",
  ]) {
    assert(c.known_defects.some((d) => d.id === id), `${id} must be recorded`);
  }
  // The finding that most directly justifies separating ICP from intent: a
  // problem query surfaces the people who SELL the solution.
  assert(c.known_defects.some((d) =>
    /sellers/i.test(d.id) && /6YHiwmXEcP933uqst/.test(d.evidence_ref)));
});
