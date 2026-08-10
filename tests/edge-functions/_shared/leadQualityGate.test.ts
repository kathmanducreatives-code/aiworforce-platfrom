import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyLeadQualityGate, toNormalizedCandidate,
  type NormalizedCompanyCandidate, type WorkflowIntent,
} from "../../../supabase/functions/_shared/leadQualityGate.ts";

function cand(p: Partial<NormalizedCompanyCandidate>): NormalizedCompanyCandidate {
  return {
    companyName: "Co", website: null, domain: null, linkedinUrl: null,
    sourceType: "hiring", sourceProof: [], sourceQuality: "incomplete",
    signalType: "hiring", signalSummary: "", exactHiringSignal: null,
    jobTitle: null, jobUrl: null, jobDescription: null, companyDescription: null,
    industryEvidence: [], employeeCount: null, employeeRange: null,
    location: null, hq: null, raw: {}, ...p,
  };
}
const hiring: WorkflowIntent = { isHiring: true };

// Test 1 — no proof.
Deno.test("Test 1: no proof → needs_verification/reject, maxOverallFit ≤ 30, not high confidence", () => {
  const g = applyLeadQualityGate(cand({ companyName: "Unknown Co" }), hiring);
  assert(g.decision === "needs_verification" || g.decision === "reject");
  assert((g.scoreCaps.maxOverallFit ?? 100) <= 30);
  assertEquals(g.scoreCaps.maxConfidence, "medium");
  assert(g.reasons.some((r) => /no verifiable source proof/i.test(r)));
});

// Test 2 — has job URL + website + proof → passes, no cap.
Deno.test("Test 2: job URL + website + proof → accept, no proof cap, no reject", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Good SaaS Co", website: "https://goodsaas.com", domain: "goodsaas.com",
    linkedinUrl: "https://linkedin.com/company/goodsaas", jobUrl: "https://linkedin.com/jobs/view/123",
    jobTitle: "Revenue Operations Manager", exactHiringSignal: "Revenue Operations Manager @ Good SaaS Co",
    sourceProof: [{ url: "https://linkedin.com/jobs/view/123", type: "job_posting", confidence: 90 }],
    industryEvidence: ["Software Development"], companyDescription: "B2B SaaS platform for revenue teams", employeeCount: 75,
  }), { isHiring: true, roleQuery: "RevOps" });
  assertEquals(g.decision, "accept");
  assertEquals(g.scoreCaps.maxOverallFit, undefined);
  assertEquals(g.disqualifiersHit.length, 0);
});

// Test 3 — hiring query without hiring signal.
Deno.test("Test 3: hiring intent + website but no jobTitle/signal/url → needs_verification, fit ≤ 40", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Site Only Co", website: "https://x.com", domain: "x.com",
    sourceProof: [{ url: "https://x.com", type: "company_website", confidence: 80 }],
  }), hiring);
  assert(g.decision === "needs_verification" || g.decision === "reject");
  assert((g.scoreCaps.maxOverallFit ?? 100) <= 40);
  assert(g.reasons.some((r) => /no verified hiring signal/i.test(r)));
});

// Test 4 — manufacturing disqualifier.
Deno.test("Test 4: manufacturing disqualifier → reject, disqualifiersHit includes manufacturing", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Factory Ops Co", companyDescription: "Industrial manufacturing and plant operations company",
    industryEvidence: ["Manufacturing"], jobTitle: "Operations Manager",
    jobUrl: "https://li/jobs/9", sourceProof: [{ url: "https://li/jobs/9", type: "job_posting", confidence: 90 }],
  }), { isHiring: true, disqualifiers: ["manufacturing", "bank"] });
  assertEquals(g.decision, "reject");
  assert(g.disqualifiersHit.includes("manufacturing"));
  assertEquals(g.scoreCaps.maxOverallFit, 0);
});

// Phase 1B merge parity — leadQualityGate's own DEFAULT_DISQUALIFIERS was
// deleted; the default fallback (no explicit workflowIntent.disqualifiers) now
// sources companyIcpFilter.ts's merged DEFAULT_EXCLUDED_INDUSTRIES instead.
Deno.test("merge parity: default fallback (no explicit disqualifiers) still rejects leadQualityGate's original terms", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Riverside Manufacturing Co", companyDescription: "Consumer goods manufacturing",
    industryEvidence: ["Manufacturing"], jobUrl: "https://li/jobs/1",
    sourceProof: [{ url: "https://li/jobs/1", type: "job_posting", confidence: 90 }],
  }));
  assertEquals(g.decision, "reject");
  assert(g.disqualifiersHit.includes("manufacturing"));
});

