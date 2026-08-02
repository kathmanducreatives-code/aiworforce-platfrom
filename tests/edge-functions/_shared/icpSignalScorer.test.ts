import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { scoreAgainstCompanyBrain, type SignalCandidate } from "../../../supabase/functions/_shared/icpSignalScorer.ts";

const NOW = Date.parse("2026-07-06T00:00:00Z");
const recent = "2026-07-04T00:00:00Z";

const brain = compileCompanyBrainContext({
  workspace_id: "ws",
  profile: {
    company: { category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline" },
    icp: { buyer_roles: ["Founder", "RevOps", "Head of Growth", "Founding Account Executive"], company_size: "10-150 employees", industries: ["B2B SaaS", "AI SaaS"], disqualifiers: ["manufacturing", "hospital", "university", "government", "logistics", "local services"] },
    gtm: { motion: "founder-led sales", current_tools: ["Clay", "Apollo"] },
    competitors: { known: ["Clay", "Apollo"], adjacent: ["Instantly"] },
  },
  signal_preferences: { hiring_roles: ["Founding Account Executive", "RevOps"], linkedin_topics: ["founder-led sales", "hiring SDRs too early"] },
});
const emptyBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: {} });

const base = (o: Partial<SignalCandidate>): SignalCandidate => ({ signal_type: "hiring", title: "t", now: NOW, ...o });

Deno.test("1. B2B SaaS + Founding AE + job URL + 20–150 employees scores high", () => {
  const r = scoreAgainstCompanyBrain(base({
    signal_type: "hiring", title: "Cekura hiring Founding Account Executive", company_name: "Cekura",
    company_domain: "cekura.ai", website: "https://cekura.ai", industries: ["B2B SaaS", "AI"], employee_count: 40,
    job_title: "Founding Account Executive", job_url: "https://linkedin.com/jobs/view/cekura", source_url: "https://linkedin.com/jobs/view/cekura",
    job_description: "Building GTM at an AI SaaS company", source_published_at: recent,
  }), brain);
  assertEquals(r.verification_status, "verified");
  assert(r.signal_score >= 70, `score ${r.signal_score}`);
});

Deno.test("2. AI SaaS + RevOps job + website + source proof scores high", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "Acme hiring Revenue Operations", company_name: "Acme", company_domain: "acme.io", website: "https://acme.io",
    industries: ["AI SaaS"], employee_count: 60, job_title: "Revenue Operations", job_url: "https://linkedin.com/jobs/view/acme",
    source_url: "https://linkedin.com/jobs/view/acme", job_description: "own RevOps", source_published_at: recent,
  }), brain);
  assertEquals(r.verification_status, "verified");
  assert(r.signal_score >= 65);
});

Deno.test("3. recently funded SaaS + first sales hire → high trigger score", () => {
  const r = scoreAgainstCompanyBrain(base({
    signal_type: "funding", title: "Cekura raises $2.4M seed to build AI SaaS", company_name: "Cekura",
    website: "https://cekura.ai", company_domain: "cekura.ai", source_url: "https://news.test/cekura", evidence_text: "raised seed, hiring first sales",
    funding_amount: "$2.4M", funding_round: "seed", source_published_at: recent, industries: ["B2B SaaS"],
  }), brain);
  assert(r.trigger_score >= 10, `trigger ${r.trigger_score}`);
});

Deno.test("4. manufacturing Operations Manager rejected when Brain excludes manufacturing", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "BuildCo hiring Operations Manager", company_name: "BuildCo", company_description: "a manufacturing company",
    job_title: "Operations Manager", source_url: "https://linkedin.com/jobs/view/buildco",
  }), brain);
  assertEquals(r.verification_status, "rejected");
  assert(r.disqualifiers_hit.some((d) => d.toLowerCase() === "manufacturing"));
});

Deno.test("5. generic Operations Manager does not satisfy RevOps", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "SaaSCo hiring Operations Manager", company_name: "SaaSCo", website: "https://saasco.io", company_domain: "saasco.io",
    industries: ["B2B SaaS"], job_title: "Operations Manager", source_url: "https://linkedin.com/jobs/view/saasco", job_description: "ops",
  }), brain);
  assertEquals(r.buyer_relevance_score, 0);
  assert(!r.matched_buyer_personas.some((b) => /revops|revenue operations/i.test(b)));
});

