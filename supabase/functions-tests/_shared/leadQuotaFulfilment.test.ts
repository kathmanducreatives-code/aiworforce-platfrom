// Quota propagation, adaptive company-first rounds, terminal statuses,
// persistence policy, employer identity and SaaS precision.
// Regression for the v96 run: 1 round, 0 CONTACT, status "completed".
// ZERO network (run without --allow-net).

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveRequestedLeadCount, isQuotaEligibleCandidate, countEligible, remainingLeadCount,
  leadIdentityKey, DEFAULT_REQUESTED_LEAD_COUNT, MAX_REQUESTED_LEAD_COUNT,
} from "../../functions/_shared/leadQuotaPolicy.ts";
import { runCompanyFirstQuotaController } from "../../functions/_shared/companyFirstQuotaController.ts";
import { executeRunAgentCompanyFirstSourcing } from "../../functions/_shared/executeRunAgentCompanyFirstSourcing.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";
import { keywordQueriesForRound } from "../../functions/_shared/jobSearchSpec.ts";
import { buildCompoundPersistencePlan } from "../../functions/_shared/runAgentCompoundPersistenceAdapter.ts";
import { verifyCurrentEmployer } from "../../functions/_shared/employerVerification.ts";
import { resolveCompanyIdentity, differsOnlyByCohortLabel } from "../../functions/_shared/companyIdentity.ts";
import { qualifyCompanyVertical } from "../../functions/_shared/verticalQualification.ts";
import { DEFAULT_COMPOUND_LIMITS } from "../../functions/_shared/compoundSourcingPipeline.ts";
import { runCompoundSourcing } from "../../functions/_shared/compoundSourcingPipeline.ts";

const NOW = "2026-07-25T16:12:14Z";
const SAAS = "Founders of SaaS startups hiring Sales Operations in the United States";
const intent = compileLeadEntityIntent(SAAS);

const saasJob = (co: string, dom: string, n = 0) => ({
  title: "Revenue Operations Manager", companyName: co, companyWebsite: `https://${dom}`,
  companyLinkedinUrl: `https://linkedin.com/company/${dom.split(".")[0]}`,
  location: "New York, United States", jobUrl: `https://j/${dom}/${n}`,
  descriptionText: "Own US revenue operations.", companyDescription: "B2B SaaS software platform", id: `j-${dom}-${n}`,
});
const founderOf = (co: string, dom: string) => ({
  fullName: `Founder ${co}`, headline: "Co-Founder & CEO", linkedinUrl: `https://linkedin.com/in/${dom}`,
  experience: [{ companyName: co, companyUrl: `https://linkedin.com/company/${dom.split(".")[0]}`, companyDomain: dom, title: "Co-Founder & CEO", current: true }],
});
const nonFounder = (dom: string) => ({
  fullName: "Wrong Role", headline: "Software Engineer", linkedinUrl: `https://linkedin.com/in/wr-${dom}`,
  experience: [{ companyName: "Other Co", companyDomain: "other.com", title: "Software Engineer", current: true }],
});
const noopPersist = async () => ({ ok: true, accountId: "acc", contactId: null, leadCandidateId: "lc" });

