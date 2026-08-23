// A CAPABILITY MAY NOT CLAIM EVIDENCE ITS PROVIDERS CANNOT PRODUCE.
//
// ── WHY THIS FILE IS THE BUILD-TIME GUARD ───────────────────────────────────
//
// `CAPABILITY_REGISTRY` states what a capability produces and, separately, which
// Actors it may call. Nothing checked that the second could deliver the first,
// and three entries could not:
//
//   funding_signal_discovery      claims funding_signal, calls a YC directory
//                                 scraper with no funding field in its schema
//   expansion_signal_discovery    claims to enumerate expanding companies, calls
//                                 a company-NAME matcher
//   expansion_signal_verification claims expansion evidence, calls a JOB search
//
// Phase 1 marked those three by hand. Hand-marking fixes three and prevents
// none, because the claim and the provider still live apart. `ACTOR_EVIDENCE`
// records what each executable Actor genuinely produces, so the join is
// COMPUTED here — and a fourth such claim fails this test rather than reaching
// a plan.
//
// PURE. No network, provider, model or database access.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACTOR_EVIDENCE, actorTableDrift, evidenceProducedBy, executableActorKeys,
  resolveSignalSupport, supportedEvidencePairs,
} from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import {
  CAPABILITY_REGISTRY, buildCapabilityGraph,
  capabilitiesClaimingUnproducibleEvidence, isCapabilitySupported,
  unsupportedCapabilities,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  describeSignal, readSignalsFromQuery,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  coverMissionSignals,
} from "../../../supabase/functions/_shared/signalActorCoverage.ts";

// ═══════════════════════ 1-3. the table describes reality ══════════════════

Deno.test("1. the evidence table covers exactly the executable Actors", () => {
  // Both directions matter. A key here the catalog cannot execute would claim
  // an Actor nothing may call; a catalog key missing here would be an
  // executable Actor whose powers nobody stated, and a signal it could serve
  // would be reported as a gap.
  const drift = actorTableDrift();
  assertEquals(drift.unknown_here, [], "named here but not executable");
  assertEquals(drift.missing_here, [], "executable but its powers are unstated");
  assertEquals(ACTOR_EVIDENCE.length, executableActorKeys().length);
});

Deno.test("2. every evidence claim cites its basis", () => {
  // A claim without a basis is folklore, and folklore is what produced three
  // capabilities that could not do what they said.
  for (const a of ACTOR_EVIDENCE) {
    for (const p of a.produces) {
      assert(p.basis.length > 25,
        `${a.actor_key} claims ${p.event}/${p.subject} with no substantive basis`);
      assert(p.evidence_fields.length > 0,
        `${a.actor_key} claims ${p.event}/${p.subject} but names no evidence field`);
    }
  }
});

Deno.test("3. the honest total: six company signals are supported without an unlock", () => {
  // Pinned deliberately. This list is the whole state of the system, and it must
  // change only when an Actor is genuinely added — never by drift. One entry in
  // Phase 3, two in Phase 4, six now.
  //
  // EVERY ENTRY IS company-SCOPED, and that is the headline rather than a
  // detail: no person-authored evidence is available without an unlock, so a
  // leadership post and a comment are `requires_unlock` however many social
  // Actors have been carded.
  const pairs = supportedEvidencePairs().map((p) => `${p.event}/${p.subject}`).sort();
  assertEquals(pairs, [
    "expansion/company", "funding/company", "hiring/company",
    "post/company", "product_launch/company", "technology/company",
  ]);
  for (const p of supportedEvidencePairs()) assertEquals(p.subject, "company");
});

// ═══════════════ 4-5. capability claims are refuted, not trusted ═══════════

Deno.test("4. THE GUARD: no capability may claim evidence its providers cannot produce", () => {
  // Every capability the derivation refutes must ALREADY be marked unsupported.
  // A new one appearing here is a genuine defect: the registry would be
  // promising evidence that nothing can deliver.
  const refuted = capabilitiesClaimingUnproducibleEvidence();
  const unmarked = refuted.filter((r) => isCapabilitySupported(r.id));

  assertEquals(
    unmarked.map((r) =>
      `${r.id} claims ${r.claims.join(", ")} but ${r.providers.join(", ") || "no provider"} ` +
      `produces ${r.actually_produces.join(", ")}`),
    [],
  );
});

Deno.test("5. the derivation independently reaches Phase 1's hand-set verdict", () => {
  // The three capabilities were marked unsupported by reading each provider's
  // card. The evidence table refutes the same three from data. Agreement
  // between an independent derivation and a careful manual pass is what makes
  // the flag trustworthy rather than merely present.
  const refuted = capabilitiesClaimingUnproducibleEvidence().map((r) => r.id).sort();
  const handMarked = unsupportedCapabilities().map((s) => s.id).sort();
  assertEquals(refuted, handMarked);
});

