// WHO MAY UNLOCK WHAT, AND FOR HOW MUCH — decided before anything is spent.
//
// Every rule here is a refusal that happens BEFORE the reservation, because the
// cheapest failed unlock is the one that never reserved. The module is pure so
// each rule is unit-tested without a database, a provider or a model.
//
// THE IDEMPOTENCY KEY IS DERIVED, NOT ACCEPTED.
//
// The obvious shape is a client-supplied nonce. It is wrong here: a caller who
// reuses a key gets `replayed: true` from the ledger — no second charge — and
// if the function then ran the provider anyway, that is a free second provider
// run for anyone who replays a request. Deriving the key from
// (task, company, kind) makes the second call a replay BY CONSTRUCTION: the
// stored result is returned, no provider runs, nothing is charged twice, and
// the client has no field with which to ask for anything else.
//
// PURE. No network, no database, no provider, no model.

import { isUnlockKind, unlockPrice, type UnlockKind } from "./pricing.ts";

export const UNLOCK_CONTRACT_VERSION = "founder-unlock-v1" as const;

/** Where a completed unlock is recorded on the task row. */
export const UNLOCK_RESULT_KEY = "founder_unlocks" as const;

export type UnlockRefusal =
  | "invalid_json_body"
  | "missing_task_id"
  | "missing_company_key"
  | "invalid_unlock_type"
  | "task_not_found"
  | "forbidden_workspace"
  | "company_not_in_pool"
  | "company_not_unlockable"
  | "founder_unlock_required_first"
  | "insufficient_credits";

export const UNLOCK_REFUSAL_STATUS: Record<UnlockRefusal, number> = {
  invalid_json_body: 400,
  missing_task_id: 400,
  missing_company_key: 400,
  invalid_unlock_type: 400,
  task_not_found: 404,
  forbidden_workspace: 403,
  company_not_in_pool: 404,
  company_not_unlockable: 409,
  founder_unlock_required_first: 409,
  insufficient_credits: 402,
};

export const UNLOCK_REFUSAL_MESSAGE: Record<UnlockRefusal, string> = {
  invalid_json_body: "The request body was not valid JSON.",
  missing_task_id: "An unlock must name the run it belongs to.",
  missing_company_key: "An unlock must name one company.",
  invalid_unlock_type: "Unlock type must be 'founder_unlock' or 'contact_unlock'.",
  task_not_found: "That run does not exist.",
  forbidden_workspace: "That run belongs to another workspace.",
  company_not_in_pool:
    "That company is not in this run's results, so it cannot be unlocked.",
  company_not_unlockable:
    "This run did not offer an unlock for that company.",
  founder_unlock_required_first:
    "Unlock the decision-maker before buying a contact method for them.",
  insufficient_credits: "Not enough credits for this unlock.",
};

export interface UnlockRequest {
  task_id: string;
  company_key: string;
  unlock_type: UnlockKind;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Read the request. THREE FIELDS, and none of them is a price.
 *
 * There is deliberately no `workspace_id`, no `credits`, no `company` payload
 * and no `idempotency_key`: the workspace comes from the session, the price
 * from the server catalogue, the company from the verified task row, and the
 * key from the three fields below.
 */
export function parseUnlockRequest(
  body: unknown,
): { ok: true; request: UnlockRequest } | { ok: false; refusal: UnlockRefusal } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, refusal: "invalid_json_body" };
  }
  const b = body as Record<string, unknown>;
  const task_id = str(b.task_id);
  if (!task_id) return { ok: false, refusal: "missing_task_id" };
  const company_key = str(b.company_key);
  if (!company_key) return { ok: false, refusal: "missing_company_key" };
  const unlock_type = str(b.unlock_type);
  if (!isUnlockKind(unlock_type)) return { ok: false, refusal: "invalid_unlock_type" };
  return { ok: true, request: { task_id, company_key, unlock_type } };
}

