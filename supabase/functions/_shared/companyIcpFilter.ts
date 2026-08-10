// Company-Brain ICP filter for lead discovery.
//
// The prompt describes the SIGNAL (e.g. "hiring an Executive Assistant"); the
// Company Brain describes the TARGET COMPANY. The jobs/people actors can't filter
// by industry/size natively, so this pure module applies the ICP as a POST-source
// gate: it rejects companies that fall outside the Brain's ICP (wrong industry,
// too large, disqualified type) and — by DEFAULT — the obviously-irrelevant giants
// (oil, government, hospitals, banks, universities, Fortune-500 conglomerates)
// UNLESS the Company Brain explicitly targets them.
//
// Pure / import-free so it is fully unit-testable. Never fabricates data.

export interface IcpCandidate {
  company?: string | null;
  industry?: string | null;
  company_category?: string | null;
  team_size?: string | number | null;   // "42", "5-150", "1200 employees", 42…
  company_type?: string | null;
  location?: string | null;
  title?: string | null;
  source_url?: string | null;
}

export interface IcpConstraints {
  positive_industries?: string[];   // ICP industries (SaaS, Fintech…) — at least one must match if set
  negative_industries?: string[];   // Brain "avoid" industries
  excluded_company_types?: string[]; // Brain "avoid" types (agencies, consultancies…)
  preferred_company_types?: string[];
  max_employees?: number | null;     // derived from ICP size band (e.g. 150)
  min_employees?: number | null;
  allow_enterprise?: boolean;        // Brain explicitly targets enterprise/Fortune-500
  disqualifiers?: string[];          // free-text disqualifier terms
  strict_industry?: boolean;         // reject when NO positive-industry match (default true when positives set)
}

export interface IcpTrace {
  stage: string; before_count: number; after_count: number; rejected_count: number;
  rejected_reasons: Record<string, number>;
}
export interface IcpResult {
  accepted: IcpCandidate[];
  rejected: Array<{ item: IcpCandidate; reason: string }>;
  trace: IcpTrace[];
  matched: Map<IcpCandidate, string[]>;  // per-accepted: why it matched (for Workbench)
}

function lc(s: unknown): string { return String(s ?? "").toLowerCase(); }
function hay(c: IcpCandidate): string { return lc(`${c.company ?? ""} ${c.industry ?? ""} ${c.company_category ?? ""} ${c.company_type ?? ""}`); }
/** Observable business-model vocabulary. Presence of one of these is EVIDENCE;
 * absence is unknown, never a proven mismatch. */
const KNOWN_BUSINESS_MODEL_TERMS = [
  "saas", "software as a service", "marketplace", "ecommerce", "e-commerce", "d2c",
  "dtc", "consumer", "b2b", "b2c", "agency", "consultancy", "consulting", "services",
  "hardware", "fintech lending", "subscription", "platform", "open source", "paas", "iaas",
];

function hasAny(text: string, terms: string[]): boolean {
  const t = lc(text);
  return terms.some((n) => { const q = lc(n).trim(); return !!q && t.includes(q); });
}

