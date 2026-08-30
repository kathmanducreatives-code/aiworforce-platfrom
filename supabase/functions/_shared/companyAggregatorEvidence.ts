// AGGREGATOR / STAFFING EVIDENCE — the check that saves the funnel.
//
// In the benchmark the ONLY company that survived the whole Route B funnel was
// Swooped: it passed a Software Development industry filter, and it was the only
// company that "verified as hiring". Enrichment then showed its real LinkedIn
// industry is 104 Staffing and Recruiting, and two of its postings described
// entirely different businesses (an IT-services firm; an early-education
// company). Its job descriptions are anonymised third-party listings.
//
// Without this check the pipeline would have produced founder outreach to a job
// board about roles it is not hiring for.
//
// ── WHAT THIS MODULE DOES NOT DO ─────────────────────────────────────────────
// It does not reject anything. It emits structured, source-referenced evidence;
// the Company Brain makes the exclusion decision in the workflow PR. A single
// keyword never decides — "we recruit top talent" appears on plenty of ordinary
// company pages, so one weak signal yields `possible`, never `supported`.
//
// Pure. No I/O.

export type AggregatorStatus = "supported" | "possible" | "absent";

export interface AggregatorSignal {
  /** Stable machine code so the Brain can weigh signals it understands. */
  code: string;
  detail: string;
  /** STRONG signals can reach `supported` alone; WEAK ones cannot. */
  strength: "strong" | "weak";
  evidence_ref: string;
}

export interface AggregatorEvidence {
  status: AggregatorStatus;
  signals: AggregatorSignal[];
  source_refs: string[];
}

/** LinkedIn industry ids that ARE the intermediary business. */
export const STAFFING_INDUSTRY_IDS: readonly string[] = ["104"]; // Staffing and Recruiting
export const STAFFING_INDUSTRY_NAMES: readonly string[] = [
  "staffing and recruiting", "staffing & recruiting", "human resources services",
];

/** Description phrases that describe an intermediary, not an employer. */
const INTERMEDIARY_PHRASES: readonly string[] = [
  "job board", "job search platform", "recruiting agency", "recruitment agency",
  "staffing agency", "staffing firm", "talent marketplace", "hiring marketplace",
  "we match candidates", "connects job seekers", "apply to thousands",
  "outsourced recruiting", "recruitment process outsourcing", "headhunting",
];

/** Anonymised-employer phrasing seen in aggregator postings. */
const ANONYMISED_EMPLOYER_PHRASES: readonly string[] = [
  "about the opportunity", "the company takes ownership", "this organization is",
  "the organization partners", "our client", "the hiring company",
  "a leading company", "the employer is", "confidential client",
];

const lower = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : "");

export interface AggregatorInput {
  company_name?: string | null;
  /** Enriched industry ids — the authoritative signal. */
  industry_ids?: Array<{ id: string; name: string; hierarchy?: string | null }>;
  provider_industry?: string | null;
  description?: string | null;
  website?: string | null;
  canonical_domain?: string | null;
  /** Normalized postings attributed to this company. */
  postings?: Array<{ job_id?: string | null; title?: string | null; description?: string | null }>;
}

/**
 * Extract aggregator/staffing evidence.
 *
 * Reaching `supported` requires either an authoritative industry classification
 * or two independent behavioural signals — one keyword is deliberately not
 * enough to condemn a company.
 */
