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
  resolveBaseUrl, type CompanyEnrichment, type CrawledPage,
} from "./companyEnrichment.ts";
import {
  buildDecisionMakers, type DecisionMaker, type PosterHint, type PeopleSearchContact, type BuyerClue, type RejectedCandidate,
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

// Constrained title filter — the ONLY titles the per-company people search targets.
export const DECISION_MAKER_TITLES = [
  "Founder", "Co-Founder", "CEO", "Head of Growth", "VP Growth",
  "Head of Revenue", "VP Sales", "Head of Sales", "Revenue Operations", "Sales Operations",
];

export interface PeopleSearchInput {
  company: string;
  company_linkedin_url: string | null;
  domain: string | null;
  titles: string[];
  max_results: number;
  one_company: true;   // structural guarantee: never a multi-company query
}

export type PeopleSearchFn = (input: PeopleSearchInput) => Promise<PeopleSearchContact[]>;

/**
 * Build a SINGLE-company, title-constrained people-search input — only when the
 * company's identity is verified (company LinkedIn URL or a real domain). Returns
 * null (→ skip live search) when identity is unverified.
 */
export function buildPeopleSearchInput(lead: LeadRecord, opts: { maxResults?: number } = {}): PeopleSearchInput | null {
  const company = str(lead.company_name);
  if (!company) return null;
  const companyLinkedin = str(lead.company_linkedin_url);
  const base = resolveBaseUrl(lead.website ?? lead.company_website, lead.domain);
  const domain = base ? base.replace(/^https?:\/\//, "") : null;
  if (!companyLinkedin && !domain) return null;   // identity not verified → no live search
  return {
    company,
    company_linkedin_url: companyLinkedin,
    domain,
    titles: DECISION_MAKER_TITLES,
    max_results: Math.max(1, Math.min(10, opts.maxResults ?? 5)),
    one_company: true,
  };
}

export interface DiscoveryRunResult {
  decision_makers: DecisionMaker[];
  needs_manual_review: boolean;
  buyer_clues: BuyerClue[];
  rejected: RejectedCandidate[];
  used_people_search: boolean;
  people_search_input: PeopleSearchInput | null;
}

/**
 * Discover decision-makers for ONE company, evidence-first: job poster hint +
 * descriptionText clues + Firecrawl enrichment founders/execs. Runs the injected
 * per-company Apify people search ONLY when nothing confident surfaced AND the
 * company identity is verified. Never batches companies.
 */
/**
 * @deprecated Superseded by _shared/decisionMaker/pipeline.ts. The live
 * find_decision_makers action now uses runDecisionMakerAction; this remains only
 * because its own tests still cover it. It accepts name-only and headline company
 * matches and cannot distinguish a provider failure from an empty result — do not
 * wire it into a runtime path again.
 */
export async function runDecisionMakerDiscovery(
  lead: LeadRecord,
  opts: { peopleSearch?: PeopleSearchFn; maxResults?: number } = {},
): Promise<DiscoveryRunResult> {
  const enrichment = lead.company_enrichment ?? null;
  const baseArgs = {
    poster: lead.poster_contact_hint ?? null,
    jobTitle: lead.job_title ?? null,
    descriptionText: lead.job_description ?? null,
    // Ground-truth company identity people-search candidates must match (Bug #1).
    company: {
      name: lead.company_name ?? null,
      domain: lead.domain ?? null,
      website: lead.website ?? lead.company_website ?? null,
      companyLinkedinUrl: lead.company_linkedin_url ?? null,
    },
    enrichment: enrichment ? { founders: enrichment.founders, executives: enrichment.executives, public_contact_emails: enrichment.public_contact_emails } : null,
  };
  let result = buildDecisionMakers(baseArgs);
  let usedPeople = false;
  let psInput: PeopleSearchInput | null = null;

  if (result.needs_manual_review && opts.peopleSearch) {
    psInput = buildPeopleSearchInput(lead, { maxResults: opts.maxResults });
    if (psInput) {
      let people: PeopleSearchContact[] = [];
      try { people = await opts.peopleSearch(psInput); } catch { people = []; }
      usedPeople = true;
      result = buildDecisionMakers({ ...baseArgs, peopleSearch: people });
    }
  }
  return { ...result, used_people_search: usedPeople, people_search_input: psInput };
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
