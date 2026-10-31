// What a lead's hard requirements rest on, as the Leads page shows it.
//
// The engine persists, per lead row, `canonical_decision.hard_evidence`: one
// entry per hard requirement with its result, the EXTERNAL provider(s) behind
// it, whether two independent sources agree, and whether Agentory applied its
// own rule to the provider's data (`canonicalHardEvidence`). This turns those
// entries into readable source lines and never upgrades a claim:
//
//   independently_verified  two independent origins agree (e.g. Atomus and
//                           Pvalyou), or a corroboration step confirmed it
//   provider_reported       one provider's data — however Agentory checked it
//   missing                 nothing established it
//   not_met                 the evidence contradicts it
//
// Provider keys are shown by name ("LinkedIn job posting (via Apify)"); an
// engine rule name is never shown as a source.
//
// Pure, and free of path aliases so the Deno suite can test it directly.

export interface RequirementEvidenceEntry {
  dimension: string;
  result: string;
  reason: string;
  source: string | null;
  providers: string[];
  corroborated: boolean;
  checkedByRule: boolean;
  method: string | null;
  status: string | null;
  confidence: string | null;
  url: string | null;
  excerpt: string | null;
}

export type EvidenceStanding = "independently_verified" | "provider_reported" | "missing" | "not_met";

export interface RequirementEvidenceLine {
  dimension: string;
  /** "Funding · Reported by Atomus funding data (via Apify) · not independently confirmed" */
  headline: string;
  /** What the check found, in words that claim no more than the standing. */
  detail: string;
  url: string | null;
  /** The provider names behind it, never an engine rule. */
  providers: string[];
  standing: EvidenceStanding;
  confidence: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Engine rules that older rows (before providers were recorded) carry as `source`. */
const ENGINE_RULES = new Set(["deterministic_verdict", "engine"]);

const PROVIDER_NAME: Record<string, string> = {
  apify_linkedin_job_search: "LinkedIn job posting (via Apify)",
  apify_linkedin_company_details: "LinkedIn company page (via Apify)",
  apify_linkedin_company_search: "LinkedIn company search (via Apify)",
  linkedin: "LinkedIn company page (via Apify)",
  apify_funding_atomus: "Atomus funding data (via Apify)",
  apify_funding_pvalyou: "Pvalyou company record (via Apify)",
  funding_corroboration: "Atomus and Pvalyou, cross-checked",
  firecrawl: "the company's own website",
};

/** A provider key as a person reads it; an unknown key is shown as itself, an engine rule never. */
export function providerName(key: string): string | null {
  if (ENGINE_RULES.has(key)) return null;
  return PROVIDER_NAME[key] ?? key;
}

/** The persisted entries on one lead row's raw JSON, well-formed ones only. */
export function requirementEvidenceOf(raw: unknown): RequirementEvidenceEntry[] {
  const decision = isObj(raw) && isObj(raw.canonical_decision) ? raw.canonical_decision : null;
  const list = decision && Array.isArray(decision.hard_evidence) ? decision.hard_evidence : [];
  return list.filter(isObj).filter((e) => str(e.dimension) && str(e.result)).map((e) => ({
    dimension: String(e.dimension), result: String(e.result), reason: str(e.reason) ?? "",
    source: str(e.source),
    providers: Array.isArray(e.providers) ? e.providers.filter((p): p is string => typeof p === "string" && !!p.trim()) : [],
    // Absent on rows written before it existed: never assumed.
    corroborated: e.corroborated === true,
    checkedByRule: e.checked_by_rule === true || e.method === "deterministic_derivation",
    method: str(e.method), status: str(e.status), confidence: str(e.confidence),
    url: str(e.url), excerpt: str(e.excerpt),
  }));
}

const LABEL: Record<string, string> = {
  geography: "Location", hiring: "Hiring", funding: "Funding", company_size: "Company size",
  industry: "Industry", business_model: "Business model", company_stage: "Funding stage",
};

/** The engine's wording without a verification claim the standing does not support. */
function plainDetail(e: RequirementEvidenceEntry, standing: EvidenceStanding): string {
  let text = e.excerpt ?? e.reason;
  // An engine rule is how a provider's data was checked, never a source.
  text = text.replace(/\b(?:is\s+)?proven by (?:deterministic_verdict|engine)\b/g, "matches the provider's record, checked by Agentory's rule")
    .replace(/\b(?:deterministic_verdict|engine)\b/g, "Agentory's rule");
  if (standing === "independently_verified") return text;
  return text.replace(/\b(?:independently\s+)?verified\s+/gi, "").replace(/\bproven\b/gi, "supported");
}

/** One readable line per requirement. */
export function requirementEvidenceLines(raw: unknown): RequirementEvidenceLine[] {
  return requirementEvidenceOf(raw).map((e) => {
    const names = [...new Set([e.source, ...e.providers].filter((k): k is string => !!k)
      .map(providerName).filter((n): n is string => !!n))];
    const standing: EvidenceStanding = e.result === "fail" ? "not_met"
      : e.result !== "pass" ? "missing"
      : e.corroborated ? "independently_verified"
      : "provider_reported";
    const parts = [LABEL[e.dimension] ?? e.dimension];
    if (standing === "independently_verified") parts.push(`Independently confirmed (${names.join(" + ") || "two sources"})`);
    else if (standing === "provider_reported") {
      parts.push(names.length ? `Reported by ${names[0]}` : "Reported by a provider (provider not recorded)");
      parts.push(e.checkedByRule ? "checked against the requirement by Agentory, not independently confirmed" : "not independently confirmed");
    } else if (standing === "missing") parts.push("Evidence missing");
    else parts.push("Not met");
    return {
      dimension: e.dimension, headline: parts.join(" · "), detail: plainDetail(e, standing),
      url: e.url, providers: names, standing, confidence: e.confidence,
    };
  });
}
