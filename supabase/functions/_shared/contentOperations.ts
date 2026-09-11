// CONTENT OPERATIONS, SERVER SIDE — the canonical half Pilot was missing.
//
// ── THE SHADOW DRAFT THIS DELETES ───────────────────────────────────────────
//
// `writeScribeContent` fills a `content_item` only when the run carries
// `content_loop.content_item_id`. The Content page creates the row first and
// passes that id, so its drafts are canonical: versioned, editable, approvable,
// illustratable.
//
// Nothing else passed one. Pilot dispatched an ENGLISH SENTENCE through
// orchestrate, and orchestrate's content-engagement loop built a `content_loop`
// with no id — so every Content draft that originated in chat landed in
// `saved_outputs` and nowhere else. `saved_outputs` has no status and no version
// child, which is precisely why the Content page renders those rows read-only.
//
// That is the "Pilot draft vs Content-page draft" split. It was not two
// features; it was one feature with a missing row.
//
// ── WHY HERE AND NOT IN `src/` ──────────────────────────────────────────────
//
// The frontend `contentService` cannot be imported by an edge function. Rather
// than copy it, the part BOTH runtimes need lives here, next to
// `contentInstruction.ts`, the same way `signalCluster.ts` is shared. One
// definition, two callers.
//
// This module OWNS: the row, the workspace, the source identity, and the typed
// tool input. It does NOT own the model, the provider, the prompt assembly
// beyond the brief, or the spend — `run-agent` already owns all four, and a
// second opinion on any of them is a second product.

import { buildContentInstruction } from "./contentInstruction.ts";

export const CONTENT_OPERATIONS_VERSION = "content-operations-v1" as const;

/**
 * What a caller wants done to Content. The typed alternative to guessing from
 * a sentence at every layer.
 *
 * `reference` is not a no-op: "regenerate that post" has to resolve WHICH post
 * before it is a `regenerate_text`, and naming the lookup makes the failure to
 * resolve one a reportable outcome instead of a new draft appearing.
 */
export type ContentObjective =
  | "create"
  | "regenerate_text"
  | "generate_image"
  | "regenerate_image"
  | "reference";

export type ContentFormat = "linkedin_post" | "linkedin_comment";
export type ContentSourceType = "idea" | "signal";

export interface ContentRequest {
  objective: ContentObjective;
  workspace_id: string;
  format: ContentFormat;
  source_type: ContentSourceType;
  /** The user's own words. Required for an idea; an optional angle on a signal. */
  idea?: string | null;
  /** The signal's real id. Never a title standing in for one. */
  source_signal_id?: string | null;
  source_signal_title?: string | null;
  /** For every objective except `create`. */
  content_item_id?: string | null;
  created_by?: string | null;
}

/** What a caller gets back. References to persisted rows, never a model message. */
export interface ContentReference {
  content_item_id: string;
  current_version_id: string | null;
  content_type: ContentFormat;
  status: string;
  title: string | null;
  body: string | null;
  current_asset_id: string | null;
  /** The brief the row was created with. A regeneration reads this back. */
  brief: string;
}

/** The minimum database surface these operations need. */
export interface ContentDb {
  from(table: string): {
    insert(values: unknown): {
      select(cols: string): { single(): Promise<{ data: unknown; error: unknown }> };
    };
    select(cols: string): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          maybeSingle(): Promise<{ data: unknown; error: unknown }>;
        };
        order(col: string, opts: { ascending: boolean }): {
          limit(n: number): Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  };
}

export interface ContentOperationResult {
  ok: boolean;
  reference: ContentReference | null;
  error: string | null;
}

/**
 * Create the canonical draft row, BEFORE the model is asked.
 *
 * The same order the Content page uses, for the same reason: a failed
 * generation then leaves a draft to retry rather than a chat message saying it
 * did not work. It also means the id exists to hand to Scribe, which is the
 * whole mechanism by which the result is canonical rather than a shadow.
 */
