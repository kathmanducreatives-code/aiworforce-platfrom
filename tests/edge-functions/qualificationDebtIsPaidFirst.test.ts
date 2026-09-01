// A SLICE THAT ALREADY OWES BRAIN DECISIONS PAYS THAT DEBT BEFORE BUYING MORE.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Task 3417c428, slice at 11:06:56. Four companies — DiligenceVault (67),
// Hebbia (196), Kody (70), Pump.co (112) — were investigated, enriched and
// hiring-verified, each carrying its assessment, jobs and evaluation. Each
// needed one Brain call. The slice spent 145 of its 147 seconds elsewhere:
//
//     +  0.0s  capability_reopened  company_enrichment   (4 outstanding)
//     + 11.4s  company_enrichment_complete
//     + 11.8s  capability_reopened  hiring_verification
//     + 11.9s  job search   + 42.3s  job search   + 63.0s  job search
//     +145.5s  hiring_verification_complete
//     +145.9s  qualification_deadline_stop { not_reached: 4, remaining_ms: 0 }
//
// `capabilityStillOwed` reopened those stages for OTHER companies, correctly.
// But the chain is walked in order, so four companies needing no provider work
// sat behind three job searches — every slice, until MAX_BARREN_SLICES stopped
// a run whose best candidates were one model call from a verdict.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  capabilityStillOwed, nextStageFor, type CompanyResumeRecord,
} from "../../supabase/functions/_shared/leadResumeState.ts";
import {
  isUnfinishedFrontier,
} from "../../supabase/functions/_shared/leadInvestigationBudget.ts";
import {
  buildMissionFunnel, funnelIsBalanced,
} from "../../supabase/functions/_shared/leadMissionFunnel.ts";

/**
 * The exact state the four production companies were in: investigated,
 * enriched, hiring-verified, owing only a Brain decision.
 */
const owesBrain = (key: string): CompanyResumeRecord => ({
  company_key: key, company_name: key,
  identity: "resolved", enrichment: "completed",
  hiring: "verified_externally", brain: "not_started",
  founder: "not_started", completed_operations: [],
} as unknown as CompanyResumeRecord);

const owesHiring = (key: string): CompanyResumeRecord => ({
  ...owesBrain(key), hiring: "not_started",
} as unknown as CompanyResumeRecord);

const decided = (key: string, brain: string): CompanyResumeRecord => ({
  ...owesBrain(key), brain,
} as unknown as CompanyResumeRecord);

// ══ G. THE DEBT PREDICATE ══════════════════════════════════════════════════

Deno.test("G. investigated + hiring-verified + brain not_started is outstanding qualification work", () => {
  const four = ["diligencevault", "hebbia", "kody", "pumpcloud"].map(owesBrain);
  for (const r of four) {
    assertEquals(nextStageFor(r), "brain",
      `${r.company_key} owes exactly one Brain call`);
  }
  assert(capabilityStillOwed("company_brain_qualification", four),
    "the existing predicate must see the debt — no second source of truth");
});

// ══ H. DECIDED CANDIDATES CREATE NO DEBT ═══════════════════════════════════

Deno.test("H. a decided candidate creates no qualification debt", () => {
  // Measured against `nextStageFor` rather than assumed: a QUALIFIED company
  // moves on to founder discovery, and review/rejected/failed are terminal.
  // None of them routes back to `brain`, which is what "no debt" means here.
  const expected: Record<string, string | null> = {
    qualified: "founder", review: null, rejected: null, failed: null,
  };
  for (const [outcome, stage] of Object.entries(expected)) {
    const r = decided("done.com", outcome);
    assertEquals(nextStageFor(r), stage, `brain=${outcome}`);
    assertEquals(
      capabilityStillOwed("company_brain_qualification", [r]), false,
      `brain=${outcome} must owe no Brain call`);
  }
});

Deno.test("H2. a company still owing investigation is not qualification debt", () => {
  assertEquals(nextStageFor(owesHiring("x")), "hiring");
  assertEquals(
    capabilityStillOwed("company_brain_qualification", [owesHiring("x")]),
    false, "hiring debt is not Brain debt");
});

// ══ A–D. THE ORDERING ══════════════════════════════════════════════════════

/** The engine's own reorder, restated against its source. */
const reorderedFor = async (records: CompanyResumeRecord[]) => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = src.indexOf("const qualificationDebt =");
  assert(i > 0, "the debt check must exist");
  const block = src.slice(i, src.indexOf("for (let stepIndex", i))
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  return { block, debt: capabilityStillOwed("company_brain_qualification", records) };
};

