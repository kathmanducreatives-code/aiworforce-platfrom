// PHASE 6 — THE TICK. SIGNALS ANSWERS WITHOUT BEING ASKED.
//
// ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
//
// A scheduler entry point, and nothing else. It decides WHO is due and WHETHER
// they may spend, then calls `run-monitoring-scan` — the same endpoint a person
// triggers. It owns no provider, no engine, no mission and no writer.
//
// That separation is the point: a scheduled pass and a manual one must be the
// same pass, or the thing that runs unattended is not the thing anybody tested.
//
// ── THE TWO GUARDS IT ADDS ──────────────────────────────────────────────────
//
//   THE CADENCE decides whether to ask at all. Phase 3's pre-flight decides
//   whether an ANSWER is still fresh, and it can only do that from evidence
//   that knows when it happened — monitoring's own events carry no source date,
//   so on a schedule the cadence is what stops the re-spend.
//
//   THE PERIOD CEILING bounds unattended spend. Every other guard in the system
//   answers "may THIS call happen"; none of them can stop a hundred small calls
//   a day for a month.
//
// ── AND A CLAIM, SO TWO TICKS PRODUCE ONE SCAN ──────────────────────────────
//
// The claim is a conditional UPDATE — a compare-and-swap in one statement — so
// two schedulers racing cannot both win. It is a LEASE, not a flag: a flag set
// by a run that then crashes freezes the subject forever.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  planDueScans, budgetAllows, subjectDue,
  CLAIM_LEASE_MINUTES, DEFAULT_PERIOD_CEILING, DEFAULT_PERIOD_DAYS,
  type SchedulableSubject,
} from "../_shared/monitoringSchedule.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

interface WorkspaceOutcome {
  workspace_id: string;
  scanned: boolean;
  reason: string;
  claimed_subjects: number;
  budget: { ceiling: number; spent: number; remaining: number } | null;
  scan?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── THE SCHEDULER IS THE ONLY CALLER ──────────────────────────────────────
  //
  // No user path at all. A person who wants a scan now has `run-monitoring-scan`
  // and does not need a tick, and a tick that a browser could trigger would be
  // a way to spend a workspace's period ceiling from the outside.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!SERVICE_KEY || token !== SERVICE_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* a cron POST may send nothing */ }
  // A DRY RUN DECIDES AND SPENDS NOTHING. What a scheduler would do, before it
  // is allowed to do it.
  const dryRun = body.dry_run === true;
  const onlyWorkspace = typeof body.workspace_id === "string" ? body.workspace_id : null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = Date.now();

  let q = admin
    .from("monitoring_subjects")
    .select("id, workspace_id, enabled, cadence_minutes, last_run_at, claimed_at")
    .eq("enabled", true);
  if (onlyWorkspace) q = q.eq("workspace_id", onlyWorkspace);
  const { data: subjectRows, error: sErr } = await q;
  if (sErr) return json({ error: "subjects_unavailable", detail: sErr.message }, 500);

  const subjects = (subjectRows ?? []) as SchedulableSubject[];
  const plan = planDueScans(subjects, now);

  const outcomes: WorkspaceOutcome[] = [];
  for (const workspace_id of plan.workspaces) {
    // ── THE CEILING, BEFORE THE CLAIM ───────────────────────────────────────
    //
    // Checked first so a refused workspace does not have its subjects claimed
    // and their cadence advanced for a pass that never ran.
    const { data: budgetRow } = await admin
      .from("monitoring_budgets")
      .select("period_ceiling, period_days")
      .eq("workspace_id", workspace_id).maybeSingle();
    const ceiling = budgetRow?.period_ceiling ?? DEFAULT_PERIOD_CEILING;
    const period_days = budgetRow?.period_days ?? DEFAULT_PERIOD_DAYS;

    const { data: spentRaw } = await admin.rpc("monitoring_spend_in_period", {
      p_workspace: workspace_id, p_period_days: period_days,
    });
    const spent = Number(spentRaw ?? 0);
    const decision = budgetAllows({ ceiling, spent, period_days });
    const budget = { ceiling, spent, remaining: decision.remaining };

    if (!decision.allowed) {
      outcomes.push({
        workspace_id, scanned: false, reason: decision.reason,
        claimed_subjects: 0, budget,
      });
      continue;
    }

    if (dryRun) {
      outcomes.push({
        workspace_id, scanned: false,
        reason: `would scan — ${decision.reason}`,
        claimed_subjects: plan.decisions
          .filter((d) => d.due && d.workspace_id === workspace_id).length,
        budget,
      });
      continue;
    }

    // ── CLAIM, AS A COMPARE-AND-SWAP ────────────────────────────────────────
    //
    // The `.is("claimed_at", null)` is what makes two ticks produce one scan:
    // the loser's UPDATE matches no rows and it claims nothing. A lease that
    // has expired is reclaimed by the `or` below, so a crashed run releases.
    const leaseCutoff = new Date(now - CLAIM_LEASE_MINUTES * 60_000).toISOString();
    const dueIds = plan.decisions
      .filter((d) => d.due && d.workspace_id === workspace_id)
      .map((d) => d.subject_id);

    const { data: claimed } = await admin
      .from("monitoring_subjects")
      .update({ claimed_at: new Date(now).toISOString() })
      .in("id", dueIds)
      .or(`claimed_at.is.null,claimed_at.lt.${leaseCutoff}`)
      .select("id");

    const claimedIds = (claimed ?? []).map((r) => r.id as string);
    if (claimedIds.length === 0) {
      outcomes.push({
        workspace_id, scanned: false,
        reason: "another tick claimed this workspace's due subjects first",
        claimed_subjects: 0, budget,
      });
      continue;
    }

    // ── THE SAME ENDPOINT A PERSON TRIGGERS ─────────────────────────────────
    let scan: unknown = null;
    let scanned = false;
    let reason = decision.reason;
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/run-monitoring-scan`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "apikey": SERVICE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace_id,
          // A SCHEDULED PASS IS SMALL BY DEFAULT. Nobody is watching it, and a
          // pass that cannot finish inside the wall clock qualifies nobody —
          // live run 2026-08-25 discovered 25 companies and evaluated none.
          max_candidates: Number(body.max_candidates ?? 3),
        }),
      });
      scan = await res.json().catch(() => null);
      scanned = res.ok;
      if (!res.ok) reason = `the scan returned ${res.status}`;
    } catch (e) {
      reason = `the scan could not be reached: ${e instanceof Error ? e.message : String(e)}`;
    }

    // ── RELEASE THE CLAIM, WHATEVER HAPPENED ────────────────────────────────
    //
    // `last_run_at` advances only on a scan that RAN, so a failed pass is
    // retried on the next tick rather than waiting a full cadence for a run
    // that never happened. The claim is released either way — holding it would
    // make a failure look like work in progress until the lease expired.
    await admin
      .from("monitoring_subjects")
      .update({
        claimed_at: null,
        ...(scanned ? { last_run_at: new Date().toISOString() } : {}),
      })
      .in("id", claimedIds);

    outcomes.push({
      workspace_id, scanned, reason,
      claimed_subjects: claimedIds.length, budget, scan,
    });
  }

  return json({
    ok: true,
    dry_run: dryRun,
    considered: subjects.length,
    due: plan.summary,
    workspaces: outcomes,
  });
});
