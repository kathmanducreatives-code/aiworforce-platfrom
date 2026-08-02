import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyBrainContext,
  hasUsableBrain,
  brainCompetitors,
  brainICP,
  brainMissingFields,
} from "../../functions/_shared/companyBrainContext.ts";

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

Deno.test("buildCompanyBrainContext: extended fields render", () => {
  const ext = {
    founder: { name: "Prasidha", role: "Founder", timezone: "UTC+5:45", first_help_goal: "find_leads" },
    company: { name: "Agentory", stage: "pre-seed", team_size: "2-5", description: "AI workforce OS", category: "AI tools" },
    icp: { buyer_roles: ["Founder"], industries: ["B2B SaaS"], geography: "US", company_size: "1-50", pain_points: [], disqualifiers: ["enterprise", "non-B2B"] },
    gtm: { motion: "outbound", primary_channel: "cold call", preferred_channels: ["LinkedIn", "email"], biggest_bottleneck: "writing outreach", current_tools: ["Notion"], thirty_day_goal: "find 100 qualified leads" },
    positioning: { promise: "Delegate GTM", differentiators: ["multi-agent"], use_cases: [], proof_points: ["3x faster pipeline"], offer: "AI workforce subscription", pricing: "$99/mo", avoid_positioning: ["replace humans"] },
    brand_voice: { tone: "premium", tags: ["founder-led"], style_rules: [], avoid: ["hype words"], example_message: "" },
    competitors: { known: ["Clay"], adjacent: [], unknown: false },
    approval_rules: { draft_only: true, email_requires_approval: true, linkedin_manual_only: true, daily_credit_limit: 100 },
    workflow_preferences: { priority_workflows: ["find_hiring_signal_accounts", "generate_cold_call_openers"] },
    integration_status: {
      apify: { status: "connected", label: "Apify" },
      calendar: { status: "setup_needed", label: "Google Calendar" },
    },
  };
  const ctx = buildCompanyBrainContext(ext);
  assert(ctx.includes("Founder: Prasidha (Founder)"));
  assert(ctx.includes("stage pre-seed"));
  assert(ctx.includes("Disqualifiers: enterprise, non-B2B"));
  assert(ctx.includes("GTM: motion outbound"));
  assert(ctx.includes("primary cold call"));
  assert(ctx.includes("bottleneck: writing outreach"));
  assert(ctx.includes("Offer: AI workforce subscription ($99/mo)"));
  assert(ctx.includes("Proof: 3x faster pipeline"));
  assert(ctx.includes("Avoid positioning: replace humans"));
  assert(ctx.includes("Voice avoid: hype words"));
  assert(ctx.includes("Priority workflows: find_hiring_signal_accounts"));
  assert(ctx.includes("Integrations ready: Apify"));
  assert(ctx.includes("Integrations setup needed: Google Calendar"));
  assert(ctx.length <= 1800, `context too long: ${ctx.length} chars`);
  assert(!ctx.includes("{"), "should not dump raw JSON");
});

Deno.test("compiled-brain fields render for content/agents/outreach", () => {
  const ctx = buildCompanyBrainContext({
    company_name: "Agentory", icp: { industries: ["B2B SaaS"], buyer_roles: ["Founder"], pain_points: ["manual outbound"] },
    triggers: ["recently funded", "hiring first AE"], content_angles: ["pipeline before payroll"],
  });
  assert(ctx.includes("Pain points: manual outbound"));
  assert(ctx.includes("Triggers: recently funded, hiring first AE"));
  assert(ctx.includes("Content angles: pipeline before payroll"));
  assert(!ctx.includes("Setup needed:"), "complete ICP → no setup note");
});

Deno.test("incomplete ICP → setup-needed honesty note for agents/outreach", () => {
  const ctx = buildCompanyBrainContext({ company_name: "X", what_we_do: "we do things" });
  assert(ctx.includes("Setup needed:"), "no industries+buyers → ask for setup");
});

