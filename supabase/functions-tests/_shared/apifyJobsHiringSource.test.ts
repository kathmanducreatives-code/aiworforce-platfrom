import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../functions/companyBrainCompiler.ts";
import { scoreAgainstCompanyBrain } from "../../functions/icpSignalScorer.ts";
import { scoreCandidates } from "../../functions/radarCandidatePipeline.ts";
import {
  normalizeApifyJobToCandidate,
  apifyRowsToScoredItems,
  apifyJobsSourceStatus,
  buildApifyJobsInput,
  describeApifyJobsQueries,
  isShortenerDomain,
  isRecruiterProxy,
} from "../../functions/_shared/apifyJobsHiringSource.ts";

const NOW = Date.parse("2026-07-06T00:00:00Z");
const recent = "2026-07-04T00:00:00Z";

const brain = compileCompanyBrainContext({
  workspace_id: "ws",
  profile: {
    company: { category: "AI SaaS", description: "AI workforce OS for founders building B2B pipeline" },
    icp: {
      buyer_roles: ["Founder", "RevOps", "Founding Account Executive"],
      company_size: "10-150 employees",
      industries: ["B2B SaaS", "AI SaaS"],
      disqualifiers: ["manufacturing", "pharma", "pharmaceutical", "chemical", "packaging", "hospital"],
    },
    gtm: { motion: "founder-led sales" },
    competitors: { known: ["Clay", "Apollo"] },
  },
  signal_preferences: { hiring_roles: ["Founding Account Executive", "SDR", "RevOps"] },
});

// An Apify LinkedIn Jobs row (actor field names).
const job = (o: Record<string, unknown> = {}) => ({
  companyName: "Cekura", title: "Founding Account Executive",
  companyWebsite: "https://cekura.ai", companyLinkedinUrl: "https://linkedin.com/company/cekura",
  companyDescription: "B2B SaaS AI company building GTM", industries: ["Software"], companyEmployeesCount: 40,
  link: "https://www.linkedin.com/jobs/view/1", descriptionText: "Building GTM at our B2B SaaS AI company",
  location: "US", postedAt: recent, seniorityLevel: "Entry", employmentType: "Full-time", jobFunction: "Sales", applicantsCount: 12,
  ...o,
});

function scoreRows(rows: unknown[], cap = 10) {
  const { items } = apifyRowsToScoredItems(rows, { cap, scanPlanReason: "hiring plan", now: NOW });
  return scoreCandidates({ items, brain, workspace_id: "ws", userId: "u", cap, now: NOW });
}

Deno.test("1. B2B SaaS + Founding AE + job URL → accepted & verified", () => {
  const res = scoreRows([job()]);
  assertEquals(res.accepted, 1);
  assertEquals(res.rows[0].raw.verification_status, "verified");
});

Deno.test("2. AI SaaS + SDR job → accepted & scored", () => {
  const res = scoreRows([job({ companyName: "Simple AI", title: "Sales Development Representative", companyWebsite: "https://simple.ai", companyLinkedinUrl: "https://linkedin.com/company/simpleai", companyEmployeesCount: 25, descriptionText: "AI SaaS startup hiring an SDR" })]);
  assertEquals(res.accepted, 1);
  assert(["verified", "needs_verification"].includes(res.rows[0].raw.verification_status as string));
});

Deno.test("3. manufacturing/pharma/chemical/packaging jobs are rejected", () => {
  for (const bad of ["manufacturing", "pharmaceutical", "chemical", "packaging"]) {
    const res = scoreRows([job({ companyName: "BadCo", companyDescription: `a ${bad} company`, industries: [bad], companyWebsite: "https://badco.com" })]);
    assertEquals(res.accepted, 0, bad);
  }
});

Deno.test("4. generic Operations Manager is not treated as RevOps", () => {
  const { candidate } = normalizeApifyJobToCandidate(job({ title: "Operations Manager", descriptionText: "general operations", companyWebsite: "https://saasco.io", companyName: "SaaSCo" }), NOW);
  const s = scoreAgainstCompanyBrain(candidate, brain);
  assertEquals(s.buyer_relevance_score, 0);
  assert(!s.matched_buyer_personas.some((b) => /revops|revenue operations/i.test(b)));
});

Deno.test("5. URL-shortener website/domain is rejected", () => {
  const r = normalizeApifyJobToCandidate(job({ companyWebsite: "https://bit.ly/xyz" }), NOW);
  assertEquals(r.candidate.website, undefined);
  assertEquals(r.candidate.company_domain, undefined);
  assert(r.extraMissingEvidence.includes("verified company website"));
  assert(isShortenerDomain("https://lnkd.in/abc"));
  assert(!isShortenerDomain("https://cekura.ai"));
});

