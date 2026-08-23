// WHAT A MISSION MAY CLAIM TO HAVE ANSWERED.
//
// ── THE DEFECT THIS FILE PINS ────────────────────────────────────────────────
//
// Ten structural missions were run through the real parser, graph builder and
// coverage reporter during the Phase 0 audit. Every single one reported
// `fully_covered: true`, including:
//
//   "Find logistics companies showing GTM headcount growth"   → signals: []
//   "Find CEOs commenting on sales automation"                → signals: []
//   "Find companies that recently launched a new product"     → signals: []
//
// Nothing was lying about the signals it held. The problem was the ones it
// never received: a requirement the vocabulary could not express did not become
// an uncovered signal, it ceased to exist — and `coverMissionSignals` treats a
// mission with no signals as covered by definition. A discarded requirement and
// a satisfied one produced the same report.
//
// The flagship was the clearest case. "Find 15 cybersecurity companies in
// Europe hiring enterprise sellers and whose leadership has recently posted
// about US expansion" reduced to `required_signals: [{type:"hiring"}]` — two
// thirds of the request gone — and reported full coverage.
//
// A second, quieter defect sat beside it: `covered` meant "a source is
// described", not "a capability may call it". Funding was reported covered
// while `runnable_actors` was empty.
//
// These tests are the audit, promoted. They assert the HONESTY of the verdict,
// never a particular number of results.
//
// PURE. No network, provider, model or database access.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, unrepresentableEvidence,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  buildCapabilityGraph, isCapabilitySupported, unsupportedCapabilities,
  capabilitiesClaimingUnproducibleEvidence, CAPABILITY_IDS,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  coverMissionSignals,
} from "../../../supabase/functions/_shared/signalActorCoverage.ts";
import {
  SCENARIO_MATRIX, scenarioIsExecutable, scenarioIsServable,
  executableScenarioActors,
} from "../../../supabase/functions/_shared/discoveryScenarioMatrix.ts";

/**
 * The evaluation fixtures.
 *
 * DELIBERATELY VARIED BY INDUSTRY, and deliberately NOT reachable from
 * production routing — no industry named here appears in any branch that
 * selects a capability or an Actor. They exist to prove the opposite: that the
 * plan's SHAPE does not depend on the industry in the sentence.
 *
 * `answerable` means every requirement in the sentence has a runnable source
 * today. Only the pure-hiring missions do.
 */
const FIXTURES: ReadonlyArray<{ query: string; answerable: boolean; because: string }> = [
  {
    query: "Find 15 cybersecurity companies in Europe hiring enterprise sellers " +
      "and whose leadership has recently posted about US expansion.",
    answerable: false,
    because: "leadership post activity is a person-level signal with no capability",
  },
  { query: "Find fintech startups in the UK hiring SDRs.", answerable: true,
    because: "role-specific hiring is genuinely supported" },
  { query: "Find cybersecurity companies in Germany hiring enterprise AEs.", answerable: true,
    because: "role-specific hiring is genuinely supported" },
  // PHASE 5: news is carded, and a dated article stating a new market IS the
  // evidence. The old provider was a company-NAME matcher wearing the label.
  { query: "Find European SaaS companies expanding into the US.", answerable: true,
    because: "expansion runs on dated news articles since Phase 5" },
  // PHASE 4. This was the clearest capability gap in the audit and is now a
  // real, executable capability: `apify_funding_rounds_datahyena` discovers
  // companies BY a dated funding round.
  { query: "Find recently funded B2B SaaS companies.", answerable: true,
    because: "funding discovery is carded, compiled and engine-driven since Phase 4" },
  { query: "Find AI companies whose company page recently posted about enterprise hiring.",
    answerable: true, because: "the company-post source is carded and company-scoped" },
  { query: "Find founders discussing AI adoption.", answerable: false,
    because: "a founder's post is person-authored and awaits an unlock" },
  // Comments ARE produced — post search returns them with commenter profiles.
  // Still not answerable without authorisation: the evidence identifies people.
  { query: "Find CEOs commenting on sales automation.", answerable: false,
    because: "comment evidence identifies a person, so it awaits an unlock" },
  { query: "Find logistics companies showing GTM headcount growth.", answerable: false,
    because: "growth needs history nothing stores" },
  { query: "Find companies that recently launched a new product.", answerable: true,
    because: "a dated article naming the launch is carded evidence since Phase 5" },
];

