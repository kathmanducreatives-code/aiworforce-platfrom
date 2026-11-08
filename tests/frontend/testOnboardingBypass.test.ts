// TEST-only dashboard access without a Company Brain. The rule must open the
// gate for the isolated TEST project with the flag, and nowhere else.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allowDashboardWithoutBrain, DISCOVERY_TEST_PROJECT_REF,
} from "../../src/lib/env/testOnboardingBypass.ts";
import { CANONICAL_PROJECT_REFS } from "../../src/lib/env/projectEnvironment.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const TEST_URL = `https://${DISCOVERY_TEST_PROJECT_REF}.supabase.co`;
const PROD_URL = `https://${CANONICAL_PROJECT_REFS.production}.supabase.co`;

Deno.test("opens only for the TEST project with the flag set", () => {
  assert(allowDashboardWithoutBrain({ VITE_SUPABASE_URL: TEST_URL, VITE_TEST_DASHBOARD_WITHOUT_BRAIN: "true" }));
  assert(allowDashboardWithoutBrain({ VITE_SUPABASE_URL: TEST_URL, VITE_TEST_DASHBOARD_WITHOUT_BRAIN: " TRUE " }));
});

Deno.test("PRODUCTION never opens, flag or not", () => {
  assertFalse(allowDashboardWithoutBrain({ VITE_SUPABASE_URL: PROD_URL, VITE_TEST_DASHBOARD_WITHOUT_BRAIN: "true" }));
  assertFalse(allowDashboardWithoutBrain({ VITE_SUPABASE_URL: PROD_URL }));
  assertFalse(allowDashboardWithoutBrain({ VITE_TEST_DASHBOARD_WITHOUT_BRAIN: "true" }), "no URL → production default");
});

Deno.test("anything else stays closed", () => {
  const cases: Array<[string | undefined, string | undefined]> = [
    [TEST_URL, undefined], [TEST_URL, "false"], [TEST_URL, "1"], [TEST_URL, "yes"],
    ["https://wqnigjhcwjxtmordrwno.supabase.co", "true"], // abandoned former project
    ["https://someotherref.supabase.co", "true"],
    [`https://evil.example/${DISCOVERY_TEST_PROJECT_REF}.supabase.co`, "true"],
    [`https://${DISCOVERY_TEST_PROJECT_REF}x.supabase.co`, "true"],
  ];
  for (const [url, flag] of cases) {
    assertFalse(allowDashboardWithoutBrain({ VITE_SUPABASE_URL: url, VITE_TEST_DASHBOARD_WITHOUT_BRAIN: flag }), `${url} ${flag}`);
  }
  assert(DISCOVERY_TEST_PROJECT_REF !== CANONICAL_PROJECT_REFS.production);
});

Deno.test("the onboarding gate, the route guard and the post-login destination use the rule; nothing else changed in the gate", () => {
  const gate = read("src/components/OnboardingGate.tsx");
  assert(gate.includes("const TEST_WITHOUT_BRAIN = allowDashboardWithoutBrain(import.meta.env);"));
  assert(gate.includes("if (!completed && !TEST_WITHOUT_BRAIN && !ALLOWED_PRE_ONBOARDING.has(location.pathname)) {"));
  assert(gate.includes("if (!user) return <Navigate to=\"/auth\" replace />;"), "signed-out users are still sent to sign in");
  const route = read("src/components/ProtectedRoute.tsx");
  assert(route.includes("const TEST_WITHOUT_BRAIN = allowDashboardWithoutBrain(import.meta.env);"));
  assert(route.includes("requireOnboarding: requireOnboarding && !TEST_WITHOUT_BRAIN,"), "only the onboarding requirement is lifted");
  const auth = read("src/pages/Auth.tsx");
  assert(auth.includes("if (data?.onboarding_completed || allowDashboardWithoutBrain(import.meta.env)) return '/dashboard';"));
  assertEquals((auth.match(/allowDashboardWithoutBrain\(/g) ?? []).length, 1);
});
