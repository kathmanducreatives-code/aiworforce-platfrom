// ICP FIT AND INTENT FIT ARE TWO QUESTIONS, AND A MISSION MUST CARRY BOTH.
//
// ── WHAT THESE FIXTURES ARE FOR ─────────────────────────────────────────────
//
// The missions below are the ones a user actually asks:
//
//   "Find 5 founders matching my ICP whose recent LinkedIn comments show pain
//    around outbound lead generation."
//
// That sentence contains an ICP (who), a person subject (founders), a signal
// (comment), a topic (outbound pain), and a recency ("recent"). Every one of
// those has to survive into the mission, the capability choice and the bounded
// actor input — and the audit began because two thirds of exactly this kind of
// sentence used to vanish before anything ran.
//
// THE INDUSTRIES AND TOPICS HERE ARE FIXTURES, NOT ROUTING. No production
// branch reads "cybersecurity" or "outbound"; these exist to prove the SHAPE
// survives regardless of subject, which test 8 checks directly.
//
// PURE. No network, no Actor run, no model call.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  readSignalsFromQuery, describeSignal,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import {
  coverMissionSignals,
} from "../../../supabase/functions/_shared/signalActorCoverage.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  resolveSignalSupport,
} from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import {
  ACTOR_INPUT_STRATEGIES, inputStrategyFor, strategyFieldsNotInContract,
} from "../../../supabase/functions/_shared/actorInputStrategy.ts";
import {
  ACTOR_INPUT_CONTRACTS,
} from "../../../supabase/functions/_shared/actorInputContracts.ts";
import {
  compilePostSearchInput, compileProfilePostsInput, compileCompanyPostsInput,
  compileGoogleNewsInput, compileDatahyenaFundingInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  combinedPriority, rankAll, rankCandidate, assessmentViolations,
  type IcpAssessment, type IntentAssessment,
} from "../../../supabase/functions/_shared/icpIntentSeparation.ts";

/**
 * The realistic missions. `person_subject` means the SIGNAL is about a person,
 * which is the distinction that decides whether an unlock is required.
 */
const MISSIONS: ReadonlyArray<{
  query: string;
  event: string;
  person_subject: boolean;
  topic_expected: boolean;
}> = [
  { query: "Find 5 founders matching my ICP who have recently posted about the problem my product solves.",
    event: "post", person_subject: true, topic_expected: true },
  { query: "Find 5 founders matching my ICP whose recent LinkedIn comments show pain around outbound lead generation.",
    event: "comment", person_subject: true, topic_expected: true },
  { query: "Find cybersecurity founders in Europe discussing expansion into the US.",
    event: "post", person_subject: true, topic_expected: true },
  { query: "Find companies matching my ICP whose LinkedIn page is talking about AI adoption.",
    event: "post", person_subject: false, topic_expected: true },
];

// ═══════════════ 1-3. THE MISSION SURVIVES INTACT ══════════════════════════

Deno.test("1. every realistic mission keeps its event, subject and topic", () => {
  for (const m of MISSIONS) {
    const signals = readSignalsFromQuery(m.query);
    const sig = signals.find((s) => s.event === m.event);
    assert(sig, `"${m.query}" produced no ${m.event}: ${JSON.stringify(signals.map((x) => x.event))}`);

    assertEquals(sig!.subject === "leadership", m.person_subject,
      `"${m.query}" -> ${m.event} subject was ${sig!.subject}`);

    if (m.topic_expected) {
      assert(sig!.qualifier.topic, `"${m.query}" lost the topic it is about`);
    }
  }
});

