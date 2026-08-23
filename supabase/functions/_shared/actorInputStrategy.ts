// HOW TO AIM AN ACTOR, NOT MERELY WHAT IT ACCEPTS.
//
// ── WHY A SCHEMA IS NOT ENOUGH ──────────────────────────────────────────────
//
// `actorInputContracts` already tells the planner every field the live schema
// accepts, with types, enums and a worked example. That stops malformed input.
// It does not stop the failure that actually costs money: input that is
// perfectly well-formed and asks the wrong question.
//
// Run df00b2cd is the canonical case. A mission for AI startups produced
// `industries: ["B2B", "Engineering, Product and Design"]` — legal values, an
// accepted call, 100 rows returned, not one of them an AI startup. The YC
// industry enum has no technology axis, so "AI" cannot be expressed there at
// all. Nothing in a type signature can say that.
//
// This module carries the judgement: what each filter MEANS, when reaching for
// it helps, when it quietly destroys recall, which fields reinforce each other,
// which fight, what a query should look like, and which inputs multiply the
// bill. Every entry is grounded in a verified schema or an observed run, and
// each one that came from a run names it.
//
// ── WHAT THIS IS DELIBERATELY NOT ──────────────────────────────────────────
//
// It is NOT a static "best input" per signal. There is no table here mapping a
// signal to a JSON body, because the right input depends on the mission — the
// ICP, the topic, the geography, the recency, the budget — and only the model
// sees all of that at once. This is knowledge the model reasons WITH; the
// deterministic compilers still bound whatever it proposes.
//
// PURE. No network, provider, model or database access.

export const ACTOR_INPUT_STRATEGY_VERSION = "actor-input-strategy-v1" as const;

/** What a filter does to the result set when you reach for it. */
export type PrecisionEffect =
  /** Narrows to more relevant rows. */
  | "raises_precision"
  /** Widens; more rows, more noise. */
  | "lowers_precision"
  /** Changes WHICH rows, not how relevant they are. */
  | "changes_population"
  /** Bounds cost or ordering; no relevance effect. */
  | "neutral";

export interface FilterStrategy {
  /** What the field actually means, in the provider's terms. */
  means: string;
  /** The mission shape that should reach for it. */
  use_when: string;
  /** When reaching for it makes the answer worse. Omitted only if never. */
  avoid_when?: string;
  effect: PrecisionEffect;
  /** True when setting this field multiplies what the run is billed. */
  multiplies_cost?: boolean;
}

export interface FilterCombination {
  fields: readonly string[];
  why: string;
}

export interface ActorInputStrategy {
  /**
   * The question this actor is being asked when used to FIND candidates.
   * Absent when the actor cannot discover at all.
   */
  discovery_pattern?: string;
  /**
   * The question it is being asked when CHECKING something already found.
   * Absent when the actor cannot verify.
   */
  verification_pattern?: string;
  /** Per-field judgement, keyed by the field name in the live schema. */
  filters: Readonly<Record<string, FilterStrategy>>;
  /** Field sets that reinforce each other, and why. */
  good_combinations: readonly FilterCombination[];
  /** Field sets that fight each other. The expensive lesson of each. */
  bad_combinations: readonly FilterCombination[];
  /** How a mission's recency requirement becomes this actor's input. */
  recency_mapping: string;
  /** Every input that multiplies the bill, named so a budget can be reasoned about. */
  expensive_inputs: readonly string[];
  /** How to phrase the query, for actors that take one. */
  query_guidance?: readonly string[];
  /** Patterns observed to return legal, irrelevant rows. */
  noisy_patterns: readonly string[];
}

