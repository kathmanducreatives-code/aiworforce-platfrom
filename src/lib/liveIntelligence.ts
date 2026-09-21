// LIVE INTELLIGENCE — what the dashboard bar is allowed to say, and in what order.
//
//   signal_events → FeedSignal (signalEventProjection) → [this file] → LiveItem[]
//
// ── THE RULES ──────────────────────────────────────────────────────────────
//
// 1. NOTHING IS INVENTED. Every headline and context fragment is a field the
//    backend stored. A row with no headline and no company is skipped, not
//    filled in. No model is called to write copy.
// 2. SAME TRUST BAR AS THE SIGNALS PAGE. Only canonical, verified rows qualify
//    (`show_by_default`, the page's own default). Unverified rows are used only
//    when too few verified ones exist, and they say so.
// 3. RANKED, NOT RANDOM. priority × ICP fit × freshness × relevance × confidence,
//    all read from real columns. Freshness uses when the event HAPPENED
//    (`occurred_at`), never when Agentory noticed it.
// 4. VARIETY WITHOUT NOISE. One slot per company; never three of one type in a
//    row; repeated patterns across companies become ONE trend item — and only
//    when the loaded data actually covers the window the trend claims.
//
// PURE. `now` is an input. Deno-testable.

import { signalTypeLabel, type FeedSignal } from "./signalFeedModel.ts";

export const LIVE_MAX_ITEMS = 12;
/** Below this many verified signals, unverified ones may fill in — labelled. */
export const LIVE_MIN_VERIFIED = 3;
export const TREND_MIN_COMPANIES = 5;
/**
 * ICP fit is shown only when it argues FOR the signal. Measured on the live
 * workspace (Sept 2026) fit ran 35–53; printing "ICP fit 40" would advertise a
 * weak match as a reason to look.
 */
export const FIT_SHOW_MIN = 60;
const DAY_MS = 86_400_000;
const FRESHNESS_HALF_LIFE_H = 48;

/**
 * Types that are true but are not intelligence worth surfacing on a home page:
 * they describe decay (someone left, a company went quiet) rather than an
 * opportunity.
 */
export const EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  "person_left_company", "company_inactive", "company_outside_icp", "signal_became_stale",
]);

/** A cluster, as far as ranking needs one. Structural, so no feed module is imported. */
export interface RankingCluster { key: string; events: ReadonlyArray<{ id?: string | null }> }
export interface RankingVerdict { relevance: string }

export interface LiveSignalItem {
  kind: "signal";
  key: string;
  typeLabel: string;
  headline: string;
  company: string | null;
  location: string | null;
  fit: number | null;
  /** When Agentory detected it — the only time the bar calls "detected". */
  detectedAt: string | null;
  verified: boolean;
  /** Other qualifying signals about the same company, folded into this slot. */
  moreAtCompany: number;
  score: number;
  signal: FeedSignal;
}

export interface LiveTrendItem {
  kind: "trend";
  key: string;
  typeLabel: string;
  headline: string;
  companies: number;
  /** Week-over-week change in %, only when both weeks are fully covered. */
  changePct: number | null;
  score: number;
}

export type LiveItem = LiveSignalItem | LiveTrendItem;

export interface RankInput {
  signals: readonly FeedSignal[];
  clusters?: readonly RankingCluster[];
  relevance?: Readonly<Record<string, RankingVerdict>>;
  /** Signal ids the user dismissed in `signal_reviews`. */
  ignoredIds?: ReadonlySet<string>;
  /**
   * True when `signals` is every active row the workspace has (the read was not
   * truncated). Trends compare weeks only when the loaded data covers them.
   */
  complete: boolean;
  now: number;
}

// ── small readers ──────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/**
 * A company NAME fit to print — never an identifier. A competitor row without
 * `company_name` carries only its `subject_key` (e.g. "outreach"), which the
 * projection copies into `competitor_name`; that is a key, not a name.
 */
function companyOf(s: FeedSignal): string | null {
  const raw = s.raw ?? {};
  return str(raw.company_name) ?? s.account_name ?? null;
}

/** Who a signal is about, for grouping: the name when there is one, else the subject. */
function companyKeyOf(s: FeedSignal): string | null {
  const raw = s.raw ?? {};
  const name = companyOf(s);
  if (name) return `name:${name.toLowerCase()}`;
  const subject = str(raw.subject_key);
  return subject ? `${str(raw.subject_type) ?? "subject"}:${subject.toLowerCase()}` : null;
}

/** The event's own time when the source reported one; otherwise when we saw it. */
export function eventTimeOf(s: FeedSignal): number | null {
  const raw = s.raw ?? {};
  const occurred = raw.occurred_at_basis !== "unknown" ? time(str(raw.occurred_at)) : null;
  return occurred ?? time(s.created_at);
}

/** What the bar can show as a headline, or null when the row cannot honestly carry one. */
export function headlineOf(s: FeedSignal): string | null {
  const label = signalTypeLabel(s.signal_type);
  const title = str(s.title);
  // The projection falls back to the type label when a row has no title; that
  // is not a headline, it is a category.
  if (title && title.toLowerCase() !== label.toLowerCase()) return title;
  const company = companyOf(s);
  return company ? `${company} · ${label}` : null;
}

