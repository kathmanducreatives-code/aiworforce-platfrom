// UNIFIED EVIDENCE RETRIEVAL. Reads stored records only — $0, no provider calls.
//
// Authorization first: a caller passes the authenticated user, and the Company
// Brain loader's membership check decides access for the whole retrieval. A
// refusal returns nothing from any source. Service callers that authorized
// upstream pass `skipMembershipCheck` (daily-brief, schedulers), as with the loader.
//
// Every source is read in its own try: one unavailable table degrades to a
// named gap in `sources`, never a thrown request and never a silent empty.

import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "../companyBrainContextLoader.ts";
import { WEB_EVIDENCE_TABLE } from "../webEvidenceStore.ts";
import {
  applyFreshness, classFromBrain, classFromLisa, concerns, dedupeEvidence, rankEvidence,
  type EvidenceItem, type EvidenceSourceType,
} from "./model.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvidenceDb = { from(table: string): any };

export interface RetrieveInput {
  workspaceId: string;
  userId?: string;
  skipMembershipCheck?: boolean;
  /** Narrow to one company. Omitted: the workspace's recent evidence. */
  subject?: { name?: string | null; domain?: string | null } | null;
  now?: Date;
  limit?: number;
}

export type SourceStatus = "ok" | "empty" | "unavailable" | "skipped";

export interface RetrieveResult {
  ok: boolean;
  refused?: "forbidden" | "not_found";
  items: EvidenceItem[];
  sources: Record<EvidenceSourceType, SourceStatus>;
  brain: SharedBrainContext | null;
  cost: { usd: 0; paid_calls: 0 };
}

type Row = Record<string, unknown>;
const o = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? v as Row : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const domainOf = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };

function brainItems(ctx: SharedBrainContext, now: Date): EvidenceItem[] {
  // Approved facts and decisions only — proposals never reach `facts`.
  return [...ctx.facts, ...ctx.decisions].map((m) => {
    const value = typeof m.value === "string" ? m.value : JSON.stringify(m.value);
    // Brain memory is workspace knowledge; `scope_ref` is a record id, never a company name.
    const scopeName = null;
    const retrieved = now.toISOString();
    return {
      id: `company_brain:${m.id}`, workspace_id: ctx.workspace_id, source_type: "company_brain" as const,
      source_url: m.source_url, published_at: null, retrieved_at: retrieved,
      subject: { name: scopeName, domain: null },
      content: `${m.fact_key.replace(/_/g, " ")}: ${value}`,
      verification: classFromBrain(m.verification_status, m.lifecycle_status),
      confidence: m.confidence,
      permissions: { scope: "workspace" as const, workspace_id: ctx.workspace_id },
      provenance: { table: "company_brain_memory", record_id: m.id },
    };
  });
}

function leadItem(r: Row, ws: string, now: Date): EvidenceItem {
  const acct = o(r.accounts);
  const created = s(r.created_at) ?? now.toISOString();
  const status = s(r.status) ?? "unknown";
  const reason = s(r.reason);
  const fit = typeof r.fit_score === "number" ? ` (fit ${r.fit_score})` : "";
  return {
    id: `lead:${r.id}`, workspace_id: ws, source_type: "lead",
    source_url: s(acct.linkedin_url), published_at: null, retrieved_at: created,
    subject: { name: s(acct.name), domain: s(acct.domain) },
    content: `Lead ${status}${fit}${reason ? ` — ${reason}` : ""}`,
    // A fit reason is ATLAS's judgement, not a sourced fact.
    verification: applyFreshness("inference", "lead", { published_at: null, retrieved_at: created }, now),
    confidence: "medium",
    permissions: { scope: "workspace", workspace_id: ws },
    provenance: { table: "lead_candidates", record_id: String(r.id) },
  };
}

function signalItem(r: Row, ws: string, now: Date): EvidenceItem {
  const nv = o(r.normalized_value);
  const lisa = o(nv.lisa);
  const company = o(lisa.company);
  const ver = o(lisa.verification);
  const url = s(r.source_url) ?? s(lisa.source_url);
  const published = s(lisa.event_date) ?? s(r.occurred_at);
  const retrieved = s(r.observed_at) ?? now.toISOString();
  const cls = classFromLisa(s(ver.level), s(r.lifecycle_status), s(r.verification_status));
  const title = s(lisa.title) ?? s(nv.title) ?? s(r.signal_type) ?? "signal";
  const desc = s(lisa.description) ?? s(nv.description);
  const conf = s(ver.confidence) ?? s(r.confidence);
  return {
    id: `lisa_signal:${r.id}`, workspace_id: ws, source_type: "lisa_signal",
    source_url: url, published_at: published, retrieved_at: retrieved,
    subject: { name: s(company.name) ?? s(nv.company_name) ?? s(r.subject_key), domain: s(company.domain) ?? domainOf(url) },
    content: desc ? `${title} — ${desc}` : title,
    verification: applyFreshness(cls, "lisa_signal", { published_at: published, retrieved_at: retrieved }, now),
    confidence: conf === "high" || conf === "low" ? conf : "medium",
    permissions: { scope: "workspace", workspace_id: ws },
    provenance: { table: "signal_events", record_id: String(r.id) },
  };
}