// ---- INDUSTRY FAMILIES: contradiction vs insufficiency ----------------------
//
// The old industry gate treated "the provider label does not literally contain
// the ICP phrase" as a proven mismatch. Brain ICPs are written as marketing
// phrases ("B2B SaaS"); LinkedIn writes taxonomy labels ("Software Development").
// The two never share a substring, so on TEST task
// 8af17651-5fa2-48e2-af87-4bc923146243 every genuine SaaS company — Docusign,
// Outreach, Clay, Sortly, Harmonic Security — was hard-rejected as off-industry
// while the ICP was, in fact, B2B SaaS.
//
// The distinction that matters is CONTRADICTION vs INSUFFICIENCY. "Restaurants"
// contradicts a SaaS ICP. "Software Development" does not — it is the same
// family, stated at a coarser grain, and the honest answer is UNKNOWN so
// enrichment or semantic classification can resolve it.
const INDUSTRY_FAMILIES: ReadonlyArray<{ family: string; tokens: readonly string[] }> = [
  { family: "software", tokens: [
    "saas", "software as a service", "software", "software development", "computer software",
    "information technology", "it services", "internet", "technology", "tech", "platform",
    "cloud", "artificial intelligence", "ai", "machine learning", "data infrastructure",
    "developer tools", "cybersecurity", "computer and network security", "fintech",
    "devops", "analytics",
  ] },
  { family: "staffing", tokens: [
    "staffing", "recruiting", "recruitment", "talent acquisition", "executive search",
    "headhunting", "employment agency", "human resources services",
  ] },
  { family: "manufacturing", tokens: [
    "manufactur", "industrial", "machinery", "automotive", "aerospace", "chemicals",
    "steel", "cement", "plastics", "electronics manufacturing",
  ] },
  { family: "construction", tokens: ["construction", "civil engineering", "building materials", "contractor"] },
  { family: "retail", tokens: ["retail", "supermarket", "grocery", "apparel", "consumer goods", "wholesale"] },
  { family: "hospitality", tokens: ["restaurant", "hospitality", "hotel", "food service", "catering", "leisure"] },
  { family: "education", tokens: ["university", "school", "education", "higher education", "e-learning", "academic"] },
  { family: "healthcare", tokens: ["hospital", "healthcare", "health care", "medical", "clinic", "pharmaceutic", "biotech"] },
  { family: "financial", tokens: ["bank", "banking", "insurance", "capital markets", "investment management", "credit union"] },
  { family: "government", tokens: ["government", "public sector", "federal", "ministry", "municipal", "defense"] },
  { family: "logistics", tokens: ["logistics", "freight", "shipping", "trucking", "supply chain", "warehousing"] },
  { family: "energy", tokens: ["oil", "gas", "petroleum", "mining", "coal", "utilities", "renewable energy"] },
  { family: "real_estate", tokens: ["real estate", "property management", "commercial real estate", "proptech"] },
];

/**
 * Which families a piece of text evidences. Empty = the label names no family we
 * recognise, which is INSUFFICIENT evidence rather than a mismatch.
 */
export function industryFamilies(text: string | null | undefined): string[] {
  const t = lc(text);
  if (!t.trim()) return [];
  const out: string[] = [];
  for (const { family, tokens } of INDUSTRY_FAMILIES) {
    if (tokens.some((k) => t.includes(k))) out.push(family);
  }
  return [...new Set(out)];
}

/**
 * Tokens that positively evidence a SaaS/subscription software business, used to
 * turn a same-family UNKNOWN into a PASS. Deliberately narrower than the family
 * vocabulary: this is supporting evidence, not classification.
 */
const SAAS_SUPPORT_TOKENS = [
  "saas", "software as a service", "subscription", "b2b software", "cloud platform",
  "self-serve", "seat-based", "per-seat", "arr", "mrr", "free trial", "api platform",
];

