// HISTORICAL F — CANARY 8 (production 2026-10-04, task c01d28d8): HIRING AFFORDABILITY.
//
// PR #22 priced a job search from its RAW input ($0.121 for the mission's 12
// titles) while the ledger reserves the COMPILED spec ($0.049). LlamaIndex
// ($0.0098 spent) was blocked although the ledger would have reserved its
// search; PR #23 reverted it. Replayed here from the production checkpoint with
// zero provider calls, through the production verification phase, against the
// corrected rule: affordability is the ledger's own answer for the compiled call.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadFixture } from "../lib/fixture.ts";
import { ledgerAt, spentByCompany } from "../lib/state.ts";
import { canonicalView, replayVerificationAt } from "../lib/verification.ts";
import { canStillQualify, evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { unaffordableOf, verifiableCandidatesFrom } from "../lib/prod.ts";
import { HIRING_ROUTE_ACTOR } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { decideAutoContinuation } from "../../../supabase/functions/_shared/leadAutoContinuation.ts";

const fx = loadFixture("canary8.hiring-affordability");
const LLAMA = "https://www.linkedin.com/company/llamaindex";
const SOLANA = "https://www.linkedin.com/company/solanalabs";
const DELTA = "https://www.linkedin.com/company/deltalake";
const ACTIONEER = "https://www.linkedin.com/company/actioneer-hq";
const S1 = "before_hiring_verification:slice1";
const S2 = "before_hiring_verification:slice2";
const anchors = fx.anchors as {
  spent_usd_at_checkpoint: Record<string, number>; compiled_job_search_estimate_usd: number;
  raw_input_job_search_estimate_usd: number; hiring_titles: number; hiring_titles_leading: string[];
};

// ── THE RECONSTRUCTION IS FAITHFUL ──────────────────────────────────────────

Deno.test("[historical] F anchors: the rebuilt ledger holds exactly the spend production logged at each instant", () => {
  assertAlmostEquals(spentByCompany(ledgerAt(fx, fx.checkpoints[S1].at))[LLAMA], anchors.spent_usd_at_checkpoint[LLAMA], 1e-9);
  assertAlmostEquals(spentByCompany(ledgerAt(fx, fx.checkpoints[S2].at))[SOLANA], anchors.spent_usd_at_checkpoint[SOLANA], 1e-9);
});

Deno.test("[historical] F anchors: the production hiring verifier compiles the canary's 12 titles to the $0.049 spec production recorded", async () => {
  const r = await replayVerificationAt(fx, S1, { verifiers: "hiring" });
  const pf = r.preflights.find((p) => p.call.candidate_keys.includes(LLAMA));
  assert(pf, "the phase asked the ledger about LlamaIndex's call");
  const titles = (pf.call.input.jobTitles as string[]);
  assertEquals(titles.length, anchors.hiring_titles);
  assertEquals(titles.slice(0, 6), anchors.hiring_titles_leading);
  assertEquals(pf.result!.estimate_usd, anchors.compiled_job_search_estimate_usd, "compiled estimate == production spec_compiled");
  // The raw-input price PR #22 used still exists for ORDERING — and is not what was checked.
  assertEquals(r.phase.order_estimates?.open_role_linkedin_jobs, anchors.raw_input_job_search_estimate_usd);
});

// ── THE DECISIONS ───────────────────────────────────────────────────────────

Deno.test("[historical] F LlamaIndex ($0.0098 + $0.049 = $0.0588 ≤ $0.06): AFFORDABLE — one job search, reserved at the compiled $0.049", async () => {
  const r = await replayVerificationAt(fx, S1, { verifiers: "hiring" });
  assertEquals(r.phase.unaffordable, [], "nothing is closed on budget");
  assertEquals(r.provider.calls.length, 1);
  assertEquals(r.provider.calls[0].actor, HIRING_ROUTE_ACTOR);
  assertEquals(r.provider.calls[0].candidate_keys, [LLAMA]);
  const res = r.ledger.reservations.find((x) => x.purpose === "hiring_evidence");
  assert(res && res.status === "executed");
  assertEquals(res.estimate_usd, 0.049);
  assertAlmostEquals(spentByCompany(r.ledger)[LLAMA], 0.0588, 1e-9);
  const c = r.companies.find((x) => x.key === LLAMA)!;
  assert(c.completed_operations.includes(`verify:${HIRING_ROUTE_ACTOR}`), "the route answered for it");
  assert(!c.completed_operations.some((o) => o.startsWith("unaffordable:")));
});

Deno.test("[historical] F Solana Labs ($0.0236 + $0.049 = $0.0726 > $0.06): UNAFFORDABLE — no call, route closed, reason recorded", async () => {
  const r = await replayVerificationAt(fx, S2, { verifiers: "hiring" });
  assertEquals(r.provider.calls.length, 0);
  assertEquals(r.ledger.reservations.length, r.ledgerBefore.reservations.length, "nothing reserved, nothing refused into the ledger");
  assertEquals(r.phase.unaffordable?.length, 1);
  const u = unaffordableOf(r.phase)[0];
  assertEquals([u.company_key, u.estimate_usd, u.limit_usd], [SOLANA, 0.049, 0.06]);
  assertAlmostEquals(u.would_commit_usd, 0.0726, 1e-9);
  const c = r.companies.find((x) => x.key === SOLANA)!;
  assert(c.completed_operations.includes(`unaffordable:${HIRING_ROUTE_ACTOR}`));
});

Deno.test("[historical] F anchors: Delta Lake and Actioneer — the rebuilt ledger holds the $0.0235 production logged (pre-settlement Atomus)", () => {
  for (const [cp, key] of [["before_hiring_verification:slice4", DELTA], ["before_hiring_verification:slice6", ACTIONEER]] as const) {
    assertAlmostEquals(spentByCompany(ledgerAt(fx, fx.checkpoints[cp].at))[key], anchors.spent_usd_at_checkpoint[key], 1e-9);
  }
});

for (const [cp, key, label] of [
  ["before_hiring_verification:slice4", "https://www.linkedin.com/company/deltalake", "Delta Lake"],
  ["before_hiring_verification:slice6", "https://www.linkedin.com/company/actioneer-hq", "Actioneer"],
] as const) {
  Deno.test(`[historical] F ${label} ($0.0235 + $0.049 = $0.0725 > $0.06): UNAFFORDABLE — no call, route closed`, async () => {
    const r = await replayVerificationAt(fx, cp, { verifiers: "hiring" });
    assertEquals(r.provider.calls.length, 0);
    assertEquals(r.ledger.reservations.length, r.ledgerBefore.reservations.length, "nothing reserved");
    const u = unaffordableOf(r.phase);
    assertEquals(u.map((x) => [x.company_key, x.estimate_usd, x.limit_usd]), [[key, 0.049, 0.06]]);
    assertAlmostEquals(u[0].would_commit_usd, 0.0725, 1e-9);
    assert(r.companies.find((x) => x.key === key)!.completed_operations.includes(`unaffordable:${HIRING_ROUTE_ACTOR}`));
  });
}

// ── AND WHAT CONTINUATION THEN DOES ─────────────────────────────────────────

Deno.test("[historical] F continuation: after LlamaIndex is answered, no verification slice is asked for it — the pool widens instead", async () => {
  const r = await replayVerificationAt(fx, S1, { verifiers: "hiring" });
  const view = canonicalView({ companies: r.companies }, r.mission, fx.provenance.task_id);
  assertEquals(view.evidence_gaps.with_executable_route, 0, "the job search answered; nothing executable remains");
  const d = decideAutoContinuation({
    qualified: 0, requestedCount: 1, frontierRemaining: 0, continuationsUsed: 1, maxContinuations: 10,
    costUnitsUsed: 2, maxCostUnits: 40, barrenSlices: 0, discoveryRoutesRemain: true,
    verificationRoutesRemain: view.evidence_gaps.with_executable_route,
  });
  assertEquals(d.reason, "replenishment_required");
});

Deno.test("[historical] F replay is idempotent: the same checkpoint replayed twice buys the same one call, never two", async () => {
  const a = await replayVerificationAt(fx, S1, { verifiers: "hiring" });
  const b = await replayVerificationAt(fx, S1, { verifiers: "hiring" });
  assertEquals(a.provider.calls.map((c) => c.idempotency_key), b.provider.calls.map((c) => c.idempotency_key));
  // And within one lineage, the answered route is never bought again.
  const again = verifiableCandidatesFrom({ companies: a.companies }, a.criteria, fx.provenance.task_id).find((c) => c.company_key === LLAMA)!;
  const gaps = evidenceGapsFor(again.hard_checks, again.graph, undefined, new Set(again.attempted_routes), undefined,
    new Set(again.unaffordable_routes ?? []));
  assert(!canStillQualify(gaps), "hiring is answered (no posting) — nothing left to buy for LlamaIndex");
});