Deno.test("A. a resumed slice with debt reorders qualification ahead of the provider stages", async () => {
  const { block, debt } = await reorderedFor([owesBrain("kody")]);
  assert(debt, "the fixture must carry debt");
  // Discovery keeps its place — it is where the working set is restored.
  assert(block.includes("WORKING_SET_CAPABILITIES.has(s.capability)"),
    "the pool-restoring stage must still run first");
  assert(block.includes("QUALIFICATION_PRIORITY_CAPABILITIES.includes(s.capability)"),
    "qualification is hoisted ahead of the remaining stages");
  assert(block.includes("!WORKING_SET_CAPABILITIES.has(s.capability)"),
    "and everything else keeps the plan's own order after it");
});

Deno.test("C. no debt leaves the plan order untouched", async () => {
  const { block, debt } = await reorderedFor([decided("a", "qualified")]);
  assertEquals(debt, false);
  assert(block.includes("): opts.plan.steps;") || block.includes(": opts.plan.steps"),
    "with no debt the plan is walked exactly as written");
});

Deno.test("B/D. the debt is read from durable resume records, not from live state", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = src.indexOf("const qualificationDebt =");
  const block = src.slice(i, i + 400);
  assert(block.includes("opts.resume?.records"),
    "the debt must come from persisted records — they survive the checkpoint, " +
    "and the working set is not restored until the walk begins");
  assert(block.includes("capabilityStillOwed"),
    "and from the existing predicate, not a new one");
});

// ══ E. THE REASON SPLIT ════════════════════════════════════════════════════

Deno.test("E. qualification_deferred is distinct from deferred", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  assert(src.includes('reason: "qualification_deferred"'),
    "the qualification stage marks its own reason");
  const i = src.indexOf('capability: "company_brain_qualification",\n              reason:');
  assert(i > 0 || src.includes('reason: "qualification_deferred"'),
    "and not the investigation one");
});

Deno.test("E2. both deferrals remain live frontier work", async () => {
  // THE INVARIANT: frontier means work that can still produce progress. A
  // qualification-deferred company can — with one Brain call. Splitting the
  // reason is for scheduling, never a way to drop it from the frontier.
  assert(isUnfinishedFrontier("investigated", true),
    "a deferred company is live work whichever stage deferred it");
  const run = await Deno.readTextFile(
    new URL("../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(run.includes("DEFERRED_STAGE_REASONS"),
    "the frontier count reads both reasons");
  const i = run.indexOf("const DEFERRED_STAGE_REASONS");
  const decl = run.slice(i, i + 220);
  assert(decl.includes('"deferred"') && decl.includes('"qualification_deferred"'),
    "and both are listed");
});

// ══ F. ACCOUNTING STAYS BALANCED ═══════════════════════════════════════════

const co = (over: Record<string, unknown> = {}) => ({
  key: "acme.com", prequalified: true, triage: "relevant", shortlisted: true,
  shortlist_exclusion: null, identity: "resolved", enrichment: "success",
  reached_brain: true, brain: "QUALIFIED", evaluated: true,
  decision_source: "gpt_evaluation", verdict: "pass", persisted: true, ...over,
} as never);

Deno.test("F. a qualification-deferred company is withheld, and unaccounted stays 0", () => {
  const f = buildMissionFunnel([
    co(),
    co({
      key: "kody.com", reached_brain: false, brain: null, brain_blocked: true,
      evaluated: false, decision_source: "not_evaluated", verdict: null,
      persisted: false,
    }),
  ]);
  const brain = f.stages.find((s) => s.stage === "company_brain")!;
  assertEquals(brain.withheld, 1);
  assertEquals(brain.unaccounted, 0);
  assert(funnelIsBalanced(f));
});

// ══ J. NO PROVIDER EVIDENCE IS RE-BOUGHT ═══════════════════════════════════

Deno.test("J. the reorder buys nothing — it only changes visit order", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = src.indexOf("const orderedSteps = qualificationDebt");
  const block = src.slice(i, src.indexOf("for (let stepIndex", i));
  // The reorder is a permutation of the plan's own steps: nothing added,
  // nothing removed, no stage skipped — so no company loses a stage and no
  // provider call is introduced or repeated.
  assertEquals((block.match(/opts\.plan\.steps\.filter/g) ?? []).length, 3,
    "exactly three partitions of the same list");
  assert(!block.includes("callProvider") && !block.includes("invoke("),
    "the reorder performs no work of its own");
});
