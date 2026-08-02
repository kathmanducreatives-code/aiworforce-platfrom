// Provider-free tests for LATENCY-BOUNDED company enrichment: bounded
// concurrency, per-company timeout, and the run-level deadline. Everything is
// driven by a deterministic VIRTUAL clock — no real timers, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCompanyEnrichment, mapWithConcurrency,
  COMPANY_ENRICHMENT_CONCURRENCY, EDGE_FUNCTION_WALL_CLOCK_MS, FINALIZATION_RESERVE_MS, enrichmentDeadlineFrom,
  type SourceAcceptedPerson, type CompanyActorExecutor, type EnrichmentClock,
} from "../../functions/_shared/companyEnrichmentOrchestrator.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";
import { DEFAULT_EVIDENCE_BUDGET } from "../../functions/_shared/conditionalEnrichmentPlanner.ts";
import { satisfiedCategories } from "../../functions/_shared/candidateEnvelope.ts";
import { FIXTURE_COMPLETE } from "../../functions/_shared/linkedinCompanyActorFixture.ts";

const NOW = "2026-07-16T12:00:00.000Z";
const BRAIN = { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" };
const FIT = compileLeadEntityIntent("Find founders of B2B SaaS companies");
const B = DEFAULT_EVIDENCE_BUDGET;

/** Deterministic virtual clock: sleep() registers a cancelable virtual timer;
 * runAll() drains timers in time order, flushing microtasks to quiescence
 * between fires so async continuations (races, runner relaunches) fully settle. */
const flush = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };
class VirtualClock implements EnrichmentClock {
  t = 0;
  private seq = 0;
  private timers: { at: number; seq: number; resolve: () => void; onAbort?: () => void }[] = [];
  now() { return this.t; }
  sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const entry = { at: this.t + Math.max(0, ms), seq: this.seq++, resolve, onAbort: undefined as (() => void) | undefined };
      const onAbort = () => { this.timers = this.timers.filter((x) => x !== entry); resolve(); };
      entry.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
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

const person = (id: string, over: Partial<SourceAcceptedPerson> = {}): SourceAcceptedPerson => ({
  candidateId: id, name: `Founder ${id}`, title: "Co-Founder", company: `Co ${id}`,
  profileUrl: `https://www.linkedin.com/in/${id}`,
  companyLinkedInUrl: `https://www.linkedin.com/company/${id}`,
  locationText: "Austin, Texas, United States", countryCode: "US",
  providerVerified: true, preRankScore: 50, ...over,
});

/** Executor that simulates each company taking `durationFor(key)` virtual ms and
 * records in-flight/started diagnostics. */
function timedExecutor(clock: VirtualClock, opts: {
  durationFor?: (companyUrl: string) => number;
  items?: unknown[];
} = {}) {
  const durationFor = opts.durationFor ?? (() => 30);
  const started: { url: string; at: number }[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const exec: CompanyActorExecutor = async (a) => {
    const url = (a.input.companies ?? a.input.searches ?? [])[0] ?? "";
    started.push({ url, at: clock.now() });
    stats.inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      await clock.sleep(durationFor(url));
      return { items: opts.items ?? [FIXTURE_COMPLETE], providerRunId: "run" };
    } finally { stats.inFlight--; }
  };
  return { exec, started, stats };
}

// ---- (1)(2)(3)(30) bounded concurrency, two waves, not sequential ----
Deno.test("1/2/3/30: five companies run in bounded waves (≤3 in flight), not five sequential", async () => {
  const clock = new VirtualClock();
  const { exec, started, stats } = timedExecutor(clock, { durationFor: () => 30 });
  const people = Array.from({ length: 5 }, (_v, i) => person(`c${i}`));
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 3 });
  await clock.runAll();
  const r = await p;
  assertEquals(r.observability.summary.companies_called, 5);
  assertEquals(stats.maxInFlight, 3);                         // never more than 3 at once
  // Two waves: 3 companies start at t=0, 2 start at t=30 (not 5 sequential @ 0,30,60,90,120).
  const startTimes = started.map((s) => s.at).sort((a, b) => a - b);
  assertEquals(startTimes.filter((t) => t === 0).length, 3);
  assertEquals(startTimes.filter((t) => t === 30).length, 2);
  assert(clock.now() <= 60, `total virtual time ${clock.now()} should be ~2 waves (≤60), not 150`);
  assertEquals(r.ledger.structuredUsed, 5);
});

Deno.test("mapWithConcurrency preserves input order and caps in-flight", async () => {
  let inFlight = 0, maxInFlight = 0;
  const clock = new VirtualClock();
  const items = [0, 1, 2, 3, 4];
  const p = mapWithConcurrency(items, 2, async (n) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await clock.sleep(10);
    inFlight--; return n * 2;
  });
  await clock.runAll();
  assertEquals(await p, [0, 2, 4, 6, 8]);
  assertEquals(maxInFlight, 2);
});

// ---- (4)(5) dedupe + fan-out unchanged ----
Deno.test("4/5: three founders at one company ⇒ one call, evidence fanned to all three", async () => {
  const clock = new VirtualClock();
  const { exec, started } = timedExecutor(clock);
  const people = ["f1", "f2", "f3"].map((id) => person(id, { companyLinkedInUrl: "https://www.linkedin.com/company/shared" }));
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 3 });
  await clock.runAll();
  const r = await p;
  assertEquals(started.length, 1);                            // ONE call for the shared company
  assertEquals(r.requalifyCandidateIds.size, 3);              // fanned to all three
});

