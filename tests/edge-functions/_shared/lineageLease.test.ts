// THE LEASE THAT WOULD HAVE STOPPED 2026-08-29.
//
// The failure these tests encode, from production:
//
//   11:12:06  task A starts
//   11:13:03  A composes a terminal status and renders a Continue card
//             — WHILE STILL EXECUTING
//   11:13:10  child B created from A's checkpoint
//   11:13:12  B renders its OWN Continue card, 1s after starting
//   11:13:19  grandchild C created from B's checkpoint
//   11:13:21  A, B and C are all buying from Apify at the same time
//   11:14:07  A verifies three companies — evidence no descendant ever reads
//
// Every test below is either a rule that makes that sequence impossible, or a
// rule that keeps the rollout safe while it is being introduced.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LINEAGE_LEASE_SECONDS,
  acquireLineageLease,
  decideLeaseGate,
  lineageLeaseEnforced,
  lineageRootOf,
  releaseLineageLease,
  type LeaseOutcome,
  type RpcDb,
} from "../../../supabase/functions/_shared/lineageLease.ts";

// ── A FAKE THAT IMPLEMENTS THE REAL RULES ───────────────────────────────────
//
// Not a stub returning canned rows. This mirrors `acquire_lineage_lease` /
// `release_lineage_lease` closely enough that a race against it is a real race:
// one row, one holder, an expiry, and a compare-and-swap on the version. A stub
// could not tell us that two simultaneous Continue clicks resolve to one winner,
// which is the whole point of the mechanism.

interface Row {
  lineage_id: string; workspace_id: string; mission_hash: string | null;
  state_version: number; current_state: Record<string, unknown> | null;
  lease_holder: string | null; lease_expires_at: number | null;
  generation: number; status: "active" | "running" | "terminal";
  terminal_reason: string | null; last_progress_at: number | null;
}

class FakeLineageDb implements RpcDb {
  rows = new Map<string, Row>();
  now: number;
  constructor(now = 1_000_000) { this.now = now; }

  // deno-lint-ignore require-await
  async rpc(fn: string, a: Record<string, unknown>) {
    if (fn === "acquire_lineage_lease") return { data: [this.acquire(a)], error: null };
    if (fn === "release_lineage_lease") return { data: [this.release(a)], error: null };
    return { data: null, error: { code: "42883", message: "function does not exist" } };
  }

  private acquire(a: Record<string, unknown>) {
    const id = String(a.p_lineage_id);
    const ws = String(a.p_workspace_id);
    const holder = String(a.p_holder_task_id);
    const mission = (a.p_mission_hash ?? null) as string | null;
    const secs = Math.max(30, Number(a.p_lease_seconds ?? LINEAGE_LEASE_SECONDS));

    if (!this.rows.has(id)) {
      this.rows.set(id, {
        lineage_id: id, workspace_id: ws, mission_hash: mission,
        state_version: 0, current_state: null, lease_holder: null,
        lease_expires_at: null, generation: 0, status: "active",
        terminal_reason: null, last_progress_at: null,
      });
    }
    const r = this.rows.get(id)!;
    const no = (reason: string, held = false) => ({
      acquired: false, reason, state_version: r.state_version, current_state: null,
      generation: r.generation,
      held_by: held ? r.lease_holder : null,
      held_until: held && r.lease_expires_at ? new Date(r.lease_expires_at).toISOString() : null,
    });

    if (r.workspace_id !== ws) return no("workspace_mismatch");
    if (r.status === "terminal") return no("already_terminal");
    if (r.lease_holder && r.lease_expires_at && r.lease_expires_at > this.now &&
        r.lease_holder !== holder) return no("already_leased", true);
    if (mission && r.mission_hash && r.mission_hash !== mission) return no("mission_mismatch");

    const read = { version: r.state_version, state: r.current_state };
    r.lease_holder = holder;
    r.lease_expires_at = this.now + secs * 1000;
    r.generation += 1;
    r.status = "running";
    r.mission_hash = r.mission_hash ?? mission;
    return {
      acquired: true, reason: "acquired", state_version: read.version,
      current_state: read.state, generation: r.generation,
      held_by: holder, held_until: new Date(r.lease_expires_at).toISOString(),
    };
  }

