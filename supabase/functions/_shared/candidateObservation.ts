// LEAD V2 P4 — ONE SHAPE FOR EVERYTHING A ROUTE SAYS ABOUT A COMPANY.
//
// Before P4 each discovery branch wrote a `NormalizedHiringCompany` straight
// into the pool, and the first writer won: `source_provenance` was one string,
// so a company found by the job route and again by a profile route kept one
// source and lost the other's evidence. Canary 2a215d44 could say which actor
// found an employer only by reading the provider attempts.
//
// A CandidateObservation is one route's statement about one company, carrying
// the route, actor, provider call, plan version and source record, plus the
// facts as EvidenceItems in the frozen plan's model (dimension / status /
// method / source / validity). Observations are never merged into each other;
// the union (`entityResolution.ts`) groups them under one canonical company and
// the evidence graph (`evidenceGraph.ts`) reads every one of them.
//
// GPT never writes an observation. Every item here is a provider field or a
// deterministic derivation of one. Pure.

import { usableHeadcount } from "./headcountValue.ts";
import { sha256Hex } from "./providerInputFingerprint.ts";
import type { NormalizedHiringCompany, NormalizedHiringJob } from "./hiringActorNormalizers.ts";
import { normalizeCompanyLinkedInUrl, normalizeWebsite } from "./structuredCompanyEnrichment.ts";

export const CANDIDATE_OBSERVATION_VERSION = "candidate-observation-v1" as const;

/** The frozen plan's evidence dimensions (LEAD_V2_SIGNAL_FIRST_FINAL_IMPLEMENTATION_PLAN, Evidence Model). */
export type EvidenceDimension =
  | "identity" | "geography" | "industry" | "business_model" | "headcount" | "headcount_growth"
  | "funding" | "company_stage" | "hiring" | "job" | "team_composition" | "marketing_function"
  | "founder_led_gtm" | "product_launch" | "expansion" | "leadership_change" | "technology" | "web_claim";

export type EvidenceStatus = "proven" | "disproven" | "plausible" | "unknown";
export type EvidenceMethod = "provider_field" | "deterministic_derivation" | "model_extraction";
export type EvidenceOrigin = "lead_mission" | "signals" | "enrichment" | "web";

export interface EvidenceItem {
  evidence_id: string;
  /** Null until the union assigns the canonical company. */
  company_key: string | null;
  dimension: EvidenceDimension;
  value: unknown;
  status: EvidenceStatus;
  source: {
    provider: string;
    actor: string;
    /** The ONE paid call this item came from. Null when none — or when several did (see below). */
    provider_call_id: string | null;
    /**
     * Every paid call the item rests on, when that is more than the single call
     * above can say — a verdict derived from two purchases names both. Absent on
     * single-source items.
     */
    provider_call_ids?: string[];
    url: string | null;
    excerpt: string | null;
  };
  method: EvidenceMethod;
  observed_at: string;
  valid_until: string | null;
  confidence: "high" | "medium" | "low";
  derived_from: string[];
  mission_id: string | null;
  origin: EvidenceOrigin;
  /**
   * P5.2 — the assessment that produced a model-extracted item, carried so
   * eligibility can say what a claim rests on. Absent on provider fields.
   */
  assessment?: {
    /** The grounder's verdict on the WHOLE company — recorded, not used as proof. */
    decision: "pass" | "review" | "fail";
    grounding_score: number;
    validated_claims: number;
    /** The business-model claim's own decision (`businessModelDecision`). This is what proves. */
    business_model_decision?: "accepted" | "review";
    business_model_reasons?: string[];
    /** The business-model facets the quotes state (`statedFacets`) — the proof, itemised. */
    business_model_facets?: string[];
  };
}

/** What a source says the company IS, before resolution decides which company that is. */
export interface EntityHint {
  /** Namespaced provider ids ("li_company:123", "yc:705"). */
  external_ids: string[];
  linkedin_company_url: string | null;
  domain: string | null;
  website: string | null;
  name: string | null;
  country: string | null;
}

export interface ObservationContext {
  capability: string;
  actor_key: string;
  /** "apify", "firecrawl", "engine". */
  provider: string;
  route_id: string | null;
  plan_version: number | null;
  provider_call_id: string | null;
  mission_id: string | null;
  observed_at: string;
  origin?: EvidenceOrigin;
}

