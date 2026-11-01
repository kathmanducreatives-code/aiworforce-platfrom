// Canonical company evidence: the Apify company record, read by the company's
// LinkedIn URL, turned into the SAME evidence items the Apify engine produces.
//
// This is what lets the shared engine decide headquarters and size: a provider
// row is at most plausible, while `apify_linkedin_company_details` has proving
// rules (evidenceAuthority.ts: one HQ-flagged location; a declared size band).
// Nothing here is new judgement — normalizeLinkedInCompanyEnriched and
// observationFromCompany are the Apify engine's own code.
//
// harvestapi/linkedin-company: $0.004 per company + $0.00005 per start (FREE/BRONZE, 2026-10-31).

import type { EvidenceItem } from "../candidateObservation.ts";
import { observationFromCompany } from "../candidateObservation.ts";
import { normalizeLinkedInCompanyEnriched } from "../hiringActorNormalizers.ts";
import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import { isFresh, type CachedCompanyRecord, type EvidenceCache } from "./evidenceCache.ts";

export const COMPANY_RECORD_ACTOR = Object.freeze({ key: "apify_linkedin_company_details", actorId: "harvestapi/linkedin-company", perItemUsd: 0.004, perStartUsd: 0.00005 });

export interface CanonicalTarget { companyKey: string; linkedinUrl: string }
/** What the record says, for display and ranking (qualification reads `evidence`). */
export interface CanonicalFacts {
  description: string | null;
  hq: { text: string; country: string | null } | null;
  sizeBand: { min: number; max: number | null } | null;
  industry: string | null;
  founded: number | null;
}

export interface CanonicalRun {
  evidence: Map<string, EvidenceItem[]>;
  facts: Map<string, CanonicalFacts>;
  statuses: { companyKey: string; state: "read" | "not_found" | "unavailable" | "skipped_budget" | "no_linkedin"; reason: string | null }[];
  spentUsd: number;
  stopped: string | null;
}

/**
 * Read company records for the targets, one batched run, inside a USD ceiling.
 * The whole batch's worst case must fit, or nothing is bought. A failed run may
 * have been billed: its worst case is counted and nothing is retried.
 */