// ═══════════════════════════════════ 1. the verdict must be honest ══════════

Deno.test("1. THE DEFECT: an unanswerable mission never reports full coverage", () => {
  // The single assertion that would have caught the audit's headline finding.
  // Before this change all ten fixtures returned true.
  const claimedComplete: string[] = [];
  for (const f of FIXTURES) {
    const m = parseLeadMissionDeterministic(f.query);
    const r = coverMissionSignals(m);
    if (r.fully_covered !== f.answerable) {
      claimedComplete.push(
        `${f.query}\n    expected fully_covered=${f.answerable} (${f.because}), got ${r.fully_covered}`,
      );
    }
  }
  assertEquals(claimedComplete, [], `\n${claimedComplete.join("\n")}`);
});

Deno.test("2. an incomplete mission always says WHY, in a sentence a person can act on", () => {
  for (const f of FIXTURES) {
    if (f.answerable) continue;
    const r = coverMissionSignals(parseLeadMissionDeterministic(f.query));
    assert(r.shortfall_statement.length > 0,
      `"${f.query}" is incomplete and said nothing about it`);
    // Never a bare verdict: the sentence has to name the obstacle, or the user
    // asks for more candidates when the answer is that none were ever sought.
    assert(r.shortfall_statement.length > 60,
      `the shortfall for "${f.query}" is too thin to act on: ${r.shortfall_statement}`);
  }
});

Deno.test("3. a requirement the vocabulary could not express is REPRESENTED now, and still honest", () => {
  // ── WHAT CHANGED UNDER THIS TEST, AND WHY IT IS BETTER ────────────────────
  //
  // These three fixtures used to reach coverage with `required_signals: []` and
  // were rescued by a prose note on the mission. They are now READ: the signal
  // vocabulary has `post`, `comment` and `headcount_change`, and a subject that
  // separates a company page from its CEO.
  //
  // Representation is not support. Each is reported as a capability gap with
  // its own reason — a strictly better answer than the note, because it names
  // the missing source instead of only the missing word.
  const cases: Array<[string, string, string]> = [
    ["Find CEOs commenting on sales automation.", "comment", "leadership"],
    ["Find logistics companies showing GTM headcount growth.", "headcount_change", "company"],
  ];

  for (const [q, event, subject] of cases) {
    const m = parseLeadMissionDeterministic(q);
    const sig = m.required_signals.find((x) => x.event === event);
    assert(sig, `"${q}" produced no ${event} requirement: ${JSON.stringify(m.required_signals)}`);
    assertEquals(sig!.subject, subject);

    const r = coverMissionSignals(m);
    assertFalse(r.fully_covered, `"${q}" must not claim full coverage`);
    const cov = r.signals.find((x) => x.signal === event)!;
    assert(
      cov.status === "capability_gap" || cov.status === "requires_unlock",
      `"${q}" -> ${event} reported ${cov.status}`,
    );
    assert((cov.limitation ?? "").length > 40, "a gap must carry its reason");
  }
});

Deno.test("3b. a person-level requirement declares its unlock dependency", () => {
  // The honest middle: not spent automatically, not dropped for lack of an
  // automatic route. The plan offers the unlock and says what it is for.
  const m = parseLeadMissionDeterministic("Find CEOs commenting on sales automation.");
  const r = coverMissionSignals(m);

  assert(r.dependencies.some((d) => d.capability === "offer_founder_unlock"),
    "a person-level signal must declare the identity unlock it depends on");

  const plan = buildCapabilityGraph(m);
  assert(plan.offered_capabilities.includes("offer_founder_unlock"));
  // An offer runs nothing: no people stage may appear as a step.
  for (const step of plan.steps) {
    assertFalse(
      ["founder_discovery", "employer_verification", "contact_enrichment"]
        .includes(step.capability),
      `a people stage was scheduled: ${step.capability}`,
    );
  }
});

