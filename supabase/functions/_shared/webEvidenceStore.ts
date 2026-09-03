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
    };
  });
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
