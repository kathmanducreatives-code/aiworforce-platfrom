// What a lead's hard requirements rest on, as the Leads page shows it.
//
// The engine persists, per lead row, `canonical_decision.hard_evidence`: one
// entry per hard requirement with its result, the provider or rule behind it,
// how it was read and where (`canonicalHardEvidence`). This turns those entries
// into readable source lines. It never upgrades a claim: a value a provider
// reported is labelled "provider record", only an independent read or a
// deterministic rule over cited evidence is labelled "verified", and anything
// not established is labelled as missing.
//
// Pure, and free of path aliases so the Deno suite can test it directly.

export interface RequirementEvidenceEntry {
  dimension: string;
  result: string;
  reason: string;
  source: string | null;
  method: string | null;
  status: string | null;
  confidence: string | null;
  url: string | null;
  excerpt: string | null;
}

export interface RequirementEvidenceLine {
  dimension: string;
  /** "Funding · provider record (apify_funding_atomus) · medium confidence" */
  headline: string;
  /** What the check said, in its own words. */
  detail: string;
  url: string | null;
  source: string | null;
  /** verified | provider_record | missing | failed */
  standing: "verified" | "provider_record" | "missing" | "failed";
  confidence: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The persisted entries on one lead row's raw JSON, well-formed ones only. */
export function requirementEvidenceOf(raw: unknown): RequirementEvidenceEntry[] {
  const decision = isObj(raw) && isObj(raw.canonical_decision) ? raw.canonical_decision : null;
  const list = decision && Array.isArray(decision.hard_evidence) ? decision.hard_evidence : [];
  return list.filter(isObj).filter((e) => str(e.dimension) && str(e.result)).map((e) => ({
    dimension: String(e.dimension), result: String(e.result), reason: str(e.reason) ?? "",
    source: str(e.source), method: str(e.method), status: str(e.status), confidence: str(e.confidence),
    url: str(e.url), excerpt: str(e.excerpt),
  }));
}

const LABEL: Record<string, string> = {
  geography: "Location", hiring: "Hiring", funding: "Funding", company_size: "Company size",
  industry: "Industry", business_model: "Business model", company_stage: "Funding stage",
};

/** One readable line per requirement. */
export function requirementEvidenceLines(raw: unknown): RequirementEvidenceLine[] {
  return requirementEvidenceOf(raw).map((e) => {
    const standing: RequirementEvidenceLine["standing"] = e.result === "fail" ? "failed"
      : e.result !== "pass" || !e.source ? "missing"
      // A provider's own field is that provider's claim. Only a deterministic
      // rule over cited evidence or a grounded read counts as verified here.
      : e.method === "provider_field" ? "provider_record"
      : "verified";
    const what = standing === "provider_record" ? `provider record (${e.source})`
      : standing === "verified" ? `verified (${e.source})`
      : standing === "failed" ? "not met"
      : "evidence missing";
    const parts = [LABEL[e.dimension] ?? e.dimension, what];
    if (e.confidence && standing !== "missing") parts.push(`${e.confidence} confidence`);
    return {
      dimension: e.dimension, headline: parts.join(" · "), detail: e.excerpt ?? e.reason,
      url: e.url, source: e.source, standing, confidence: e.confidence,
    };
  });
}