export const ACTOR_INPUT_STRATEGIES:
  Readonly<Record<string, ActorInputStrategy>> = Object.freeze({

  // ── FUNDING ───────────────────────────────────────────────────────────────
  apify_funding_rounds_datahyena: {
    discovery_pattern:
      "Ask for the ROUNDS, then let identity resolution and enrichment decide " +
      "which companies survive. Filter on the dimensions the provider indexes " +
      "well — date, stage, country, vertical, amount — and never on anything " +
      "the mission cares about that this source only guesses at.",
    filters: {
      since: {
        means: "Only rounds announced on or after this ISO date.",
        use_when:
          "ALWAYS. It is the only recency control, and an unbounded run returns " +
          "the newest rows in no particular window, so 'recently funded' cannot " +
          "be claimed from the input without it.",
        effect: "raises_precision",
      },
      round: {
        means: "Funding stage, from a 24-value enum.",
        use_when:
          "The mission names a stage — 'Series A', 'seed'. Add 'unknown' " +
          "alongside it whenever the stage is a preference rather than a hard " +
          "requirement.",
        avoid_when:
          "The mission only says 'recently funded'. OBSERVED: `round` is NULL on " +
          "a third of real rows (6 of 18 on run 0XchPqe0cJpx0Yc2T), so filtering " +
          "on stage silently discards a third of legitimate matches.",
        effect: "raises_precision",
      },
      countries: {
        means: "Company HQ country, ISO alpha-2, multi-select.",
        use_when:
          "The mission states a geography. Pass every country in a region — a " +
          "Europe mission is a list of European codes, not one call per country.",
        avoid_when:
          "Recall matters more than precision: the vendor documents ~25% of " +
          "companies with no HQ country on record, and they are excluded by any " +
          "country filter unless 'unknown' is included.",
        effect: "changes_population",
      },
      verticals: {
        means: "High-level sector from a 21-value enum (ai, fintech, saas, cybersecurity…).",
        use_when:
          "The mission's industry maps cleanly onto one of the 21 values.",
        avoid_when:
          "The industry is narrower than the enum, or the mission's ICP is " +
          "defined by business model rather than sector. OBSERVED: verticals is " +
          "empty on 39% of rows, and the provider tagged a biotech as " +
          "['commerce'] — so this filter both under-returns and mis-labels.",
        effect: "changes_population",
      },
      industryGroups: {
        means: "LinkedIn-style industry labels, exact match, multi-select.",
        use_when: "A precise industry is required and the exact label is known.",
        avoid_when:
          "Exact-match labels are brittle and ~20% of companies carry none. " +
          "Prefer `verticals`, or filter after the fact on enriched industry.",
        effect: "changes_population",
      },
      minAmountUsd: {
        means: "Lower bound on the announced amount in USD.",
        use_when: "The mission implies round size — 'well-funded', 'Series B+'.",
        avoid_when:
          "OBSERVED: amountUsd is null on 11% of rows, and those rows are " +
          "dropped by any amount filter even when the round itself is real.",
        effect: "raises_precision",
      },
      employeeBuckets: {
        means: "Company size band.",
        use_when: "Almost never on this actor.",
        avoid_when:
          "OBSERVED fill rate is 28%. Filtering here discards nearly three " +
          "quarters of rows for a dimension enrichment settles properly anyway.",
        effect: "changes_population",
      },
      maxItems: {
        means: "Maximum records returned. Billed PER RECORD at $0.045.",
        use_when:
          "Always — it is the entire cost model, and the most expensive per-row " +
          "actor in the catalog.",
        effect: "neutral",
        multiplies_cost: true,
      },
      cursor: {
        means: "Resume token from a previous run, for pagination.",
        use_when: "Continuing a scheduled feed rather than answering one mission.",
        effect: "neutral",
      },
    },
    good_combinations: [
      { fields: ["since", "verticals", "countries"],
        why: "The three dimensions the provider indexes best. A date-bounded, " +
          "sector-scoped, region-scoped run is the highest-precision shape " +
          "available without touching the sparse fields." },
      { fields: ["since", "maxItems"],
        why: "The minimum honest run: a real recency window and a real cost bound." },
    ],
    bad_combinations: [
      { fields: ["round", "verticals", "countries", "employeeBuckets"],
        why: "Each filter independently drops rows with a null on that field. " +
          "Stacked, the observed fill rates (67% / 61% / 89% / 28%) multiply to " +
          "roughly a tenth of the pool, and the survivors are selected for being " +
          "well-documented rather than for being a good fit." },
      { fields: ["minAmountUsd", "round"],
        why: "Both are sparse and correlated; together they discard real rounds " +
          "whose amount or stage simply was not reported." },
    ],
    recency_mapping:
      "A mission window in days becomes `since` = today minus that many days, " +
      "ISO date. There is no other recency control, and `announcedAt` must still " +
      "be re-checked per row because the filter bounds the query, not the answer.",
    expensive_inputs: ["maxItems (per-record billing at $0.045 — the highest in the catalog)"],
    noisy_patterns: [
      "OBSERVED on run 0XchPqe0cJpx0Yc2T: the provider resolved an Australian " +
      "fintech round onto a Montreal performing-arts ensemble's domain. Company " +
      "identity from this source is a proposal, never a fact — which is why it " +
      "requires enrichment before qualification.",
    ],
  },

  // ── COMPANY POSTS ─────────────────────────────────────────────────────────
  apify_linkedin_company_posts: {
    verification_pattern:
      "Given company LinkedIn URLs the pipeline already resolved, read what each " +
      "page published inside a date window, then match the mission's topic " +
      "against the post TEXT. This actor has no topic filter, so topical " +
      "relevance is decided after retrieval, never requested.",
    filters: {
      targetUrls: {
        means: "LinkedIn company URLs to read. One result set per URL.",
        use_when:
          "Always — it is the only input. Identity must be resolved first; this " +
          "actor consumes URLs and can never find one.",
        avoid_when:
          "A person profile URL. The schema accepts `/in/` URLs, and the " +
          "compiler refuses them, because scope is enforced here or nowhere.",
        effect: "neutral",
        multiplies_cost: true,
      },
      maxPosts: {
        means: "Posts per target URL. Billed per post. 0 means ALL POSTS.",
        use_when:
          "Always. For a topical check 10-20 recent posts is enough; a company " +
          "that has not mentioned the topic in 20 posts has not mentioned it.",
        effect: "neutral",
        multiplies_cost: true,
      },
      postedLimit: {
        means: "Relative recency bucket: 24h, week, month, 3months, 6months, year.",
        use_when:
          "The mission states a window. Prefer this over postedLimitDate — it is " +
          "cheaper to reason about and matches how missions phrase recency.",
        effect: "raises_precision",
      },
      postedLimitDate: {
        means: "Absolute cutoff date.",
        use_when: "The mission names a specific date rather than a period.",
        avoid_when: "A relative window would do; two ways to say recency invites drift.",
        effect: "raises_precision",
      },
      scrapeComments: {
        means:
          "Also return comments left ON these posts, by other people.",
        use_when:
          "Studying who ENGAGES with a company — the commenters are third " +
          "parties, and each is a person, so this crosses the people boundary.",
        avoid_when:
          "The mission asks what the COMPANY said. Comments here are engagement " +
          "RECEIVED, never a statement by the company, and they are billed at the " +
          "price of a post each.",
        effect: "changes_population",
        multiplies_cost: true,
      },
      includeReposts: {
        means: "Include shares without added commentary.",
        use_when: "Measuring amplification.",
        avoid_when:
          "Judging what a company SAYS. A repost is someone else's words, and " +
          "counting it as the company's own claim overstates the evidence.",
        effect: "lowers_precision",
      },
      contextCountry: {
        means: "Which country's view of LinkedIn to render (any, US, GB, DE, FR).",
        use_when: "Regional content differences genuinely matter.",
        effect: "changes_population",
      },
    },
    good_combinations: [
      { fields: ["targetUrls", "maxPosts", "postedLimit"],
        why: "The whole honest shape: a resolved identity, a bounded cost and a " +
          "real recency window." },
    ],
    bad_combinations: [
      { fields: ["scrapeComments", "maxPosts"],
        why: "Cost multiplies rather than adds: maxPosts 20 with maxComments 10 " +
          "is up to 220 billable items per company, not 20." },
      { fields: ["includeReposts", "postedLimit"],
        why: "A repost carries the ORIGINAL author's date in the reader's mind " +
          "but the resharer's date in the data, so a recency window over reposts " +
          "measures the wrong event." },
    ],
    recency_mapping:
      "Days map onto the nearest bucket that CONTAINS the window and never one " +
      "that truncates it — 30 days becomes 'month', 45 becomes '3months' — then " +
      "each post's own `postedAt.date` is re-checked against the real window.",
    expensive_inputs: [
      "maxPosts (per target URL)",
      "scrapeComments with maxComments (each comment billed at the price of a post)",
      "a target URL with no posts still bills a 0-result query",
    ],
    noisy_patterns: [
      "Company pages post marketing. A launch announcement is strong evidence; " +
      "'we're hiring!' as a recruitment ad is weak evidence of a hiring signal " +
      "compared with an actual job posting.",
    ],
  },

  // ── LEADERSHIP / PROFILE POSTS ────────────────────────────────────────────
  apify_linkedin_profile_posts: {
    verification_pattern:
      "Given a person profile URL produced by an ACCEPTED unlock, read what that " +
      "person published in a window and match the mission's topic against the " +
      "post text. Never used to find a person — it cannot.",
    filters: {
      targetUrls: {
        means: "LinkedIn person profile URLs. One result set per URL.",
        use_when:
          "Only after the person has been identified through the unlock flow.",
        avoid_when:
          "A company URL — the schema accepts it and the compiler refuses it. " +
          "And any use before an unlock is accepted.",
        effect: "neutral",
        multiplies_cost: true,
      },
      maxPosts: {
        means: "Posts per profile. Billed per post. 0 means ALL POSTS.",
        use_when:
          "Always. 10-20 is ample for an intent read: OBSERVED that a founder " +
          "may post the same campaign twice in two days, so raw volume adds " +
          "duplicates faster than it adds evidence.",
        effect: "neutral",
        multiplies_cost: true,
      },
      postedLimit: {
        means: "Relative recency bucket.",
        use_when:
          "Always for an intent signal. Intent decays: a founder's pain from a " +
          "year ago is not a buying signal now.",
        effect: "raises_precision",
      },
      includeReposts: {
        means: "Include shares without commentary.",
        use_when: "Mapping what a person amplifies as a softer interest signal.",
        avoid_when:
          "Judging what the PERSON believes or needs. A repost is not their words.",
        effect: "lowers_precision",
      },
      scrapeComments: {
        means: "Comments left on THIS person's posts, by others.",
        use_when: "Studying that person's audience.",
        avoid_when:
          "The mission asks what the PERSON commented elsewhere. That is the " +
          "opposite direction and this actor cannot answer it — the topic search " +
          "can.",
        effect: "changes_population",
        multiplies_cost: true,
      },
    },
    good_combinations: [
      { fields: ["targetUrls", "maxPosts", "postedLimit"],
        why: "One identified person, a bounded read, a real window." },
    ],
    bad_combinations: [
      { fields: ["targetUrls", "includeReposts"],
        why: "Reposts dilute an authored-intent read with other people's words, " +
          "and each one is still billed." },
    ],
    recency_mapping:
      "Same bucket rule as company posts, and tighter by default: intent is a " +
      "'within weeks' claim where a company launch is a 'within months' one.",
    expensive_inputs: ["maxPosts per profile", "scrapeComments with maxComments"],
    noisy_patterns: [
      "OBSERVED on run 8Ks7TvqIiejDct5ha: 2 of 6 posts were the same event " +
      "promoted twice, a day apart, with reworded text and different post ids. " +
      "Repeated promotion of one thing is ONE piece of evidence.",
      "`author.info` is a self-written headline. It names a role and an employer " +
      "and verifies neither.",
    ],
  },

  // ── TOPIC POST SEARCH ─────────────────────────────────────────────────────
  apify_linkedin_post_search: {
    discovery_pattern:
      "Ask for POSTS ABOUT A TOPIC, then resolve the authors back to people and " +
      "companies. This is the only actor that can find social activity before " +
      "any identity is known — and every person it returns arrives identified, " +
      "which is why it is unlock-gated.",
    verification_pattern:
      "Scope the same topic search to `authorUrls` or `authorsCompanies` to ask " +
      "whether a KNOWN person or company discussed a topic. A null result is " +
      "weak evidence of absence: relevance ranking may simply not surface it.",
    filters: {
      searchQueries: {
        means:
          "Full-text LinkedIn post search, Boolean supported, one result set per " +
          "query.",
        use_when:
          "Always — it is the primary input. Express the mission's PROBLEM in " +
          "the words a practitioner would use, not the words the seller uses.",
        effect: "raises_precision",
        multiplies_cost: true,
      },
      authorKeywords: {
        means:
          "Matches text in the author's headline or job-title section.",
        use_when:
          "The mission names a ROLE — founders, CEOs, heads of sales. This is the " +
          "cheapest way to bias a topic search toward decision-makers WITHOUT " +
          "person discovery.",
        avoid_when:
          "Treating the result as verified employment. A headline is written by " +
          "its owner and is a claim, not a fact.",
        effect: "raises_precision",
      },
      authorsCompanies: {
        means: "Posts by people who list one of these companies as their employer.",
        use_when:
          "A known company set exists and the mission asks what its PEOPLE say.",
        avoid_when:
          "The company list is large: this is a per-company fan-out and the " +
          "employer is self-reported.",
        effect: "changes_population",
      },
      authorUrls: {
        means: "Restrict to posts by these profile or company URLs.",
        use_when: "Verifying a topic against an identity already held.",
        avoid_when: "Discovery — it forecloses the finding this actor is for.",
        effect: "changes_population",
      },
      authorsIndustryId: {
        means: "Author's LinkedIn industry id.",
        use_when: "The ICP is industry-defined and the ids are known.",
        avoid_when:
          "The id list is guessed. A wrong id returns a clean, confident, " +
          "entirely irrelevant population.",
        effect: "changes_population",
      },
      mentioningCompany: {
        means: "Posts mentioning a named company.",
        use_when: "Competitive or reputation monitoring.",
        avoid_when: "Finding what a company itself said — that is `authorUrls`.",
        effect: "changes_population",
      },
      postedLimit: {
        means: "Relative recency bucket.",
        use_when: "Always for intent. Pair with sortBy=date for a true recency sweep.",
        effect: "raises_precision",
      },
      sortBy: {
        means: "'relevance' or 'date'.",
        use_when:
          "'relevance' when the topic is broad and the best matches matter; " +
          "'date' when the mission is a monitor and recency beats fit.",
        effect: "neutral",
      },
      contentType: {
        means: "Restrict to videos, images, jobs, documents and so on.",
        use_when: "Rarely. 'jobs' can surface hiring posts.",
        avoid_when:
          "Text intent — the default 'all' is right, and narrowing by medium " +
          "discards the plain text posts where problems are actually described.",
        effect: "changes_population",
      },
      scrapeComments: {
        means:
          "Return comments on each matched post, WITH the commenter's profile.",
        use_when:
          "THE COMMENT-INTENT MISSION. This is the only route to 'who commented " +
          "about X': the commenter's identity arrives attached to the comment.",
        avoid_when:
          "The mission only needs authors. Comments are billed at the price of a " +
          "post each and multiply against maxPosts.",
        effect: "changes_population",
        multiplies_cost: true,
      },
      commentsProfileScraperMode: {
        means: "'short' or 'main' profile detail for each commenter.",
        use_when:
          "'short' by default. 'main' is a second billable profile event per " +
          "commenter and is only worth it when ICP fit must be judged from the " +
          "profile rather than the headline.",
        effect: "neutral",
        multiplies_cost: true,
      },
      profileScraperMode: {
        means: "'short' or 'main' detail for post authors.",
        use_when: "'short' unless author ICP fit cannot be judged without more.",
        effect: "neutral",
        multiplies_cost: true,
      },
      scrapePages: {
        means: "Search pages to fetch. Each page is 100 posts, each billed.",
        use_when: "Never in a mission run — bound with maxPosts instead.",
        effect: "neutral",
        multiplies_cost: true,
      },
    },
    good_combinations: [
      { fields: ["searchQueries", "authorKeywords", "postedLimit", "sortBy"],
        why: "The role-scoped intent sweep: the topic in the query, the " +
          "decision-maker in the headline filter, a real window, and date order " +
          "when recency is the point. Finds founders discussing a problem " +
          "without buying a single person lookup." },
      { fields: ["searchQueries", "scrapeComments", "maxComments", "postedLimit"],
        why: "The comment-intent shape. The post supplies the TOPIC, the comment " +
          "supplies the PERSON and their words. Both halves are needed: a " +
          "comment without its parent post has no subject." },
      { fields: ["searchQueries", "authorsCompanies"],
        why: "Verification over a known company set — what are people at these " +
          "companies saying about this problem." },
    ],
    bad_combinations: [
      { fields: ["authorUrls", "searchQueries"],
        why: "Legal, and usually a mistake in discovery: restricting to known " +
          "authors turns a search that could find new people into a check on " +
          "people you already had." },
      { fields: ["scrapeComments", "commentsProfileScraperMode=main", "maxPosts"],
        why: "Three multipliers at once. 50 posts x 10 comments x a main-profile " +
          "event per commenter is over a thousand billable events from one call." },
      { fields: ["contentType", "searchQueries"],
        why: "Narrowing by medium on a text-intent search discards exactly the " +
          "plain posts where people describe problems." },
    ],
    recency_mapping:
      "Intent decays fastest of any signal here. A stated window maps to the " +
      "nearest containing bucket, and where the mission is silent 'month' is the " +
      "honest default — older activity is history rather than intent.",
    expensive_inputs: [
      "maxPosts (per query)",
      "maxComments (per post, at the price of a post)",
      "profileScraperMode / commentsProfileScraperMode = main (per profile)",
      "scrapePages (100 posts per page)",
    ],
    query_guidance: [
      "Search the PROBLEM in the customer's words, not the product in the " +
      "seller's. A service that fixes outbound would search how people describe " +
      "outbound failing, not its own category name.",
      "Generate SEVERAL short queries rather than one long one. LinkedIn " +
      "full-text ranks on the phrase, so 'reply rates have collapsed' and " +
      "'cold email stopped working' find different people who have the same " +
      "problem.",
      "Boolean OR is supported and is the cheapest way to widen a concept " +
      "without a second call.",
      "Quote a phrase only when the exact wording matters. Quoting a whole " +
      "sentence usually returns nothing.",
      "Never search the literal words of the REQUEST — 'looking for help' — " +
      "which is not how people write about a problem. Search what having the " +
      "problem sounds like.",
      "A question-shaped post ('how are you handling X in 2026') attracts more " +
      "practitioner comments than a claim-shaped one, so it is the better " +
      "target when the COMMENTERS are who you want rather than the author.",
    ],
    noisy_patterns: [
      "LinkedIn relevance is a text match, not a topic model: a post can rank " +
      "for a query without being about the concept. Every topic qualifier must " +
      "be re-checked against the post's own text before it counts.",
      "OBSERVED, run 6YHiwmXEcP933uqst: roughly ONE IN FOUR comments carried " +
      "real signal. One founder wrote \"three email campaigns earlier this " +
      "summer, not a single reply — I still can't tell you if that's channel, " +
      "list quality, or us\", which is genuine buying intent. The rest were " +
      "congratulation noise (\"say it louder\"), self-promotional links, and " +
      "near-identical AI-written engagement bait posted by two unrelated " +
      "accounts in almost the same words.",
      "OBSERVED: on a B2B problem query, most commenters SELL the solution — " +
      "headlines like \"Cold Email Specialist\" and \"B2B Lead Generation & " +
      "Outbound Specialist\". Fluency about a problem is as likely to mean " +
      "competitor as prospect, which is exactly why ICP fit is judged " +
      "separately from intent and signal alone never promotes a candidate.",
      "A comment reading as agreement (\"so true\", \"this\") is engagement, " +
      "not intent. Intent looks like someone describing THEIR OWN situation.",
    ],
  },

  // ── NEWS ──────────────────────────────────────────────────────────────────
  apify_google_news: {
    discovery_pattern:
      "Search the EVENT in the words a journalist would use, then resolve the " +
      "companies named in the results. Returns articles, never structured events.",
    verification_pattern:
      "Search the company NAME together with event terms to ask whether this " +
      "specific company was reported doing this thing.",
    filters: {
      keywords: {
        means:
          "Google News query. Supports quoted exact match, OR, -exclusion and " +
          "site: filters. One result set per keyword.",
        use_when:
          "Always for a company or event question — it is the primary input and " +
          "the only one that can name a subject.",
        effect: "raises_precision",
        multiplies_cost: true,
      },
      topics: {
        means: "Curated Google News sections (BUSINESS, TECHNOLOGY…).",
        use_when: "Broad market monitoring with no specific subject.",
        avoid_when:
          "Any company-specific question, and any recency requirement — a topic " +
          "page ignores `timeframe` entirely and serves its own curation.",
        effect: "lowers_precision",
      },
      timeframe: {
        means: "1h, 1d, 7d, 30d, 1y, all — KEYWORD SEARCHES ONLY.",
        use_when: "Every keyword search.",
        avoid_when:
          "Alongside `topics`, where the vendor documents it as ignored. Recency " +
          "must then be re-checked from each article's own date.",
        effect: "raises_precision",
      },
      region_language: {
        means: "Which Google News edition to query.",
        use_when:
          "The mission is regional. A European expansion story is often covered " +
          "in the local edition and missed by US:en.",
        effect: "changes_population",
      },
      maxArticles: {
        means: "Articles per keyword AND per topic. Billed per result.",
        use_when:
          "Always, and remember it multiplies across BOTH lists: three keywords " +
          "at 25 articles is 75 billable results, not 25.",
        effect: "neutral",
        multiplies_cost: true,
      },
      decodeUrls: {
        means: "Resolve Google redirects to the publisher URL.",
        use_when:
          "Always, and the compiler forces it. An undecodable link is a citation " +
          "nobody can check.",
        effect: "neutral",
      },
      extractDescriptions: {
        means: "Fetch each article's meta description.",
        use_when:
          "Always for signal work, and the compiler forces it. The description " +
          "carries the CLAIM, and a headline alone cannot distinguish a company " +
          "entering a market from a court system expanding its filing system.",
        effect: "raises_precision",
      },
    },
    good_combinations: [
      { fields: ["keywords", "timeframe", "region_language", "maxArticles"],
        why: "A bounded, dated, regionally-appropriate keyword sweep — the only " +
          "shape whose recency can be trusted." },
      { fields: ["keywords (company name + event terms)", "timeframe"],
        why: "The verification shape: quote the company name so the match is the " +
          "company rather than a word inside its name." },
    ],
    bad_combinations: [
      { fields: ["topics", "timeframe"],
        why: "The vendor states `timeframe` is ignored on topic pages, so the run " +
          "looks date-bounded and is not." },
      { fields: ["keywords (unquoted common word)", "maxArticles (high)"],
        why: "OBSERVED on run ak9nBcyYkolVrLQhM: an unquoted phrase search " +
          "returned a court system 'expanding into family courts' and a company " +
          "'expanding deeper into AI'. Roughly half the rows were not the signal." },
    ],
    recency_mapping:
      "Days map to the nearest containing bucket (30 days -> '30d'), then each " +
      "article's own `publishedAt` is re-checked — the buckets are coarse and " +
      "topic pages ignore them entirely.",
    expensive_inputs: ["maxArticles (per keyword AND per topic)"],
    query_guidance: [
      "Quote the company name when verifying, or the match is any article " +
      "containing that word.",
      "Combine event synonyms with OR — 'opens office' OR 'new office' OR " +
      "'expands into' — rather than running several calls.",
      "Exclude with '-' where a term is systematically ambiguous.",
    ],
    noisy_patterns: [
      "Google News matches the PHRASE, not the meaning. Metaphorical uses " +
      "('expanding into AI') and non-company subjects rank equally with real " +
      "corporate events, so every article's claim must be read before it counts.",
    ],
  },

  // ── TECHNOLOGY ────────────────────────────────────────────────────────────
  apify_builtwith_technology: {
    verification_pattern:
      "Given domains already held, ask what each one runs, then match the " +
      "mission's named technology against the returned stack. There is no " +
      "discovery counterpart and there cannot be one.",
    filters: {
      startDomains: {
        means: "Root domains to inspect. One result per domain.",
        use_when:
          "Always — it is the only input. Domains must already be known, which " +
          "in practice means enrichment has run.",
        avoid_when:
          "Any attempt to search. There is no query field: 'who uses Shopify' " +
          "cannot be asked, only 'does this domain use Shopify'.",
        effect: "neutral",
        multiplies_cost: true,
      },
      maxRequestsPerCrawl: {
        means: "Crawl request ceiling. The published DEFAULT is 10,000,000.",
        use_when:
          "Always, explicitly. Inheriting the default is the single largest " +
          "unbounded-spend risk in the catalog.",
        effect: "neutral",
      },
    },
    good_combinations: [
      { fields: ["startDomains", "maxRequestsPerCrawl"],
        why: "The only shape there is: a bounded domain list and an explicit cap." },
    ],
    bad_combinations: [
      { fields: ["startDomains (large list)"],
        why: "OBSERVED: 120-260 technologies per domain. The cost is per domain, " +
          "so the risk is payload rather than money — match the requested " +
          "technology rather than storing whole stacks." },
    ],
    recency_mapping:
      "NONE. A detection is present-tense and carries no adoption date, so a " +
      "recency qualifier on a technology signal is reported unhonoured rather " +
      "than silently satisfied.",
    expensive_inputs: ["startDomains (one billable result per domain)"],
    noisy_patterns: [
      "A detected technology is not an endorsement: a tag can be a vestigial " +
      "script. And 'AI' appears as a CATEGORY inside techs[], not as a " +
      "technology name — an AI-adoption question must read the categories.",
    ],
  },
});

