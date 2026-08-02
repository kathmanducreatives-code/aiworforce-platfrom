// RUNTIME ENVIRONMENT RESOLUTION — it must be right, or fail closed.
//
// The environment decides which capabilities may be selected. A wrong answer is
// worse than no answer, so every path that cannot positively identify a canonical
// project resolves to NOT-OK rather than to a default.
//
// ZERO network, provider, model and database access.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveRuntimeEnvironment, projectRefFromUrl, environmentFallbackReason,
  CANONICAL_PROJECT_REFS,
} from "../../supabase/functions/_shared/runtimeEnvironment.ts";
import { decideCapability, AGENTORY_CAPABILITIES, type AgentoryCapability } from "../../supabase/functions/_shared/capabilityRegistry.ts";

const PROD_URL = `https://${CANONICAL_PROJECT_REFS.production}.supabase.co`;
const TEST_URL = `https://${CANONICAL_PROJECT_REFS.test}.supabase.co`;

const env = (vars: Record<string, string | undefined>) => (k: string) => vars[k];

// ------------------------------------------------------- the three answers ----

Deno.test("E1 development resolves as development", () => {
  for (const url of [
    "http://localhost:54321", "http://127.0.0.1:54321",
    "http://kong:8000", "http://host.docker.internal:54321",
  ]) {
    assertEquals(resolveRuntimeEnvironment(env({ SUPABASE_URL: url })), { ok: true, mode: "development" }, url);
  }
});

Deno.test("E2 the TEST project resolves as test", () => {
  assertEquals(resolveRuntimeEnvironment(env({ SUPABASE_URL: TEST_URL })), { ok: true, mode: "test" });
  assertEquals(
    resolveRuntimeEnvironment(env({ SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.test })),
    { ok: true, mode: "test" },
  );
});

Deno.test("E3 the PRODUCTION project resolves as production", () => {
  assertEquals(resolveRuntimeEnvironment(env({ SUPABASE_URL: PROD_URL })), { ok: true, mode: "production" });
  assertEquals(
    resolveRuntimeEnvironment(env({ SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.production })),
    { ok: true, mode: "production" },
  );
});

Deno.test("E4 the two canonical refs are distinct and neither is empty", () => {
  assert(CANONICAL_PROJECT_REFS.production.length > 0);
  assert(CANONICAL_PROJECT_REFS.test.length > 0);
  assert(CANONICAL_PROJECT_REFS.production !== CANONICAL_PROJECT_REFS.test);
});

// ------------------------------------------------------------- fail closed ----

Deno.test("E5 an unknown environment FAILS CLOSED and never defaults to test", () => {
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ["nothing readable", {}],
    ["empty url", { SUPABASE_URL: "" }],
    ["a third supabase project", { SUPABASE_URL: "https://someotherproject.supabase.co" }],
    ["a bare ref that is not canonical", { SUPABASE_PROJECT_ID: "abcdefghijklmnop" }],
    ["not a url at all", { SUPABASE_URL: "not-a-url" }],
    ["a non-supabase host", { SUPABASE_URL: "https://evil.example.com" }],
    ["a lookalike host", { SUPABASE_URL: `https://${CANONICAL_PROJECT_REFS.test}.supabase.co.evil.com` }],
  ];
  for (const [name, vars] of cases) {
    const r = resolveRuntimeEnvironment(env(vars));
    assertEquals(r.ok, false, `${name} must not resolve`);
    if (!r.ok) assert(r.reason.length > 0, name);
  }
});

Deno.test("E6 a throwing env reader fails closed", () => {
  const r = resolveRuntimeEnvironment(() => { throw new Error("no env permission"); });
  assertEquals(r, { ok: false, reason: "no_project_ref" });
});

Deno.test("E7 the fallback reason carries no project ref", () => {
  const reason = environmentFallbackReason("unrecognised_project_ref");
  assert(!reason.includes(CANONICAL_PROJECT_REFS.production));
  assert(!reason.includes(CANONICAL_PROJECT_REFS.test));
  assertEquals(reason, "environment_unresolved:unrecognised_project_ref");
});

Deno.test("E8 projectRefFromUrl does not confuse a subdomain prefix for a project", () => {
  assertEquals(projectRefFromUrl(`https://${CANONICAL_PROJECT_REFS.test}.supabase.co`), CANONICAL_PROJECT_REFS.test);
  assertEquals(projectRefFromUrl("https://a.b.supabase.co"), null);
  assertEquals(projectRefFromUrl(null), null);
  assertEquals(projectRefFromUrl("   "), null);
});

// ------------------------------------------------- TEST / production isolation ---

Deno.test("E9 TEST and production never resolve to each other", () => {
  const t = resolveRuntimeEnvironment(env({ SUPABASE_URL: TEST_URL }));
  const p = resolveRuntimeEnvironment(env({ SUPABASE_URL: PROD_URL }));
  assert(t.ok && p.ok);
  assertEquals(t.mode, "test");
  assertEquals(p.mode, "production");
  assert(t.mode !== p.mode);
});

Deno.test("E10 an explicit project id does not override into the wrong environment", () => {
  // A production deployment whose URL is production cannot be talked into "test"
  // by a non-canonical explicit id — it fails closed instead.
  const r = resolveRuntimeEnvironment(env({
    SUPABASE_PROJECT_ID: "pretend-test", SUPABASE_URL: PROD_URL,
  }));
  assertEquals(r.ok, false, "a malformed explicit id must not silently fall through to the URL");
});

// --------------------------------------- environment-restricted capabilities ----

Deno.test("E11 a capability is rejected in an environment it is not enabled for", () => {
  // A temporary, test-only capability restricted to TEST. Registered and removed
  // inside this test so the real registry is never left mutated.
  const key = "__env_gate_probe__";
  const probe: AgentoryCapability = {
    key, department: "leads", purpose: "probe",
    supports: {},
    limits: { maximum_calls_per_round: 1, maximum_results: 1 },
    cost_model: { type: "estimated" },
    coverage: { countries: [], languages: [], global: false },
    strengths: [], weaknesses: [],
    adapter_key: "apify_jobs",          // a real, callable binding
    enabled_environments: ["test"],     // ...but ONLY in test
  };
  AGENTORY_CAPABILITIES[key] = probe;
  try {
    assertEquals(decideCapability(key, { department: "leads", environment: "test" }).ok, true);

    for (const wrong of ["production", "development"] as const) {
      const d = decideCapability(key, { department: "leads", environment: wrong });
      assertEquals(d.ok, false, `${wrong} must not select a test-only capability`);
      if (!d.ok) assertEquals(d.reason, "environment_unavailable");
    }
  } finally {
    delete AGENTORY_CAPABILITIES[key];
  }
  assertEquals(AGENTORY_CAPABILITIES[key], undefined, "the probe must not survive the test");
});

Deno.test("E12 every real Lead capability is selectable in each environment it declares", () => {
  for (const cap of Object.values(AGENTORY_CAPABILITIES)) {
    if (cap.definition_only) continue;
    for (const mode of cap.enabled_environments) {
      const d = decideCapability(cap.key, { department: cap.department === "shared" ? "leads" : cap.department, environment: mode });
      assertEquals(d.ok, true, `${cap.key} should be selectable in ${mode}`);
    }
  }
});