  private release(a: Record<string, unknown>) {
    const r = this.rows.get(String(a.p_lineage_id));
    if (!r) return { released: false, reason: "lineage_not_found", state_version: null };
    if (r.workspace_id !== String(a.p_workspace_id)) {
      return { released: false, reason: "workspace_mismatch", state_version: r.state_version };
    }
    if (r.lease_holder !== String(a.p_holder_task_id)) {
      return { released: false, reason: "not_lease_holder", state_version: r.state_version };
    }
    const next = (a.p_next_state ?? null) as Record<string, unknown> | null;
    if (next !== null && r.state_version !== Number(a.p_expected_version)) {
      return { released: false, reason: "version_conflict", state_version: r.state_version };
    }
    if (next !== null) { r.current_state = next; r.state_version += 1; }
    r.lease_holder = null;
    r.lease_expires_at = null;
    const terminal = (a.p_terminal_reason ?? null) as string | null;
    r.status = terminal ? "terminal" : "active";
    r.terminal_reason = terminal ?? r.terminal_reason;
    if (a.p_made_progress === true) r.last_progress_at = this.now;
    return { released: true, reason: "released", state_version: r.state_version };
  }
}

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const LINEAGE = "06d3544a-7ff4-483d-8d92-362ce1981e69";
const TASK_A = "06d3544a-7ff4-483d-8d92-362ce1981e69";
const TASK_B = "237717dd-0084-4e94-93ac-a352a8873af0";
const TASK_C = "0ed83116-88d4-45f3-9c6e-e240c037d892";

const base = { workspaceId: WS, lineageId: LINEAGE };

// ── lineage identity ────────────────────────────────────────────────────────

Deno.test("a task with no recorded root IS its own root", () => {
  assertEquals(lineageRootOf(TASK_A, {}), TASK_A);
  assertEquals(lineageRootOf(TASK_A, null), TASK_A);
});

Deno.test("every descendant resolves to the SAME lineage as its root", () => {
  // The production rows: B and C both carry A's id. Without this they are three
  // unrelated runs, which is exactly how they behaved.
  const recorded = { lead_resume_lineage_root: TASK_A };
  assertEquals(lineageRootOf(TASK_B, recorded), TASK_A);
  assertEquals(lineageRootOf(TASK_C, recorded), TASK_A);
  assertEquals(lineageRootOf(TASK_A, recorded), TASK_A);
});

// ── rollout safety ──────────────────────────────────────────────────────────

Deno.test("enforcement is OFF unless the flag says exactly 'true'", () => {
  assertEquals(lineageLeaseEnforced(() => undefined), false);
  assertEquals(lineageLeaseEnforced(() => ""), false);
  assertEquals(lineageLeaseEnforced(() => "1"), false);
  assertEquals(lineageLeaseEnforced(() => "yes"), false);
  assertEquals(lineageLeaseEnforced(() => "TRUE"), true);
  assertEquals(lineageLeaseEnforced(() => " true "), true);
});

Deno.test("shadow mode OBSERVES a refusal and still proceeds", () => {
  const refused: LeaseOutcome = {
    acquired: false, reason: "already_leased", heldBy: TASK_A,
    heldUntil: "2026-08-29T11:16:00Z", category: "conflict",
  };
  const shadow = decideLeaseGate(refused, false);
  assertEquals(shadow.proceed, true);
  assertEquals(shadow.refusal, null);
  assertEquals(shadow.shadowed, true);
  assertEquals(shadow.observation.outcome, "refused");
  assertEquals(shadow.observation.reason, "already_leased");
  assertEquals(shadow.observation.held_by, TASK_A);
});

Deno.test("enforced mode REFUSES the same outcome", () => {
  const refused: LeaseOutcome = {
    acquired: false, reason: "already_leased", heldBy: TASK_A,
    heldUntil: null, category: "conflict",
  };
  const gate = decideLeaseGate(refused, true);
  assertEquals(gate.proceed, false);
  assertEquals(gate.refusal, "already_leased");
  assertEquals(gate.shadowed, false);
});