Deno.test("6. recruiter/staffing proxy is dropped (not treated as the account)", () => {
  assert(isRecruiterProxy("Acme Staffing", null));
  assert(isRecruiterProxy(null, "We're partnering with an innovative company to hire an AE"));
  const r = normalizeApifyJobToCandidate(job({ companyName: "Talent Partners", descriptionText: "on behalf of our client, hiring an AE" }), NOW);
  assertEquals(r.drop, true);
  const { items, dropped } = apifyRowsToScoredItems([job({ companyName: "Global Recruiting", descriptionText: "our client is scaling" })], { cap: 10, scanPlanReason: "r", now: NOW });
  assertEquals(items.length, 0);
  assertEquals(dropped, 1);
});

Deno.test("7. missing funding proof → no 'recently funded' language", () => {
  const res = scoreRows([job()]);
  const raw = res.rows[0].raw as any;
  const text = JSON.stringify([raw.why_now, raw.why_it_matters, raw.company_brain_relevance]).toLowerCase();
  assert(!/recently funded|funding momentum|\braised\b/.test(text), text);
});

Deno.test("8. adapter respects the cap", () => {
  const rows = Array.from({ length: 15 }, (_, i) => job({ companyName: `Co${i}`, link: `https://www.linkedin.com/jobs/view/${i}` }));
  const { items } = apifyRowsToScoredItems(rows, { cap: 10, scanPlanReason: "r", now: NOW });
  assertEquals(items.length, 10);
});

Deno.test("9. feature flag off → Apify not enabled (Firecrawl fallback)", () => {
  const st = apifyJobsSourceStatus({ flagEnabled: false, apifyReady: true });
  assertEquals(st.enabled, false);
  assertEquals(st.provider, "firecrawl");
});

Deno.test("10. provider not configured → no crash, honest status", () => {
  const st = apifyJobsSourceStatus({ flagEnabled: true, apifyReady: false });
  assertEquals(st.enabled, false);
  assertEquals(st.provider, "firecrawl");
  assert(st.reason.length > 0);
});

Deno.test("11. candidate carries website/LinkedIn/job URL/employee count when present", () => {
  const { candidate } = normalizeApifyJobToCandidate(job(), NOW);
  assertEquals(candidate.website, "https://cekura.ai");
  assertEquals(candidate.company_linkedin_url, "https://linkedin.com/company/cekura");
  assertEquals(candidate.job_url, "https://www.linkedin.com/jobs/view/1");
  assertEquals(candidate.employee_count, 40);
  assertEquals((candidate.extracted_facts as any).seniority_level, "Entry");
});

Deno.test("12. persisted raw includes signal_score / verification_status / why_now / scan_plan_reason", () => {
  const res = scoreRows([job()]);
  const raw = res.rows[0].raw as any;
  for (const f of ["signal_score", "verification_status", "why_now", "scan_plan_reason"]) assert(f in raw, `missing raw.${f}`);
  assertEquals(raw.scan_plan_reason, "hiring plan");
});

Deno.test("bonus: Apify input is Company-Brain-driven and capped", () => {
  const input = buildApifyJobsInput(brain, 10);
  assert(input.keywords.some((k) => /Founding Account Executive|SDR|RevOps/i.test(k)));
  assert(input.urls.every((u) => u.includes("linkedin.com/jobs/search")));
  assertEquals(input.count, 10);
  assert(describeApifyJobsQueries(brain).some((q) => /saas/i.test(q)));
});

Deno.test("Fix 2: every keyword carries SaaS/software context — no broad standalone role", () => {
  const input = buildApifyJobsInput(brain, 10);
  assertEquals(input.setup_required, false);
  // Each keyword is category-prefixed ("AI SaaS SDR"), never a bare role.
  assert(input.keywords.every((k) => /\b(saas|software|b2b|ai)\b/i.test(k)), JSON.stringify(input.keywords));
  assert(!input.keywords.some((k) => /^(sdr|revops|sales operations|commercial analytics)$/i.test(k.trim())), "no bare role query");
});

Deno.test("Fix 2: incomplete Brain → no broad provider queries (setup_required)", () => {
  const setupBrain = compileCompanyBrainContext({ workspace_id: "ws", profile: { company: { category: "B2B SaaS" }, icp: { industries: ["B2B SaaS"], company_size: "10-150" } } });
  assertEquals(setupBrain.meta.setup_required, true);
  const input = buildApifyJobsInput(setupBrain, 10);
  assertEquals(input.setup_required, true);
  assertEquals(input.urls.length, 0);
  assertEquals(input.keywords.length, 0);
  assertEquals(describeApifyJobsQueries(setupBrain).length, 0);
});
