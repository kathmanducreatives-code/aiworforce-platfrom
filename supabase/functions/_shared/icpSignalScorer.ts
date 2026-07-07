// ICP Signal Scorer — scores a normalized signal candidate against the compiled
// Company Brain. Company-Brain-heavy weighting, hard evidence gates (no proof →
// not verified; disqualifier → rejected), and honest missing-evidence/risk flags.
// Pure / Deno-testable. Never invents data.

import type { CompanyBrainContext } from "./companyBrainCompiler.ts";

export type SignalType =
  | "hiring" | "funding" | "competitor" | "workflow_trend"
  | "linkedin_post" | "linkedin_comment" | "manual_source";

export interface SignalCandidate {
  signal_type: SignalType;
  title: string;
  company_name?: string;
  company_domain?: string;
  company_linkedin_url?: string;
  website?: string;
  source_url?: string;
  source_type?: string;
  source_published_at?: string;
  job_title?: string;
  job_url?: string;
  job_description?: string;
  company_description?: string;
  industries?: string[];
  employee_count?: number | null;
  location?: string;
  post_text?: string;
  comment_text?: string;
  funding_amount?: string | null;
  funding_round?: string | null;
  investors?: string[];
  evidence_text?: string;
  extracted_facts?: Record<string, unknown>;
  provider?: "firecrawl" | "apify" | "manual";
  now?: number; // test override
}

export type VerificationStatus = "verified" | "needs_verification" | "low_confidence" | "rejected";
export type Confidence = "high" | "medium" | "low";
export type Priority = "urgent" | "high" | "medium" | "low";
export type RecommendedAction =
  | "convert_to_workbench" | "research_company" | "turn_into_post"
  | "turn_into_comment" | "save_idea" | "ignore" | "needs_manual_review";

export interface IcpSignalScore {
  signal_score: number;
  verification_status: VerificationStatus;
  confidence: Confidence;
  priority: Priority;
  icp_fit_score: number;
  proof_score: number;
  trigger_score: number;
  freshness_score: number;
  buyer_relevance_score: number;
  disqualifier_score: number;
  content_potential_score: number;
  actionability_score: number;
  matched_icp: string[];
  matched_triggers: string[];
  matched_buyer_personas: string[];
  matched_tools_or_competitors: string[];
  disqualifiers_hit: string[];
  why_it_matters: string;
  why_now: string;
  company_brain_relevance: string;
  recommended_action: RecommendedAction;
  missing_evidence: string[];
  risk_flags: string[];
}

const W = { proof: 20, icp: 25, trigger: 15, buyer: 10, freshness: 10, category: 10, content: 5, actionability: 5 };

function lc(s?: string | null): string { return (s ?? "").toLowerCase(); }
function isHttpUrl(u?: string | null): boolean { return /^https?:\/\/\S+/i.test((u ?? "").trim()); }
function uniq(xs: string[]): string[] { return [...new Set(xs.filter(Boolean))]; }
function hits(hay: string, needles: string[]): string[] {
  return uniq(needles.filter((n) => n && n.trim().length >= 2 && hay.includes(n.toLowerCase())));
}
function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function ageDays(iso?: string, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 86_400_000);
}

function rejected(reason: string, disq: string[] = []): IcpSignalScore {
  return {
    signal_score: 0, verification_status: "rejected", confidence: "low", priority: "low",
    icp_fit_score: 0, proof_score: 0, trigger_score: 0, freshness_score: 0, buyer_relevance_score: 0,
    disqualifier_score: disq.length ? -100 : 0, content_potential_score: 0, actionability_score: 0,
    matched_icp: [], matched_triggers: [], matched_buyer_personas: [], matched_tools_or_competitors: [],
    disqualifiers_hit: disq,
    why_it_matters: reason, why_now: "", company_brain_relevance: "Rejected before ranking.",
    recommended_action: "ignore", missing_evidence: [], risk_flags: [reason],
  };
}

