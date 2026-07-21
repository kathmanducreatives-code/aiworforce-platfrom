// Company Brain seller-identity state for the UI.
//
// MIRRORS the backend precedence in
//   supabase/functions/_shared/workbench/sellerIdentity.ts
// so the page can WARN when the seller name/website the generator will use
// disagrees with a hidden legacy flat field. Keep the two in sync — the same
// rule (nested `company.*` outranks flat `company_name`) decides both.
//
// Pure — no network, no Supabase. Safe to unit-test.

export type SellerIdentityUiStatus =
  | "confirmed"
  | "resolved"
  | "conflict"
  | "legacy_detected"
  | "unavailable";

export interface SellerIdentityFieldConflict {
  field: "company_name" | "website_domain" | "linkedin_url";
  canonical: string;
  legacy: string;
}

export interface SellerIdentityUiState {
  status: SellerIdentityUiStatus;
  /** The canonical name the generator will use (nested wins). Never the legacy one. */
  companyName: string | null;
  websiteDomain: string | null;
  /** Material disagreements between canonical and legacy fields. */
  conflicts: SellerIdentityFieldConflict[];
  /** True when a legacy flat field is present at all (even if not conflicting). */
  legacyFieldsPresent: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d+$/.test(k)) continue; // drop char-index noise
    out[k] = val;
  }
  return out;
}

function normName(v: unknown): string | null {
  const s = str(v);
  return s ? (s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null) : null;
}

function normDomain(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let host = s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0].split("#")[0].replace(/\.$/, "").replace(/:\d+$/, "");
  return host || null;
}

/**
 * Derive the seller-identity state the Company Brain page shows.
 *
 *   conflict         → nested and flat disagree; generation is BLOCKED backend-side
 *   legacy_detected  → a legacy flat field exists but does not conflict
 *   confirmed        → nested identity explicitly confirmed
 *   resolved         → nested identity present, no legacy conflict
 *   unavailable      → no identity at all
 */
export function deriveSellerIdentityState(profile: unknown): SellerIdentityUiState {
  const p = obj(profile);
  const nested = obj(p.company);

  const nestedName = str(nested.name);
  const flatName = str(p.company_name);
  const nestedSite = str(nested.website_url);
  const flatSite = str(p.website_url);
  const nestedLinkedin = str(nested.linkedin_url);
  const flatLinkedin = str(p.linkedin_company_url) ?? str(p.linkedin_url);

  const conflicts: SellerIdentityFieldConflict[] = [];

  const cName = normName(nestedName);
  const fName = normName(flatName);
  if (cName && fName && cName !== fName) {
    conflicts.push({ field: "company_name", canonical: cName, legacy: fName });
  }
  const cDomain = normDomain(nestedSite);
  const fDomain = normDomain(flatSite);
  if (cDomain && fDomain && cDomain !== fDomain) {
    conflicts.push({ field: "website_domain", canonical: cDomain, legacy: fDomain });
  }
  const cLink = normDomain(nestedLinkedin);
  const fLink = normDomain(flatLinkedin);
  if (cLink && fLink && cLink !== fLink) {
    conflicts.push({ field: "linkedin_url", canonical: cLink, legacy: fLink });
  }

  const legacyFieldsPresent = !!(flatName || flatSite || flatLinkedin);
  const confirmed = nested.name_confirmed === true;

  let status: SellerIdentityUiStatus;
  if (!nestedName && !flatName) status = "unavailable";
  else if (conflicts.length > 0) status = "conflict";
  else if (confirmed) status = "confirmed";
  else if (legacyFieldsPresent && !nestedName) status = "legacy_detected";
  else status = "resolved";

  return {
    status,
    companyName: nestedName ?? flatName ?? null,
    websiteDomain: cDomain ?? fDomain ?? null,
    conflicts,
    legacyFieldsPresent,
  };
}

/** Short, safe banner copy for each state (no raw Brain, no secrets). */
export function sellerIdentityBanner(state: SellerIdentityUiState): { tone: "error" | "warning" | "info" | "ok"; message: string } | null {
  switch (state.status) {
    case "conflict":
      return {
        tone: "error",
        message: "Company Brain contains conflicting seller identity information. Review the company name and website before generating outreach.",
      };
    case "legacy_detected":
      return { tone: "warning", message: "Legacy company data was detected. Confirm your company identity so outreach uses the right details." };
    case "unavailable":
      return { tone: "info", message: "Add your company identity so outreach can name the right seller." };
    default:
      return null;
  }
}
