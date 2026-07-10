// Completeness rules + the "This powers" copy shown on the Activate step.
// Pure — no React, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";
import {
  computeCompanyBrainCompleteness, canActivateBrain, getMissingCompanyBrainFields,
  BRAIN_POWERS, AGENT_ROSTER,
} from "./companyBrainCompleteness.ts";

/** Agents that do NOT exist in this product — onboarding must never name them. */
const INVENTED_AGENTS = ["Nova", "Atlas", "Mira", "Orion"];

Deno.test("1. BRAIN_POWERS names only agents that exist in the backend roster", () => {
  const copy = BRAIN_POWERS.map((p) => `${p.label} ${p.blurb}`).join(" ");
  for (const fake of INVENTED_AGENTS) {
    assert(!new RegExp(`\\b${fake}\\b`, "i").test(copy), `onboarding must not claim agent "${fake}" exists`);
  }
  // The real roster, per agentorySystemPrompt.ts
  assertEquals([...AGENT_ROSTER], ["Pilot", "Scout", "Aria", "Hawk", "Scribe"]);
  const agentsBlurb = BRAIN_POWERS.find((p) => p.key === "agents")!.blurb;
  for (const real of AGENT_ROSTER) {
    assert(agentsBlurb.includes(real), `agents blurb should mention ${real}`);
  }
});

Deno.test("2. BRAIN_POWERS covers the five surfaces the Brain powers", () => {
  assertEquals(BRAIN_POWERS.map((p) => p.key), ["leads", "radar", "content", "agents", "outreach"]);
});

Deno.test("3. empty brain is not activatable and reports every missing field", () => {
  const b = normalizeCompanyBrain({});
  assertEquals(canActivateBrain(b), false);
  const c = computeCompanyBrainCompleteness(b);
  assertEquals(c.required_met, 0);
  assertEquals(c.confidence, "weak");
  assert(getMissingCompanyBrainFields(b).includes("Company name"));
  assert(getMissingCompanyBrainFields(b).includes("At least one disqualifier"));
});

Deno.test("4. a complete brain is activatable and reports nothing missing", () => {
  const b = normalizeCompanyBrain({
    company: { name: "Cekura", website_url: "https://cekura.ai", business_model: "B2B SaaS" },
    target_customer: { industries: ["B2B SaaS"], disqualifiers: { industries: ["pharma"] } },
    buyer_personas: ["Founder"], triggers: ["recently funded"], pain_points: ["manual outbound"],
  });
  assertEquals(canActivateBrain(b), true);
  const c = computeCompanyBrainCompleteness(b);
  assertEquals(c.complete, true);
  assertEquals(c.missing, []);
  assert(c.percent >= 80);
});

Deno.test("5. missing fields are grouped by the review card that fixes them", () => {
  const b = normalizeCompanyBrain({ company: { name: "Cekura" } });
  const c = computeCompanyBrainCompleteness(b);
  assert(c.missing_by_step.customers?.length, "market gap routes to the customers card");
  assert(c.missing_by_step.disqualifiers?.length, "disqualifier gap routes to that card");
});
