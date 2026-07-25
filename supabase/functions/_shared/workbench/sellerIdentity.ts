// THE one canonical seller-identity resolver.
//
// WHY THIS EXISTS
//   A production Company Brain (workspace e510c1a6-…6ed995) carried TWO identity
//   paths that disagreed:
//
//       profile.company_name  = "goji"      (legacy flat, contaminated by a
//                                             competitor website research run)
//       profile.company.name  = "Agentory"  (current nested, what the editor
//                                             writes and the UI displays)
//
//   `sellerContext.ts` resolved the seller name flat-first, so generation named
//   the seller "goji" while the Company Brain page showed "Agentory". The editor
//   and the generator were reading DIFFERENT fields.
//
//   Every feature that needs "who is the seller" must go through THIS module so
//   there is exactly one precedence and one conflict definition. Do not re-derive
//   seller name / website / domain anywhere else.
//
// PRECEDENCE (name, website, domain, linkedin)
//   1. explicitly CONFIRMED nested Company Brain identity
//   2. current nested Company Brain identity          (profile.company.*)
//   3. verified workspace/company profile identity     (passed in, optional)
//   4. legacy flat identity ONLY when no canonical nested value exists
//   5. otherwise unavailable
//
//   The legacy flat field can NEVER override a populated canonical nested field.
//   When the two materially disagree the identity is a CONFLICT: the canonical
//   nested value is reported, but callers must BLOCK rather than trust it.
//
// Pure — no DB, no network, no model. Fully unit-testable.

// ------------------------------------------------------------------- types ----

export type SellerIdentitySource =
  | "confirmed_nested"
  | "nested"
  | "workspace_profile"
  | "legacy_flat"
  | "unavailable";

export type SellerIdentityStatus = "confirmed" | "resolved" | "conflict" | "unavailable";

export type SellerIdentityField = "company_name" | "website_domain" | "linkedin_url";

/**
 * A material disagreement between the canonical nested identity and another
 * source. Sanitized: normalized values + the JSON paths the operator needs to
 * find them. No prompt text, no full Brain.
 */
export interface SellerIdentityConflict {
  field: SellerIdentityField;
  /** JSON paths whose values disagree, e.g. ["company.name", "company_name"]. */
  paths: string[];
  /** Normalized (lowercased/trimmed) disagreeing values, for the diagnostic. */
  values: string[];
}

export interface CanonicalSellerIdentity {
  companyName: string | null;
  websiteUrl: string | null;
  domain: string | null;
  linkedinUrl: string | null;
  category: string | null;
  identitySource: SellerIdentitySource;
  identityStatus: SellerIdentityStatus;
  conflicts: SellerIdentityConflict[];
  companyBrainId: string | null;
  companyBrainUpdatedAt: string | null;
  /** Deterministic, non-secret fingerprint of the resolved identity + version. */
  identityHash: string;
}

/** Optional verified workspace/company profile identity (precedence rank 3). */
export interface WorkspaceProfileIdentity {
  companyName?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
}

export interface ResolveSellerIdentityInput {
  profile: unknown;
  workspaceProfile?: WorkspaceProfileIdentity | null;
  companyBrainId?: string | null;
  companyBrainUpdatedAt?: string | null;
}

// -------------------------------------------------------------- primitives ----

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Named keys only — ignore the char-index noise a historical string-spread left. */
function namedOnly(v: unknown): Record<string, unknown> {
  if (!isObj(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^\d+$/.test(k)) continue;
    out[k] = val;
  }
  return out;
}

/** Compare two names for a MATERIAL difference (case/whitespace/punct-insensitive). */
export function normalizeIdentityName(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || null;
}

/** hostname only: strip scheme, `www.`, path, query, trailing dot, lowercase. */
export function normalizeDomain(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  let host = s.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  host = host.replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0].split("#")[0];
  host = host.replace(/\.$/, "").replace(/:\d+$/, "");
  return host || null;
}