// Default off-ICP industry/type exclusions — applied UNLESS the Brain positively
// targets that space. These are the "huge irrelevant company" buckets.
//
// This is the canonical, merged list. It used to be two independently-authored
// lists — this one and leadQualityGate.ts's DEFAULT_DISQUALIFIERS — that agreed
// on most entries but not all. Merged as a reviewed union, not an automatic
// set union: every entry below that came from only one of the two original
// lists is kept deliberately, because dropping it would silently change which
// companies that list's caller used to reject by default.
//
// Entries added from leadQualityGate.ts's list that were NOT already here:
//   - "manufacturing"          (leadQualityGate's was broader than this list's
//                                pre-merge "heavy manufacturing" — kept both;
//                                the bare term was already rejecting ordinary
//                                manufacturers by default on the quality-gate
//                                path, not just heavy industry)
//   - "plant operations"       (leadQualityGate-only; a distinct off-ICP signal
//                                from "heavy manufacturing")
//   - "construction"           (leadQualityGate-only; this list previously had
//                                no construction exclusion at all)
//   - "staffing agency"        (leadQualityGate-only; already excluding
//                                staffing agencies by default on that path)
//   - "recruiting agency"      (leadQualityGate-only; same reasoning)
// Both original lists' Brain-override behavior is unaffected: filterByIcp's
// activeDefaults suppression already matches on substring containment against
// `positive_industries`, so a Brain that targets "Staffing"/"Recruiting"/
// "Manufacturing"/"Construction" still un-suppresses the matching new entries
// exactly as it did for the pre-existing ones (see companyIcpFilter.test.ts
// Case B/C).
export const DEFAULT_EXCLUDED_INDUSTRIES: string[] = [
  "oil", "gas", "petroleum", "refinery", "refineries", "mining", "coal",
  "heavy manufacturing", "manufacturing", "plant operations", "construction",
  "steel", "cement", "chemicals plant",
  "government", "federal", "ministry", "public sector", "municipal",
  "military", "defense", "defence", "armed forces",
  "university", "universities", "college", "school district", "k-12", "k12",
  "hospital", "clinic", "health system", "medical center",
  "bank", "banking", "credit union", "insurance", "reinsurance",
  "accounting firm", "audit firm", "law firm", "legal services",
  "restaurant", "hotel", "hospitality", "casino", "resort",
  "utility", "power plant", "oilfield",
  "staffing agency", "recruiting agency",
];

/**
 * Every canonical exclusion term a haystack of free text contains, in list
 * order. The one shared matcher for industry/type disqualification — replaces
 * filterByIcp's and (formerly) leadQualityGate's independently-implemented
 * substring scans.
 */
export function matchedExcludedIndustries(text: string, list: string[] = DEFAULT_EXCLUDED_INDUSTRIES): string[] {
  const h = lc(text);
  return list.filter((term) => { const t = lc(term).trim(); return !!t && h.includes(t); });
}

// Well-known mega-cap companies — rejected when the ICP is size-capped and does
// not allow enterprise.
export const MEGACORP_NAMES: string[] = [
  "apple", "microsoft", "google", "alphabet", "amazon", "oracle", "meta", "facebook",
  "ibm", "intel", "cisco", "sap", "salesforce", "dell", "hp ", "hewlett", "accenture",
  "deloitte", "pwc", "kpmg", "ernst & young", "jpmorgan", "goldman sachs", "walmart",
  "exxon", "chevron", "shell", "bp ", "boeing", "lockheed", "pfizer",
];

/** Parse a team-size value into a representative employee count (upper bound of a range). */
export function parseEmployeeCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").replace(/,/g, "").toLowerCase();
  if (!s) return null;
  const range = s.match(/(\d+)\s*[-–to]+\s*(\d+)/);
  if (range) return Number(range[2]);
  const plus = s.match(/(\d+)\s*\+/);
  if (plus) return Number(plus[1]);
  const single = s.match(/(\d{1,7})/);
  return single ? Number(single[1]) : null;
}

/** Map an ICP company-size band string ("5-150 employees", "SMB", "enterprise") to bounds. */
export function sizeBandToBounds(band: string | null | undefined): { min: number | null; max: number | null; enterprise: boolean } {
  const s = lc(band);
  if (!s) return { min: null, max: null, enterprise: false };
  if (/enterprise|fortune|large|10000|5000\+/.test(s)) return { min: 1000, max: null, enterprise: true };
  const range = s.match(/(\d[\d,]*)\s*[-–to]+\s*(\d[\d,]*)/);
  if (range) return { min: Number(range[1].replace(/,/g, "")), max: Number(range[2].replace(/,/g, "")), enterprise: false };
  if (/smb|small|startup/.test(s)) return { min: 1, max: 200, enterprise: false };
  if (/mid[- ]?market|midmarket/.test(s)) return { min: 100, max: 1000, enterprise: false };
  return { min: null, max: null, enterprise: false };
}

