// CAPABILITY REGISTRY — the planner-facing boundary.
// ZERO network, ZERO provider calls, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENTORY_CAPABILITIES, decideCapability, isCapabilitySelectable, selectableCapabilityKeys,
  resolveAdapterKey, clampResultLimit, clampCallsPerRound, toPlannerVisible,
  plannerCapabilityMenu, getCapability, underlyingActor,
} from "../../../supabase/functions/_shared/intelligence/capabilityRegistry.ts";
import { isCallable } from "../../../supabase/functions/_shared/actorCapabilityRegistry.ts";

const LEADS_TEST = { department: "leads" as const, environment: "test" as const };

// ---- gate ------------------------------------------------------------------

Deno.test("8.A an UNKNOWN capability is rejected", () => {
  assertEquals(decideCapability("definitely_not_real", LEADS_TEST), { ok: false, reason: "unknown_capability" });
  assertEquals(decideCapability("", LEADS_TEST), { ok: false, reason: "unknown_capability" });
  assertEquals(decideCapability(null, LEADS_TEST), { ok: false, reason: "unknown_capability" });
});

Deno.test("8.B a DEFINITION-ONLY capability is rejected — no adapter, never selectable", () => {
  const d = decideCapability("content_drafting", { department: "content", environment: "test" });
  assertEquals(d, { ok: false, reason: "definition_only" });
  assertEquals(resolveAdapterKey("content_drafting", { department: "content", environment: "test" }), null);
});

Deno.test("8.C a WRONG-DEPARTMENT capability is rejected", () => {
  assertEquals(decideCapability("jobs_search", { department: "content", environment: "test" }),
    { ok: false, reason: "wrong_department" });
});

Deno.test("8.D an ENVIRONMENT-UNAVAILABLE capability is rejected", () => {
  const cap = AGENTORY_CAPABILITIES["jobs_search"];
  const original = cap.enabled_environments;
  try {
    (cap as { enabled_environments: string[] }).enabled_environments = ["development"];
    assertEquals(decideCapability("jobs_search", LEADS_TEST), { ok: false, reason: "environment_unavailable" });
  } finally {
    (cap as { enabled_environments: unknown }).enabled_environments = original;
  }
});

Deno.test("8.E every selectable lead capability has a VERIFIED binding in the actor registry", () => {
  for (const key of selectableCapabilityKeys(LEADS_TEST)) {
    const cap = AGENTORY_CAPABILITIES[key];
    const actor = underlyingActor(cap);
    assert(actor, `${key} → adapter_key "${cap.adapter_key}" is not in the actor registry`);
    assert(isCallable(actor), `${key} binds to an actor with no verified implementation`);
  }
});

Deno.test("8.F definition-only capabilities are NEVER selectable in any environment", () => {
  for (const [key, cap] of Object.entries(AGENTORY_CAPABILITIES)) {
    if (!cap.definition_only) continue;
    for (const environment of ["development", "test", "production"] as const) {
      for (const department of ["leads", "signals", "content"] as const) {
        assertFalse(isCapabilitySelectable(key, { department, environment }),
          `${key} became selectable in ${department}/${environment}`);
      }
    }
    assertEquals(cap.adapter_key, "", "a definition-only capability must not name an adapter");
  }
});

// ---- limits + cost ---------------------------------------------------------

Deno.test("9.A result limits are ENFORCED — a planner cannot raise its own ceiling", () => {
  const cap = AGENTORY_CAPABILITIES["jobs_search"];
  assertEquals(clampResultLimit(cap, 10_000), cap.limits.maximum_results);
  assertEquals(clampResultLimit(cap, 5), 5);
  assertEquals(clampResultLimit(cap, -1), 0);
  assertEquals(clampResultLimit(cap, Number.NaN), 0);
});

Deno.test("9.B calls-per-round is enforced the same way", () => {
  const cap = AGENTORY_CAPABILITIES["people_search"];
  assertEquals(clampCallsPerRound(cap, 999), cap.limits.maximum_calls_per_round);
  assertEquals(clampCallsPerRound(cap, 1), 1);
  assertEquals(clampCallsPerRound(cap, 0), 0);
});

Deno.test("9.C every capability carries cost metadata", () => {
  for (const cap of Object.values(AGENTORY_CAPABILITIES)) {
    assert(["per_call", "per_record", "estimated"].includes(cap.cost_model.type), cap.key);
  }
});

Deno.test("9.D adapter mapping is deterministic", () => {
  const a = resolveAdapterKey("jobs_search", LEADS_TEST);
  const b = resolveAdapterKey("jobs_search", LEADS_TEST);
  assertEquals(a, b);
  assertEquals(a, "apify_jobs");
});

// ---- no secrets ------------------------------------------------------------

Deno.test("10.A the planner projection NEVER exposes an adapter key or actor id", () => {
  for (const cap of Object.values(AGENTORY_CAPABILITIES)) {
    const visible = toPlannerVisible(cap);
    const blob = JSON.stringify(visible);
    assertFalse("adapter_key" in (visible as unknown as Record<string, unknown>), `${cap.key} leaked adapter_key`);
    if (cap.adapter_key) assertFalse(blob.includes(cap.adapter_key), `${cap.key} leaked its adapter key in a value`);
    const actor = underlyingActor(cap);
    if (actor?.implementationId) {
      assertFalse(blob.includes(actor.implementationId), `${cap.key} leaked the raw actor id`);
    }
  }
});

Deno.test("10.B the whole planner menu contains no provider identifier or credential", () => {
  const blob = JSON.stringify(plannerCapabilityMenu(LEADS_TEST));
  for (const marker of ["harvestapi/", "curious_coder/", "apify_", "firecrawl_", "api_key", "APIFY_TOKEN", "Bearer", "https://"]) {
    assertFalse(blob.includes(marker), `planner menu leaked "${marker}"`);
  }
});

Deno.test("10.C the projection is an ALLOW-LIST, so a new internal field cannot leak", () => {
  const cap = { ...AGENTORY_CAPABILITIES["jobs_search"], internal_secret_note: "LEAK_MARKER" };
  const visible = toPlannerVisible(cap as never);
  assertFalse(JSON.stringify(visible).includes("LEAK_MARKER"),
    "toPlannerVisible must name permitted fields, never spread-and-delete");
});

Deno.test("10.D the menu is deterministic and selectable-only", () => {
  const a = plannerCapabilityMenu(LEADS_TEST).map((c) => c.key);
  const b = plannerCapabilityMenu(LEADS_TEST).map((c) => c.key);
  assertEquals(a, b);
  assertEquals(a, [...a].sort());
  for (const key of a) assert(isCapabilitySelectable(key, LEADS_TEST));
  assertFalse(a.includes("content_drafting"));
});

Deno.test("10.E the five Phase 1 lead capabilities are present and selectable", () => {
  const keys = selectableCapabilityKeys(LEADS_TEST);
  for (const expected of [
    "jobs_search", "company_research", "people_search", "contact_enrichment", "company_identity_resolution",
  ]) {
    assert(keys.includes(expected), `${expected} is missing from the lead menu`);
    assert(getCapability(expected));
  }
});