Deno.test("2. a person-subject mission is reported as awaiting authorisation, never as impossible", () => {
  // The distinction that tells a user they can DO something. A leadership post
  // and a founder comment are both reachable — behind an unlock they may accept.
  for (const m of MISSIONS.filter((x) => x.person_subject)) {
    const mission = parseLeadMissionDeterministic(m.query);
    const cov = coverMissionSignals(mission);
    const plan = buildCapabilityGraph(mission);

    assertFalse(cov.fully_covered, `"${m.query}" must not claim full coverage`);
    const sig = cov.signals.find((s) => s.signal === m.event)!;
    assertEquals(sig.status, "requires_unlock",
      `"${m.query}" -> ${m.event} reported ${sig.status}`);

    assert(cov.dependencies.some((d) => d.capability === "offer_founder_unlock"));
    assert(plan.offered_capabilities.includes("offer_founder_unlock"));

    // AND NOTHING PERSON-LEVEL IS EVER SCHEDULED.
    for (const step of plan.steps) {
      assertFalse(
        ["founder_discovery", "employer_verification", "contact_enrichment"]
          .includes(step.capability),
        `"${m.query}" scheduled a people stage: ${step.capability}`);
    }
    // No unlock-gated Actor may be presented as runnable work.
    assertFalse(cov.runnable_actors.includes("apify_linkedin_post_search"));
    assertFalse(cov.runnable_actors.includes("apify_linkedin_profile_posts"));
  }
});

Deno.test("3. a company-page mission runs outright, with no unlock", () => {
  const mission = parseLeadMissionDeterministic(
    "Find companies matching my ICP whose LinkedIn page is talking about AI adoption.");
  const cov = coverMissionSignals(mission);
  const sig = cov.signals.find((s) => s.signal === "post")!;

  assertEquals(sig.status, "covered");
  assert(cov.runnable_actors.includes("apify_linkedin_company_posts"));
  assertEquals(cov.dependencies.length, 0, "a company page needs no person unlock");
});

// ═══════════════ 4-6. THE ACTOR-INPUT KNOWLEDGE IS TRUTHFUL ════════════════

Deno.test("4. no strategy names a filter the real schema does not accept", () => {
  // Strategy prose is persuasive to a model. A filter invented here would be
  // reached for, refused by the compiler, and the round trip would be caused by
  // our own document.
  const contractFields: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(ACTOR_INPUT_CONTRACTS)) {
    contractFields[k] = v.fields.map((f) => f.name);
  }
  assertEquals(strategyFieldsNotInContract(contractFields), []);
});

Deno.test("5. every strategy states the judgement a schema cannot", () => {
  for (const [key, s] of Object.entries(ACTOR_INPUT_STRATEGIES)) {
    assert(Object.keys(s.filters).length > 0, `${key}: no filter guidance`);
    assert(s.good_combinations.length > 0, `${key}: no working combination`);
    assert(s.bad_combinations.length > 0,
      `${key}: no harmful combination — every actor has at least one`);
    assert(s.recency_mapping.length > 30, `${key}: recency mapping is too thin`);
    assert(s.noisy_patterns.length > 0, `${key}: no noise pattern recorded`);
    assert(s.discovery_pattern || s.verification_pattern,
      `${key}: neither a discovery nor a verification pattern`);

    // A filter entry that says only what the field is repeats the schema.
    for (const [field, f] of Object.entries(s.filters)) {
      assert(f.means.length > 15, `${key}.${field}: no meaning`);
      assert(f.use_when.length > 15, `${key}.${field}: no guidance on when to use it`);
    }
  }
});

Deno.test("6. verification-only actors carry no discovery pattern, and vice versa", () => {
  // The line that stops a model planning discovery through a source that
  // consumes the very identity it would need to find.
  assertEquals(inputStrategyFor("apify_builtwith_technology")!.discovery_pattern, undefined);
  assertEquals(inputStrategyFor("apify_linkedin_company_posts")!.discovery_pattern, undefined);
  assertEquals(inputStrategyFor("apify_linkedin_profile_posts")!.discovery_pattern, undefined);

  // Funding can find and cannot check.
  const funding = inputStrategyFor("apify_funding_rounds_datahyena")!;
  assert(funding.discovery_pattern);
  assertEquals(funding.verification_pattern, undefined);

  // The topic search does both, and says so.
  const search = inputStrategyFor("apify_linkedin_post_search")!;
  assert(search.discovery_pattern && search.verification_pattern);
});

// ═══════════════ 7. THE INPUTS A MISSION IMPLIES ARE COMPILABLE ════════════