Deno.test("A MISSING MIGRATION MUST NOT REFUSE ANYTHING", async () => {
  // Deploying this code before the migration lands must change nothing. The
  // opposite — treating an absent function as a held lease — would refuse every
  // continuation in the system the moment it shipped.
  const db: RpcDb = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42883", message: "does not exist" } }),
  };
  const outcome = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(outcome.acquired, false);
  assert("available" in outcome && outcome.available === false);
  for (const enforced of [false, true]) {
    const gate = decideLeaseGate(outcome, enforced);
    assertEquals(gate.proceed, true, `must proceed when enforced=${enforced}`);
    assertEquals(gate.observation.outcome, "migration_absent");
  }
});

Deno.test("a TRANSPORT failure fails CLOSED — unproven is not held", async () => {
  // The opposite of the rule above, and the distinction matters: a missing
  // function is a known state, a dead connection is not. If we cannot establish
  // that we hold the lease, we do not hold it.
  const db: RpcDb = { rpc: () => Promise.reject(new Error("ECONNRESET")) };
  const outcome = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(outcome.acquired, false);
  assert(!("available" in outcome));
  assertEquals(decideLeaseGate(outcome, true).proceed, false);
});

Deno.test("an unexpected response shape is a refusal, never 'unavailable'", async () => {
  // The function may well have run and granted the lease to somebody else.
  const db: RpcDb = { rpc: () => Promise.resolve({ data: { nonsense: true }, error: null }) };
  const outcome = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(outcome.acquired, false);
  assert(!("available" in outcome), "must not degrade to the unenforced path");
});

Deno.test("a permission error is reported as such, not as a conflict", async () => {
  const db: RpcDb = {
    rpc: () => Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } }),
  };
  const outcome = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(!outcome.acquired);
  assert("reason" in outcome && outcome.reason === "not_permitted");
});

// ── THE RACE ────────────────────────────────────────────────────────────────

Deno.test("TWO CONTINUATIONS OF ONE LINEAGE: EXACTLY ONE WINS", async () => {
  const db = new FakeLineageDb();
  const [first, second] = await Promise.all([
    acquireLineageLease({ db, ...base, holderTaskId: TASK_B }),
    acquireLineageLease({ db, ...base, holderTaskId: TASK_C }),
  ]);
  const won = [first, second].filter((o) => o.acquired);
  const lost = [first, second].filter((o) => !o.acquired);
  assertEquals(won.length, 1);
  assertEquals(lost.length, 1);
  assert("reason" in lost[0] && lost[0].reason === "already_leased");
});

Deno.test("THE PRODUCTION SEQUENCE IS NOW IMPOSSIBLE — A, then B, then C", async () => {
  const db = new FakeLineageDb();

  // 11:12:06 — A starts and holds the lease.
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  assert(a.acquired);

  // 11:13:10 — B tries to continue while A is still executing. This is the
  // moment the whole failure hinges on.
  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(b.acquired, false);
  assert("reason" in b && b.reason === "already_leased");
  assertEquals(decideLeaseGate(b, true).proceed, false);

  // 11:13:19 — C tries too. Also refused.
  const c = await acquireLineageLease({ db, ...base, holderTaskId: TASK_C });
  assertEquals(c.acquired, false);

  // 11:14:22 — A finishes and writes the evidence it earned.
  const verified = { hiring_verified: 3, companies: ["blue-signal", "storm3", "storm4"] };
  const rel = await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A,
    expectedVersion: (a as { stateVersion: number }).stateVersion,
    nextState: verified, madeProgress: true,
  });
  assert(rel.released);

  // Only NOW may B continue — and it reads what A actually produced.
  const b2 = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(b2.acquired);
  assertEquals((b2 as { currentState: Record<string, unknown> }).currentState, verified);
});

Deno.test("THE SAME HOLDER RENEWS ITS OWN LEASE RATHER THAN DEADLOCKING", async () => {
  const db = new FakeLineageDb();
  const first = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  assert(first.acquired);
  const again = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  assert(again.acquired, "a task must be able to re-acquire the lease it already holds");
});

