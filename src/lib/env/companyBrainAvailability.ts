// IS THE COMPANY BRAIN WRITABLE IN THIS ENVIRONMENT?
//
// The isolated TEST project (`tlvnfrxzjhsjgdofwehb`) blocks every Company Brain
// write at the database (trigger `discovery_test_no_company_brain`), by design:
// it was built to test discovery without a Brain. The editor did not know that,
// so a save produced "Company Brain was changed elsewhere — the Company Brain
// is still loading", which is neither true nor actionable (TEST, 2026-11-12).
//
// Pure and ref-locked: only the frontend's own Supabase URL decides, and only
// that one TEST ref is affected. Production and every other project: writable.
import { projectRefFromUrl } from "./projectEnvironment.ts";
import { DISCOVERY_TEST_PROJECT_REF } from "./testOnboardingBypass.ts";

export type AvailabilityEnv = Readonly<Record<string, unknown>>;

export const COMPANY_BRAIN_UNAVAILABLE_TITLE = "Company Brain is turned off in this TEST environment";
export const COMPANY_BRAIN_UNAVAILABLE_MESSAGE =
  "This isolated TEST project blocks Company Brain writes by design, so nothing on this page can be saved. " +
  "ORION still answers from this workspace's leads and signals, and says what it doesn't know about your business. " +
  "To test with a complete Company Brain, use a separate Brain-enabled test project (roadmap P2).";

export function companyBrainWritesBlocked(env: AvailabilityEnv): boolean {
  const url = env.VITE_SUPABASE_URL;
  return projectRefFromUrl(typeof url === "string" ? url : null) === DISCOVERY_TEST_PROJECT_REF;
}
