// Phase 6 — Signal review data access. Workspace-scoped over RLS using the anon
// client (never service role from the frontend). Reviews are user-specific, so
// every write also pins user_id (enforced again by RLS WITH CHECK).
import { supabase } from "@/integrations/supabase/client";
import {
  buildReviewUpsert,
  type ReviewStatus,
  type SignalReviewRow,
} from "@/lib/signalReviewModel";

/** Fetch the current user's review rows for a workspace. */
export async function fetchSignalReviews(
  workspaceId: string,
  limit = 500,
): Promise<SignalReviewRow[]> {
  const { data, error } = await supabase
    .from("signal_reviews" as any)
    .select("id, signal_id, lead_candidate_id, status, note, reviewed_at, ignored_at, saved_at, updated_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("fetchSignalReviews", error); throw error; }
  return (data ?? []) as unknown as SignalReviewRow[];
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
  const payload = buildReviewUpsert({
    workspaceId: args.workspaceId,
    userId,
    signalId: args.signalId,
    status: args.status,
    note: args.note ?? null,
  });

  const { data: existing, error: selErr } = await supabase
    .from("signal_reviews" as any)
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", userId)
    .eq("signal_id", args.signalId)
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
      .select("id, signal_id, lead_candidate_id, status, note, reviewed_at, ignored_at, saved_at, updated_at")
      .single();
    if (error) { console.error("upsertSignalReview update", error); throw error; }
    return data as unknown as SignalReviewRow;
  }

  const { data, error } = await supabase
    .from("signal_reviews" as any)
    .insert(payload)
    .select("id, signal_id, lead_candidate_id, status, note, reviewed_at, ignored_at, saved_at, updated_at")
    .single();
  if (error) { console.error("upsertSignalReview insert", error); throw error; }
  return data as unknown as SignalReviewRow;
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

  const { data: existingRows, error: selErr } = await supabase
    .from("signal_reviews" as any)
    .select("id, signal_id")
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", userId)
    .in("signal_id", ids);
  if (selErr) { console.error("bulkUpdateSignalReviews select", selErr); throw selErr; }

  const existingBySignal = new Map<string, string>();
  for (const r of (existingRows ?? []) as any[]) {
    if (r.signal_id) existingBySignal.set(r.signal_id, r.id);
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
    const rows = missing.map((signalId) =>
      buildReviewUpsert({ workspaceId: args.workspaceId, userId, signalId, status: args.status, now }),
    );
    const { error } = await supabase.from("signal_reviews" as any).insert(rows);
    if (error) { console.error("bulkUpdateSignalReviews insert", error); throw error; }
    inserted = missing.length;
  }

  return { updated, inserted };
}
