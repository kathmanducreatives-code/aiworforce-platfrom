// Phase 5 — Signal Feed data access. Workspace-scoped reads over RLS using the
// anon client (never service role from the frontend). Read-only; no mutations.
import { supabase } from "@/integrations/supabase/client";
import { normalizeSignalRow, type FeedSignal, type RawSignalRow } from "@/lib/signalFeedModel";

export interface DraftRow {
  id: string;
  status: string | null;
  channel: string | null;
  subject: string | null;
  body: string | null;
  lead_candidate_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  created_at: string | null;
}

export interface SavedOutputRow {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  raw: Record<string, unknown> | null;
}

export async function fetchSignals(workspaceId: string, limit = 100): Promise<FeedSignal[]> {
  const { data, error } = await supabase
    .from("signals" as any)
    .select("id, workspace_id, signal_type, signal_label, title, description, source_url, source, created_at, conversation_id, plan_id, raw")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("fetchSignals", error); throw error; }
  return ((data ?? []) as unknown as RawSignalRow[]).map(normalizeSignalRow);
}

export async function fetchOutreachDrafts(workspaceId: string, limit = 50): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from("outreach_drafts" as any)
    .select("id, status, channel, subject, body, lead_candidate_id, account_id, contact_id, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("fetchOutreachDrafts", error); throw error; }
  return (data ?? []) as unknown as DraftRow[];
}

export async function fetchSavedOutputs(workspaceId: string, limit = 50): Promise<SavedOutputRow[]> {
  const { data, error } = await supabase
    .from("saved_outputs" as any)
    .select("id, type, title, body, created_at, raw")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("fetchSavedOutputs", error); throw error; }
  return (data ?? []) as unknown as SavedOutputRow[];
}