Deno.test("AN EXPIRED LEASE IS RECLAIMABLE — a killed isolate cannot strand a lineage", async () => {
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  assert(a.acquired);

  // The isolate dies. Nothing releases the lease.
  db.now += (LINEAGE_LEASE_SECONDS + 1) * 1000;

  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(b.acquired, "an expired lease must be reclaimable");
});

Deno.test("A DEAD GENERATION CANNOT WRITE OVER THE ONE THAT REPLACED IT", async () => {
  // The other half of expiry. A reclaims, dies, B takes over — and then A's
  // isolate wakes up and tries to finalize. Its write must be refused, or expiry
  // would reintroduce exactly the stale-overwrite it was meant to prevent.
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  assert(a.acquired);
  db.now += (LINEAGE_LEASE_SECONDS + 1) * 1000;
  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(b.acquired);

  const zombie = await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A,
    expectedVersion: (a as { stateVersion: number }).stateVersion,
    nextState: { hiring_verified: 0 },
  });
  assertEquals(zombie.released, false);
  assert("reason" in zombie && zombie.reason === "not_lease_holder");
});

Deno.test("A STALE VERSION CANNOT OVERWRITE — the compare-and-swap holds", async () => {
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  const readVersion = (a as { stateVersion: number }).stateVersion;

  await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A, expectedVersion: readVersion,
    nextState: { hiring_verified: 3 }, madeProgress: true,
  });
  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(b.acquired);

  // B quotes the version A read, not the one it was handed. Refused.
  const stale = await releaseLineageLease({
    db, ...base, holderTaskId: TASK_B, expectedVersion: readVersion,
    nextState: { hiring_verified: 0 },
  });
  assertEquals(stale.released, false);
  assert("reason" in stale && stale.reason === "version_conflict");

  // And the good evidence is still there.
  const c = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(
    (c as { currentState: Record<string, unknown> }).currentState,
    { hiring_verified: 3 },
  );
});

Deno.test("a terminal lineage refuses every further generation", async () => {
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A,
    expectedVersion: (a as { stateVersion: number }).stateVersion,
    nextState: { done: true }, terminalReason: "satisfied", madeProgress: true,
  });
  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assertEquals(b.acquired, false);
  assert("reason" in b && b.reason === "already_terminal");
});

Deno.test("a different mission may not adopt this lineage's paid state", async () => {
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({
    db, ...base, holderTaskId: TASK_A, missionHash: "d3d0dc96",
  });
  assert(a.acquired);
  await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A,
    expectedVersion: (a as { stateVersion: number }).stateVersion, nextState: {},
  });
  const other = await acquireLineageLease({
    db, ...base, holderTaskId: TASK_B, missionHash: "deadbeef",
  });
  assertEquals(other.acquired, false);
  assert("reason" in other && other.reason === "mission_mismatch");
});

Deno.test("a release that writes no state still ends the generation", async () => {
  // A generation that produced nothing must still hand back the lease, or one
  // barren slice would strand the lineage until the lease expired.
  const db = new FakeLineageDb();
  const a = await acquireLineageLease({ db, ...base, holderTaskId: TASK_A });
  const rel = await releaseLineageLease({
    db, ...base, holderTaskId: TASK_A,
    expectedVersion: (a as { stateVersion: number }).stateVersion,
  });
  assert(rel.released);
  const b = await acquireLineageLease({ db, ...base, holderTaskId: TASK_B });
  assert(b.acquired);
});

// ── READING THE LEASE ───────────────────────────────────────────────────────

interface SelectRow { data: unknown; error: unknown }
function selectDb(row: SelectRow) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(row) }) }),
    }),
  } as unknown as import("../../../supabase/functions/_shared/lineageLease.ts").SelectDb;
}