Deno.test("merge parity: default fallback now ALSO rejects companyIcpFilter-only terms leadQualityGate's old list lacked", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Downtown Law Firm", companyDescription: "Legal services for growing companies",
    industryEvidence: ["Legal Services"], jobUrl: "https://li/jobs/2",
    sourceProof: [{ url: "https://li/jobs/2", type: "job_posting", confidence: 90 }],
  }));
  assertEquals(g.decision, "reject");
  assert(g.disqualifiersHit.includes("law firm"));
});

// Test 5 — generic Operations Manager is not RevOps.
Deno.test("Test 5: generic Operations Manager for RevOps intent + non-SaaS company → capped/rejected", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Regional Services", jobTitle: "Operations Manager",
    companyDescription: "Regional service business", industryEvidence: ["Facilities Services"],
    jobUrl: "https://li/jobs/5", sourceProof: [{ url: "https://li/jobs/5", type: "job_posting", confidence: 90 }],
  }), { isHiring: true, roleQuery: "RevOps / GTM Operations" });
  assert(g.decision !== "accept");
  assert((g.scoreCaps.maxOverallFit ?? 100) <= 35);
  assert(g.reasons.some((r) => /generic operations role/i.test(r)));
});

// Test 5b — same generic title but real SaaS company → NOT penalized by Rule 6.
Deno.test("Test 5b: generic ops title at a real B2B SaaS company → Rule 6 does not fire", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "CloudPlatform", jobTitle: "Operations Manager",
    companyDescription: "B2B SaaS platform for sales teams", industryEvidence: ["Software"],
    website: "https://cloudplatform.com", domain: "cloudplatform.com",
    jobUrl: "https://li/jobs/7", sourceProof: [{ url: "https://li/jobs/7", type: "job_posting", confidence: 90 }],
    employeeCount: 60,
  }), { isHiring: true, roleQuery: "RevOps" });
  assertEquals(g.decision, "accept");
  assert(!g.missingEvidence.includes("gtm_role_context"));
});

// Test 6 — missing ICP evidence but has proof.
Deno.test("Test 6: proof present but no ICP evidence → no hard reject, fit ≤ 45, confidence reduced", () => {
  const g = applyLeadQualityGate(cand({
    companyName: "Proof Only Co", jobUrl: "https://li/jobs/6", jobTitle: "Head of Growth",
    sourceProof: [{ url: "https://li/jobs/6", type: "job_posting", confidence: 90 }],
  }), { isHiring: true });
  assertEquals(g.decision, "accept");
  assert((g.scoreCaps.maxOverallFit ?? 100) <= 45);
  assertEquals(g.scoreCaps.maxConfidence, "medium");
  assert(g.missingEvidence.includes("icp_evidence"));
});

// contract adapter
Deno.test("toNormalizedCandidate: maps Phase-1 raw fields into the contract; no invention", () => {
  const c = toNormalizedCandidate({
    company: "Acme", title: "RevOps Manager", source_url: "https://li/jobs/1",
    raw: {
      company_website: "https://acme.com", domain: "acme.com", company_linkedin_url: "https://li/company/acme",
      job_url: "https://li/jobs/1", job_title: "RevOps Manager", exact_hiring_signal: "RevOps Manager @ Acme",
      industries: ["SaaS"], employee_count: 50, source_quality: "verified",
      source_proof: [{ url: "https://li/jobs/1", type: "job_posting", confidence: 90 }],
    },
  });
  assertEquals(c.website, "https://acme.com");
  assertEquals(c.domain, "acme.com");
  assertEquals(c.linkedinUrl, "https://li/company/acme");
  assertEquals(c.sourceProof.length, 1);
  assertEquals(c.sourceQuality, "verified");
  // missing → null/empty, never invented
  const empty = toNormalizedCandidate({ company: "X", raw: {} });
  assertEquals(empty.website, null);
  assertEquals(empty.sourceProof.length, 0);
  assertEquals(empty.sourceQuality, "incomplete");
});