// ================= COUNT PROPAGATION (1-10) =================================
Deno.test("1/2/3. explicit requested count is used and marked explicit", () => {
  const q = resolveRequestedLeadCount({ explicit: 12, isLeadSourcingWorkflow: true });
  assertEquals(q.requestedLeadCount, 12);
  assertEquals(q.source, "explicit");
  assertFalse(q.clamped);
});
Deno.test("4/5. missing count defaults to 25 for lead sourcing, with provenance", () => {
  const q = resolveRequestedLeadCount({ explicit: null, isLeadSourcingWorkflow: true });
  assertEquals(q.requestedLeadCount, DEFAULT_REQUESTED_LEAD_COUNT);
  assertEquals(q.source, "workflow_default");
});
Deno.test("6/7/8. final quota and raw batch size are INDEPENDENT fields", () => {
  assertEquals(DEFAULT_COMPOUND_LIMITS.rawJobs, 25);
  const q = resolveRequestedLeadCount({ explicit: 40, isLeadSourcingWorkflow: true });
  assertEquals(q.requestedLeadCount, 40);
  assertEquals(DEFAULT_COMPOUND_LIMITS.rawJobs, 25);   // unchanged by the quota
});
Deno.test("9. invalid requested counts are safely bounded", () => {
  assertEquals(resolveRequestedLeadCount({ explicit: 0, isLeadSourcingWorkflow: true }).clamped, true);
  assertEquals(resolveRequestedLeadCount({ explicit: -5, isLeadSourcingWorkflow: true }).requestedLeadCount, 1);
  assertEquals(resolveRequestedLeadCount({ explicit: 5000, isLeadSourcingWorkflow: true }).requestedLeadCount, MAX_REQUESTED_LEAD_COUNT);
  assertEquals(resolveRequestedLeadCount({ explicit: 2.5, isLeadSourcingWorkflow: true }).clamped, true);
});
Deno.test("10. non-lead tasks do NOT inherit the lead-sourcing default", () => {
  const q = resolveRequestedLeadCount({ explicit: null, isLeadSourcingWorkflow: false });
  assertEquals(q.source, "legacy_default");
  assert(q.requestedLeadCount < DEFAULT_REQUESTED_LEAD_COUNT);
});