/** The strategy for one actor, or null when none is recorded. */
export function inputStrategyFor(actorKey: string): ActorInputStrategy | null {
  return ACTOR_INPUT_STRATEGIES[actorKey] ?? null;
}

/** Actor keys carrying a strategy. */
export function actorsWithInputStrategy(): string[] {
  return Object.keys(ACTOR_INPUT_STRATEGIES);
}

/**
 * Every field named by a strategy that the actor's own contract does not accept.
 *
 * The guard against advice for a filter that does not exist. Strategy prose is
 * persuasive to a model, so a field invented here would be reached for and
 * refused by the compiler — an expensive round trip caused by our own document.
 * Asserted in `actorInputStrategy.test.ts`.
 */
export function strategyFieldsNotInContract(
  contractFields: Readonly<Record<string, readonly string[]>>,
): Array<{ actor_key: string; unknown_fields: string[] }> {
  const out: Array<{ actor_key: string; unknown_fields: string[] }> = [];
  for (const [actor_key, strategy] of Object.entries(ACTOR_INPUT_STRATEGIES)) {
    const known = new Set(contractFields[actor_key] ?? []);
    if (known.size === 0) continue;
    const unknown_fields = Object.keys(strategy.filters).filter((f) => !known.has(f));
    if (unknown_fields.length) out.push({ actor_key, unknown_fields });
  }
  return out;
}
