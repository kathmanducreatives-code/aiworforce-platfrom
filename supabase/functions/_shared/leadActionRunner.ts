// Lead action runner — composes the enrichment / decision-maker / personalization
// modules into the three live Workbench actions. Providers (Firecrawl, Apify
// people search) are INJECTED as callables, so this whole orchestration layer is
// unit-testable with fixtures and runs live only when run-agent passes the real
// runTool-backed callables. Persistence is returned to the caller (run-agent),
// keeping this module pure and side-effect-free.
//
// Guarantees enforced here:
//   - Firecrawl never runs on hard-rejected / proofless / website-less leads.
//   - Firecrawl never exceeds the planned page cap.
//   - Apify people search input is ALWAYS one company at a time, constrained to
//     decision-maker titles, and only when company identity is verified.
//   - Outreach drafts are approval-gated and refused on insufficient evidence.

import {
  isEnrichmentEligible, planEnrichmentCrawl, extractCompanyEnrichment, emptyEnrichment,
  type CompanyEnrichment, type CrawledPage,
} from "./companyEnrichment.ts";
import {
  type DecisionMaker, type PosterHint,
} from "./decisionMakers.ts";
import {
  checkPersonalizationReadiness, buildOutreachDraft, type OutreachDraft, type PersonalizationInput,
} from "./personalization.ts";

export interface LeadRecord {
  lead_candidate_id: string;
  company_name?: string | null;
  website?: string | null;
  company_website?: string | null;
  domain?: string | null;
  company_linkedin_url?: string | null;
  company_description?: string | null;
  job_description?: string | null;
  job_title?: string | null;
  job_url?: string | null;
  posted_at?: string | null;
  employee_count?: number | null;
  industries?: string[] | null;
  poster_contact_hint?: PosterHint | null;
  gate_decision?: string | null;
  source_quality?: string | null;
  source_proof?: unknown;
  why_now?: string | null;
  icp_fit_summary?: string | null;
  evidence_summary?: string | null;
  missing_evidence?: string[] | null;
  company_enrichment?: CompanyEnrichment | null;
  decision_makers?: DecisionMaker[] | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------- 1) Research company (Firecrawl) ----------

/** url → page text. Returns null when the page couldn't be fetched. */
export type FirecrawlFn = (url: string) => Promise<{ markdown: string | null; title?: string | null } | null>;

export interface EnrichmentRunResult {
  status: "enriched" | "needs_verification" | "failed" | "blocked";
  blocked_reason: string | null;
  enrichment: CompanyEnrichment;
  pages_planned: number;
  pages_fetched: number;
  summary_lines: string[];
}

export function buildEnrichmentSummary(e: CompanyEnrichment): string[] {
  const lines: string[] = [];
  if (e.company_summary) lines.push(`Summary: ${e.company_summary}`);
  if (e.founders.length) lines.push(`Founders: ${e.founders.map((f) => `${f.name}${f.title ? ` (${f.title})` : ""}`).join(", ")}`);
  if (e.executives.length) lines.push(`Executives: ${e.executives.map((x) => `${x.name}${x.title ? ` (${x.title})` : ""}`).join(", ")}`);
  if (e.growth_signals.length) lines.push(`Growth signals: ${e.growth_signals.slice(0, 3).join(" · ")}`);
  if (e.public_contact_emails.length) lines.push(`Public contact: ${e.public_contact_emails.map((c) => c.value).join(", ")}`);
  if (e.evidence_urls.length) lines.push(`Evidence: ${e.evidence_urls.join(", ")}`);
  if (e.missing_evidence.length) lines.push(`Missing: ${e.missing_evidence.join(", ")}`);
  lines.push(`Confidence: ${e.confidence}`);
  return lines;
}

/**
 * Research one company: eligibility-gate, plan a capped targeted crawl, fetch
 * only the planned pages via the injected Firecrawl callable, and extract a
 * structured, evidence-first company_enrichment. Never exceeds the page cap;
 * never crawls a blocked lead.
 */
