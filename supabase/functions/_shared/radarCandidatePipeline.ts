// Radar candidate pipeline — the Company-Brain-scored bridge between a source's
// raw results and the `signals` table. Pure / Deno-testable so run-radar-scan can
// stay a thin edge handler. Normalizes a hit into a SignalCandidate, scores it
// with scoreAgainstCompanyBrain, drops rejected/disqualified, dedupes, ranks,
// caps, and builds insert rows with the rich scoring fields in `raw` JSONB.
//
// No network, no fabrication: company/role/domain are extracted only when present.

import { scoreAgainstCompanyBrain, type SignalCandidate, type SignalType, type IcpSignalScore, type Priority } from "./icpSignalScorer.ts";
import type { CompanyBrainContext } from "./companyBrainCompiler.ts";
import { signalDedupeKey } from "./signalQuality.ts";
import { parseDomain } from "./apifyJobsNormalizer.ts";

export interface FirecrawlHit { url?: string; title?: string; description?: string; markdown?: string; }

export type RadarPlanSource = "hiring" | "funding" | "linkedin_posts" | "linkedin_comments" | "competitor" | "workflow_trends";

const PLAN_TO_SIGNAL_TYPE: Record<RadarPlanSource, SignalType> = {
  hiring: "hiring", funding: "funding", linkedin_posts: "linkedin_post",
  linkedin_comments: "linkedin_comment", competitor: "competitor", workflow_trends: "workflow_trend",
};

/** signal_type persisted to `signals` (frontend feed vocabulary). */
const PERSIST_SIGNAL_TYPE: Record<SignalType, string> = {
  hiring: "hiring", funding: "funding", linkedin_post: "linkedin_intent",
  linkedin_comment: "linkedin_comment", competitor: "competitor",
  workflow_trend: "workflow_trend", manual_source: "manual",
};