// ── scoring ────────────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = { hot: 1, warm: 0.75, maybe: 0.45 };
const CONFIDENCE_WEIGHT: Record<string, number> = { high: 1, medium: 0.85, low: 0.7 };
const RELEVANCE_WEIGHT: Record<string, number> = { high: 1.15, medium: 1, low: 0.8, none: 0.5 };

export function freshnessWeight(eventTime: number | null, now: number): number {
  if (eventTime === null) return 0.15;
  const ageH = Math.max(0, now - eventTime) / 3_600_000;
  return Math.max(0.15, Math.pow(0.5, ageH / FRESHNESS_HALF_LIFE_H));
}

export function scoreSignal(s: FeedSignal, verdict: string | null, now: number): number {
  const raw = s.raw ?? {};
  const priority = PRIORITY_WEIGHT[(s.priority ?? "").toLowerCase()] ?? 0.6;
  const fit = s.fit_score === null ? 0.55 : clamp(s.fit_score / 100, 0.3, 1);
  const confidence = CONFIDENCE_WEIGHT[(str(raw.confidence) ?? "").toLowerCase()] ?? 0.85;
  const relevance = verdict ? RELEVANCE_WEIGHT[verdict] ?? 1 : 1;
  return priority * fit * freshnessWeight(eventTimeOf(s), now) * relevance * confidence;
}

// ── selection ──────────────────────────────────────────────────────────────

function isCandidate(s: FeedSignal, ignored: ReadonlySet<string>): boolean {
  if (s.store !== "signal_events") return false;          // legacy rows carry no subject model
  if (ignored.has(s.id)) return false;
  if ((s.priority ?? "").toLowerCase() === "ignore") return false;
  if (EXCLUDED_TYPES.has(s.signal_type)) return false;
  if (s.quality === "legacy") return false;
  return headlineOf(s) !== null;
}

function verdictIndex(clusters: readonly RankingCluster[], relevance: Readonly<Record<string, RankingVerdict>>) {
  const byEvent = new Map<string, string>();
  for (const c of clusters) {
    const v = relevance[c.key]?.relevance;
    if (!v) continue;
    for (const e of c.events) if (e.id) byEvent.set(e.id, v);
  }
  return byEvent;
}

/** Never three of one type in a row: pull the next different type forward. */
function spreadTypes<T extends { typeLabel: string }>(items: T[]): T[] {
  const out = [...items];
  for (let i = 2; i < out.length; i++) {
    if (out[i].typeLabel !== out[i - 1].typeLabel || out[i - 1].typeLabel !== out[i - 2].typeLabel) continue;
    const j = out.findIndex((x, k) => k > i && x.typeLabel !== out[i].typeLabel);
    if (j === -1) break;
    const [moved] = out.splice(j, 1);
    out.splice(i, 0, moved);
  }
  return out;
}

/**
 * A pattern across companies, stated only as far as the data reaches.
 *
 * Distinct companies per type over the last 7 days. The week-over-week number
 * appears only when the loaded rows are the complete active set — otherwise the
 * "previous week" might simply be the part of the history we did not load.
 */
export function detectTrends(candidates: readonly FeedSignal[], complete: boolean, now: number): LiveTrendItem[] {
  const groups = new Map<string, { label: string; thisWeek: Set<string>; lastWeek: Set<string> }>();
  for (const s of candidates) {
    const t = eventTimeOf(s);
    const company = companyKeyOf(s);
    if (t === null || !company) continue;
    const label = signalTypeLabel(s.signal_type);
    const g = groups.get(label) ?? { label, thisWeek: new Set(), lastWeek: new Set() };
    const age = now - t;
    if (age >= 0 && age < 7 * DAY_MS) g.thisWeek.add(company);
    else if (age >= 7 * DAY_MS && age < 14 * DAY_MS) g.lastWeek.add(company);
    groups.set(label, g);
  }
  const trends: LiveTrendItem[] = [];
  for (const g of groups.values()) {
    const n = g.thisWeek.size;
    if (n < TREND_MIN_COMPANIES) continue;
    const prev = g.lastWeek.size;
    const changePct = complete && prev >= 3 ? Math.round(((n - prev) / prev) * 100) : null;
    trends.push({
      kind: "trend",
      key: `trend:${g.label}`,
      typeLabel: g.label,
      headline: `${n} companies showed ${g.label.toLowerCase()} signals this week`,
      companies: n,
      changePct: changePct !== null && Math.abs(changePct) >= 15 ? changePct : null,
      score: 0,
    });
  }
  return trends.sort((a, b) => b.companies - a.companies).slice(0, 2);
}

