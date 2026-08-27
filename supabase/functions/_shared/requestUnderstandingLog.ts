// WHAT THE CURRENT PATH DECIDES, RECORDED BEFORE WE REPLACE IT.
//
// ── WHY THIS EXISTS BEFORE ANY CHAT BRAIN CODE ─────────────────────────────
//
// The migration's entire safety argument is equivalence: the new semantic path
// must decide what the old one decided, except where it decides better. That
// claim is unprovable without a record of what the old one actually decides on
// real traffic — and no such record exists. Three classifiers
// (`workflowClassifier`, `leadIntent`, `leadIntentModel`) route every message
// today and none of them leaves a durable trace of its verdict.
//
// Phase 8 was lost to exactly this shape of problem: fixes shipped against
// behaviour nobody had measured, and each live run revealed one more hidden
// dependency. A baseline is the cheapest possible defence, and it costs one
// insert per message.
//
// ── WHAT IT MUST NEVER DO ──────────────────────────────────────────────────
//
// Change a decision. This module observes; it has no return value any caller
// branches on, and every failure is swallowed. A logger that can fail a request
// is worse than no logger, and the execution ledger already sets that
// precedent: "observability must not be able to fail a run it is only
// watching."
//
// ── WHY THE UTTERANCE IS STORED TWICE ──────────────────────────────────────
//
// `utterance_hash` is the join key — stable, non-reversible, safe to count and
// group by. `utterance_redacted` is what a human reads at Checkpoint 1 when
// deciding whether six objectives cover the product. Storing only the hash
// would make the corpus unreadable; storing only the text would make it
// unsafe to aggregate. Both, with the text redacted of anything that looks
// like a contact detail.
//
// Pure builders here; the write is a best-effort insert the caller performs.

export const REQUEST_UNDERSTANDING_LOG_VERSION = "request-understanding-log-v1" as const;
export const REQUEST_UNDERSTANDING_TABLE = "request_understanding_log" as const;

/** Which decider produced this verdict. */
export type UnderstandingSource =
  | "workflow_classifier"
  | "lead_intent"
  | "lead_intent_model"
  /** Chat Brain running in shadow. Phase B. Present now so the column does not
   *  need a migration the moment shadow mode starts. */
  | "chat_brain_shadow";

export interface UnderstandingRow {
  workspace_id: string;
  conversation_id: string | null;
  message_id: string | null;
  source: UnderstandingSource;
  utterance_hash: string;
  utterance_redacted: string;
  /** The old vocabulary: one of pilot-chat's categories. Null for Chat Brain. */
  category: string | null;
  /** The new vocabulary: a `RequestObjective`. Null for the old classifiers. */
  objective: string | null;
  confidence: number | null;
  /** Set once a mission was compiled, so a decision can be joined to a run. */
  mission_hash: string | null;
  task_id: string | null;
  /** Stage 0 grades, when the request reached feasibility. */
  stage0_grades: Record<string, unknown> | null;
  /** Whatever else the decider recorded. Safe metadata only — never prose. */
  metadata: Record<string, unknown> | null;
}

/**
 * Redact anything that looks like a contact detail.
 *
 * DELIBERATELY CRUDE AND OVER-BROAD. This corpus is read by a human at a
 * checkpoint, not mined; losing a word to caution costs nothing, and keeping an
 * email address costs a great deal. Emails, phone-shaped digit runs, URLs with
 * userinfo, and long digit sequences go.
 */
export function redactUtterance(raw: string): string {
  return String(raw ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .replace(/\b\d{7,}\b/g, "[number]")
    .slice(0, 2000);
}

/**
 * A stable, non-reversible key for one utterance.
 *
 * The same string that different users type must produce the same key, so the
 * corpus can count paraphrase frequency across a workspace. Normalised on
 * whitespace and case first, for that reason.
 */
export async function utteranceHash(raw: string): Promise<string> {
  const norm = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const bytes = new TextEncoder().encode(norm);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UnderstandingInput {
  workspaceId: string;
  conversationId?: string | null;
  messageId?: string | null;
  source: UnderstandingSource;
  utterance: string;
  category?: string | null;
  objective?: string | null;
  confidence?: number | null;
  missionHash?: string | null;
  taskId?: string | null;
  stage0Grades?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/** Build the row. Pure, so every field can be asserted without a database. */
export async function buildUnderstandingRow(
  i: UnderstandingInput,
): Promise<UnderstandingRow> {
  return {
    workspace_id: i.workspaceId,
    conversation_id: i.conversationId ?? null,
    message_id: i.messageId ?? null,
    source: i.source,
    utterance_hash: await utteranceHash(i.utterance),
    utterance_redacted: redactUtterance(i.utterance),
    category: i.category ?? null,
    objective: i.objective ?? null,
    confidence: typeof i.confidence === "number" ? i.confidence : null,
    mission_hash: i.missionHash ?? null,
    task_id: i.taskId ?? null,
    stage0_grades: i.stage0Grades ?? null,
    metadata: i.metadata ?? null,
  };
}

/** Minimal shape of the client, so callers need not import supabase-js here. */
export interface UnderstandingWriter {
  from: (table: string) => {
    insert: (row: unknown) => Promise<{ error: unknown }> | { error: unknown };
  };
}

/**
 * Record one decision. Never throws, never returns anything to branch on.
 *
 * A caller that awaits this is buying ordering, not a result.
 */
export async function recordUnderstanding(
  db: UnderstandingWriter | null | undefined,
  i: UnderstandingInput,
): Promise<void> {
  if (!db) return;
  try {
    const row = await buildUnderstandingRow(i);
    const res = await db.from(REQUEST_UNDERSTANDING_TABLE).insert(row);
    if (res && (res as { error?: unknown }).error) {
      console.warn("[understanding-log] insert failed",
        String((res as { error?: unknown }).error));
    }
  } catch (e) {
    // Swallowed on purpose. See the header.
    console.warn("[understanding-log] threw", String(e));
  }
}
