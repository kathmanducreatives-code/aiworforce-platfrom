import { describe, it, expect } from "vitest";
import { normalizeCompanyBrain, emptyCompanyBrainV2 } from "./normalizeCompanyBrain";

describe("normalizeCompanyBrain", () => {
  it("empty in → empty out, weak, setup_required, no broad defaults", () => {
    const v2 = normalizeCompanyBrain({});
    expect(v2.schema_version).toBe(2);
    expect(v2.brain_confidence).toBe("weak");
    expect(v2.setup_required).toBe(true);
    expect(v2.setup_status).toBe("incomplete");
    expect(v2.target_customer.industries).toEqual([]);
    expect(v2.target_customer.business_models).toEqual([]);
    expect(v2.buyer_personas).toEqual([]);
    expect(v2.target_customer.disqualifiers.industries).toEqual([]);
  });

  it("null/undefined profile safe", () => {
    expect(normalizeCompanyBrain(null).schema_version).toBe(2);
    expect(normalizeCompanyBrain(undefined).setup_required).toBe(true);
  });

  it("coerces corrupted positioning string → object", () => {
    const v2 = normalizeCompanyBrain({ positioning: "we help founders ship pipeline" });
    expect(v2.positioning.promise).toBe("we help founders ship pipeline");
    expect(v2.positioning.differentiators).toEqual([]);
  });

  it("coerces corrupted brand_voice string → object", () => {
    const v2 = normalizeCompanyBrain({ brand_voice: "direct, no-hype" });
    expect(v2.brand_voice.tone).toBe("direct, no-hype");
    expect(v2.brand_voice.tags).toEqual([]);
  });

  it("legacy icp.* projects into target_customer.*", () => {
    const v2 = normalizeCompanyBrain({
      icp: {
        industries: ["B2B SaaS", "AI SaaS"],
        buyer_roles: ["Founder", "RevOps"],
        company_size: "10-150",
        geography: "US",
        pain_points: ["pipeline before hiring"],
        disqualifiers: ["manufacturing", "hospital"],
      },
    });
    expect(v2.target_customer.industries).toEqual(["B2B SaaS", "AI SaaS"]);
    expect(v2.buyer_personas).toEqual(["Founder", "RevOps"]);
    expect(v2.target_customer.company_size.min).toBe(10);
    expect(v2.target_customer.company_size.max).toBe(150);
    expect(v2.target_customer.geography).toEqual(["US"]);
    expect(v2.pain_points).toEqual(["pipeline before hiring"]);
    expect(v2.target_customer.disqualifiers.industries).toEqual(["manufacturing", "hospital"]);
    expect(v2.setup_required).toBe(false);
  });

  it("v2 fields win over legacy icp when both present", () => {
    const v2 = normalizeCompanyBrain({
      schema_version: 2,
      target_customer: { industries: ["AI SaaS"], geography: ["EU"] },
      buyer_personas: ["CTO"],
      icp: { industries: ["ignored"], buyer_roles: ["ignored"] },
    });
    expect(v2.target_customer.industries).toEqual(["AI SaaS"]);
    expect(v2.buyer_personas).toEqual(["CTO"]);
    expect(v2.target_customer.geography).toEqual(["EU"]);
  });

  it("structured v2 disqualifier buckets preserved", () => {
    const v2 = normalizeCompanyBrain({
      target_customer: {
        disqualifiers: {
          industries: ["manufacturing"],
          company_types: ["staffing agency"],
          domains: ["example.com"],
          keywords: ["lab testing"],
          titles: ["Plant Manager"],
        },
      },
    });
    expect(v2.target_customer.disqualifiers).toEqual({
      industries: ["manufacturing"],
      company_types: ["staffing agency"],
      domains: ["example.com"],
      keywords: ["lab testing"],
      titles: ["Plant Manager"],
    });
  });

  it("empty ICP does not silently become broad SaaS targeting", () => {
    const v2 = emptyCompanyBrainV2();
    expect(v2.target_customer.industries).toEqual([]);
    expect(v2.buyer_personas).toEqual([]);
    expect(v2.company.business_model).toBe("");
    expect(v2.setup_required).toBe(true);
  });

  it("must_have alone is enough to clear setup_required", () => {
    const v2 = normalizeCompanyBrain({
      target_customer: { must_have: ["uses HubSpot", "founder-led sales"] },
    });
    expect(v2.setup_required).toBe(false);
  });

  it("preserves original profile under .legacy", () => {
    const v2 = normalizeCompanyBrain({ founder: { name: "Prasidha" }, icp: { industries: ["B2B"] } });
    expect((v2.legacy as any).founder.name).toBe("Prasidha");
    expect((v2.legacy as any).icp.industries).toEqual(["B2B"]);
  });

  it("onboarding_completed flag → setup_status complete", () => {
    const v2 = normalizeCompanyBrain({ onboarding_completed: true });
    expect(v2.setup_status).toBe("complete");
  });
});
