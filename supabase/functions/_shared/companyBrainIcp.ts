// Company Brain → derived ICP (Phase: analyst quality).
//
// Company Brain is the source of truth. This pure helper turns whatever the
// founder filled in — structured `icp` when present, else free-text fields
// (what_we_do / who_we_sell_to / positioning / competitors …) — into ONE derived
// ICP object that Scout (query), Aria (scoring), the proof gate, and Workbench
// all consume. It derives SAFE hints from free text, never over-infers, and
// flags weak/ inferred context instead of pretending. No fabrication.
//
// Pure / import-free so it is fully unit-testable.

export interface DerivedCompanyIcp {
  targetIndustries: string[];
  targetCompanyTypes: string[];
  targetCompanySize: { min: number | null; max: number | null; label: string | null };
  targetBuyers: string[];
  targetSignals: string[];
  competitorKeywords: string[];
  positioningKeywords: string[];
  negativeTerms: string[];
  disqualifiers: string[];
  geo: string | null;
  weakIcpContext: boolean;       // true when ICP is only inferred from vague text
  derivationSources: string[];   // which inputs contributed
  missingIcpFields: string[];
}

export interface BrainProfile {
  icp?: Record<string, unknown> | null;
  company_name?: string | null;
  what_we_do?: string | null;
  who_we_sell_to?: string | null;
  target_customers?: string | null;
  pain_points?: string | null;
  positioning?: unknown;
  competitors?: unknown;
  disqualifiers?: unknown;
  buyer_personas?: unknown;
  [k: string]: unknown;
}

// Default high-risk disqualifiers — applied only when the Brain has none of its own.
export const DEFAULT_DISQUALIFIERS = [
  "manufacturing", "construction", "retail", "restaurant", "hospitality",
  "university", "school", "hospital", "bank", "government", "logistics",
  "local services", "plant operations", "field operations", "warehouse operations",
];

// Industries that are structurally off-ICP for a B2B SaaS / AI SaaS / software
// seller. Added ON TOP of any Brain-specified disqualifiers whenever the ICP is
// software (so a lab / analytical-services / pharma / chemicals / packaging /
// staffing account hard-rejects even when its job title happens to match).
export const SOFTWARE_ICP_DISQUALIFIERS = [
  "lab testing", "laboratory testing", "testing laboratory", "clinical laboratory",
  "analytical services", "analytical laboratory", "laboratory services", "environmental testing",
  "pharma", "pharmaceutical", "pharmaceuticals", "biopharma", "life sciences testing",
  "chemical", "chemicals", "specialty chemicals",
  "packaging", "contract packaging", "packaging solutions",
  "staffing", "staffing agency", "recruiting agency", "recruitment agency", "staffing and recruiting",
];

// Detects whether the seller's own ICP is software/SaaS from its industries,
// categories and free-text context — the trigger for SOFTWARE_ICP_DISQUALIFIERS.
const SOFTWARE_ICP_RE = /\b(b2b saas|ai saas|saas|software|b2b tech|platform|api|dev ?tool|cloud app|martech|fintech|sales tech|revops|revenue operations)\b/i;

/** True when a seller's ICP targets software/SaaS companies (context-driven, never assumed). */
export function isSoftwareIcp(terms: Array<string | null | undefined>): boolean {
  return terms.some((t) => !!t && SOFTWARE_ICP_RE.test(String(t)));
}

function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : (x && typeof x === "object" && "name" in (x as any) ? String((x as any).name) : ""))).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (v && typeof v === "object") return arr((v as any).competitors ?? (v as any).items ?? []);
  return [];
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function lc(s: unknown): string { return String(s ?? "").toLowerCase(); }

// Free-text → safe structured hints.
const SAAS_RE = /\b(b2b saas|ai saas|saas|software|b2b tech|b2b|platform|api|cloud|app)\b/i;
const SMALL_TEAM_RE = /\b(founders?|small teams?|startups?|early[- ]stage|seed|series a|small b2b)\b/i;
const FOUNDER_BUYER_RE = /\b(founders?|co-?founders?|ceos?|founder-led|owners?)\b/i;

/** Parse an ICP company-size label ("10-150 employees", "SMB") to bounds. */
export function parseSizeLabel(label: string | null | undefined): { min: number | null; max: number | null; label: string | null } {
  const l = str(label);
  if (!l) return { min: null, max: null, label: null };
  const range = l.replace(/,/g, "").match(/(\d+)\s*[-–to]+\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]), label: l };
  if (/enterprise|fortune|large/i.test(l)) return { min: 1000, max: null, label: l };
  if (/smb|small|startup|founder/i.test(l)) return { min: 1, max: 150, label: l };
  if (/mid[- ]?market/i.test(l)) return { min: 100, max: 1000, label: l };
  return { min: null, max: null, label: l };
}

