import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldGateForOnboarding, GATED_INTENTS } from "./companyBrainGate.ts";

Deno.test("gates content_draft when onboarding incomplete", () => {
  assert(shouldGateForOnboarding("content_draft", null));
  assert(shouldGateForOnboarding("content_draft", { onboarding_completed: false }));
  assert(shouldGateForOnboarding("content_draft", { onboarding_completed: false, profile: { company_name: "Acme" } }));
});

Deno.test("does NOT gate when onboarding completed", () => {
  assertEquals(shouldGateForOnboarding("content_draft", { onboarding_completed: true }), false);
  assertEquals(shouldGateForOnboarding("source_signals", { onboarding_completed: true }), false);
});

Deno.test("does NOT gate small talk / clarification / unclear", () => {
  for (const intent of ["smalltalk", "clarification", "unclear", "daily_brief", "simple_chat"]) {
    assertEquals(shouldGateForOnboarding(intent, { onboarding_completed: false }), false);
  }
});

Deno.test("covers all expected gated intents", () => {
  assert(GATED_INTENTS.has("content_draft"));
  assert(GATED_INTENTS.has("draft_outreach"));
  assert(GATED_INTENTS.has("source_signals"));
});
