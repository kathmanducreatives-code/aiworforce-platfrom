// Source-role separation for Company Brain research.
//
// WHY THIS EXISTS
//   Company Brain Refresh scrapes a website and extracts SELLER identity +
//   positioning from it. In production a competitor URL (gojiberry.ai) was
//   ingested through the same `company_website` path as the real seller website,
//   so the competitor's name and positioning became the seller's.
//
//   A URL now carries an explicit ROLE. Only a `seller` URL may populate seller
//   identity or positioning. A competitor/reference/example/unknown URL may still
//   inform competitive research, but its content is stripped out of any patch
//   before it can reach a seller field.
//
// Pure — no DB, no network, no model.

import {
  normalizeDomain,
  type CanonicalSellerIdentity,
} from "./workbench/sellerIdentity.ts";

export type SourceRole = "seller" | "competitor" | "reference" | "example" | "unknown";

export function isValidSourceRole(v: unknown): v is SourceRole {
  return v === "seller" || v === "competitor" || v === "reference" || v === "example" || v === "unknown";
}

/**
 * The Brain field paths that describe the SELLER. A non-seller source may never
 * write any of these. Nested (`company.*`) and legacy flat paths are both listed
 * because a contaminated draft can arrive in either shape.
 */
export const SELLER_IDENTITY_FIELD_PATHS: readonly string[] = [
  // identity
  "company.name", "company_name",
  "company.website_url", "website_url",
  "company.linkedin_url", "linkedin_company_url", "linkedin_url",
  "company.category",
  // summary / description
  "company.description", "company_summary", "short_description", "what_we_do",
  // positioning / offer
  "positioning", "positioning.offer", "positioning.promise", "positioning.use_cases",
  "positioning.differentiators", "offer_summary", "product_summary", "product",
  "differentiators", "proof", "proof_points", "target_outcomes", "outcomes",
  // brand voice
  "brand_voice", "voice", "tone", "outreach_style",
  // approved seller claims / ctas / content
  "approved_ctas", "ctas", "content_angles",
  // seller-owned ICP
  "icp",
];

/** Top-level keys that are entirely seller-owned (strip wholesale from a patch). */
const SELLER_TOPLEVEL_KEYS = new Set<string>([
  "company", "company_name", "website_url", "linkedin_company_url", "linkedin_url",
  "company_summary", "short_description", "what_we_do",
  "positioning", "offer_summary", "product_summary", "product",
  "differentiators", "proof", "proof_points", "target_outcomes", "outcomes",
  "brand_voice", "voice", "tone", "outreach_style",
  "approved_ctas", "ctas", "content_angles", "icp",
]);

export interface ClassifyWebsiteInput {
  /** The URL that produced this research/draft. */
  submittedUrl: string | null | undefined;
  /** The current canonical seller identity for the workspace (may be empty). */
  canonicalIdentity: CanonicalSellerIdentity;
  /**
   * True only when the authenticated user explicitly submitted/confirmed this URL
   * as THEIR company website (not a competitor field, not a research target).
   */
  userConfirmedAsSeller?: boolean;
}

export interface SourceRoleDecision {
  role: SourceRole;
  reason: string;
  /** The normalized domain that was classified. */
  domain: string | null;
}

/**
 * Decide whether a scraped website may act as the SELLER source.
 *
 * `seller` requires BOTH: the user confirmed it is their company website, AND the
 * domain is consistent with the current canonical seller identity (or there is no
 * canonical identity yet). A domain that contradicts a populated canonical
 * identity is never seller — it is `unknown` and its content is stripped. An
 * unknown role never silently becomes seller.
 */
export function classifyWebsiteSourceRole(input: ClassifyWebsiteInput): SourceRoleDecision {
  const domain = normalizeDomain(input.submittedUrl);
  const canonicalDomain = input.canonicalIdentity.domain;

  if (!domain) return { role: "unknown", reason: "no_domain", domain: null };

  // A domain that contradicts a populated canonical identity can never be the
  // seller — this is exactly the competitor-URL case.
  if (canonicalDomain && domain !== canonicalDomain) {
    return { role: "unknown", reason: "domain_conflicts_canonical_identity", domain };
  }

  if (!input.userConfirmedAsSeller) {
    // Consistent (or no canonical yet) but unconfirmed → still not authoritative
    // for seller identity. It may inform research; it may not name the seller.
    return { role: "unknown", reason: "not_user_confirmed_as_seller", domain };
  }

  return { role: "seller", reason: canonicalDomain ? "confirmed_and_consistent" : "confirmed_first_identity", domain };
}

/**
 * Remove every seller-owned field from a Brain patch when the source is not the
 * seller. Competitive/reference research keeps only its non-seller content.
 * Returns the safe patch plus the paths that were stripped, for observability.
 */
export function stripNonSellerIdentityFields(
  patch: Record<string, unknown>,
  role: SourceRole,
): { safePatch: Record<string, unknown>; stripped: string[] } {
  if (role === "seller") return { safePatch: patch, stripped: [] };

  const safePatch: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (SELLER_TOPLEVEL_KEYS.has(k)) {
      stripped.push(k);
      continue;
    }
    safePatch[k] = v;
  }
  return { safePatch, stripped };
}