Deno.test("4. a mission that genuinely asks for nothing extra is still fully covered", () => {
  // The guard against over-correction: the fix must not make every mission
  // report a shortfall. A pure hiring request is answerable and says so.
  const r = coverMissionSignals(
    parseLeadMissionDeterministic("Find fintech startups in the UK hiring SDRs."));
  assert(r.fully_covered);
  assertEquals(r.shortfall_statement, "");
  assertEquals(r.unrepresented_requirements, []);
});

Deno.test("5. the unrepresentable detector fires only on evidence with no signal type", () => {
  // The table shrank deliberately. Comments, leadership posts, company posts
  // and headcount growth all graduated into `SIGNAL_EVENTS`, so keeping them
  // here would have produced two sentences about one requirement — one of them
  // saying it "was not represented at all" while it demonstrably was.
  //
  // What remains is evidence the vocabulary genuinely cannot express, so a
  // novel request still cannot vanish into a mission with no signals.
  assertEquals(unrepresentableEvidence("Find B2B SaaS companies hiring RevOps"), []);
  assertEquals(unrepresentableEvidence("Find recently funded cybersecurity companies"), []);
  assertEquals(unrepresentableEvidence("Find CEOs commenting on sales automation"), [],
    "comments are representable now, so the note must not fire");
  assertEquals(unrepresentableEvidence(""), []);

  assert(unrepresentableEvidence("companies with great Glassdoor reviews").length > 0);
  assert(unrepresentableEvidence("companies with growing web traffic").length > 0);
});

// ═══════════════════════════ 6-8. covered means runnable ════════════════════

Deno.test("6. THE DEFECT: 'covered' is never claimed without a runnable actor", () => {
  // Funding used to be `covered` with an empty `runnable_actors`. Asserted over
  // every signal in the vocabulary so a new one cannot reintroduce it.
  for (const f of FIXTURES) {
    const r = coverMissionSignals(parseLeadMissionDeterministic(f.query));
    for (const sig of r.signals) {
      if (sig.status !== "covered") continue;
      const runnable = sig.scenarios.flatMap((id) =>
        SCENARIO_MATRIX[id] ? executableScenarioActors(SCENARIO_MATRIX[id]).runnable : []);
      assert(runnable.length > 0,
        `"${sig.signal}" is reported covered but no capability can call any of its actors`);
    }
  }
});

Deno.test("7. a known-but-unreachable source is a capability gap, not a dead end", () => {
  // The distinction that tells a user which of the two answers they got: "no
  // source exists" versus "the source exists and nothing may call it".
  //
  // Funding was the first example, then a leadership post; both have sources
  // now. Headcount growth is the genuine remaining gap, and its cause is
  // different in kind: no provider is missing, a STORED HISTORY is. Growth is a
  // delta over two dated readings and nothing keeps them.
  const r = coverMissionSignals(parseLeadMissionDeterministic(
    "Find logistics companies showing headcount growth."));
  const hc = r.signals.find((s) => s.signal === "headcount_change")!;

  assertEquals(hc.status, "capability_gap");
  assertFalse(r.fully_covered);
  assert((hc.limitation ?? "").length > 40, "the gap must carry its reason");
});

Deno.test("7b. PHASE 4: funding is a real capability, with a runnable source", () => {
  const r = coverMissionSignals(
    parseLeadMissionDeterministic("Find recently funded B2B SaaS companies."));
  const funding = r.signals.find((s) => s.signal === "funding")!;

  assertEquals(funding.status, "covered");
  assert(r.runnable_actors.includes("apify_funding_rounds_datahyena"),
    "the funding source must be runnable, not merely described");
  assert(r.fully_covered);
  assertEquals(r.shortfall_statement, "");
});

Deno.test("8. servable and executable are separate facts, and the matrix reports both", () => {
  // `scenarioIsServable` is knowledge; `scenarioIsExecutable` is permission.
  // At least one scenario must sit between them, or the distinction is dead
  // code and the capability-gap status can never be produced.
  const between = Object.values(SCENARIO_MATRIX)
    .filter((s) => scenarioIsServable(s) && !scenarioIsExecutable(s));
  assert(between.length > 0,
    "no scenario is servable-but-not-executable; the gap status would be unreachable");

  // Executable implies servable, always. The reverse is what varies.
  for (const s of Object.values(SCENARIO_MATRIX)) {
    if (scenarioIsExecutable(s)) {
      assert(scenarioIsServable(s), `${s.id} is executable but not servable`);
    }
  }
});

