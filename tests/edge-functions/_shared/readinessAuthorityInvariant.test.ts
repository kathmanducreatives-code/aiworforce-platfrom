// ONE READINESS ANSWER, AT EVERY LAYER — INCLUDING THE ONE THAT SPENDS.
//
// Readiness was threaded through the planning layers (capability graph, gap
// router, verifier selection, feasibility, RetrievalPlan, ProviderCallSpec) but
// NOT through the moment of execution. `guardedInvoker` asked only whether a
// provider was inside the mission's plan — a question about graph membership,
// which cannot tell a live route from a carded one, a disabled actor, or one
// whose credential is missing.
//
// That left a real hole rather than a theoretical one. A plan is frozen and
// restored across continuations; a checkpoint can outlive the build that wrote
// it; and `buildCapabilityGraph` filters providers by readiness ONLY under the
// V2 enforcement gate. Any call reaching the invoker by another path executed
// while every planning layer above it called the same route blocked.
//
// The invariant these pin:
//
//   If the canonical readiness authority says a route is not executable, no
//   downstream layer can execute it.
//
// PURE — no provider, no network, no database.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readinessPolicy, routeActorReady, capabilityRunnable, pairKey,
  PRODUCTION_READINESS, providerClassOf, type ReadinessPolicy,
} from "../../../supabase/functions/_shared/routeReadiness.ts";
import { guardedInvoker } from "../../../supabase/functions/_shared/leadMissionRuntime.ts";
import {
  CapabilityContainmentError, type CapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

// ── THE SIX CASES ────────────────────────────────────────────────────────────
//
// Each is a real readiness class from `actorIntelligence`, not an invented one.

const READY_PAIR      = ["apify_linkedin_job_search", "job_discovery"] as const;
const CARDED_PAIR     = ["apify_yc_companies_solidcode", "startup_company_discovery"] as const;
const DISABLED_PAIR   = ["apify_linkedin_company_employees", "hiring_verification"] as const; // NEEDS_PROVIDER_WORK, opt-in
const UNSUPPORTED_CAP = ["apify_linkedin_job_search", "leadership_change_discovery"] as const;

/** A mission where a credential is missing / the provider was refused. */
const missingCredentials: ReadinessPolicy = readinessPolicy({
  unavailable: (a) => a === "apify_linkedin_job_search",
});
/** A provider refused by mission policy (opt-in gate, credit, auth). */
const policyRefused: ReadinessPolicy = readinessPolicy({
  unavailable: (a, c) => pairKey(a, c) === pairKey(...READY_PAIR),
});

/** A plan that CLAIMS to be readiness-filtered, declaring the actor for the step. */
function enforcedPlan(actor: string, capability: string): CapabilityPlan {
  return {
    entry_capability: capability,
    steps: [{ capability, providers: [actor], role: "entry", claims: [], produces: [] }],
    allowed_providers: [actor],
    executability: { mode: "enforce", unexecutable: [] },
  } as unknown as CapabilityPlan;
}
/** The same plan built in legacy mode — V1 / Signals behaviour, deliberately unfiltered. */
function legacyPlan(actor: string, capability: string): CapabilityPlan {
  const p = enforcedPlan(actor, capability) as unknown as Record<string, unknown>;
  return { ...p, executability: { mode: "legacy", unexecutable: [] } } as unknown as CapabilityPlan;
}

async function runThroughGuard(
  plan: CapabilityPlan, policy: ReadinessPolicy, actor: string, capability: string,
): Promise<{ ran: boolean; error: CapabilityContainmentError | null }> {
  let ran = false;
  const invoke = guardedInvoker<{ actorKey: string; capabilityId: string }>(
    plan, () => { ran = true; return Promise.resolve([]); }, undefined, policy,
  );
  try {
    await invoke({ actorKey: actor, capabilityId: capability });
    return { ran, error: null };
  } catch (e) {
    return { ran, error: e instanceof CapabilityContainmentError ? e : null };
  }
}

// ── THE AUTHORITY ITSELF ─────────────────────────────────────────────────────

Deno.test("the authority's verdict on each of the six cases", () => {
  assertEquals(routeActorReady(...READY_PAIR, PRODUCTION_READINESS).ready, true, "READY");
  assertEquals(routeActorReady(...CARDED_PAIR, PRODUCTION_READINESS).ready, false, "CARDED_BUT_NOT_LIVE");
  assertEquals(routeActorReady(...DISABLED_PAIR, PRODUCTION_READINESS).ready, false, "disabled / opt-in");
  assertEquals(routeActorReady(...UNSUPPORTED_CAP, PRODUCTION_READINESS).ready, false, "unsupported capability");
  assertEquals(routeActorReady(...READY_PAIR, missingCredentials).ready, false, "missing credentials");
  assertEquals(routeActorReady(...READY_PAIR, policyRefused).ready, false, "policy-refused");
});

Deno.test("a refusal always says which class refused it", () => {
  for (const [policy, pair] of [
    [PRODUCTION_READINESS, CARDED_PAIR], [PRODUCTION_READINESS, DISABLED_PAIR],
    [PRODUCTION_READINESS, UNSUPPORTED_CAP], [missingCredentials, READY_PAIR],
  ] as Array<[ReadinessPolicy, readonly [string, string]]>) {
    const r = routeActorReady(pair[0], pair[1], policy);
    assertEquals(r.ready, false);
    assert((r as { reason: string }).reason.length > 10, `${pair[0]}|${pair[1]} refused without a reason`);
  }
});

// ── THE INVARIANT ────────────────────────────────────────────────────────────

Deno.test("INVARIANT: what the authority blocks, the runtime cannot execute", async () => {
  const cases: Array<[string, ReadinessPolicy, readonly [string, string]]> = [
    ["carded but not live", PRODUCTION_READINESS, CARDED_PAIR],
    ["disabled / opt-in actor", PRODUCTION_READINESS, DISABLED_PAIR],
    ["unsupported capability", PRODUCTION_READINESS, UNSUPPORTED_CAP],
    ["missing credentials", missingCredentials, READY_PAIR],
    ["policy-refused", policyRefused, READY_PAIR],
  ];
  for (const [name, policy, [actor, capability]] of cases) {
    // The plan DECLARES the actor for the step, so containment would pass it.
    // Only readiness stands between this call and somebody's money.
    const { ran, error } = await runThroughGuard(enforcedPlan(actor, capability), policy, actor, capability);
    assertEquals(ran, false, `${name}: the provider was invoked anyway`);
    assert(error, `${name}: the call was not refused`);
    assertEquals(error!.kind, "readiness", `${name}: refused for the wrong reason`);
    assertEquals(error!.provider, actor);
    assertEquals(error!.capability, capability);
  }
});

Deno.test("a READY route still runs — the guard refuses, it does not block everything", async () => {
  const { ran, error } = await runThroughGuard(
    enforcedPlan(...READY_PAIR), PRODUCTION_READINESS, ...READY_PAIR,
  );
  assertEquals([ran, error], [true, null]);
});

Deno.test("a provider probe may run exactly the carded route it was opened for", async () => {
  const probe = readinessPolicy({
    mode: "provider_probe", probe_routes: [pairKey(...CARDED_PAIR)],
  });
  const opened = await runThroughGuard(enforcedPlan(...CARDED_PAIR), probe, ...CARDED_PAIR);
  assertEquals(opened.ran, true, "the probe's own route must run");
  // And nothing else: a second carded pair is still refused under the same probe.
  const other = await runThroughGuard(
    enforcedPlan("apify_funding_rounds_datahyena", "funding_signal_discovery"), probe,
    "apify_funding_rounds_datahyena", "funding_signal_discovery",
  );
  assertEquals(other.ran, false, "a probe must not open every carded route");
});

// ── LEGACY IS NOT MIGRATED BY ACCIDENT ───────────────────────────────────────

Deno.test("a legacy-gated plan keeps its old behaviour exactly", async () => {
  // V1 / Signals build their graph WITHOUT the executability gate, so their
  // steps were never readiness-filtered. Applying production strictness to
  // those calls would be a silent migration, not a fix.
  const { ran, error } = await runThroughGuard(
    legacyPlan(...CARDED_PAIR), PRODUCTION_READINESS, ...CARDED_PAIR,
  );
  assertEquals([ran, error], [true, null]);
});

Deno.test("containment still refuses an out-of-graph provider, and says so", async () => {
  const plan = enforcedPlan(...READY_PAIR);
  const { ran, error } = await runThroughGuard(
    plan, PRODUCTION_READINESS, "apify_people_search", READY_PAIR[1],
  );
  assertEquals(ran, false);
  assertEquals(error?.kind, "containment", "an out-of-graph provider is a containment refusal, not readiness");
});

Deno.test("both refusals are the same error type, so neither ends a mission as a crash", async () => {
  // Canary 849d6782 died `failed:unhandled_exception` because a refusal escaped
  // as an error nobody caught. A readiness refusal must be catchable by exactly
  // the handlers that already catch containment.
  for (const [plan, policy, pair] of [
    [enforcedPlan(...CARDED_PAIR), PRODUCTION_READINESS, CARDED_PAIR],
    [enforcedPlan(...READY_PAIR), PRODUCTION_READINESS, ["apify_people_search", READY_PAIR[1]]],
  ] as Array<[CapabilityPlan, ReadinessPolicy, readonly [string, string]]>) {
    const invoke = guardedInvoker<{ actorKey: string; capabilityId: string }>(
      plan, () => Promise.resolve([]), undefined, policy,
    );
    await assertRejects(
      () => invoke({ actorKey: pair[0], capabilityId: pair[1] }),
      CapabilityContainmentError,
    );
  }
});

// ── THE LAYERS AGREE ─────────────────────────────────────────────────────────

Deno.test("capability-level and actor-level answers cannot disagree", () => {
  // `capabilityRunnable` is what the graph and feasibility ask; `routeActorReady`
  // is what the router, the verifier and the runtime ask. A capability is
  // runnable exactly when at least one of its actors is.
  for (const [actor, capability] of [READY_PAIR, CARDED_PAIR, DISABLED_PAIR, UNSUPPORTED_CAP]) {
    const one = routeActorReady(actor, capability, PRODUCTION_READINESS).ready;
    const many = capabilityRunnable(PRODUCTION_READINESS, capability, [actor]).runnable;
    assertEquals(one, many, `${actor}|${capability}: the two entry points disagree`);
  }
});

Deno.test("no layer re-implements the decision", async () => {
  // The readiness TABLES may be read for reporting; the DECISION may not be
  // re-derived. A layer that compares `readiness === "READY"` itself has
  // reintroduced the second opinion this module exists to remove.
  const files = [
    "evidenceGapRouter.ts", "claimVerifier.ts", "claimPlan.ts", "retrievalPlan.ts",
    "providerCallSpec.ts", "requestFeasibility.ts", "leadMissionRuntime.ts",
  ];
  for (const f of files) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url),
    );
    assertEquals(
      /===\s*"READY"|!==\s*"READY"/.test(src), false,
      `${f} compares a readiness class directly instead of asking the authority`,
    );
  }
});