// ═════════════════ 6-8. support respects subject and unlock ════════════════

Deno.test("6. a company-post source can never satisfy a leadership-post signal", () => {
  // The subject boundary, enforced where it matters. These two differ by one
  // field and must never resolve to the same answer.
  const companyPost = resolveSignalSupport(describeSignal("post", "company"));
  const leaderPost = resolveSignalSupport(describeSignal("post", "leadership"));

  // Phase 5 gave BOTH a source, and the verdicts still differ — which is the
  // stronger form of this test. The company page is readable outright; the
  // person is readable only behind an accepted unlock.
  assertEquals(companyPost.status, "supported");
  assertEquals(leaderPost.status, "requires_unlock");
  assertEquals(companyPost.dependencies.length, 0);
  assertEquals(leaderPost.dependencies[0].capability, "offer_founder_unlock");
  // And the company source must never appear in the leadership verdict.
  assertFalse(
    [...leaderPost.discovery_actors, ...leaderPost.verification_actors]
      .includes("apify_linkedin_company_posts"),
    "a company-post Actor may never serve a leadership-post signal",
  );
});

Deno.test("7. hiring is supported, and its discovery/verification powers are distinct", () => {
  const hiring = resolveSignalSupport(describeSignal("hiring", "company"));
  assertEquals(hiring.status, "supported");

  // Discovery FINDS employers; verification PROVES a role at one already found.
  // Collapsing them is how a hiring-first mission got planned with no way to
  // find anyone.
  assert(hiring.discovery_actors.includes("apify_yc_companies_memo23"));
  assert(hiring.verification_actors.includes("apify_linkedin_job_search"));
  assertFalse(hiring.discovery_actors.includes("apify_linkedin_job_search"),
    "the job search is company-scoped and cannot discover employers");
});

Deno.test("8. an unlock-gated Actor never makes a signal 'supported'", () => {
  // The people stages are reachable only through an explicit, credit-reserved
  // unlock. A signal they alone could serve must report `requires_unlock` — an
  // offer the user may accept — and never `supported`, which would imply the
  // run will simply collect it.
  const identity = resolveSignalSupport(describeSignal("leadership_change", "leadership"));
  assertEquals(identity.status, "requires_unlock");
  assertEquals(identity.discovery_actors, []);
  assert(/unlock/i.test(identity.reason));

  // And no gated Actor may leak into a supported verdict anywhere.
  const gated = new Set(ACTOR_EVIDENCE.filter((a) => a.unlock_gated).map((a) => a.actor_key));
  for (const a of ACTOR_EVIDENCE) {
    for (const p of a.produces) {
      const r = resolveSignalSupport(describeSignal(p.event, p.subject));
      if (r.status !== "supported") continue;
      for (const k of [...r.discovery_actors, ...r.verification_actors]) {
        assertFalse(gated.has(k), `${k} is unlock-gated but appears in a supported verdict`);
      }
    }
  }
});

// ═══════════════════════ 9-11. THE FLAGSHIP BENCHMARK ══════════════════════

const FLAGSHIP =
  "Find 15 cybersecurity companies in Europe hiring enterprise sellers " +
  "and whose leadership has recently posted about US expansion.";

Deno.test("9. FLAGSHIP: every part of the request survives into the mission", () => {
  const m = parseLeadMissionDeterministic(FLAGSHIP);

  assertEquals(m.requested_count, 15);
  assert(m.company_profile.verticals.includes("cybersecurity"));
  // The geography is the COMPANY's. "US expansion" is the signal's topic and
  // must not appear here — it used to, inverting the request.
  assertEquals(m.company_profile.locations, ["Europe"]);

  // Two requirements, not one. The audit's headline defect was that the second
  // vanished and the run still reported full coverage.
  assertEquals(m.required_signals.length, 2);

  const hiring = m.required_signals.find((s) => s.event === "hiring")!;
  assertEquals(hiring.subject, "company");
  assertEquals(hiring.qualifier?.role_families, ["gtm_sales"]);
  assertEquals(hiring.qualifier?.role_terms, ["enterprise sellers"]);

  const post = m.required_signals.find((s) => s.event === "post")!;
  assertEquals(post.subject, "leadership");
  assertEquals(post.qualifier?.topic, "us expansion");
});

Deno.test("10. FLAGSHIP: the plan is truthful about what it will and will not do", () => {
  const m = parseLeadMissionDeterministic(FLAGSHIP);
  const plan = buildCapabilityGraph(m);

  // Discovery that can actually run, and hiring verified.
  assertEquals(plan.entry_capability, "general_company_discovery");
  const steps = plan.steps.map((s) => s.capability);
  assert(steps.includes("hiring_verification"));

  // The leadership requirement surfaces its identity dependency as an OFFER.
  assert(plan.offered_capabilities.includes("offer_founder_unlock"));

  // An offer runs nothing: no people stage is ever scheduled.
  for (const c of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
    assertFalse(steps.includes(c), `${c} must never be a scheduled step`);
  }
});

