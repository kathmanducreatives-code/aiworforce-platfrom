// WEB EVIDENCE STORE (P2) — persistence for fetched pages. WRITE ONLY.
//
// P2 writes; P3 reads. The split is deliberate: a cache that is written before
// it is read can be inspected for a phase before anything depends on it, so the
// first mission that reuses a page is reusing rows we have already looked at.
//
// ── PAGES ARE CACHED. CLAIMS ARE NOT. ──────────────────────────────────────
//
// A claim is mission-relative — it answers the question that was asked. A page
// is a fact about the company. Caching pages is what lets a later mission
// asking "software sold to recruiting teams" reuse the fetch that answered
// "B2B SaaS", and draw its own conclusion from the same text. Caching answers
// would defeat that, and is the thing this table exists not to do.
//
// ── WORKSPACE SCOPED ───────────────────────────────────────────────────────
//
// A public page is not confidential, so a global cache would be cheaper. It is
// still a trust decision — one workspace learning which companies another has
// been researching — and it is made explicitly rather than inherited by
// default. Widening it later is a one-line change to the lookup; narrowing it
// after the fact would not be.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalJson, sha256Hex } from "./providerInputFingerprint.ts";
import type { PageIntent, WebEvidencePage } from "./evidenceRequest.ts";

export const WEB_EVIDENCE_TABLE = "company_web_evidence";

/** Truncation bound for stored page text. Matches the tool layer's own cap. */
export const MAX_STORED_TEXT = 6000;

export interface StoredWebEvidenceRow {
  workspace_id: string;
  company_key: string;
  domain: string;
  page_intent: PageIntent;
  source_url: string;
  content_hash: string;
  source_text: string;
  fetched_at: string;
  provider: string;
  provider_run_id: string | null;
  status: string;
  /** WHICH question prompted the fetch. Not an answer to it. */
  requirement_id: string | null;
}

/**
 * How long a fetched page stands before it is worth buying again.
 *
 * Mirrors `DEFAULT_FRESHNESS_HOURS` in `conditionalEnrichmentPlanner` rather
 * than inventing a second policy: positioning pages move slowly, careers pages
 * move with hiring, newsrooms move with announcements.
 */
export const PAGE_TTL_HOURS: Readonly<Record<string, number>> = Object.freeze({
  pricing: 720,
  product: 720,
  homepage: 720,
  about: 720,
  customers: 720,
  case_studies: 720,
  locations: 168,
  newsroom: 168,
  integrations: 336,
  docs: 336,
  careers: 72,
});

export function ttlHoursFor(intent: string): number {
  return PAGE_TTL_HOURS[intent] ?? 720;
}

export function isFresh(fetchedAt: string, intent: string, now: number): boolean {
  const t = Date.parse(fetchedAt);
  if (!isFinite(t)) return false;
  return now - t <= ttlHoursFor(intent) * 3600_000;
}

/**
 * Identity of a page's CONTENT, so an unchanged page re-fetched later is one
 * row rather than two. Hashing the text — not the URL — is what makes the
 * unique index meaningful: the same URL with new content is a new observation
 * and deserves its own row.
 */
export function contentHash(text: string): string {
  return sha256Hex(canonicalJson({ text })).slice(0, 32);
}

export function toStoredRows(i: {
  workspace_id: string;
  company_key: string;
  domain: string;
  requirement_id?: string | null;
  provider_run_id?: string | null;
  pages: readonly WebEvidencePage[];
}): StoredWebEvidenceRow[] {
  return i.pages.map((p) => {
    const text = p.markdown.slice(0, MAX_STORED_TEXT);
    return {
      workspace_id: i.workspace_id,
      company_key: i.company_key,
      domain: i.domain,
      page_intent: p.intent,
      source_url: p.url,
      content_hash: contentHash(text),
      source_text: text,
      fetched_at: p.fetched_at,
      provider: "firecrawl",
      provider_run_id: i.provider_run_id ?? null,
      status: p.status,
      requirement_id: i.requirement_id ?? null,
    };
  });
}

// ─────────────────────────────── the read path ──────────────────────────────