export function planSourceToSignalType(source: RadarPlanSource): SignalType {
  return PLAN_TO_SIGNAL_TYPE[source];
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").replace(/["']/g, "").trim();
  return t.length >= 2 ? t : null;
}
function companyFromHiringTitle(title: string): string | null {
  let m = title.match(/^(.{2,60}?)\s+(?:is\s+)?hiring\b/i);
  if (m) return clean(m[1]);
  m = title.match(/\bat\s+([A-Z][\w.&' -]{1,50})/);
  return m ? clean(m[1]) : null;
}
function roleFromHiringTitle(title: string): string | null {
  let m = title.match(/\bhiring\s+(?:an?\s+)?(.{2,60}?)(?:\s+in\b|\s*[-–|(]|$)/i);
  if (m) return clean(m[1]);
  m = title.match(/^(.{2,60}?)\s+at\s+/i);
  return m ? clean(m[1]) : null;
}

/** Best-effort normalization of a Firecrawl search hit into a scorer candidate. */
export function firecrawlHitToCandidate(source: RadarPlanSource, hit: FirecrawlHit, now?: number): SignalCandidate {
  const signal_type = planSourceToSignalType(source);
  const title = hit.title ?? "";
  const snippet = hit.description ?? (hit.markdown ? hit.markdown.slice(0, 400) : "");
  const url = hit.url ?? undefined;
  // A company's own page yields a domain; a job board (linkedin/indeed…) does not.
  const domain = parseDomain(url) ?? undefined;
  const base: SignalCandidate = {
    signal_type,
    title,
    source_url: url,
    source_type: "firecrawl_search",
    company_domain: domain,
    website: domain ? `https://${domain}` : undefined,
    evidence_text: snippet || undefined,
    provider: "firecrawl",
    now,
  };
  if (source === "hiring") {
    base.company_name = companyFromHiringTitle(title) ?? undefined;
    base.job_title = roleFromHiringTitle(title) ?? undefined;
    base.job_url = url;
    base.job_description = snippet || undefined;
  } else if (source === "linkedin_posts") {
    base.post_text = snippet || undefined;
  } else if (source === "workflow_trends" || source === "competitor") {
    base.company_description = snippet || undefined;
  }
  return base;
}

function priorityToBadge(p: Priority): "hot" | "warm" | "maybe" {
  return p === "urgent" || p === "high" ? "hot" : p === "medium" ? "warm" : "maybe";
}
function verificationToQuality(v: IcpSignalScore["verification_status"]): "verified" | "needs_verification" {
  return v === "verified" ? "verified" : "needs_verification";
}

export interface RadarSignalRow {
  workspace_id: string;
  source: string;
  signal_type: string;
  signal_label: string;
  title: string;
  description: string;
  source_url: string | null;
  confidence: number;
  created_by: string;
  raw: Record<string, unknown>;
}

export interface BuildRowArgs {
  workspace_id: string;
  userId: string;
  candidate: SignalCandidate;
  score: IcpSignalScore;
  scanPlanReason: string;
  provider?: string;
}

/** Map a scored candidate → a `signals` insert row (rich fields under raw). */
export function buildRadarSignalRow(a: BuildRowArgs): RadarSignalRow {
  const c = a.candidate, s = a.score;
  const signalType = PERSIST_SIGNAL_TYPE[c.signal_type];
  const sourceDetails: Record<string, unknown> = {
    company: c.company_name ?? null,
    company_domain: c.company_domain ?? null,
    company_website: c.website ?? null,
    company_linkedin_url: c.company_linkedin_url ?? null,
    job_title: c.job_title ?? null,
    job_url: c.job_url ?? null,
    employee_count: c.employee_count ?? null,
    industries: c.industries ?? null,
    location: c.location ?? null,
    funding_amount: c.funding_amount ?? null,
    funding_round: c.funding_round ?? null,
    posted_at: c.source_published_at ?? null,
  };
  return {
    workspace_id: a.workspace_id,
    source: a.provider ?? "firecrawl_search",
    signal_type: signalType,
    signal_label: (c.job_title ?? signalType).slice(0, 120),
    title: (c.title ?? "").slice(0, 500) || `${signalType} signal`,
    description: (c.evidence_text ?? c.job_description ?? c.post_text ?? "").slice(0, 1000),
    source_url: c.source_url ?? null,
    confidence: s.signal_score / 100,
    created_by: a.userId,
    raw: {
      // rich Company-Brain scoring fields
      signal_score: s.signal_score,
      verification_status: s.verification_status,
      confidence: s.confidence,
      priority: s.priority,
      icp_fit_score: s.icp_fit_score,
      proof_score: s.proof_score,
      trigger_score: s.trigger_score,
      freshness_score: s.freshness_score,
      buyer_relevance_score: s.buyer_relevance_score,
      content_potential_score: s.content_potential_score,
      actionability_score: s.actionability_score,
      matched_icp: s.matched_icp,
      matched_triggers: s.matched_triggers,
      matched_buyer_personas: s.matched_buyer_personas,
      matched_tools_or_competitors: s.matched_tools_or_competitors,
      disqualifiers_hit: s.disqualifiers_hit,
      why_it_matters: s.why_it_matters,
      why_now: s.why_now,
      company_brain_relevance: s.company_brain_relevance,
      recommended_action: s.recommended_action,
      missing_evidence: s.missing_evidence,
      risk_flags: s.risk_flags,
      source_details: sourceDetails,
      scan_plan_reason: a.scanPlanReason,
      // frontend-compat mirrors (feed reads these gracefully)
      score: s.signal_score,
      fit_score: s.signal_score,
      priority_badge: priorityToBadge(s.priority),
      signal_quality: verificationToQuality(s.verification_status),
      next_action: s.recommended_action,
      status: "new",
      source_provider: a.provider ?? "firecrawl_search",
      account_name: c.company_name ?? undefined,
      company: c.company_name ?? undefined,
    },
  };
}

export interface ScoredCandidate {
  candidate: SignalCandidate;
  source: RadarPlanSource;
  scanPlanReason: string;
  provider?: string;
}

export interface ScoreResult {
  rows: RadarSignalRow[];
  considered: number;
  accepted: number;
  rejected: number;
  duplicates: number;
}

/** Score → drop rejected → dedupe → rank by score → cap → build insert rows. */
export function scoreCandidates(args: {
  items: ScoredCandidate[];
  brain: CompanyBrainContext;
  workspace_id: string;
  userId: string;
  cap: number;
  existingKeys?: Set<string>;
  now?: number;
}): ScoreResult {
  const seen = new Set(args.existingKeys ?? []);
  const scored: { item: ScoredCandidate; score: IcpSignalScore }[] = [];
  let rejected = 0, duplicates = 0;

  for (const item of args.items) {
    const score = scoreAgainstCompanyBrain({ ...item.candidate, now: item.candidate.now ?? args.now }, args.brain);
    if (score.verification_status === "rejected") { rejected++; continue; }
    const key = signalDedupeKey({
      source_url: item.candidate.source_url ?? undefined,
      title: item.candidate.title ?? undefined,
      account_name: item.candidate.company_name ?? undefined,
      competitor_name: undefined,
    });
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score.signal_score - a.score.signal_score);
  const capped = scored.slice(0, Math.max(0, args.cap));
  const rows = capped.map(({ item, score }) =>
    buildRadarSignalRow({
      workspace_id: args.workspace_id, userId: args.userId,
      candidate: item.candidate, score, scanPlanReason: item.scanPlanReason, provider: item.provider,
    })
  );
  return { rows, considered: args.items.length, accepted: rows.length, rejected, duplicates };
}