export interface CandidateObservation {
  version: typeof CANDIDATE_OBSERVATION_VERSION;
  observation_id: string;
  capability: string;
  actor_key: string;
  provider: string;
  route_id: string | null;
  plan_version: number | null;
  provider_call_id: string | null;
  source_record_id: string | null;
  source_url: string | null;
  observed_at: string;
  entity_hint: EntityHint;
  evidence: EvidenceItem[];
}

const DAY = 86_400_000;
/** How long a fact of this kind stays true enough to act on. Null = durable. */
export const EVIDENCE_VALIDITY_DAYS: Readonly<Partial<Record<EvidenceDimension, number>>> = Object.freeze({
  job: 30, hiring: 30, headcount: 90, headcount_growth: 90, funding: 365, company_stage: 365,
  team_composition: 90, marketing_function: 90, product_launch: 90, expansion: 180,
  leadership_change: 180, technology: 180, web_claim: 180,
});

function validUntil(dim: EvidenceDimension, observedAt: string): string | null {
  const days = EVIDENCE_VALIDITY_DAYS[dim];
  const t = Date.parse(observedAt);
  return days == null || !Number.isFinite(t) ? null : new Date(t + days * DAY).toISOString();
}

const str = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};

/** "https://www.acme.com/about" → "acme.com". Null for anything not a website. */
export function domainOf(v: unknown): string | null {
  const w = normalizeWebsite(v) ?? (str(v) && !/\s/.test(String(v)) ? `https://${String(v).replace(/^https?:\/\//i, "")}` : null);
  if (!w) return null;
  const host = w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The last comma part of a headquarters string, when it reads as a country. */
function countryOf(geography: string | null): string | null {
  if (!geography) return null;
  const last = geography.split(",").map((x) => x.trim()).filter(Boolean).pop() ?? "";
  if (/^(us|usa|united states( of america)?)$/i.test(last)) return "US";
  if (/^[A-Z]{2}$/.test(last)) return last;
  return last.length >= 3 && last.length <= 40 ? last.toLowerCase() : null;
}

function item(
  ctx: ObservationContext, dimension: EvidenceDimension, value: unknown,
  o: {
    status: EvidenceStatus; method?: EvidenceMethod; confidence: EvidenceItem["confidence"];
    url?: string | null; excerpt?: string | null; derived_from?: string[]; source_record_id?: string | null;
  },
): EvidenceItem {
  const source = {
    provider: ctx.provider, actor: ctx.actor_key, provider_call_id: ctx.provider_call_id,
    url: o.url ?? null, excerpt: o.excerpt ? o.excerpt.slice(0, 280) : null,
  };
  return {
    evidence_id: `ev_${sha256Hex(JSON.stringify([ctx.actor_key, ctx.provider_call_id, o.source_record_id ?? null, dimension, value, o.url ?? null])).slice(0, 24)}`,
    company_key: null, dimension, value, status: o.status, source,
    method: o.method ?? "provider_field", observed_at: ctx.observed_at,
    valid_until: validUntil(dimension, ctx.observed_at), confidence: o.confidence,
    derived_from: o.derived_from ?? [], mission_id: ctx.mission_id, origin: ctx.origin ?? "lead_mission",
  };
}

export function entityHintFromCompany(c: NormalizedHiringCompany): EntityHint {
  const li = normalizeCompanyLinkedInUrl(c.linkedin_company_url);
  const website = normalizeWebsite(c.website);
  return {
    external_ids: c.external_source_id && !/:unknown$/.test(c.external_source_id) ? [c.external_source_id] : [],
    linkedin_company_url: li,
    domain: domainOf(c.canonical_domain) ?? domainOf(c.website),
    website,
    name: str(c.company_name),
    country: countryOf(c.geography),
  };
}

/**
 * One route's statement about one company, from the normalized row the engine
 * already builds. `jobs` are the open roles the same row carried.
 */
export function observationFromCompany(
  c: NormalizedHiringCompany, ctx: ObservationContext, jobs: readonly NormalizedHiringJob[] = [],
): CandidateObservation {
  const hint = entityHintFromCompany(c);
  const rec = c.raw_ref?.source_id != null ? String(c.raw_ref.source_id) : null;
  const trust = c.field_trust ?? {};
  const ev: EvidenceItem[] = [];
  const base = { source_record_id: rec };
  if (hint.linkedin_company_url || hint.domain) {
    ev.push(item(ctx, "identity", {
      linkedin_company_url: hint.linkedin_company_url, domain: hint.domain, name: hint.name,
    }, { ...base, status: "proven", confidence: hint.linkedin_company_url ? "high" : "medium", url: hint.linkedin_company_url ?? hint.website }));
  }
  if (c.geography) {
    ev.push(item(ctx, "geography", c.geography, {
      ...base, status: "plausible", confidence: trust.geography === "direct" ? "high" : "medium",
    }));
  }
  if (usableHeadcount(c.employee_count) != null) {
    ev.push(item(ctx, "headcount", c.employee_count, {
      ...base, status: "plausible", confidence: trust.employee_count === "direct" ? "medium" : "low",
    }));
  }
  if (c.provider_industry) {
    // The provider's label is never proof of industry (hiringActorNormalizers).
    ev.push(item(ctx, "industry", c.provider_industry, { ...base, status: "plausible", confidence: "low" }));
  }
  const cohort = c.startup_evidence && typeof c.startup_evidence === "object"
    ? str((c.startup_evidence as Record<string, unknown>).batch) : null;
  if (cohort) {
    ev.push(item(ctx, "company_stage", { cohort: "y_combinator", batch: cohort }, { ...base, status: "proven", confidence: "high" }));
  }
  for (const j of jobs.slice(0, 3)) {
    ev.push(item(ctx, "job", { title: j.title, posted_date: j.posted_date, location: j.location }, {
      status: "proven", confidence: "high", url: j.job_url, excerpt: j.title, source_record_id: j.job_id,
    }));
  }
  if (c.hiring_status === true) {
    ev.push(item(ctx, "hiring", true, {
      ...base, status: "proven", confidence: jobs.length > 0 ? "high" : "medium",
      method: jobs.length > 0 ? "deterministic_derivation" : "provider_field",
      derived_from: jobs.slice(0, 5).map((j) => j.job_url ?? j.job_id ?? "").filter(Boolean),
    }));
  }
  return {
    version: CANDIDATE_OBSERVATION_VERSION,
    observation_id: `obs_${sha256Hex(JSON.stringify([ctx.route_id, ctx.actor_key, ctx.provider_call_id, rec, hint.linkedin_company_url, hint.domain, hint.name])).slice(0, 24)}`,
    capability: ctx.capability, actor_key: ctx.actor_key, provider: ctx.provider,
    route_id: ctx.route_id, plan_version: ctx.plan_version, provider_call_id: ctx.provider_call_id,
    source_record_id: rec, source_url: hint.linkedin_company_url ?? hint.website,
    observed_at: ctx.observed_at, entity_hint: hint, evidence: ev,
  };
}

/** A web page's deterministic claim about a company (e.g. a careers page naming a role). */
export function observationFromWebClaim(
  hint: EntityHint, ctx: ObservationContext,
  claim: { dimension: EvidenceDimension; value: unknown; url: string; excerpt: string | null; method: EvidenceMethod; confidence: EvidenceItem["confidence"] },
): CandidateObservation {
  const ev = item({ ...ctx, origin: ctx.origin ?? "web" }, claim.dimension, claim.value, {
    status: claim.method === "model_extraction" ? "plausible" : "proven",
    method: claim.method, confidence: claim.confidence, url: claim.url, excerpt: claim.excerpt,
    source_record_id: claim.url,
  });
  return {
    version: CANDIDATE_OBSERVATION_VERSION,
    observation_id: `obs_${sha256Hex(JSON.stringify([ctx.route_id, ctx.actor_key, ctx.provider_call_id, claim.url, claim.dimension])).slice(0, 24)}`,
    capability: ctx.capability, actor_key: ctx.actor_key, provider: ctx.provider,
    route_id: ctx.route_id, plan_version: ctx.plan_version, provider_call_id: ctx.provider_call_id,
    source_record_id: claim.url, source_url: claim.url, observed_at: ctx.observed_at,
    entity_hint: hint, evidence: [ev],
  };
}

/** Bounds an observation for a checkpoint: facts kept, excerpts already capped. */
export function compactObservation(o: CandidateObservation, maxEvidence = 8): CandidateObservation {
  return o.evidence.length <= maxEvidence ? o : { ...o, evidence: o.evidence.slice(0, maxEvidence) };
}
