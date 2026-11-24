// THE PLANNER GETS A BOUNDED PROJECTION OF THE COMPANY BRAIN, NOT THE ROW (roadmap 1.3).
//
// orchestrate pasted JSON.stringify(profile) into its planning prompt: every
// research blob, the stored integration_status map and any pasted credential,
// with no size limit. These tests pin the replacement (plannerBrainContext) and
// that orchestrate uses it in both places the brain reaches the model.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { plannerBrainContext, EMPTY_BRAIN_MARKER } from "../../../supabase/functions/_shared/plannerBrainContext.ts";
import { CONTEXT_LIMITS } from "../../../supabase/functions/_shared/intelligence/missionContext.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const brain = () => ({
  schema_version: 2,
  company: { name: "Northwind", description: "Revenue analytics for sales leaders", business_model: "B2B SaaS" },
  target_customer: {
    industries: ["Fintech", "Logistics"], geography: ["United Kingdom"], company_size: { min: 50, max: 200, label: "" },
    disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: ["crypto"], titles: [] },
  },
  buyer_personas: ["CFO"],
  pain_points: ["Slow board reporting", "token: sk-live-abcdefghijklmnopqrstuvwxyz0123"],
  qualification_rules: { required_evidence: ["Public pricing page"], reject_if: ["Fewer than 20 employees"], manual_review_if: [] },
  // Row content the planner has no use for, and some it must never see.
  integration_status: { apify: { configured: true }, firecrawl: { configured: false } },
  company_research: { pages: [{ url: "https://northwind.example", html: "<html>".padEnd(50_000, "x") }] },
  suggested_fixes: [{ path: "icp.industries", value: "Healthcare" }],
  onboarding_meta: { tour_dismissed: true },
  webhook_url: "https://hooks.example/secret-path",
});

Deno.test("1.3-1 the planner sees targeting, exclusions and hard rules", () => {
  const { context, serialized } = plannerBrainContext(WS, brain());
  assert(context);
  assertEquals(context.icp.industries, ["Fintech", "Logistics"]);
  assert(context.icp.exclusions.includes("Agencies"));
  assert(context.icp.hard_constraints.includes("Public pricing page"));
  assert(serialized.includes("Northwind"));
});

Deno.test("1.3-2 nothing from the raw row that is not Brain content reaches the prompt", () => {
  const { serialized } = plannerBrainContext(WS, brain());
  for (const leaked of ["integration_status", "firecrawl", "company_research", "<html>", "suggested_fixes", "Healthcare", "onboarding_meta", "hooks.example"]) {
    assertFalse(serialized.includes(leaked), `${leaked} leaked into the planner prompt`);
  }
});

Deno.test("1.3-3 a pasted credential is stripped, its siblings survive", () => {
  const { serialized } = plannerBrainContext(WS, brain());
  assertFalse(serialized.includes("sk-live-abcdefghijklmnopqrstuvwxyz0123"));
  assert(serialized.includes("Slow board reporting"));
});

Deno.test("1.3-4 bounded: a pathological brain stays under the prompt budget and degrades evenly", () => {
  const huge = brain();
  const many = (p: string) => Array.from({ length: 400 }, (_, i) => `${p} ${i} `.padEnd(400, "z"));
  (huge.target_customer as Record<string, unknown>).industries = many("Industry");
  huge.pain_points = many("Pain");
  huge.buyer_personas = many("Role");
  const r = plannerBrainContext(WS, huge);
  assert(r.serialized.length <= CONTEXT_LIMITS.maxSerializedChars, `${r.serialized.length} chars`);
  assert(r.listLimit < CONTEXT_LIMITS.maxListItems, "lists were shortened to fit");
  assert(r.context && r.context.icp.industries.length > 0, "every list keeps its first items, none is dropped entirely");
  assertEquals(JSON.parse(r.serialized).workspace_id, WS, "still valid JSON — never cut mid-string");
});

Deno.test("1.3-5 deterministic: the same brain yields the same prompt text", () => {
  assertEquals(plannerBrainContext(WS, brain()).serialized, plannerBrainContext(WS, brain()).serialized);
});

Deno.test("1.3-6 an empty brain says so instead of inviting invention", () => {
  assertEquals(plannerBrainContext(WS, {}).serialized, EMPTY_BRAIN_MARKER);
  assertEquals(plannerBrainContext(WS, null).context, null);
});

Deno.test("1.3-7 orchestrate passes the projection to both prompts, never the row", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url));
  assertFalse(/JSON\.stringify\(companyBrain\)/.test(src), "the raw profile is not serialized into a prompt");
  assert(/\$\{plannerBrain\.serialized\}/.test(src), "the planning prompt uses the bounded projection");
  assert(/companyBrain:\s*\(plannerBrain\.context \?\? \{\}\)/.test(src), "the system prompt gets the projection too");
  assert(/\[orchestrate\]\[planner-brain\]/.test(src), "the prompt size is logged");
});