Deno.test("6. hospital/university/government/local services rejected when disqualified", () => {
  for (const bad of ["hospital", "university", "government", "logistics", "local services"]) {
    const r = scoreAgainstCompanyBrain(base({ title: `X hiring role`, company_name: "X", company_description: `a ${bad} organization`, job_title: "Manager", source_url: "https://x.test/j" }), brain);
    assertEquals(r.verification_status, "rejected", bad);
  }
});

Deno.test("7. funding without source URL rejected", () => {
  const r = scoreAgainstCompanyBrain(base({ signal_type: "funding", title: "SomeCo raises seed", company_name: "SomeCo" }), brain);
  assertEquals(r.verification_status, "rejected");
});

Deno.test("8. LinkedIn post without URL rejected", () => {
  const r = scoreAgainstCompanyBrain(base({ signal_type: "linkedin_post", title: "founder rant", post_text: "hiring SDRs too early is a mistake" }), brain);
  assertEquals(r.verification_status, "rejected");
});

Deno.test("9. comment without parent post URL rejected", () => {
  const r = scoreAgainstCompanyBrain(base({ signal_type: "linkedin_comment", title: "great point", comment_text: "agreed" }), brain);
  assertEquals(r.verification_status, "rejected");
});

Deno.test("10. no proof → max score 30", () => {
  const r = scoreAgainstCompanyBrain(base({ title: "Acme hiring RevOps", company_name: "Acme", company_domain: "acme.io", job_title: "RevOps" }), brain);
  assert(r.signal_score <= 30, `score ${r.signal_score}`);
  assert(r.verification_status !== "verified");
});

Deno.test("11. no domain/website/LinkedIn → max score 45", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "Acme hiring Founding Account Executive", company_name: "Acme", industries: ["B2B SaaS"], employee_count: 40,
    job_title: "Founding Account Executive", job_url: "https://linkedin.com/jobs/view/acme", source_url: "https://linkedin.com/jobs/view/acme",
    job_description: "sell", source_published_at: recent,
  }), brain);
  assert(r.signal_score <= 45, `score ${r.signal_score}`);
});

Deno.test("12. unknown industry + unknown size + unknown buyer → max score 45", () => {
  const r = scoreAgainstCompanyBrain(base({
    signal_type: "workflow_trend", title: "some market trend", company_name: "Unknown", website: "https://unknown.io",
    source_url: "https://blog.test/trend", evidence_text: "a general market article", source_published_at: recent,
  }), brain);
  assert(r.signal_score <= 45, `score ${r.signal_score}`);
});

Deno.test("13. empty Brain → conservative, not fake confidence", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "SaaSCo hiring AE", company_name: "SaaSCo", website: "https://saasco.io", company_domain: "saasco.io",
    job_title: "Account Executive", job_url: "https://linkedin.com/jobs/view/x", source_url: "https://linkedin.com/jobs/view/x", job_description: "sell", source_published_at: recent,
  }), emptyBrain);
  assert(r.confidence !== "high");
  assert(r.verification_status !== "verified");
});

Deno.test("14. strong content topic but weak proof → content idea, not verified Top-10", () => {
  const r = scoreAgainstCompanyBrain(base({
    signal_type: "workflow_trend", title: "founders hiring SDRs too early", website: "https://blog.test",
    source_url: "https://blog.test/sdr", evidence_text: "hiring SDRs too early", source_published_at: recent,
  }), brain);
  assert(r.content_potential_score > 0);
  assert(r.verification_status !== "verified");
  assert(["save_idea", "turn_into_post", "needs_manual_review"].includes(r.recommended_action));
});

// ---- Fix 2: ICP-fit + software-ICP-reject enforcement ----

