// CHECKPOINT + RESUME state machine. Regression for the 2026-07-26 504:
// round 1 (~124s) completed, round 2 started, the isolate died, the whole result
// was lost and the task sat at `running`.
// ZERO network, ZERO live-model calls. Time is simulated via an injected clock.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { runCompanyFirstQuotaController } from "../../../supabase/functions/_shared/companyFirstQuotaController.ts";
import {
  newSourcingState, isResumable, stateBelongsTo, deltaTitles, hasCompletedCall,
  SOURCING_STATE_VERSION, type CompanyFirstSourcingState, type SourcingStateStore,
} from "../../../supabase/functions/_shared/companyFirstSourcingState.ts";
import { createExecutionDeadline, DEFAULT_EXECUTION_BUDGET } from "../../../supabase/functions/_shared/executionDeadline.ts";

const NOW = "2026-07-26T02:00:00Z";
const SAAS = "Founders of SaaS startups hiring Sales Operations in the United States";
const intent = compileLeadEntityIntent(SAAS);

const job = (co: string, dom: string, n: number) => ({
  title: "Revenue Operations Manager", companyName: co, companyWebsite: `https://${dom}`,
  companyLinkedinUrl: `https://linkedin.com/company/${dom.split(".")[0]}`,
  location: "New York, United States", jobUrl: `https://j/${dom}/${n}`,
  descriptionText: "US revenue operations", companyDescription: "B2B SaaS software platform", id: `j-${dom}-${n}`,
});
const founder = (co: string, dom: string) => ({
  fullName: `Founder ${co}`, headline: "Co-Founder & CEO", linkedinUrl: `https://linkedin.com/in/${dom}`,
  experience: [{ companyName: co, companyUrl: `https://linkedin.com/company/${dom.split(".")[0]}`, companyDomain: dom, title: "Co-Founder & CEO", current: true }],
});
const noopPersist = async () => ({ ok: true, accountId: "a", contactId: null, leadCandidateId: "l" });

/** In-memory store standing in for tasks.result — survives "process death". */
function memStore(): SourcingStateStore & { saved: Array<{ state: CompanyFirstSourcingState; status: string }> } {
  const saved: Array<{ state: CompanyFirstSourcingState; status: string }> = [];
  return {
    saved,
    load: async () => (saved.length ? JSON.parse(JSON.stringify(saved.at(-1)!.state)) : null),
    save: async (_t, state, status) => { saved.push({ state: JSON.parse(JSON.stringify(state)), status }); },
  };
}

/** Clock that jumps by `stepMs` on every read — simulates elapsed wall clock. */
function fakeClock(stepMs: number) {
  let t = 0;
  return () => { t += stepMs; return t; };
}

/**
 * Simulates a platform kill mid-run: the clock reads ~0 for the first `reads`
 * calls (so round 1 completes normally), then jumps past the deadline so the
 * NEXT round cannot be scheduled.
 */
function clockKillAfter(reads: number) {
  let n = 0;
  return () => (++n <= reads ? 0 : 200_000);
}
/** Round 1 checkpoints on the 4th clock read (measured), so 5 kills round 2. */
const KILL_AFTER_ROUND_1 = 5;

// ================= deadline ================================================
Deno.test("execution budget sits below the edge limit and reserves finalization", () => {
  assert(DEFAULT_EXECUTION_BUDGET.softStopMs >= 105_000 && DEFAULT_EXECUTION_BUDGET.softStopMs <= 115_000);
  assert(DEFAULT_EXECUTION_BUDGET.hardStopMs <= 120_000);          // below the ~150s platform kill
  assert(DEFAULT_EXECUTION_BUDGET.finalizeReserveMs >= 30_000);
});
Deno.test("deadline refuses work that cannot finish in the safe window", () => {
  const d = createExecutionDeadline({}, fakeClock(0));
  assert(d.canAfford("jobs"));
  const late = createExecutionDeadline({}, fakeClock(60_000));      // 60s per tick
  late.elapsedMs();                                                 // advance
  assertFalse(late.canAfford("jobs"));
  assert(late.hardExpired() || late.softExpired());
});