// ================= ADAPTIVE LOOP (11-25) ====================================
Deno.test("11/12. 0 eligible in round 1 SCHEDULES round 2 (v96 regression)", async () => {
  let rounds = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => { rounds++; return [saasJob("Asana", "asana.com", rounds)]; },
    invokePeople: async () => [nonFounder("asana.com")],   // always wrong role → 0 eligible
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws" });
  assert(res.rounds_attempted >= 2, `expected >=2 rounds, got ${res.rounds_attempted}`);
  assertEquals(res.eligible_leads, 0);
  assertEquals(res.remaining_leads, 25);
});
Deno.test("13. partial fill schedules another round with the correct remaining", async () => {
  let call = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => { call++; return [saasJob("Asana", "asana.com", call), saasJob("Vanta", "vanta.com", call)]; },
    invokePeople: async (env) => {
      const dom = String((env.input as Record<string, unknown>)._scope_domain ?? "");
      return call === 1 && dom === "asana.com" ? [founderOf("Asana", "asana.com")] : [nonFounder(dom)];
    },
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws" });
  assert(res.rounds_attempted >= 2);
  assertEquals(res.rounds[0].remaining_after_round, 25 - res.rounds[0].new_eligible_leads);
});
Deno.test("14/15/16. duplicate jobs, companies and people collapse across rounds", async () => {
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => [saasJob("Asana", "asana.com", 0)],   // identical every round
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws" });
  const keys = new Set(res.candidates.map(leadIdentityKey));
  assertEquals(keys.size, res.candidates.length);            // no duplicate leads retained
  assert(res.rounds.slice(1).every((r) => r.new_unique_jobs === 0));
});
Deno.test("18. broadening never introduces generic AE/SDR/BDR titles", () => {
  for (const round of [1, 2, 3, 4]) {
    const { keywords } = keywordQueriesForRound(intent.job_search_spec, round);
    const hay = keywords.join(" ").toLowerCase();
    for (const bad of ["account executive", "account manager", "sdr", "bdr", "business development", "customer success", "sales representative"]) {
      assertFalse(hay.includes(bad), `round ${round} leaked "${bad}"`);
    }
  }
  assert(keywordQueriesForRound(intent.job_search_spec, 2).keywords.length > keywordQueriesForRound(intent.job_search_spec, 1).keywords.length);
});
Deno.test("17. every broadened round-2 title still passes the SHARED job-family gate", async () => {
  const { classifyJobFamily } = await import("../../functions/_shared/jobFamily.ts");
  for (const kw of keywordQueriesForRound(intent.job_search_spec, 2).keywords) {
    assert(classifyJobFamily(kw, null).qualifiesAsSalesOps, `broadened title would be dropped by the gate: ${kw}`);
  }
});
Deno.test("19. controller stops the moment the quota is reached", async () => {
  let jobsCalls = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => { jobsCalls++; return [saasJob("Asana", "asana.com", jobsCalls)]; },
    invokePeople: async () => [founderOf("Asana", "asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 1, now: NOW, workspaceId: "ws" });
  assertEquals(res.terminal_status, "completed");
  assertEquals(res.eligible_leads, 1);
  assertEquals(jobsCalls, 1);                                  // no extra paid round
});
Deno.test("22. controller stops at the maximum round bound", async () => {
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => [saasJob("Asana", "asana.com", Math.random())],
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws", bounds: { maxRounds: 2 } });
  assertEquals(res.rounds_attempted, 2);
  assertEquals(res.terminal_status, "round_limit_reached");
});
Deno.test("21. controller stops at the budget boundary", async () => {
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => [saasJob("Asana", "asana.com", Math.random())],
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws", bounds: { hardBudget: 0.3, costPerJobsCall: 0.25 } });
  assertEquals(res.terminal_status, "budget_exhausted");
  assert(res.budget_consumed <= 0.3);
});
Deno.test("23/24. provider failure is honest and never auto-retries the paid call", async () => {
  let jobsCalls = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => { jobsCalls++; throw new Error("actor exploded"); },
    invokePeople: async () => [],
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws" });
  assertEquals(res.terminal_status, "provider_failure");
  assertEquals(jobsCalls, 1);
});

// ================= QUOTA + STATUS (26-41) ===================================
Deno.test("26/27/28/29/30. only CONTACT counts by default", () => {
  assert(isQuotaEligibleCandidate({ verdict: "CONTACT" }));
  assertFalse(isQuotaEligibleCandidate({ verdict: "WATCH" }));
  assertFalse(isQuotaEligibleCandidate({ verdict: "NEEDS_REVIEW" }));
  assertFalse(isQuotaEligibleCandidate({ verdict: "REJECT" }));
  assertFalse(isQuotaEligibleCandidate({ verdict: "SKIP" }));
  assert(isQuotaEligibleCandidate({ verdict: "WATCH" }, "contact_and_watch"));   // opt-in only
});
Deno.test("31/32/33/34. DB writes, raw jobs, companies and people never count", async () => {
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => [saasJob("Asana", "asana.com", 1)],
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws" });
  assert(res.raw_jobs_processed > 0);
  assertEquals(res.eligible_leads, 0);                    // despite raw/company/people > 0
  assertEquals(res.remaining_leads, 25);
});
Deno.test("35/36. zero CONTACT can NEVER report completed (the v96 defect)", async () => {
  const cf = await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", requestedLeadCount: 25, now: NOW,
    invokeJobs: async () => [saasJob("Asana", "asana.com", 1)],
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  });
  assertEquals(cf.counts.contact, 0);
  assert(cf.status !== "completed", `status was ${cf.status}`);
  assertEquals(cf.quota.eligible_leads, 0);
  assertEquals(cf.quota.remaining_leads, 25);
});
Deno.test("40/41. the result carries the full quota + termination contract", async () => {
  const cf = await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", requestedLeadCount: 25, now: NOW,
    invokeJobs: async () => [saasJob("Asana", "asana.com", 1)],
    invokePeople: async () => [nonFounder("asana.com")],
    persist: noopPersist,
  });
  for (const k of ["requested_leads", "eligible_leads", "remaining_leads", "requested_count_source", "quota_policy"]) {
    assert(k in cf.quota, `missing quota field ${k}`);
  }
  assert(cf.rounds_attempted >= 1 && Array.isArray(cf.expansions_attempted));
  assert(typeof cf.terminal_reason === "string" && cf.terminal_reason.length > 0);
  assert(typeof cf.budget_consumed === "number" && typeof cf.provider_calls === "number");
});

