// A CANCELLED LINEAGE MUST NOT BE REVIVED BY THE SLICE THAT WAS ALREADY RUNNING.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 2f3d9c5c, 2026-09-03. An operator marked it terminal at 10:49 while a
// slice held the lease. That slice finished, called `release_lineage_lease`,
// and the release reset the lineage to `active` — unconditionally, because the
// status assignment read:
//
//     status = case when p_terminal_reason is not null then 'terminal'
//                   else 'active' end
//
// The sweeper then resumed it normally: 40 further Apify calls and 22 Firecrawl
// calls over 46 minutes, on a run that had already been stopped.
//
// None of the three existing guards could have caught it. The slice WAS the
// legitimate `lease_holder`. `state_version` was untouched, because the
// cancellation wrote to `tasks` and never to `lead_lineages`, so the
// compare-and-swap saw no conflict. Serialising writers is not the same as
// ordering decisions.
//
// These tests read the MIGRATION rather than the database, so they run offline
// and fail on a future edit that removes the fence. The behavioural proof
// against the live functions is the cancellation canary, recorded separately.
//
// ZERO network, ZERO DB, ZERO spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const MIGRATION = "supabase/migrations/20260903160000_cancellation_row_fence.sql";

const sql = await Deno.readTextFile(new URL(MIGRATION, ROOT));

/** The body of one `create or replace function` block, lowercased. */
function fn(name: string): string {
  const i = sql.toLowerCase().indexOf(`function public.${name}(`);
  assert(i >= 0, `${name} must be defined in the migration`);
  const rest = sql.slice(i);
  const end = rest.toLowerCase().indexOf("$function$;");
  return rest.slice(0, end < 0 ? rest.length : end).toLowerCase();
}

// ───────────────────────────── acquire refuses ──────────────────────────────

Deno.test("acquire refuses BOTH terminal and cancelled", () => {
  const body = fn("acquire_lineage_lease");
  // The guard must name both. `status = 'terminal'` alone is what shipped, and
  // it would let a cancelled lineage start a fresh generation.
  assert(
    /status\s+in\s*\(\s*'terminal'\s*,\s*'cancelled'\s*\)/.test(body),
    "acquire must refuse cancelled as well as terminal",
  );
});

Deno.test("acquire still refuses an already-leased lineage", () => {
  // The fence must not have displaced the guard that prevents two concurrent
  // generations — the defect that made the lease exist in the first place.
  assert(fn("acquire_lineage_lease").includes("already_leased"));
});

// ───────────────────────────── release preserves ────────────────────────────

Deno.test("THE FENCE: release never regresses cancelled or terminal to active", () => {
  const body = fn("release_lineage_lease");
  // The status assignment must consult the CURRENT row before deciding. The
  // shipped version branched only on `p_terminal_reason`, so a non-terminal
  // release always wrote 'active'.
  const guard =
    /when\s+public\.lead_lineages\.status\s+in\s*\(\s*'cancelled'\s*,\s*'terminal'\s*\)\s*then\s+public\.lead_lineages\.status/;
  assert(guard.test(body), "release must preserve an already-finished status");
});

Deno.test("release still ends a live lineage when told to", () => {
  // Preserving must not become refusing: a normal terminal release still works.
  const body = fn("release_lineage_lease");
  assert(/when\s+p_terminal_reason\s+is\s+not\s+null\s+then\s+'terminal'/.test(body));
  assert(/else\s+'active'/.test(body), "a live lineage still returns to active");
});

Deno.test("release still persists the holder's work", () => {
  // A fenced release is not a discarded one. The slice already paid for what it
  // learned; it may write `current_state`, it may not reopen the lineage.
  const body = fn("release_lineage_lease");
  assert(body.includes("current_state     = coalesce(p_next_state"));
});

Deno.test("release keeps its lease-holder and CAS guards", () => {
  const body = fn("release_lineage_lease");
  assert(body.includes("not_lease_holder"));
  assert(body.includes("version_conflict"));
});

// ─────────────────────────── cancellation is atomic ─────────────────────────

Deno.test("cancel_lineage settles status, lease and claim in one transaction", () => {
  const body = fn("cancel_lineage");
  assert(body.includes("for update"), "must take the row lock");
  assert(/status\s*=\s*'cancelled'/.test(body));
  assert(/terminal_reason\s*=\s*p_reason/.test(body));
  assert(/lease_holder\s*=\s*null/.test(body));
  assert(/lease_expires_at\s*=\s*null/.test(body));
  assert(/continuation_claim_id\s*=\s*null/.test(body));
  assert(/continuation_claim_expires_at\s*=\s*null/.test(body));
  // Both writes, no COMMIT between them: one plpgsql body is one transaction.
  assert(!body.includes("commit"), "must not split the decision across commits");
});

Deno.test("cancel_lineage is workspace-scoped and idempotent", () => {
  const body = fn("cancel_lineage");
  assert(body.includes("workspace_mismatch"), "tenant isolation");
  assert(body.includes("already_finished"), "re-cancelling is not an error");
});

Deno.test("cancellation does not write terminal_status onto the task", () => {
  // That is precisely what failed on 2f3d9c5c: a last-writer-wins field the
  // in-flight slice overwrites. The lineage row is the authority.
  const body = fn("cancel_lineage");
  assert(
    !body.includes("terminal_status"),
    "cancellation must fence on lineage status, not on a task field",
  );
});

// ───────────────────── the sequence that actually happened ──────────────────

Deno.test("2f3d9c5c: cancel → stale release → still cancelled → acquire refused", () => {
  // A structural walk of the real failure, asserted against the three clauses
  // that now carry it. Each step names the guard that must hold.
  const release = fn("release_lineage_lease");
  const acquire = fn("acquire_lineage_lease");

  // 1. cancellation commits: status becomes 'cancelled', lease cleared.
  assert(/status\s*=\s*'cancelled'/.test(fn("cancel_lineage")));

  // 2. slice A — still the legitimate holder — releases. `not_lease_holder`
  //    does NOT fire, which is why the status clause has to.
  assert(release.includes("not_lease_holder"));

  // 3. its release preserves cancelled rather than writing 'active'.
  assert(
    /when\s+public\.lead_lineages\.status\s+in\s*\(\s*'cancelled'\s*,\s*'terminal'\s*\)/
      .test(release),
  );

  // 4. the next acquire is refused.
  assert(/status\s+in\s*\(\s*'terminal'\s*,\s*'cancelled'\s*\)/.test(acquire));
});

Deno.test("every status writer decides under the same row lock", () => {
  // THE PROPERTY THAT REPLACES AN EPOCH COLUMN.
  //
  // There are THREE writers of `lead_lineages.status`, not two — `acquire` sets
  // it to 'running' as well. I asserted two when writing this and the test
  // corrected me, which is the reason it checks the lock rather than the count:
  // what makes the status a sufficient fence is not how few writers there are,
  // it is that each one reads the row with FOR UPDATE in the transaction that
  // writes it. A cancellation that commits first is therefore visible to every
  // subsequent writer, and one that commits later waits.
  //
  // A writer of this column that does NOT take the row lock — a plain UPDATE
  // from application code, say — breaks the reasoning and the fence would then
  // need a real epoch.
  for (const name of ["acquire_lineage_lease", "release_lineage_lease", "cancel_lineage"]) {
    assert(fn(name).includes("for update"), `${name} must lock the row it decides on`);
  }
  const writers = [...sql.matchAll(/update\s+public\.lead_lineages/gi)].length;
  assertEquals(writers, 3, "acquire, release and cancel — each under FOR UPDATE");
});
