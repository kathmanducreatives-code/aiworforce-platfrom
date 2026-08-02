// Provider-free tests that the FUNNEL and the per-candidate diagnostics tell the
// same story, and that a late provider answer cannot rewrite a finalized workflow.
//
// Regression anchor: the v84 controlled Q1 reported staged=5 AND rejected=5 for the
// same five people, and logged two "apify responded successfully" tool calls AFTER
// the plan had already finalized those companies as timeouts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationFunnel, buildQualificationObservability,
  type CandidateDiagnosticInput,
} from "../../supabase/functions/_shared/qualificationObservability.ts";
import {
  runCompanyEnrichment,
  type SourceAcceptedPerson, type CompanyActorExecutor, type EnrichmentClock,
} from "../../supabase/functions/_shared/companyEnrichmentOrchestrator.ts";
import { compileLeadEntityIntent } from "../../supabase/functions/_shared/leadEntityIntent.ts";
import { DEFAULT_EVIDENCE_BUDGET } from "../../supabase/functions/_shared/conditionalEnrichmentPlanner.ts";
import { FIXTURE_COMPLETE } from "../../supabase/functions/_shared/linkedinCompanyActorFixture.ts";
import { normalizeCompanyOutcome } from "../../supabase/functions/_shared/runAgentCompanyEnrichment.ts";

const cand = (id: string, o: Partial<CandidateDiagnosticInput> = {}): CandidateDiagnosticInput => ({
  normalized_candidate_id: id,
  name: `Founder ${id}`, company: `Co ${id}`,
  source_url: `https://www.linkedin.com/in/${id}`,
  provider_verified: true,
  source_gate_decision: "needs_verification",
  qualification_decision: "stage_missing_evidence",
  persisted: false,
  sent_to_downstream_aria: false,
  ...o,
});

// ---- (2)(3)(25) funnel totals reconcile; no candidate in two buckets ----
Deno.test("2/25: accepted + staged + rejected equals the final candidate set", () => {
  const f = buildQualificationFunnel({
    raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0,
    hard_gate_rejected: 0, qualification_accepted: 1, qualification_staged: 3, qualification_rejected: 1,
    persisted_count: 1, downstream_aria_count: 1,
  });
  assertEquals(f.qualification_accepted + f.qualification_staged + f.qualification_rejected, f.source_gate_accepted);
  assertEquals(f.reconciles, true);
  assertEquals(f.staged_count, 3);
});

Deno.test("3: the v84 shape (staged 5 AND rejected 5 of 5) can no longer reconcile", () => {
  // Previously staged_count was an ALIAS of qualification_rejected, so this passed.
  const broken = buildQualificationFunnel({
    raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0,
    hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 5,
    persisted_count: 0, downstream_aria_count: 0,
  });
  assertEquals(broken.reconciles, false, "5 staged + 5 rejected out of 5 accepted must not reconcile");
});

Deno.test("the honest v84 outcome (all five staged) reconciles", () => {
  const f = buildQualificationFunnel({
    raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0,
    hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0,
    persisted_count: 0, downstream_aria_count: 0,
  });
  assertEquals(f.reconciles, true);
  assertEquals(f.staged_count, 5);
  assertEquals(f.qualification_rejected, 0);
});

// ---- (1)(3) per-candidate: exactly one state, duplicates surfaced ----
Deno.test("1/3: each candidate id resolves to exactly one final state", () => {
  const obs = buildQualificationObservability({
    funnel: {
      raw_count: 3, normalized_count: 3, source_gate_accepted: 3, source_gate_rejected: 0,
      hard_gate_rejected: 0, qualification_accepted: 1, qualification_staged: 1, qualification_rejected: 1,
      persisted_count: 1, downstream_aria_count: 1,
    },
    candidates: [
      cand("a", { qualification_decision: "qualify_now", persisted: true, sent_to_downstream_aria: true }),
      cand("b", { qualification_decision: "stage_missing_evidence", stage_reason: "missing_timing_signal", next_action: "signal_enrichment" }),
      cand("c", { qualification_decision: "reject", source_gate_decision: "reject" }),
    ],
  });
  assertEquals(obs.duplicate_state_candidate_ids, []);
  assertEquals(obs.funnel.reconciles, true);
  const [a, b, c] = obs.candidates;
  assertEquals(a.persisted, true);
  assertEquals(b.persisted, false);
  assertEquals(b.sent_to_downstream_aria, false);
  assertEquals(c.persisted, false);
});

Deno.test("a candidate id emitted with two different states is reported, not hidden", () => {
  const obs = buildQualificationObservability({
    funnel: {
      raw_count: 1, normalized_count: 1, source_gate_accepted: 1, source_gate_rejected: 0,
      hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 1, qualification_rejected: 0,
      persisted_count: 0, downstream_aria_count: 0,
    },
    candidates: [
      cand("dup", { qualification_decision: "stage_missing_evidence" }),
      cand("dup", { qualification_decision: "reject" }),
    ],
  });
  assertEquals(obs.duplicate_state_candidate_ids, ["dup"]);
});