// ================= PERSISTENCE (42-52) ======================================
async function rejectedCandidate() {
  const { candidates } = await runCompoundSourcing(intent, {
    fetchJobs: () => [{ title: "Revenue Operations Manager", company: "Asana", companyDomain: "asana.com", companyLinkedinUrl: "https://linkedin.com/company/asana", companyDescription: "B2B SaaS software platform", location: "New York, United States", url: "https://j/a" }],
    fetchPeopleForCompany: () => [{ name: "Wrong Role", title: "Software Engineer", linkedinUrl: "https://l/x", currentCompany: "Other Co", currentCompanyDomain: "other.com", isCurrent: true }],
  }, { now: NOW });
  return candidates[0];
}
Deno.test("42/43/44/45. REJECT is not persistable — zero account/contact/candidate writes", async () => {
  const plan = buildCompoundPersistencePlan(await rejectedCandidate(), "ws");
  assertEquals(plan.verdict, "REJECT");
  assertFalse(plan.persistable);
  assertEquals(plan.persistenceReason, "disposition_not_persistable");
});
Deno.test("48/49/50. REJECT stays in diagnostics and cannot change disposition or completion", async () => {
  const c = await rejectedCandidate();
  const plan = buildCompoundPersistencePlan(c, "ws");
  assertEquals(plan.leadCandidate.raw.verdict, "REJECT");
  assertEquals(plan.leadCandidate.raw.person_name, "Wrong Role");     // identifiable without a join
  assert(Array.isArray(plan.leadCandidate.raw.failed_gates));
  assertEquals(plan.leadCandidate.raw.quota_eligible, false);
});
Deno.test("51/52. no provider-side writes and no duplicate persistence across rounds", async () => {
  const calls: string[] = [];
  const res = await runCompanyFirstQuotaController(intent, {
    invokeJobs: async () => [saasJob("Asana", "asana.com", 0)],
    invokePeople: async () => [founderOf("Asana", "asana.com")],
    persist: async (p) => { calls.push(`${p.account?.domain}`); return { ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }; },
  }, { requestedLeadCount: 25, now: NOW, workspaceId: "ws", bounds: { maxRounds: 3 } });
  assertEquals(res.provider_side_writes, 0);
  assertEquals(new Set(calls).size, calls.length);       // each lead persisted at most once
});

// ================= EMPLOYER IDENTITY (53-62) ================================
const target = (name: string, dom: string, li: string) => resolveCompanyIdentity({ name, domain: dom, linkedin_url: li });
Deno.test("53. LanceDB vs LanceDB (YC W22) with the same identity → verified_match", () => {
  const r = verifyCurrentEmployer(
    { currentCompany: "LanceDB (YC W22)", currentCompanyDomain: "lancedb.com", isCurrent: true },
    target("LanceDB", "lancedb.com", "https://linkedin.com/company/lancedb"), { now: NOW });
  assertEquals(r.outcome, "verified_match");
});
Deno.test("53b. LanceDB (YC W22) NAME-ONLY is no longer a false mismatch (now ambiguous)", () => {
  const r = verifyCurrentEmployer(
    { currentCompany: "LanceDB (YC W22)", isCurrent: true },
    target("LanceDB", "lancedb.com", "https://linkedin.com/company/lancedb"), { now: NOW });
  // Was verified_mismatch in v96 — the cohort label is now normalised out, so the
  // name matches and the result is honestly "unconfirmed" rather than "wrong".
  assertEquals(r.outcome, "ambiguous");
  assert(r.reason.toLowerCase().includes("no strong identifier"));
});
Deno.test("54. Vanta vs Vanta (Stealth) with a different identity → verified_mismatch", () => {
  const r = verifyCurrentEmployer(
    { currentCompany: "Vanta (Stealth)", currentCompanyDomain: "stealthco.com", isCurrent: true },
    target("Vanta", "vanta.com", "https://linkedin.com/company/vanta-security"), { now: NOW });
  assertEquals(r.outcome, "verified_mismatch");
});
Deno.test("54b. (Stealth) is NOT treated as a cohort label", () => {
  assertFalse(differsOnlyByCohortLabel("Vanta (Stealth)", "Vanta"));
  assert(differsOnlyByCohortLabel("LanceDB (YC W22)", "LanceDB"));
});
Deno.test("55/56/57. suffixes, domains and LinkedIn ids drive the decision", () => {
  assertEquals(verifyCurrentEmployer({ currentCompany: "Example, Inc.", currentCompanyDomain: "example.com", isCurrent: true }, target("Example", "example.com", ""), { now: NOW }).outcome, "verified_match");
  assertEquals(verifyCurrentEmployer({ currentCompany: "Acme", currentCompanyDomain: "acme-other.com", isCurrent: true }, target("Acme", "acme.com", ""), { now: NOW }).outcome, "verified_mismatch");
  assertEquals(verifyCurrentEmployer({ currentCompany: "Asana Inc", currentCompanyLinkedinUrl: "https://linkedin.com/company/asana", isCurrent: true }, target("Asana", "", "https://linkedin.com/company/asana"), { now: NOW }).outcome, "verified_match");
});
Deno.test("58/59/61. historical, missing and fuzzy-only evidence never verify", () => {
  assertEquals(verifyCurrentEmployer({ currentCompany: "Asana", currentCompanyDomain: "asana.com", isCurrent: false, endDate: "2023-01-01" }, target("Asana", "asana.com", ""), { now: NOW }).outcome, "historical_only");
  assertEquals(verifyCurrentEmployer({ currentCompany: null }, target("Asana", "asana.com", ""), { now: NOW }).outcome, "insufficient_evidence");
  assertEquals(verifyCurrentEmployer({ currentCompany: "Asana", isCurrent: true }, target("Asana", "asana.com", ""), { now: NOW }).outcome, "ambiguous");
});

