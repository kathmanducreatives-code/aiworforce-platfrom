// ONE COMPANY EVIDENCE RECORD, WHATEVER FOUND THE COMPANY.
//
// WHY THIS EXISTS.
//
// A company discovered through a YC cohort, through a job posting, and through a
// LinkedIn company search arrives in three different shapes, from three
// different Actors, with three different ideas of what "location" means. Every
// stage after discovery — the hiring assessment, the deterministic gates, the
// Company Brain, the portfolio — then has to know which of the three it is
// holding. That is how a stage ends up re-deriving a mission constraint for
// itself, and how two stages start disagreeing about the same company.
//
// So discovery ends here. Whatever route found the company, it produces ONE
// record with the same fields, the same emptiness semantics, and an explicit
// note of what is MISSING rather than a silent null.
//
// WHAT THIS IS NOT. It is not a second normalizer: `hiringActorNormalizers`
// still owns the per-Actor row shapes and is called before this. This assembles
// their output into the mission-facing record, and names its provenance.
//
// PURE. No network, provider, model or database access.

import type {
  NormalizedHiringCompany, NormalizedHiringJob,
} from "./hiringActorNormalizers.ts";
import type { CapabilityId } from "./leadCapabilityGraph.ts";

export const COMPANY_EVIDENCE_VERSION = "lead-company-evidence-v1" as const;

export type IdentityState =
  | "not_attempted" | "resolved" | "unresolved" | "ambiguous" | "mismatch";

/** One commercial opening, kept as evidence rather than as a count. */
export interface CommercialJobEvidence {
  title: string;
  url: string | null;
  location: string | null;
  posted_date: string | null;
  /** Tier from the canonical commercial-signal policy, when one was assigned. */
  tier: "A" | "B" | "C" | null;
}

export interface CompanyEvidenceRecord {
  version: typeof COMPANY_EVIDENCE_VERSION;
  company_key: string;
  company_name: string | null;
  domain: string | null;
  linkedin_company_url: string | null;
  identity_state: IdentityState;

  geography_evidence: string | null;
  employee_evidence: number | null;
  industry_evidence: string[];
  description: string | null;

  /** The exact query or concept that surfaced this company. */
  source_query: string | null;
  /** Which capability produced it. Answers "why is this company here?". */
  source_capability: CapabilityId;

  commercial_job_evidence: CommercialJobEvidence[];
  /** The single strongest current signal, or null when there is none. */
  strongest_signal: string | null;
  evidence_urls: string[];

  /** Named absences. A field nobody could establish is not a field that is false. */
  missing_fields: string[];
  /** Two sources that disagree. Reported, never silently resolved. */
  conflicting_evidence: string[];
}

function clean(s: unknown): string | null {
  const v = typeof s === "string" ? s.trim() : "";
  return v.length > 0 ? v : null;
}

function dedupeStrings(xs: readonly (string | null | undefined)[]): string[] {
  return [...new Set(xs.map((x) => clean(x)).filter((x): x is string => !!x))];
}

export interface BuildEvidenceInput {
  company_key: string;
  source_capability: CapabilityId;
  source_query?: string | null;
  /** The discovery-time company row. */
  company: NormalizedHiringCompany;
  /** The enriched row, when enrichment has run. Wins on every field it holds. */
  enriched?: NormalizedHiringCompany | null;
  identity_state?: IdentityState;
  linkedin_company_url?: string | null;
  /** Openings already judged commercial by the mission's own policy. */
  commercial_jobs?: readonly CommercialJobEvidence[];
  strongest_signal?: string | null;
}

/**
 * Assemble the record.
 *
 * ENRICHED EVIDENCE WINS, and where the two sources disagree the disagreement is
 * RECORDED rather than resolved. A discovery row saying 40 employees and an
 * enriched row saying 400 is not a rounding difference — it is usually two
 * different companies with the same name, and silently preferring one of them is
 * how a founder gets attached to the wrong employer.
 */