// ═════════════════ 9-11. an unsupported capability runs nothing ═════════════

Deno.test("9. no capability claims evidence its providers cannot produce", () => {
  // ── WHAT THIS ASSERTED BEFORE, AND WHY THE SHAPE CHANGED ──────────────────
  //
  // Three capabilities were `supported: false` because their declared providers
  // could not keep their evidence claims. All three were repaired in Phases 4
  // and 5 by giving them providers that can — funding got a funding source,
  // expansion got news — so the unsupported list is now EMPTY.
  //
  // An empty list is not an excuse to delete the guard: it is the state the
  // guard exists to maintain. The derivation still runs over every capability,
  // and a fourth bad claim fails here.
  assertEquals(capabilitiesClaimingUnproducibleEvidence(), []);
  assertEquals(unsupportedCapabilities(), []);
  for (const c of CAPABILITY_IDS) assert(isCapabilitySupported(c));
});

Deno.test("10. an unsupported capability, if one ever returns, is never scheduled", () => {
  // The mechanism, exercised directly now that no capability is flagged. If a
  // future provider set cannot keep a claim, the flag must still keep that
  // capability out of every plan — so the rule is asserted as a property of
  // `buildCapabilityGraph` rather than as a fact about today's registry.
  const unsupported = new Set(unsupportedCapabilities().map((s) => s.id));
  for (const f of FIXTURES) {
    const plan = buildCapabilityGraph(parseLeadMissionDeterministic(f.query));
    assertFalse(unsupported.has(plan.entry_capability));
    for (const step of plan.steps) assertFalse(unsupported.has(step.capability));
    // And every scheduled capability must have at least one provider, or the
    // step is a promise nothing can keep.
    for (const step of plan.steps) {
      if (step.capability === "persistence" ||
          step.capability === "company_brain_qualification" ||
          step.capability === "known_company_resolution" ||
          step.capability === "employer_verification" ||
          step.capability === "job_deduplication") continue;
      assert(step.providers.length > 0, `${step.capability} is scheduled with no provider`);
    }
  }
});

Deno.test("11. a person-level requirement is TOLD it needs authorisation, never rerouted", () => {
  // The Phase 5 successor to "a mission wanting an unsupported capability is
  // told". Nothing is unsupported now, but person-authored evidence is gated —
  // and a mission that needs it must surface the offer rather than quietly
  // answering with company evidence instead.
  for (const q of [
    "Find companies whose CEO recently posted about US expansion.",
    "Find CEOs commenting on sales automation.",
  ]) {
    const m = parseLeadMissionDeterministic(q);
    const r = coverMissionSignals(m);
    const plan = buildCapabilityGraph(m);

    assertFalse(r.fully_covered, `"${q}" must not claim full coverage`);
    assert(r.dependencies.some((d) => d.capability === "offer_founder_unlock"));
    assert(plan.offered_capabilities.includes("offer_founder_unlock"));

    // AND THE COMPANY SOURCE MUST NOT BE SUBSTITUTED IN. A company page posting
    // is not a CEO posting, and answering the second with the first is the
    // substitution the subject boundary exists to prevent.
    const person = r.signals.find((s) => s.status === "requires_unlock")!;
    assertFalse(person.actors.includes("apify_linkedin_company_posts"));
  }
});

// ═════════════════════════ 12. no mission-specific routing ══════════════════

Deno.test("12. the plan's shape does not depend on the industry in the sentence", () => {
  // The guard against hardcoded routing. Four industries, one requirement
  // shape: the capability sequence must be identical. A production branch that
  // special-cased any of these names would show up here as a diverging plan.
  const shapes = [
    "Find cybersecurity companies in Germany hiring enterprise AEs.",
    "Find fintech companies in Germany hiring enterprise AEs.",
    "Find logistics companies in Germany hiring enterprise AEs.",
    "Find healthcare companies in Germany hiring enterprise AEs.",
  ].map((q) => buildCapabilityGraph(parseLeadMissionDeterministic(q))
    .steps.map((s) => s.capability).join(" -> "));

  for (const s of shapes) assertEquals(s, shapes[0]);
});