export async function createCanonicalContentItem(
  db: ContentDb,
  req: ContentRequest,
): Promise<ContentOperationResult> {
  if (!req.workspace_id) return { ok: false, reference: null, error: "no_workspace" };
  if (req.source_type === "signal" && !req.source_signal_id) {
    // The database enforces this too. Refusing here names the problem; the
    // constraint violation would only say a check failed.
    return { ok: false, reference: null, error: "signal_source_requires_signal_id" };
  }
  const idea = (req.idea ?? "").trim();
  if (req.source_type === "idea" && !idea) {
    return { ok: false, reference: null, error: "idea_source_requires_text" };
  }

  const brief = buildContentInstruction({
    format: req.format,
    sourceType: req.source_type,
    idea,
    signalTitle: req.source_signal_title ?? null,
  });

  const title = req.source_type === "signal"
    ? (req.source_signal_title ?? "From a signal")
    : idea.slice(0, 80);

  const { data, error } = await db
    .from("content_item")
    .insert({
      workspace_id: req.workspace_id,
      title,
      format: req.format,
      // WHERE IT CAME FROM, honestly. `pilot_chat` is distinct from
      // `content_surface` so the two entrypoints stay countable — they produce
      // the same object, which is the point, but "who asked" is still a fact.
      source: "pilot_chat",
      source_type: req.source_type,
      source_signal_id: req.source_signal_id ?? null,
      body: "",
      created_by: req.created_by ?? null,
      metadata: { brief, topic: idea || req.source_signal_title || null },
    })
    .select("id, title, body, format, status, current_version_id, current_asset_id, metadata")
    .single();

  if (error || !data) {
    return {
      ok: false, reference: null,
      error: String((error as { message?: unknown } | null)?.message ?? "content_create_failed"),
    };
  }
  return { ok: true, reference: toReference(data as Record<string, unknown>, brief), error: null };
}

/**
 * THE TYPED TOOL INPUT. Not a sentence.
 *
 * `content_item_id` is the field that makes the result canonical, and
 * `related_signal_ids` carries the real FK rather than a title the model might
 * have paraphrased. `writeScribeContent` reads exactly this shape, so nothing
 * downstream has to be taught a second one.
 */
export function buildContentToolInput(i: {
  reference: ContentReference;
  objective: ContentObjective;
  source_signal_id?: string | null;
  topic?: string | null;
}): Record<string, unknown> {
  return {
    content_loop: {
      source: "content_surface",
      subtype: i.reference.content_type === "linkedin_comment" ? "comment_draft" : "founder_post",
      topic: i.topic ?? null,
      content_item_id: i.reference.content_item_id,
      // A regeneration is recorded as one, which is how history stays readable:
      // the trigger copies this onto the version row.
      regenerate: i.objective === "regenerate_text",
      related_signal_ids: i.source_signal_id ? [i.source_signal_id] : [],
    },
  };
}

/** Read a draft back, scoped by workspace. Never by id alone. */
export async function loadContentReference(
  db: ContentDb, workspaceId: string, contentItemId: string,
): Promise<ContentOperationResult> {
  const { data, error } = await db
    .from("content_item")
    .select("id, title, body, format, status, current_version_id, current_asset_id, metadata")
    .eq("id", contentItemId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return { ok: false, reference: null, error: "content_item_not_found" };
  const row = data as Record<string, unknown>;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return { ok: true, reference: toReference(row, String(meta.brief ?? "")), error: null };
}

/**
 * The draft a bare "that post" means.
 *
 * Newest first, scoped to the workspace. A reference with nothing to resolve
 * returns not-found rather than creating something — inventing a draft because
 * the pronoun was ambiguous is how a user ends up with two.
 */
export async function resolveLatestContentItem(
  db: ContentDb, workspaceId: string,
): Promise<ContentOperationResult> {
  const { data, error } = await db
    .from("content_item")
    .select("id, title, body, format, status, current_version_id, current_asset_id, metadata")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
  if (error || rows.length === 0) return { ok: false, reference: null, error: "no_content_to_reference" };
  const meta = (rows[0].metadata ?? {}) as Record<string, unknown>;
  return { ok: true, reference: toReference(rows[0], String(meta.brief ?? "")), error: null };
}

function toReference(row: Record<string, unknown>, brief: string): ContentReference {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    content_item_id: String(row.id),
    current_version_id: row.current_version_id ? String(row.current_version_id) : null,
    content_type: (String(row.format) === "linkedin_comment" ? "linkedin_comment" : "linkedin_post"),
    status: String(row.status ?? "draft"),
    title: row.title == null ? null : String(row.title),
    body: row.body == null ? null : String(row.body),
    current_asset_id: row.current_asset_id ? String(row.current_asset_id) : null,
    brief: brief || String(meta.brief ?? ""),
  };
}
