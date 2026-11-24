// TEST ONLY: let signed-in users reach the dashboard without a Company Brain.
//
// The isolated Discovery TEST project (`tlvnfrxzjhsjgdofwehb`) forbids any
// Company Brain row by trigger (scripts/test-project/sql/
// 20261017120000_discovery_test_no_company_brain.sql), while OnboardingGate
// sends every gated route to Brain onboarding until a Brain is completed. On
// TEST the two together make the whole signed-in app unreachable.
//
// This is the narrowest way out. It changes ONE client-side redirect, and only
// when BOTH hold:
//   1. VITE_TEST_DASHBOARD_WITHOUT_BRAIN === "true", and
//   2. the configured Supabase URL is exactly the TEST project above.
// The ref is hard-coded and is never the production ref, so the flag set on a
// production build does nothing. No Brain row is created or implied; every
// server-side check (membership, roles, Brain readiness gates) is unchanged.

import { CANONICAL_PROJECT_REFS, projectRefFromUrl } from "./projectEnvironment.ts";

export const DISCOVERY_TEST_PROJECT_REF = "tlvnfrxzjhsjgdofwehb" as const;
export const TEST_DASHBOARD_WITHOUT_BRAIN_FLAG = "VITE_TEST_DASHBOARD_WITHOUT_BRAIN" as const;

/** `import.meta.env`, or a plain object in tests. Only two keys are read. */
export type BypassEnv = Readonly<Record<string, unknown>>;

export function allowDashboardWithoutBrain(env: BypassEnv): boolean {
  if (String(env[TEST_DASHBOARD_WITHOUT_BRAIN_FLAG] ?? "").trim().toLowerCase() !== "true") return false;
  const url = env.VITE_SUPABASE_URL;
  const ref = projectRefFromUrl(typeof url === "string" ? url : null);
  if (!ref || ref === CANONICAL_PROJECT_REFS.production) return false;
  return ref === DISCOVERY_TEST_PROJECT_REF;
}
