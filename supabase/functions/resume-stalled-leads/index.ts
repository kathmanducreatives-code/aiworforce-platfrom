// THE SWEEPER THE CONTINUATION PATH ALWAYS ASSUMED EXISTED.
//
// `leadContinuationDispatch` fires the next slice in process and documents the
// trade: "a slice which dies between writing its checkpoint and firing the next
// one stalls the chain… the existing claim/lease means a sweeper (or a user
// pressing Continue) can pick it up later without racing anything." This is
// that sweeper.
//
// ── A SCHEDULER ENTRY POINT, AND NOTHING ELSE ──────────────────────────────
//
// Modelled on `run-monitoring-tick`, for the same reason it gives: a scheduled
// resume and a manual one must be the SAME resume, or the thing that runs
// unattended is not the thing anybody tested. So this owns no provider, no
// engine, no mission and no writer. It selects, and it calls `run-agent` —
// the endpoint the in-process handoff and the Continue button both call.
//
// ── AND IT INVENTS NO LOCK ─────────────────────────────────────────────────
//
// Mutual exclusion is `claim_sourcing_continuation`, which `run-agent` already
// takes on every resume: `SELECT … FOR UPDATE`, a lease with an expiry, a
// terminal check and an optimistic `checkpoint_version`. Two sweepers racing
// the same task produce one claim and one 409 — and the 409 is a correct,
// quiet outcome here, not an error.
//
// Spend is bounded by the ceilings that already bound it: `continuations_used`,
// `cost_units_used`, and the credit authorisation at the provider boundary.
// `eligibleForAutoResume` reads them rather than adding any of its own.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  eligibleForAutoResume, resumeRequestFor, STALE_AFTER_MS, MAX_RESUMABLE_AGE_MS,
  CLAIMABLE_TERMINAL_STATUS, type StalledTaskRow,
} from "../_shared/stalledLeadResume.ts";
import { dispatchContinuation } from "../_shared/leadContinuationDispatch.ts";
import { LEAD_EXECUTION_CALLS_TABLE } from "../_shared/executionLedger.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

/** How many stalled tasks one tick may nudge. A ceiling on fan-out, not on work. */
const MAX_PER_TICK = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // THE SCHEDULER IS THE ONLY CALLER. A person who wants to continue a run has
  // the Continue button, which goes to `run-agent` directly. A tick a browser
  // could trigger would be a way to spend a workspace's credits from outside.
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  if (!SERVICE_KEY || token !== SERVICE_KEY) return json({ error: "Unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* a cron POST may send nothing */ }
  // A DRY RUN DECIDES AND DISPATCHES NOTHING — what the sweeper WOULD do,
  // before it is allowed to do it. This is how the live proof is taken.
  const dryRun = body.dry_run === true;
  const onlyTask = typeof body.task_id === "string" ? body.task_id : null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  // THE COARSE FILTER IS SQL; THE DECISION IS `eligibleForAutoResume`. Keeping
  // the rules in one pure function is what makes them testable — the query
  // only narrows, it never decides.
  let q = admin.from("tasks")
    .select("id, workspace_id, user_id, plan_id, agent_slug, step_index, status, " +
      "updated_at, created_at, continuation_claim_expires_at, result")
    .eq("status", "ready")
    .gte("created_at", new Date(now - MAX_RESUMABLE_AGE_MS).toISOString())
    .lte("updated_at", new Date(now - STALE_AFTER_MS).toISOString())
    .order("updated_at", { ascending: true })
    .limit(50);
  if (onlyTask) q = q.eq("id", onlyTask);

  const { data, error } = await q;
  if (error) return json({ error: "tasks_unavailable", detail: error.message }, 500);
  const rows = ((data ?? []) as unknown) as StalledTaskRow[];

  const considered: Array<Record<string, unknown>> = [];
  let dispatched = 0;

  for (const row of rows) {
    // PAID WORK WAITING TO BE ADOPTED — the strongest reason to come back, and
    // the one `recoverPendingRuns` will turn into a `GET` rather than a second
    // POST once the slice runs.
    let hasStartedProviderRun = false;
    if (row.result && (row.result as Record<string, unknown>).terminal_status ===
        CLAIMABLE_TERMINAL_STATUS) {
      const { data: started } = await admin.from(LEAD_EXECUTION_CALLS_TABLE)
        .select("provider_run_id")
        .eq("task_id", row.id).eq("workspace_id", row.workspace_id ?? "")
        .eq("status", "started").not("provider_run_id", "is", null).limit(1);
      hasStartedProviderRun = (started ?? []).length > 0;
    }

    const verdict = eligibleForAutoResume(row, now, { hasStartedProviderRun });
    const entry: Record<string, unknown> = {
      task_id: row.id, eligible: verdict.eligible, reason: verdict.reason,
      ...(verdict.evidence ? { evidence: verdict.evidence } : {}),
      has_started_provider_run: hasStartedProviderRun,
    };

    if (!verdict.eligible) { considered.push(entry); continue; }

    const request = resumeRequestFor(row);
    if (!request) {
      considered.push({ ...entry, eligible: false, reason: "incomplete_row" });
      continue;
    }
    entry.continuation_index = request.continuationIndex;

    if (dryRun) { considered.push({ ...entry, dispatched: "dry_run" }); continue; }
    if (dispatched >= MAX_PER_TICK) {
      considered.push({ ...entry, dispatched: "deferred_to_next_tick" });
      continue;
    }

    const outcome = await dispatchContinuation(request, {
      fetch: (url, init) => fetch(url, init),
      functionsBaseUrl: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1`,
      serviceRoleKey: SERVICE_KEY,
      log: (m, meta) => console.log(`[resume-stalled-leads] ${m}`, meta ?? ""),
    });
    // A 409 IS THE CLAIM WORKING, NOT A FAULT. Another worker got there first,
    // which is exactly what the lease is for.
    considered.push({ ...entry, dispatch: outcome });
    if (outcome.dispatched) dispatched++;
  }

  console.log("[resume-stalled-leads] tick", {
    scanned: rows.length, dispatched, dry_run: dryRun,
  });
  return json({
    version: "resume-stalled-leads-v1",
    scanned: rows.length, dispatched, dry_run: dryRun, considered,
  });
});
