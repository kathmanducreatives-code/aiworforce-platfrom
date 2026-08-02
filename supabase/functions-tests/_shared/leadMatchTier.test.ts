import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyLeadTier, detectRecruiterProxy, fillFromRawResults, unionMissingEvidence, type CandidateForTier } from "../../functions/_shared/leadMatchTier.ts";
import { extractLeadSearchIntent } from "../../functions/_shared/leadSearchIntent.ts";

// Follow-up: analyst update must UNION missing-evidence, not clobber it.
Deno.test("union: funding missing-evidence survives + is unioned with analyst", () => {
  assertEquals(
    unionMissingEvidence(["recent funding proof"], ["company size unclear", "founder-led sales unconfirmed"]),
    ["recent funding proof", "company size unclear", "founder-led sales unconfirmed"],
  );
});
Deno.test("union: dedupes overlapping entries; ignores non-strings/empties/null lists", () => {
  assertEquals(unionMissingEvidence(["recent funding proof"], ["recent funding proof", "size"]), ["recent funding proof", "size"]);
  assertEquals(unionMissingEvidence(null, undefined, ["", "  ", "x", 5 as unknown]), ["x"]);
});
Deno.test("union: funding gap alone survives an empty analyst list", () => {
  assertEquals(unionMissingEvidence(["recent funding proof"], []), ["recent funding proof"]);
  assertEquals(unionMissingEvidence([], []), []);
});
Deno.test("funding proof found → 'recent funding proof' is NOT in missing_evidence", () => {
  const fi = extractLeadSearchIntent({ message: "Find 3 AI SaaS companies recently funded hiring SDRs for outbound" });
  const c: CandidateForTier = { company: "X", industries: ["Software Development"], company_description: "AI SaaS", job_title: "SDR", job_description: "outbound", source_url: "https://x/1", funding_proof_url: "https://tc/x" };
  const t = classifyLeadTier(c, fi);
  assert(!unionMissingEvidence(t.missing_evidence, []).includes("recent funding proof"));
});

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

// Part 6 — recruiter/staffing proxy detection (never a target account).
Deno.test("Part6: detectRecruiterProxy flags 'our client' / 'on behalf of' / staffing industry", () => {
  assert(detectRecruiterProxy({ company_description: "We're partnering with a leading company to hire on behalf of our client." }).isProxy);
  assert(detectRecruiterProxy({ job_description: "Our client, a fast-growing SaaS, is hiring an SDR." }).isProxy);
  assert(detectRecruiterProxy({ industries: ["Staffing and Recruiting"] }).isProxy);
  assert(!detectRecruiterProxy({ company_description: "AI SaaS platform hiring an SDR for outbound." }).isProxy);
});

// Part 8 — the latest 5-row fixture end-to-end at the tier level.
// (Shortener website drop is exercised at the normalizer layer; see
//  apifyJobsNormalizer.test.ts. CandidateForTier has no website field.)
Deno.test("Part8 5-row: JustAI accepted(strict), Edra accepted(funding proof), Ajax/Pilot secondary, Stelvio rejected(recruiter proxy)", () => {
  const justAI: CandidateForTier = { company: "JustAI", industries: ["Software Development"], company_description: "AI SaaS support-automation platform", job_title: "SDR", job_description: "outbound pipeline generation", source_url: "https://linkedin.com/jobs/view/justai", funding_proof_url: "https://techcrunch.com/justai-series-a" };
  const edra: CandidateForTier = { company: "Edra", industries: ["Software Development"], company_description: "AI SaaS design platform", job_title: "GTM Lead", job_description: "own outbound go-to-market", source_url: "https://linkedin.com/jobs/view/edra", funding_proof_url: "https://techcrunch.com/edra-seed" };
  const ajax: CandidateForTier = { company: "Ajax", industries: ["Software Development"], company_description: "B2B SaaS security platform", job_title: "SDR", job_description: "outbound pipeline", source_url: "https://linkedin.com/jobs/view/ajax" };
  const pilot: CandidateForTier = { company: "Pilot.com", industries: ["Software Development", "Financial Services"], company_description: "SaaS accounting platform; outbound revenue team", job_title: "Business Developer", job_description: "outbound revenue", source_url: "https://linkedin.com/jobs/view/pilot" };
  const stelvio: CandidateForTier = { company: "Stelvio", industries: ["Staffing and Recruiting"], company_description: "We're partnering with a leading AI SaaS company to hire an SDR on behalf of our client", job_title: "SDR", source_url: "https://linkedin.com/jobs/view/stelvio" };

  const tJust = classifyLeadTier(justAI, intent);
  assertEquals(tJust.match_tier, "strict");
  assertEquals(tJust.funding_proof_found, true);
  assertEquals(tJust.recruiter_proxy, false);

  const tEdra = classifyLeadTier(edra, intent);
  assert(tEdra.match_tier !== "reject");          // accepted
  assertEquals(tEdra.funding_proof_found, true);  // carried by verified funding proof
  assert(!tEdra.missing_evidence.includes("recent funding proof"));

  const tAjax = classifyLeadTier(ajax, intent);
  assertEquals(tAjax.match_tier, "secondary");
  assert(tAjax.missing_evidence.includes("recent funding proof"));

  const tPilot = classifyLeadTier(pilot, intent);
  assertEquals(tPilot.match_tier, "secondary");

  const tStelvio = classifyLeadTier(stelvio, intent);
  assertEquals(tStelvio.match_tier, "reject");
  assertEquals(tStelvio.recruiter_proxy, true);
  assert(/recruiter proxy|actual hiring company hidden|staffing/i.test(tStelvio.reasons.join(" ")));

  // Fill: 4 real candidates + 1 recruiter proxy → proxy never fills the count.
  const r = fillFromRawResults([justAI, edra, ajax, pilot, stelvio], intent);
  assertEquals(r.raw_results_reviewed, 5);
  assertEquals(r.rejected_count, 1);            // only Stelvio rejected
  assertEquals(r.strict_matches, 2);            // JustAI + Edra (exact role + funding proof)
  assertEquals(r.secondary_matches, 2);         // Ajax + Pilot (no funding proof)
  assert(r.accepted_count === 4);
});