/**
 * The ledger key for this unlock.
 *
 * Deterministic, so "unlock this company again" is the SAME transaction rather
 * than a second one. One company on one run is bought once, forever.
 */
export function deriveIdempotencyKey(r: UnlockRequest): string {
  return `${UNLOCK_CONTRACT_VERSION}:${r.unlock_type}:${r.task_id}:${r.company_key}`;
}

/** The subset of a `workbench_pool` row this decision needs. */
export interface PoolRowView {
  company_key: string;
  company_name: string | null;
  recommended_action: string | null;
  brain_decision: string | null;
}

/**
 * Find the company in the run's OWN results.
 *
 * This is the anti-forgery step. Without it, `company_key` is an arbitrary
 * string a caller can invent, and the unlock becomes a way to buy people at any
 * company at all while the run it cites did no such work. The Workbench pool is
 * read from the verified task row — the same trust rule Stage 2 applies to
 * evaluation checkpoints.
 */
export function findPoolRow(
  taskResult: unknown, companyKey: string,
): PoolRowView | null {
  if (!taskResult || typeof taskResult !== "object") return null;
  const pool = (taskResult as Record<string, unknown>).workbench_pool;
  if (!pool || typeof pool !== "object") return null;
  const rows = (pool as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return null;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (str(r.company_key) !== companyKey) continue;
    return {
      company_key: companyKey,
      company_name: typeof r.company_name === "string" ? r.company_name : null,
      recommended_action:
        typeof r.recommended_action === "string" ? r.recommended_action : null,
      brain_decision:
        typeof r.brain_decision === "string" ? r.brain_decision : null,
    };
  }
  return null;
}

/** A previously completed unlock, read back from the task row. */
export function findCompletedUnlock(
  taskResult: unknown, companyKey: string, kind: UnlockKind,
): Record<string, unknown> | null {
  if (!taskResult || typeof taskResult !== "object") return null;
  const all = (taskResult as Record<string, unknown>)[UNLOCK_RESULT_KEY];
  if (!all || typeof all !== "object") return null;
  const forCompany = (all as Record<string, unknown>)[companyKey];
  if (!forCompany || typeof forCompany !== "object") return null;
  const entry = (forCompany as Record<string, unknown>)[kind];
  return entry && typeof entry === "object"
    ? entry as Record<string, unknown> : null;
}

export interface UnlockAuthorization {
  request: UnlockRequest;
  row: PoolRowView;
  price: number;
  idempotency_key: string;
}

/**
 * May this unlock proceed, and at what price?
 *
 * The price is read from the server catalogue here and nowhere else, so there
 * is exactly one place a charge can originate.
 */
export function authorizeUnlock(i: {
  request: UnlockRequest;
  taskResult: unknown;
  /** Whether this company's founder unlock has already completed. */
  founderUnlockCompleted: boolean;
}): { ok: true; authorization: UnlockAuthorization }
  | { ok: false; refusal: UnlockRefusal } {
  const row = findPoolRow(i.taskResult, i.request.company_key);
  if (!row) return { ok: false, refusal: "company_not_in_pool" };

  // A REJECTED OR EXCLUDED COMPANY IS NOT FOR SALE. Rejects never reach the
  // delivered rows in the first place; this refuses the case where one does.
  if (row.brain_decision === "reject" || row.recommended_action === "exclude") {
    return { ok: false, refusal: "company_not_unlockable" };
  }

  // CONTACT UNLOCK IS A SEPARATE PURCHASE AND A LATER ONE. It never implies a
  // founder unlock, never bundles its price, and cannot run without one —
  // there would be nobody to find a contact method for.
  if (i.request.unlock_type === "contact_unlock" && !i.founderUnlockCompleted) {
    return { ok: false, refusal: "founder_unlock_required_first" };
  }

  return {
    ok: true,
    authorization: {
      request: i.request,
      row,
      price: unlockPrice(i.request.unlock_type),
      idempotency_key: deriveIdempotencyKey(i.request),
    },
  };
}
