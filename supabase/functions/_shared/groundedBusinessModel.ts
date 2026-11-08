// THE BUSINESS MODEL FROM THE COMPANY'S OWN WORDS — one evidence item, shared by every engine.
//
// Moved verbatim out of leadCapabilityEngine.ts (which re-exports it) so the lead pipeline
// (MRLE) uses the SAME decision as the production engine instead of a second verification
// system: groundedClaims checks every quote against the fetched pages, businessModelDecision
// judges the claim, and evidenceAuthority weighs it (accepted → proven; review → plausible).
// Pure.

import { businessModelDecision, type GroundedVerification } from "./groundedClaims.ts";
import type { EvidenceRegistry } from "./leadEvidenceRegistry.ts";
import { valueWithStatedAudience } from "./businessModelMatch.ts";
import { authorityForEvidence, authorityRecord, statusForAuthority } from "./evidenceAuthority.ts";
import type { EvidenceItem } from "./candidateObservation.ts";

/** What the item is built from: any company with a grounding and the registry it was read on. */
export interface GroundedCompany {
  key: string;
  grounded?: GroundedVerification | null;
  evidence_registry?: Pick<EvidenceRegistry, "items"> | null;
}

/**
 * The business model, when the company's own words established it.
 *
 * The registry holds the description, the YC record and any fetched page as
 * HARD FACTS; `groundedClaims` then checks every excerpt against that text and
 * drops what it cannot find. What survives is the company's own statement,
 * quoted and verified — admitted at `model_extraction`, which `compareEvidence`
 * ranks below any provider field that disagrees.
 *
 * ── THE BUSINESS MODEL'S OWN DECISION DECIDES (P5.2) ────────────────────────
 *
 * `businessModelDecision` judges the business-model CLAIM on its own evidence;
 * the grounder's whole-company verdict (`final_grounded_decision`) is recorded
 * beside it and never used as proof. Canary c584fd77 showed why: a request
 * with unprovable targets makes that verdict `review` for nearly everyone.
 *
 *   accepted  the reading is PROVEN and may pass — or, through the controlled
 *             vocabulary, fail — a hard rule (verified "consumer" rules out B2B)
 *   review    the reading is PLAUSIBLE — shown, ranked, never proof, so the
 *             hard rule stays pending
 *
 * Both decisions travel on the item (`assessment`) into eligibility.
 *
 * Null when no business-model claim survived, or when the grounder itself said
 * the model is unknown — the honest answer for a company whose description does
 * not say what it sells.
 */
export function groundedBusinessModelItem(
  c: GroundedCompany, missionId: string | null, at: string,
): EvidenceItem | null {
  const g = c.grounded;
  const bm = g?.classifier_result?.business_model;
  const claims = (g?.validated_claims ?? []).filter((x) => x.claim_type === "business_model");
  if (!g || !bm || bm.value === "unknown" || claims.length === 0) return null;
  const decision = g.final_grounded_decision;
  const bmDecision = businessModelDecision(g);
  const accepted = bmDecision.decision === "accepted";
  const excerpt = claims.flatMap((x) => x.evidence_excerpts).map((x) => x.excerpt).find(Boolean) ?? null;
  // The page the quote was read from, when the cited evidence has one — so a
  // hard check can link to its source instead of saying "grounded evaluation".
  const cited = new Set(claims.flatMap((x) => x.evidence_ids));
  const url = (c.evidence_registry?.items ?? []).find((it) => cited.has(it.evidence_id) && !!it.source_url)?.source_url ?? null;
  // The weight is the authority layer's: an ACCEPTED website statement proves
  // (or, by contradiction, disproves) a business-model rule; a `review` does not.
  const authority = authorityForEvidence({
    claim: "business_model", source: "grounded_evidence_evaluation", field: "grounded_statement",
    observed_at: at, quality: { grounding: accepted ? "accepted" : "review" },
  });
  return {
    evidence_id: `grd_${c.key}_business_model`, company_key: c.key, dimension: "business_model",
    // The audience the verified quotes state rides on the value, when the code
    // names none (`ai_saas` sold to teams is B2B). See `valueWithStatedAudience`.
    value: valueWithStatedAudience(bm.value.replace(/_/g, " "), bmDecision.facets_stated),
    status: statusForAuthority(authority.authority),
    authority: authorityRecord(authority),
    source: {
      provider: "engine", actor: "grounded_evidence_evaluation", provider_call_id: null,
      url, excerpt: excerpt ? excerpt.slice(0, 280) : null,
    },
    method: "model_extraction", observed_at: at, valid_until: null,
    // NEVER `high`: a verified reading of a self-description is weaker than a
    // provider field, and the graph must rank it that way.
    confidence: accepted ? "medium" : "low",
    derived_from: [...new Set(claims.flatMap((x) => x.evidence_ids))],
    mission_id: missionId, origin: "web",
    assessment: {
      decision, grounding_score: Number(g.grounding_score ?? 0), validated_claims: claims.length,
      business_model_decision: bmDecision.decision, business_model_reasons: bmDecision.reasons,
      business_model_facets: bmDecision.facets_stated,
      business_model_quotes: bmDecision.quotes,
    },
  };
}
