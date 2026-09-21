// THE TWO ANALYZE BUTTONS, FROM THE CLIENT SIDE OF THE BOUNDARY.
//
// Every guarantee here is invisible to a backend test: a second click that
// starts a second paid run, a "Something went wrong" that tells the user
// nothing, a skip path quietly lost in a refactor. They live in the component,
// so they are pinned against the component's source.
//
// PURE — no DOM, no render, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

const PAGE = await read("src/pages/OnboardingCompanyBrain.tsx");
const FOUNDER = await read("src/components/onboarding/scenes/FounderScenes.tsx");
const COMPANY = await read("src/components/onboarding/scenes/CompanyScenes.tsx");
const KIT = await read("src/components/onboarding/scenes/sceneKit.tsx");
const GUIDED = await read("src/components/onboarding/GuidedSetup.tsx");

Deno.test("a second Analyze click cannot start a second run", () => {
  // Two defences, because either alone has a hole: the button is disabled while
  // busy, and the handler refuses re-entry for the tick before React re-renders.
  for (const fn of ["analyzeFounder", "analyzeCompany"]) {
    const body = PAGE.slice(PAGE.indexOf(`async function ${fn}(`));
    const guard = body.indexOf("if (busy) return;");
    const start = body.indexOf("setBusy(");
    assert(guard > -1, `${fn} must refuse re-entry while a run is in flight`);
    assert(guard < start, `${fn} must check busy BEFORE claiming it`);
  }
  assert(/busy=\{busy\}/.test(PAGE), "the guided setup must know it is busy");
  assert(/fieldset disabled=\{!!busy\}/.test(GUIDED), "fields and navigation are locked during research");
  assert(/primaryBusy=\{busy\}/.test(FOUNDER), "the founder button must disable itself");
  assert(/primaryBusy=\{busy\}/.test(COMPANY), "the company button must disable itself");
  assert(/disabled=\{primaryDisabled \|\| primaryBusy\}/.test(KIT), "busy must actually disable the button");
});

Deno.test("each button has an idle label and an analyzing label", () => {
  assert(/busy \? 'Analyzing profile…' : 'Analyze LinkedIn profile'/.test(FOUNDER));
  assert(/busy \? 'Reading the site…' : 'Analyze company'/.test(COMPANY));
});

Deno.test("a failure says what failed, and never 'Something went wrong'", () => {
  assertEquals(/something went wrong/i.test(PAGE), false);
  // Every refusal the edge function can return has its own sentence.
  for (const reason of [
    "consent_not_given", "invalid_linkedin_profile_url", "invalid_linkedin_company_url",
    "apify_not_configured", "firecrawl_not_configured", "llm_not_configured",
    "invalid_website_url", "sparse_profile_data", "no_pages_fetched",
  ]) {
    assert(PAGE.includes(`case '${reason}'`), `no message for ${reason}`);
  }
  assert(PAGE.includes("Continue with your own details"), "unavailable research must explain the manual fallback");
});

Deno.test("skip and continue manually survives", () => {
  assert(FOUNDER.includes("Skip and continue manually"));
  assert(GUIDED.includes('You can continue manually at any time.'));
  assert(GUIDED.includes('onPrimary={step === 5 ? p.onActivate : next}'));
});

Deno.test("a successful analysis advances the wizard and keeps a sparse result", () => {
  const founder = PAGE.slice(PAGE.indexOf("async function analyzeFounder("), PAGE.indexOf("async function analyzeCompany("));
  assert(GUIDED.includes("Reading profile…"), "research has a visible busy state");
  assert(founder.includes("setFounderResearch(r.research)"), "a good result is kept");
  assert(/if \(r\?\.research\) setFounderResearch\(r\.research\)/.test(founder),
    "a sparse result is kept too — the user can still see what was found");
});

Deno.test("fixture results are labelled in the UI, and the label is the only mock-aware line", () => {
  // "Do not put mock-specific logic throughout the UI": the component may say
  // that a result came from a fixture, and may do nothing else differently.
  const hits = [...PAGE.matchAll(/provider_mode/g)].length;
  assertEquals(hits, 2, "exactly one provider_mode check per analyze handler");
  assert(PAGE.includes("Local fixture — no provider was called"));
  assertEquals(/if \(.*provider_mode.*\) \{/.test(PAGE), false, "no branching flow on mock mode");
});

Deno.test("the client validates both URLs before it spends anything", () => {
  assert(/primaryDisabled=\{!canEnrichFounder\(value\)\}/.test(FOUNDER));
  assert(/primaryDisabled=\{!canAnalyzeCompany\(value\)\}/.test(COMPANY));
});

Deno.test("onboarding writes go through the app's own Supabase client, never a URL of its own", () => {
  // The client is configured once, from VITE_SUPABASE_URL; a fetch() to a
  // hardcoded project here is how a local session ends up writing to production.
  assert(PAGE.includes("supabase.functions.invoke(FN"));
  assertEquals(/https:\/\/[a-z0-9]+\.supabase\.co/.test(PAGE), false, "no hardcoded project URL");
  assertEquals(/fetch\(/.test(PAGE), false, "onboarding makes no raw fetch of its own");
});