Deno.test("7. the input a realistic mission implies compiles and is bounded", () => {
  // These are the shapes the strategy guidance points a planner toward. They are
  // written here as a planner would emit them, and the deterministic compilers
  // are what actually accept or refuse them.

  // "founders posting about a problem" — role in the headline filter, topic in
  // the query, a real window, date order.
  const founderPosts = compilePostSearchInput({
    searchQueries: [
      "cold email reply rates collapsed",
      "outbound is not working anymore",
    ],
    authorKeywords: "Founder CEO",
    postedLimit: "month",
    sortBy: "date",
    maxPosts: 25,
  });
  assert(founderPosts.ok, JSON.stringify(!founderPosts.ok ? founderPosts.errors : []));

  // "founder COMMENTS showing pain" — the same search, plus comments, which is
  // the only route to a commenter's identity.
  const founderComments = compilePostSearchInput({
    searchQueries: ["how are you handling outbound in 2026"],
    postedLimit: "month",
    maxPosts: 15,
    scrapeComments: true,
    maxComments: 10,
    commentsProfileScraperMode: "short",
  });
  assert(founderComments.ok);
  assert(founderComments.ok &&
    founderComments.warnings.some((w) => /billable items/.test(w)),
    "the multiplied cost of comments must be stated up front");

  // "company page talking about AI adoption" — identity first, then read posts.
  const companyPosts = compileCompanyPostsInput({
    targetUrls: ["https://www.linkedin.com/company/stripe"],
    maxPosts: 20,
    postedLimit: "3months",
  });
  assert(companyPosts.ok);

  // "recently funded founders scaling sales" — funding discovery bounded by a
  // real window, then the people half waits for an unlock.
  const funding = compileDatahyenaFundingInput({
    since: "2026-06-01", verticals: ["saas"], maxItems: 40,
  });
  assert(funding.ok);

  // "expansion into the US" — quoted event language, dated, regional edition.
  const news = compileGoogleNewsInput({
    keywords: ['"expands into" OR "opens office" OR "enters the US"'],
    timeframe: "30d", region_language: "US:en", maxArticles: 25,
  });
  assert(news.ok);
});

Deno.test("7b. a person-scoped read still refuses a company URL, whatever the strategy says", () => {
  // The guidance is advice; the compiler is the boundary. No amount of strategy
  // prose can talk a company URL into a person-scoped capability.
  assertFalse(compileProfilePostsInput({
    targetUrls: ["https://www.linkedin.com/company/stripe"], maxPosts: 10,
  }).ok);
});

// ═══════════════ 8. NO MISSION-SPECIFIC ROUTING ════════════════════════════

Deno.test("8. the plan's shape does not depend on the industry or topic named", () => {
  // Four industries, one requirement shape. A production branch that
  // special-cased any of these subjects would show up as a diverging plan.
  const shapes = [
    "Find cybersecurity founders in Europe discussing expansion into the US.",
    "Find logistics founders in Europe discussing expansion into the US.",
    "Find healthcare founders in Europe discussing expansion into the US.",
  ].map((q) => {
    const m = parseLeadMissionDeterministic(q);
    return {
      steps: buildCapabilityGraph(m).steps.map((s) => s.capability).join(" -> "),
      statuses: coverMissionSignals(m).signals.map((s) => s.status).join(","),
    };
  });
  for (const s of shapes) {
    assertEquals(s.steps, shapes[0].steps);
    assertEquals(s.statuses, shapes[0].statuses);
  }
});

// ═══════════════ 9-12. ICP AND INTENT STAY SEPARATE ════════════════════════

const icp = (verdict: IcpAssessment["verdict"], met: string[] = ["industry"]): IcpAssessment => ({
  verdict, dimensions_met: met, dimensions_failed: [], dimensions_unknown: [],
  evidence: verdict === "insufficient_evidence" ? []
    : [{ kind: "firmographic", url: null, dated_at: null }],
  reason: "fixture",
});
const intent = (
  verdict: IntentAssessment["verdict"], age: number | null = 5,
): IntentAssessment => ({
  verdict, subject: "leadership", topic: "outbound", age_days: age,
  evidence: verdict === "insufficient_evidence" || verdict === "none" ? []
    : [{ kind: "comment", url: "https://x/1", dated_at: "2026-08-17T00:00:00Z" }],
  reason: "fixture",
});

