// Phase 5 — Signal Feed model (pure, import-free so it's unit-testable).
// Normalizes raw `signals` rows for the feed UI and builds the chat commands
// the action buttons dispatch. No network, no React, no secrets.

export interface RawSignalRow {
  id?: string;
  workspace_id?: string;
  signal_type?: string | null;
  signal_label?: string | null;
  title?: string | null;
  description?: string | null;
  source_url?: string | null;
  source?: string | null;
  created_at?: string | null;
  conversation_id?: string | null;
  plan_id?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface FeedSignal {
  id: string;
  signal_type: string;
  signal_label: string | null;
  title: string;
  description: string | null;
  source_url: string | null;
  source: string | null;
  created_at: string | null;
  // Phase 4 / 4.2 competitor metadata (from raw), surfaced for cards/filters.
  competitor_name: string | null;
  competitor_source: string | null;        // post_content | ai_inferred | seed | …
  competitor_category: string | null;
  competitor_confidence: number | null;     // 0..1 if present
  conversation_type: string | null;
  matched_query: string | null;             // the query that surfaced this signal
  original_business_description: string | null;  // dynamic-discovery context
  original_website_url: string | null;
  priority: string | null;     // hot|warm|maybe|ignore if present in raw
  // Phase 5 polish — additional optional context surfaced from raw (never invented).
  fit_score: number | null;
  account_name: string | null;
  contact_name: string | null;
  role_title: string | null;
  location: string | null;
  post_snippet: string | null;
  reason: string | null;
  matched_icp: string[];
  next_action: string | null;
  status: string | null;
  raw: Record<string, unknown>;
  // Signal-quality classification (computed; reads raw.signal_quality if a
  // backfill already persisted one). Drives the feed default filter + badge.
  quality: SignalQuality;
  quality_badge: string;       // "Hiring signal" | "Needs verification" | "Legacy / Needs verification"
  why_text: string | null;     // why_it_matters, or an honest verification note — never blank
  show_by_default: boolean;     // verified signals only
}

export type SignalQuality = "verified" | "needs_verification" | "legacy";

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  hiring_signal: "Hiring signal",
  linkedin_engagement: "LinkedIn engagement",
  competitor_engagement: "Competitor engagement",
  people_profile: "Person / profile",
  company_research: "Company research",
};