// ---- (6)(7)(8)(29) per-company timeout ----
Deno.test("6/7/8: a slow company times out; others still enrich; its candidate is not requalified", async () => {
  const clock = new VirtualClock();
  // Company "slow" takes 100ms (> 45ms timeout); others 20ms.
  const { exec } = timedExecutor(clock, { durationFor: (u) => u.includes("/slow") ? 100 : 20 });
  const people = [
    person("good1", { companyLinkedInUrl: "https://www.linkedin.com/company/good1" }),
    person("slow", { companyLinkedInUrl: "https://www.linkedin.com/company/slow" }),
    person("good2", { companyLinkedInUrl: "https://www.linkedin.com/company/good2" }),
  ];
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 3, companyTimeoutMs: 45 });
  await clock.runAll();
  const r = await p;
  const out = new Map(r.companyResults.map((c) => [c.companyKey, c.outcome]));
  assertEquals(out.get("li:linkedin.com/company/slow"), "timeout");
  assertEquals(out.get("li:linkedin.com/company/good1"), "enriched");
  assertEquals(out.get("li:linkedin.com/company/good2"), "enriched");
  assert(r.requalifyCandidateIds.has("good1") && r.requalifyCandidateIds.has("good2"));
  assertEquals(r.requalifyCandidateIds.has("slow"), false);          // timed-out ⇒ no evidence
  assertEquals(r.ledger.structuredUsed, 3);                          // 3 real calls launched
  // observability: timed_out is a documented subset of failed; reconciles.
  assertEquals(r.observability.summary.companies_timed_out, 1);
  assertEquals(r.observability.summary.companies_failed, 1);
  assertEquals(r.observability.summary.reconciles, true);
});

// ---- (9)(10)(11)(12)(29) run-level deadline ----
Deno.test("9/10/11: at the deadline no new call is launched; remaining stage as skipped_due_deadline", async () => {
  const clock = new VirtualClock();
  const { exec, started } = timedExecutor(clock, { durationFor: () => 20 });
  const people = ["a", "b", "c", "d"].map((id) => person(id, { companyLinkedInUrl: `https://www.linkedin.com/company/${id}` }));
  // Concurrency 1 ⇒ sequential launches at t=0,20,…; deadline 25 ⇒ only a,b launch;
  // c,d are reached with clock ≥ deadline ⇒ skipped_due_deadline (never called).
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 1, companyTimeoutMs: 100, deadlineMs: 25 });
  await clock.runAll();
  const r = await p;
  const startedUrls = new Set(started.map((s) => s.url));
  assertEquals(started.length, 2);                                   // only a,b launched
  assert(!startedUrls.has("https://www.linkedin.com/company/c"));    // (10) skipped companies never called
  assert(!startedUrls.has("https://www.linkedin.com/company/d"));
  assertEquals(r.observability.summary.companies_skipped_deadline, 2);
  assertEquals(r.observability.summary.companies_skipped, 2);
  assertEquals(r.ledger.structuredUsed, 2);                          // (29) only real calls counted
  assertEquals(r.observability.summary.stop_reason, "deadline_reached");
  assertEquals(r.observability.summary.reconciles, true);            // (12) terminal observability reconciles
  // (11) workflow still produced envelopes + sufficiency for every candidate.
  assertEquals(r.envelopes.length, 4);
  assertEquals(r.sufficiencyAfter.size, 4);
});

Deno.test("deadline-skipped candidate keeps its incomplete-company sufficiency (stage, not qualify)", async () => {
  const clock = new VirtualClock();
  const { exec, started } = timedExecutor(clock, { durationFor: () => 30 });
  const people = ["a", "b"].map((id) => person(id, { companyLinkedInUrl: `https://www.linkedin.com/company/${id}` }));
  // deadline 0 ⇒ the very first launch check (now()==0 ≥ 0) trips ⇒ nothing called.
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 1, companyTimeoutMs: 100, deadlineMs: 0 });
  await clock.runAll();
  const r = await p;
  assertEquals(started.length, 0);                                   // no provider call at all
  assertEquals(r.companyResults.every((c) => c.outcome === "skipped_due_deadline"), true);
  assertEquals(r.requalifyCandidateIds.size, 0);
  for (const id of ["a", "b"]) assert(!satisfiedCategories(r.envelopes.find((e) => e.candidateId === id)!).has("company_website"));
});

// ---- (30) end-to-end within the configured safe budget ----
Deno.test("30: enrichment finishes well before the finalization reserve boundary", async () => {
  const clock = new VirtualClock();
  const { exec } = timedExecutor(clock, { durationFor: () => 30 });
  const people = Array.from({ length: 5 }, (_v, i) => person(`c${i}`));
  const deadlineMs = enrichmentDeadlineFrom(0);   // start at virtual 0
  const p = runCompanyEnrichment({ people, intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: exec, clock, concurrency: 3, deadlineMs });
  await clock.runAll();
  await p;
  assert(clock.now() <= deadlineMs, `finished at ${clock.now()} within deadline ${deadlineMs}`);
  assertEquals(deadlineMs, EDGE_FUNCTION_WALL_CLOCK_MS - FINALIZATION_RESERVE_MS);
});

// ---- (31) no network / no executor ----
Deno.test("31: with no executor injected nothing is called (pure, no network)", async () => {
  const clock = new VirtualClock();
  const r = await runCompanyEnrichment({ people: [person("p1")], intent: FIT, brain: BRAIN, budget: B, now: NOW, execute: null, clock });
  assertEquals(r.observability.summary.companies_called, 0);
  assertEquals(COMPANY_ENRICHMENT_CONCURRENCY, 3);
});