// ── FIRECRAWL OWNERSHIP: THE CANONICAL PATH DECIDES, AND HOLDS ITS OWN SWITCH ─

Deno.test("the canonical verifier's page spend no longer asks the V1 flag for permission", async () => {
  // `EVIDENCE_ENRICHMENT` is the legacy Brain's switch. It used to gate the
  // canonical business-model verifier too, so turning V1 enrichment off
  // silently disabled claim verification — the old mechanism deciding whether
  // the new one was allowed to run.
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const collect = src.indexOf("collect: async (targets, intents, maxPages) => {");
  assert(collect > 0, "the canonical collector must exist");
  const body = src.slice(collect, collect + 1600);
  assert(body.includes("if (!webVerificationEnabled) return {};"),
    "the collector must consult its own switch");
  assertEquals(/if \(evidenceMode !== "execute"\) return \{\};/.test(body), false,
    "the collector must not be gated by the V1 enrichment flag directly");

  // The switch defaults to the legacy value, so upgrading moves no environment.
  const decl = src.slice(src.indexOf("const webVerificationEnabled"), src.indexOf("const webVerificationEnabled") + 500);
  assert(decl.includes('LEAD_V2_WEB_VERIFICATION'), "it has its own env name");
  assert(decl.includes('return evidenceMode === "execute";'),
    "and defaults to the legacy value so no environment changes behaviour by being upgraded");
});