Deno.test("15. Pace Analytical Services (analytical services / lab) rejected for a B2B SaaS ICP", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "Pace Analytical Services hiring Director of Commercial Analytics", company_name: "Pace Analytical Services",
    website: "https://pacelabs.com", company_domain: "pacelabs.com",
    company_description: "environmental analytical services and lab testing", industries: ["analytical services"],
    job_title: "Director of Commercial Analytics", job_url: "https://linkedin.com/jobs/view/pace", source_url: "https://linkedin.com/jobs/view/pace",
    job_description: "lead analytics", source_published_at: recent,
  }), brain);
  assertEquals(r.verification_status, "rejected");
  assert(r.disqualifiers_hit.some((d) => /analytical services|lab testing/.test(d.toLowerCase())));
});

Deno.test("16. each software-ICP-disqualified industry rejected", () => {
  for (const bad of ["lab testing", "analytical services", "pharma", "chemicals", "packaging", "staffing"]) {
    const r = scoreAgainstCompanyBrain(base({
      title: `X hiring RevOps`, company_name: "X", website: "https://x.io", company_domain: "x.io",
      company_description: `a ${bad} company`, job_title: "RevOps", source_url: "https://x.io/j", job_description: "ops",
    }), brain);
    assertEquals(r.verification_status, "rejected", bad);
  }
});

Deno.test("17. buyer/title match ALONE (no ICP industry or size fit) cannot verify", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "NeutralCo hiring RevOps", company_name: "NeutralCo", website: "https://neutralco.io", company_domain: "neutralco.io",
    industries: ["consumer goods"], job_title: "RevOps", job_url: "https://linkedin.com/jobs/view/n", source_url: "https://linkedin.com/jobs/view/n",
    job_description: "own revenue operations", source_published_at: recent,
  }), brain);
  assert(r.matched_buyer_personas.length > 0, "buyer title matched");
  assert(r.matched_icp.length === 0, "no ICP industry match");
  assertEquals(r.verification_status !== "verified", true);
  assert(r.risk_flags.some((f) => /buyer\/title match only/i.test(f)));
});

Deno.test("18. B2B SaaS hiring SDR accepted (verified, real ICP fit)", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "Beta hiring SDR", company_name: "Beta", website: "https://beta.io", company_domain: "beta.io",
    industries: ["B2B SaaS"], employee_count: 40, job_title: "SDR", job_url: "https://linkedin.com/jobs/view/beta",
    source_url: "https://linkedin.com/jobs/view/beta", job_description: "outbound SDR at a B2B SaaS", source_published_at: recent,
  }), brain);
  assertEquals(r.verification_status, "verified");
});

Deno.test("19. software startup hiring RevOps accepted (verified)", () => {
  const r = scoreAgainstCompanyBrain(base({
    title: "Gamma hiring Revenue Operations", company_name: "Gamma", website: "https://gamma.io", company_domain: "gamma.io",
    company_description: "an AI SaaS startup", industries: ["AI SaaS"], employee_count: 55, job_title: "Revenue Operations",
    job_url: "https://linkedin.com/jobs/view/gamma", source_url: "https://linkedin.com/jobs/view/gamma", job_description: "own RevOps", source_published_at: recent,
  }), brain);
  assertEquals(r.verification_status, "verified");
});

Deno.test("20. setup_required Brain never produces a verified Top Signal, even with full ICP-fit proof", () => {
  // industries + size present, but NO buyer roles and no must-have → setup_required.
  const setupBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { category: "B2B SaaS" }, icp: { industries: ["B2B SaaS"], company_size: "10-150" } } });
  assertEquals(setupBrain.meta.setup_required, true);
  const r = scoreAgainstCompanyBrain(base({
    title: "Delta hiring Account Executive", company_name: "Delta", website: "https://delta.io", company_domain: "delta.io",
    industries: ["B2B SaaS"], employee_count: 40, job_title: "Account Executive", job_url: "https://linkedin.com/jobs/view/d",
    source_url: "https://linkedin.com/jobs/view/d", job_description: "sell", source_published_at: recent,
  }), setupBrain);
  assert(r.verification_status !== "verified");
  assert(r.risk_flags.some((f) => /company brain incomplete/i.test(f)));
});
