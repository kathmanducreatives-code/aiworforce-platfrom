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
} from "../../../supabase/functions/_shared/intelligence/runtimeEnvironment.ts";
import { decideCapability, AGENTORY_CAPABILITIES, type AgentoryCapability } from "../../../supabase/functions/_shared/intelligence/capabilityRegistry.ts";

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

Deno.test("E2 the canonical project resolves, by URL and by id alike", () => {
  // WAS "the TEST project resolves as test". Agentory now runs a SINGLE project
  // serving both roles, so the canonical ref resolves as `production` — which is
  // correct, because with one live project everything is production. What still
  // matters, and is asserted here, is that the ref resolves at all and resolves
  // the SAME way however it is supplied.
  const byUrl = resolveRuntimeEnvironment(env({ SUPABASE_URL: TEST_URL }));
  const byId = resolveRuntimeEnvironment(env({ SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.test }));
  assertEquals(byUrl, { ok: true, mode: "production" });
  assertEquals(byId, byUrl, "a URL and a project id must never disagree");
});

Deno.test("E3 the PRODUCTION project resolves as production", () => {
  assertEquals(resolveRuntimeEnvironment(env({ SUPABASE_URL: PROD_URL })), { ok: true, mode: "production" });
  assertEquals(
    resolveRuntimeEnvironment(env({ SUPABASE_PROJECT_ID: CANONICAL_PROJECT_REFS.production })),
    { ok: true, mode: "production" },
  );
});

Deno.test("E4 the single-project deployment is deliberate, not a copy-paste", () => {
  // The old invariant was that the two refs DIFFER. It was right while two
  // projects existed and is wrong now, so it is inverted rather than deleted:
  // the two keys must hold the SAME non-empty ref, and that ref must be the one
  // project this deployment is allowed to talk to.
  //
  // Asserting the equality keeps it a decision. If someone later reintroduces a
  // second project by editing one key, this fails and forces them to also
  // restore the isolation guarantees that were removed alongside it.
  assert(CANONICAL_PROJECT_REFS.production.length > 0);
  assertEquals(
    CANONICAL_PROJECT_REFS.test, CANONICAL_PROJECT_REFS.production,
    "one project serves both roles; see the note on CANONICAL_PROJECT_REFS",
  );
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

Deno.test("E9 the retired projects no longer resolve to anything", () => {
  // WAS "TEST and production never resolve to each other" — an isolation
  // guarantee between two live projects. With one project that guarantee is
  // vacuous, and the risk it protected against has been replaced by a sharper
  // one: the two ABANDONED projects still exist and still accept credentials.
  //
  // So this now asserts the thing that actually protects the migration — a
  // retired ref must resolve to NOT-OK, never quietly to a mode. Anything that
  // still points at the old account fails closed instead of writing there.
  for (const retired of ["zbwsbnqqpkvdhqwavjke", "wqnigjhcwjxtmordrwno"]) {
    const r = resolveRuntimeEnvironment(env({ SUPABASE_PROJECT_ID: retired }));
    assertEquals(r.ok, false, `${retired} is retired and must not resolve`);
  }
  const t = resolveRuntimeEnvironment(env({ SUPABASE_URL: TEST_URL }));
  const p = resolveRuntimeEnvironment(env({ SUPABASE_URL: PROD_URL }));
  assert(t.ok && p.ok);
  assertEquals(t.mode, p.mode, "one project, one mode");
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
