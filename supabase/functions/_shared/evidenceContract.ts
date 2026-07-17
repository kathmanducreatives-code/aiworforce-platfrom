// Evidence Contract Compiler (Phase 1A) — deterministic, pure.
//
// Turns the IMMUTABLE LeadEntityIntent (+ Company Brain constraints) into the
// explicit evidence a candidate must carry before it may be accepted. This is the
// layer that separates three things the v82 audit showed were conflated:
//
//   1. Identity proof   — who is the person/company/job?
//   2. ICP-fit proof    — does the COMPANY match the Company Brain?
//   3. Timing proof     — why is this relevant NOW?
//
// The user's stated ICP ("B2B SaaS") is a REQUESTED CONSTRAINT, never candidate
// evidence: a candidate must still carry its own proof that it satisfies it.
// Planner prose can never add a mandatory requirement — only the compiled intent,
// the Brain, and the requested freshness shape this contract.

import type { LeadEntityIntent, TargetEntity, FreshnessRequirement } from "./leadEntityIntent.ts";
import { CANONICAL_TIMING_WINDOW_HOURS, resolveWindowHours, type ExplicitTimingWindow } from "./timingFreshnessPolicy.ts";

export type EvidenceCategory =
  | "person_identity"
  | "person_company_association"
  | "company_identity"
  | "company_website"
  | "company_industry"
  | "company_business_model"
  | "company_size"
  | "company_geography"
  | "job_signal"
  | "funding_signal"
  | "launch_signal"
  | "expansion_signal"
  | "founder_activity_signal"
  | "gtm_signal";

export type EvidenceConfidence = "low" | "medium" | "high";

export type EvidenceSourceType =
  | "apify_actor"
  | "official_website"
  | "public_web"
  | "company_brain";

export interface EvidenceRequirement {
  category: EvidenceCategory;
  required: boolean;
  minimumConfidence: EvidenceConfidence;
  freshnessWindowHours?: number;
  acceptableSourceTypes: EvidenceSourceType[];
}

export type AcceptancePolicy = "identity_only" | "fit_confirmed" | "fit_and_timing_confirmed";

export interface EvidenceContract {
  targetEntity: TargetEntity;
  freshness: FreshnessRequirement;
  identityRequirements: EvidenceRequirement[];
  fitRequirements: EvidenceRequirement[];
  timingRequirements: EvidenceRequirement[];
  optionalRequirements: EvidenceRequirement[];
  acceptancePolicy: AcceptancePolicy;
  /**
   * The window the USER stated explicitly ("hiring in the last 60 days"), carried
   * from the typed intent. Null when they stated none. Downstream layers read this
   * rather than re-parsing the instruction.
   */
  explicitTimingWindow: ExplicitTimingWindow | null;
}

/** Company Brain constraints that make a fit requirement mandatory. Brain fields
 * are CONSTRAINTS — they never count as candidate evidence. */
export interface BrainConstraints {
  industries?: string[] | null;
  geography?: string | null;
  company_size?: string | null;
}

/**
 * Freshness windows (hours) per signal class.
 *
 * Sourced from the CANONICAL authority (timingFreshnessPolicy.ts) so this table and
 * the SignalEvent freshness policy can never silently disagree again — they did, and
 * the 168h funding window meant "recently funded" only matched the last 7 days.
 * Funding is now 180d here, with decay bands governing strength inside that window.
 */
const SIGNAL_WINDOW_HOURS: Readonly<Record<string, number>> = CANONICAL_TIMING_WINDOW_HOURS;

const PROVIDER_SOURCES: EvidenceSourceType[] = ["apify_actor", "official_website", "public_web"];

function req(
  category: EvidenceCategory,
  required: boolean,
  minimumConfidence: EvidenceConfidence,
  acceptableSourceTypes: EvidenceSourceType[] = PROVIDER_SOURCES,
  freshnessWindowHours?: number,
): EvidenceRequirement {
  return { category, required, minimumConfidence, acceptableSourceTypes, ...(freshnessWindowHours ? { freshnessWindowHours } : {}) };
}

/** Map an intent signal type → the evidence category that proves it. */
export function signalToEvidenceCategory(signal: string): EvidenceCategory | null {
  switch (signal) {
    case "hiring": return "job_signal";
    case "funding": return "funding_signal";
    case "product_launch": return "launch_signal";
    case "expansion": return "expansion_signal";
    case "new_executive": return "gtm_signal";
    case "recent_post": return "founder_activity_signal";
    default: return null;
  }
}

/**
 * Compile the evidence contract. Deterministic: same intent + brain ⇒ same contract.
 *  - identity: always required for the target entity.
 *  - fit: required when the request or the Brain constrains industry/geo/size, and
 *         whenever freshness demands current fit (i.e. anything above identity_only).
 *  - timing: required only for recent_signal / hot_opportunity.
 */