export function extractAggregatorEvidence(input: AggregatorInput): AggregatorEvidence {
  const signals: AggregatorSignal[] = [];
  const refs: string[] = [];

  // 1. AUTHORITATIVE INDUSTRY. This is what caught Swooped.
  for (const ind of input.industry_ids ?? []) {
    const idHit = STAFFING_INDUSTRY_IDS.includes(String(ind.id));
    const nameHit = STAFFING_INDUSTRY_NAMES.some((x) => lower(ind.name).includes(x)) ||
      STAFFING_INDUSTRY_NAMES.some((x) => lower(ind.hierarchy).includes(x));
    if (idHit || nameHit) {
      signals.push({
        code: "enriched_industry_staffing", strength: "strong",
        detail: `enriched LinkedIn industry ${ind.id} "${ind.name}" is a staffing/recruiting classification`,
        evidence_ref: "enrichment:industry_ids",
      });
      refs.push("enrichment:industry_ids");
    }
  }

  // 2. PROVIDER INDUSTRY. Weaker — the benchmark proved this label unreliable
  //    in BOTH directions, so it can support but never conclude.
  if (STAFFING_INDUSTRY_NAMES.some((x) => lower(input.provider_industry).includes(x))) {
    signals.push({
      code: "provider_industry_staffing", strength: "weak",
      detail: `provider industry "${input.provider_industry}" suggests staffing (unreliable label)`,
      evidence_ref: "candidate:provider_industry",
    });
    refs.push("candidate:provider_industry");
  }

  // 3. SELF-DESCRIPTION AS AN INTERMEDIARY.
  const desc = lower(input.description);
  const descHits = INTERMEDIARY_PHRASES.filter((p) => desc.includes(p));
  if (descHits.length > 0) {
    signals.push({
      code: "description_intermediary", strength: descHits.length >= 2 ? "strong" : "weak",
      detail: `company description contains intermediary language: ${descHits.slice(0, 3).join(", ")}`,
      evidence_ref: "company:description",
    });
    refs.push("company:description");
  }

  // 4. ANONYMISED THIRD-PARTY POSTINGS.
  const postings = input.postings ?? [];
  const anon = postings.filter((p) =>
    ANONYMISED_EMPLOYER_PHRASES.some((x) => lower(p.description).includes(x)));
  if (anon.length > 0) {
    signals.push({
      code: "anonymised_third_party_postings", strength: anon.length >= 2 ? "strong" : "weak",
      detail: `${anon.length} of ${postings.length} postings describe an unnamed third-party employer`,
      evidence_ref: `postings:${anon.map((p) => p.job_id ?? "?").slice(0, 4).join(",")}`,
    });
    refs.push("postings:descriptions");
  }

  // 5. MULTIPLE UNRELATED EMPLOYERS ACROSS POSTINGS. The clearest behavioural
  //    tell: one company's postings should not describe several businesses.
  const industriesMentioned = distinctBusinessContexts(postings);
  if (industriesMentioned.size >= 2) {
    signals.push({
      code: "multiple_unrelated_employers", strength: "strong",
      detail: `postings describe ${industriesMentioned.size} unrelated business contexts: ${[...industriesMentioned].slice(0, 4).join(", ")}`,
      evidence_ref: "postings:business_context",
    });
    refs.push("postings:business_context");
  }

  // 6. IDENTITY MISMATCH between company name and its own domain.
  const mismatch = nameDomainMismatch(input.company_name, input.canonical_domain);
  if (mismatch) {
    signals.push({
      code: "name_domain_mismatch", strength: "weak",
      detail: mismatch, evidence_ref: "company:website",
    });
    refs.push("company:website");
  }

  // One strong signal concludes; two independent weak ones agree; one weak one
  // is only `possible`. Shared with `attributionOnlyStatus` so a subset can
  // never be scored by a different rule than the whole.
  return { status: statusOf(signals), signals, source_refs: [...new Set(refs)] };
}

/**
 * Distinct business contexts across postings.
 *
 * Deliberately coarse: it only counts clearly different SECTORS, so a company
 * hiring for engineering and for sales does not look like an aggregator.
 */
const SECTOR_MARKERS: Record<string, readonly string[]> = {
  it_services: ["it environments", "managed services", "it infrastructure", "highly regulated organizations"],
  education: ["early education", "childhood", "students", "curriculum", "school"],
  healthcare: ["patients", "clinical", "oncology", "healthcare providers"],
  logistics: ["supply chain", "fulfillment", "freight", "warehouse"],
  finance: ["banking", "payments", "lending", "underwriting"],
  travel: ["travel", "hospitality", "airline", "booking"],
};

function distinctBusinessContexts(
  postings: Array<{ description?: string | null }>,
): Set<string> {
  const found = new Set<string>();
  for (const p of postings) {
    const d = lower(p.description);
    if (!d) continue;
    for (const [sector, markers] of Object.entries(SECTOR_MARKERS)) {
      if (markers.some((m) => d.includes(m))) found.add(sector);
    }
  }
  return found;
}

function nameDomainMismatch(name: string | null | undefined, domain: string | null | undefined): string | null {
  const nm = lower(name).replace(/[^a-z0-9]/g, "");
  const dm = lower(domain).split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  if (!nm || !dm || nm.length < 4 || dm.length < 4) return null;
  if (nm.includes(dm) || dm.includes(nm)) return null;
  return `company name "${name}" does not correspond to its domain "${domain}"`;
}

