// THE FIVE THINGS THE AUDIT HAD TO GO OUTSIDE THE DATABASE TO LEARN.
//
// Each of these cost a query, an Apify API call, or a source read during the
// forensic audit of task 5c461aa3. One of them turned out not to be an
// observability gap at all.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCountLedger } from "../../../supabase/functions/_shared/providerResponseContract.ts";
import { JOBS_POOL_READ_CEILING } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { buildSmartShortlist } from "../../../supabase/functions/_shared/leadInvestigationBudget.ts";

const REGISTRY = await Deno.readTextFile(new URL(
  "../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
const RUN_AGENT = await Deno.readTextFile(new URL(
  "../../../supabase/functions/run-agent/index.ts", import.meta.url));

// ══ 1. THE 25-ROW CAP — NOT A GAP, A LOSS ══════════════════════════════════

Deno.test("1. a paid jobs dataset is read past the old 25-row cap", () => {
  // Task 5c461aa3's four hiring searches produced datasets of 74, 98, 59 and 3
  // rows. The reader took 25, 25, 25 and 3: 156 of 234 rows this run paid for
  // were never seen, and the assessment that found no sales roles was scoring a
  // truncated third of the evidence.
  assert(JOBS_POOL_READ_CEILING >= 200,
    "the ceiling must clear every dataset this system has produced");
  const at = REGISTRY.indexOf("const fetchLimit = isJobsSource");
  assert(at > 0);
  const expr = REGISTRY.slice(at, at + 260);
  assertEquals(/Math\.min\(25/.test(expr), false, "the 25-row cap must be gone");
  assert(expr.includes("JOBS_POOL_READ_CEILING"),
    "and replaced by an explicit, named ceiling");
});

Deno.test("2. the jobs response reports what was bought versus what came back", () => {
  // The structured path has reported this since the identical 50→25 loss; the
  // jobs path never did, which is why the truncation left no trace.
  const at = REGISTRY.indexOf("count_ledger: buildCountLedger(");
  assert(at > 0, "the generic/jobs return must carry a count ledger");
  const block = REGISTRY.slice(at, at + 260);
  assert(block.includes("rawItems.length"), "downloaded is the real dataset read");
  assert(block.includes("compiledMaxItems"),
    "and the Actor's own maxItems, so an under-read is visible too");
});

Deno.test("3. the ledger flags a read shallower than what was paid for", () => {
  // The quieter half: 30 rows read from an Actor paid to produce 98 is not a
  // 30-row dataset, and nothing said so.
  const under = buildCountLedger(30, 30, 30, null, 98);
  assertEquals(under.truncated, true);
  assert(/below_actor_maxItems/.test(under.truncation_reason ?? ""));

  const clean = buildCountLedger(200, 74, 74, null, 30);
  assertEquals(clean.truncated, false, "reading the whole dataset is not truncation");
});

// ══ 2. THE COUNTS THAT WERE ALL NULL ═══════════════════════════════════════

Deno.test("4. a provider call records every stage its rows passed through", () => {
  // `normalized_count`, `unique_count`, `accepted_count` and `rejected_count`
  // were NULL on every provider_call row in production, so "the provider
  // returned nothing" and "we read a third of it" looked identical.
  const at = REGISTRY.indexOf("counts: (() => {");
  assert(at > 0, "the outcome must build real counts");
  const block = REGISTRY.slice(at, at + 700);
  for (const field of ["raw:", "normalized:", "unique:", "accepted:", "rejected:"]) {
    assert(block.includes(field), `${field} must be reported`);
  }
  assert(block.includes("count_ledger"),
    "and derived from the ledger, not guessed");
});

// ══ 3. THE ADOPTED RUN ═════════════════════════════════════════════════════

Deno.test("5. an adopted run is recorded as reused, never as a plain success", () => {
  // The ledger has a distinct status for a run read back without a second
  // charge. This settle path wrote `succeeded`, so the one row in task
  // 5c461aa3 that cost nothing extra was indistinguishable from the three that
  // did — and it kept `cost_source: "unknown"` and `duration_ms: null`.
  const at = RUN_AGENT.indexOf("onRunAdopted: async (info)");
  assert(at > 0);
  const block = RUN_AGENT.slice(at, at + 2600);
  assert(block.includes('status: "reused"'), "the row must say it was reused");
  assertEquals(/status: "succeeded"/.test(block), false);
  assert(block.includes('cost_source: "reused_no_charge"'),
    "and why it carries no cost");
  assert(block.includes("duration_unknown_reason"),
    "and why it carries no duration — rather than inventing a wall-clock figure");
});

// ══ 4. WHOSE RULE REJECTED THE COMPANY ═════════════════════════════════════

Deno.test("6. a Company Brain constraint is not labelled as the user's mission", () => {
  // Eighteen companies were rejected as `mission_constraint:employee_size` for
  // a mission that declared no employee range at all — the 1–150 bound came
  // from the Brain's effective policy.
  const brain = buildSmartShortlist([{
    company_key: "c1", eligible: true,
    hard_exclusion: "employee_size", hard_exclusion_source: "brain_hard",
    relevance: null, confidence: null, signal_strength: null, score: null, name: "Cella",
    // deno-lint-ignore no-explicit-any
  } as any], { budget: 10 } as never);
  assertEquals(brain.excluded[0].reason, "icp_constraint:employee_size");

  const mission = buildSmartShortlist([{
    company_key: "c2", eligible: true,
    hard_exclusion: "employee_size", hard_exclusion_source: "mission",
    relevance: null, confidence: null, signal_strength: null, score: null, name: "Acme",
    // deno-lint-ignore no-explicit-any
  } as any], { budget: 10 } as never);
  assertEquals(mission.excluded[0].reason, "mission_constraint:employee_size");
});

Deno.test("7. an unknown source keeps the wording it always had", () => {
  // Rows written by an older build carry no source. Silence must not become a
  // new claim about who set the rule.
  const legacy = buildSmartShortlist([{
    company_key: "c3", eligible: true, hard_exclusion: "employee_size",
    relevance: null, confidence: null, signal_strength: null, score: null, name: "Old",
    // deno-lint-ignore no-explicit-any
  } as any], { budget: 10 } as never);
  assertEquals(legacy.excluded[0].reason, "mission_constraint:employee_size");
});
