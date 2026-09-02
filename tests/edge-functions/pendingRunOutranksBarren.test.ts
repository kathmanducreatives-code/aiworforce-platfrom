// A PAID RUN IN FLIGHT OUTRANKS EVERY FINDING ABOUT THE CANDIDATES.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 744644ab. Its last slice decided `awaiting_provider_run,
// continuing: true` while job search xczA1HpLcL008EbU1 was mid-flight. That run
// SUCCEEDED at 16:31:18 with three job rows. The sweeper then read a
// `barren_slices` of 2 and terminated the lineage `no_progress` — eight lines
// before it would have asked whether a provider was still running.
//
// The row recorded the contradiction: `auto_continuation.continuing: true`
// beside `terminal_status: "no_progress"`, three companies' hiring evidence
// bought and discarded.
//
// `decideAutoContinuation` has always had this right — every one of its
// findings is guarded by `!awaiting`. The sweeper is a second opinion that
// ignored the first.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  eligibleForAutoResume, type StalledTaskRow,
} from "../../supabase/functions/_shared/stalledLeadResume.ts";
import {
  MAX_BARREN_SLICES,
} from "../../supabase/functions/_shared/leadAutoContinuation.ts";
import {
  RESUME_STATE_VERSION,
} from "../../supabase/functions/_shared/leadResumeState.ts";

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const baseResult = () => ({
  terminal_status: "continuation_required",
  company_first_state: { next_action: "start_round" },
  lead_mission: { original_user_query: "Find 5 B2B SaaS companies in the UK." },
  capability_execution_state: {
    completed_capabilities: ["general_company_discovery"],
    pending_capabilities: [], pending_runs: [] as unknown[],
  },
  lead_lineage_progress: {
    barren_slices: MAX_BARREN_SLICES, continuations_used: 3,
    cost_units_used: 10, qualified_high_water: 1,
    unique_companies_investigated: 48,
  },
  auto_continuation: { continuing: true, decision: "awaiting_provider_run" },
  lead_resume_checkpoint: {
    version: RESUME_STATE_VERSION,
    companies: [{
      company_key: "acme.com", company_name: "Acme",
      identity: "resolved", enrichment: "completed", hiring: "verified_externally",
      brain: "not_started", founder: "not_started", completed_operations: [],
      snapshot: {
        company: { company_name: "Acme", canonical_domain: "acme.com" },
        yc_open_jobs: [], prequalified: null, prequal_key: null,
        shortlisted: true, investigation_state: "investigated", enriched: null,
      },
    }],
  },
});

/** MERGED, not replaced — an override must not delete the checkpoint. */
const row = (patch: Record<string, unknown> = {}): StalledTaskRow => ({
  id: "t1", workspace_id: "ws", user_id: "u", plan_id: "p",
  agent_slug: "scout", step_index: 0, status: "ready",
  updated_at: ago(20 * 60_000), created_at: ago(30 * 60_000),
  continuation_claim_expires_at: null,
  result: { ...baseResult(), ...patch },
} as unknown as StalledTaskRow);

Deno.test("a checkpointed pending run outranks a barren verdict", () => {
  const r = row({
    capability_execution_state: {
      completed_capabilities: ["general_company_discovery"],
      pending_capabilities: [],
      pending_runs: [{ run_id: "xczA1HpLcL008EbU1", provider: "apify_linkedin_job_search" }],
    },
  });
  const v = eligibleForAutoResume(r, NOW, {});
  assert(v.eligible, "the lineage must stay alive while a paid call is running");
  assertEquals(v.reason, "resumable");
  assertEquals((v as { evidence?: string }).evidence, "pending_provider_run",
    "a paid call mid-flight is not a moment to declare anything about the pool");
});

Deno.test("a ledger-observed started run outranks it too", () => {
  const v = eligibleForAutoResume(row(), NOW, { hasStartedProviderRun: true });
  assert(v.eligible);
  assertEquals((v as { evidence?: string }).evidence, "pending_provider_run");
});

Deno.test("with no run in flight, barren still stops the lineage", () => {
  // The protection is not weakened — only ordered.
  const v = eligibleForAutoResume(row(), NOW, { hasStartedProviderRun: false });
  assertEquals(v.reason, "no_progress");
  assertEquals(v.disposition, "terminate");
});

Deno.test("spend ceilings still outrank a pending run", () => {
  // A ceiling is a fact about spend, true whatever the provider returns —
  // `decideAutoContinuation` orders them the same way.
  const r = row({
    lead_lineage_progress: {
      barren_slices: 0, continuations_used: 99, cost_units_used: 10,
      qualified_high_water: 1, unique_companies_investigated: 48,
    },
    capability_execution_state: {
      completed_capabilities: [], pending_capabilities: [],
      pending_runs: [{ run_id: "r1", provider: "p" }],
    },
  });
  assertEquals(eligibleForAutoResume(r, NOW, {}).reason, "continuation_ceiling");
});

Deno.test("the sweeper asks the ledger for every row, not only continuable ones", async () => {
  // The guard was circular: the label is what the sweeper is deciding, and a
  // row mislabelled by an earlier slice could never present the one fact that
  // would have corrected it.
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/resume-stalled-leads/index.ts", import.meta.url),
  );
  const i = src.indexOf("let hasStartedProviderRun = false;");
  assert(i > 0, "the lookup must exist");
  const block = src.slice(i, i + 500)
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert(!block.includes("CLAIMABLE_TERMINAL_STATUS"),
    "it must not be conditioned on the status it is helping to decide");
  assert(block.includes('.eq("status", "started")'),
    "and it still asks only about genuinely open rows");
});

Deno.test("the pending check precedes the barren check in source order", async () => {
  const src = await Deno.readTextFile(
    new URL("../../supabase/functions/_shared/stalledLeadResume.ts", import.meta.url),
  );
  const pending = src.indexOf("return go(\"pending_provider_run\")");
  const barren = src.indexOf("return stop(\"no_progress\"");
  assert(pending > 0 && barren > 0, "both branches must exist");
  assert(pending < barren,
    "a paid run in flight must be asked about before any finding about the pool");
});