export function signalTypeLabel(t: string | null | undefined): string {
  if (!t) return "Signal";
  return SIGNAL_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function firstStr(...vs: unknown[]): string | null {
  for (const v of vs) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Normalize a raw `signals` row into a feed-ready shape. Never invents data. */
export function normalizeSignalRow(row: RawSignalRow): FeedSignal {
  const raw = (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, unknown> : {};
  const signalType = str(row?.signal_type) ?? "signal";
  const base = {
    id: row?.id ?? "",
    signal_type: signalType,
    signal_label: str(row?.signal_label),
    title: str(row?.title) ?? signalTypeLabel(signalType),
    description: str(row?.description),
    source_url: str(row?.source_url),
    source: str(row?.source),
    created_at: row?.created_at ?? null,
    competitor_name: str(raw["competitor_name"]),
    competitor_source: str(raw["competitor_source"]),
    competitor_category: str(raw["competitor_category"]),
    competitor_confidence: num(raw["competitor_confidence"]),
    conversation_type: str(raw["conversation_type"]),
    matched_query: str(raw["matched_query"]),
    original_business_description: str(raw["original_business_description"]),
    original_website_url: str(raw["original_website_url"]),
    priority: str(raw["priority"]) ?? str(raw["competitor_confidence_label"]),
    fit_score: num(raw["fit_score"]) ?? num(raw["score"]),
    account_name: firstStr(raw["account_name"], raw["company"], raw["company_name"]),
    contact_name: firstStr(raw["contact_name"], raw["person_name"], raw["author"], raw["author_name"]),
    role_title: firstStr(raw["role"], raw["role_title"], raw["title"]),
    location: firstStr(raw["location"], raw["city"], raw["region"]),
    post_snippet: firstStr(raw["post_snippet"], raw["snippet"], raw["post_text"]),
    reason: firstStr(raw["reason"], raw["why"], raw["why_it_matters"]),
    matched_icp: Array.isArray(raw["matched_icp"])
      ? (raw["matched_icp"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    next_action: str(raw["next_action"]),
    status: str(raw["status"]),
    raw,
  };
  const q = classifySignalQuality(base);
  return { ...base, ...q };
}

// ---------- Signal quality (data-trust) classifier ----------

const HIRING_SIGNAL_TYPES = new Set(["hiring_signal", "hiring", "jobs"]);

// Founder-support / assistant roles — these ARE the trustworthy "company is
// scaling ops" hiring signals (Executive Assistant, Founder's Office, Chief of
// Staff, Operations Associate, Founder Associate-ops, …).
const SUPPORT_ROLE_RE =
  /\b(executive assistant|exec(?:utive)? assistant|administrative assistant|admin assistant|personal assistant|virtual assistant|assistant to (?:the )?(?:ceo|founder)|founder'?s?\s+assistant|founder'?s?\s+associate|founder'?s?\s+office|chief of staff|operations?\s+(?:associate|assistant|manager|coordinator|support)|business operations?|ops associate|ops assistant)\b/i;

// Bare founder / C-level / equity-track titles — a "hiring Co-Founder" listing is
// not an operational hiring-demand signal even if it has a real job URL.
const BARE_FOUNDER_EXEC_RE =
  /(\bco-?founders?\b|\bentrepreneur in residence\b|\beir\b|\bchief (?:executive|technology|operating|financial) officer\b|^\s*(?:founders?|ceos?|ctos?|cfos?|coos?|president|owner)\b|\bfuture\b[^,]*\bfounder\b)/i;

type SignalQualityInput = Pick<FeedSignal,
  "signal_type" | "signal_label" | "title" | "source_url" | "reason" | "account_name" | "raw">;

/** The role a hiring signal is about: explicit signal_label, else "X hiring <role>". */
export function parseHiringRole(s: Pick<FeedSignal, "signal_label" | "title">): string {
  if (s.signal_label) return s.signal_label;
  const m = (s.title ?? "").match(/\bhiring\s+(.+)$/i);
  return (m ? m[1] : (s.title ?? "")).trim();
}

function roleClass(role: string): "support" | "founder_exec" | "other" {
  const r = role.toLowerCase();
  if (SUPPORT_ROLE_RE.test(r)) return "support";        // support roles win even if "founder" appears
  if (BARE_FOUNDER_EXEC_RE.test(r)) return "founder_exec";
  return "other";
}

/** A factual why_it_matters derived from a REAL job posting — not fabricated. */
export function computeHiringWhy(role: string, company: string | null): string {
  const co = company ?? "This company";
  return `${co} is hiring a ${role} — an active job posting that signals operational hiring demand and likely founder/ops workload, relevant to AI assistant / workforce-automation tooling.`;
}

/**
 * Classify a hiring signal's trustworthiness. A backfilled raw.signal_quality is
 * trusted when present. Non-hiring signals are passed through as verified.
 */
export function classifySignalQuality(s: SignalQualityInput): {
  quality: SignalQuality; quality_badge: string; why_text: string | null;
  matched_icp: string[]; show_by_default: boolean;
} {
  const raw = (s.raw && typeof s.raw === "object") ? s.raw : {};
  const isHiring = HIRING_SIGNAL_TYPES.has(s.signal_type) || /hiring/i.test(s.signal_type);
  const savedReason = firstStr(raw["why_it_matters"], raw["reason"], raw["why"]) ?? s.reason;

  if (!isHiring) {
    // A persisted verdict (e.g. from the scored hiring/funding radar sources) is
    // authoritative — so a needs_verification funding signal is honestly hidden.
    const savedQ = str(raw["signal_quality"]);
    if (savedQ === "verified" || savedQ === "needs_verification" || savedQ === "legacy") {
      const rawIcp = Array.isArray(raw["matched_icp"])
        ? (raw["matched_icp"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return {
        quality: savedQ,
        quality_badge: savedQ === "verified" ? signalTypeLabel(s.signal_type)
          : savedQ === "needs_verification" ? "Needs verification" : "Legacy / Needs verification",
        why_text: savedReason,
        matched_icp: savedQ === "verified" ? rawIcp : [],
        show_by_default: savedQ === "verified",
      };
    }
    // A scored row without a persisted signal_quality: honor the scorer's
    // verification_status / signal_score when present.
    const verStatus = str(raw["verification_status"]);
    const hasScore = typeof raw["signal_score"] === "number";
    if (verStatus === "verified") {
      const rawIcp = Array.isArray(raw["matched_icp"])
        ? (raw["matched_icp"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return { quality: "verified", quality_badge: signalTypeLabel(s.signal_type), why_text: savedReason, matched_icp: rawIcp, show_by_default: true };
    }
    if (verStatus || hasScore) {
      return { quality: "needs_verification", quality_badge: "Needs verification", why_text: savedReason, matched_icp: [], show_by_default: false };
    }
    // Legacy row: no scorer verdict AND no score → never inflate Top Signals.
    return {
      quality: "legacy",
      quality_badge: "Legacy / Needs verification",
      why_text: savedReason,
      matched_icp: [],
      show_by_default: false,
    };
  }

  const role = parseHiringRole(s) || "a role";
  const cls = roleClass(role);
  const hasJobUrl = !!str(s.source_url) || !!str(raw["job_url"]);
  const hasProof = hasJobUrl || !!str(raw["exact_signal"]) || !!str(raw["job_title"]) || !!savedReason;
  const saved = str(raw["signal_quality"]);

  let quality: SignalQuality;
  let why_text: string | null;
  if (cls === "founder_exec") {
    quality = "needs_verification";
    why_text = savedReason ?? `"${role}" is a founder / co-founder listing, not a confirmed hiring-demand signal — verify it's a real operational role before acting.`;
  } else if (!hasProof) {
    quality = "legacy";
    why_text = savedReason ?? `No job post, source link, or reason saved — this hiring signal can't be verified.`;
  } else if (savedReason) {
    quality = "verified";
    why_text = savedReason;
  } else {
    // Real job posting for a valid role, but no saved reason yet → needs verification.
    quality = "needs_verification";
    why_text = `Real job posting for "${role}", but no saved reason yet — verify before acting.`;
  }

  // A persisted backfill verdict overrides the on-the-fly guess.
  if (saved === "verified" || saved === "needs_verification" || saved === "legacy") quality = saved;

  const quality_badge =
    quality === "verified" ? "Hiring signal"
    : quality === "needs_verification" ? "Needs verification"
    : "Legacy / Needs verification";
  const matched_icp = quality === "verified"
    ? ["Active hiring", cls === "support" ? "Founder-support / assistant role" : role]
    : [];
  return { quality, quality_badge, why_text, matched_icp, show_by_default: quality === "verified" };
}

/**
 * Cleanup/backfill patch for one signals row — merge into `raw` (raw || patch).
 * NEVER deletes; only sets signal_quality + a factual why_it_matters for valid
 * hiring rows. Returns null for non-hiring rows (left untouched).
 */
export function buildSignalQualityPatch(row: RawSignalRow): Record<string, unknown> | null {
  const fs = {
    signal_type: str(row?.signal_type) ?? "signal",
    signal_label: str(row?.signal_label),
    title: str(row?.title),
    source_url: str(row?.source_url),
    reason: null,
    account_name: firstStr((row?.raw ?? {})["account_name"], (row?.raw ?? {})["company"], (row?.raw ?? {})["company_name"]),
    raw: (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, unknown> : {},
  };
  const isHiring = HIRING_SIGNAL_TYPES.has(fs.signal_type) || /hiring/i.test(fs.signal_type);
  if (!isHiring) return null;

  const role = parseHiringRole(fs) || "a role";
  const cls = roleClass(role);
  const hasJobUrl = !!str(fs.source_url) || !!str(fs.raw["job_url"]);
  const savedWhy = firstStr(fs.raw["why_it_matters"], fs.raw["reason"], fs.raw["why"]);
  const hasProof = hasJobUrl || !!str(fs.raw["exact_signal"]) || !!str(fs.raw["job_title"]) || !!savedWhy;

  if (cls === "founder_exec") {
    return { signal_quality: "needs_verification", quality_reason: "founder/co-founder listing — not a hiring-demand signal" };
  }
  if (!hasProof) {
    return { signal_quality: "legacy", quality_reason: "no job/source link to verify" };
  }
  // Valid role + real job posting → verified; compute a factual why if missing.
  const patch: Record<string, unknown> = { signal_quality: "verified" };
  if (!savedWhy) patch["why_it_matters"] = computeHiringWhy(role, fs.account_name);
  patch["matched_icp"] = ["Active hiring", cls === "support" ? "Founder-support / assistant role" : role];
  return patch;
}

export type SignalAction = "draft_comment" | "draft_dm" | "enrich" | "rank" | "create_outreach";

/** A short, safe context string for a signal (no secrets, no fabricated contacts). */
export function signalContext(s: FeedSignal): string {
  const parts = [
    signalTypeLabel(s.signal_type),
    s.competitor_name ? `competitor: ${s.competitor_name}` : null,
    s.account_name ? `company: ${s.account_name}` : null,
    s.title,
    s.source_url,
  ].filter(Boolean);
  return parts.join(" — ").slice(0, 300);
}

/**
 * Build the chat command an action button dispatches via `chat:send`.
 * All actions DRAFT or ASK Pilot — never auto-comment/DM/send.
 */
export function buildActionCommand(action: SignalAction, s?: FeedSignal): string {
  const ctx = s ? signalContext(s) : "";
  switch (action) {
    case "draft_comment":
      return `Draft a thoughtful LinkedIn comment for this signal: ${ctx}`;
    case "draft_dm":
      return `Draft a soft LinkedIn DM for this lead: ${ctx}`;
    case "enrich":
      return `Enrich this lead/account: ${ctx}`;
    case "rank":
      return `Rank these saved signals by fit and urgency.`;
    case "create_outreach":
      return `Draft outreach for this lead using the saved signal context: ${ctx}`;
  }
}

export const PRIORITY_RANK: Record<string, number> = { hot: 0, warm: 1, maybe: 2, ignore: 3 };

/** Extract a friendly host label from a URL (no protocol, no www). */
export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