/** Deterministic non-cryptographic fingerprint (FNV-1a, 32-bit hex). */
export function identityFingerprint(parts: Array<string | null | undefined>): string {
  const input = parts.map((p) => (p ?? "")).join("");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ----------------------------------------------------------------- resolver ----

/**
 * Resolve the canonical seller identity for a workspace Company Brain.
 *
 * A field's value is taken from the highest-precedence source that has it. A
 * lower-precedence source that DISAGREES with the chosen value produces a
 * conflict but never replaces it — so a stale legacy "goji" can never win over a
 * nested "Agentory".
 */
export function resolveCanonicalSellerIdentity(
  input: ResolveSellerIdentityInput,
): CanonicalSellerIdentity {
  const p = namedOnly(input.profile);
  const nested = namedOnly(p.company);
  const wp = input.workspaceProfile ?? null;

  // A confirmation flag, if the Brain records one. No such column exists today;
  // this reads an OPTIONAL in-JSON marker so a future "confirm identity" action
  // needs no resolver change. Absent → treated as unconfirmed nested.
  const confirmed =
    nested.name_confirmed === true ||
    namedOnly(p.identity_provenance).company_name_confirmed === true;

  // ---- company name -----------------------------------------------------------
  const nestedName = str(nested.name);
  const profileName = str(wp?.companyName);
  const flatName = str(p.company_name);

  let companyName: string | null;
  let identitySource: SellerIdentitySource;
  if (nestedName) {
    companyName = nestedName;
    identitySource = confirmed ? "confirmed_nested" : "nested";
  } else if (profileName) {
    companyName = profileName;
    identitySource = "workspace_profile";
  } else if (flatName) {
    companyName = flatName;
    identitySource = "legacy_flat";
  } else {
    companyName = null;
    identitySource = "unavailable";
  }

  // ---- website / domain -------------------------------------------------------
  const nestedSite = str(nested.website_url);
  const profileSite = str(wp?.websiteUrl);
  const flatSite = str(p.website_url);
  const websiteUrl = nestedSite ?? profileSite ?? flatSite ?? null;
  const domain = normalizeDomain(websiteUrl);

  // ---- linkedin ---------------------------------------------------------------
  const nestedLinkedin = str(nested.linkedin_url);
  const profileLinkedin = str(wp?.linkedinUrl);
  const flatLinkedin = str(p.linkedin_company_url) ?? str(p.linkedin_url);
  const linkedinUrl = nestedLinkedin ?? profileLinkedin ?? flatLinkedin ?? null;

  const category = str(nested.category) ?? str(p.category) ?? null;

  // ---- conflicts --------------------------------------------------------------
  // A conflict is a MATERIAL disagreement between the CANONICAL value and a
  // populated lower-precedence source. Only compared when a canonical nested (or
  // workspace-profile) value exists; a flat value merely FILLING an empty
  // canonical field is not a conflict.
  const conflicts: SellerIdentityConflict[] = [];

  const canonicalNameNorm = normalizeIdentityName(nestedName ?? profileName);
  const flatNameNorm = normalizeIdentityName(flatName);
  if (canonicalNameNorm && flatNameNorm && canonicalNameNorm !== flatNameNorm) {
    conflicts.push({
      field: "company_name",
      paths: [nestedName ? "company.name" : "workspace_profile.company_name", "company_name"],
      values: [canonicalNameNorm, flatNameNorm],
    });
  }

  const canonicalDomainNorm = normalizeDomain(nestedSite ?? profileSite);
  const flatDomainNorm = normalizeDomain(flatSite);
  if (canonicalDomainNorm && flatDomainNorm && canonicalDomainNorm !== flatDomainNorm) {
    conflicts.push({
      field: "website_domain",
      paths: [nestedSite ? "company.website_url" : "workspace_profile.website_url", "website_url"],
      values: [canonicalDomainNorm, flatDomainNorm],
    });
  }

  const canonicalLinkedinNorm = normalizeDomain(nestedLinkedin ?? profileLinkedin);
  const flatLinkedinNorm = normalizeDomain(flatLinkedin);
  if (canonicalLinkedinNorm && flatLinkedinNorm && canonicalLinkedinNorm !== flatLinkedinNorm) {
    conflicts.push({
      field: "linkedin_url",
      paths: [nestedLinkedin ? "company.linkedin_url" : "workspace_profile.linkedin_url", "linkedin_company_url"],
      values: [canonicalLinkedinNorm, flatLinkedinNorm],
    });
  }

  // ---- status -----------------------------------------------------------------
  let identityStatus: SellerIdentityStatus;
  if (identitySource === "unavailable") identityStatus = "unavailable";
  else if (conflicts.length > 0) identityStatus = "conflict";
  else if (identitySource === "confirmed_nested") identityStatus = "confirmed";
  else identityStatus = "resolved";

  const identityHash = identityFingerprint([
    normalizeIdentityName(companyName),
    domain,
    normalizeDomain(linkedinUrl),
    input.companyBrainUpdatedAt ?? null,
  ]);

  return {
    companyName,
    websiteUrl,
    domain,
    linkedinUrl,
    category,
    identitySource,
    identityStatus,
    conflicts,
    companyBrainId: input.companyBrainId ?? null,
    companyBrainUpdatedAt: input.companyBrainUpdatedAt ?? null,
    identityHash,
  };
}

// --------------------------------------------------------- conflict block ------

/**
 * Sanitized diagnostics persisted when generation is blocked on a seller-identity
 * conflict. Identifiers + normalized values only — never the raw Brain.
 */
export interface SellerIdentityConflictDiagnostics {
  conflicting_fields: SellerIdentityField[];
  conflicting_paths: string[];
  normalized_values: string[];
  identity_source: SellerIdentitySource;
  company_brain_id: string | null;
  company_brain_updated_at: string | null;
  identity_hash: string;
}

/** True when the identity cannot be trusted for generation. */
export function isSellerIdentityBlocked(identity: CanonicalSellerIdentity): boolean {
  return identity.identityStatus === "conflict";
}

export function sellerIdentityConflictDiagnostics(
  identity: CanonicalSellerIdentity,
): SellerIdentityConflictDiagnostics {
  return {
    conflicting_fields: identity.conflicts.map((c) => c.field),
    conflicting_paths: [...new Set(identity.conflicts.flatMap((c) => c.paths))],
    normalized_values: [...new Set(identity.conflicts.flatMap((c) => c.values))],
    identity_source: identity.identitySource,
    company_brain_id: identity.companyBrainId,
    company_brain_updated_at: identity.companyBrainUpdatedAt,
    identity_hash: identity.identityHash,
  };
}

/** Safe, user-facing copy for a blocked seller-identity conflict. */
export const SELLER_IDENTITY_CONFLICT_MESSAGE =
  "Company Brain contains conflicting seller identity information. Review the company name and website before generating outreach.";