Deno.test("an ABSENT TABLE reads as not-leased — inert before the migration", async () => {
  const { readLineageLease: read } = await import(
    "../../../supabase/functions/_shared/lineageLease.ts");
  const snap = await read(
    selectDb({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
    LINEAGE);
  assertEquals(snap.exists, false);
  assertEquals(snap.leased, false);
});

Deno.test("a LIVE lease reads as leased; an EXPIRED one does not", async () => {
  const { readLineageLease: read } = await import(
    "../../../supabase/functions/_shared/lineageLease.ts");
  const now = Date.parse("2026-08-29T11:13:10Z");
  const live = await read(selectDb({
    data: {
      lease_holder: TASK_A, lease_expires_at: "2026-08-29T11:16:00Z",
      status: "running", state_version: 1,
    }, error: null,
  }), LINEAGE, now);
  assertEquals(live.leased, true);
  assertEquals(live.heldBy, TASK_A);

  const expired = await read(selectDb({
    data: {
      lease_holder: TASK_A, lease_expires_at: "2026-08-29T11:10:00Z",
      status: "running", state_version: 1,
    }, error: null,
  }), LINEAGE, now);
  assertEquals(expired.exists, true);
  assertEquals(expired.leased, false, "an expired lease holds nothing");
});

Deno.test("a row with no holder is not leased", async () => {
  const { readLineageLease: read } = await import(
    "../../../supabase/functions/_shared/lineageLease.ts");
  const snap = await read(selectDb({
    data: { lease_holder: null, lease_expires_at: null, status: "active", state_version: 3 },
    error: null,
  }), LINEAGE);
  assertEquals(snap.exists, true);
  assertEquals(snap.leased, false);
  assertEquals(snap.stateVersion, 3);
});

// ── WHERE THE LEASE IS TAKEN AND GIVEN BACK ─────────────────────────────────
//
// Source-level pins. The ORDERING is the guarantee — acquired before any paid
// boundary, released only after the result row is written and before anything is
// dispatched — and ordering is not observable from a unit test of either
// function. On 2026-08-29 the terminal status was composed 80s before the
// invocation ended, and every guard downstream inherited that lie; these assert
// the new lifecycle points sit where they must.

const SRC = new URL("../../../supabase/functions/", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, SRC));

Deno.test("run-agent ACQUIRES before any provider call and RELEASES after the result write", () => {
  const s = read("run-agent/index.ts");
  const acquire = s.indexOf("acquireLineageLease({");
  const release = s.indexOf("releaseLineageLease({");
  const bind = s.indexOf("terminalGuard.bind({");
  const dispatch = s.indexOf("dispatchOutcome = await dispatchContinuation({");
  assert(acquire > 0 && release > 0, "both lifecycle points must exist");
  assert(bind < acquire, "the lease is taken once a task id exists");
  assert(acquire < release, "acquire precedes release");
  assert(
    release < dispatch,
    "THE COMPLETION BARRIER: the lineage is released before a successor is dispatched",
  );
});

Deno.test("run-agent quotes back the version it read — the CAS cannot be skipped", () => {
  const s = read("run-agent/index.ts");
  assert(/expectedVersion:\s*leaseVersion/.test(s),
    "the release must quote the version the acquire returned");
  assert(/const leaseVersion = leaseOutcome\.acquired/.test(s),
    "the version must come from the acquire, never from a re-read");
});

Deno.test("every dispatcher consults the lineage before creating work", () => {
  for (const f of ["continue-workflow/index.ts", "resume-stalled-leads/index.ts"]) {
    const s = read(f);
    assert(s.includes("readLineageLease("), `${f} must consult the lineage`);
    assert(s.includes("lineageLeaseEnforced("), `${f} must honour shadow mode`);
  }
});

Deno.test("continue-workflow writes the idempotency key to the COLUMN, not just the jsonb", () => {
  // The key was always computed and always discarded into `plan`, where no index
  // could see it. `task_plans_idempotency_uniq` covers the column.
  const s = read("continue-workflow/index.ts");
  assert(/idempotency_key:\s*spec\.idempotency_key,/.test(s),
    "the key must be written as a column value");
  assert(s.includes('"23505"'),
    "a unique-violation is the mechanism working and must be handled, not surfaced as a 500");
});