/**
 * Filter candidates to the Company-Brain ICP. Order: default off-ICP exclusions →
 * negative industries / excluded types / disqualifiers → size cap → positive
 * industry match. Records why each accepted row matched.
 */
export function filterByIcp(candidates: IcpCandidate[], c: IcpConstraints): IcpResult {
  const rejected: Array<{ item: IcpCandidate; reason: string }> = [];
  const trace: IcpTrace[] = [];
  const matched = new Map<IcpCandidate, string[]>();
  const positives = (c.positive_industries ?? []).filter(Boolean);
  const negatives = (c.negative_industries ?? []).filter(Boolean);
  const exclTypes = (c.excluded_company_types ?? []).filter(Boolean);
  const disquals = (c.disqualifiers ?? []).filter(Boolean);
  const strictIndustry = c.strict_industry ?? positives.length > 0;
  let pool = candidates ?? [];

  const step = (name: string, before: number, kept: IcpCandidate[], reasons: Record<string, number>) =>
    trace.push({ stage: name, before_count: before, after_count: kept.length, rejected_count: before - kept.length, rejected_reasons: reasons });

  // 1) Default off-ICP giants (oil/gov/hospital/bank/university/…) — SKIP a bucket
  //    the Brain positively targets so a Manufacturing ICP still allows factories.
  const activeDefaults = DEFAULT_EXCLUDED_INDUSTRIES.filter((d) => !hasAny(positives.join(" "), [d]) && !positives.some((p) => lc(d).includes(lc(p)) || lc(p).includes(lc(d))));
  let r1: Record<string, number> = {};
  let kept = pool.filter((cand) => {
    const hit = matchedExcludedIndustries(hay(cand), activeDefaults)[0];
    if (hit) { r1[`off-ICP industry (${hit})`] = (r1[`off-ICP industry (${hit})`] ?? 0) + 1; rejected.push({ item: cand, reason: `off-ICP industry: ${hit}` }); return false; }
    return true;
  });
  step("default_exclusions", pool.length, kept, r1); pool = kept;

  // 2) Brain negatives: avoided industries, excluded types, disqualifiers.
  let r2: Record<string, number> = {};
  kept = pool.filter((cand) => {
    const h = hay(cand);
    if (negatives.length && hasAny(h, negatives)) { r2["negative industry"] = (r2["negative industry"] ?? 0) + 1; rejected.push({ item: cand, reason: "Brain-avoided industry" }); return false; }
    if (exclTypes.length && hasAny(h, exclTypes)) { r2["excluded company type"] = (r2["excluded company type"] ?? 0) + 1; rejected.push({ item: cand, reason: "excluded company type" }); return false; }
    if (disquals.length && hasAny(h, disquals)) { r2["disqualifier"] = (r2["disqualifier"] ?? 0) + 1; rejected.push({ item: cand, reason: "matched a disqualifier" }); return false; }
    return true;
  });
  step("brain_negatives", pool.length, kept, r2); pool = kept;

  // 3) Size cap — reject too-large companies (and known megacorps) unless the
  //    Brain allows enterprise.
  let r3: Record<string, number> = {};
  kept = pool.filter((cand) => {
    if (c.allow_enterprise) return true;
    const n = parseEmployeeCount(cand.team_size);
    if (c.max_employees != null && n != null && n > c.max_employees) { r3["too large (headcount)"] = (r3["too large (headcount)"] ?? 0) + 1; rejected.push({ item: cand, reason: `too large (${n} > ${c.max_employees})` }); return false; }
    if (c.min_employees != null && n != null && n < c.min_employees) { r3["too small (headcount)"] = (r3["too small (headcount)"] ?? 0) + 1; rejected.push({ item: cand, reason: `too small (${n} < ${c.min_employees})` }); return false; }
    // Megacorp name reject only when a size cap is in effect.
    if (c.max_employees != null && MEGACORP_NAMES.some((m) => lc(cand.company).includes(m.trim()))) { r3["mega-cap company"] = (r3["mega-cap company"] ?? 0) + 1; rejected.push({ item: cand, reason: "mega-cap enterprise (ICP is size-capped)" }); return false; }
    return true;
  });
  step("size_cap", pool.length, kept, r3); pool = kept;

  // 4) Positive-industry match (industry filtering BEFORE ranking). When the ICP
  //    names industries and strict_industry is on, a candidate must match one.
  let r4: Record<string, number> = {};
  kept = pool.filter((cand) => {
    const why: string[] = [];
    if (positives.length) {
      const h = hay(cand);
      const m = positives.find((p) => h.includes(lc(p)));
      if (m) why.push(`ICP industry: ${m}`);
      else if (strictIndustry) { r4["not in ICP industry"] = (r4["not in ICP industry"] ?? 0) + 1; rejected.push({ item: cand, reason: "not in an ICP industry" }); return false; }
    }
    const n = parseEmployeeCount(cand.team_size);
    if (n != null && (c.max_employees == null || n <= c.max_employees)) why.push(`${n} employees`);
    if (cand.industry) why.push(String(cand.industry));
    matched.set(cand, why);
    return true;
  });
  step("positive_industry", pool.length, kept, r4);

  return { accepted: kept, rejected, trace, matched };
}