// ── TWO QUESTIONS, ONE STATUS ───────────────────────────────────────────────
//
// The signals above answer two different questions, and collapsing them into a
// single `status` is what let a mission be refused its own subject matter.
//
//   IDENTITY      "this company IS an intermediary"
//   ATTRIBUTION   "these postings belong to somebody else"
//
// For a mission sourcing SaaS buyers both are disqualifying, so the difference
// never showed. For a mission whose ICP *is* recruiting and staffing firms they
// diverge completely: being a staffing firm is the thing that was asked for,
// while a posting that describes an unnamed client is still not proof that this
// company is hiring. The first must not reject; the second still must.
//
// Splitting them here — beside the signals themselves — is what keeps the
// detector and the exemption from drifting apart.

/** Signals about WHAT THIS COMPANY IS. */
export const IDENTITY_SIGNAL_CODES: readonly string[] = [
  "enriched_industry_staffing", "provider_industry_staffing",
  "description_intermediary", "name_domain_mismatch",
];

/** Signals about WHOSE HIRING THESE POSTINGS ARE. */
export const ATTRIBUTION_SIGNAL_CODES: readonly string[] = [
  "anonymised_third_party_postings", "multiple_unrelated_employers",
];

/** The same thresholds as `extractAggregatorEvidence`, over a subset. */
function statusOf(signals: AggregatorSignal[]): AggregatorStatus {
  const strong = signals.filter((x) => x.strength === "strong").length;
  if (strong >= 1) return "supported";
  if (signals.length >= 2) return "supported";
  return signals.length === 1 ? "possible" : "absent";
}

/**
 * The status ignoring what the company IS.
 *
 * Used when the mission asked for intermediaries: the identity signals then
 * describe a match rather than a disqualification, and only misattributed
 * postings remain a finding.
 */
export function attributionOnlyStatus(e: AggregatorEvidence): AggregatorStatus {
  return statusOf(e.signals.filter((s) => ATTRIBUTION_SIGNAL_CODES.includes(s.code)));
}

/**
 * Vertical wording that names the intermediary category itself.
 *
 * Deliberately the mission's OWN vocabulary rather than the LinkedIn industry
 * names above: a compiled mission says "recruiting" and "staffing", not
 * "Staffing and Recruiting", and matching one against the other is why the
 * category could be both the target and the exclusion at the same time.
 */
const INTERMEDIARY_VERTICAL_TERMS: readonly string[] = [
  "staffing", "recruiting", "recruitment", "recruiter", "talent acquisition",
  "headhunting", "executive search", "human resources", "hr services",
  "employment agency", "job board", "talent marketplace",
];

/**
 * Did the request ask for the very category this module detects?
 *
 * ── WHY THE USER'S RAW WORDS ARE NOT CONSULTED ────────────────────────────
 *
 * Everywhere else in this codebase the user's own words outrank the compiled
 * mission. Not here, and for a reason specific to this question: "recruiting"
 * and "hiring" are also how a sourcing request names the SIGNAL it is looking
 * for. "SaaS companies that are recruiting engineers" contains "recruiting" and
 * targets no intermediary at all, so a substring test against the query would
 * exempt the gate for missions it must still protect.
 *
 * `company_profile.verticals` is the compiler's structured reading of WHO the
 * ICP is, separate from the signal it must exhibit, so it is the only field
 * that can answer this without conflating the two.
 */
export function missionTargetsIntermediaries(i: {
  mission_verticals?: readonly string[] | null;
}): { targets: boolean; matched: string[] } {
  const verticals = (i.mission_verticals ?? [])
    .map((v) => lower(v).trim()).filter(Boolean);
  const matched = INTERMEDIARY_VERTICAL_TERMS.filter((t) =>
    verticals.some((v) =>
      // "recruiting agencies" names "recruiting".
      v.includes(t) ||
      // A truncated vertical still names the term — but only when it is long
      // enough to mean something. Without the length floor a vertical of "it"
      // matches "recruiting", which is how a bound meant to widen one mission
      // silently widens every other one.
      (v.length >= 4 && t.includes(v))));
  return { targets: matched.length > 0, matched };
}

/**
 * Does a posting prove THIS company is the employer?
 *
 * Never true when aggregator evidence is supported: the posting company and the
 * employer are then different entities, and treating them as one is how the
 * benchmark's funnel produced a job board as its only lead.
 */
export function postingProvesEmployer(evidence: AggregatorEvidence): boolean {
  return evidence.status === "absent";
}
