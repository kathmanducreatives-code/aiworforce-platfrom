// Signals page · ONE presenter for every signal row (Signals recovery, Phase 3–4).
//
// Pure (no React, no client): the page, its counters, tabs, filters and the generic card all read
// signals through these functions, so a tab, its count and its filter can never disagree.
// Canonical rows (signal_events) carry their provenance in `raw` (signalEventProjection.ts);
// legacy rows show what they have and say what they lack. Nothing here invents a value.
import type { FeedSignal } from "./signalFeedModel";

export type SignalTab = "hiring" | "competitors" | "other";
export type SignalCategoryFilter =
  | "all" | "hiring" | "expansion" | "funding" | "leadership" | "technology" | "launch" | "competitor"
  | "linkedin" | "comments" | "workflows" | "people";
export type ReviewFilter = "all" | "unreviewed" | "reviewed" | "saved" | "ignored";

const HIRING = /hiring|hiring_signal|job/;
const EXPANSION = /expansion|employee_growth|new_location/;
const FUNDING = /funding|recent_funding/;
const LEADERSHIP = /leader|new_revenue_leader|role_changed|person_left/;
const TECHNOLOGY = /technolog|integration|implementation/;
const LAUNCH = /launch|release|product/;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const rawOf = (s: FeedSignal) => (s.raw ?? {}) as Record<string, unknown>;
const lisaOf = (s: FeedSignal) => ((rawOf(s).lisa ?? null) as Record<string, unknown> | null);

/** The category a signal belongs to, from its type (canonical or legacy) and subject. */
export function signalCategory(s: FeedSignal): Exclude<SignalCategoryFilter, "all"> | "other" {
  const t = (s.signal_type ?? "").toLowerCase();
  if (isCompetitorSignal(s)) return "competitor";
  if (HIRING.test(t)) return "hiring";
  if (EXPANSION.test(t)) return "expansion";
  if (FUNDING.test(t)) return "funding";
  if (LEADERSHIP.test(t)) return "leadership";
  if (TECHNOLOGY.test(t)) return "technology";
  if (LAUNCH.test(t)) return "launch";
  if (/linkedin_(intent|engagement|post)/.test(t)) return "linkedin";
  if (/comment/.test(t)) return "comments";
  if (t === "workflow_trend") return "workflows";
  if (/people|decision_maker|profile/.test(t)) return "people";
  return "other";
}

export function isCompetitorSignal(s: FeedSignal): boolean {
  const t = (s.signal_type ?? "").toLowerCase();
  return t === "competitor" || t === "competitor_engagement" || rawOf(s).subject_type === "competitor" || !!str(s.competitor_name);
}

/** The tab a signal lives in (Today shows everything). */
export function signalTab(s: FeedSignal): SignalTab {
  if (isCompetitorSignal(s)) return "competitors";
  return signalCategory(s) === "hiring" ? "hiring" : "other";
}

export function matchesCategory(s: FeedSignal, f: SignalCategoryFilter): boolean {
  return f === "all" || signalCategory(s) === f;
}

export function matchesReview(status: string | null | undefined, f: ReviewFilter): boolean {
  const st = status ?? "new";
  if (f === "all") return st !== "ignored";
  if (f === "unreviewed") return st === "new";
  return st === f;
}

const VERIFICATION_TEXT: Record<string, { label: string; tone: "verified" | "caution" | "unknown" }> = {
  corroborated: { label: "Verified · independent sources agree", tone: "verified" },
  self_reported: { label: "Verified · the company's own announcement", tone: "verified" },
  single_source: { label: "Single source · not yet corroborated", tone: "caution" },
  contradicted: { label: "Contradicted by another source", tone: "caution" },
  provider_verified: { label: "Verified by the data provider", tone: "verified" },
  unverified: { label: "Not verified", tone: "caution" },
};