Deno.test("9. a strong signal from outside the ICP is never promoted", () => {
  // The rule that keeps market research out of a prospect list.
  assertEquals(combinedPriority(icp("poor"), intent("explicit")), "signal_outside_icp");
  assertEquals(combinedPriority(icp("strong"), intent("explicit")), "priority");
  assertEquals(combinedPriority(icp("strong"), intent("topical_only")), "warm");
  assertEquals(combinedPriority(icp("strong"), intent("none")), "icp_only");
  assertEquals(combinedPriority(icp("poor"), intent("none")), "not_qualified");
});

Deno.test("10. an unjudged half is reported unjudged, never rounded to zero", () => {
  // Rounding "we could not tell" down to "no" is how a missing capability turns
  // into a negative verdict about a real company.
  assertEquals(
    combinedPriority(icp("insufficient_evidence"), intent("explicit")),
    "insufficient_evidence");
  assertEquals(
    combinedPriority(icp("strong"), intent("insufficient_evidence")),
    "insufficient_evidence");
});

Deno.test("11. recency orders within a band and never lifts one", () => {
  const fresh = rankCandidate(icp("poor"), intent("explicit", 1));
  const stale = rankCandidate(icp("strong"), intent("implied", 200));
  const ranked = rankAll([fresh, stale]);

  // The stale in-ICP lead outranks the fresh out-of-ICP one, however recent.
  assertEquals(ranked[0].band, "priority");
  assertEquals(ranked[1].band, "signal_outside_icp");

  // Within one band, fresher wins.
  const a = rankCandidate(icp("strong"), intent("implied", 30));
  const b = rankCandidate(icp("strong"), intent("implied", 2));
  assertEquals(rankAll([a, b])[0].intent.age_days, 2);
});

Deno.test("12. a verdict without evidence, or intent without a date, is a violation", () => {
  // The whole architecture rests on the difference between a finding and an
  // opinion, and this is where that line is drawn for the semantic layer.
  const noEvidence: IcpAssessment = { ...icp("strong"), evidence: [] };
  assert(assessmentViolations(noEvidence, intent("implied"))
    .includes("icp_verdict_without_evidence"));

  const undated: IntentAssessment = {
    ...intent("explicit"),
    evidence: [{ kind: "comment", url: "https://x/1", dated_at: null }],
  };
  assert(assessmentViolations(icp("strong"), undated)
    .includes("intent_claimed_without_a_dated_artifact"));

  // A person's intent cannot be evidenced by a firmographic record.
  const wrongKind: IntentAssessment = {
    ...intent("implied"),
    evidence: [{ kind: "firmographic", url: null, dated_at: "2026-08-17" }],
  };
  assert(assessmentViolations(icp("strong"), wrongKind)
    .includes("person_intent_cited_from_firmographic_evidence"));

  // A clean pair produces no violations.
  assertEquals(assessmentViolations(icp("strong"), intent("implied")), []);
});

// ═══════════════ 13. THE QUERY GUIDANCE SAYS THE IMPORTANT THING ═══════════

Deno.test("13. the topic-search guidance tells the planner NOT to search the request's words", () => {
  // The single most important piece of query advice: a user asking for people
  // "looking for help" must not produce a search for the phrase "looking for
  // help", which is not how anyone writes about having a problem.
  const g = inputStrategyFor("apify_linkedin_post_search")!.query_guidance!;
  assert(g.some((x) => /looking for help/.test(x) && /never/i.test(x)),
    "the guidance must warn against searching the request's own words");
  assert(g.some((x) => /problem/i.test(x) && /customer|their own words|seller/i.test(x)),
    "the guidance must point at the problem in the customer's words");
  assert(g.some((x) => /OR/.test(x)), "Boolean widening must be described");
});
