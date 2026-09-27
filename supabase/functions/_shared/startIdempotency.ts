// ONE APPROVED CARD, ONE PLAN.
//
// ── THE RUN THIS EXISTS TO END ─────────────────────────────────────────────
//
// Conversation 38e904cb, 2026-09-27. One workflow card for "Check 1 company:
// Fuse AI", one Start. pilot-chat nevertheless received the card's Start twice,
// 8.4 s apart (user messages at 14:08:58.94 and 14:09:07.37, identical
// metadata), and each became its own plan (a3953169, 0123c1a3), its own queue
// row and its own paid mission: company details bought twice, a second
// Firecrawl map, a second verdict. Neither plan carried an idempotency key.
//
// Whatever sent the second request, nothing downstream could tell that the
// same approval had arrived twice. `task_plans` already has the mechanism —
// `task_plans_idempotency_uniq` on (workspace_id, idempotency_key), which
// `continue-workflow` uses for exactly this — and the Start path never set it.
//
// ── THE KEY IS THE CARD ────────────────────────────────────────────────────
//
// The assistant message that rendered the card is the one thing both
// requests share and a genuinely new request never does: asking again
// produces a NEW card, so a deliberate rerun gets a new key, while a double
// click, a remounted card, a replayed request or a second tab collide. No time
// window, no hash of the mission — nothing that could merge two approvals the
// user really gave.
//
// Pure except `findStartedPlan`, which takes its database as an argument.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PREFIX = "start:";

/** The key for a Start of the card rendered by `confirmationMessageId`; null for anything that is not a message id. */
export function startIdempotencyKey(confirmationMessageId: unknown): string | null {
  if (typeof confirmationMessageId !== "string") return null;
  const id = confirmationMessageId.trim().toLowerCase();
  return UUID_RE.test(id) ? `${KEY_PREFIX}${id}` : null;
}

/** What orchestrate accepts as a Start key. Anything else is ignored, never stored. */
export function isStartIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(KEY_PREFIX)
    && UUID_RE.test(v.slice(KEY_PREFIX.length)) && v === v.toLowerCase();
}

/** A message row as pilot-chat reads it back. */
export interface ConfirmationRow {
  id: string;
  conversation_id?: string | null;
  role?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The key for this Start, if the id the card sent really names a workflow card
 * in THIS conversation. A client-supplied id is a claim; it becomes a key only
 * once the server has seen the card it names. Anything else — no id, another
 * conversation's message, a user message, a message that is not a card — gives
 * null, and the Start proceeds exactly as it did before keys existed.
 */
export function verifiedStartKey(
  claimedId: unknown, conversationId: string | null, row: ConfirmationRow | null,
): string | null {
  const key = startIdempotencyKey(claimedId);
  if (!key || !row || !conversationId) return null;
  if (String(row.id).toLowerCase() !== key.slice(KEY_PREFIX.length)) return null;
  if (row.conversation_id !== conversationId) return null;
  if (row.role !== "assistant") return null;
  if ((row.metadata as { type?: unknown } | null)?.type !== "workflow_confirmation") return null;
  return key;
}

/** The plan a Start already created, and its first task, as orchestrate reports them. */
export interface StartedPlan {
  plan_id: string;
  task_id: string | null;
  plan_summary: string | null;
}

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

/** The plan this key already created in this workspace, or null. */
export async function findStartedPlan(
  db: Db, workspaceId: string, key: string,
): Promise<StartedPlan | null> {
  const { data: plan } = await db.from("task_plans")
    .select("id, plan_summary")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", key)
    .maybeSingle();
  const planId = (plan as { id?: string } | null)?.id;
  if (!planId) return null;
  const { data: task } = await db.from("tasks")
    .select("id")
    .eq("plan_id", planId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    plan_id: planId,
    task_id: (task as { id?: string } | null)?.id ?? null,
    plan_summary: (plan as { plan_summary?: string | null }).plan_summary ?? null,
  };
}

/**
 * orchestrate's answer to a Start it has already honoured: success, the SAME
 * plan, and `deduplicated: true` so the caller neither announces a second plan
 * nor reads the collision as a failure. Nothing is enqueued for it.
 */
export function duplicateStartBody(existing: StartedPlan, key: string) {
  return {
    success: true,
    deduplicated: true,
    idempotency_key: key,
    plan_id: existing.plan_id,
    task_plan_id: existing.plan_id,
    task_id: existing.task_id,
    plan_summary: existing.plan_summary,
  };
}

/** What Pilot says when the same Start arrives again. */
export const DUPLICATE_START_REPLY =
  "This workflow is already running from this card — I didn't start it a second time.";
