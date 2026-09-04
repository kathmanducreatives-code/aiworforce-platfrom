// THE CLAIM GATE AND THE SPEND GATE MUST AGREE ON WHAT A DEAD LINEAGE IS.
//
// ── WHAT WAS OBSERVED ──────────────────────────────────────────────────────
//
// Lineage 8cfdfd10 was cancelled at 10:45 on 2026-09-04. At 12:03 — seventy
// eight minutes later — the sweeper claimed it again, for the twenty-sixth
// time. `checkpoint_version` had climbed to 26 while `lead_lineages.status`
// said `cancelled` throughout.
//
// `claim_sourcing_continuation` read `public.tasks` and nothing else. The
// cancellation fence put the decision on the LINEAGE row on purpose — a
// `terminal_status` written onto the task is a last-writer-wins field an
// in-flight slice overwrites, which is exactly how 2f3d9c5c escaped — so the
// task legitimately keeps `continuation_required` and stays claimable.
//
// No money was at risk: `acquire_lineage_lease` refuses a cancelled lineage and
// the ledger shows zero provider calls on 8cfdfd10 after cancellation. The cost
// was a sweeper slot every tick and a version counter climbing for no reason.
//
// Part of these tests read the MIGRATION rather than the database, like the
// cancellation fence suite they extend; the rest are real assertions about the
// TypeScript that renders the refusal.
//
// ZERO network, ZERO DB, ZERO spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLAIM_REFUSAL_MESSAGE,
  type ClaimRefusal,
} from "../../supabase/functions/_shared/continuationClaim.ts";

const ROOT = new URL("../../", import.meta.url);
const MIGRATION = "supabase/migrations/20260904120000_claim_fences_on_lineage_status.sql";
const sql = await Deno.readTextFile(new URL(MIGRATION, ROOT));

/** The body of one `create or replace function` block, lowercased. */
function fn(name: string): string {
  const i = sql.toLowerCase().indexOf(`function public.${name}(`);
  assert(i >= 0, `${name} must be defined in the migration`);
  const rest = sql.slice(i);
  const end = rest.toLowerCase().indexOf("$function$;");
  return rest.slice(0, end < 0 ? rest.length : end).toLowerCase();
}

const body = fn("claim_sourcing_continuation");

// ───────────────────────────── the fence itself ─────────────────────────────

Deno.test("THE CLAIM: a cancelled lineage is refused", () => {
  assert(
    /v_lineage_status\s*=\s*'cancelled'/.test(body),
    "the claim must refuse a cancelled lineage; without this the sweeper " +
      "re-claimed 8cfdfd10 twenty-six times",
  );
  assert(body.includes("lineage_cancelled"), "it must say WHY it refused");
});

Deno.test("a terminal lineage is refused too", () => {
  // The two gates agree on what a dead lineage is, or the disagreement is the
  // next bug. `acquire_lineage_lease` refuses both; so does this.
  assert(/v_lineage_status\s*=\s*'terminal'/.test(body));
});

Deno.test("the lineage is read from the LINEAGE table, not from the task", () => {
  // The whole point. A `terminal_status` on the task is a field an in-flight
  // slice overwrites — the 2f3d9c5c defect.
  assert(body.includes("from public.lead_lineages"), "must consult the lineage row");
  assert(
    /coalesce\(v_row\.lineage_id,\s*p_task_id\)/.test(body),
    "a root task is its own lineage; an unset lineage_id must still resolve",
  );
});

Deno.test("the lineage read is workspace-scoped", () => {
  const at = body.indexOf("from public.lead_lineages");
  const clause = body.slice(at, at + 260);
  assert(clause.includes("workspace_id"), "tenant isolation on the lineage read too");
});

Deno.test("the lineage is consulted under the task's lock", () => {
  // Read after `for update` and before any decision, so the claim cannot be
  // made on a lineage that changed status while it was being reasoned about.
  const lock = body.indexOf("for update");
  const read = body.indexOf("from public.lead_lineages");
  const update = body.indexOf("update public.tasks");
  assert(lock >= 0 && read > lock, "the lineage must be read INSIDE the lock");
  assert(read < update, "and before the claim is written");
});

