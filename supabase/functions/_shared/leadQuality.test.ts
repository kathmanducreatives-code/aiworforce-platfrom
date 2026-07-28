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

Deno.test("GTM hiring lead (B2B SaaS, USA, no website) scores qualified+", () => {
  const r = evaluateLeadQuality({
    lead: { name: "ScaleCo", location: "Austin, USA", exact_signal: "Hiring Account Executive", signal_type: "hiring", website: "https://www.linkedin.com/jobs/view/9" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", industry: "B2B SaaS", location: "USA" },
  });
  assert(r.score >= 60, `expected qualified+, got ${r.score} (${r.tier})`);
  assert(r.accepted && (r.tier === "qualified" || r.tier === "hot"));
});

Deno.test("founding GTM hire scores hot", () => {
  const r = evaluateLeadQuality({
    lead: { name: "SeedCo", location: "USA", exact_signal: "Hiring Founding SDR", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", industry: "B2B SaaS", location: "USA" },
  });
  assert(r.tier === "hot" || r.tier === "qualified", `founding GTM hire should be strong, got ${r.tier} (${r.score})`);
  assert(r.accepted);
  assert(r.matched_icp_fields.includes("stage"), "founding hire implies early-stage");
});

Deno.test("strong job post counts as intent signal even without a company website", () => {
  const r = evaluateLeadQuality({
    lead: { name: "NoSite Inc", location: "USA", exact_signal: "Hiring Head of Growth" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", industry: "B2B SaaS", location: "USA" },
  });
  assert(r.reasons.some((x) => /hiring/i.test(x)), "hiring should be a scored signal");
  assert(!r.reject_reasons.length, "missing website must not hard-reject a strong hiring signal");
  assert(r.score >= 60);
});

Deno.test("missing website lowers confidence but does not auto-reject hiring lead", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Anon", location: "USA", exact_signal: "Hiring SDR" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", location: "USA" },
  });
  assert(r.missing_fields.includes("website"));
  assert(r.confidence !== "high", "no verified site → not high confidence");
  assert(!r.reject_reasons.length, "should not be rejected just for missing website");
});

Deno.test("non-GTM hiring is not over-credited for a GTM request", () => {
  const r = evaluateLeadQuality({
    lead: { name: "JanitorCo", location: "USA", exact_signal: "Hiring Office Cleaner", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", industry: "B2B SaaS", location: "USA" },
  });
  // Generic non-GTM hire gets the lower signal tier + no persona credit.
  assert(!r.matched_icp_fields.includes("buyer_role"), "office cleaner hire is not a GTM persona signal");
});

Deno.test("US city/state location matches a USA target (qualifies a US GTM-hiring lead)", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Ivo", location: "San Francisco, CA", exact_signal: "Director of GTM Strategy", signal_type: "hiring", website: "https://www.linkedin.com/jobs/view/1" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", industry: "B2B SaaS", location: "USA" },
  });
  assert(r.matched_icp_fields.includes("geography"), "San Francisco, CA should match USA");
  assert(r.score >= 60 && r.accepted, `US GTM-hiring lead should qualify, got ${r.score} (${r.tier})`);
});

Deno.test("non-US location does not match a USA target", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Toronto Co", location: "Toronto, ON, Canada", exact_signal: "Hiring AE", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "GTM", location: "USA", strict_location: true }, strictness: "strict",
  });
  assert(!r.matched_icp_fields.includes("geography"));
  assert(r.reject_reasons.some((x) => x.includes("geography")));
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

// ---- Assistant / founder-support hiring acceptance ----
Deno.test("assistant-role: 'Co-Founder @ Company' rejected as a profile title", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Acme", title: "Co-Founder @ Company", exact_signal: "Co-Founder", location: "USA", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "Executive Assistant", location: "USA" },
  });
  assert(!r.accepted, "a co-founder profile row is not a hiring signal");
  assert(r.reject_reasons.some((x) => /profile title/i.test(x)), "should flag the profile title");
});

Deno.test("assistant-role: 'Hiring Executive Assistant to CEO' accepted", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Acme", exact_signal: "Hiring Executive Assistant to CEO", location: "USA", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "Executive Assistant", industry: "B2B SaaS", location: "USA" },
  });
  assert(r.accepted, "executive-assistant hire should be accepted");
  assert(r.score >= 60, `expected qualified+, got ${r.score} (${r.tier})`);
  assert(r.matched_icp_fields.includes("buyer_role"), "support hire is a persona signal");
  const why = buildWhyThisLead(r);
  assert(/founder-support|executive assistant/i.test(why), `why_this_lead should mention the support role: ${why}`);
});

Deno.test("assistant-role: bare CEO title rejected even without an explicit role", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Acme", title: "CEO", exact_signal: "CEO", location: "USA", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
  });
  assert(!r.accepted);
  assert(r.reject_reasons.some((x) => /profile title/i.test(x)));
});

Deno.test("assistant-role: 'Founder Associate' as a job signal is NOT a profile title", () => {
  // "Founder Associate" is a support role (in SUPPORT_ROLE_ALIASES). As a hiring
  // signal it must survive the profile-title guard (bare "founder" is excluded).
  const r = evaluateLeadQuality({
    lead: { name: "Acme", exact_signal: "Hiring Founder Associate", location: "USA", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "Executive Assistant", location: "USA" },
  });
  assert(!r.reject_reasons.some((x) => /profile title/i.test(x)), "Founder Associate is a support role, not a profile title");
  assert(r.accepted, "founder-associate hire should be accepted");
});

Deno.test("assistant-role: 'Assistant to CEO' (contains 'CEO') is accepted", () => {
  const r = evaluateLeadQuality({
    lead: { name: "Acme", exact_signal: "Hiring Assistant to CEO", location: "USA", signal_type: "hiring" },
    companyBrain: BRAIN, sourceType: "hiring_signal",
    userRequest: { role: "Executive Assistant", location: "USA" },
  });
  assert(!r.reject_reasons.some((x) => /profile title/i.test(x)), "support role must not be mistaken for a CEO profile title");
  assert(r.accepted);
});