export function rankLiveItems(input: RankInput): LiveItem[] {
  const ignored = input.ignoredIds ?? new Set<string>();
  const verdicts = verdictIndex(input.clusters ?? [], input.relevance ?? {});
  const candidates = input.signals.filter((s) => isCandidate(s, ignored));

  let pool = candidates.filter((s) => s.show_by_default);
  const verifiedCount = pool.length;
  if (verifiedCount < LIVE_MIN_VERIFIED) {
    pool = [...pool, ...candidates.filter((s) => !s.show_by_default && s.quality === "needs_verification")];
  }

  const scored = pool
    .map((s) => ({ s, score: scoreSignal(s, verdicts.get(s.id) ?? null, input.now) * (s.show_by_default ? 1 : 0.6) }))
    .sort((a, b) => b.score - a.score || (eventTimeOf(b.s) ?? 0) - (eventTimeOf(a.s) ?? 0));

  // One slot per company: the strongest signal speaks for it, the rest are counted.
  const byCompany = new Map<string, LiveSignalItem>();
  const items: LiveSignalItem[] = [];
  for (const { s, score } of scored) {
    const company = companyOf(s);
    const companyKey = companyKeyOf(s) ?? `id:${s.id}`;
    const existing = byCompany.get(companyKey);
    if (existing) { existing.moreAtCompany++; continue; }
    const raw = s.raw ?? {};
    const item: LiveSignalItem = {
      kind: "signal",
      key: s.id,
      typeLabel: signalTypeLabel(s.signal_type),
      headline: headlineOf(s)!,
      company,
      location: str(raw.company_location) ?? s.location,
      fit: num(s.fit_score),
      detectedAt: s.created_at,
      verified: s.show_by_default,
      moreAtCompany: 0,
      score,
      signal: s,
    };
    byCompany.set(companyKey, item);
    items.push(item);
  }

  const signals = spreadTypes(items).slice(0, LIVE_MAX_ITEMS);
  const trends = detectTrends(candidates.filter((s) => s.show_by_default), input.complete, input.now);
  // A trend earns roughly every fifth slot, never the first.
  const out: LiveItem[] = [...signals];
  trends.forEach((t, i) => out.splice(Math.min(out.length, 3 + i * 5), 0, t));
  return out.slice(0, LIVE_MAX_ITEMS);
}

// ── presentation helpers ───────────────────────────────────────────────────

export function formatAgo(iso: string | null | undefined, now: number): string | null {
  const t = time(iso);
  if (t === null) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The quiet second line: only facts the row carries, joined by " · ".
 * `markUnverified: false` when the bar already says so once for every item —
 * repeating "Needs review" on each line is noise, not honesty.
 */
export function contextOf(item: LiveItem, now: number, opts: { markUnverified?: boolean } = {}): string {
  if (item.kind === "trend") {
    return item.changePct !== null
      ? `${item.changePct > 0 ? "↑" : "↓"}${Math.abs(item.changePct)}% vs last week`
      : "Across your monitored market";
  }
  const parts: string[] = [];
  if (item.fit !== null && item.fit >= FIT_SHOW_MIN) parts.push(`ICP fit ${Math.round(clamp(item.fit, 0, 100))}`);
  if (item.location) parts.push(item.location);
  if (!item.verified && opts.markUnverified !== false) parts.push("Needs review");
  const ago = formatAgo(item.detectedAt, now);
  if (ago) parts.push(`Detected ${ago}`);
  if (item.moreAtCompany > 0) parts.push(item.company ? `+${item.moreAtCompany} more at ${item.company}` : `+${item.moreAtCompany} related`);
  return parts.join(" · ");
}

/**
 * Which arriving signal, if any, deserves the arrival ripple: the best-ranked
 * item that is one of the new rows. A new row that did not rank into the bar
 * joins the pool silently — arriving is not the same as mattering.
 */
export function incomingHighlight(items: readonly LiveItem[], newIds: ReadonlySet<string>): LiveSignalItem | null {
  for (const item of items) if (item.kind === "signal" && newIds.has(item.key)) return item;
  return null;
}

/** True when nothing on the bar is verified — the bar then says so once. */
export function allUnverified(items: readonly LiveItem[]): boolean {
  const s = items.filter((i): i is LiveSignalItem => i.kind === "signal");
  return s.length > 0 && s.every((i) => !i.verified);
}

/**
 * THE LAST GATE before a realtime row reaches the bar.
 *
 * RLS and the channel filter already scope delivery to the workspace; this
 * checks again on the client, because a stale channel from a workspace the
 * person just switched away from must not paint the new workspace's dashboard.
 */
export function acceptArrival(
  row: { workspace_id?: string | null; lifecycle_status?: string | null; id?: string | null } | null | undefined,
  workspaceId: string | null,
): boolean {
  if (!row || !workspaceId || !row.id) return false;
  if (row.workspace_id !== workspaceId) return false;
  return (row.lifecycle_status ?? "active") === "active";
}

/** Newly arrived rows first, never duplicated. */
export function mergeArrivals(current: readonly FeedSignal[], arrivals: readonly FeedSignal[]): FeedSignal[] {
  const seen = new Set(current.map((s) => s.id));
  const fresh = arrivals.filter((s) => s.id && !seen.has(s.id));
  return fresh.length ? [...fresh, ...current] : [...current];
}
