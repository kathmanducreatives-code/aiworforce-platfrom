// THE APP FOLLOWS THE SAME READINESS RULE AS THE SERVER (roadmap Phase 2b),
// behind VITE_BRAIN_READINESS_V2. Off: every screen behaves as before.
//
//   · route guard   a usable, not-yet-activated Brain opens the app; an empty
//                   draft still goes to onboarding
//   · page notices  each capability page names exactly what to add
//   · autosave      progress is saved to the server and resumed on any device;
//                   never for an activated Brain; consent is never restored
// Pure, plus source assertions for the React wiring.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideRouteGuard, type RouteGuardState } from "../../src/lib/routeGuard.ts";
import { brainUsableForRoutes, readinessOfRow } from "../../src/lib/brainReadinessFlag.ts";
import { capabilityNotice } from "../../src/lib/brainCapabilityNotice.ts";
import { answersFromForms, readServerProgress, sameProgress } from "../../src/lib/onboardingAutosave.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const row = (profile: Record<string, unknown>, activated = false) => ({ profile: { schema_version: 2, ...profile }, onboarding_completed: activated });
const USABLE = row({ target_customer: { industries: ["Fintech"] }, buyer_personas: ["CFO"] });
const EMPTY = row({});

const guard: RouteGuardState = {
  authLoading: false, user: { id: "u1" }, requireOnboarding: true, onboardingLoading: false,
  onboardingCompleted: false, pathname: "/signals", search: "",
};

Deno.test("F-1 route guard: a usable Brain opens the app; an empty draft still goes to onboarding; off is unchanged", () => {
  assertEquals(decideRouteGuard({ ...guard, brainUsable: brainUsableForRoutes(USABLE, true) }), { type: "render" });
  assertEquals(decideRouteGuard({ ...guard, brainUsable: brainUsableForRoutes(EMPTY, true) }).type, "redirect");
  assertEquals(decideRouteGuard({ ...guard, brainUsable: brainUsableForRoutes(USABLE, false) }).type, "redirect", "switch off");
  assertEquals(decideRouteGuard(guard).type, "redirect", "callers that don't pass it keep the original rule");
  assertFalse(brainUsableForRoutes(row({ target_customer: { industries: ["Fintech"] } }, true), true), "activated is not 'usable'");
  assertFalse(brainUsableForRoutes(null, true));
});

Deno.test("F-2 page notices name exactly what is missing, and vanish when the capability is available", () => {
  const signals = capabilityNotice(readinessOfRow(EMPTY), "signals");
  assertEquals(signals?.needs, ["Add your target industries or must-have traits"]);
  assertEquals(signals?.href, "/company-brain");
  assertEquals(capabilityNotice(readinessOfRow(USABLE), "signals"), null);
  assertEquals(capabilityNotice(readinessOfRow(USABLE), "lead_search"), null, "decision 1: lead search before activation");
  const content = capabilityNotice(readinessOfRow(row({ company: { description: "Analytics" } })), "content");
  assertEquals(content?.needs, ["Add a pain point or a content angle"]);
  // Outreach on an otherwise-complete draft: the only thing left is finishing setup.
  const outreach = capabilityNotice(readinessOfRow(row({ ...USABLE.profile, positioning: { promise: "Close faster" } })), "outreach");
  assertEquals([outreach?.href, outreach?.cta], ["/onboarding/company-brain", "Finish setup"]);
  assertEquals(capabilityNotice(null, "signals"), null, "nothing loaded yet: no notice");
});

Deno.test("F-3 the notice is rendered only with the switch on, on Signals, Leads and Content", () => {
  const comp = read("src/components/company-brain/BrainCapabilityNotice.tsx");
  assert(/if \(!brainReadinessV2\(\)\) return null;/.test(comp));
  const app = read("src/App.tsx");
  for (const [cap, page] of [["signals", "Signals"], ["lead_search", "Leads"], ["content", "Content"]]) {
    assert(new RegExp(`<BrainCapabilityNotice capability="${cap}" />\\s*<${page} />`).test(app), page);
  }
  assert(read("src/components/ProtectedRoute.tsx").includes("brainUsable: brainUsableForRoutes(companyBrain)"));
});

