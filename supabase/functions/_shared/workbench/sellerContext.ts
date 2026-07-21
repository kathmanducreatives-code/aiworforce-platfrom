// The SELLER half of an outreach message — who is writing, what they offer, and
// what they are allowed to claim.
//
// WHY THIS IS SEPARATE FROM THE PROSPECT
//   The opener prompt used to carry one seller line ("Outcome we deliver: …")
//   next to a rich prospect description ("What the company does: …"). The
//   prospect text was by far the strongest signal in the prompt, so the model
//   routinely described the SELLER using the PROSPECT's business — producing
//   openers that sounded like a different company entirely.
//
//   Seller facts and prospect facts are now built separately, by different
//   functions, from different sources, and are labelled as different companies
//   in the prompt.
//
// MULTI-TENANCY
//   Nothing here knows what the seller sells. Every noun in the output comes
//   from that workspace's own Company Brain. There is no default industry, no
//   default product category, and no fallback positioning — if the Brain cannot
//   support a claim, the claim is not made and the opener is blocked instead.

import { resolveCanonicalSellerIdentity } from "./sellerIdentity.ts";

// ------------------------------------------------------------------- types ----

export interface SellerOffer {
  primary_offer: string | null;
  promise: string | null;
  supported_outcomes: string[];
  use_cases: string[];
  differentiators: string[];
  proof_points: string[];
}

export interface SellerTargetCustomer {
  profile: string | null;
  industries: string[];
  company_sizes: string[];
  geographies: string[];
  buyer_roles: string[];
  pains: string[];
}

export interface SellerBrandVoice {
  tone: string[];
  avoided_language: string[];
}

export interface SellerContext {
  seller_company_name: string | null;
  seller_summary: string | null;
  offer: SellerOffer;
  target_customer: SellerTargetCustomer;
  brand_voice: SellerBrandVoice;
  prohibited_claims: string[];
  /**
   * CTAs this workspace has explicitly approved. Empty for most Brains, which
   * is why the CTA plan can also derive a conservative ask from an approved
   * offer rather than inventing one.
   */
  approved_ctas: string[];
  /** Which Brain fields actually produced content — for observability only. */
  source_fields: string[];
  /** False when the Brain cannot support any seller positioning at all. */
  usable: boolean;
}

/**
 * A single thing the seller is ALLOWED to say about itself. The model may only
 * position the seller using these, and must report which it used — so an
 * invented product category is detectable rather than plausible-sounding.
 */
export interface SellerClaim {
  id: string;
  type: "offer" | "promise" | "outcome" | "use_case" | "differentiator" | "proof";
  text: string;
  /**
   * Provenance — which Brain field this approved claim came from, and whether it
   * is seller-owned vs competitor/reference research. Lets a generation record
   * prove no competitor-sourced text entered the approved claim catalog.
   */
  field_path?: string;
  source?: "company_brain";
  source_role?: SellerSourceRole;
  confirmation_state?: SellerConfirmationState;
}

/** Whether a piece of Brain content describes the SELLER or is external research. */
export type SellerSourceRole = "seller" | "competitor" | "reference" | "example" | "unknown";

/** Confirmation state of a Brain field (no per-field metadata stored yet → unconfirmed). */
export type SellerConfirmationState = "confirmed" | "manual" | "extracted" | "unconfirmed";

// -------------------------------------------------------------- primitives ----

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * String arrays, ignoring the char-indexed keys ("0", "1", …) that a historical
 * object-spread of a string left behind in some stored Brains. Reassembling
 * those would produce garbage prose, so they are dropped, never repaired.
 */
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
  }
  return [];
}