export async function runCompanyEnrichment(
  lead: LeadRecord,
  firecrawl: FirecrawlFn,
  opts: { maxPages?: number } = {},
): Promise<EnrichmentRunResult> {
  const elig = isEnrichmentEligible(lead);
  if (!elig.eligible) {
    const enrichment = emptyEnrichment(elig.reason);
    return { status: "blocked", blocked_reason: elig.reason, enrichment, pages_planned: 0, pages_fetched: 0, summary_lines: [`Blocked: ${elig.reason}`] };
  }
  const plan = planEnrichmentCrawl(lead, { maxPages: opts.maxPages ?? 6 })!;
  const pages: CrawledPage[] = [];
  for (const p of plan.pages) {                 // capped by planEnrichmentCrawl
    let res: { markdown: string | null; title?: string | null } | null = null;
    try { res = await firecrawl(p.url); } catch { res = null; }
    if (res && str(res.markdown)) pages.push({ url: p.url, kind: p.kind, markdown: res.markdown, title: res.title ?? null });
  }
  const enrichment = extractCompanyEnrichment(pages);
  const status = enrichment.status === "enriched" ? "enriched" : enrichment.status === "failed" ? "failed" : "needs_verification";
  return { status, blocked_reason: null, enrichment, pages_planned: plan.pages.length, pages_fetched: pages.length, summary_lines: buildEnrichmentSummary(enrichment) };
}

// ---------- 2) Find decision-makers ----------
//
// Decision-maker discovery itself lives in _shared/decisionMaker/pipeline.ts
// (runDecisionMakerAction), reached only via the manual find_decision_makers
// lead action. This module only defines the shared people-search input shape
// consumed by leadActionExecutor.ts's query-building helper.

export interface PeopleSearchInput {
  company: string;
  company_linkedin_url: string | null;
  domain: string | null;
  titles: string[];
  max_results: number;
  one_company: true;   // structural guarantee: never a multi-company query
}

// ---------- 3) Generate outreach ----------

export function toPersonalizationInput(lead: LeadRecord, decisionMaker: DecisionMaker | null): PersonalizationInput {
  return {
    companyName: lead.company_name ?? null,
    companyWebsite: lead.website ?? lead.company_website ?? null,
    companyLinkedinUrl: lead.company_linkedin_url ?? null,
    companyDescription: lead.company_description ?? null,
    jobTitle: lead.job_title ?? null,
    jobUrl: lead.job_url ?? null,
    jobDescription: lead.job_description ?? null,
    postedAt: lead.posted_at ?? null,
    employeeCount: lead.employee_count ?? null,
    industries: lead.industries ?? null,
    whyNow: lead.why_now ?? null,
    icpFitSummary: lead.icp_fit_summary ?? null,
    evidenceSummary: lead.evidence_summary ?? null,
    missingEvidence: lead.missing_evidence ?? null,
    gateDecision: lead.gate_decision ?? null,
    sourceProof: lead.source_proof ?? null,
    sourceQuality: lead.source_quality ?? null,
    enrichment: lead.company_enrichment ?? null,
    decisionMaker,
  };
}

export interface OutreachRunResult {
  ready: boolean;
  draft: OutreachDraft;
  recipient: DecisionMaker | null;
}

/**
 * Generate an approval-gated outreach draft for one lead. Picks the top-ranked
 * decision-maker (or company-level mode). Refuses (insufficient_context) rather
 * than faking personalization. Never sends.
 */
export function runGenerateOutreach(
  lead: LeadRecord,
  opts: { decisionMaker?: DecisionMaker | null } = {},
): OutreachRunResult {
  const dm = opts.decisionMaker ?? (lead.decision_makers ?? [])[0] ?? null;
  const input = toPersonalizationInput(lead, dm);
  // readiness is also reflected in buildOutreachDraft; compute once for clarity.
  const readiness = checkPersonalizationReadiness(input);
  const draft = buildOutreachDraft(input);
  return { ready: readiness.ready && draft.status === "draft_needs_approval", draft, recipient: dm };
}
