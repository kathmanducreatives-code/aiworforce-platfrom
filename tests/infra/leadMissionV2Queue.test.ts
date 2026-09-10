// THE V2 QUEUE MIGRATION, CHECKED AT THE SOURCE — the invariants the worker's
// safety rests on, asserted against the SQL so a regression fails in CI rather
// than in a paid run. Mirrors the other source-level checks in this directory.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SQL = await Deno.readTextFile(
  new URL("../../supabase/migrations/20260910120000_lead_mission_v2_claim.sql", import.meta.url),
);

/** The body of one function, from its CREATE to its closing $function$. */
function fn(name: string): string {
  const start = SQL.search(new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${name}\(`, "i"));
  assert(start >= 0, `${name} must be defined`);
  const end = SQL.indexOf("$function$;", start);
  assert(end > start, `${name} must be terminated`);
  return SQL.slice(start, end);
}

Deno.test("the queue table is service-role only: RLS on, anon/authenticated revoked, no policy", () => {
  assert(/create\s+table\s+if\s+not\s+exists\s+public\.lead_mission_queue/i.test(SQL));
  assert(/alter\s+table\s+public\.lead_mission_queue\s+enable\s+row\s+level\s+security/i.test(SQL));
  assert(/revoke\s+all\s+on\s+table\s+public\.lead_mission_queue\s+from\s+anon/i.test(SQL));
  assert(/revoke\s+all\s+on\s+table\s+public\.lead_mission_queue\s+from\s+authenticated/i.test(SQL));
  assert(!/create\s+policy/i.test(SQL), "no client may read or write the queue");
});

Deno.test("claim is atomic: SKIP LOCKED, and a cancelled/terminal lineage is never claimed", () => {
  const b = fn("claim_next_lead_mission");
  assert(/for\s+update\s+skip\s+locked/i.test(b));
  assert(/l\.status\s+in\s+\('cancelled',\s*'terminal'\)/i.test(b));
  assert(/q\.attempts\s*<\s*5/i.test(b), "retries are bounded");
  assert(/not_before/i.test(b), "a resumable mission waits out its backoff");
});

Deno.test("renewing a lineage lease never starts a new generation, and only the holder may renew", () => {
  const b = fn("renew_lineage_lease");
  assert(!/generation/i.test(b), "renewal must not touch `generation` (acquire does, on every call)");
  assert(/lease_holder\s+is\s+distinct\s+from\s+p_holder_task_id/i.test(b));
  assert(/status\s+in\s+\('terminal',\s*'cancelled'\)/i.test(b));
});

Deno.test("the heartbeat renews what the run holds and fails closed on ownership loss or cancellation", () => {
  const b = fn("heartbeat_lead_mission");
  assert(/claimed_by\s+is\s+distinct\s+from\s+p_worker_id/i.test(b));
  assert(/'mission_cancelled'/i.test(b));
  assert(/v_lstatus\s+in\s+\('cancelled',\s*'terminal'\)/i.test(b));
  assert(/update\s+public\.tasks\s+set\s+updated_at\s*=\s*now\(\)[\s\S]*status\s*=\s*'running'/i.test(b),
    "a live run must stay fresh for tasks_sweep_stuck_runs");
  assert(/continuation_claim_expires_at/i.test(b), "the handler's own resume claim is kept alive");
  assert(/renew_lineage_lease\(/i.test(b), "the lineage lease is renewed without a generation bump");
  assert(!/acquire_lineage_lease/i.test(b));
});

Deno.test("only the owning worker may bind or release, and a cancellation is never overwritten", () => {
  const bind = fn("bind_lead_mission_execution");
  assert(/claimed_by\s+is\s+distinct\s+from\s+p_worker_id/i.test(bind));
  assert(/'task_mismatch'/i.test(bind), "a mission executes on one task");
  const rel = fn("release_lead_mission");
  assert(/claimed_by\s+is\s+distinct\s+from\s+p_worker_id/i.test(rel));
  assert(/when\s+v_q\.status\s*=\s*'cancelled'\s+then\s+'cancelled'/i.test(rel));
});

Deno.test("every V2 function is callable by service_role only", () => {
  for (const name of [
    "renew_lineage_lease", "claim_next_lead_mission", "bind_lead_mission_execution",
    "heartbeat_lead_mission", "release_lead_mission", "cancel_lead_mission",
  ]) {
    assert(new RegExp(String.raw`revoke\s+all\s+on\s+function\s+public\.${name}\([^)]*\)\s+from\s+public,\s*anon,\s*authenticated`, "i").test(SQL), `${name}: revoke`);
    assert(new RegExp(String.raw`grant\s+execute\s+on\s+function\s+public\.${name}\([^)]*\)\s+to\s+service_role`, "i").test(SQL), `${name}: grant`);
  }
});
