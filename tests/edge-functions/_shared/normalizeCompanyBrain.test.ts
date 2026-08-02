import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeCompanyBrain, emptyCompanyBrainV2 } from "../../supabase/functions/_shared/normalizeCompanyBrain.ts";

Deno.test("empty in → empty out, weak, setup_required", () => {
  const v2 = normalizeCompanyBrain({});
  assertEquals(v2.schema_version, 2);
  assertEquals(v2.brain_confidence, "weak");
  assertEquals(v2.setup_required, true);
  assertEquals(v2.target_customer.industries, []);
  assertEquals(v2.buyer_personas, []);
});

Deno.test("null profile safe", () => {
  const v2 = normalizeCompanyBrain(null);
  assertEquals(v2.setup_required, true);
});

Deno.test("corrupted positioning string is coerced", () => {
  const v2 = normalizeCompanyBrain({ positioning: "we help founders ship pipeline" });
  assertEquals(v2.positioning.promise, "we help founders ship pipeline");
  assertEquals(v2.positioning.differentiators, []);
});

Deno.test("corrupted brand_voice string is coerced", () => {
  const v2 = normalizeCompanyBrain({ brand_voice: "direct no-hype" });
  assertEquals(v2.brand_voice.tone, "direct no-hype");
});

Deno.test("legacy icp projects into v2 target_customer", () => {
  const v2 = normalizeCompanyBrain({
    icp: {
      industries: ["B2B SaaS"], buyer_roles: ["Founder"],
      company_size: "10-150", geography: "US", pain_points: ["pipeline"],
      disqualifiers: ["manufacturing"],
    },
  });
  assertEquals(v2.target_customer.industries, ["B2B SaaS"]);
  assertEquals(v2.buyer_personas, ["Founder"]);
  assertEquals(v2.target_customer.company_size.min, 10);
  assertEquals(v2.target_customer.company_size.max, 150);
  assertEquals(v2.target_customer.disqualifiers.industries, ["manufacturing"]);
  assertEquals(v2.setup_required, false);
});

Deno.test("v2 wins over legacy when both present", () => {
  const v2 = normalizeCompanyBrain({
    schema_version: 2,
    target_customer: { industries: ["AI SaaS"] },
    buyer_personas: ["CTO"],
    icp: { industries: ["ignored"], buyer_roles: ["ignored"] },
  });
  assertEquals(v2.target_customer.industries, ["AI SaaS"]);
  assertEquals(v2.buyer_personas, ["CTO"]);
});

Deno.test("v2 disqualifier buckets preserved", () => {
  const v2 = normalizeCompanyBrain({
    target_customer: {
      disqualifiers: {
        industries: ["manufacturing"], company_types: ["staffing"],
        domains: ["x.com"], keywords: ["lab testing"], titles: ["Plant Manager"],
      },
    },
  });
  assertEquals(v2.target_customer.disqualifiers.company_types, ["staffing"]);
  assertEquals(v2.target_customer.disqualifiers.titles, ["Plant Manager"]);
});

Deno.test("empty brain does not fabricate SaaS targeting", () => {
  const v2 = emptyCompanyBrainV2();
  assertEquals(v2.target_customer.industries, []);
  assertEquals(v2.buyer_personas, []);
  assertEquals(v2.company.business_model, "");
  assert(v2.setup_required);
});