// ================= COMPANY TYPE (63-71) =====================================
const co = (name: string, description: string) => ({ name, description });
Deno.test("63/64/65/69. real SaaS fixtures still pass", () => {
  for (const c of [
    co("Asana", "Work management software platform for teams"),
    co("Vanta", "Compliance automation software platform (SOC 2)"),
    co("LanceDB", "Open-source vector database for AI applications"),
    co("Generic", "Subscription software product for finance teams"),
  ]) assertEquals(qualifyCompanyVertical(c, "saas").outcome, "pass", `${c.name} should pass`);
});
Deno.test("66. logistics network with technology language does NOT confidently pass", () => {
  const r = qualifyCompanyVertical(co("Uber Freight", "Logistics technology platform connecting shippers and carriers in a digital freight network"), "saas");
  assert(r.outcome !== "pass", `expected non-pass, got ${r.outcome}`);
  assertEquals(r.matched, "logistics_operator");
});
Deno.test("67/68/70. staffing, consultancy and buzzword-only never confidently pass", () => {
  assert(qualifyCompanyVertical(co("TalentCo", "Staffing and recruiting firm using proprietary software"), "saas").outcome !== "pass");
  assert(qualifyCompanyVertical(co("AdvisoryCo", "Consulting firm with an internal digital platform"), "saas").outcome !== "pass");
  const weak = qualifyCompanyVertical(co("VagueCo", "An innovative AI-powered technology platform"), "saas");
  assertEquals(weak.outcome, "needs_review");
});

// ================= END-TO-END (offline) =====================================
Deno.test("E2E. quota 25 → rounds → CONTACT-only counting → REJECT never persists", async () => {
  const persistCalls: string[] = [];
  let jobsCalls = 0, peopleCalls = 0;
  const cf = await executeRunAgentCompanyFirstSourcing({
    intent, workspaceId: "ws", requestedLeadCount: 25, requestedCountSource: "workflow_default", now: NOW,
    invokeJobs: async (env) => {
      jobsCalls++;
      const native = env.input as { urls: string[] };
      assert(native.urls.length >= 3);                       // actor-native preserved
      assertEquals(env.defer_persistence, true);             // evidence mode preserved
      return [saasJob("Asana", "asana.com", jobsCalls), saasJob("LanceDB", "lancedb.com", jobsCalls)];
    },
    invokePeople: async (env) => {
      peopleCalls++;
      const dom = String((env.input as Record<string, unknown>)._scope_domain ?? "");
      return dom === "lancedb.com" ? [founderOf("LanceDB", "lancedb.com")] : [nonFounder(dom)];
    },
    persist: async (p) => { persistCalls.push(String(p.verdict)); return { ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }; },
  });

  assertEquals(cf.quota.requested_leads, 25);
  assertEquals(cf.quota.requested_count_source, "workflow_default");
  assert(cf.rounds_attempted >= 2, "quota unmet must schedule another round");
  assertFalse(persistCalls.includes("REJECT"));              // REJECT never persisted
  assertEquals(cf.writeBoundary.providerSideWrites, 0);
  assertEquals(cf.quota.eligible_leads, cf.counts.contact);  // CONTACT-only counting
  assert(cf.status !== "completed" || cf.quota.eligible_leads >= 25);
  assert(jobsCalls >= 1 && peopleCalls >= 1);
});
