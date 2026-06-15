import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyBrainContext,
  hasUsableBrain,
  brainCompetitors,
  brainICP,
  brainMissingFields,
} from "./companyBrainContext.ts";

const FLAT = {
  what_we_do: "AI workforce OS for founders and small teams",
  company_name: "Agentory",
  voice_and_tone: "premium, direct, founder-led, no hype",
  who_we_sell_to: "B2B SaaS founders and small GTM teams",
  competitors: ["GojiBerry", "Clay", "Artisan", "11x"],
};

const STRUCTURED = {
  company_name: "Agentory",
  category: "AI workforce OS",
  icp: { buyer_roles: ["Founder", "Head of GTM"], industries: ["B2B SaaS"], geography: "US", company_size: "1-50", pain_points: [] },
  goals: { gtm: "find warm leads", competitor_tracking: "track competitor conversations", content: "create founder content", outreach: "", hiring: "" },
  positioning: { promise: "Delegate GTM to an AI workforce", differentiators: ["multi-agent", "approval-gated"], use_cases: [], proof_points: [] },
  brand_voice: { tone: "premium, founder-led", tags: ["no-hype", "direct"], style_rules: [], avoid: [] },
  competitors: { known: ["GojiBerry", "Clay"], adjacent: ["Artisan"], unknown: false },
  approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true },
};

Deno.test("hasUsableBrain: needs onboarding complete + content", () => {
  assert(hasUsableBrain(FLAT, true));
  assert(hasUsableBrain(STRUCTURED, true));
  assert(!hasUsableBrain(FLAT, false), "incomplete onboarding → not usable");
  assert(!hasUsableBrain({}, true), "empty profile → not usable");
  assert(!hasUsableBrain(null, true));
});

Deno.test("buildCompanyBrainContext: flat profile", () => {
  const ctx = buildCompanyBrainContext(FLAT);
  assert(ctx.includes("Company: Agentory"));
  assert(ctx.includes("AI workforce OS for founders"));
  assert(ctx.includes("ICP: B2B SaaS founders"));
  assert(ctx.includes("Competitors: GojiBerry, Clay, Artisan, 11x"));
  assert(ctx.includes("Voice: premium, direct, founder-led, no hype"));
  assert(ctx.includes("Approval rules:"));
});

Deno.test("buildCompanyBrainContext: structured profile", () => {
  const ctx = buildCompanyBrainContext(STRUCTURED);
  assert(ctx.includes("Company: Agentory"));
  assert(ctx.includes("Category: AI workforce OS"));
  assert(ctx.includes("ICP:"));
  assert(ctx.includes("Founder"));
  assert(ctx.includes("Goals: find warm leads"));
  assert(ctx.includes("Competitors: GojiBerry, Clay, Artisan"));
  assert(ctx.includes("Voice:"));
});

Deno.test("brainCompetitors: both shapes", () => {
  assertEquals(brainCompetitors(FLAT), ["GojiBerry", "Clay", "Artisan", "11x"]);
  assertEquals(brainCompetitors(STRUCTURED), ["GojiBerry", "Clay", "Artisan"]);
  assertEquals(brainCompetitors({}), []);
});

Deno.test("brainICP: both shapes, null when absent", () => {
  assert((brainICP(FLAT) ?? "").includes("B2B SaaS founders"));
  assert((brainICP(STRUCTURED) ?? "").includes("Founder"));
  assertEquals(brainICP({}), null);
});

Deno.test("brainMissingFields: empty profile reports all; full profile reports none", () => {
  const miss = brainMissingFields({});
  assert(miss.includes("company name"));
  assert(miss.includes("competitors"));
  assertEquals(brainMissingFields(FLAT).length, 0);
});

Deno.test("never invents: no competitors line when absent", () => {
  const ctx = buildCompanyBrainContext({ company_name: "X", what_we_do: "Y" });
  assert(!ctx.includes("Competitors:"), "should not fabricate competitors");
});
