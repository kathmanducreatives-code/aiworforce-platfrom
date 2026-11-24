// LISA V2 reads shared by lisa-monitor and agent-collaboration (service client).
import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "../companyBrainContextLoader.ts";
import { WEEKLY_WINDOW_DAYS, type StoredSignalRow } from "./weekly.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReadClient = { from(table: string): any };

/** The workspace's Company Brain context; null when it cannot be loaded. Callers authorize first. */
export async function loadBrain(admin: ReadClient, ws: string, now: Date): Promise<SharedBrainContext | null> {
  try {
    const r = await loadCompanyBrainContext(admin as unknown as LoaderDb, ws, { skipMembershipCheck: true, now });
    return r.ok ? r.context : null;
  } catch { return null; }
}

/** LISA V2 rows (actor_key lisa_v2) observed in the window, or the named ids, plus their evidence links. */
export async function storedLisaRows(admin: ReadClient, ws: string, now: Date, ids?: string[]): Promise<{ rows: StoredSignalRow[]; evidence: Map<string, Array<{ url: string; domain: string }>> }> {
  const since = new Date(now.getTime() - WEEKLY_WINDOW_DAYS * 86_400_000).toISOString();
  let q = admin.from("signal_events")
    .select("id, workspace_id, signal_type, lifecycle_status, verification_status, confidence, occurred_at, observed_at, source_url, subject_type, subject_key, normalized_value")
    .eq("workspace_id", ws).eq("actor_key", "lisa_v2");
  q = ids ? q.in("id", ids) : q.gte("observed_at", since);
  const { data } = await q.order("observed_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as StoredSignalRow[];
  const evidence = new Map<string, Array<{ url: string; domain: string }>>();
  if (rows.length) {
    const { data: ev } = await admin.from("signal_event_evidence")
      .select("signal_event_id, source_url, normalized_value")
      .eq("workspace_id", ws).in("signal_event_id", rows.map((r) => r.id)).limit(1000);
    for (const e of (ev ?? []) as Array<{ signal_event_id: string; source_url: string | null; normalized_value: { domain?: string } | null }>) {
      if (!e.source_url) continue;
      const list = evidence.get(e.signal_event_id) ?? [];
      list.push({ url: e.source_url, domain: e.normalized_value?.domain ?? "" });
      evidence.set(e.signal_event_id, list);
    }
  }
  return { rows, evidence };
}

