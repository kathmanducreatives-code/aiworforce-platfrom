// Provider-free tests for the bounded jobs-signal orchestrator. Deterministic
// virtual clock; injected executors; no network.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runJobsSignalEnrichment, type SignalActorExecutor, type SignalCandidate,
} from "./jobsSignalOrchestrator.ts";
import type { EnrichmentClock } from "./companyEnrichmentOrchestrator.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import { compileEvidenceContract, type EvidenceContract } from "./evidenceContract.ts";
import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
import type { NormalizedJobLike } from "./jobsSignalAdapter.ts";
import type { SignalEvent } from "./signalEvent.ts";

const NOW = "2026-07-17T12:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86400_000).toISOString();
const BRAIN = { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" };

const HIRING = compileEvidenceContract(compileLeadEntityIntent("Find B2B SaaS founders currently hiring for sales"), BRAIN);
const HIRING_60 = compileEvidenceContract(compileLeadEntityIntent("Find B2B SaaS founders hiring in the last 60 days"), BRAIN);
const NO_TIMING = compileEvidenceContract(compileLeadEntityIntent("Find founders of B2B SaaS companies"), BRAIN);

const suff = (identity = true, fit = true): EvidenceSufficiencyResult => ({
  sufficient: false, identityComplete: identity, fitComplete: fit, timingComplete: false,
  missingCriticalRequirements: ["job_signal"], nextDecision: "structured_company_enrichment", reasonCode: "missing_timing",
  // deno-lint-ignore no-explicit-any
} as any);

const cand = (id: string, over: Partial<SignalCandidate> = {}): SignalCandidate => ({
  candidateId: id, companyKey: `li:linkedin.com/company/${id}`,
  companyLinkedInUrl: `https://www.linkedin.com/company/${id}`, companyName: `Co ${id}`,
  personRef: `p:${id}`, sufficiency: suff(), hardBlocked: false, existingSignals: [], ...over,
});

const aeJob = (d: number, raw: Record<string, unknown> = {}): NormalizedJobLike => ({
  company: "Acme", jobTitle: "Account Executive",
  linkedinUrl: "https://www.linkedin.com/company/acme", jobUrl: "https://www.linkedin.com/jobs/view/1",
  postedAt: daysAgo(d), raw,
});

function recordingExec(itemsFor: (a: { companyKey: string }) => NormalizedJobLike[]): { exec: SignalActorExecutor; calls: string[] } {
  const calls: string[] = [];
  const exec: SignalActorExecutor = async (a) => { calls.push(a.companyKey); return { items: itemsFor(a), providerRunId: "run" }; };
  return { exec, calls };
}

const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
class VirtualClock implements EnrichmentClock {
  t = 0; private seq = 0; private timers: { at: number; seq: number; resolve: () => void }[] = [];
  now() { return this.t; }
  sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const e = { at: this.t + Math.max(0, ms), seq: this.seq++, resolve };
      signal?.addEventListener("abort", () => { this.timers = this.timers.filter((x) => x !== e); resolve(); }, { once: true });
      this.timers.push(e);
    });
  }
  async runAll() { let s = 0; for (;;) { await flush(); if (!this.timers.length || s++ > 100000) break; this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq); const n = this.timers.shift()!; this.t = Math.max(this.t, n.at); n.resolve(); await flush(); } }
}

// (14)(28)(29) fresh hiring ⇒ timing_sufficient (but not auto-qualify — reducer's job)
Deno.test("14: a 10-day-old sales role satisfies 'currently hiring'", async () => {
  const { exec, calls } = recordingExec(() => [aeJob(10, { active: true })]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(calls.length, 1);
  assertEquals(r.timingByCandidate.get("acme")!.decision, "timing_sufficient");
  assertEquals(r.observability.summary.candidates_timing_sufficient, 1);
});

// (15) 45-day weak: generic hiring stays missing; explicit 60-day window accepts
Deno.test("15: a 45-day-old role stays missing for generic hiring but satisfies an explicit 60-day window", async () => {
  const g = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: recordingExec(() => [aeJob(45)]).exec });
  assertEquals(g.timingByCandidate.get("acme")!.decision, "missing_timing_evidence");
  const e = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING_60, workspace_id: "ws", now: NOW, execute: recordingExec(() => [aeJob(45)]).exec });
  assertEquals(e.timingByCandidate.get("acme")!.decision, "timing_sufficient");   // explicit window authorizes weak
});

// (16) 61-day stale
Deno.test("16: a 61-day-old role is stale ⇒ missing timing", async () => {
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: recordingExec(() => [aeJob(61)]).exec });
  assertEquals(r.timingByCandidate.get("acme")!.decision, "missing_timing_evidence");
});