/**
 * Build IcpConstraints from a LeadIntent-shaped object (threaded through the
 * confirmation card / run-agent). Loose input so it works on the wire payload.
 */
export function icpConstraintsFromIntent(li: {
  positive_industries?: string[]; target_industry?: string[];
  negative_industries?: string[]; excluded_company_types?: string[]; preferred_company_types?: string[];
  disqualifiers?: string[]; target_company_size?: string[]; excluded_company_sizes?: string[];
  allow_enterprise?: boolean; strictness?: string;
} | null | undefined): IcpConstraints {
  const i = li ?? {};
  const sizeBand = (i.target_company_size ?? [])[0] ?? "";
  const bounds = sizeBandToBounds(sizeBand);
  return {
    positive_industries: (i.positive_industries ?? i.target_industry ?? []).filter(Boolean),
    negative_industries: (i.negative_industries ?? []).filter(Boolean),
    excluded_company_types: (i.excluded_company_types ?? []).filter(Boolean),
    preferred_company_types: (i.preferred_company_types ?? []).filter(Boolean),
    disqualifiers: (i.disqualifiers ?? []).filter(Boolean),
    max_employees: bounds.max,
    min_employees: bounds.min,
    allow_enterprise: i.allow_enterprise === true || bounds.enterprise,
    // Only hard-require an ICP industry match when the user asked to be strict;
    // otherwise industries score/soft-filter and defaults still exclude giants.
    strict_industry: i.strictness === "strict",
  };
}

/** Top rejection reasons across the trace (for the honest scan summary). */
export function icpTopRejectReasons(trace: IcpTrace[], n = 5): Array<{ reason: string; count: number }> {
  const agg: Record<string, number> = {};
  for (const t of trace) for (const [k, v] of Object.entries(t.rejected_reasons)) agg[k] = (agg[k] ?? 0) + v;
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, n).map(([reason, count]) => ({ reason, count }));
}