export function buildCompanyEvidence(i: BuildEvidenceInput): CompanyEvidenceRecord {
  const base = i.company;
  const rich = i.enriched ?? null;
  const missing: string[] = [];
  const conflicting: string[] = [];

  const name = clean(rich?.company_name) ?? clean(base.company_name);
  const domain = clean(rich?.canonical_domain) ?? clean(base.canonical_domain);
  const url = clean(i.linkedin_company_url) ??
    clean(rich?.linkedin_company_url) ?? clean(base.linkedin_company_url);

  const employees = rich?.employee_count ?? base.employee_count ?? null;
  if (rich?.employee_count != null && base.employee_count != null &&
      rich.employee_count !== base.employee_count) {
    // A 2x gap is a different company; a small gap is a stale count.
    const ratio = Math.max(rich.employee_count, base.employee_count) /
      Math.max(1, Math.min(rich.employee_count, base.employee_count));
    if (ratio >= 2) {
      conflicting.push(
        `employee_count: discovery=${base.employee_count} enriched=${rich.employee_count}`);
    }
  }

  const geography = clean(rich?.geography) ?? clean(base.geography);
  const description = clean(rich?.description) ?? clean(base.description);
  // THE ENRICHED INDUSTRY IDS ARE EVIDENCE; the provider's own label is not.
  // `provider_industry` is kept last and marked, because a broad vendor label
  // has repeatedly been read as proof of a business model it does not establish.
  const industries = dedupeStrings([
    ...(rich?.industry_ids ?? []).map((x) => x.name),
    ...(base.industry_ids ?? []).map((x) => x.name),
    ...(rich?.provider_industry ? [`provider_label:${rich.provider_industry}`] : []),
    ...(base.provider_industry ? [`provider_label:${base.provider_industry}`] : []),
  ]);

  if (!name) missing.push("company_name");
  if (!domain) missing.push("canonical_domain");
  if (!url) missing.push("linkedin_company_url");
  if (employees == null) missing.push("employee_count");
  if (!geography) missing.push("geography");
  if (!description) missing.push("description");
  if (industries.length === 0) missing.push("industry");

  const jobs = [...(i.commercial_jobs ?? [])];
  if (jobs.length === 0) missing.push("commercial_job_evidence");

  return {
    version: COMPANY_EVIDENCE_VERSION,
    company_key: i.company_key,
    company_name: name,
    domain,
    linkedin_company_url: url,
    identity_state: i.identity_state ?? "not_attempted",
    geography_evidence: geography,
    employee_evidence: employees,
    industry_evidence: industries,
    description,
    source_query: clean(i.source_query),
    source_capability: i.source_capability,
    commercial_job_evidence: jobs,
    strongest_signal: clean(i.strongest_signal) ?? jobs[0]?.title ?? null,
    evidence_urls: dedupeStrings([
      url, ...jobs.map((j) => j.url),
      domain ? `https://${domain}` : null,
    ]),
    missing_fields: missing,
    conflicting_evidence: conflicting,
  };
}

// ───────────────────────────────────────────────── employers from job rows ──

/**
 * A stable employer key for a job row.
 *
 * The LinkedIn company URL when there is one, because that is an identity rather
 * than a label. Falling back to a normalized name is deliberate but weaker:
 * "Acme, Inc." and "Acme Inc" are one employer, and treating them as two buys
 * the same company's identity twice.
 */
export function employerKeyFor(job: NormalizedHiringJob): string | null {
  const url = clean(job.company_linkedin_url);
  if (url) return url.toLowerCase().replace(/\/$/, "");
  const name = clean(job.company_name);
  if (!name) return null;
  return `name:${
    name.toLowerCase()
      .replace(/[,.]/g, "")
      .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|bv|ag)\b/g, "")
      .replace(/\s+/g, " ").trim()
  }`;
}

export interface EmployerGroup {
  key: string;
  company_name: string | null;
  linkedin_company_url: string | null;
  /** Every posting seen for this employer, newest first where dates allow. */
  jobs: NormalizedHiringJob[];
}

/**
 * Collapse job rows onto the employers behind them.
 *
 * THE ANSWER TO A COMPANY QUESTION IS A COMPANY. A hiring-first mission finds
 * companies THROUGH their openings, so the postings are evidence and the
 * employer is the row. Returning the postings instead — which is what a job
 * route did before this existed — answers a different question at full price.
 *
 * Jobs are ordered newest-first per employer so that "strongest CURRENT
 * evidence" can mean the most recent opening rather than whichever row the
 * Actor happened to return first.
 */
export function groupJobsByEmployer(
  jobs: readonly NormalizedHiringJob[],
): EmployerGroup[] {
  const byKey = new Map<string, EmployerGroup>();
  for (const j of jobs) {
    const key = employerKeyFor(j);
    // A posting with neither an employer URL nor an employer name cannot be
    // attributed, and attributing it to a guess is worse than dropping it.
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.jobs.push(j);
      existing.company_name ??= clean(j.company_name);
      existing.linkedin_company_url ??= clean(j.company_linkedin_url);
    } else {
      byKey.set(key, {
        key,
        company_name: clean(j.company_name),
        linkedin_company_url: clean(j.company_linkedin_url),
        jobs: [j],
      });
    }
  }
  const parsed = (d: string | null) => {
    const t = d ? Date.parse(d) : Number.NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  for (const g of byKey.values()) {
    g.jobs.sort((a, b) => parsed(b.posted_date) - parsed(a.posted_date));
  }
  return [...byKey.values()];
}

/**
 * Turn an employer group into the discovery-time company row.
 *
 * Carries only what a job row can honestly establish: the name and the LinkedIn
 * URL. Size, industry and description are NOT invented from a posting — they are
 * what enrichment is for, and a gate that fired on a guessed employee count
 * would be worse than one that waits.
 */
export function employerToCompany(g: EmployerGroup): NormalizedHiringCompany {
  return {
    external_source_id: g.key,
    company_name: g.company_name,
    canonical_domain: null,
    linkedin_company_url: g.linkedin_company_url,
    website: null,
    description: null,
    provider_industry: null,
    industry_ids: [],
    employee_count: null,
    employee_range_advisory: null,
    geography: g.jobs[0]?.location ?? null,
    company_type: null,
    startup_evidence: null,
    // A POSTING PROVES HIRING. It is the one fact a job row establishes about
    // the employer, and the only one carried here.
    hiring_status: true,
    source_provenance: "harvestapi/linkedin-job-search",
    field_trust: {},
    missing_fields: ["employee_count", "industry", "description", "canonical_domain"],
    raw_ref: { actor_key: "apify_linkedin_job_search", source_id: g.jobs[0]?.job_id ?? null },
  };
}
