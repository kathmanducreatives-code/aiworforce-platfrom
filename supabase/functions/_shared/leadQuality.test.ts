import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateLeadQuality, buildWhyThisLead, isRealCompanyWebsite, isJobBoardOrDirectory,
  type CompanyBrainLite,
} from "./leadQuality.ts";

const BRAIN: CompanyBrainLite = {
  icp: {
    buyer_roles: ["Founder", "Head of Growth", "VP Sales"],
    company_size: "early-stage",
    industries: ["B2B SaaS", "AI"],
    geography: "USA",
    pain_points: ["pipeline", "GTM hiring"],
    disqualifiers: ["staffing agency", "crypto"],
  },
  company: { stage: "seed", industry: "B2B SaaS" },
};

Deno.test("ICP industry from Company Brain is used + matched", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Acme", industry: "B2B SaaS", location: "San Francisco, USA", website: "https://acme.com", exact_signal: "Hiring Founding SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
  });
  assert(r.matched_icp_fields.includes("industry"), "industry should match ICP");
  assert(r.accepted, "strong B2B SaaS USA hiring lead should be accepted");
});

Deno.test("strict geography rejects wrong location", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Berlin Co", industry: "B2B SaaS", location: "Berlin, Germany", website: "https://berlinco.de", exact_signal: "Hiring SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { location: "USA", strict_location: true }, strictness: "strict",
  });
  assert(!r.accepted);
  assertEquals(r.tier, "rejected");
  assert(r.reject_reasons.some((x) => x.includes("geography")), "should reject on geography");
});

Deno.test("Company Brain disqualifier rejects the lead", () => {
  const r = evaluateLeadQuality({
    lead: { name: "BestStaff Staffing Agency", industry: "B2B SaaS", location: "Austin, USA", website: "https://beststaff.com", exact_signal: "Hiring SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
  });
  assert(!r.accepted);
  assert(r.reject_reasons.some((x) => x.includes("disqualifier")), "staffing agency is a disqualifier");
});

Deno.test("weak / no-signal company is not accepted", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Random LLC" }, // no website, no signal, no industry
    companyBrain: BRAIN, sourceType: "company_search",
  });
  assert(!r.accepted, "bare company with no signal/site should not be accepted");
  assert(r.missing_fields.includes("website") && r.missing_fields.includes("industry"));
});

Deno.test("accepted lead exposes a non-empty why_this_lead", () => {
  const r = evaluateLeadQuality({
    lead: { name: "GrowthCo", industry: "AI", location: "USA", website: "https://growthco.ai", exact_signal: "Hiring Head of Growth", team_size: "20" },
    companyBrain: BRAIN, sourceType: "hiring_signal", enrichment: { website_verified: true },
  });
  assert(r.accepted);
  const why = buildWhyThisLead(r);
  assert(why.length > 0 && !why.startsWith("Matched the requested"), `why_this_lead should be specific: ${why}`);
});

Deno.test("job-board / directory URL is not treated as a company website", () => {
  assert(!isRealCompanyWebsite("https://www.linkedin.com/jobs/view/123"));
  assert(isJobBoardOrDirectory("https://indeed.com/cmp/acme"));
  assert(isRealCompanyWebsite("https://acme.io"));
  // a company whose only "website" is a job board, in a company search, is rejected
  const r = evaluateLeadQuality({
    lead: { name: "JobBoardCo", industry: "B2B SaaS", location: "USA", website: "https://www.linkedin.com/company/x" },
    companyBrain: BRAIN, sourceType: "company_search",
  });
  assert(r.reject_reasons.some((x) => x.includes("job-board") || x.includes("directory") || x.includes("website")), "job-board-as-site should be flagged");
});

Deno.test("company too large for early-stage request is rejected", () => {
  const r = evaluateLeadQuality({
    lead: { name: "BigCorp", industry: "B2B SaaS", location: "USA", website: "https://bigcorp.com", team_size: "5001-10000", exact_signal: "Hiring SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { stage: "early-stage" },
  });
  assert(!r.accepted);
  assert(r.reject_reasons.some((x) => x.includes("too large")));
});

Deno.test("hot vs qualified vs weak tiers scale with fit", () => {
  const hot = evaluateLeadQuality({
    lead: { name: "Hot", industry: "B2B SaaS", location: "USA", website: "https://hot.com", exact_signal: "Hiring Founding SDR", title: "Founder", team_size: "12" },
    companyBrain: BRAIN, sourceType: "hiring_signal", enrichment: { website_verified: true },
    userRequest: { stage: "early-stage", location: "USA" },
  });
  assertEquals(hot.tier, "hot");
  const weak = evaluateLeadQuality({
    lead: { name: "Maybe", website: "https://maybe.com" }, // minimal, no signal/industry/geo
    companyBrain: BRAIN, sourceType: "company_search",
  });
  assert(weak.tier === "weak" || weak.tier === "rejected");
  assert(!weak.accepted);
});

Deno.test("people-profile founder is accepted on persona+geo without hiring signal", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Jane Doe", title: "Co-Founder & CEO", industry: "AI", location: "USA", website: "https://janestartup.com" },
    companyBrain: BRAIN, sourceType: "people_profiles",
    userRequest: { role: "Founder", location: "USA" },
  });
  assert(r.matched_icp_fields.includes("buyer_role"), "founder title should match persona");
  assert(r.accepted);
});

Deno.test("no Company Brain → neutral scoring, still rejects unverified junk", () => {
  const ok = evaluateLeadQuality({
    lead: { name: "Solo", industry: "SaaS", location: "USA", website: "https://solo.com", exact_signal: "Hiring AE" },
    sourceType: "hiring_signal",
  });
  assert(ok.score > 0);
  const junk = evaluateLeadQuality({ lead: { name: "" }, sourceType: "company_search" });
  assert(!junk.accepted);
  assert(junk.reject_reasons.some((x) => x.includes("missing name")));
});

Deno.test("confidence reflects data completeness", () => {
  const high = evaluateLeadQuality({
    lead: { name: "Full", title: "Founder", industry: "B2B SaaS", location: "USA", website: "https://full.com", exact_signal: "Hiring SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal", enrichment: { website_verified: true },
    userRequest: { location: "USA" },
  });
  assertEquals(high.confidence, "high");
  const low = evaluateLeadQuality({ lead: { name: "Sparse" }, sourceType: "company_search" });
  assertEquals(low.confidence, "low");
});