/**
 * Companies already researched for a given requirement, recently enough.
 *
 * THE FIX FOR THE LOOP. Without this the debt gate re-raises the same debt on
 * every slice, because P2 does not change a qualification outcome and so the
 * company stays `insufficient_evidence` for ever. Lineage 40295080 bought 120
 * pages for 24 distinct URLs that way.
 *
 * Returns keys shaped `company_key:requirement_id`, which is exactly what
 * `computeEvidenceDebts` takes as `already_researched`.
 *
 * NEVER THROWS. A cache that cannot be read must not stop a mission; it degrades
 * to the previous behaviour of researching again, which is wasteful but correct.
 */
export async function readResearchedRequirements(
  db: SupabaseClient,
  i: {
    workspace_id: string;
    pairs: ReadonlyArray<{ company_key: string; requirement_id: string }>;
    now?: number;
  },
): Promise<ReadonlySet<string>> {
  const out = new Set<string>();
  if (i.pairs.length === 0) return out;
  const now = i.now ?? Date.now();
  try {
    const { data, error } = await db
      .from(WEB_EVIDENCE_TABLE)
      .select("company_key,requirement_id,page_intent,fetched_at,status")
      .eq("workspace_id", i.workspace_id)
      .in("company_key", [...new Set(i.pairs.map((p) => p.company_key))]);
    if (error || !data) return out;
    const wanted = new Set(i.pairs.map((p) => `${p.company_key}:${p.requirement_id}`));
    for (const r of data as Array<Record<string, string>>) {
      const key = `${r.company_key}:${r.requirement_id}`;
      if (!wanted.has(key)) continue;
      // A STALE ROW IS NOT A RESEARCHED REQUIREMENT. Freshness is the whole
      // reason the debt may legitimately be raised a second time.
      if (!isFresh(r.fetched_at, r.page_intent, now)) continue;
      out.add(key);
    }
  } catch {
    return out;
  }
  return out;
}

export interface CachedPage {
  source_url: string;
  page_intent: string;
  source_text: string;
  fetched_at: string;
  status: string;
}

/**
 * Fresh pages already held for a site.
 *
 * Keyed on (domain, page_intent) — NOT on the requirement — so a mission asking
 * a different question reuses the same fetch. That is the property the whole
 * "cache pages, not answers" decision exists to buy.
 *
 * Only `ok` rows are returned: a 404 body is recorded for provenance but must
 * never be served back as though it were a page.
 */
export async function readFreshPages(
  db: SupabaseClient,
  i: { workspace_id: string; domain: string; now?: number },
): Promise<Map<string, CachedPage>> {
  const out = new Map<string, CachedPage>();
  const now = i.now ?? Date.now();
  try {
    const { data, error } = await db
      .from(WEB_EVIDENCE_TABLE)
      .select("source_url,page_intent,source_text,fetched_at,status")
      .eq("workspace_id", i.workspace_id)
      .eq("domain", i.domain)
      .eq("status", "ok")
      .order("fetched_at", { ascending: false })
      .limit(50);
    if (error || !data) return out;
    for (const r of data as unknown as CachedPage[]) {
      if (out.has(r.page_intent)) continue;          // newest wins
      if (!isFresh(r.fetched_at, r.page_intent, now)) continue;
      out.set(r.page_intent, r);
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * Persist fetched pages.
 *
 * NEVER THROWS. Evidence collection is an enhancement bolted onto a working
 * pipeline: a cache write that fails must not fail the mission that paid for
 * the page. The caller logs the outcome and carries on with the claims it
 * already has in memory.
 */
export async function writeWebEvidence(
  db: SupabaseClient,
  rows: readonly StoredWebEvidenceRow[],
): Promise<{ written: number; error: string | null }> {
  if (rows.length === 0) return { written: 0, error: null };
  try {
    const { error } = await db
      .from(WEB_EVIDENCE_TABLE)
      // A repeated fetch of unchanged content collides on
      // (workspace, domain, intent, content_hash) and is ignored rather than
      // duplicated — the row already says what this one would.
      .upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: "workspace_id,domain,page_intent,content_hash",
        ignoreDuplicates: true,
      });
    if (error) return { written: 0, error: error.message };
    return { written: rows.length, error: null };
  } catch (e) {
    return { written: 0, error: String(e) };
  }
}
