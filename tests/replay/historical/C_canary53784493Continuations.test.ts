// HISTORICAL C — CANARY 53784493 (production 2026-10-03): CONTINUATIONS SPENT RETRIES.
//
// Five clean slices each spent one queue attempt; at attempts = 5 the release
// failed the row `continuation_attempts_exhausted`, so slice 6 (page 3) was
// never claimed with 18 discovery pages left. PR #16: a clean continuation
// refunds its attempt and counts a continuation instead. Replayed against the
// REAL queue SQL (PGlite) with the production worker core and release; the
// handler's decisions are the production continuation's, fed the canary's counters.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { foldAndDecide } from "../lib/continuation.ts";
import { QueueLab, QUEUE_MIGRATIONS } from "../lib/queue.ts";
import { readLineageProgress } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";
import { CONTINUATION_ATTEMPTS_EXHAUSTED } from "../../../supabase/functions/_shared/leadMissionTerminal.ts";

const fx = loadFixture("canary53784493.continuations");
const asItRan = (fx.anchors as { as_it_ran: { claims: number; final_status: string; final_attempts: number; terminal_reason: string } }).as_it_ran;
const expected = fx.expected as { decisions_first_five: string[] };

async function replay(migrations: readonly string[]) {
  const lab = await QueueLab.open({ migrations });
  const id = await lab.enqueue();
  let progress = readLineageProgress({});
  const log: Array<{ slice: number; decision: string; page: number | null }> = [];
  const w = lab.worker(async (m) => {
    const n = progress.continuations_used + 1;
    const s = fx.slices![Math.min(n, fx.slices!.length) - 1];
    const r = foldAndDecide(progress, s);
    progress = r.progress;
    log.push({ slice: n, decision: String(r.decision.reason), page: s.page ?? null });
    return r.decision.continue
      ? { status: "continuation_required", terminal: false, taskId: m.taskId ?? fx.provenance.task_id, lineageSlices: progress.continuations_used }
      : { status: String(r.decision.reason), terminal: true, taskId: m.taskId ?? fx.provenance.task_id, lineageSlices: progress.continuations_used };
  });
  const counters: Array<{ attempts: number; continuations: number | undefined; status: string }> = [];
  for (let i = 0; i < 6; i++) {
    const t = await w.tick();
    if (!t.claimed) break;
    const row = await lab.row(id);
    counters.push({ attempts: row.attempts, continuations: row.continuations, status: row.status });
    await lab.backoffElapses();
  }
  const final = await lab.row(id);
  await lab.close();
  return { log, releases: w.releases, counters, final };
}

Deno.test("[historical] C anchors: on the pre-fix queue SQL the canary's five clean slices spend five attempts and slice 6 is never claimed", async () => {
  const r = await replay([QUEUE_MIGRATIONS[0]]);
  assertEquals(r.log.map((x) => x.decision), expected.decisions_first_five);
  assertEquals(r.log.length, asItRan.claims);
  assertEquals([r.final.status, r.final.attempts], [asItRan.final_status, asItRan.final_attempts]);
  assertEquals(r.releases.at(-1)?.reason, asItRan.terminal_reason);
  assertEquals(asItRan.terminal_reason, CONTINUATION_ATTEMPTS_EXHAUSTED);
});

Deno.test("[historical] C a clean continuation refunds its attempt: slice 6 is claimed and page 3 runs", async () => {
  const r = await replay(QUEUE_MIGRATIONS);
  assertEquals(r.log.length, 6, "slice 6 claimed");
  assertEquals(r.log[5].page, 3, "page 3 executed");
  assert(r.counters.slice(0, 5).every((c) => c.attempts === 0), JSON.stringify(r.counters));
  assertEquals(r.counters.slice(0, 5).map((c) => c.continuations), [1, 2, 3, 4, 5]);
});
