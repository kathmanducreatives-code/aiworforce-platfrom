import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveCompanyIcp, DEFAULT_DISQUALIFIERS } from "./companyBrainIcp.ts";
import { preRankCandidates, scoreCandidate } from "./leadPreRank.ts";
import { buildLeadAnalystSummary } from "./leadAnalyst.ts";

// ---------- Part B: Company Brain → ICP ----------
Deno.test("1: structured ICP is used directly", () => {
  const icp = deriveCompanyIcp({ icp: { industries: ["B2B SaaS"], company_size: "10-150 employees", buyer_roles: ["Founder"], disqualifiers: ["bank"] } });
  assertEquals(icp.targetIndustries, ["B2B SaaS"]);
  assertEquals(icp.targetCompanySize.max, 150);
  assert(!icp.weakIcpContext, "structured ICP → not weak");
  assert(icp.derivationSources.includes("structured_icp"));
  assertEquals(icp.disqualifiers, ["bank"]);
});
Deno.test("2: empty ICP + free text 'Founders and small B2B SaaS teams' → useful hints, weak flag", () => {
  const icp = deriveCompanyIcp({ icp: {}, what_we_do: "AI workforce OS for founders", who_we_sell_to: "Founders and small B2B SaaS teams" });
  assert(icp.weakIcpContext, "inferred ICP → weak");
  assert(icp.derivationSources.includes("free_text"));
  assert(icp.targetIndustries.some((i) => /saas|software|b2b/i.test(i)));
  assert(icp.targetBuyers.some((b) => /founder/i.test(b)));
  assertEquals(icp.targetCompanySize.max, 150, "safe small-team default");
  assert(icp.disqualifiers.length >= DEFAULT_DISQUALIFIERS.length, "default disqualifiers applied");
  assert(icp.missingIcpFields.includes("target_signals"));
});

const saasIcp = deriveCompanyIcp({ icp: { industries: ["B2B SaaS", "software"], company_size: "10-150 employees", buyer_roles: ["Founder"], target_signals: ["hiring RevOps"], disqualifiers: ["manufacturing", "bank"] } });

// ---------- Part D: pool pre-rank ----------
const smallRevops = { company: "GrowthCRM", jobTitle: "Revenue Operations Manager", industries: ["B2B SaaS"], companyDescription: "B2B SaaS pipeline platform", employeeCount: 48, jobUrl: "https://li/jobs/1", website: "https://growthcrm.com", linkedinUrl: "https://li/company/growthcrm" };
const bigBizdev = { company: "Planhat", jobTitle: "Business Development Lead", industries: ["Software Development"], companyDescription: "customer platform", employeeCount: 244, jobUrl: "https://li/jobs/2", website: "https://planhat.com", linkedinUrl: "https://li/company/planhat" };
const foundingAe = { company: "SeedAI", jobTitle: "Founding Account Executive", industries: ["AI SaaS"], companyDescription: "AI sales automation, recently raised seed", employeeCount: 22, jobUrl: "https://li/jobs/3", website: "https://seedai.com" };
const manufacturing = { company: "SteelWorks", jobTitle: "Operations Manager", industries: ["Manufacturing"], companyDescription: "industrial plant operations", employeeCount: 5000, jobUrl: "https://li/jobs/4" };
const noProof = { company: "Ghost Co", jobTitle: "RevOps", industries: ["SaaS"], employeeCount: null };