/**
 * Derive a usable ICP from the Company Brain. Prefers structured `icp`; falls
 * back to safe free-text hints (flagged weak). Never over-infers.
 */
export function deriveCompanyIcp(profile: BrainProfile | null | undefined): DerivedCompanyIcp {
  const p = profile ?? {};
  const icp = (p.icp && typeof p.icp === "object") ? p.icp as Record<string, unknown> : {};
  const derivationSources: string[] = [];
  const missingIcpFields: string[] = [];

  const hasStructured = Object.values(icp).some((v) => (Array.isArray(v) ? v.length : (v != null && v !== "")));

  // --- structured first ---
  let targetIndustries = arr(icp.industries ?? icp.target_industries);
  let targetCompanyTypes = arr(icp.company_types ?? icp.target_company_types ?? icp.preferred_company_types);
  let sizeLabel = str(icp.company_size ?? icp.target_company_size);
  let targetBuyers = arr(icp.buyer_roles ?? icp.target_buyers ?? icp.buyer_personas ?? p.buyer_personas);
  let targetSignals = arr(icp.target_signals ?? icp.signals);
  let competitorKeywords = arr(icp.competitors ?? p.competitors ?? (p.positioning as any)?.competitors);
  let positioningKeywords = arr(icp.positioning_keywords ?? icp.keywords);
  const negativeTerms = arr(icp.negative_role_terms ?? icp.negative_keywords);
  let disqualifiers = arr(icp.disqualifiers ?? p.disqualifiers);
  let geo = str(icp.geography ?? icp.geo ?? (Array.isArray(icp.target_regions) ? (icp.target_regions as string[])[0] : null));

  if (hasStructured) derivationSources.push("structured_icp");

  // --- free-text fallback (only fills empties; flagged) ---
  const freeText = [str(p.what_we_do), str(p.who_we_sell_to), str(p.target_customers), str((p.positioning as any)) ].filter(Boolean).join(". ");
  const usedFreeText = !hasStructured && !!freeText;
  if (usedFreeText) {
    const ft = lc(freeText);
    if (targetIndustries.length === 0 && SAAS_RE.test(ft)) targetIndustries = ["B2B SaaS", "B2B tech", "software"];
    if (targetCompanyTypes.length === 0 && /\b(founder|small team|startup)\b/i.test(ft)) targetCompanyTypes = ["small team", "founder-led"];
    if (!sizeLabel && SMALL_TEAM_RE.test(ft)) sizeLabel = "10-150 employees"; // safe small-team default
    if (targetBuyers.length === 0 && FOUNDER_BUYER_RE.test(ft)) targetBuyers = ["Founder", "Co-Founder", "CEO"];
    derivationSources.push("free_text");
  }

  // Missing-field accounting.
  if (targetIndustries.length === 0) missingIcpFields.push("industries");
  if (!sizeLabel) missingIcpFields.push("company_size");
  if (targetBuyers.length === 0) missingIcpFields.push("buyer_roles");
  if (targetSignals.length === 0) missingIcpFields.push("target_signals");
  if (disqualifiers.length === 0) missingIcpFields.push("disqualifiers");

  // Default disqualifiers only when the Brain supplies none.
  if (disqualifiers.length === 0) disqualifiers = [...DEFAULT_DISQUALIFIERS];

  // When the ICP targets software/SaaS, always fold in the software-ICP hard
  // rejects (lab/analytical/pharma/chemicals/packaging/staffing) so a bad-fit
  // account is rejected even when its job title matches. Never replaces the
  // Brain's own list — merged on top.
  const softwareIcp = isSoftwareIcp([...targetIndustries, ...positioningKeywords, freeText]);
  if (softwareIcp) {
    const seen = new Set(disqualifiers.map((d) => d.toLowerCase()));
    for (const d of SOFTWARE_ICP_DISQUALIFIERS) if (!seen.has(d.toLowerCase())) { disqualifiers.push(d); seen.add(d.toLowerCase()); }
  }

  // Weak context: structured ICP absent (only inferred / defaults).
  const weakIcpContext = !hasStructured;

  return {
    targetIndustries,
    targetCompanyTypes,
    targetCompanySize: parseSizeLabel(sizeLabel),
    targetBuyers,
    targetSignals,
    competitorKeywords,
    positioningKeywords,
    negativeTerms,
    disqualifiers,
    geo,
    weakIcpContext,
    derivationSources: [...new Set(derivationSources)],
    missingIcpFields,
  };
}