export function compileEvidenceContract(
  intent: LeadEntityIntent,
  brain?: BrainConstraints | null,
): EvidenceContract {
  const target = intent.target_entity;
  const freshness = intent.freshness;
  const b = brain ?? {};

  // ---------- identity ----------
  const identityRequirements: EvidenceRequirement[] = [];
  if (target === "person") {
    identityRequirements.push(req("person_identity", true, "high"));
    // A person is only actionable with a current company association (except a
    // pure identity lookup, where the association is nice-to-have).
    identityRequirements.push(req("person_company_association", freshness !== "identity_only", "medium"));
  } else if (target === "company") {
    identityRequirements.push(req("company_identity", true, "high"));
  } else {
    identityRequirements.push(req("job_signal", true, "high", PROVIDER_SOURCES, SIGNAL_WINDOW_HOURS.job_signal));
    identityRequirements.push(req("company_identity", true, "medium"));
  }

  // ---------- fit ----------
  const fitRequirements: EvidenceRequirement[] = [];
  const wantsFit = freshness !== "identity_only";
  const industryConstrained = (intent.company_categories?.length ?? 0) > 0 || (b.industries?.length ?? 0) > 0;
  const geoConstrained = (intent.geographies?.length ?? 0) > 0 || !!b.geography;
  const sizeConstrained = !!b.company_size;

  if (wantsFit) {
    if (industryConstrained) {
      // Proving an industry/business-model claim needs the company's own evidence.
      fitRequirements.push(req("company_industry", true, "medium"));
      fitRequirements.push(req("company_website", true, "medium"));
      // Business model is the deeper claim ("B2B" SaaS); official proof may be needed.
      fitRequirements.push(req("company_business_model", false, "medium", ["official_website", "apify_actor", "public_web"]));
    }
    if (geoConstrained) fitRequirements.push(req("company_geography", true, "medium"));
    if (sizeConstrained) fitRequirements.push(req("company_size", true, "low"));
  }

  // ---------- timing ----------
  const timingRequirements: EvidenceRequirement[] = [];
  const explicitSignalCats = (intent.signals ?? [])
    .map((s) => signalToEvidenceCategory(s.type))
    .filter((c): c is EvidenceCategory => !!c);
  // The window the user stated explicitly ("funded this week"), carried on the typed
  // intent. resolveWindowHours applies the STRICTER of (explicit, general policy).
  const statedWindow = (intent.signals ?? []).find((s) => !!s.window)?.window ?? null;
  const windowFor = (c: EvidenceCategory) =>
    resolveWindowHours({ category: c, explicitWindow: statedWindow }) ?? SIGNAL_WINDOW_HOURS[c] ?? 168;

  if (freshness === "recent_signal") {
    // The user named the signal — that exact signal must be proven and fresh.
    for (const c of explicitSignalCats) {
      timingRequirements.push(req(c, true, "medium", PROVIDER_SOURCES, windowFor(c)));
    }
  } else if (freshness === "hot_opportunity") {
    // "Hot right now" — at least ONE recent verified signal. Each is individually
    // optional; the sufficiency gate requires >=1 satisfied (any-of semantics).
    // Each category keeps its OWN window — never job_signal's 72h applied to funding.
    const anyOf: EvidenceCategory[] = explicitSignalCats.length
      ? explicitSignalCats
      : ["job_signal", "funding_signal", "launch_signal", "expansion_signal", "founder_activity_signal", "gtm_signal"];
    for (const c of anyOf) {
      timingRequirements.push(req(c, false, "medium", PROVIDER_SOURCES, windowFor(c)));
    }
  }

  // ---------- optional ----------
  const optionalRequirements: EvidenceRequirement[] = [];
  if (wantsFit && !industryConstrained) {
    optionalRequirements.push(req("company_website", false, "low"));
    optionalRequirements.push(req("company_industry", false, "low"));
  }

  const acceptancePolicy: AcceptancePolicy =
    freshness === "identity_only" ? "identity_only"
      : (freshness === "recent_signal" || freshness === "hot_opportunity") ? "fit_and_timing_confirmed"
        : "fit_confirmed";

  return {
    targetEntity: target, freshness, identityRequirements, fitRequirements, timingRequirements,
    optionalRequirements, acceptancePolicy, explicitTimingWindow: statedWindow,
  };
}

/** True when the contract demands at least one (any-of) timing signal rather than
 * every listed timing requirement. */
export function timingIsAnyOf(contract: EvidenceContract): boolean {
  return contract.freshness === "hot_opportunity";
}