Deno.test("the fence precedes the checkpoint and status reasoning", () => {
  // None of those questions is worth asking about a lineage somebody stopped.
  const fence = body.indexOf("v_lineage_status = 'cancelled'");
  const checkpoint = body.indexOf("'company_first_state' is null");
  assert(fence >= 0 && checkpoint >= 0);
  assert(fence < checkpoint, "the cancellation fence must come first");
});

Deno.test("an absent lineage row does not block a live run", () => {
  // Rows can be pruned. No lineage row means no opinion, never a silent block.
  assert(
    !/v_lineage_status\s+is\s+null/.test(body) ||
      !/v_lineage_status\s+is\s+null\s*then\s*\n?\s*return query select false/.test(body),
    "a missing lineage row must not refuse the claim",
  );
});

Deno.test("the claim still writes everything it used to", () => {
  // A rewrite that fences correctly and forgets to claim is not a fix.
  assert(body.includes("continuation_claim_id         = p_claim_id"));
  assert(body.includes("checkpoint_version            = public.tasks.checkpoint_version + 1"));
  assert(/status\s*=\s*'running'/.test(body));
  assert(body.includes("'claimed'::text"));
});

Deno.test("every pre-existing refusal survives", () => {
  for (
    const r of [
      "task_not_found",
      "workspace_mismatch",
      "no_checkpoint",
      "already_terminal",
      "not_resumable_state",
      "already_claimed",
    ]
  ) {
    assert(body.includes(r), `${r} must still be reachable`);
  }
});

// ──────────────────── the reason has to survive the round trip ──────────────

Deno.test("THE RENDERING: every RPC reason is narrowed, none falls to lost_race", () => {
  // The trap this closes: `narrowClaimRow` matches the RPC's reason against a
  // hardcoded list and falls back to `lost_race` — "Another continuation
  // started first" — for anything unlisted. A new refusal that is not added
  // there is rendered as a confident wrong answer.
  const ts = Deno.readTextFileSync(
    new URL("supabase/functions/_shared/continuationClaim.ts", ROOT),
  );

  // THE NARROWING LIST ITSELF, not the file. An earlier version of this test
  // searched the whole module — and passed while the reason was removed from
  // the list, because the type union and the message map still mentioned it.
  // The list is the only thing that decides what `lost_race` swallows.
  const listMatch = ts.match(
    /const reason = \(\[([^\]]*)\] as const\)\s*\n?\s*\.find\(\(r\) => r === row\.reason\)/,
  );
  assert(listMatch, "could not find the narrowing list — has narrowClaimRow moved?");
  const narrowed = [...listMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  // Every reason string the migration can return...
  const emitted = [...body.matchAll(/'([a-z_]+)'::text/g)]
    .map((m) => m[1])
    .filter((r) => r !== "claimed");

  assert(emitted.length >= 6, `expected the refusal vocabulary, got ${emitted}`);
  for (const r of emitted) {
    assert(
      narrowed.includes(r),
      `the RPC can return "${r}" but the narrowing list is [${narrowed.join(", ")}], ` +
        `so it falls through to lost_race — "Another continuation started first", ` +
        `a confident wrong answer`,
    );
  }
});

Deno.test("lineage_cancelled has its own message and does not borrow another", () => {
  const msg = CLAIM_REFUSAL_MESSAGE["lineage_cancelled" as ClaimRefusal];
  assert(msg, "a refusal with no message is a blank screen");
  assertEquals(
    msg,
    "That run was cancelled.",
    "a cancelled run must not be described as finished or as a lost race",
  );
  assert(
    msg !== CLAIM_REFUSAL_MESSAGE.already_terminal,
    "'someone stopped this' and 'this finished' are different facts",
  );
});
