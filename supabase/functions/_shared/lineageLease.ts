// THE RIGHT TO EXECUTE A LINEAGE, HELD BY EXACTLY ONE GENERATION.
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
//
// Nothing. That is the problem. `claim_sourcing_continuation` is an excellent
// lease — `SELECT … FOR UPDATE`, a bounded expiry, explicit refusals — and it is
// keyed on ONE TASK. The continuation path that runs in production creates a NEW
// task, so it contends with nothing and the lease is bypassed entirely.
//
// On 2026-08-29 three generations of one request executed concurrently and bought
// provider work simultaneously between 11:13:21 and 11:14:04. The parent verified
// three companies at 11:14:07 — sixty-six seconds AFTER its own continuation had
// started from a checkpoint that predated the verification. That evidence was
// never read again.
//
// ── THE SHAPE ──────────────────────────────────────────────────────────────
//
// Pure decisions here, the database does the serialising. Two RPCs
// (`acquire_lineage_lease`, `release_lineage_lease`) take the row lock and
// compare-and-swap the state; this module classifies their answers and decides
// what a caller may do with them. Same division as `continuationClaim.ts`, and
// for the same reason: the policy has to be testable without a database.
//
// ── ROLLOUT ────────────────────────────────────────────────────────────────
//
// `LINEAGE_LEASE_ENFORCED` defaults to FALSE. Unset, every caller still acquires
// and still logs what it WOULD have refused, and refuses nothing. That is
// deliberate: the refusal this introduces is the first thing in the system that
// can stop a user's Continue from running, and it should be observed against real
// traffic before it is given that power.

import { classifyClaimError, type ClaimErrorCategory } from "./continuationClaim.ts";

export const LINEAGE_LEASE_VERSION = "lineage-lease-v1" as const;

/**
 * How long one generation may hold the lease.
 *
 * ABOVE the engine's own budget and BELOW anything a human would wait. The Edge
 * wall clock is 150s on the current plan (`EDGE_WALL_CLOCK_MS`), and the engine
 * reserves 25s of it, so 180s covers a full invocation plus its finalization
 * with room to spare. Shorter would let a live generation lose its own lease
 * mid-run; much longer would strand a lineage behind a killed isolate.
 */
export const LINEAGE_LEASE_SECONDS = 180;

export const LINEAGE_LEASE_ENFORCED_ENV = "LINEAGE_LEASE_ENFORCED";

export type EnvReader = (key: string) => string | undefined;

/**
 * Is the lease allowed to REFUSE, or only to observe?
 *
 * Defaults to observe. Only the exact string "true" turns enforcement on — a
 * typo'd value must not silently arm a gate that can refuse a user's request.
 */
export function lineageLeaseEnforced(read?: EnvReader): boolean {
  const get: EnvReader = read ?? ((k) => {
    try { return Deno.env.get(k); } catch { return undefined; }
  });
  return String(get(LINEAGE_LEASE_ENFORCED_ENV) ?? "").trim().toLowerCase() === "true";
}

// ------------------------------------------------------------------ lineage ----

export const LINEAGE_ROOT_KEY = "lead_resume_lineage_root";

/**
 * Which lineage does this task belong to?
 *
 * Every run already records `result.lead_resume_lineage_root`, so this reads an
 * existing fact rather than inventing one — which is also why `lineage_id` is
 * the ROOT TASK ID: historical rows map onto the new table with no guessing.
 *
 * A task with no recorded root IS its own root. That is not a fallback, it is
 * the definition: the first generation of a lineage has nothing before it.
 */
export function lineageRootOf(
  taskId: string, result: Record<string, unknown> | null | undefined,
): string {
  const recorded = (result ?? {})[LINEAGE_ROOT_KEY];
  return typeof recorded === "string" && recorded.length > 0 ? recorded : taskId;
}

// ------------------------------------------------------------------ acquire ----

export type LeaseRefusal =
  | "already_leased"
  | "already_terminal"
  | "mission_mismatch"
  | "workspace_mismatch"
  | "lineage_not_found"
  | "invalid_arguments"
  | "lease_unavailable"
  | "not_permitted";