Deno.test("F-4 answers carry the typed form values only — never consent — and round-trip from the server", () => {
  const answers = answersFromForms({
    company: { name: " Northwind ", website_url: "", stage: "Seed" },
    founder: { name: "Ada", enrichment_consent: true, timezone: "Europe/London" },
  });
  assertEquals(answers, { company: { name: "Northwind", stage: "Seed" }, founder: { name: "Ada", timezone: "Europe/London" } });
  const stored = { onboarding_meta: { setup: { version: 1, step: 2, answers: { ...answers, founder: { ...answers.founder, enrichment_consent: "true" } }, updated_at: "t" } } };
  assertEquals(readServerProgress(stored), { step: 2, answers, updated_at: "t" });
  assertEquals(readServerProgress({ onboarding_meta: { setup: { version: 2, step: 1 } } }), null);
  assert(sameProgress({ step: 2, answers }, { step: 2, answers: JSON.parse(JSON.stringify(answers)) }));
  assertFalse(sameProgress({ step: 2, answers }, { step: 3, answers }));
});

Deno.test("F-5 onboarding autosave: behind the switch, never for an activated Brain, consent kept from this tab", () => {
  const page = read("src/pages/OnboardingCompanyBrain.tsx");
  assert(/enabled: brainReadinessV2\(\) && restoredWorkspace === workspaceId && !activated/.test(page));
  assert(/enrichment_consent: f\.enrichment_consent/.test(page), "a restore never sets consent");
  const hook = read("src/hooks/useOnboardingAutosave.ts");
  assert(/row\?\.onboarding_completed !== true/.test(hook), "an activated Brain is never draft-saved");
  assert(/mergeStale\(base\.current!, mine, server\)/.test(hook), "a stale save is merged, not overwritten");
  const save = read("src/lib/onboardingProgressSave.ts");
  assert(/patch: \{\}/.test(save), "an autosave never writes Brain fields");
  assert(/expected_updated_at: input\.expectedUpdatedAt/.test(save), "and always names the version it builds on");
});

Deno.test("F-6 switch off: the route guard decides exactly what it did before, for every state and Brain", () => {
  const rows = [USABLE, EMPTY, row({ target_customer: { industries: ["Fintech"] } }, true), null];
  let cases = 0;
  for (const authLoading of [false, true]) for (const user of [null, { id: "u1" }]) for (const requireOnboarding of [false, true])
  for (const onboardingLoading of [false, true]) for (const onboardingCompleted of [true, false, null]) for (const r of rows) {
    const state: RouteGuardState = { authLoading, user, requireOnboarding, onboardingLoading, onboardingCompleted, pathname: "/leads", search: "?q=1" };
    assertEquals(decideRouteGuard({ ...state, brainUsable: brainUsableForRoutes(r, false) }), decideRouteGuard(state));
    cases++;
  }
  assertEquals(cases, 192);
});

Deno.test("F-7 switch off: onboarding autosave never starts — no restore, no save, status 'off'", () => {
  const hook = read("src/hooks/useOnboardingAutosave.ts");
  assert(/const active = enabled && /.test(hook));
  assert(/if \(!active \|\| resumed\.current === workspaceId\) return;/.test(hook), "no restore");
  assert(/if \(!active \|\| resumed\.current !== workspaceId \|\| !base\.current\) return;/.test(hook), "no save");
  assert(/return active \? status : 'off';/.test(hook));
  // The page's status line falls through to the original wording when the hook reports 'off'.
  const page = read("src/pages/OnboardingCompanyBrain.tsx");
  assert(/autosave === 'offline' \? 'Offline — saved in this tab' : sessionSaved \? 'Saved in this tab' : 'Unsaved changes'/.test(page));
});