export function scoreAgainstCompanyBrain(candidate: SignalCandidate, brain: CompanyBrainContext): IcpSignalScore {
  const type = candidate.signal_type;
  const companyText = [candidate.company_name, candidate.company_description, candidate.title, ...(candidate.industries ?? []), candidate.location, candidate.evidence_text, candidate.job_description, candidate.post_text, candidate.comment_text]
    .map(lc).join(" ");
  // Buyer/negative-title matching uses the actual job title only — never the
  // headline (so a topic post like "founders hiring SDRs" isn't scored as a buyer).
  const titleText = lc(candidate.job_title);
  const sourceUrl = candidate.source_url ?? candidate.job_url;
  const hasSourceUrl = isHttpUrl(sourceUrl);
  const hasEvidence = !!(candidate.evidence_text || candidate.job_description || candidate.post_text || candidate.comment_text || candidate.company_description);
  const hasDomainOrProfile = !!(candidate.company_domain || candidate.website || candidate.company_linkedin_url);
  const hasCompanyIdentity = !!(candidate.company_name || hasDomainOrProfile);

  // ---- ICP / disqualifier / persona matching ----
  const icpTerms = uniq([...brain.icp.industries, ...brain.icp.categories]);
  const icpHits = hits(companyText, icpTerms);
  const disqHits = uniq([
    ...hits(companyText, brain.disqualifiers.industries),
    ...hits(companyText, brain.disqualifiers.keywords),
    ...hits(lc(candidate.company_domain), brain.disqualifiers.domains),
  ]);
  const negTitleHits = hits(titleText, brain.buyer_personas.negative_title_keywords);
  const buyerHits = hits(titleText, uniq([...brain.buyer_personas.titles, ...brain.buyer_personas.title_keywords]));
  const triggerHits = uniq([
    ...hits(companyText + " " + titleText, brain.buying_triggers.hiring),
    ...hits(companyText, brain.buying_triggers.funding),
    ...hits(companyText, brain.buying_triggers.workflow_pain),
    ...(candidate.funding_round ? [candidate.funding_round] : []),
  ]);
  const toolHits = uniq([
    ...hits(companyText, brain.competitors_and_tools.watchlist),
    ...hits(companyText, brain.buying_triggers.content_topics),
  ]);

  // ---- HARD GATES → rejected ----
  if (disqHits.length) return rejected(`Company Brain disqualifier: ${disqHits[0]}`, disqHits);
  if (type === "funding" && !hasSourceUrl) return rejected("Funding without a source URL");
  if (type === "linkedin_post" && !isHttpUrl(candidate.source_url)) return rejected("LinkedIn post without a URL");
  if (type === "linkedin_comment" && !isHttpUrl(candidate.source_url)) return rejected("Comment without a parent post URL");
  if (!hasCompanyIdentity && !hasSourceUrl) return rejected("No company identity and no source proof");
  // Generic ops title with no ICP/SaaS context → reject (can't be a RevOps/GTM buyer).
  if (negTitleHits.length && icpHits.length === 0) return rejected(`Generic non-revenue title "${negTitleHits[0]}" without SaaS/revenue context`);

  // ---- component scores ----
  const breakdown: Record<string, number> = {};
  const matched_icp: string[] = [...icpHits];
  const matched_triggers: string[] = [...triggerHits];
  const matched_buyer_personas: string[] = [...buyerHits];
  const matched_tools = [...toolHits];

  // proof (0..20)
  breakdown.proof = !hasSourceUrl ? 0 : (hasEvidence ? W.proof : 0.6 * W.proof);
  // funding needs an explicit article; hiring proof strengthened by job description
  if (type === "hiring" && candidate.job_description && hasSourceUrl) breakdown.proof = W.proof;

  // icp fit (0..25): industry/category match + size band + company identity
  let icp = 0;
  if (icpHits.length) icp += clamp(icpHits.length, 0, 2) / 2 * (W.icp * 0.6);
  const emp = candidate.employee_count ?? null;
  const min = brain.icp.company_size_min, max = brain.icp.company_size_max;
  const sizeKnown = min != null || max != null;
  const inBand = emp != null && sizeKnown && (min == null || emp >= min) && (max == null || emp <= max);
  if (inBand) { icp += W.icp * 0.25; matched_icp.push(`size:${emp} in band`); }
  if (hasCompanyIdentity) icp += W.icp * 0.15;
  breakdown.icp = clamp(icp, 0, W.icp);

  // trigger (0..15)
  breakdown.trigger = clamp(triggerHits.length, 0, 3) / 3 * W.trigger;
  if (type === "funding" && (candidate.funding_round || candidate.funding_amount)) breakdown.trigger = Math.max(breakdown.trigger, W.trigger * 0.8);

  // buyer relevance (0..10) — negative title (with context) removes credit
  breakdown.buyer = negTitleHits.length ? 0 : clamp(buyerHits.length, 0, 2) / 2 * W.buyer;

  // freshness (0..10)
  const days = ageDays(candidate.source_published_at, candidate.now);
  breakdown.freshness = days == null ? 0.4 * W.freshness : days <= 7 ? W.freshness : days <= 30 ? 0.6 * W.freshness : days <= 90 ? 0.3 * W.freshness : 0.1 * W.freshness;

  // category / tool (0..10)
  breakdown.category = toolHits.length ? clamp(toolHits.length, 0, 2) / 2 * W.category : (icpHits.length ? 0.6 * W.category : 0);

  // content potential (0..5)
  const contentHits = hits(companyText + " " + lc(candidate.post_text) + " " + lc(candidate.comment_text), uniq([...brain.buying_triggers.content_topics, ...brain.query_strategy.linkedin_topic_terms]));
  breakdown.content = contentHits.length ? W.content : (type === "linkedin_post" || type === "workflow_trend" ? 0.4 * W.content : 0);

  // actionability (0..5)
  breakdown.actionability = (hasDomainOrProfile || isHttpUrl(candidate.source_url)) ? W.actionability : 0;

  let score = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0));

  // ---- caps ----
  const missing_evidence: string[] = [];
  const risk_flags: string[] = [];
  const industryKnown = icpHits.length > 0 || (candidate.industries ?? []).length > 0;
  const buyerKnown = buyerHits.length > 0 || !!candidate.job_title;

  if (!hasSourceUrl) { score = Math.min(score, 30); missing_evidence.push("Source proof URL"); }
  if (!hasDomainOrProfile) { score = Math.min(score, 45); missing_evidence.push("Company website / domain / LinkedIn"); }
  if (!industryKnown && !sizeKnown && !buyerKnown) { score = Math.min(score, 45); risk_flags.push("Unknown industry, size and buyer"); }
  if (type === "hiring" && !(candidate.job_title && (isHttpUrl(candidate.job_url) || isHttpUrl(candidate.source_url)))) {
    score = Math.min(score, 40); missing_evidence.push("Exact job title + job URL");
  }
  if (!hasEvidence) { score = Math.min(score, 30); missing_evidence.push("Evidence text"); }
  score = clamp(score, 0, 100);

  // ---- verification status ----
  let verification: VerificationStatus;
  if (hasSourceUrl && hasEvidence && score >= 55 && (industryKnown || buyerKnown)) verification = "verified";
  else if (negTitleHits.length) verification = "low_confidence";
  else if (!hasSourceUrl || !hasEvidence || score < 40) verification = "needs_verification";
  else verification = "needs_verification";
  // Funding verified only with amount OR investor evidence in the article
  if (type === "funding" && verification === "verified" && !(candidate.funding_amount || (candidate.investors ?? []).length || candidate.funding_round)) {
    verification = "needs_verification"; missing_evidence.push("Funding amount / round / investors");
  }
  if (negTitleHits.length) risk_flags.push(`Generic title "${negTitleHits[0]}" — not a confirmed buyer`);
  if (brain.meta.confidence === "weak") { if (verification === "verified") verification = "needs_verification"; risk_flags.push("Company Brain is weak — scored conservatively"); }

  // ---- confidence + priority ----
  const confidence: Confidence = verification === "verified" && score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  let priority: Priority = "low";
  if (verification === "verified" && score >= 82) priority = "urgent";
  else if (verification === "verified" && score >= 65) priority = "high";
  else if (score >= 45) priority = "medium";

  // ---- recommended action ----
  const recommended_action = recommend(type, verification, hasDomainOrProfile, contentHits.length > 0);

  // ---- narrative ----
  const why_it_matters = buildWhy(candidate, matched_icp, matched_triggers, matched_buyer_personas);
  const why_now = buildWhyNow(candidate, days);
  const company_brain_relevance = matched_icp.length || matched_triggers.length
    ? `Matches ${uniq([...matched_icp, ...matched_triggers]).slice(0, 4).join(", ")}.`
    : "No direct Company Brain match — review before acting.";
  if (!hasCompanyIdentity) missing_evidence.push("Company identity");

  return {
    signal_score: score,
    verification_status: verification,
    confidence, priority,
    icp_fit_score: Math.round(breakdown.icp),
    proof_score: Math.round(breakdown.proof),
    trigger_score: Math.round(breakdown.trigger),
    freshness_score: Math.round(breakdown.freshness),
    buyer_relevance_score: Math.round(breakdown.buyer),
    disqualifier_score: 0,
    content_potential_score: Math.round(breakdown.content),
    actionability_score: Math.round(breakdown.actionability),
    matched_icp: uniq(matched_icp),
    matched_triggers: uniq(matched_triggers),
    matched_buyer_personas: uniq(matched_buyer_personas),
    matched_tools_or_competitors: uniq(matched_tools),
    disqualifiers_hit: [],
    why_it_matters, why_now, company_brain_relevance,
    recommended_action,
    missing_evidence: uniq(missing_evidence),
    risk_flags: uniq(risk_flags),
  };
}