export interface LeaseGranted {
  acquired: true;
  /** The version the caller READ. Its write must quote this back. */
  stateVersion: number;
  currentState: Record<string, unknown> | null;
  generation: number;
  heldUntil: string | null;
}

export interface LeaseRefused {
  acquired: false;
  reason: LeaseRefusal;
  heldBy: string | null;
  heldUntil: string | null;
  category: ClaimErrorCategory | "conflict";
}

/**
 * The RPC is absent — the migration has not been applied.
 *
 * DISTINCT FROM A REFUSAL, and it must stay distinct. Before the migration
 * lands, every caller has to proceed exactly as it does today; treating a
 * missing function as "somebody else holds the lease" would refuse every
 * continuation in the system the moment this code deployed.
 */
export interface LeaseUnavailable {
  acquired: false;
  reason: "migration_absent";
  available: false;
}

export type LeaseOutcome = LeaseGranted | LeaseRefused | LeaseUnavailable;

export interface RpcDb {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

const REFUSALS: readonly LeaseRefusal[] = [
  "already_leased", "already_terminal", "mission_mismatch",
  "workspace_mismatch", "lineage_not_found", "invalid_arguments",
];

interface AcquireRow {
  acquired?: boolean; reason?: string; state_version?: number;
  current_state?: unknown; generation?: number;
  held_by?: string | null; held_until?: string | null;
}

export async function acquireLineageLease(args: {
  db: RpcDb;
  lineageId: string;
  workspaceId: string;
  holderTaskId: string;
  missionHash?: string | null;
  leaseSeconds?: number;
}): Promise<LeaseOutcome> {
  let res: { data: unknown; error: unknown };
  try {
    res = await args.db.rpc("acquire_lineage_lease", {
      p_lineage_id: args.lineageId,
      p_workspace_id: args.workspaceId,
      p_holder_task_id: args.holderTaskId,
      p_mission_hash: args.missionHash ?? null,
      p_lease_seconds: Math.max(30, Math.floor(args.leaseSeconds ?? LINEAGE_LEASE_SECONDS)),
    });
  } catch (e) {
    // A TRANSPORT failure is not evidence the function is missing. Fail closed:
    // if we cannot establish that we hold the lease, we do not hold it.
    return {
      acquired: false, reason: "lease_unavailable", heldBy: null, heldUntil: null,
      category: "transport",
    };
  }

  const err = res.error as { code?: string; message?: string } | null;
  if (err) {
    const category = classifyClaimError(err);
    if (category === "missing_function") {
      return { acquired: false, reason: "migration_absent", available: false };
    }
    return {
      acquired: false,
      reason: category === "permission" ? "not_permitted" : "lease_unavailable",
      heldBy: null, heldUntil: null, category,
    };
  }

  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as AcquireRow | undefined;
  if (!row || typeof row.acquired !== "boolean") {
    // An unexpected shape is NOT "unavailable" — the function may well have run
    // and granted the lease to somebody. Assuming otherwise could double-execute.
    return {
      acquired: false, reason: "lease_unavailable", heldBy: null, heldUntil: null,
      category: "unexpected_response",
    };
  }

  if (row.acquired) {
    return {
      acquired: true,
      stateVersion: typeof row.state_version === "number" ? row.state_version : 0,
      currentState: (row.current_state ?? null) as Record<string, unknown> | null,
      generation: typeof row.generation === "number" ? row.generation : 0,
      heldUntil: row.held_until ?? null,
    };
  }

  const reason = REFUSALS.find((r) => r === row.reason) ?? "lease_unavailable";
  return {
    acquired: false, reason,
    heldBy: row.held_by ?? null, heldUntil: row.held_until ?? null,
    category: "conflict",
  };
}

// ------------------------------------------------------------------ release ----

export type ReleaseRefusal =
  | "version_conflict"
  | "not_lease_holder"
  | "workspace_mismatch"
  | "lineage_not_found"
  | "release_unavailable";

export type ReleaseOutcome =
  | { released: true; stateVersion: number }
  | { released: false; reason: ReleaseRefusal; stateVersion: number | null }
  | { released: false; reason: "migration_absent"; available: false };

interface ReleaseRow {
  released?: boolean; reason?: string; state_version?: number;
}

/**
 * End the generation.
 *
 * CALLED IN FINALIZATION, after the engine has returned — never at the moment a
 * terminal status is composed. That ordering IS the completion barrier: while
 * this has not run, the generation is still live and no successor may start.
 *
 * `expectedVersion` is the version `acquireLineageLease` handed back. A
 * `version_conflict` means something else advanced the lineage while this
 * generation ran, and the caller must re-read and MERGE rather than write over
 * it. Merging belongs to the caller because only the engine knows that company
 * evidence is monotonic — a merge may add rows or upgrade a verdict, and may
 * never downgrade a company that was verified with citations.
 */
export async function releaseLineageLease(args: {
  db: RpcDb;
  lineageId: string;
  workspaceId: string;
  holderTaskId: string;
  expectedVersion: number;
  nextState?: Record<string, unknown> | null;
  terminalReason?: string | null;
  madeProgress?: boolean;
}): Promise<ReleaseOutcome> {
  let res: { data: unknown; error: unknown };
  try {
    res = await args.db.rpc("release_lineage_lease", {
      p_lineage_id: args.lineageId,
      p_workspace_id: args.workspaceId,
      p_holder_task_id: args.holderTaskId,
      p_expected_version: args.expectedVersion,
      p_next_state: args.nextState ?? null,
      p_terminal_reason: args.terminalReason ?? null,
      p_made_progress: args.madeProgress === true,
    });
  } catch {
    return { released: false, reason: "release_unavailable", stateVersion: null };
  }

  const err = res.error as { code?: string; message?: string } | null;
  if (err) {
    if (classifyClaimError(err) === "missing_function") {
      return { released: false, reason: "migration_absent", available: false };
    }
    return { released: false, reason: "release_unavailable", stateVersion: null };
  }

  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as ReleaseRow | undefined;
  if (!row || typeof row.released !== "boolean") {
    return { released: false, reason: "release_unavailable", stateVersion: null };
  }
  if (row.released) {
    return { released: true, stateVersion: typeof row.state_version === "number" ? row.state_version : 0 };
  }
  const reason = (["version_conflict", "not_lease_holder", "workspace_mismatch", "lineage_not_found"] as const)
    .find((r) => r === row.reason) ?? "release_unavailable";
  return { released: false, reason, stateVersion: row.state_version ?? null };
}

// --------------------------------------------------------------------- read ----

export interface LineageSnapshot {
  exists: boolean;
  /** A lease that has not expired. */
  leased: boolean;
  heldBy: string | null;
  heldUntil: string | null;
  status: "active" | "running" | "terminal" | null;
  stateVersion: number | null;
}

export interface SelectDb {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
}

/**
 * Is this lineage currently being executed?
 *
 * ADVISORY ONLY, and deliberately so. The authority is `acquire_lineage_lease`
 * plus the `tasks_one_live_generation_per_lineage` index — this exists so a
 * caller that is about to CREATE work can refuse early with a sentence a person
 * can act on, rather than creating a plan and a task that the executor will then
 * refuse. A read cannot be a guarantee; two callers can both read "free" and
 * both proceed, and the acquire is what resolves that.
 *
 * Absent row, absent table, or any error ⇒ `exists: false, leased: false`. The
 * caller then behaves exactly as it does today, which is what keeps this safe to
 * deploy before the migration.
 */
export async function readLineageLease(
  db: SelectDb, lineageId: string, now: number = Date.now(),
): Promise<LineageSnapshot> {
  const absent: LineageSnapshot = {
    exists: false, leased: false, heldBy: null, heldUntil: null,
    status: null, stateVersion: null,
  };
  let res: { data: unknown; error: unknown };
  try {
    res = await db.from("lead_lineages")
      .select("lineage_id, lease_holder, lease_expires_at, status, state_version")
      .eq("lineage_id", lineageId).maybeSingle();
  } catch {
    return absent;
  }
  if (res.error || !res.data) return absent;
  const r = res.data as {
    lease_holder?: string | null; lease_expires_at?: string | null;
    status?: string | null; state_version?: number | null;
  };
  const expiresAt = r.lease_expires_at ? Date.parse(r.lease_expires_at) : NaN;
  return {
    exists: true,
    leased: !!r.lease_holder && Number.isFinite(expiresAt) && expiresAt > now,
    heldBy: r.lease_holder ?? null,
    heldUntil: r.lease_expires_at ?? null,
    status: (r.status ?? null) as LineageSnapshot["status"],
    stateVersion: typeof r.state_version === "number" ? r.state_version : null,
  };
}

// -------------------------------------------------------------- the decision ----

export interface LeaseGate {
  /** May this generation execute? */
  proceed: boolean;
  /** What the caller should tell the user. Null when proceeding. */
  refusal: LeaseRefusal | null;
  /** True when the lease WOULD have refused but enforcement is off. */
  shadowed: boolean;
  /** Always logged, enforced or not. */
  observation: {
    version: typeof LINEAGE_LEASE_VERSION;
    enforced: boolean;
    outcome: "acquired" | "refused" | "migration_absent";
    reason: string;
    held_by: string | null;
    held_until: string | null;
  };
}

/**
 * Turn a lease outcome into a decision, honouring shadow mode.
 *
 * Pure, so the rollout policy is testable without a database — and so the one
 * question that matters ("would this have been refused?") is answerable from the
 * log on day one, before enforcement is armed.
 */
export function decideLeaseGate(outcome: LeaseOutcome, enforced: boolean): LeaseGate {
  // `available` exists ONLY on `LeaseUnavailable`, so its presence is the
  // discriminant. Comparing its value as well reads as more careful and is
  // actually less: it stops the compiler narrowing the union, which is how the
  // "migration absent" branch and the "refused" branch could drift apart.
  if ("available" in outcome) {
    // The migration has not landed. Behave exactly as the system does today.
    return {
      proceed: true, refusal: null, shadowed: false,
      observation: {
        version: LINEAGE_LEASE_VERSION, enforced, outcome: "migration_absent",
        reason: "acquire_lineage_lease is not present", held_by: null, held_until: null,
      },
    };
  }

  if (outcome.acquired) {
    return {
      proceed: true, refusal: null, shadowed: false,
      observation: {
        version: LINEAGE_LEASE_VERSION, enforced, outcome: "acquired",
        reason: "acquired", held_by: null, held_until: outcome.heldUntil,
      },
    };
  }

  return {
    // SHADOW MODE PROCEEDS. It observes; it does not govern.
    proceed: !enforced,
    refusal: enforced ? outcome.reason : null,
    shadowed: !enforced,
    observation: {
      version: LINEAGE_LEASE_VERSION, enforced, outcome: "refused",
      reason: outcome.reason, held_by: outcome.heldBy, held_until: outcome.heldUntil,
    },
  };
}

/** What a refused caller should say. Never leaks a task id to a user. */
export const LEASE_REFUSAL_MESSAGE: Readonly<Record<LeaseRefusal, string>> = Object.freeze({
  already_leased:
    "This request is already running. It will continue on its own — starting it " +
    "again would pay for the same work twice.",
  already_terminal:
    "This request has already finished. Start a new one to search again.",
  mission_mismatch:
    "That continuation belongs to a different request.",
  workspace_mismatch: "That run belongs to another workspace.",
  lineage_not_found: "That run could not be found.",
  invalid_arguments: "That continuation request was incomplete.",
  lease_unavailable:
    "Could not confirm whether this request is already running, so it was not " +
    "started again. Try once more in a moment.",
  not_permitted: "You do not have permission to continue this run.",
});
