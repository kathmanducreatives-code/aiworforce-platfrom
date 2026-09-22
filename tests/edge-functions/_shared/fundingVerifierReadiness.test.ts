// WHOSE READINESS DECIDES WHETHER FUNDING IS PROVABLE.
//
// ── THE CLOSED LOOP THIS OPENS ─────────────────────────────────────────────
//
// A round-stage criterion is marked `unprovable_today` when nothing can prove
// it, and an unprovable criterion ranks instead of requiring. That question was
// asked of `PRODUCTION_READINESS` directly:
//
//     export function fundingVerifierReady(): boolean {
//       return PRODUCTION_READINESS.decide("apify_funding_atomus", …).executable;
//     }
//
// `PRODUCTION_READINESS` is a module constant. No environment variable reaches
// it — not `LEAD_V2_ALLOW_EXPERIMENTAL_ROUTES`, not the provider-probe pair,
// which exist for exactly one purpose: letting an EXPERIMENTAL route execute
// once, under supervision, so it can earn READY. So:
//
//   the pair is EXPERIMENTAL → funding compiles as unprovable → no HARD funding
//   claim → no evidence gap → the verifier is never selected → the pair never
//   runs through the spine → it never earns READY → it stays EXPERIMENTAL.
//
// The policy is now an argument, defaulting to `PRODUCTION_READINESS`, so every
// caller that passes nothing behaves exactly as before and only a run that was
// explicitly authorised sees the verifier as executable.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveMissionCriteria, fundingVerifierReady,
} from "../../../supabase/functions/_shared/missionCriteria.ts";
import {
  PRODUCTION_READINESS, readinessPolicy,
} from "../../../supabase/functions/_shared/routeReadiness.ts";
import { CLAIM_REGISTRY, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

const ATOMUS = "apify_funding_atomus";
const PVALYOU = "apify_funding_pvalyou";
const CAP = "funding_verification";
const PAIR = [`${ATOMUS}|${CAP}`, `${PVALYOU}|${CAP}`];
/**
 * THE PAIR AS IT WAS BEFORE IT EARNED READY — an explicit fixture.
 *
 * The pair was promoted on 2026-09-22 after running through the spine, so the
 * production table no longer holds a not-ready funding verifier. The gate
 * these tests pin — readiness decides whether a round stage is provable — is
 * still the gate, and it must still refuse whenever the pair is NOT ready. It is
 * exercised here against the state it was written for, named, instead of
 * against whatever the table happens to say today.
 */
const NOT_READY = {
  [`${ATOMUS}|${CAP}`]: "EXPERIMENTAL", [`${PVALYOU}|${CAP}`]: "EXPERIMENTAL",
} as const;
const PAIR_NOT_READY = readinessPolicy({ overrides: NOT_READY });
/** A not-ready pair, authorised for THIS run, named one by one. */
const ALLOWED = readinessPolicy({ overrides: NOT_READY, allow_experimental: PAIR });

/**
 * A mission whose round stage can be proven by a VERIFIER and nothing else.
 *
 * No funding signal, so funding discovery cannot supply the rounds — which is
 * the case the readiness flag actually guards. `series_b` rather than `seed`
 * because `company_profile.stages` already carries the seed rung and criteria
 * are first-wins by `dimension:value`.
 */
function missionNeedingVerifier(): LeadMissionV1 {
  const m = compileLeadMission({
    originalUserQuery: "Find 1 US B2B SaaS company that raised Series B.",
    proposal: {
      requested_opportunity_count: 1, requested_contact_ready_count: null,
      company_types: ["B2B SaaS"], geographies: ["United States"],
      employee_range: { min: null, max: null },
      decision_maker_roles: [], hard_constraints: [], soft_preferences: [],
      preferred_signals: [], adjacent_signals: [], excluded_signals: [],
      allowed_broadening: {
        role_families: [], company_types: [], geographies: [],
        employee_range: { min: null, max: null },
      },
      disallowed_broadening: [], required_evidence: [], required_capabilities: [],
      preferred_source_strategy: [], evaluation_instructions: "",
      founder_unlock_recommended: false, confidence: 1, unknowns: [],
      required_signal_terms: [], geography_is_hard: true, known_companies: [],
    },
  }).final_mission;
  return {
    ...m,
    required_signals: (m.required_signals ?? []).filter((s) => s.type !== "funding"),
    mission_semantics: {
      ...(m.mission_semantics ?? {}),
      stage: { value: "series_b", phrase: "raised Series B", kind: "hard", elevated_by: null, hedged: false },
    },
  } as LeadMissionV1;
}

const stageCriterion = (m: LeadMissionV1, policy?: Parameters<typeof deriveMissionCriteria>[1]) =>
  deriveMissionCriteria(m, policy).find((c) => c.dimension === "company_stage" && c.value === "series_b")!;

// ═══ 1. PRODUCTION: funding stays unsupported ══════════════════════════════

Deno.test("1. A NOT-READY PAIR: the funding verifier is not executable and the stage is unprovable", () => {
  assertFalse(fundingVerifierReady(PAIR_NOT_READY));
  assertFalse(PAIR_NOT_READY.decide(ATOMUS, CAP).executable);
  assertFalse(PAIR_NOT_READY.decide(PVALYOU, CAP).executable);
  const c = stageCriterion(missionNeedingVerifier(), PAIR_NOT_READY);
  assertEquals(c.status, "unprovable_today",
    "with no verifier that may run, a round stage cannot be established");
});

Deno.test("1a. PRODUCTION, AFTER THE SPINE CANARY: the pair is executable and the stage is provable", () => {
  // Promoted on live evidence (task 3f082b22). The DEFAULT policy is what an
  // un-threaded caller gets, so it is what changed — and nothing else did.
  assert(fundingVerifierReady(), "the default is production, and production now allows the pair");
  assert(PRODUCTION_READINESS.decide(ATOMUS, CAP).executable);
  assert(PRODUCTION_READINESS.decide(PVALYOU, CAP).executable);
  assertEquals(stageCriterion(missionNeedingVerifier(), PRODUCTION_READINESS).status, "ok");
});

Deno.test("1b. THE DEFAULT IS PRODUCTION — an un-threaded caller is unchanged", () => {
  // Every call site that passes no policy must read exactly as it did before.
  const m = missionNeedingVerifier();
  assertEquals(
    JSON.stringify(deriveMissionCriteria(m)),
    JSON.stringify(deriveMissionCriteria(m, PRODUCTION_READINESS)),
    "omitting the policy must be identical to passing the production one",
  );
});

// ═══ 2. EXPERIMENTAL-ALLOWED: provable, hard, and it reaches verification ══

Deno.test("2. EXPERIMENTAL-ALLOWED: the stage becomes provable and stays HARD", () => {
  assert(fundingVerifierReady(ALLOWED), "the named pair may run under this policy");
  const c = stageCriterion(missionNeedingVerifier(), ALLOWED);
  assertEquals(c.status, "ok", "an authorised verifier makes the rung establishable");
  assertEquals(c.kind, "hard", "and it stays a requirement, not a ranking preference");
});

Deno.test("2b. …and a HARD UNKNOWN funding claim reaches the funding pair", () => {
  // Only a HARD unknown check becomes an evidence gap; a target buys nothing.
  const empty = buildCompanyEvidenceGraph("acme", [], { now: new Date("2026-09-22T00:00:00Z") });
  const unknownStage = {
    criterion_id: "company_stage:series_b", dimension: "company_stage",
    result: "unknown", reason: "no funding evidence",
  };

  // NOT READY: the route exists but no ordinary mission may take it.
  const [blocked] = evidenceGapsFor([unknownStage], empty, undefined, undefined, PAIR_NOT_READY);
  assertEquals(blocked.claim, "funding_stage");
  assertEquals(blocked.next, "blocked", "a not-ready pair is refused");

  // AUTHORISED: the same gap now routes to the pair.
  const [open] = evidenceGapsFor([unknownStage], empty, undefined, undefined, ALLOWED);
  assertEquals(open.next, "verify");
  assertEquals(open.route?.actor, ATOMUS);
  // The gap's `route` is a projection (actor/capability/purpose/cost); the
  // pairing itself lives on the registry route both funding claims share.
  const stage = CLAIM_REGISTRY.find((c) => c.claim === "funding_stage")!;
  assert(stage.routes[0].evidence_actors.includes(PVALYOU),
    "pvalyou travels with it — the pair is the verifier, not atomus alone");
});

// ═══ 3. NO OVERRIDE, NO EXECUTION ══════════════════════════════════════════

Deno.test("3. without the explicit override the pair still cannot execute", () => {
  // An empty allow-list, a list naming a DIFFERENT route, and the production
  // default all refuse — the override has to name the actor and capability.
  for (const policy of [
    PAIR_NOT_READY,
    readinessPolicy({ overrides: NOT_READY, allow_experimental: [] }),
    readinessPolicy({ overrides: NOT_READY, allow_experimental: ["apify_linkedin_company_search|general_company_discovery"] }),
  ]) {
    for (const actor of [ATOMUS, PVALYOU]) {
      assertFalse(policy.decide(actor, CAP).executable, `${actor} must not run under this policy`);
    }
    assertFalse(fundingVerifierReady(policy));
    assertEquals(stageCriterion(missionNeedingVerifier(), policy).status, "unprovable_today");
  }
});

Deno.test("3b. PROMOTED AS A PAIR — both READY together, each named as half of it, the canary cited", async () => {
  const { readinessOf } = await import("../../../supabase/functions/_shared/actorIntelligence.ts");
  const a = readinessOf(ATOMUS, CAP);
  const p = readinessOf(PVALYOU, CAP);
  assertEquals([a.readiness, p.readiness], ["READY", "READY"], "never one without the other");
  for (const r of [a, p]) {
    assert(r.live_evidence?.includes("3f082b22"), `${r.actor}: the spine canary that earned it is named`);
    assert(/READY only as the corroborating funding pair/.test(r.gated_by ?? ""),
      `${r.actor}: the table says it cannot answer alone`);
  }
});

Deno.test("3c. allowing ONE of the pair does not open the other", () => {
  const onlyAtomus = readinessPolicy({ overrides: NOT_READY, allow_experimental: [`${ATOMUS}|${CAP}`] });
  assert(onlyAtomus.decide(ATOMUS, CAP).executable);
  assertFalse(onlyAtomus.decide(PVALYOU, CAP).executable,
    "each half of the pair is authorised on its own terms");
});
