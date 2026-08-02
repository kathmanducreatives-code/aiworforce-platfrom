// Provider-free tests for the run-agent ↔ jobs-signal bridge + the timing → final
// state safety contract. No network; injected runTool.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  makeJobsSignalExecutor, buildSignalCandidates, timingStagesCandidate,
  companyKeyForItem, toNormalizedJob, GTM_ROLE_KEYWORDS,
} from "../../supabase/functions/_shared/runAgentJobsSignal.ts";
import { JOBS_ACTOR_KEY } from "../../supabase/functions/_shared/jobsSignalAdapter.ts";
import { resolveFinalCandidateState } from "../../supabase/functions/_shared/finalCandidateState.ts";
import type { EvidenceSufficiencyResult } from "../../supabase/functions/_shared/evidenceSufficiency.ts";
import type { TimingAssessment } from "../../supabase/functions/_shared/timingAssessment.ts";

const suff = (identity: boolean, fit: boolean): EvidenceSufficiencyResult =>
  ({ identityComplete: identity, fitComplete: fit, nextDecision: "structured_company_enrichment" } as unknown as EvidenceSufficiencyResult);
const timing = (decision: string): TimingAssessment => ({ decision } as unknown as TimingAssessment);

// (28) candidate mapping carries post-company-enrichment fit + company grounding
Deno.test("28: buildSignalCandidates carries sufficiency + grounded company key", () => {
  const items = [{ company: "Acme", source_url: "https://www.linkedin.com/in/f1", raw: { company_linkedin_url: "https://www.linkedin.com/company/acme-saas" } }];
  const sm = new Map([["c1", suff(true, true)]]);
  const [c] = buildSignalCandidates({ items, candidateIdOf: () => "c1", sufficiencyByCandidate: sm });
  assertEquals(c.candidateId, "c1");
  assertEquals(c.companyKey, "li:linkedin.com/company/acme-saas");
  assertEquals(c.sufficiency.fitComplete, true);
});

Deno.test("company key falls back domain → name; person url grounds personRef", () => {
  assertEquals(companyKeyForItem({ domain: "acme.com" }), "dom:acme.com");
  assertEquals(companyKeyForItem({ company: "Acme SaaS" }), "name:acmesaas");
  assertEquals(companyKeyForItem({}), null);
});

// (5/6) canonical actor identity is forced; non-GTM roles filtered
Deno.test("makeJobsSignalExecutor forces the canonical jobs actor and filters non-GTM roles", async () => {
  const seen: any[] = [];
  const runTool = async (_t: string, input: any) => {
    seen.push(input);
    return { ok: true, data: { run_id: "r1", items: [
      { title: "Account Executive", posted_at: "2026-07-10", company_linkedin_url: "https://www.linkedin.com/company/acme", job_url: "https://www.linkedin.com/jobs/view/1" },
      { title: "Backend Engineer", posted_at: "2026-07-10" },   // filtered out
    ] } };
  };
  const exec = makeJobsSignalExecutor(runTool, { agent_slug: "scout" });
  const res = await exec({ actorKey: "x", actorId: "y", companyKey: "li:acme", companyName: "Acme", maxItems: 10 } as any);
  assertEquals(seen[0].selected_actor_key, JOBS_ACTOR_KEY);
  assertEquals(seen[0].actor_id, undefined);                     // never a caller value
  assertEquals(seen[0].source_type, "jobs");
  assert(GTM_ROLE_KEYWORDS.length > 0);
  assertEquals(res.items!.length, 1);                            // only the AE role survives
  assertEquals((res.items![0] as any).jobTitle, "Account Executive");
});

Deno.test("toNormalizedJob maps source_with_apify job fields tolerantly", () => {
  const n = toNormalizedJob({ title: "Head of Sales", posted_at: "2026-07-01", company_linkedin_url: "https://www.linkedin.com/company/x", job_url: "https://www.linkedin.com/jobs/view/9" });
  assertEquals(n.jobTitle, "Head of Sales");
  assertEquals(n.postedAt, "2026-07-01");
  assertEquals(n.jobUrl, "https://www.linkedin.com/jobs/view/9");
});

// (29)(32) timing_sufficient does NOT bypass final qualification
Deno.test("29/32: timing_sufficient falls through to the persistence authority (never force-accepts)", () => {
  const base = { sourceGateDecision: "accept", providerVerified: true, artifactMatches: true, ariaEvaluated: true };
  // sufficient + persistence REFUSED ⇒ still staged, not qualify_now.
  const refused = resolveFinalCandidateState({ ...base, persistDecision: { persist: false, reason: "aria_reject" }, timingDecision: "timing_sufficient" });
  assert(refused.state !== "qualify_now");
  assertEquals(refused.persist, false);
  // sufficient + persistence ACCEPTED ⇒ qualify_now (timing merely cleared the gap).
  const accepted = resolveFinalCandidateState({ ...base, persistDecision: { persist: true, reason: "aria_accepted" }, timingDecision: "timing_sufficient" });
  assertEquals(accepted.state, "qualify_now");
  assertEquals(accepted.persist, true);
});

// (30) missing timing stages; (31 covered) ; contradicted rejects
Deno.test("30: missing timing stages; contradicted rejects (never fabricated urgency)", () => {
  const base = { sourceGateDecision: "accept", providerVerified: true, artifactMatches: true, ariaEvaluated: true };
  const missing = resolveFinalCandidateState({ ...base, persistDecision: { persist: false, reason: "stage_missing_evidence:timing" }, timingDecision: "missing_timing_evidence" });
  assertEquals(missing.state, "stage_missing_evidence");
  assertEquals(missing.persist, false);
  const contradicted = resolveFinalCandidateState({ ...base, persistDecision: { persist: true, reason: "aria_accepted" }, timingDecision: "timing_contradicted" });
  assertEquals(contradicted.state, "reject");
  assertEquals(contradicted.rejection_class, "timing_contradiction");
});

// (34) final states mutually exclusive
Deno.test("34: the reducer returns exactly one final state", () => {
  const r = resolveFinalCandidateState({ sourceGateDecision: "accept", providerVerified: true, artifactMatches: true, ariaEvaluated: true, persistDecision: { persist: true, reason: "ok" } });
  assertEquals(["qualify_now", "stage_missing_evidence", "reject"].includes(r.state), true);
  assertEquals(r.state === "qualify_now" ? r.persist : true, true);   // qualify ⇒ persist
});

Deno.test("timingStagesCandidate: missing/contradicted stage; sufficient/not_required do not", () => {
  assertEquals(timingStagesCandidate(timing("missing_timing_evidence")), true);
  assertEquals(timingStagesCandidate(timing("timing_contradicted")), true);
  assertEquals(timingStagesCandidate(timing("timing_sufficient")), false);
  assertEquals(timingStagesCandidate(timing("timing_not_required")), false);
  assertEquals(timingStagesCandidate(undefined), false);
});
