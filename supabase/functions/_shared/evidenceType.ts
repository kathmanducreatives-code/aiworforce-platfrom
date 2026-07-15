// Evidence-type integrity for Find Leads. Pure / import-free.
//
// Root cause it fixes: person-profile URLs were described as live job postings,
// and a founder's title was treated as a hiring/buying signal. This module
// classifies each evidence URL/record into ONE type and exposes invariants so a
// profile can never be presented as job evidence, and identity can never be
// presented as intent.

export type EvidenceType =
  | "job_post"
  | "company_page"
  | "person_profile"
  | "funding_announcement"
  | "company_news"
  | "intent_post"
  | "comment"
  | "product_launch"
  | "hiring_page"
  | "other";

export interface EvidenceInput {
  url?: string | null;
  /** What the actor/source claimed this was, if anything. Never trusted blindly. */
  claimed_type?: string | null;
  text?: string | null;
}

const lc = (s: unknown) => (s ?? "").toString().toLowerCase();

/** Classify an evidence URL (+ optional text) into a canonical type. URL wins. */
export function classifyEvidence(input: EvidenceInput): EvidenceType {
  const u = lc(input.url);
  const t = lc(input.text);

  // Person profile — the single strongest false-positive source.
  if (/linkedin\.com\/in\//.test(u)) return "person_profile";
  // Company / hiring surfaces.
  if (/linkedin\.com\/company\//.test(u)) return "company_page";
  if (/\/jobs?\/|\/careers?\/|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|boards\.greenhouse|linkedin\.com\/jobs/.test(u)) return "job_post";
  if (/\/careers?\b|\/jobs\b|\/join-us\b/.test(u)) return "hiring_page";
  // News / funding.
  if (/techcrunch|crunchbase|\/funding|\/series-[a-e]\b|\/raises?\b/.test(u + " " + t)) return "funding_announcement";
  if (/\/blog\/|\/news\/|\/press\//.test(u)) return "company_news";
  if (/linkedin\.com\/posts\//.test(u)) return "intent_post";
  if (/linkedin\.com\/feed\/update|\/activity-/.test(u)) return "intent_post";

  // Fall back to claimed_type only when it is a known type AND not a stronger URL.
  const claimed = lc(input.claimed_type) as EvidenceType;
  const KNOWN: EvidenceType[] = ["job_post", "company_page", "person_profile", "funding_announcement", "company_news", "intent_post", "comment", "product_launch", "hiring_page"];
  if (KNOWN.includes(claimed)) return claimed;
  return "other";
}

/** Does this evidence prove a company-level buying/hiring SIGNAL? */
export function provesCompanySignal(type: EvidenceType): boolean {
  return ["job_post", "hiring_page", "funding_announcement", "product_launch", "intent_post"].includes(type);
}

/** Does this evidence prove only a PERSON's identity (no hiring, no intent)? */
export function isIdentityOnly(type: EvidenceType): boolean {
  return type === "person_profile";
}

/** High-level evidence category, so person identity, company fit, buying signals
 * and job postings are never conflated. */
export type EvidenceCategory =
  | "person_identity"
  | "person_company_association"
  | "company_fit"
  | "buying_signal"
  | "job_signal"
  | "other";

export function evidenceCategory(type: EvidenceType): EvidenceCategory {
  switch (type) {
    case "person_profile": return "person_identity";
    case "company_page": return "company_fit";
    case "job_post":
    case "hiring_page": return "job_signal";
    case "funding_announcement":
    case "product_launch":
    case "intent_post": return "buying_signal";
    default: return "other";
  }
}

export interface EvidenceViolation { code: string; message: string }

/**
 * Invariant checks that must NEVER be violated when a lead is assembled:
 *   - a person_profile URL may not be labelled job/hiring evidence
 *   - a founder/exec title may not be used as a hiring/buying signal
 *   - a job_post must identify an employer and carry a role
 * Returns the list of violations (empty = clean).
 */
export function checkEvidenceInvariants(args: {
  signal_evidence_type?: EvidenceType | null;
  signal_label?: string | null;         // e.g. "live job posting", "hiring"
  is_signal_from_person_title?: boolean; // founder title used as the signal?
  job_post?: { employer?: string | null; role_title?: string | null } | null;
  /** When the REQUESTED artifact is a person (target_entity=person), a person
   * profile is the desired identity evidence — not a job/hiring contradiction.
   * Job-specific violations then do not apply; `identity_only_signal` remains as
   * an honest, auditable limitation (a profile alone is not a company signal). */
  requested_artifact_is_person?: boolean;
}): EvidenceViolation[] {
  const out: EvidenceViolation[] = [];
  const label = lc(args.signal_label);
  const personRequested = args.requested_artifact_is_person === true;

  // `profile_as_job`/`title_as_signal` are JOB-SPECIFIC contradictions: they only
  // apply when a person profile is being MISPRESENTED as job/hiring evidence in a
  // company/role-family search. When the person IS the requested artifact, the
  // profile is identity evidence and neither fabricated contradiction applies.
  if (!personRequested && args.signal_evidence_type === "person_profile" && /(job|hiring|posting|opening|role open)/.test(label)) {
    out.push({ code: "profile_as_job", message: "A person_profile URL cannot be described as a job posting." });
  }
  if (!personRequested && args.is_signal_from_person_title) {
    out.push({ code: "title_as_signal", message: "A founder/exec title is identity, not a hiring or buying signal." });
  }
  if (args.signal_evidence_type === "person_profile") {
    // Identity alone is never a company-level buying/hiring signal — recorded as an
    // honest limitation whether or not a person was requested.
    out.push({ code: "identity_only_signal", message: "A person_profile alone is not a company-level signal." });
  }
  if (args.job_post) {
    if (!args.job_post.employer || !args.job_post.employer.toString().trim()) {
      out.push({ code: "jobpost_no_employer", message: "A job_post must identify the hiring employer." });
    }
    if (!args.job_post.role_title || !args.job_post.role_title.toString().trim()) {
      out.push({ code: "jobpost_no_role", message: "A job_post must carry a role title." });
    }
  }
  return out;
}