export async function readCompanyRecords(targets: readonly CanonicalTarget[], invoke: ActorInvoker | null, opts: { maxUsd: number; now: Date; idPrefix: string }): Promise<CanonicalRun> {
  const evidence = new Map<string, EvidenceItem[]>();
  const facts = new Map<string, CanonicalFacts>();
  const statuses: CanonicalRun["statuses"] = [];
  const batch = targets.filter((t) => !!t.linkedinUrl);
  // One company profile is bought once: two records naming the same LinkedIn
  // company (e.g. an identity conflict on the domain) share one URL in the run.
  const slugOf = (u: string) => /linkedin\.com\/company\/([^/?#\s]+)/i.exec(u)?.[1]?.toLowerCase() ?? u.toLowerCase();
  const urls = [...new Map(batch.map((t) => [slugOf(t.linkedinUrl), t.linkedinUrl])).values()];
  for (const t of targets) if (!t.linkedinUrl) statuses.push({ companyKey: t.companyKey, state: "no_linkedin", reason: "no LinkedIn company URL to read the record by" });
  if (!batch.length) return { evidence, facts, statuses, spentUsd: 0, stopped: null };
  if (!invoke) {
    for (const t of batch) statuses.push({ companyKey: t.companyKey, state: "unavailable", reason: "Apify is not connected for this run" });
    return { evidence, facts, statuses, spentUsd: 0, stopped: null };
  }
  const worst = COMPANY_RECORD_ACTOR.perStartUsd + COMPANY_RECORD_ACTOR.perItemUsd * urls.length;
  if (worst > opts.maxUsd + 1e-9) {
    for (const t of batch) statuses.push({ companyKey: t.companyKey, state: "skipped_budget", reason: `worst case $${worst.toFixed(5)} exceeds the $${opts.maxUsd} ceiling` });
    return { evidence, facts, statuses, spentUsd: 0, stopped: "budget" };
  }
  try {
    const run = await invoke(COMPANY_RECORD_ACTOR.key, { companies: urls }, { maxItems: urls.length, idempotencyKey: `${opts.idPrefix}:${COMPANY_RECORD_ACTOR.key}:${batch.map((t) => t.companyKey).sort().join(",")}` });
    const at = opts.now.toISOString();
    const bySlug = new Map<string, Record<string, unknown>>();
    for (const it of run.items) {
      const r = (it ?? {}) as Record<string, unknown>;
      const slug = /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(r.linkedinUrl ?? r.url ?? ""))?.[1]?.toLowerCase();
      if (slug) bySlug.set(slug, r);
    }
    for (const t of batch) {
      const slug = /linkedin\.com\/company\/([^/?#\s]+)/i.exec(t.linkedinUrl)?.[1]?.toLowerCase();
      const row = slug ? bySlug.get(slug) : undefined;
      if (!row) { statuses.push({ companyKey: t.companyKey, state: "not_found", reason: "the record read returned no row for this company" }); continue; }
      const norm = normalizeLinkedInCompanyEnriched(row);
      const hq = (norm.location_entries ?? []).find((l) => l.is_headquarters) ?? null;
      facts.set(t.companyKey, {
        description: norm.description, hq: hq ? { text: hq.text, country: hq.country } : null,
        sizeBand: norm.company_size_band ? { min: norm.company_size_band.min, max: norm.company_size_band.max } : null, industry: norm.provider_industry,
        founded: typeof norm.startup_evidence?.year_founded === "number" ? norm.startup_evidence.year_founded : null,
      });
      const obs = observationFromCompany(norm, {
        capability: "company_details_enrichment", actor_key: COMPANY_RECORD_ACTOR.key, provider: "apify",
        route_id: "lead_pipeline_canonical", plan_version: null, provider_call_id: run.runId ?? null, mission_id: null, observed_at: at,
      });
      evidence.set(t.companyKey, obs.evidence);
      statuses.push({ companyKey: t.companyKey, state: "read", reason: null });
    }
    return { evidence, facts, statuses, spentUsd: run.chargedUsd ?? worst, stopped: null };
  } catch (e) {
    for (const t of batch) statuses.push({ companyKey: t.companyKey, state: "unavailable", reason: `company record read failed (${(e as Error)?.name ?? "error"}); not retried` });
    return { evidence, facts, statuses, spentUsd: worst, stopped: "charge_uncertain" };
  }
}

/**
 * `readCompanyRecords` with a per-workspace evidence cache (evidenceCache.ts, PR #198's
 * design): a company record bought once is reused while fresh, so a second search
 * that meets the same company buys nothing. Only the misses are bought (one batch,
 * same ceiling rule). Cached evidence still passes the identity rule downstream —
 * reuse never lends a record to a company it does not name. A cache that cannot be
 * read is treated as empty; one that cannot be written loses nothing already bought.
 */
export async function readCompanyRecordsCached(
  targets: readonly CanonicalTarget[], invoke: ActorInvoker | null,
  opts: { maxUsd: number; now: Date; idPrefix: string; cache: EvidenceCache | null; workspaceId: string; maxAgeDays?: number; truncateToBudget?: boolean },
): Promise<CanonicalRun & { cached: number; cacheErrors: string[] }> {
  const cacheErrors: string[] = [];
  // Buy only what the ceiling covers; the rest stays needs_verification (never dropped).
  const buy = async (ts: readonly CanonicalTarget[]): Promise<CanonicalRun> => {
    if (!opts.truncateToBudget) return readCompanyRecords(ts, invoke, opts);
    const fits = Math.max(0, Math.floor((opts.maxUsd - COMPANY_RECORD_ACTOR.perStartUsd + 1e-9) / COMPANY_RECORD_ACTOR.perItemUsd));
    const withUrl = ts.filter((t) => !!t.linkedinUrl);
    const over = withUrl.slice(fits);
    const r = await readCompanyRecords(ts.filter((t) => !over.includes(t)), invoke, opts);
    for (const t of over) r.statuses.push({ companyKey: t.companyKey, state: "skipped_budget", reason: `the approved Apify ceiling ($${opts.maxUsd}) is exhausted; left needs_verification` });
    return r;
  };
  if (!opts.cache) return { ...(await buy(targets)), cached: 0, cacheErrors };
  const slug = (u: string) => /linkedin\.com\/company\/([^/?#\s]+)/i.exec(u)?.[1]?.toLowerCase() ?? null;
  const hits = new Map<string, CachedCompanyRecord>();
  for (const t of targets) {
    const s = slug(t.linkedinUrl);
    if (!s || hits.has(t.companyKey)) continue;
    try {
      const r = await opts.cache.get(opts.workspaceId, s);
      if (r && r.workspaceId === opts.workspaceId && isFresh(r, opts.now, opts.maxAgeDays ?? 30)) hits.set(t.companyKey, r);
    } catch (e) { cacheErrors.push(`cache read: ${(e as Error)?.message ?? e}`); }
  }
  const misses = targets.filter((t) => !hits.has(t.companyKey));
  const run = await buy(misses);
  for (const [key, r] of hits) {
    run.evidence.set(key, r.evidence);
    if (r.facts) run.facts.set(key, r.facts);
    run.statuses.push({ companyKey: key, state: "read", reason: `reused from this workspace's evidence cache (observed ${r.observedAt.slice(0, 10)}); not bought again` });
  }
  for (const t of misses) {
    const ev = run.evidence.get(t.companyKey);
    const s = slug(t.linkedinUrl);
    if (!ev?.length || !s) continue;
    try { await opts.cache.put({ workspaceId: opts.workspaceId, slug: s, evidence: ev, facts: run.facts.get(t.companyKey) ?? null, observedAt: ev[0].observed_at }); }
    catch (e) { cacheErrors.push(`cache write: ${(e as Error)?.message ?? e}`); }
  }
  return { ...run, cached: hits.size, cacheErrors };
}
