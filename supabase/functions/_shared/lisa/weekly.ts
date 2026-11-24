// LISA V2 — WHAT DOWNSTREAM SEES: the agent contract and the weekly top 5.
//
// A stored signal_events row with a `normalized_value.lisa` block becomes an
// AgentSignal: what happened, which company, when, the evidence links, the
// verification level, the lifecycle, why it is relevant, why now, how sure we
// are and the next step. ORION and the weekly digest both read THIS, so they
// cannot disagree about whether a claim is supported.
//
// BRAIN CHANGES. Relevance carries the Brain fingerprint it was judged
// against. When the workspace's current fingerprint differs, relevance is
// RECOMPUTED here (deterministic, no model call, no write) and the item says
// so (`relevance_recomputed: true`). With no Brain loaded the stored verdict is
// shown and flagged `relevance_outdated`.
//
// THE WEEKLY TOP 5 never pads. An item qualifies only if it is active (not
// stale, expired, contradicted, retracted or dismissed), verified by counting
// (corroborated or self-reported), carries a real source URL, is not excluded
// by the Brain and scores at least WEEKLY_MIN_SCORE. Fewer than five qualifying
// items → fewer than five items, with the reason. No outreach, no actions.
//
// PURE.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { evaluateRelevance } from "./relevance.ts";
import { isStale } from "./verify.ts";
import type { LisaCategory, LisaSignal, Relevance, Verification } from "./types.ts";

export const WEEKLY_MAX_ITEMS = 5;
export const WEEKLY_MIN_SCORE = 45;
export const WEEKLY_WINDOW_DAYS = 14;

export interface StoredSignalRow {
  id: string;
  workspace_id: string;
  signal_type: string;
  lifecycle_status: string;
  verification_status: string;
  confidence: string | null;
  occurred_at: string | null;
  observed_at: string;
  source_url: string | null;
  subject_type: string | null;
  subject_key: string | null;
  normalized_value: Record<string, unknown> | null;
}

export interface AgentSignal {
  id: string;
  company: { name: string; domain: string | null };
  category: LisaCategory;
  what_happened: string;
  event_date: string | null;
  discovered_at: string;
  evidence: Array<{ url: string; domain: string }>;
  source_url: string | null;
  verification: Verification["level"];
  independent_sources: number;
  contradictions: string[];
  lifecycle: string;
  /** current = usable as a fact; anything else must not be presented as current. */
  currency: "current" | "stale" | "contradicted" | "retracted" | "dismissed" | "expired";
  confidence: "high" | "medium" | "low";
  relevance: Relevance;
  relevance_recomputed: boolean;
  relevance_outdated: boolean;
  /** How the Company Brain shaped this item (reasons that came from it). */
  brain_influence: string[];
  why_now: string;
  why_it_matters: string;
  suggested_action: string;
}

const isLisa = (r: StoredSignalRow) => !!(r.normalized_value as { lisa?: unknown } | null)?.lisa;

/** Rebuild enough of a LisaSignal from a stored row to re-run relevance. */
function asSignal(r: StoredSignalRow, lisa: Record<string, unknown>): LisaSignal {
  const company = (lisa.company ?? {}) as { name?: string; domain?: string | null };
  const evidence = Array.isArray(lisa.evidence) ? lisa.evidence as LisaSignal["evidence"] : [];
  return {
    workspace_id: r.workspace_id, category: lisa.category as LisaCategory, signal_type: r.signal_type, signal_category: "",
    subject_type: r.subject_type === "competitor" ? "competitor" : "company", subject_key: r.subject_key ?? "",
    company_name: company.name ?? r.subject_key ?? "", company_domain: company.domain ?? null,
    title: String(lisa.title ?? ""), description: String(lisa.description ?? ""), event_date: (lisa.event_date as string) ?? null,
    discovered_at: String(lisa.discovered_at ?? r.observed_at), source_url: r.source_url ?? "", source_type: (lisa.source_type as LisaSignal["source_type"]) ?? "news",
    evidence, verification: lisa.verification as Verification, relevance: (lisa.relevance as Relevance) ?? null,
    dedupe_key: "", event_instance: String(lisa.event_instance ?? ""), lifecycle_status: "active",
    collection_method: (lisa.collection_method as LisaSignal["collection_method"]) ?? "lisa_v2_scheduled", provider: "",
    processing_status: "duplicate", watch_origin: (lisa.watch_origin as LisaSignal["watch_origin"]) ?? "watchlist",
  };
}

function currencyOf(r: StoredSignalRow, category: LisaCategory, eventDate: string | null, now: Date): AgentSignal["currency"] {
  switch (r.lifecycle_status) {
    case "retracted": return "retracted";
    case "contradicted": return "contradicted";
    case "dismissed": case "archived": case "superseded": return "dismissed";
    case "expired": return "expired";
    case "stale": return "stale";
  }
  return isStale(category, eventDate, now) ? "stale" : "current";
}