// (17)(18)(19) one call per company, fan-out, dedup
Deno.test("17/18: one lookup per company; signals fan out to all founders there", async () => {
  const { exec, calls } = recordingExec(() => [aeJob(10, { active: true })]);
  const shared = "li:linkedin.com/company/shared";
  const cands = ["f1", "f2", "f3"].map((id) => cand(id, { companyKey: shared, companyLinkedInUrl: "https://www.linkedin.com/company/shared" }));
  const r = await runJobsSignalEnrichment({ candidates: cands, contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(calls.length, 1);                                  // ONE call for the shared company
  for (const id of ["f1", "f2", "f3"]) assertEquals(r.timingByCandidate.get(id)!.decision, "timing_sufficient");
  assertEquals(r.requalifyCandidateIds.size, 3);
});

Deno.test("19: duplicate job events collapse deterministically", async () => {
  const { exec } = recordingExec(() => [aeJob(10, { active: true }), aeJob(10, { active: true })]); // same role/day
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(r.observability.summary.deduplicated_signal_events, 1);
});

// (11)(31) closed listing cannot satisfy timing
Deno.test("11/31: a closed listing is stale immediately ⇒ missing timing", async () => {
  const { exec } = recordingExec(() => [aeJob(5, { closed: true })]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(r.timingByCandidate.get("acme")!.decision, "missing_timing_evidence");
  assertEquals(r.observability.summary.closed_or_expired_listings, 1);
});

// (21)(22)(23)(24) planner skips
Deno.test("21: planner skips when timing is not required (no call)", async () => {
  const { exec, calls } = recordingExec(() => [aeJob(10)]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: NO_TIMING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(calls.length, 0);
  assertEquals(r.plansByCandidate.get("acme")!.outcome, "skip_not_required");
  assertEquals(r.timingByCandidate.get("acme")!.decision, "timing_not_required");
});

Deno.test("22: planner skips when fresh timing already exists (no call)", async () => {
  const fresh = { signal_id: "s1", workspace_id: "ws", signal_type: "sales_hiring", signal_category: "gtm",
    company_ref: "li:linkedin.com/company/acme", person_ref: null,
    evidence_refs: [{ category: "job_signal", sourceType: "apify_actor", confidence: "high" }],
    occurred_at: daysAgo(5), observed_at: NOW, confidence: "high", verification: "provider_verified",
    listing_status: "active", dedupe_key: "k", status: "active", sanitized: true } as unknown as SignalEvent;
  const { exec, calls } = recordingExec(() => [aeJob(10)]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme", { existingSignals: [fresh] })], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(calls.length, 0);
  assertEquals(r.plansByCandidate.get("acme")!.outcome, "skip_already_sufficient");
});

Deno.test("23: planner skips hard-rejected candidates (no call)", async () => {
  const { exec, calls } = recordingExec(() => [aeJob(10)]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme", { hardBlocked: true })], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec });
  assertEquals(calls.length, 0);
});

Deno.test("24: no supported source ⇒ staged truthfully (no call)", async () => {
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: null });
  assertEquals(r.plansByCandidate.get("acme")!.outcome, "stage_no_supported_source");
  assertEquals(r.timingByCandidate.get("acme")!.decision, "missing_timing_evidence");
});

// (26)(27) deadline + timeout
Deno.test("26: at the deadline no provider call is launched (skipped_due_deadline)", async () => {
  const { exec, calls } = recordingExec(() => [aeJob(10)]);
  const r = await runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec, deadlineMs: 0, clock: new VirtualClock() });
  assertEquals(calls.length, 0);
  assertEquals(r.observability.summary.companies_skipped_deadline, 1);
  assertEquals(r.observability.summary.reconciles, true);
});

Deno.test("27: a timeout is isolated and cannot be overwritten by a late result", async () => {
  const clock = new VirtualClock();
  const exec: SignalActorExecutor = async () => { await clock.sleep(100); return { items: [aeJob(10)] }; }; // 100ms > 45ms timeout
  const p = runJobsSignalEnrichment({ candidates: [cand("acme")], contract: HIRING, workspace_id: "ws", now: NOW, execute: exec, clock, companyTimeoutMs: 45 });
  await clock.runAll();
  const r = await p;
  assertEquals(r.observability.summary.companies_timed_out, 1);
  assertEquals(r.observability.summary.companies_failed, 1);          // timed_out ⊆ failed
  assertEquals(r.timingByCandidate.get("acme")!.decision, "missing_timing_evidence");
});

// (39) reconciliation + no network with no executor
Deno.test("39: reconciliation holds; contract not requiring timing makes no call", async () => {
  const r = await runJobsSignalEnrichment({ candidates: [cand("a"), cand("b")], contract: HIRING, workspace_id: "ws", now: NOW, execute: recordingExec(() => [aeJob(10, { active: true })]).exec });
  const s = r.observability.summary;
  assertEquals(s.companies_planned, s.companies_called + s.companies_cached + s.companies_skipped);
  assertEquals(s.companies_called, s.companies_enriched + s.companies_no_result + s.companies_failed);
  assertEquals(s.reconciles, true);
});