Deno.test("11. FLAGSHIP: the four-part verdict is reported exactly", () => {
  // The benchmark's correct outcome, stated as the audit predicted it:
  //
  //   company discovery          SUPPORTED
  //   hiring evidence            SUPPORTED
  //   leadership identity        REQUIRES UNLOCK
  //   leadership-post capability UNSUPPORTED
  //
  // Anything that reports more than this is fabricating; anything that reports
  // less is discarding part of the request.
  const m = parseLeadMissionDeterministic(FLAGSHIP);
  const r = coverMissionSignals(m);

  assertFalse(r.fully_covered);

  const hiring = r.signals.find((s) => s.signal === "hiring")!;
  assertEquals(hiring.status, "covered");
  assert(r.runnable_actors.includes("apify_linkedin_job_search"));

  const post = r.signals.find((s) => s.signal === "post")!;
  // Phase 5: the profile-post source is carded, so the leadership half moved
  // from "impossible" to "awaiting your authorisation" — a materially different
  // answer, and the one the user can act on.
  assertEquals(post.status, "requires_unlock");
  assert(/unlock/i.test(post.limitation!));

  // The identity dependency is stated, and stated as an unlock rather than a
  // dead end — the user may authorise it; the post itself still could not be
  // retrieved afterwards, and the reason says so.
  assertEquals(r.dependencies[0].capability, "offer_founder_unlock");
  assert(/never run automatically/i.test(r.dependencies[0].reason));

  // NO UNLOCK-GATED ACTOR IS PRESENTED AS RUNNABLE WORK. The profile-post
  // source is callable and is not authorised, and those are different things.
  assertFalse(r.runnable_actors.includes("apify_linkedin_profile_posts"));
  assertFalse(r.runnable_actors.includes("apify_linkedin_post_search"));
});

// ═════════════════════════ 12. containment is unchanged ════════════════════

Deno.test("12. a supported verdict never reaches outside the executable set", () => {
  // Containment does not weaken because support became derived. Every Actor a
  // supported signal names must be one the catalog can actually execute.
  const exec = new Set(executableActorKeys());
  for (const q of [
    FLAGSHIP, "Find fintech startups in the UK hiring SDRs.",
    "Find recently funded B2B SaaS companies.",
    "Find CEOs commenting on sales automation.",
  ]) {
    const r = coverMissionSignals(parseLeadMissionDeterministic(q));
    for (const a of r.runnable_actors) {
      assert(exec.has(a), `${a} is runnable for "${q}" but is not an executable Actor`);
    }
  }
});

Deno.test("13. evidenceProducedBy reports only what the named Actors produce", () => {
  // The primitive the capability guard rests on. If it over-reported, the guard
  // would silently stop refuting anything.
  assertEquals(evidenceProducedBy([]).length, 0);
  assertEquals(evidenceProducedBy(["apify_linkedin_company_search"]).length, 0,
    "a company-name index proves no signal");

  const jobs = evidenceProducedBy(["apify_linkedin_job_search"]);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].event, "hiring");
  assertEquals(jobs[0].power, "verification");

  // An unknown key contributes nothing rather than throwing — an uncarded
  // provider must reduce a claim, never crash the check.
  assertEquals(evidenceProducedBy(["apify_jobs", "not_a_real_actor"]).length, 0);
});

Deno.test("14. no signal → actor routing: support comes from evidence, not from names", () => {
  // The architectural constraint. Two requests naming different industries but
  // the same requirement must resolve to the same actors, and a request naming
  // an industry must never change which Actor serves a signal.
  const a = coverMissionSignals(parseLeadMissionDeterministic(
    "Find cybersecurity companies in Germany hiring enterprise AEs."));
  const b = coverMissionSignals(parseLeadMissionDeterministic(
    "Find logistics companies in Germany hiring enterprise AEs."));

  assertEquals(a.runnable_actors, b.runnable_actors);
  assertEquals(
    a.signals.map((s) => s.status),
    b.signals.map((s) => s.status),
  );
});

Deno.test("15. a qualifier no source can honour is disclosed, not silently ignored", () => {
  // "hiring enterprise sellers" is served, but the job source filters titles
  // fuzzily and the seniority is checked after the fact. Saying so is the
  // difference between a served requirement and a served-approximately one.
  const sig = readSignalsFromQuery("companies hiring enterprise sellers")[0];
  const support = resolveSignalSupport(sig);
  assertEquals(support.status, "supported");
  // Role qualifiers ARE honoured by the job source plus its post-filter.
  assertEquals(support.unhonoured_qualifiers, []);

  // A topic on a hiring signal is not something any hiring source can filter.
  const withTopic = describeSignal("hiring", "company", { topic: "sustainability" });
  assert(resolveSignalSupport(withTopic).unhonoured_qualifiers.includes("topic"));
});