export interface SignalView {
  id: string;
  store: "signal_events" | "signals";
  category: ReturnType<typeof signalCategory>;
  typeLabel: string;
  title: string;
  company: string | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  sourceType: string | null;
  eventDate: string | null;
  eventDateBasis: string | null;
  detectedAt: string | null;
  verification: { label: string; tone: "verified" | "caution" | "unknown" };
  confidence: string | null;
  relevance: { band: string | null; reasons: string[] };
  excerpt: string | null;
  recommendedAction: string | null;
  /** A synthetic fixture row (fixture mode): never market evidence. */
  isFixture: boolean;
  /** What this row cannot say, stated rather than left blank. */
  gaps: string[];
}

const CATEGORY_LABEL: Record<string, string> = {
  hiring: "Hiring", expansion: "Expansion", funding: "Funding", leadership: "Leadership change", technology: "Technology adoption",
  launch: "Product launch", competitor: "Competitor", linkedin: "LinkedIn activity", comments: "Comments", workflows: "Workflow trend",
  people: "People", other: "Signal",
};

export function signalView(s: FeedSignal): SignalView {
  const raw = rawOf(s);
  const lisa = lisaOf(s);
  const company = str((lisa?.company as Record<string, unknown> | undefined)?.name) ?? str(raw.company_name) ?? s.account_name
    ?? str(s.competitor_name) ?? str(raw.subject_key);
  const level = str((lisa?.verification as Record<string, unknown> | undefined)?.level) ?? str(raw.verification_status);
  const verification = level ? (VERIFICATION_TEXT[level] ?? { label: level.replace(/_/g, " "), tone: "unknown" as const })
    : s.store === "signal_events" ? { label: "Verification unknown", tone: "unknown" as const }
    : { label: "Legacy record · not verified", tone: "caution" as const };
  const rel = (lisa?.relevance ?? {}) as { band?: unknown; reasons?: unknown; recommended_action?: unknown };
  const evidence = Array.isArray(lisa?.evidence) ? (lisa!.evidence as Array<Record<string, unknown>>) : [];
  const excerpt = str(evidence[0]?.excerpt) ?? str(raw.excerpt) ?? s.post_snippet ?? s.description;
  let host: string | null = null;
  try { host = s.source_url ? new URL(s.source_url).hostname.replace(/^www\./, "") : null; } catch { host = null; }
  const category = signalCategory(s);
  const eventDate = str(raw.occurred_at_basis) === "unknown" ? null : (str(lisa?.event_date) ?? str(raw.occurred_at));
  const gaps: string[] = [];
  if (!s.source_url) gaps.push("no source link");
  if (!eventDate) gaps.push("event date unknown");
  if (!company) gaps.push("company not identified");
  return {
    id: s.id, store: s.store === "signal_events" ? "signal_events" : "signals", category,
    typeLabel: CATEGORY_LABEL[category] ?? "Signal",
    title: str(lisa?.title) ?? s.title,
    company, sourceUrl: s.source_url, sourceHost: host,
    sourceType: str((evidence[0] as Record<string, unknown> | undefined)?.source_type) ?? str(raw.source_type) ?? s.source,
    eventDate, eventDateBasis: str(raw.occurred_at_basis),
    detectedAt: s.created_at,
    verification,
    confidence: str(raw.confidence) ?? (typeof s.competitor_confidence === "number" ? `${Math.round(s.competitor_confidence * 100)}%` : null),
    relevance: { band: str(rel.band), reasons: Array.isArray(rel.reasons) ? (rel.reasons as unknown[]).filter((x): x is string => typeof x === "string") : s.matched_icp },
    excerpt,
    recommendedAction: str(rel.recommended_action as unknown) ?? s.next_action ?? null,
    isFixture: (s.source ?? "").toLowerCase() === "fixture" || /\.example\.test\b/.test(s.source_url ?? ""),
    gaps,
  };
}

/** Counters from the SAME classifier the tabs use. */
export function signalCounters(signals: readonly FeedSignal[], reviewStatus: (id: string) => string | null | undefined) {
  return {
    verified: signals.filter((s) => s.show_by_default).length,
    hiring: signals.filter((s) => signalTab(s) === "hiring").length,
    competitor: signals.filter((s) => signalTab(s) === "competitors").length,
    reviewed: signals.filter((s) => { const st = reviewStatus(s.id); return !!st && st !== "new" && st !== "ignored"; }).length,
  };
}
