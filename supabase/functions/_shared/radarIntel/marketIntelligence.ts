// Workflow-trend + funding intelligence. PURE / Deno-testable. Never fabricates
// funding amount/round/date and never calls a trend "broad" without evidence.

import type { RadarIntelligenceProfile } from "./radarIntelligenceProfile.ts";

// ---------------------------------------------------------------------------
// Workflow trends
// ---------------------------------------------------------------------------
export type TrendMaturity = "emerging" | "established" | "speculative";

export interface WorkflowTrendEval {
  valid: boolean;
  topic: string | null;
  maturity: TrendMaturity;
  matched_terms: string[];
  evidence_urls: string[];
  missing_evidence: string[];
  reason: string;
}

function lc(s: string): string { return (s ?? "").toLowerCase(); }
function isHttpUrl(u?: string | null): boolean { return /^https?:\/\/\S+/i.test((u ?? "").trim()); }
function found(hay: string, terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) { const n = lc(t); if (n.length >= 3 && hay.includes(n)) out.push(t); }
  return [...new Set(out)];
}

/** A trend requires a Company-Brain topic connection AND at least one credible
 * source. Multiple independent sources → "established"; one → "emerging";
 * a topic match with no source → speculative (and invalid as a signal). */
export function evaluateWorkflowTrend(args: {
  text?: string; sourceUrls?: string[]; profile: RadarIntelligenceProfile;
}): WorkflowTrendEval {
  const text = lc(args.text ?? "");
  const urls = (args.sourceUrls ?? []).filter(isHttpUrl);
  const matched = found(text, args.profile.topics);
  const missing: string[] = [];
  if (!matched.length) missing.push("Connection to a Company Brain topic");
  if (!urls.length) missing.push("At least one credible source URL");

  let maturity: TrendMaturity = "speculative";
  if (matched.length && urls.length >= 2) maturity = "established";
  else if (matched.length && urls.length === 1) maturity = "emerging";

  const valid = matched.length > 0 && urls.length >= 1;
  return {
    valid,
    topic: matched[0] ?? null,
    maturity,
    matched_terms: matched,
    evidence_urls: urls,
    missing_evidence: missing,
    reason: valid
      ? `Repeatable market behaviour around "${matched[0]}" with ${urls.length} source(s).`
      : "Not enough evidence to call this a trend.",
  };
}

// ---------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------
export interface FundingInput {
  company_name?: string;
  company_domain?: string;
  source_url?: string;
  announced_date?: string;   // only used if actually provided
  round?: string;            // only used if actually provided
  amount?: string;           // only used if actually provided (verified)
  investors?: string[];
}

export interface FundingEval {
  valid: boolean;
  company: string | null;
  /** Only ever populated from real input — never inferred/fabricated. */
  round: string | null;
  amount: string | null;
  announced_date: string | null;
  investors: string[];
  missing_evidence: string[];
  decision: "watch" | "needs_review" | "skip";
  reason: string;
}

/** Funding requires company identity + a source URL. Amount/round/date/investors
 * are passed through ONLY when provided — this function never invents them.
 * Funding alone is normally "watch". */
export function evaluateFunding(f: FundingInput): FundingEval {
  const company = (f.company_name ?? "").trim() || null;
  const hasSource = isHttpUrl(f.source_url);
  const hasIdentity = !!company || !!(f.company_domain ?? "").trim();
  const missing: string[] = [];
  if (!hasIdentity) missing.push("Company identity");
  if (!hasSource) missing.push("Source URL");

  // Pass-through only. Absent fields stay null — never fabricated.
  const round = (f.round ?? "").trim() || null;
  const amount = (f.amount ?? "").trim() || null;
  const announced_date = (f.announced_date ?? "").trim() || null;
  const investors = (f.investors ?? []).filter((x) => typeof x === "string" && x.trim());

  let decision: FundingEval["decision"];
  if (!hasIdentity || !hasSource) decision = "needs_review";
  else decision = "watch"; // funding alone → watch, never auto-contact
  const valid = hasIdentity && hasSource;

  return {
    valid, company, round, amount, announced_date, investors,
    missing_evidence: missing, decision,
    reason: valid
      ? `Verified funding event for ${company ?? "the company"}${amount ? ` (${amount})` : ""} — capital that may enable GTM investment. Watch.`
      : "Funding lacks company identity or a source URL — needs review.",
  };
}
