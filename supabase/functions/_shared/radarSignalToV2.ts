// RADAR'S PERSISTED SIGNAL → A CANONICAL `signal_events` ROW.
//
// Pure. No database, no network — so what this claims can be proven offline
// against the rows Radar actually writes.
//
// ── WHY THIS IS A TRANSLATION AND NOT A COPY ────────────────────────────────
//
// Radar persists a FEED vocabulary: `competitor`, `linkedin_intent`,
// `workflow_trend`. Those name filter chips, not facts. `competitor` says "this
// is about a competitor", not what the competitor did — so mapping it to
// `major_release` because a page title mentions a release would assert a
// classification Radar never made.
//
// The canonical types here therefore say only what Radar establishes:
//
//     competitor_activity        a named competitor was publicly active
//     market_problem_discussion  the problem space is being publicly discussed
//
// Both are `market` category: never a claim about a prospect.
//
// ── WHAT IS DELIBERATELY NOT MAPPED ─────────────────────────────────────────
//
// `hiring` and `funding` are about a specific company, and Radar resolves
// neither the company's identity nor — for hiring — which role family the
// posting belongs to. Writing them would require inventing one or both. They
// are refused with a stated reason and counted, so the gap stays visible rather
// than looking like an empty result.

import { normalizeSourceUrlKey } from "./signalsV2DualWrite.ts";
import { canonicalSubjectKey, type SubjectType } from "./signalSubject.ts";
import type { SignalOrigin } from "./signalOrigin.ts";
import type { SignalEventV2Input } from "./signalsV2Writer.ts";

/** A row as persisted by Radar into `public.signals`, plus its id. */
export interface RadarLegacyRow {
  id?: string | null;
  workspace_id: string;
  signal_type: string;
  title?: string | null;
  source?: string | null;
  source_url?: string | null;
  confidence?: number | string | null;
  raw?: Record<string, unknown> | null;
}

export type RadarV2SkipReason =
  /** hiring/funding/manual — needs company identity, and for hiring a role family. */
  | "unsupported_signal_type"
  /** A competitor row whose competitor cannot be determined from the evidence. */
  | "subject_unresolved";

export type RadarV2MapResult =
  | { ok: true; input: SignalEventV2Input }
  | { ok: false; reason: RadarV2SkipReason };

/**
 * Market subjects, keyed by the plan category that produced the evidence.
 *
 * Coarse on purpose. Radar does not thread the Company Brain topic that
 * generated a query onto the persisted row, so the honest available subject is
 * the problem space the category represents. Refining this means carrying the
 * topic through the scan plan — a change to Radar, not a guess to make here.
 */
const MARKET_SUBJECT_KEY: Readonly<Record<string, string>> = {
  linkedin_intent: "buyer-intent",
  linkedin_comment: "buyer-intent",
  linkedin_post: "buyer-intent",
  workflow_trend: "workflow-trends",
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/**
 * Which competitor is this evidence about?
 *
 * The URL's host is evidence; the match list is a set of candidates. A page on
 * `outreach.io` is about Outreach even when the row also matched Unify. With no
 * host agreement and more than one candidate the answer is genuinely unknown,
 * and the row is refused rather than attributed to whichever came first.
 */
export function resolveCompetitorKey(
  matched: readonly string[], source_url: string | null | undefined,
): string | null {
  const keys = matched.map((m) => canonicalSubjectKey(m)).filter((k): k is string => !!k);
  if (keys.length === 0) return null;
  const host = normalizeSourceUrlKey(source_url).split("/")[0] ?? "";
  const hostKey = canonicalSubjectKey(host);
  if (hostKey) {
    const onHost = keys.filter((k) => hostKey.split("-").includes(k) || hostKey.startsWith(`${k}-`));
    if (onHost.length === 1) return onHost[0];
  }
  return keys.length === 1 ? keys[0] : null;
}

/** low/medium/high from Radar's own 0-1 ICP score. Lossy, and stated as such. */
export function confidenceBand(raw: number | string | null | undefined): "low" | "medium" | "high" | null {
  const n = typeof raw === "number"
    ? raw
    // Number("") is 0, which would band an absent score as "low".
    : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!isFinite(n)) return null;
  if (n >= 0.7) return "high";
  if (n >= 0.45) return "medium";
  return "low";
}