/** The downstream contract for one stored row, or null for a non-LISA row. */
export function toAgentSignal(r: StoredSignalRow, brain: SharedBrainContext | null, now: Date, evidenceRows: Array<{ url: string; domain: string }> = []): AgentSignal | null {
  if (!isLisa(r)) return null;
  const lisa = (r.normalized_value as { lisa: Record<string, unknown> }).lisa;
  const s = asSignal(r, lisa);
  const ver = (lisa.verification ?? { level: "single_source", independent_sources: 0, contradictions: [], confidence: "low" }) as Verification;
  let relevance = s.relevance;
  let recomputed = false;
  let outdated = false;
  if (brain && (!relevance || relevance.brain_fingerprint !== brain.fingerprint)) {
    relevance = evaluateRelevance({ ...s, verification: ver }, brain, { kind: s.subject_type === "competitor" ? "competitor" : "tracked_company", origin: s.watch_origin }, now);
    recomputed = true;
  } else if (!brain && relevance?.brain_fingerprint) {
    outdated = true;
  }
  if (!relevance) {
    relevance = evaluateRelevance({ ...s, verification: ver }, null, { kind: "tracked_company", origin: s.watch_origin }, now);
  }
  const brain_influence = relevance.reasons.filter((x) => /Company Brain|target industry|target geography|your goal|competitor in your/i.test(x));
  // Evidence links come from signal_event_evidence rows only — never synthesized from domain names.
  const evidence = evidenceRows.filter((e) => /^https?:\/\//.test(e.url));
  return {
    id: r.id, company: { name: s.company_name, domain: s.company_domain }, category: s.category,
    what_happened: s.title || s.description, event_date: s.event_date, discovered_at: s.discovered_at,
    evidence, source_url: r.source_url, verification: ver.level, independent_sources: ver.independent_sources ?? 0,
    contradictions: ver.contradictions ?? [], lifecycle: r.lifecycle_status,
    currency: currencyOf(r, s.category, s.event_date, now), confidence: (ver.confidence ?? "low"),
    relevance, relevance_recomputed: recomputed, relevance_outdated: outdated, brain_influence,
    why_now: relevance.why_now, why_it_matters: relevance.why_it_matters, suggested_action: relevance.suggested_action,
  };
}

/** May ORION / the digest present this as a current, supported business fact? */
export function isElevatable(a: AgentSignal): boolean {
  return a.currency === "current" && (a.verification === "corroborated" || a.verification === "self_reported")
    && !!a.source_url && a.relevance.band !== "excluded";
}

export interface WeeklyItem {
  signal_id: string;
  company: string;
  signal: string;
  category: LisaCategory;
  event_date: string | null;
  why_now: string;
  why_it_matters: string;
  evidence: Array<{ url: string; domain: string }>;
  source_url: string;
  suggested_action: string;
  confidence: "high" | "medium" | "low";
  verification: Verification["level"];
  relevance_score: number;
}

export interface WeeklyDigest {
  workspace_id: string;
  generated_at: string;
  brain_fingerprint: string | null;
  items: WeeklyItem[];
  considered: number;
  excluded: Partial<Record<"not_current" | "unverified" | "no_source" | "excluded" | "low_relevance" | "outside_window", number>>;
  note: string | null;
}

export function weeklyDigest(workspace_id: string, rows: StoredSignalRow[], brain: SharedBrainContext | null, now: Date,
  evidenceFor: (id: string) => Array<{ url: string; domain: string }> = () => []): WeeklyDigest {
  const excluded: WeeklyDigest["excluded"] = {};
  const bump = (k: keyof WeeklyDigest["excluded"]) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const cutoff = now.getTime() - WEEKLY_WINDOW_DAYS * 86_400_000;
  const items: Array<WeeklyItem & { _t: number }> = [];
  let considered = 0;
  for (const r of rows) {
    const a = toAgentSignal(r, brain, now, evidenceFor(r.id));
    if (!a) continue;
    considered++;
    if (Date.parse(a.discovered_at) < cutoff) { bump("outside_window"); continue; }
    if (a.currency !== "current") { bump("not_current"); continue; }
    if (a.relevance.band === "excluded") { bump("excluded"); continue; }
    if (a.verification !== "corroborated" && a.verification !== "self_reported") { bump("unverified"); continue; }
    if (!a.source_url || !/^https?:\/\//.test(a.source_url)) { bump("no_source"); continue; }
    if (a.relevance.score < WEEKLY_MIN_SCORE) { bump("low_relevance"); continue; }
    items.push({
      signal_id: a.id, company: a.company.name, signal: a.what_happened, category: a.category, event_date: a.event_date,
      why_now: a.why_now, why_it_matters: a.why_it_matters, evidence: a.evidence, source_url: a.source_url,
      suggested_action: a.suggested_action, confidence: a.confidence, verification: a.verification, relevance_score: a.relevance.score,
      _t: Date.parse(a.event_date ?? a.discovered_at) || 0,
    });
  }
  items.sort((x, y) => y.relevance_score - x.relevance_score || y._t - x._t || x.signal_id.localeCompare(y.signal_id));
  const top = items.slice(0, WEEKLY_MAX_ITEMS).map(({ _t, ...rest }) => rest);
  const noBrain = !brain || brain.status === "missing";
  const note = noBrain
    ? "No Company Brain: only companies you explicitly watch can rank; relevance to your ICP and goals is not known."
    : top.length === 0 ? "Nothing this week met the bar: verified, current, sourced and relevant to your Company Brain."
    : top.length < WEEKLY_MAX_ITEMS ? `Only ${top.length} item${top.length === 1 ? "" : "s"} met the bar this week; LISA does not pad with weak signals.`
    : null;
  return { workspace_id, generated_at: now.toISOString(), brain_fingerprint: brain?.fingerprint ?? null, items: top, considered, excluded, note };
}