function recommend(type: SignalType, v: VerificationStatus, hasCompany: boolean, contentPotential: boolean): RecommendedAction {
  if (v === "rejected") return "ignore";
  if (v === "needs_verification" || v === "low_confidence") return contentPotential ? "save_idea" : "needs_manual_review";
  switch (type) {
    case "hiring": return hasCompany ? "convert_to_workbench" : "research_company";
    case "funding": return "convert_to_workbench";
    case "linkedin_post": return "turn_into_comment";
    case "linkedin_comment": return "turn_into_comment";
    case "competitor": return "turn_into_post";
    case "workflow_trend": return "turn_into_post";
    default: return "save_idea";
  }
}

function buildWhy(c: SignalCandidate, icp: string[], triggers: string[], buyers: string[]): string {
  const bits: string[] = [];
  if (c.signal_type === "hiring" && c.company_name) bits.push(`${c.company_name} is hiring${c.job_title ? ` a ${c.job_title}` : ""}`);
  if (c.signal_type === "funding" && c.company_name) bits.push(`${c.company_name} recently${c.funding_amount ? ` raised ${c.funding_amount}` : " raised funding"}`);
  if (buyers.length) bits.push(`buyer match (${buyers[0]})`);
  if (icp.length) bits.push(`ICP fit (${icp[0]})`);
  if (triggers.length) bits.push(`trigger (${triggers[0]})`);
  return bits.length ? bits.join(" · ") : "Relevant to your market — review the source.";
}

function buildWhyNow(c: SignalCandidate, days: number | null): string {
  if (c.signal_type === "funding") return c.funding_round ? `Fresh ${c.funding_round} raise — capital to build revenue now.` : "Recent raise — timing to engage.";
  if (c.signal_type === "hiring") return "Active job posting — hiring demand right now.";
  if (days != null && days <= 7) return "Posted within the last week.";
  return days != null ? `Surfaced ${Math.round(days)}d ago.` : "Recency unknown — verify the date.";
}