/**
 * The source event time, when the source actually reported one.
 *
 * Radar's web-search results usually carry no publication date, and the scan
 * time is not a substitute — it is when we looked, not when it happened.
 */
export function occurredAtFrom(raw: Record<string, unknown> | null | undefined):
  { occurred_at: string; occurred_at_basis: "source_reported" } |
  { occurred_at: null; occurred_at_basis: "unknown" } {
  const posted = asRecord(asRecord(raw).source_details).posted_at;
  if (typeof posted === "string" && posted.trim() !== "") {
    const t = Date.parse(posted);
    if (isFinite(t)) {
      return { occurred_at: new Date(t).toISOString(), occurred_at_basis: "source_reported" };
    }
  }
  return { occurred_at: null, occurred_at_basis: "unknown" };
}

/** Stable across scans: one subject plus one piece of evidence is one row. */
export function radarDedupeKey(
  subject_type: SubjectType, subject_key: string, row: RadarLegacyRow,
): string {
  const locator = normalizeSourceUrlKey(row.source_url) ||
    canonicalSubjectKey(row.title) || "no-locator";
  return `radar|${subject_type}:${subject_key}|${locator}`;
}

export function mapRadarSignalToV2(
  row: RadarLegacyRow, origin: SignalOrigin, observed_at: string,
): RadarV2MapResult {
  const raw = asRecord(row.raw);
  let subject_type: SubjectType;
  let subject_key: string;
  let signal_type: string;

  if (row.signal_type === "competitor") {
    const key = resolveCompetitorKey(strings(raw.matched_tools_or_competitors), row.source_url);
    if (!key) return { ok: false, reason: "subject_unresolved" };
    subject_type = "competitor";
    subject_key = key;
    signal_type = "competitor_activity";
  } else if (row.signal_type in MARKET_SUBJECT_KEY) {
    subject_type = "market";
    subject_key = MARKET_SUBJECT_KEY[row.signal_type];
    signal_type = "market_problem_discussion";
  } else {
    return { ok: false, reason: "unsupported_signal_type" };
  }

  const time = occurredAtFrom(raw);
  return {
    ok: true,
    input: {
      workspace_id: row.workspace_id,
      origin,
      subject_type,
      subject_key,
      signal_type,
      signal_category: "market",
      // Market evidence is context, never proof of a prospect's timing — the
      // canonical mapping returns null for these types and this must agree.
      evidence_category: null,
      ...time,
      observed_at,
      // No freshness band: with no source time there is nothing to decay from,
      // and a band computed from the scan time would be a fiction.
      freshness: time.occurred_at_basis === "unknown" ? null : undefined,
      confidence: confidenceBand(row.confidence),
      // Nothing external verified a search result. Radar's own quality flag is
      // kept in normalized_value rather than promoted to a verification claim.
      verification_status: "unverified",
      normalized_value: {
        title: typeof row.title === "string" ? row.title.slice(0, 500) : null,
        radar_signal_type: row.signal_type,
        radar_signal_quality: raw.signal_quality ?? null,
        radar_confidence: typeof row.confidence === "number" ? row.confidence : null,
        matched_triggers: strings(raw.matched_triggers),
        // scan_run_id is deliberately NOT carried here. It is a UUID, and the
        // writer's PII guard reads `0000-4000-8000-000000000000` as a phone
        // number — correctly, for a heuristic that must not be loosened to fit
        // an identifier. Nothing is lost: `legacy_signal_id` reaches the legacy
        // row, which holds `raw.scan_run_id`.
      },
      dedupe_key: radarDedupeKey(subject_type, subject_key, row),
      lifecycle_status: "active",
      provider: typeof row.source === "string" ? row.source : null,
      source_url: row.source_url ?? null,
      legacy_signal_id: row.id ?? null,
    },
  };
}