/** Named keys only — the same char-index noise is ignored on objects. */
function namedOnly(v: unknown): Record<string, unknown> {
  if (!isObj(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (/^\d+$/.test(k)) continue;
    out[k] = val;
  }
  return out;
}

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

function firstArr(...vals: unknown[]): string[] {
  for (const v of vals) {
    const a = strArray(v);
    if (a.length > 0) return a;
  }
  return [];
}

function dedupe(vals: string[]): string[] {
  return [...new Set(vals.map((v) => v.trim()).filter(Boolean))];
}

// ----------------------------------------------------------------- builder ----

/**
 * Normalize a workspace Company Brain into seller messaging context.
 *
 * Supports both the flat legacy shape and the nested shape onboarding writes.
 * Explicit current fields win over vaguer summaries.
 */
export function buildSellerContext(profile: unknown): SellerContext {
  const p = namedOnly(profile);
  const pos = namedOnly(p.positioning);
  const voice = namedOnly(p.brand_voice);
  const target = namedOnly(p.target_customer);
  const source_fields: string[] = [];
  const note = (field: string, value: unknown) => {
    const has = typeof value === "string" ? !!value.trim() : Array.isArray(value) ? value.length > 0 : false;
    if (has) source_fields.push(field);
    return value;
  };

  // Canonical precedence: the nested `company.name` the editor writes and the UI
  // displays OUTRANKS the flat legacy `company_name`. In production the flat field
  // was contaminated with a competitor's name ("goji") by a website research run,
  // so flat-first resolution named the seller after the competitor. All seller
  // name precedence lives in ONE place now — sellerIdentity.ts.
  const seller_company_name = resolveCanonicalSellerIdentity({ profile }).companyName;

  const seller_summary = firstStr(p.company_summary, p.short_description, p.offer_summary);

  // The offer: what this seller actually provides. `positioning` is an object in
  // the nested shape and a plain string in the flat one — both are read.
  const primary_offer = firstStr(p.offer_summary, pos.offer, p.product_summary, p.product, p.short_description);
  const promise = firstStr(pos.promise, p.positioning, p.value_proposition);

  const supported_outcomes = firstArr(p.target_outcomes, p.outcomes, pos.use_cases);
  const use_cases = firstArr(pos.use_cases, p.use_cases);
  const differentiators = firstArr(p.differentiators, pos.differentiators);
  const proof_points = firstArr(p.proof, p.proof_points, pos.proof_points);

  note("company_name", seller_company_name);
  note("seller_summary", seller_summary);
  note("primary_offer", primary_offer);
  note("promise", promise);
  note("supported_outcomes", supported_outcomes);
  note("differentiators", differentiators);
  note("proof_points", proof_points);

  const offer: SellerOffer = {
    primary_offer,
    promise,
    supported_outcomes,
    use_cases,
    differentiators,
    proof_points,
  };

  const target_customer: SellerTargetCustomer = {
    profile: firstStr(p.target_customer_profile, target.profile),
    industries: firstArr(target.industries, p.industries),
    company_sizes: firstArr(target.company_size, target.company_sizes),
    geographies: firstArr(target.geography, target.geographies),
    buyer_roles: firstArr(p.buyer_roles, p.buyer_personas, target.buyer_roles),
    pains: firstArr(p.pain_points, target.pains),
  };

  const brand_voice: SellerBrandVoice = {
    tone: dedupe([...strArray(voice.tags), ...(str(voice.tone) ? [str(voice.tone)!] : []),
      ...(str(p.tone) ? [str(p.tone)!] : []), ...(str(p.outreach_style) ? [str(p.outreach_style)!] : [])]),
    avoided_language: dedupe([...strArray(voice.avoid), ...strArray(p.avoided_language)]),
  };

  // UNION of every prohibition source. Dropping one because another list was
  // non-empty would let a forbidden claim through.
  const prohibited_claims = dedupe([
    ...strArray(p.prohibited_claims),
    ...strArray(pos.avoid_positioning),
    ...strArray(voice.avoid),
    ...strArray(p.negative_examples),
  ]);

  // Usable means: we can say SOMETHING true about what this seller does. Without
  // that the model would have to invent a product category.
  const usable = !!(primary_offer || promise || supported_outcomes.length > 0);

  return {
    seller_company_name,
    seller_summary,
    offer,
    target_customer,
    brand_voice,
    prohibited_claims,
    approved_ctas: firstArr(p.approved_ctas, p.ctas, p.preferred_cta),
    source_fields: dedupe(source_fields),
    usable,
  };
}

// ------------------------------------------------------------ claim allowlist --

const MAX_CLAIMS_PER_TYPE = 2;

/**
 * The closed set of seller statements the model may draw on.
 *
 * Bounded deliberately: a long list invites the model to blend several claims
 * into a sentence that no single Brain field supports.
 */
/** Representative canonical Brain path for each claim type — for provenance. */
const CLAIM_FIELD_PATH: Record<SellerClaim["type"], string> = {
  offer: "positioning.offer",
  promise: "positioning.promise",
  outcome: "target_outcomes",
  use_case: "positioning.use_cases",
  differentiator: "differentiators",
  proof: "proof_points",
};

export function buildSellerClaims(seller: SellerContext): SellerClaim[] {
  const claims: SellerClaim[] = [];
  let n = 0;
  const push = (type: SellerClaim["type"], text: string | null) => {
    const t = str(text);
    if (!t) return;
    if (claims.some((c) => c.text.toLowerCase() === t.toLowerCase())) return;
    n += 1;
    // Approved claims come from THIS workspace's own Brain positioning, so the
    // role is `seller`. A competitor/reference URL cannot reach here — its
    // content is kept out of the seller positioning fields (see
    // companyBrainSourceRole.ts). Confirmation metadata is not stored per-field
    // yet, so claims are `unconfirmed` until a confirm action records it.
    claims.push({
      id: `seller_claim_${n}`,
      type,
      text: t,
      field_path: CLAIM_FIELD_PATH[type],
      source: "company_brain",
      source_role: "seller",
      confirmation_state: "unconfirmed",
    });
  };

  push("offer", seller.offer.primary_offer);
  push("promise", seller.offer.promise);
  for (const o of seller.offer.supported_outcomes.slice(0, MAX_CLAIMS_PER_TYPE)) push("outcome", o);
  for (const u of seller.offer.use_cases.slice(0, MAX_CLAIMS_PER_TYPE)) push("use_case", u);
  for (const d of seller.offer.differentiators.slice(0, MAX_CLAIMS_PER_TYPE)) push("differentiator", d);
  for (const pr of seller.offer.proof_points.slice(0, MAX_CLAIMS_PER_TYPE)) push("proof", pr);

  return claims;
}

// ------------------------------------------------- Brain self-contradiction ---

export interface BrainContradiction {
  claim_id: string;
  /** The prohibition the approved claim collides with. */
  prohibited: string;
  /** The overlapping terms, for a sanitized diagnostic. */
  overlap: string[];
}

/** Words too common to signal a real collision. */
const STOPWORDS = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while",
  "would", "could", "should", "using", "with", "from", "that", "this", "into",
  "your", "teams", "team", "help", "helps", "make", "more", "than", "then",
]);

