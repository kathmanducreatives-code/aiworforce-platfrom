// Durable discovery checkpoints.
//
// A walk over an ICP is bought page by page, possibly across sessions. What a
// checkpoint keeps is what makes the NEXT purchase new:
//
//   seenPersonIds  every LeadOcean person_id already bought for this ICP
//   pagesBought / recordsBought   the running totals the budget reads
//
// It deliberately does NOT keep a cursor for a later session: LeadOcean's
// cursors are signed positions in ONE walk ("Do not store a cursor for later";
// 400 Invalid cursor / 410 snapshot retired). A resumed walk starts a new search
// with excludeIds = the ids already seen (at most 1,000 per call, LeadOcean's
// limit), so nothing already paid for is bought again. Within one run, paging
// uses the cursor in stable order (adapters/leadocean.ts).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const CHECKPOINT_VERSION = "lead-pipeline-checkpoint-v1" as const;
export const EXCLUDE_IDS_MAX = 1000;

export interface WalkCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  walkId: string;
  workspaceId: string;
  icpId: string;
  seenPersonIds: string[];
  seenCompanyKeys: string[];
  pagesBought: number;
  recordsBought: number;
  updatedAt: string;
  /** Set once the provider has no more pages for this ICP, or the seen list outgrew excludeIds. */
  exhausted: string | null;
}

export interface CheckpointStore {
  load(workspaceId: string, walkId: string): Promise<WalkCheckpoint | null>;
  save(cp: WalkCheckpoint): Promise<void>;
}

export function memoryCheckpointStore(): CheckpointStore & { rows: Map<string, WalkCheckpoint> } {
  const rows = new Map<string, WalkCheckpoint>();
  return {
    rows,
    load: (w, id) => Promise.resolve(rows.has(`${w}:${id}`) ? structuredClone(rows.get(`${w}:${id}`)!) : null),
    save: (cp) => { rows.set(`${cp.workspaceId}:${cp.walkId}`, structuredClone(cp)); return Promise.resolve(); },
  };
}

export function newCheckpoint(workspaceId: string, walkId: string, icpId: string, now: string): WalkCheckpoint {
  return { version: CHECKPOINT_VERSION, walkId, workspaceId, icpId, seenPersonIds: [], seenCompanyKeys: [], pagesBought: 0, recordsBought: 0, updatedAt: now, exhausted: null };
}

/** The narrowing a resumed walk needs: never re-buy an id already seen. */
export function resumeHints(cp: WalkCheckpoint): { excludeIds?: string[]; blocked: string | null } {
  if (cp.exhausted) return { blocked: `walk exhausted: ${cp.exhausted}` };
  if (cp.seenPersonIds.length > EXCLUDE_IDS_MAX) {
    return { blocked: `more than ${EXCLUDE_IDS_MAX} people already seen: LeadOcean cannot exclude them all in one search — narrow the ICP (split by state or size band) before buying more` };
  }
  return cp.seenPersonIds.length ? { excludeIds: [...cp.seenPersonIds], blocked: null } : { blocked: null };
}

/** Fold one run's purchases into the checkpoint. */
export function advance(cp: WalkCheckpoint, run: { personIds: string[]; companyKeys: string[]; pages: number; records: number; morePages: boolean; now: string }): WalkCheckpoint {
  const seen = new Set(cp.seenPersonIds);
  for (const id of run.personIds) seen.add(id);
  const companies = new Set(cp.seenCompanyKeys);
  for (const k of run.companyKeys) companies.add(k);
  return {
    ...cp, seenPersonIds: [...seen], seenCompanyKeys: [...companies],
    pagesBought: cp.pagesBought + run.pages, recordsBought: cp.recordsBought + run.records, updatedAt: run.now,
    exhausted: !run.morePages && run.pages > 0 && run.personIds.length === 0 ? "no new people returned" : cp.exhausted,
  };
}

/** The hosted store (held migration 20261031120000_lead_pipeline_checkpoints.sql). `admin` is a service-role client. */
export function supabaseCheckpointStore(admin: SupabaseClient): CheckpointStore {
  return {
    async load(workspaceId, walkId) {
      const { data, error } = await admin.from("lead_pipeline_checkpoints").select("*").eq("workspace_id", workspaceId).eq("walk_id", walkId).maybeSingle();
      if (error) throw new Error(`checkpoint read failed: ${error.message}`);
      if (!data) return null;
      return { version: CHECKPOINT_VERSION, walkId, workspaceId, icpId: data.icp_id, seenPersonIds: data.seen_person_ids ?? [], seenCompanyKeys: data.seen_company_keys ?? [],
        pagesBought: data.pages_bought, recordsBought: data.records_bought, updatedAt: data.updated_at, exhausted: data.exhausted };
    },
    async save(cp) {
      const { error } = await admin.from("lead_pipeline_checkpoints").upsert({
        workspace_id: cp.workspaceId, walk_id: cp.walkId, icp_id: cp.icpId, version: cp.version, seen_person_ids: cp.seenPersonIds, seen_company_keys: cp.seenCompanyKeys,
        pages_bought: cp.pagesBought, records_bought: cp.recordsBought, exhausted: cp.exhausted, updated_at: cp.updatedAt,
      }, { onConflict: "workspace_id,walk_id" });
      if (error) throw new Error(`checkpoint write failed: ${error.message}`);
    },
  };
}