// ============================================================================
// TRI-STATE COMPANY BRAIN EVALUATION
// ============================================================================
//
// WHY THIS EXISTS, next to `filterByIcp` rather than replacing it.
//
// `filterByIcp` is a FILTER: it answers "which of these may I keep?" and, by
// design, keeps anything it cannot disprove. Look at its size step — when
// `parseEmployeeCount` returns null the candidate passes, because a filter that
// dropped every company with a missing field would return nothing.
//
// That is the exact behavior that let a 7,337-employee company through the
// company-first path: nothing asserted a headcount, so nothing rejected it.
// (The deeper defect was that `filterByIcp` was never called there at all.)
//
// A hard GATE needs a third answer. "I have no evidence" is not "pass" — it is
// a reason to research, watch, or reject, and the Company Brain gets to say
// which. This evaluator provides that tri-state verdict per constraint while
// reusing this module's own tables and parsers, so there is still exactly ONE
// place that knows what a megacorp is or how to read a headcount.
//
// PURE. No network, database, provider or model access.

export type ConstraintOutcome = "pass" | "fail" | "unknown";

/** What to do when a HARD constraint has no evidence either way. */
export type UnknownEvidencePolicy = "research" | "watch" | "reject";

export interface CompanyBrainHardConstraints extends IcpConstraints {
  /** Funding/company stages the Brain accepts, lowercase ("seed", "series a"). */
  allowed_stages?: string[];
  /** Business models the Brain accepts ("saas", "marketplace"). */
  business_models?: string[];
  /** True when the Brain requires founder-led companies. */
  require_founder_led?: boolean;
  /** Behavior for a hard constraint with no evidence. Defaults to "research". */
  unknown_evidence?: UnknownEvidencePolicy;
}

/** Company evidence, beyond what the ICP filter already reads. */
export interface CompanyBrainEvidence extends IcpCandidate {
  employee_count?: number | string | null;
  company_stage?: string | null;
  business_model?: string | null;
  /**
   * Enriched company description. Often the ONLY place a business model is
   * actually stated, so the industry and business-model gates read it as
   * supporting evidence before concluding anything.
   */
  description?: string | null;
  /** Tri-state: true/false when known, null/undefined when unresolved. */
  founder_led?: boolean | null;
}

export interface BrainConstraintResult {
  constraint: "employee_count" | "industry" | "business_model" | "company_stage" | "founder_led";
  outcome: ConstraintOutcome;
  reason: string;
}

export interface CompanyBrainEvaluation {
  outcome: ConstraintOutcome;
  results: BrainConstraintResult[];
  failedConstraints: string[];
  unknownConstraints: string[];
  reasons: string[];
}

/**
 * Funding ladder, lowest first. Position is what makes "Series C fails a
 * pre-seed–Series A policy" decidable rather than a string comparison.
 */
const STAGE_LADDER: Array<{ rank: number; aliases: string[] }> = [
  { rank: 0, aliases: ["pre-seed", "preseed", "pre seed", "idea", "bootstrapped"] },
  { rank: 1, aliases: ["seed"] },
  { rank: 2, aliases: ["series a", "series-a", "seriesa"] },
  { rank: 3, aliases: ["series b", "series-b"] },
  { rank: 4, aliases: ["series c", "series-c"] },
  { rank: 5, aliases: ["series d", "series-d", "series e", "series f", "growth", "late stage", "late-stage"] },
  { rank: 6, aliases: ["public", "ipo", "publicly traded", "nasdaq", "nyse", "post-ipo"] },
];

/** Rank a stage phrase, or null when it names no stage we know. */
export function rankCompanyStage(stage: string | null | undefined): number | null {
  const s = lc(stage);
  if (!s.trim()) return null;
  // Longest alias first so "series a" is not shadowed by "seed" inside "seed a".
  const all = STAGE_LADDER.flatMap((e) => e.aliases.map((a) => ({ a, rank: e.rank })))
    .sort((x, y) => y.a.length - x.a.length);
  for (const { a, rank } of all) if (s.includes(a)) return rank;
  return null;
}

/**
 * Evaluate one company against the Company Brain's HARD constraints.
 *
 * Every constraint answers pass / fail / unknown independently, and the overall
 * outcome is the worst of them: any fail is a fail; otherwise any unknown is
 * unknown; otherwise pass. Missing evidence never silently becomes a pass.
 */