Deno.test("4: small B2B SaaS RevOps ranks above larger BizDev", () => {
  const r = preRankCandidates([bigBizdev, smallRevops], saasIcp);
  assertEquals(r.ranked[0].candidate.company, "GrowthCRM");
  assert(r.ranked[0].scoutPreRankScore > r.ranked[1].scoutPreRankScore);
});
Deno.test("5: founding AE / first-sales ranks above generic BizDev", () => {
  const r = preRankCandidates([bigBizdev, foundingAe], saasIcp);
  assertEquals(r.ranked[0].candidate.company, "SeedAI");
});
Deno.test("6: company above ICP max is penalized", () => {
  const s = scoreCandidate(bigBizdev, saasIcp);
  assert(s.penalties.some((p) => /too large/i.test(p)));
});
Deno.test("7: missing proof is penalized", () => {
  const s = scoreCandidate(noProof, saasIcp);
  assert(s.penalties.some((p) => /no job url|no company website/i.test(p)));
});
Deno.test("8: manufacturing / plant ops ranks last (off-ICP)", () => {
  const r = preRankCandidates([smallRevops, manufacturing, foundingAe], saasIcp);
  assertEquals(r.ranked[r.ranked.length - 1].candidate.company, "SteelWorks");
  assert(scoreCandidate(manufacturing, saasIcp).penalties.some((p) => /off-icp|disqualifier|manufacturing/i.test(p)));
});
Deno.test("9: generic Operations Manager does not score as RevOps/Growth", () => {
  const ops = { company: "SvcCo", jobTitle: "Operations Manager", industries: ["Facilities Services"], employeeCount: 80, jobUrl: "https://li/jobs/x", website: "https://svc.com" };
  const s = scoreCandidate(ops, saasIcp);
  assert(s.penalties.some((p) => /generic operations/i.test(p)));
  assert(s.score < scoreCandidate(smallRevops, saasIcp).score);
});
Deno.test("10: all-weak pool → best weak candidate selected + weakPool flag", () => {
  const r = preRankCandidates([manufacturing, { company: "GenOps", jobTitle: "Office Manager", employeeCount: 9000 }], saasIcp);
  assert(r.weakPool, "weak pool flagged");
  assert(r.ranked.length === 2 && r.ranked[0].scoutRank === 1);
});

// ---------- Part E: analyst summary ----------
Deno.test("11: strong lead summary is specific + Agentory ICP-aware", () => {
  const s = buildLeadAnalystSummary({ candidate: smallRevops, icp: saasIcp, aria: { overall_fit: 82 }, gate: { decision: "accept" }, sourceProof: [{ url: "https://li/jobs/1", type: "job_posting" }] });
  assert(["excellent", "strong"].includes(s.analystVerdict));
  assert(/revenue operations/i.test(s.whyThisLeadAppeared));
  assert(/pipeline before payroll|customer-acquisition/i.test(s.recommendedNextAction + " " + (s.outreachAngle ?? "")));
  assert(!/relevant company|industry matches|potential fit/i.test(s.whyThisLeadAppeared));
});
Deno.test("12: Planhat-like weak lead explains proof/size/role/missing funding", () => {
  const s = buildLeadAnalystSummary({ candidate: bigBizdev, icp: saasIcp, aria: { overall_fit: 28 }, gate: { decision: "accept" }, sourceProof: [{ url: "https://li/jobs/2", type: "job_posting" }] });
  assertEquals(s.analystVerdict, "weak");
  assert(/proof/i.test(s.evidenceSummary));
  assert(s.riskFlags.some((r) => /larger than/i.test(r)), "size risk");
  assert(s.riskFlags.some((r) => /business development|bizdev/i.test(r)), "role risk");
  assert(s.missingEvidence.some((m) => /funding/i.test(m)));
  assert(/deprioritize/i.test(s.recommendedNextAction));
});
Deno.test("13: needs-verification lead explains missing evidence", () => {
  const s = buildLeadAnalystSummary({ candidate: { company: "MaybeCo", jobTitle: "Head of Growth", industries: ["SaaS"], employeeCount: null, jobUrl: null, source_url: null }, icp: saasIcp, aria: { overall_fit: 50 }, gate: { decision: "needs_verification" }, sourceProof: [] });
  assertEquals(s.analystVerdict, "needs_verification");
  assert(s.missingEvidence.length > 0);
  assert(/verify/i.test(s.recommendedNextAction));
});
Deno.test("14: rejected lead explains the disqualifier", () => {
  const s = buildLeadAnalystSummary({ candidate: manufacturing, icp: saasIcp, aria: { overall_fit: 10 }, gate: { decision: "reject", disqualifiersHit: ["manufacturing"] } });
  assertEquals(s.analystVerdict, "reject");
  assert(s.disqualifierExplanation && /manufacturing/i.test(s.disqualifierExplanation));
  assert(/do not contact/i.test(s.recommendedNextAction));
});
