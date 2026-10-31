// Reusable verification evidence, per workspace.
//
// A company record bought once is reused while fresh, so a second search that
// meets the same company does not buy it again. Entries are keyed by workspace AND
// LinkedIn company slug: one workspace never reads another's purchases. Freshness
// is the evidence's observation time, not the cache write time.

import type { EvidenceItem } from "../candidateObservation.ts";
import type { CanonicalFacts } from "../leadPipeline/canonical.ts";

export interface CachedCompanyRecord { workspaceId: string; slug: string; evidence: EvidenceItem[]; facts: CanonicalFacts | null; observedAt: string }

export interface EvidenceCache {
  get(workspaceId: string, slug: string): Promise<CachedCompanyRecord | null>;
  put(record: CachedCompanyRecord): Promise<void>;
}

export function memoryEvidenceCache(): EvidenceCache & { rows: Map<string, CachedCompanyRecord> } {
  const rows = new Map<string, CachedCompanyRecord>();
  return {
    rows,
    get: (w, s) => Promise.resolve(rows.get(`${w}:${s}`) ?? null),
    put: (r) => { rows.set(`${r.workspaceId}:${r.slug}`, structuredClone(r)); return Promise.resolve(); },
  };
}

export const isFresh = (r: CachedCompanyRecord, now: Date, maxAgeDays: number) =>
  now.getTime() - Date.parse(r.observedAt) <= maxAgeDays * 86_400_000;

/** The hosted cache (held migration 20261101120000_discovery_evidence_cache.sql). `admin` is a service-role client. */
// deno-lint-ignore no-explicit-any
export function supabaseEvidenceCache(admin: any): EvidenceCache {
  return {
    async get(workspaceId, slug) {
      const { data, error } = await admin.from("discovery_evidence_cache").select("*").eq("workspace_id", workspaceId).eq("slug", slug).maybeSingle();
      if (error) throw new Error(`evidence cache read failed: ${error.message}`);
      return data ? { workspaceId, slug, evidence: data.evidence, facts: data.facts, observedAt: data.observed_at } : null;
    },
    async put(r) {
      const { error } = await admin.from("discovery_evidence_cache").upsert({ workspace_id: r.workspaceId, slug: r.slug, evidence: r.evidence, facts: r.facts, observed_at: r.observedAt, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,slug" });
      if (error) throw new Error(`evidence cache write failed: ${error.message}`);
    },
  };
}
