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
function hasAny(text: string, terms: string[]): boolean {
  const t = lc(text);
  return terms.some((n) => { const q = lc(n).trim(); return !!q && t.includes(q); });
}

// Default off-ICP industry/type exclusions — applied UNLESS the Brain positively
// targets that space. These are the "huge irrelevant company" buckets.
export const DEFAULT_EXCLUDED_INDUSTRIES: string[] = [
  "oil", "gas", "petroleum", "refinery", "refineries", "mining", "coal",
  "heavy manufacturing", "steel", "cement", "chemicals plant",
  "government", "federal", "ministry", "public sector", "municipal",
  "military", "defense", "defence", "armed forces",
  "university", "universities", "college", "school district", "k-12", "k12",
  "hospital", "clinic", "health system", "medical center",
  "bank", "banking", "credit union", "insurance", "reinsurance",
  "accounting firm", "audit firm", "law firm", "legal services",
  "restaurant", "hotel", "hospitality", "casino", "resort",
  "utility", "power plant", "oilfield",
];

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
    const h = hay(cand);
    const hit = activeDefaults.find((d) => h.includes(d));
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