Deno.test("the legacy evidence-debt purchaser is excluded by mission mode, not by a feature flag", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(src.includes('const isLeadV2Mission = intelligence.mode === "new_architecture" && !!capabilityRun;'));
  assert(src.includes("const legacyEvidenceDebtAllowed = !isLeadV2Mission;"));
  // The old exclusion was `&& !p2Specs`: with LEAD_V2_SPECS=off, a Lead V2
  // mission fell back to the legacy owner for the same money.
  assertEquals(
    src.includes('if ((evidenceMode === "plan_only" || evidenceMode === "execute") && !p2Specs) {'), false,
    "the evidence-debt exclusion must not depend on the spec-spine flag",
  );
  assert(src.includes('if ((evidenceMode === "plan_only" || evidenceMode === "execute") && legacyEvidenceDebtAllowed) {'));
});

// ── PROVIDER CLASSES: READINESS MUST MODEL NON-APIFY PROVIDERS ───────────────
//
// Readiness required a hiring ACTOR CARD from every provider — an Apify-shaped
// contract. Firecrawl has none and never will: it is a direct HTTP API, not a
// marketplace actor. So `routeActorReady("firecrawl", "web_evidence")` answered
// "no actor card" for a provider the readiness table declares READY and which
// runs in production daily, and the claim verifier survived the contradiction
// only by asking a WEAKER question than every other layer.