export function evaluateCompanyBrainEvidence(
  cand: CompanyBrainEvidence,
  c: CompanyBrainHardConstraints,
): CompanyBrainEvaluation {
  const results: BrainConstraintResult[] = [];
  const add = (constraint: BrainConstraintResult["constraint"], outcome: ConstraintOutcome, reason: string) =>
    results.push({ constraint, outcome, reason });

  const text = hay(cand);

  // ---- EMPLOYEE COUNT ------------------------------------------------------
  const declaredSize = cand.employee_count ?? cand.team_size;
  const n = parseEmployeeCount(declaredSize);
  const capped = c.max_employees != null || c.min_employees != null;
  if (!capped || c.allow_enterprise) {
    add("employee_count", "pass", "no headcount constraint in effect");
  } else if (n == null) {
    // A known megacorp needs no headcount field to be disqualifying.
    if (MEGACORP_NAMES.some((m) => lc(cand.company).includes(m.trim()))) {
      add("employee_count", "fail", "known mega-cap enterprise under a size-capped ICP");
    } else {
      add("employee_count", "unknown", "no employee-count evidence");
    }
  } else if (c.max_employees != null && n > c.max_employees) {
    add("employee_count", "fail", `${n} employees exceeds the maximum of ${c.max_employees}`);
  } else if (c.min_employees != null && n < c.min_employees) {
    add("employee_count", "fail", `${n} employees is below the minimum of ${c.min_employees}`);
  } else {
    add("employee_count", "pass", `${n} employees is within ${c.min_employees ?? 0}–${c.max_employees ?? "∞"}`);
  }

  // ---- INDUSTRY ------------------------------------------------------------
  const positives = (c.positive_industries ?? []).filter(Boolean);
  const negatives = (c.negative_industries ?? []).filter(Boolean);
  // Enriched free text counts as industry evidence; a company description is
  // often the only place the business model is actually stated.
  const industryEvidence = `${lc(cand.industry)} ${lc(cand.company_category)} ${lc(cand.company_type)}`.trim();
  const supportText = `${text} ${lc(cand.description)} ${lc(cand.business_model)}`;

  if (negatives.length && hasAny(text, negatives)) {
    add("industry", "fail", "matches a Brain-avoided industry");
  } else if (!positives.length) {
    add("industry", "pass", "no industry constraint in effect");
  } else if (hasAny(supportText, positives)) {
    add("industry", "pass", "matches an ICP industry");
  } else if (!industryEvidence) {
    add("industry", "unknown", "no industry evidence");
  } else {
    // THREE-VALUED. A different KNOWN family contradicts the ICP; the same
    // family at a coarser grain does not.
    const observed = industryFamilies(industryEvidence);
    const wanted = [...new Set(positives.flatMap((p) => industryFamilies(p)))];
    if (observed.length && wanted.length && !observed.some((f) => wanted.includes(f))) {
      add("industry", "fail", `industry "${industryEvidence.trim()}" belongs to a different sector than the ICP`);
    } else if (observed.length && wanted.length && hasAny(supportText, SAAS_SUPPORT_TOKENS) &&
      wanted.includes("software")) {
      add("industry", "pass", `industry "${industryEvidence.trim()}" plus business-model evidence supports the ICP`);
    } else {
      add("industry", "unknown",
        `industry "${industryEvidence.trim()}" neither confirms nor contradicts the ICP; needs enrichment or classification`);
    }
  }

  // ---- BUSINESS MODEL ------------------------------------------------------
  const models = (c.business_models ?? []).filter(Boolean);
  if (!models.length) {
    add("business_model", "pass", "no business-model constraint in effect");
  } else {
    const observed = `${lc(cand.business_model)} ${lc(cand.description)} ${text}`;
    // "No evidence" is NOT "the wrong model". A company name alone makes `text`
    // non-empty, which previously turned every evidence-free company into a
    // proven negative. A FAIL now requires an observed model that contradicts
    // the Brain; absence of any model signal stays UNKNOWN so the enrichment
    // path can resolve it.
    //
    // A shared FAMILY is also not a contradiction. "Software Development" and
    // "B2B SaaS" are the same business stated at different grains, so a
    // required-model list that lives in the software family is not refuted by
    // a generic software label — that is UNKNOWN, and enrichment or semantic
    // classification is what resolves it.
    const observedFamilies = industryFamilies(observed);
    const wantedFamilies = [...new Set(models.flatMap((m) => industryFamilies(m)))];
    const familyConflict = observedFamilies.length > 0 && wantedFamilies.length > 0 &&
      !observedFamilies.some((f) => wantedFamilies.includes(f));

    if (hasAny(observed, models)) add("business_model", "pass", "matches the required business model");
    else if (hasAny(observed, KNOWN_BUSINESS_MODEL_TERMS) && familyConflict) {
      add("business_model", "fail", "business model belongs to a different sector than the ICP");
    } else add("business_model", "unknown", "no conclusive business-model evidence");
  }

  // ---- COMPANY STAGE -------------------------------------------------------
  const allowed = (c.allowed_stages ?? []).filter(Boolean);
  if (!allowed.length) {
    add("company_stage", "pass", "no stage constraint in effect");
  } else {
    const ranks = allowed.map((s) => rankCompanyStage(s)).filter((r): r is number => r != null);
    const maxAllowed = ranks.length ? Math.max(...ranks) : null;
    const minAllowed = ranks.length ? Math.min(...ranks) : null;
    const observedRank = rankCompanyStage(cand.company_stage) ?? rankCompanyStage(text);
    if (maxAllowed == null) add("company_stage", "unknown", "stage policy could not be interpreted");
    else if (observedRank == null) add("company_stage", "unknown", "no company-stage evidence");
    else if (observedRank > maxAllowed) add("company_stage", "fail", `stage is beyond the allowed range`);
    else if (minAllowed != null && observedRank < minAllowed) add("company_stage", "fail", `stage is earlier than the allowed range`);
    else add("company_stage", "pass", "stage is within the allowed range");
  }

  // ---- FOUNDER-LED ---------------------------------------------------------
  //
  // This is a COMPANY property — is this still a founder-run business? It is NOT
  // the later mission requirement to return a Founder/CEO CONTACT. A company may
  // be founder-led with no specific person resolved yet; that person is verified
  // in the decision-maker stage, against the same company.
  if (c.require_founder_led !== true) {
    add("founder_led", "pass", "no founder-led constraint in effect");
  } else if (cand.founder_led === true) {
    add("founder_led", "pass", "founder-led evidence present");
  } else if (cand.founder_led === false) {
    add("founder_led", "fail", "company is not founder-led");
  } else {
    add("founder_led", "unknown", "no founder-led evidence");
  }

  const failedConstraints = results.filter((r) => r.outcome === "fail").map((r) => r.constraint);
  const unknownConstraints = results.filter((r) => r.outcome === "unknown").map((r) => r.constraint);
  const outcome: ConstraintOutcome =
    failedConstraints.length > 0 ? "fail" : unknownConstraints.length > 0 ? "unknown" : "pass";

  return {
    outcome, results, failedConstraints, unknownConstraints,
    reasons: results.filter((r) => r.outcome !== "pass").map((r) => `${r.constraint}: ${r.reason}`),
  };
}

/**
 * Apply the Brain's unknown-evidence policy to a tri-state outcome.
 *
 * `reject` is available for workspaces that would rather miss a company than
 * research one; the default is `research`, which keeps it out of the accepted
 * set without discarding it.
 */
export function resolveUnknownEvidence(
  outcome: ConstraintOutcome,
  policy: UnknownEvidencePolicy = "research",
): "pass" | "fail" | "unknown" {
  if (outcome !== "unknown") return outcome;
  return policy === "reject" ? "fail" : "unknown";
}
