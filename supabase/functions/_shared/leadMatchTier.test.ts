import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLeadTier, fillFromRawResults, type CandidateForTier } from "./leadMatchTier.ts";
import { extractLeadSearchIntent } from "./leadSearchIntent.ts";

const intent = extractLeadSearchIntent({ message: "Find 5 AI SaaS companies recently funded hiring SDRs or GTM roles for outbound" });

// Part 6 — the exact bad 8-row Apify fixture (representative industries/desc).
const fixture: CandidateForTier[] = [
  { company: "WuXi AppTec", industries: ["Pharmaceutical Manufacturing", "Contract Research"], company_description: "Global pharma CRO providing R&D services.", job_title: "Business Development Manager", source_url: "https://linkedin.com/jobs/view/1" },
  { company: "SGS", industries: ["Testing, Inspection and Certification"], company_description: "Inspection, verification, testing and certification company.", job_title: "Sales Manager", source_url: "https://linkedin.com/jobs/view/2" },
  { company: "Amcor", industries: ["Packaging and Containers Manufacturing"], company_description: "Global packaging manufacturer.", job_title: "Account Executive", source_url: "https://linkedin.com/jobs/view/3" },
  { company: "HAFA", industries: ["Wholesale Building Materials"], company_description: "Sanitary and bathroom hardware supplier.", job_title: "Sales Representative", source_url: "https://linkedin.com/jobs/view/4" },
  { company: "KFE Holding", industries: ["Holding Companies"], company_description: "Industrial holding company.", job_title: "Business Developer", source_url: "https://linkedin.com/jobs/view/5" },
  { company: "MEDIAPOST", industries: ["Advertising Services", "Direct Mail"], company_description: "Direct mail and marketing services.", job_title: "Sales Manager", source_url: "https://linkedin.com/jobs/view/6" },
  { company: "Flatpay", industries: ["Financial Services", "Software Development"], company_description: "Payments SaaS platform for SMBs; outbound sales team.", job_title: "SDR", job_description: "Outbound pipeline generation for our payments platform.", source_url: "https://linkedin.com/jobs/view/7" },
  { company: "LOX Solutions", industries: ["Software Development"], company_description: "B2B SaaS analytics platform.", job_title: "Growth Lead", job_description: "Own GTM and outbound revenue.", source_url: "https://linkedin.com/jobs/view/8" },
];

Deno.test("Part6 #2/#3: WuXi/SGS/Amcor/HAFA/KFE/MEDIAPOST rejected (off-ICP / not SaaS)", () => {
  for (const name of ["WuXi AppTec", "SGS", "Amcor", "HAFA", "KFE Holding", "MEDIAPOST"]) {
    const c = fixture.find((x) => x.company === name)!;
    const t = classifyLeadTier(c, intent);
    assertEquals(t.match_tier, "reject", `${name} must be rejected`);
  }
});

Deno.test("Part6: Flatpay/LOX are at most SECONDARY (SaaS but missing funding proof)", () => {
  const flat = classifyLeadTier(fixture.find((x) => x.company === "Flatpay")!, intent);
  assertEquals(flat.match_tier, "secondary");
  assert(flat.missing_evidence.includes("recent funding proof"));
  assertEquals(flat.funding_proof_found, false);
  const lox = classifyLeadTier(fixture.find((x) => x.company === "LOX Solutions")!, intent);
  assertEquals(lox.match_tier, "secondary");
});

Deno.test("Part6 #1/#4: 8-row fixture does NOT yield 5 qualified; honest shortage", () => {
  const r = fillFromRawResults(fixture, intent);
  assertEquals(r.requested_count, 5);
  assertEquals(r.raw_results_reviewed, 8);
  assert(r.accepted_count <= 2, "at most Flatpay + LOX");
  assertEquals(r.strict_matches, 0);          // none have funding proof → none strict
  assert(r.rejected_count >= 6);
  assert(r.reason_not_filled && /did not fill/i.test(r.reason_not_filled));
  assert(r.relaxation_steps_used.includes("funding_relaxed"));
});

// Part 4 — funding contract.
Deno.test("Part4 #1/#2: no funding source → not verifiable as recently funded (secondary + missing)", () => {
  const c: CandidateForTier = { company: "Nimbus AI", industries: ["Software Development"], company_description: "AI SaaS platform", job_title: "Sales Development Representative", job_description: "outbound", source_url: "https://x/1" };
  const t = classifyLeadTier(c, intent);
  assertEquals(t.match_tier, "secondary");
  assertEquals(t.funding_proof_found, false);
  assert(t.missing_evidence.includes("recent funding proof"));
  assert(!t.reasons.some((r) => /recently funded/i.test(r) && !/cannot be called/i.test(r)));
});

Deno.test("Part4 #3: funding proof URL → strict eligible (stronger)", () => {
  const c: CandidateForTier = { company: "Nimbus AI", industries: ["Software Development"], company_description: "AI SaaS platform", job_title: "SDR", job_description: "outbound", source_url: "https://x/1", funding_proof_url: "https://techcrunch.com/nimbus-series-a" };
  const t = classifyLeadTier(c, intent);
  assertEquals(t.match_tier, "strict");
  assertEquals(t.funding_proof_found, true);
  assertEquals(t.funding_source_url, "https://techcrunch.com/nimbus-series-a");
});

Deno.test("Part3-logic #1: requested 5, 2 strict + 3 secondary → returns 5 with tiers", () => {
  const strong: CandidateForTier[] = [
    { company: "A", industries: ["Software"], company_description: "AI SaaS", job_title: "SDR", job_description: "outbound", source_url: "https://x/a", funding_proof_url: "https://tc/a" },
    { company: "B", industries: ["Software"], company_description: "AI SaaS", job_title: "SDR", job_description: "outbound", source_url: "https://x/b", funding_proof_url: "https://tc/b" },
    { company: "C", industries: ["Software"], company_description: "B2B SaaS", job_title: "Account Executive", job_description: "outbound", source_url: "https://x/c" },
    { company: "D", industries: ["Software"], company_description: "B2B SaaS", job_title: "Revenue Operations", source_url: "https://x/d" },
    { company: "E", industries: ["Software"], company_description: "AI SaaS", job_title: "GTM Lead", job_description: "outbound", source_url: "https://x/e" },
  ];
  const r = fillFromRawResults(strong, intent);
  assertEquals(r.accepted_count, 5);
  assertEquals(r.strict_matches, 2);
  assertEquals(r.secondary_matches, 3);
  assertEquals(r.reason_not_filled, undefined);
});

Deno.test("Part3-logic #6: huge manufacturing company never fills shortage", () => {
  const mfg: CandidateForTier = { company: "MegaManu", industries: ["Manufacturing"], company_description: "Industrial manufacturing conglomerate", job_title: "SDR", source_url: "https://x/m", employee_count: 50000 };
  assertEquals(classifyLeadTier(mfg, intent).match_tier, "reject");
});
