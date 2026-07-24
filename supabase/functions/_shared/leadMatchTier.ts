// Match tiering + funding handling + honest shortage counters (Parts 3-logic/4/6).
// Pure / import-free. Classifies each raw candidate against a LeadSearchIntent
// into strict / secondary / reject, applies the funding contract (a job posting
// alone never proves funding), and fills the requested count with clearly
// labeled tiers — never padding with hard-disqualified or fake-fit leads.

import type { LeadSearchIntent } from "./leadSearchIntent.ts";

export type MatchTier = "strict" | "secondary" | "reject";

export interface CandidateForTier {
  company?: string | null;
  industries?: string[] | null;
  company_description?: string | null;
  job_title?: string | null;
  job_description?: string | null;
  source_url?: string | null;
  funding_proof_url?: string | null;   // a SEPARATE funding source (not the job actor)
  employee_count?: number | null;
}

export interface TierResult {
  match_tier: MatchTier;
  reasons: string[];
  missing_evidence: string[];
  funding_required: boolean;
  funding_proof_found: boolean;
  funding_source_url: string | null;
  disqualified: boolean;
  relaxations: string[];   // which relaxations this row relied on (funding_relaxed / role_adjacent / …)
  recruiter_proxy: boolean;
}

const SAAS_RE = /\b(saas|software|b2b software|platform|api|cloud|app|application|ai\b|artificial intelligence|analytics|fintech|payments? (platform|software)|developer tools?|data (platform|infrastructure))\b/i;
const GENERIC_ROLE_RE = /\b(operations manager|office manager|business developer|sales manager|account manager)\b/i;
const OUTBOUND_EVIDENCE_RE = /\b(outbound|pipeline|prospect|cold (call|email|outreach)|revenue|gtm|go-to-market|new business|founder-led)\b/i;
// Recruiter/staffing proxy posts — the real employer is hidden (Part 6).
const RECRUITER_PROXY_RE = /\b(our client|on behalf of|we(?:'re| are) partnering with|partnering with (?:an?|our)|recruitment agency|staffing (?:agency|firm)|talent (?:agency|partner)|search firm|recruiting firm|headhunt|confidential (?:client|company)|unnamed (?:client|company)|a leading (?:client|company))\b/i;
const RECRUITER_INDUSTRY_RE = /\b(staffing|recruit(?:ing|ment)|talent acquisition|executive search|employment agency)\b/i;
// Non-product SERVICES firms (search/advisory/consulting/recruiting). Their
// founders are NOT SaaS buyers — the live Sales-Ops benchmark surfaced founders
// of "… Advisors" and "… Search" firms as leads. Matched against company NAME +
// title (phrase-anchored so SaaS "search platform"/"advisory board" don't hit).
const SERVICES_FIRM_RE = /\b(search (?:consultant|consulting|firm|partners|group|associates)|executive search|principal search|talent (?:advisory|partners)|advisory (?:firm|services|group|partners)|advisors|management consult(?:ing|ancy)|consult(?:ing|ancy) (?:firm|group|partners)|recruit(?:ing|ment) (?:firm|agency|partners))\b/i;

/** Detect a recruiter/staffing/services-firm proxy where the target is not a SaaS buyer. */
export function detectRecruiterProxy(c: CandidateForTier): { isProxy: boolean; reason: string | null } {
  // Include the company NAME and job TITLE, not just descriptions — a firm named
  // "Netsoft Search" or a "Principal Search Consultant" reveals the proxy there.
  const hay = [c.company, c.company_description, c.job_description, c.job_title].filter(Boolean).join(" ");
  const inds = (c.industries ?? []).join(" ");
  if (RECRUITER_PROXY_RE.test(hay)) return { isProxy: true, reason: "Recruiter proxy post; actual hiring company hidden." };
  if (RECRUITER_INDUSTRY_RE.test(inds)) return { isProxy: true, reason: "Company is a staffing/recruiting agency; not the target buyer." };
  if (SERVICES_FIRM_RE.test([c.company, c.job_title, inds].filter(Boolean).join(" "))) {
    return { isProxy: true, reason: "Non-product services firm (search/advisory/consulting/recruiting); not a SaaS target." };
  }
  return { isProxy: false, reason: null };
}

function text(c: CandidateForTier): string {
  return [c.company, (c.industries ?? []).join(" "), c.company_description, c.job_title, c.job_description].filter(Boolean).join(" ").toLowerCase();
}

/** Does the candidate read as a SaaS/AI-SaaS software company (from its own data)? */
export function isSaasCompany(c: CandidateForTier): boolean {
  return SAAS_RE.test(text(c));
}

/** Does the candidate hit a hard disqualifier (industry/description)? Never filled. */
export function hitsDisqualifier(c: CandidateForTier, disqualifiers: string[]): string | null {
  const t = text(c);
  for (const d of disqualifiers ?? []) {
    const term = d.toLowerCase().trim();
    if (term && t.includes(term)) return d;
  }
  return null;
}

function matchesRole(c: CandidateForTier, roles: string[]): boolean {
  const t = (c.job_title ?? "").toLowerCase();
  return roles.some((r) => t.includes(r.toLowerCase()));
}

/** Classify ONE candidate against the intent. Evidence-first; never invents. */
export function classifyLeadTier(c: CandidateForTier, intent: LeadSearchIntent): TierResult {
  const reasons: string[] = [];
  const missing_evidence: string[] = [];
  const relaxations: string[] = [];
  const funding_required = intent.funding_required;
  const funding_proof_found = !!(c.funding_proof_url && c.funding_proof_url.trim());
  const funding_source_url = funding_proof_found ? (c.funding_proof_url as string) : null;
  const proxy = detectRecruiterProxy(c);

  const reject = (reason: string, disq = false): TierResult => {
    reasons.push(reason);
    return { match_tier: "reject", reasons, missing_evidence, funding_required, funding_proof_found, funding_source_url, disqualified: disq, relaxations, recruiter_proxy: proxy.isProxy };
  };

  // 1. Never fill without source proof.
  if (!c.source_url || !String(c.source_url).trim() || /proof_incomplete/i.test(String(c.source_url))) {
    return reject("no source proof (never accepted)");
  }
  // 2. Recruiter/staffing proxy → the real employer is hidden; never a target
  //    account (do not invent the actual company).
  if (proxy.isProxy) return reject(proxy.reason ?? "recruiter proxy post", true);
  // 3. Hard disqualifier → reject, never used to fill count.
  const disq = hitsDisqualifier(c, intent.hard_disqualifiers);
  if (disq) return reject(`hard-disqualified: ${disq}`, true);

  // 3. Category: the must-have category is SaaS-family; a non-SaaS company is off-ICP.
  const requiresSaas = intent.must_have_categories.some((cat) => /saas|software|ai/i.test(cat));
  const saas = isSaasCompany(c);
  if (requiresSaas && !saas) return reject("not a SaaS/AI-SaaS company (category not met)", true);

  // 4. Role: exact must-have role → strict-eligible; adjacent role → secondary;
  //    generic sales/ops role passes ONLY with SaaS + outbound/revenue evidence.
  const exact = matchesRole(c, intent.must_have_roles.length ? intent.must_have_roles : intent.role_terms);
  const adjacent = !exact && matchesRole(c, intent.role_terms);
  const genericOnly = !exact && !adjacent && GENERIC_ROLE_RE.test((c.job_title ?? "").toLowerCase());
  if (genericOnly && !(saas && OUTBOUND_EVIDENCE_RE.test(text(c)))) {
    return reject("generic sales/ops role without SaaS + outbound/revenue evidence");
  }

  // 5. Tier decision (strict → secondary), applying the funding contract.
  let tier: MatchTier = exact ? "strict" : "secondary";
  if (adjacent) { relaxations.push("role_adjacent"); reasons.push("adjacent GTM role (not the exact requested role)"); }
  if (exact) reasons.push("exact requested role match");
  if (saas) reasons.push("SaaS/AI-SaaS company evidence");

  if (funding_required) {
    if (!funding_proof_found) {
      // Downgrade — NEVER claim "recently funded" without a separate funding source.
      if (tier === "strict") tier = "secondary";
      relaxations.push("funding_relaxed");
      missing_evidence.push("recent funding proof");
      reasons.push("funding required but no separate funding proof — cannot be called recently funded");
    } else {
      reasons.push("recent funding proof present");
    }
  }

  return { match_tier: tier, reasons, missing_evidence, funding_required, funding_proof_found, funding_source_url, disqualified: false, relaxations, recruiter_proxy: false };
}

export interface ShortageResult {
  requested_count: number;
  raw_results_reviewed: number;
  accepted_count: number;
  strict_matches: number;
  secondary_matches: number;
  rejected_count: number;
  relaxation_steps_used: string[];
  accepted: Array<{ candidate: CandidateForTier; tier: TierResult }>;
  reason_not_filled?: string;
}

/**
 * Fill the requested count from raw results: strict matches first, then secondary,
 * never hard-disqualified/fake-fit. Returns transparent counters + an honest
 * shortage explanation. Does not pad.
 */
export function fillFromRawResults(rawCandidates: CandidateForTier[], intent: LeadSearchIntent): ShortageResult {
  const reviewed = rawCandidates ?? [];
  const strict: Array<{ candidate: CandidateForTier; tier: TierResult }> = [];
  const secondary: Array<{ candidate: CandidateForTier; tier: TierResult }> = [];
  let rejected = 0;
  const relaxSet = new Set<string>();

  for (const c of reviewed) {
    const t = classifyLeadTier(c, intent);
    if (t.match_tier === "reject") { rejected++; continue; }
    (t.match_tier === "strict" ? strict : secondary).push({ candidate: c, tier: t });
    for (const r of t.relaxations) relaxSet.add(r);
  }

  const accepted = [...strict, ...secondary].slice(0, intent.requested_count);
  const strict_matches = accepted.filter((a) => a.tier.match_tier === "strict").length;
  const secondary_matches = accepted.length - strict_matches;

  const result: ShortageResult = {
    requested_count: intent.requested_count,
    raw_results_reviewed: reviewed.length,
    accepted_count: accepted.length,
    strict_matches,
    secondary_matches,
    rejected_count: rejected,
    relaxation_steps_used: [...relaxSet],
    accepted,
  };
  if (accepted.length < intent.requested_count) {
    result.reason_not_filled = `Found ${accepted.length} qualified lead${accepted.length === 1 ? "" : "s"} out of ${reviewed.length} reviewed. I did not fill the remaining ${intent.requested_count - accepted.length} because the rest were off-ICP (e.g. non-SaaS / disqualified industries) or lacked proof.`;
  }
  return result;
}

/**
 * Union missing-evidence lists (funding + analyst + gate) into one deduped,
 * order-preserving list — so the analyst update never drops the funding gap
 * ("recent funding proof") and vice versa. Ignores non-strings/empties.
 */
export function unionMissingEvidence(...lists: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const x of list) {
      if (typeof x === "string" && x.trim() && !seen.has(x)) { seen.add(x); out.push(x); }
    }
  }
  return out;
}

/** One-line user report (Part 5 copy) from the counters. */
export function summarizeShortage(r: ShortageResult): string {
  const relaxed = r.relaxation_steps_used.length ? ` Relaxed: ${r.relaxation_steps_used.join(", ")}.` : "";
  const base = `I reviewed ${r.raw_results_reviewed} raw job result${r.raw_results_reviewed === 1 ? "" : "s"}, and found ${r.strict_matches} strict match${r.strict_matches === 1 ? "" : "es"} and ${r.secondary_matches} secondary match${r.secondary_matches === 1 ? "" : "es"} (secondary = SaaS/GTM hiring signal, missing funding/exact-role proof).${relaxed}`;
  return r.reason_not_filled ? `${base} ${r.reason_not_filled}` : base;
}