// ---- (11)(24) staged candidates carry no rejection class ----
Deno.test("11/24: a staged candidate carries next_action and NO qualification_threshold", () => {
  const obs = buildQualificationObservability({
    funnel: {
      raw_count: 1, normalized_count: 1, source_gate_accepted: 1, source_gate_rejected: 0,
      hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 1, qualification_rejected: 0,
      persisted_count: 0, downstream_aria_count: 0,
    },
    candidates: [cand("x", {
      qualification_decision: "stage_missing_evidence",
      stage_reason: "missing_timing_signal",
      next_action: "signal_enrichment",
      // the stale v84 array must not drive classification any more
      evidence_missing: ["job_signal", "funding_signal"],
    })],
  });
  const d = obs.candidates[0];
  assertEquals(d.qualification_decision, "stage_missing_evidence");
  assertEquals(d.rejection_class, undefined);
  assertEquals(d.next_action, "signal_enrichment");
  assertEquals(d.staged_reason, "missing_timing_signal");
  assertEquals(d.persisted, false);
  assertEquals(d.sent_to_downstream_aria, false);
});

// ---- (21)(22)(23) late provider completion ----
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
class VirtualClock implements EnrichmentClock {
  t = 0;
  private seq = 0;
  private timers: { at: number; seq: number; resolve: () => void }[] = [];
  now() { return this.t; }
  sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const entry = { at: this.t + Math.max(0, ms), seq: this.seq++, resolve };
      signal?.addEventListener("abort", () => {
        this.timers = this.timers.filter((x) => x !== entry); resolve();
      }, { once: true });
      this.timers.push(entry);
    });
  }
  async runAll(maxSteps = 100000) {
    let steps = 0;
    for (;;) {
      await flush();
      if (!this.timers.length || steps++ > maxSteps) break;
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = Math.max(this.t, next.at);
      next.resolve();
      await flush();
    }
  }
}

const person = (id: string): SourceAcceptedPerson => ({
  candidateId: id, name: `Founder ${id}`, title: "Co-Founder", company: `Co ${id}`,
  profileUrl: `https://www.linkedin.com/in/${id}`,
  companyLinkedInUrl: `https://www.linkedin.com/company/${id}`,
  locationText: "Austin, Texas, United States", countryCode: "US",
  providerVerified: true, preRankScore: 50,
});

Deno.test("21/22/23: a provider answering AFTER its timeout cannot change the outcome", async () => {
  const clock = new VirtualClock();
  // The company answers at 60s — well past the 45s per-company timeout.
  const exec: CompanyActorExecutor = async () => {
    await clock.sleep(60_000);
    return { items: [FIXTURE_COMPLETE], providerRunId: "late-run" };
  };
  const p = runCompanyEnrichment({
    people: [person("late")],
    intent: compileLeadEntityIntent("Find founders of B2B SaaS companies"),
    brain: { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" },
    budget: DEFAULT_EVIDENCE_BUDGET,
    now: "2026-07-16T12:00:00.000Z",
    execute: exec, clock, companyTimeoutMs: 45_000,
  });
  await clock.runAll();
  const r = await p;

  // (21) the workflow outcome stays timeout
  assertEquals(r.companyResults[0].outcome, "timeout");
  assertEquals(r.companyResults[0].failureReason, "actor_timeout");
  assertEquals(r.observability.summary.companies_timed_out, 1);
  assertEquals(r.observability.summary.companies_enriched, 0);
  // (22) the late evidence never lands
  assertEquals(r.requalifyCandidateIds.size, 0);
  assertEquals(r.companyResults[0].bundle, null);
  // (23) finalized observability still reconciles and never counts the late answer
  assertEquals(r.observability.summary.reconciles, true);
  assertEquals(r.observability.summary.companies_called, 1);
  // the late answer is visible as ABANDONED telemetry, distinguishable from success
  assertEquals(r.lateProviderCompletions.length, 1);
  assertEquals(r.lateProviderCompletions[0].status, "ignored_after_timeout");
  assert(r.lateProviderCompletions[0].itemCount >= 1, "the late payload is recorded but unused");
});

Deno.test("a company that answers within its timeout produces no abandoned telemetry", async () => {
  const clock = new VirtualClock();
  const exec: CompanyActorExecutor = async () => {
    await clock.sleep(10_000);
    return { items: [FIXTURE_COMPLETE], providerRunId: "ok-run" };
  };
  const p = runCompanyEnrichment({
    people: [person("ok")],
    intent: compileLeadEntityIntent("Find founders of B2B SaaS companies"),
    brain: { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" },
    budget: DEFAULT_EVIDENCE_BUDGET,
    now: "2026-07-16T12:00:00.000Z",
    execute: exec, clock, companyTimeoutMs: 45_000,
  });
  await clock.runAll();
  const r = await p;
  assertEquals(r.companyResults[0].outcome, "enriched");
  assertEquals(r.lateProviderCompletions.length, 0);
});

// ---- (24) the two observability objects agree per candidate ----
Deno.test("24: company outcome maps to the candidate vocabulary the reducer consumes", () => {
  assertEquals(normalizeCompanyOutcome("enriched"), "enriched");
  assertEquals(normalizeCompanyOutcome("cached"), "enriched");
  assertEquals(normalizeCompanyOutcome("timeout"), "timeout");
  assertEquals(normalizeCompanyOutcome("no_result"), "no_result");
  assertEquals(normalizeCompanyOutcome("provider_error"), "failed");
  assertEquals(normalizeCompanyOutcome("invalid_result"), "failed");
  assertEquals(normalizeCompanyOutcome("skipped_due_deadline"), "skipped_due_deadline");
  assertEquals(normalizeCompanyOutcome("budget_skipped"), "not_attempted");
  assertEquals(normalizeCompanyOutcome("not_needed"), "not_attempted");
});