function significantTerms(s: string): string[] {
  return s.toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w));
}

/**
 * Approved seller claims that collide with this same Brain's own prohibitions.
 *
 * PROVEN IN PRODUCTION (2026-07-21): a workspace Brain listed talent-discovery
 * vocabulary in BOTH `positioning.use_cases` (approved, and therefore fed to the
 * model as a usable claim) and `positioning.avoid_positioning` (forbidden). The
 * generator silently used the approved side and produced positioning the same
 * Brain forbids.
 *
 * Picking a side would be guessing at what the tenant meant. The caller should
 * block and ask the user to resolve it — the Brain is the authority, and right
 * now it says two opposite things.
 */
export function detectBrainContradictions(
  seller: SellerContext,
  claims: SellerClaim[],
): BrainContradiction[] {
  const out: BrainContradiction[] = [];
  if (seller.prohibited_claims.length === 0) return out;

  for (const claim of claims) {
    const claimTerms = new Set(significantTerms(claim.text));
    if (claimTerms.size === 0) continue;

    for (const prohibited of seller.prohibited_claims) {
      const overlap = significantTerms(prohibited).filter((t) => claimTerms.has(t));
      // Two or more shared significant terms is a real collision, not a
      // coincidental word.
      if (overlap.length >= 2) {
        out.push({ claim_id: claim.id, prohibited, overlap: [...new Set(overlap)] });
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- saved ICP ------

export interface IcpContext {
  target_industries: string[];
  target_company_sizes: string[];
  target_geographies: string[];
  buyer_roles: string[];
  pains: string[];
  desired_outcomes: string[];
  disqualifiers: string[];
  messaging_angles: string[];
}

/**
 * Normalize the saved ICP.
 *
 * Used to CHOOSE which seller outcome is most relevant — never to assert a fact
 * about the prospect, and never surfaced verbatim in the message. Internal
 * vocabulary ("ICP", "fit score", "buyer roles") must not reach the model as
 * language it might echo.
 */
export function buildIcpContext(savedIcp: unknown): IcpContext {
  const i = namedOnly(savedIcp);
  const target = namedOnly(i.target_customer);
  return {
    target_industries: firstArr(i.industries, target.industries),
    target_company_sizes: firstArr(i.company_sizes, i.company_size, target.company_size),
    target_geographies: firstArr(i.geographies, i.geography, target.geography),
    buyer_roles: firstArr(i.buyer_roles, target.buyer_roles),
    pains: firstArr(i.pains, i.pain_points),
    desired_outcomes: firstArr(i.desired_outcomes, i.outcomes),
    disqualifiers: firstArr(i.disqualifiers, target.disqualifiers),
    messaging_angles: firstArr(i.messaging_angles, i.content_angles),
  };
}

/**
 * Pick the seller outcome most relevant to this prospect.
 *
 * Deterministic: prefer a supported outcome whose wording overlaps an ICP pain
 * or desired outcome, else the first supported outcome. No model involved.
 */
export function selectSellerOutcome(seller: SellerContext, icp: IcpContext): string | null {
  const outcomes = seller.offer.supported_outcomes;
  if (outcomes.length === 0) return seller.offer.promise ?? seller.offer.primary_offer;

  const signals = [...icp.pains, ...icp.desired_outcomes].map((s) => s.toLowerCase());
  if (signals.length > 0) {
    for (const o of outcomes) {
      const lower = o.toLowerCase();
      const words = lower.split(/\W+/).filter((w) => w.length > 4);
      if (words.some((w) => signals.some((s) => s.includes(w)))) return o;
    }
  }
  return outcomes[0];
}