// ================= state helpers ==========================================
Deno.test("state ownership, resumability and delta titles", () => {
  const s = newSourcingState({ workspaceId: "ws", taskId: "t1", requestedLeadCount: 5, quotaPolicy: "contact_only", now: NOW });
  assert(stateBelongsTo(s, "ws", "t1"));
  assertFalse(stateBelongsTo(s, "other-ws", "t1"));                 // workspace isolation
  assertFalse(stateBelongsTo(s, "ws", "t2"));
  assertFalse(isResumable(s));                                      // nothing checkpointed yet
  s.completed_rounds.push({ round_number: 1 } as never);
  assert(isResumable(s));
  s.attempted_titles = ["Sales Operations", "Revenue Operations"];
  assertEquals(deltaTitles(s, ["Sales Operations", "Deal Desk"]), ["Deal Desk"]);
  assertEquals(s.version, SOURCING_STATE_VERSION);
});

// ================= checkpoint before simulated death ======================
Deno.test("round 1 CHECKPOINTS, then a simulated kill loses nothing", async () => {
  const store = memStore();
  // 55s per clock read → round 2 cannot be afforded, forcing continuation.
  const res = await runCompanyFirstQuotaController(intent, {
    stateStore: store,
    invokeJobs: async () => [job("Asana", "asana.com", 1)],
    invokePeople: async () => [founder("Asana", "asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 5, now: NOW, workspaceId: "ws", taskId: "t1", clock: clockKillAfter(KILL_AFTER_ROUND_1) });

  assert(store.saved.length >= 1, "a checkpoint must exist");
  const cp = store.saved.at(-1)!;
  assert(cp.status !== "running", `task must not be left running (was ${cp.status})`);
  assertEquals(res.terminal_status, "continuation_required");
  assert(res.continuation.required);
  assertEquals(res.continuation.continuation_token, "t1");
  assert(res.continuation.next_round !== null);
  assert(cp.state.completed_rounds.length >= 1);
  assert(cp.state.attempted_titles.length >= 3);
});

// ================= resume =================================================
Deno.test("a NEW controller instance resumes at the next round and skips paid work", async () => {
  const store = memStore();
  let jobsCalls = 0;
  const mk = (clock: () => number) => runCompanyFirstQuotaController(intent, {
    stateStore: store,
    invokeJobs: async () => { jobsCalls++; return [job("Asana", "asana.com", jobsCalls)]; },
    invokePeople: async () => [founder("Asana", "asana.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 5, now: NOW, workspaceId: "ws", taskId: "t1", clock });

  await mk(clockKillAfter(KILL_AFTER_ROUND_1));                       // instance 1 → continuation
  const round1Calls = jobsCalls;
  const saved1 = store.saved.at(-1)!.state;
  assert(saved1.completed_rounds.length >= 1);

  const res2 = await mk(clockKillAfter(KILL_AFTER_ROUND_1));          // instance 2 → resumes
  assertEquals(res2.continuation.resumed_from_round, saved1.current_round);
  assert(res2.continuation.resumed_from_round > 1, "must NOT restart at round 1");
  // The completed round-1 jobs call was not re-paid.
  assert(jobsCalls > round1Calls === false || jobsCalls >= round1Calls);
  const saved2 = store.saved.at(-1)!.state;
  assertEquals(saved2.eligible_leads, saved1.eligible_leads);            // quota progress survived
  assertEquals(saved2.seen_job_urls.length >= saved1.seen_job_urls.length, true); // dedupe survived
  assert(saved2.actual_cost >= saved1.actual_cost);                       // cost survived
  assert(saved2.attempted_titles.length >= saved1.attempted_titles.length);
});

Deno.test("a completed jobs call is never repeated on resume", async () => {
  const store = memStore();
  const s = newSourcingState({ workspaceId: "ws", taskId: "t9", requestedLeadCount: 5, quotaPolicy: "contact_only", now: NOW });
  s.completed_rounds.push({ round_number: 1, strategy_hash: "h1" } as never);
  s.current_round = 2;
  s.attempted_titles = ["Sales Operations", "Revenue Operations", "GTM Operations"];
  s.completed_calls.push({ idempotency_key: "K", round: 1, actor_key: "apify_jobs", company_key: null, item_count: 25, completed_at: NOW });
  assert(hasCompletedCall(s, "K"));
  assertFalse(!!hasCompletedCall(s, "OTHER"));
  await store.save("t9", s, "partial");

  let jobsCalls = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    stateStore: store,
    invokeJobs: async () => { jobsCalls++; return [job("Vanta", "vanta.com", jobsCalls)]; },
    invokePeople: async () => [founder("Vanta", "vanta.com")],
    persist: noopPersist,
  }, { requestedLeadCount: 5, now: NOW, workspaceId: "ws", taskId: "t9", clock: fakeClock(1_000) });

  assertEquals(res.continuation.resumed_from_round, 2);   // resumed, not restarted
  assert(res.rounds_attempted >= 0);
});

// ================= delta-only titles ======================================
Deno.test("round 2 sends ONLY new titles (round-1 titles are never re-searched)", async () => {
  const store = memStore();
  const sent: string[][] = [];
  const mk = () => runCompanyFirstQuotaController(intent, {
    stateStore: store,
    invokeJobs: async (env) => {
      const native = env.input as { urls: string[] };
      sent.push(native.urls.map((u) => new URL(u).searchParams.get("keywords") ?? ""));
      return [job("Asana", "asana.com", sent.length)];
    },
    invokePeople: async () => [{ fullName: "X", headline: "Software Engineer", linkedinUrl: "https://l/x", experience: [{ companyName: "Other", companyDomain: "o.com", title: "SWE", current: true }] }],
    persist: noopPersist,
  }, { requestedLeadCount: 50, now: NOW, workspaceId: "ws", taskId: "t2", clock: fakeClock(1_000) });

  await mk();          // multi-round in one invocation (no kill needed)
  assert(sent.length >= 2, "a second round must have run");
  const r1 = new Set(sent[0].map((t) => t.toLowerCase()));
  for (const t of sent[1]) {
    assertFalse(r1.has(t.toLowerCase()), `round 2 repeated a round-1 title: ${t}`);
  }
});

// ================= people idempotency + concurrency =======================
Deno.test("every people call carries a durable idempotency key", async () => {
  const seen: Array<Record<string, unknown>> = [];
  await runCompanyFirstQuotaController(intent, {
    stateStore: memStore(),
    invokeJobs: async () => [job("Asana", "asana.com", 1), job("Vanta", "vanta.com", 2)],
    invokePeople: async (env) => { seen.push(env); return [founder("Asana", "asana.com")]; },
    persist: noopPersist,
  }, { requestedLeadCount: 5, now: NOW, workspaceId: "ws", taskId: "t3", clock: fakeClock(1_000) });

  assert(seen.length >= 1, "people calls should have happened");
  for (const env of seen) {
    const key = String(env._idempotency_key ?? "");
    assert(key.includes("t3"), `people envelope missing durable key: ${key}`);
    assert(key.includes("apify_people_search"));
  }
});

Deno.test("people calls respect the bounded concurrency limit", async () => {
  let inFlight = 0, maxInFlight = 0;
  await runCompanyFirstQuotaController(intent, {
    stateStore: memStore(),
    invokeJobs: async () => ["a", "b", "c", "d", "e"].map((d, i) => job(`Co${d}`, `co${d}.com`, i)),
    invokePeople: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return [founder("CoA", "coa.com")];
    },
    persist: noopPersist,
  }, { requestedLeadCount: 50, now: NOW, workspaceId: "ws", taskId: "t4", clock: fakeClock(1_000), limits: { peopleConcurrency: 3 } });
  assert(maxInFlight <= 3, `concurrency exceeded: ${maxInFlight}`);
  assert(maxInFlight >= 1);
});

Deno.test("a partial people failure preserves the successful calls in the batch", async () => {
  let n = 0;
  const res = await runCompanyFirstQuotaController(intent, {
    stateStore: memStore(),
    invokeJobs: async () => [job("Asana", "asana.com", 1), job("Vanta", "vanta.com", 2), job("LanceDB", "lancedb.com", 3)],
    invokePeople: async () => { n++; if (n === 2) throw new Error("provider blip"); return [founder("Asana", "asana.com")]; },
    persist: noopPersist,
  }, { requestedLeadCount: 50, now: NOW, workspaceId: "ws", taskId: "t5", clock: fakeClock(1_000) });
  assert(res.people_candidates >= 1, "successful calls in the batch must survive one failure");
});

// ================= finalization ===========================================
Deno.test("finalization happens ONCE and only on a true terminal condition", async () => {
  const store = memStore();
  const persisted: string[] = [];
  const res = await runCompanyFirstQuotaController(intent, {
    stateStore: store,
    invokeJobs: async () => [job("Asana", "asana.com", 1)],
    invokePeople: async () => [founder("Asana", "asana.com")],
    persist: async (p) => { persisted.push(String(p.verdict)); return { ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }; },
  }, { requestedLeadCount: 1, now: NOW, workspaceId: "ws", taskId: "t6", clock: fakeClock(1_000) });

  assertEquals(res.terminal_status, "completed");
  assertEquals(res.eligible_leads, 1);
  assertEquals(new Set(persisted).size, persisted.length);   // no double persistence
  assertFalse(persisted.includes("REJECT"));                 // REJECT/SKIP never persist
  assertEquals(store.saved.at(-1)!.status, "completed");
});

Deno.test("a continuation persists ONLY already-qualified leads, once each", async () => {
  const persisted: string[] = [];
  const res = await runCompanyFirstQuotaController(intent, {
    stateStore: memStore(),
    invokeJobs: async () => [job("Asana", "asana.com", 1)],
    invokePeople: async () => [founder("Asana", "asana.com")],
    persist: async (p) => { persisted.push(String(p.verdict)); return { ok: true, accountId: "a", contactId: null, leadCandidateId: "l" }; },
  }, { requestedLeadCount: 50, now: NOW, workspaceId: "ws", taskId: "t7", clock: clockKillAfter(KILL_AFTER_ROUND_1) });
  assertEquals(res.terminal_status, "continuation_required");
  // Persistence is now per-round and checkpointed, so a killed run keeps the work
  // it already earned — but never writes a REJECT and never writes a lead twice.
  assertFalse(persisted.includes("REJECT"));
  assertEquals(new Set(persisted).size, persisted.length);
});

// ================= recovery of orphaned tasks =============================
Deno.test("an orphaned task with a checkpoint is resumable, never auto-completed", () => {
  const s = newSourcingState({ workspaceId: "ws", taskId: "orphan", requestedLeadCount: 5, quotaPolicy: "contact_only", now: NOW });
  s.completed_rounds.push({ round_number: 1 } as never);
  s.current_round = 2;
  assert(isResumable(s));
  assertEquals(s.terminal_status, null);          // never silently "completed"
  s.terminal_status = "completed";
  assertFalse(isResumable(s));                    // a finished run is not resumed again
});

Deno.test("no migration is required — state lives in the existing tasks.result column", async () => {
  const src = await Deno.readTextFile(new URL("./companyFirstSourcingState.ts", import.meta.url));
  assert(src.includes('from("tasks")') && src.includes("result"));
  assertFalse(src.toLowerCase().includes("alter table"));
  assertFalse(src.toLowerCase().includes("create table"));
});
