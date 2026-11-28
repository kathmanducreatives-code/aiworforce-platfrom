// Phase 6 — Signal review data access. Workspace-scoped over RLS using the anon
// client (never service role from the frontend). Reviews are user-specific, so
// every write also pins user_id (enforced again by RLS WITH CHECK).
import { supabase } from "@/integrations/supabase/client";
import {
  buildReviewUpsert,
  type ReviewStatus,
  type SignalReviewRow,
} from "@/lib/signalReviewModel";

// ── CANONICAL SIGNALS CAN BE REVIEWED (Signals recovery) ─────────────────────
// A review names either a legacy `signals` row (signal_id) or a canonical `signal_events` row
// (signal_event_id, held migration 20261128150000). Callers keep passing one id per signal; this
// layer finds which table it belongs to. `signal_id` on a returned row is the id the FEED uses,
// whichever column stored it. Without the migration everything behaves as before.
const REVIEW_COLS = "id, signal_id, signal_event_id, lead_candidate_id, status, note, reviewed_at, ignored_at, saved_at, updated_at";
const LEGACY_REVIEW_COLS = "id, signal_id, lead_candidate_id, status, note, reviewed_at, ignored_at, saved_at, updated_at";
let canonicalReviewsAvailable: boolean | null = null;
const asFeedKeyed = (r: any): SignalReviewRow => ({ ...r, signal_id: r?.signal_event_id ?? r?.signal_id ?? null });

/** Which of these ids are canonical signal_events of this workspace. */
async function canonicalIdsOf(workspaceId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length || canonicalReviewsAvailable === false) return new Set();
  const { data, error } = await supabase.from("signal_events" as any).select("id")
    .eq("workspace_id", workspaceId).in("id", ids);
  if (error) return new Set();
  return new Set(((data ?? []) as any[]).map((r) => String(r.id)));
}

/** Fetch the current user's review rows for a workspace. */
export async function fetchSignalReviews(
  workspaceId: string,
  limit = 500,
): Promise<SignalReviewRow[]> {
  const run = (cols: string) => supabase
    .from("signal_reviews" as any)
    .select(cols)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  let { data, error } = await run(canonicalReviewsAvailable === false ? LEGACY_REVIEW_COLS : REVIEW_COLS);
  if (error && canonicalReviewsAvailable !== false && /signal_event_id/.test(error.message ?? "")) {
    canonicalReviewsAvailable = false;
    ({ data, error } = await run(LEGACY_REVIEW_COLS));
  } else if (!error) {
    canonicalReviewsAvailable = canonicalReviewsAvailable ?? true;
  }
  if (error) { console.error("fetchSignalReviews", error); throw error; }
  return ((data ?? []) as any[]).map(asFeedKeyed);
}

/** Resolve the current authenticated user's id (for user_id pinning). */
async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) throw new Error("Not authenticated");
  return data.user.id;
}

/**
 * Upsert a single signal's review state. Manual upsert (select → update|insert)
 * so we never depend on ON CONFLICT inference over a partial unique index.
 */
export async function upsertSignalReview(args: {
  workspaceId: string;
  signalId: string;
  status: ReviewStatus;
  note?: string | null;
}): Promise<SignalReviewRow> {
  const userId = await currentUserId();
  const base = buildReviewUpsert({
    workspaceId: args.workspaceId,
    userId,
    signalId: args.signalId,
    status: args.status,
    note: args.note ?? null,
  });
  const canonical = (await canonicalIdsOf(args.workspaceId, [args.signalId])).has(args.signalId);
  const column = canonical ? "signal_event_id" : "signal_id";
  const payload = (canonical
    ? { ...base, signal_id: null, signal_event_id: args.signalId }
    : { ...base }) as unknown as Record<string, unknown>;
  const cols = canonicalReviewsAvailable === false ? LEGACY_REVIEW_COLS : REVIEW_COLS;

  const { data: existing, error: selErr } = await supabase
    .from("signal_reviews" as any)
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", userId)
    .eq(column, args.signalId)
    .maybeSingle();
  if (selErr) { console.error("upsertSignalReview select", selErr); throw selErr; }

  if (existing && (existing as any).id) {
    const { data, error } = await supabase
      .from("signal_reviews" as any)
      .update({
        status: payload.status,
        note: payload.note,
        reviewed_at: payload.reviewed_at,
        ignored_at: payload.ignored_at,
        saved_at: payload.saved_at,
      })
      .eq("id", (existing as any).id)
      .select(cols)
      .single();
    if (error) { console.error("upsertSignalReview update", error); throw error; }
    return asFeedKeyed(data);
  }

  const { data, error } = await supabase
    .from("signal_reviews" as any)
    .insert(payload)
    .select(cols)
    .single();
  if (error) { console.error("upsertSignalReview insert", error); throw error; }
  return asFeedKeyed(data);
}

/**
 * Apply one status to many signals at once. Splits into a single UPDATE for
 * rows that already have a review and a single INSERT for the rest — at most
 * three round-trips regardless of selection size.
 */
export async function bulkUpdateSignalReviews(args: {
  workspaceId: string;
  signalIds: string[];
  status: ReviewStatus;
}): Promise<{ updated: number; inserted: number }> {
  const ids = Array.from(new Set((args.signalIds ?? []).filter(Boolean)));
  if (ids.length === 0) return { updated: 0, inserted: 0 };
  const userId = await currentUserId();

  const canonical = await canonicalIdsOf(args.workspaceId, ids);
  const legacyIds = ids.filter((i) => !canonical.has(i));
  const eventIds = ids.filter((i) => canonical.has(i));
  const existingBySignal = new Map<string, string>();
  for (const [column, group] of [["signal_id", legacyIds], ["signal_event_id", eventIds]] as const) {
    if (!group.length) continue;
    const { data: existingRows, error: selErr } = await supabase
      .from("signal_reviews" as any)
      .select(`id, ${column}`)
      .eq("workspace_id", args.workspaceId)
      .eq("user_id", userId)
      .in(column, group);
    if (selErr) { console.error("bulkUpdateSignalReviews select", selErr); throw selErr; }
    for (const r of (existingRows ?? []) as any[]) if (r[column]) existingBySignal.set(r[column], r.id);
  }

  const now = new Date().toISOString();
  const stamp = {
    reviewed_at: args.status === "reviewed" ? now : null,
    ignored_at: args.status === "ignored" ? now : null,
    saved_at: args.status === "saved" ? now : null,
  };

  const existingIds = ids.map((s) => existingBySignal.get(s)).filter(Boolean) as string[];
  const missing = ids.filter((s) => !existingBySignal.has(s));

  let updated = 0;
  let inserted = 0;

  if (existingIds.length) {
    const { error } = await supabase
      .from("signal_reviews" as any)
      .update({ status: args.status, ...stamp })
      .in("id", existingIds);
    if (error) { console.error("bulkUpdateSignalReviews update", error); throw error; }
    updated = existingIds.length;
  }

  if (missing.length) {
    const rows = missing.map((signalId) => {
      const row = buildReviewUpsert({ workspaceId: args.workspaceId, userId, signalId, status: args.status, now });
      return canonical.has(signalId) ? { ...row, signal_id: null, signal_event_id: signalId } : row;
    });
    const { error } = await supabase.from("signal_reviews" as any).insert(rows);
    if (error) { console.error("bulkUpdateSignalReviews insert", error); throw error; }
    inserted = missing.length;
  }

  return { updated, inserted };
}