Deno.test("a declared non-Apify provider is READY, not 'no actor card'", () => {
  const r = routeActorReady("firecrawl", "web_evidence", PRODUCTION_READINESS);
  assertEquals(r.ready, true, "Firecrawl is declared READY and must resolve READY");
  assertEquals(providerClassOf("firecrawl"), "api_provider");
  assertEquals(providerClassOf("apify_linkedin_job_search"), "apify_actor");
});

Deno.test("a provider nobody has described may not spend", () => {
  // The failure mode this replaces was "has no actor card" meaning BLOCKED for
  // a legitimate provider. The opposite failure — an unknown provider sliding
  // through — must not be introduced in its place.
  assertEquals(providerClassOf("totally_unknown_provider"), null);
  const r = routeActorReady("totally_unknown_provider", "web_evidence", PRODUCTION_READINESS);
  assertEquals(r.ready, false);
});

Deno.test("class does not override readiness — a carded-but-not-live actor stays blocked", () => {
  // Having a class is a CONTRACT check, not a promotion.
  assertEquals(providerClassOf("apify_yc_companies_solidcode"), "apify_actor");
  assertEquals(routeActorReady(...CARDED_PAIR, PRODUCTION_READINESS).ready, false);
});

Deno.test("the claim verifier asks the canonical question, not a weaker one", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/claimVerificationPhase.ts", import.meta.url),
  );
  assert(/ready:\s*\(actor\)\s*=>[\s\S]{0,200}routeActorReady\(/.test(src),
    "the verifier's readiness gate must call routeActorReady");
  assertEquals(
    /ready:\s*\(actor\)\s*=>\s*!!route && policy\.decide\(/.test(src), false,
    "the verifier must not bypass the provider-class contract",
  );
});

Deno.test("Firecrawl READY means every layer allows it; BLOCKED means none does", async () => {
  // READY, under the real production policy.
  assertEquals(routeActorReady("firecrawl", "web_evidence", PRODUCTION_READINESS).ready, true);
  // And when a mission refuses it, the SAME authority blocks it — including at
  // the runtime chokepoint, which is where the money is.
  const refused = readinessPolicy({ unavailable: (a) => a === "firecrawl" });
  assertEquals(routeActorReady("firecrawl", "web_evidence", refused).ready, false);
  const { ran, error } = await runThroughGuard(
    enforcedPlan("firecrawl", "web_evidence"), refused, "firecrawl", "web_evidence",
  );
  assertEquals(ran, false, "a refused Firecrawl must not execute");
  assertEquals(error?.kind, "readiness");
});