function pageItem(r: Row, ws: string, domain: string, now: Date): EvidenceItem {
  const fetched = s(r.fetched_at) ?? now.toISOString();
  const text = (s(r.source_text) ?? "").slice(0, 400);
  return {
    id: `web_page:${s(r.source_url)}`, workspace_id: ws, source_type: "web_page",
    source_url: s(r.source_url), published_at: null, retrieved_at: fetched,
    subject: { name: null, domain },
    content: `${s(r.page_intent) ?? "page"}: ${text}`,
    // The company's own page: one source, about itself.
    verification: applyFreshness("single_source", "web_page", { published_at: null, retrieved_at: fetched }, now),
    confidence: "medium",
    permissions: { scope: "workspace", workspace_id: ws },
    provenance: { table: WEB_EVIDENCE_TABLE, record_id: String(s(r.source_url)) },
  };
}

export async function retrieveEvidence(db: EvidenceDb, i: RetrieveInput): Promise<RetrieveResult> {
  const now = i.now ?? new Date();
  const limit = Math.min(Math.max(i.limit ?? 20, 1), 50);
  const sources: Record<EvidenceSourceType, SourceStatus> = {
    company_brain: "unavailable", lead: "unavailable", lisa_signal: "unavailable", web_page: "skipped",
  };
  const cost = { usd: 0 as const, paid_calls: 0 as const };

  // AUTHORIZATION. A refusal is final: no source is read.
  let brain: SharedBrainContext | null = null;
  try {
    const r = await loadCompanyBrainContext(db as unknown as LoaderDb, i.workspaceId,
      i.skipMembershipCheck ? { skipMembershipCheck: true, now } : { userId: i.userId, now });
    if (!r.ok) return { ok: false, refused: r.error, items: [], sources, brain: null, cost };
    brain = r.context;
  } catch {
    // The loader could not run. Without a membership answer nothing else may be read.
    if (!i.skipMembershipCheck) return { ok: false, refused: "forbidden", items: [], sources, brain: null, cost };
  }

  const items: EvidenceItem[] = [];
  if (brain) {
    const b = brainItems(brain, now);
    items.push(...b);
    sources.company_brain = b.length ? "ok" : "empty";
  }

  try {
    const { data, error } = await db.from("lead_candidates")
      .select("id, status, fit_score, reason, created_at, accounts(name, domain, linkedin_url)")
      .eq("workspace_id", i.workspaceId).order("created_at", { ascending: false }).limit(100);
    if (!error) {
      const rows = (data ?? []) as Row[];
      items.push(...rows.map((r) => leadItem(r, i.workspaceId, now)));
      sources.lead = rows.length ? "ok" : "empty";
    }
  } catch { /* stays unavailable */ }

  try {
    const { data, error } = await db.from("signal_events")
      .select("id, signal_type, lifecycle_status, verification_status, confidence, occurred_at, observed_at, source_url, subject_key, normalized_value")
      .eq("workspace_id", i.workspaceId).order("observed_at", { ascending: false }).limit(100);
    if (!error) {
      const rows = (data ?? []) as Row[];
      items.push(...rows.map((r) => signalItem(r, i.workspaceId, now)));
      sources.lisa_signal = rows.length ? "ok" : "empty";
    }
  } catch { /* stays unavailable */ }

  // Cached company pages, only for a named domain (already bought; reading is free).
  const domain = s(i.subject?.domain ?? null)?.toLowerCase().replace(/^www\./, "") ?? null;
  if (domain) {
    try {
      const { data, error } = await db.from(WEB_EVIDENCE_TABLE)
        .select("source_url, page_intent, source_text, fetched_at, status")
        .eq("workspace_id", i.workspaceId).eq("domain", domain)
        .order("fetched_at", { ascending: false }).limit(20);
      if (error) sources.web_page = "unavailable";
      else {
        const rows = ((data ?? []) as Row[]).filter((r) => r.status === "ok" && s(r.source_text));
        items.push(...rows.map((r) => pageItem(r, i.workspaceId, domain, now)));
        sources.web_page = rows.length ? "ok" : "empty";
      }
    } catch { sources.web_page = "unavailable"; }
  }

  // Workspace isolation, enforced again on the output: a row from any other
  // workspace (a misconfigured client, a join) is dropped, never served.
  const own = items.filter((x) => x.workspace_id === i.workspaceId);
  const scoped = i.subject && (i.subject.name || i.subject.domain)
    ? own.filter((x) => concerns(x, i.subject!) || (x.source_type === "company_brain" && !x.subject.name))
    : own;
  return { ok: true, items: rankEvidence(dedupeEvidence(scoped)).slice(0, limit), sources, brain, cost };
}
