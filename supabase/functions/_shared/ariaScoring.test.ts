import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  scoreCompany, rankCompanies, competitorSimilarity, starTier, resolveWeights,
  DEFAULT_ARIA_WEIGHTS, type AriaBrain, type AriaCandidate,
} from "./ariaScoring.ts";

// Company Brain: founder-led AI SaaS, 20-100 employees, B2B, avoid banks/universities/enterprise/manufacturing.
const brain: AriaBrain = {
  icp: {
    industries: ["AI", "B2B SaaS", "Software"],
    company_size: "20-100 employees",
    geography: "United States",
    buyer_roles: ["Founder", "CEO", "Chief of Staff"],
    funding_stage: ["Seed", "Series A"],
    disqualifiers: ["bank", "university", "manufacturing"],
    negative_industries: ["manufacturing"],
    allow_enterprise: false,
  },
  positioning: { keywords: ["outbound", "GTM", "sales automation"] },
  competitors: ["Clay", "11x", "Instantly"],
};

Deno.test("small AI startup with hiring proof → High confidence, ★4/★5, explainable", () => {
  const s = scoreCompany({
    company: "Acme AI", industry: "B2B SaaS / AI", team_size: "62", location: "United States",
    founder: "Jane Doe", funding_stage: "Series A", hiring_role: "Chief of Staff",
    exact_signal: "Chief of Staff reporting to CEO", source_url: "https://linkedin.com/jobs/view/1",
  }, brain);
  assert(s.overall_fit >= 80, `fit ${s.overall_fit}`);
  assert(s.star_tier >= 4);
  assertEquals(s.confidence.level, "high");
  assert(s.icp_match.industry && s.icp_match.size && s.icp_match.hiring);
  assert(s.why_accepted.some((w) => /Chief of Staff/i.test(w)));
  assert(s.why_accepted.some((w) => /62 employees/.test(w)));
  assert(s.why_accepted.some((w) => /ICP filters/i.test(w)));
});

Deno.test("enterprise bank → disqualified → ★1 reject, no High confidence", () => {
  const s = scoreCompany({
    company: "First National Bank", industry: "Banking", team_size: "20000", location: "United States",
    hiring_role: "Executive Assistant", source_url: "https://linkedin.com/jobs/view/2",
  }, brain);
  assert(s.disqualified);
  assertEquals(s.star_tier, 1);
  assert(!s.accepted);
  assert(s.overall_fit <= 20);
});

Deno.test("manufacturing plant → disqualified reject", () => {
  const s = scoreCompany({ company: "SteelWorks Manufacturing", industry: "Heavy Manufacturing", team_size: "8000" }, brain);
  assert(s.disqualified && !s.accepted);
});

Deno.test("Company Brain wins over query relevance: ICP-98 ranks above ICP-32", () => {
  // Company A: perfect ICP fit. Company B: would rank high on keywords but off-ICP.
  const a: AriaCandidate = { company: "GTM AI Co", industry: "B2B SaaS AI", team_size: "48", location: "United States", founder: "F", funding_stage: "Series A", hiring_role: "Chief of Staff", source_url: "https://li/jobs/a" };
  const b: AriaCandidate = { company: "MegaManufacturing", industry: "Manufacturing", team_size: "12000", hiring_role: "Executive Assistant", source_url: "https://li/jobs/b" };
  const ranked = rankCompanies([b, a], brain);
  assertEquals(ranked[0].candidate.company, "GTM AI Co");
  assert(ranked[0].score.overall_fit > ranked[1].score.overall_fit + 40);
});

Deno.test("competitor similarity: direct mention → high; unrelated → low", () => {
  assert(competitorSimilarity({ company: "ClayClone", industry: "Clay alternative for outbound" }, ["Clay", "11x"]) >= 80);
  assertEquals(competitorSimilarity({ company: "Random Co", industry: "pizza delivery" }, ["Clay", "11x"]), 0);
});

Deno.test("confidence never High without source proof", () => {
  const s = scoreCompany({ company: "NoProof Co", industry: "B2B SaaS", team_size: "40", location: "United States", founder: "F", funding_stage: "Seed" }, brain);
  assert(s.confidence.level !== "high", "no source_url → not high confidence");
  assert(s.missing_context.includes("source proof"));
});

Deno.test("missing enrichment lowers confidence + is reported, never invented", () => {
  const s = scoreCompany({ company: "Sparse Co", source_url: "https://li/jobs/x", hiring_role: "Chief of Staff" }, brain);
  assert(s.missing_context.includes("industry") || s.missing_context.includes("employee count"));
  assert(s.confidence.level !== "high");
});

Deno.test("configurable weights: doubling industry weight raises industry contribution", () => {
  const cand: AriaCandidate = { company: "AI Co", industry: "B2B SaaS AI", team_size: "50", source_url: "https://li/x", hiring_role: "CoS" };
  const base = scoreCompany(cand, brain, DEFAULT_ARIA_WEIGHTS);
  const w = resolveWeights({ industry: 50 });
  const boosted = scoreCompany(cand, brain, w);
  assert(boosted.breakdown.industry > base.breakdown.industry);
  assertEquals(boosted.max_breakdown.industry, 50);
});

Deno.test("starTier thresholds + disqualified override", () => {
  assertEquals(starTier(90).tier, 5);
  assertEquals(starTier(72).tier, 4);
  assertEquals(starTier(55).tier, 3);
  assertEquals(starTier(35).tier, 2);
  assertEquals(starTier(10).tier, 1);
  assertEquals(starTier(95, true).tier, 1); // disqualified forces reject
});
