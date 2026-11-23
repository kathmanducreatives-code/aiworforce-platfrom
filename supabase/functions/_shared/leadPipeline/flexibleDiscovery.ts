// FLEXIBLE DISCOVERY (ATLAS pilot, 2026-11-23) — useful leads before strict classification.
//
// Strict Discovery is unchanged: every requirement the user stated gates, and a requirement no
// approved tool can prove blocks the plan. Flexible Discovery is the user's explicit, hash-bound
// choice to treat two kinds of requirement as RANKING PREFERENCES instead:
//
//   industry                 ("commercial contracting or … manufacturing")
//   excluded company types   ("exclude consumer-only companies")
//
// Every other requirement still gates (headquarters, hiring, business model when stated as a
// requirement, …). What was relaxed is listed on the plan BEFORE approval.
//
// GPT's part is interpretation only, at PLAN time: it names industries closely related to the
// ones requested ("manufacturing" → "Machinery Manufacturing", "Industrial Automation"). The list
// is validated, shown, bound into the plan hash and replayed from the signed token, so a run
// never calls the model. GPT never names a company and never produces evidence: a company's
// industry relevance is read from its own LinkedIn label and description against that list,
// and is always reported as INFERRED — no approved tool proves an industry.
//
// Each returned company gets a match tier and a per-attribute status (verified / inferred /
// unknown), with its source URLs. Pure, except `expandIndustries` (one model call).

import type { GenerateJsonFn } from "../intelligence/plannerWrapper.ts";
import type { MissionCriterion } from "../missionCriteria.ts";
import type { DiscoverySpec } from "./strategy.ts";
import type { PipelineLead } from "./pipeline.ts";
import { stems } from "../discoveryProviders/verify.ts";

export const FLEXIBLE_DISCOVERY_VERSION = "flexible-discovery-v1" as const;
export type DiscoveryMode = "strict" | "flexible";

export interface RelaxedCriterion {
  criterionId: string;
  label: string;
  dimension: string;
  was: "required";
  now: "preference";
  why: string;
}

export interface IndustryMap {
  requested: string[];
  /** Closely related industry labels GPT named at plan time (validated). Empty without a model. */
  related: string[];
  source: "model" | "none";
  model: string | null;
  error: string | null;
}

export interface FlexibleSpec {
  version: typeof FLEXIBLE_DISCOVERY_VERSION;
  relaxed: RelaxedCriterion[];
  industries: IndustryMap;
}

const excludedTypes = (c: MissionCriterion): string[] | null => {
  const v = c.value as { field?: string; value?: unknown } | null;
  if (c.dimension !== "exclusion" || v?.field !== "excluded_company_types") return null;
  return (Array.isArray(v.value) ? v.value : [v.value]).map((x) => String(x ?? "").trim()).filter(Boolean);
};

const relaxable = (c: MissionCriterion) => c.kind === "hard" && (c.dimension === "industry" || excludedTypes(c) !== null);

/** The industries the request names (any necessity), for relevance ranking. */
export function requestedIndustries(spec: DiscoverySpec): string[] {
  const out = new Set<string>(spec.industry.map((x) => x.trim()).filter(Boolean));
  for (const c of spec.requirements.criteria) {
    if (c.dimension === "industry" && typeof c.value === "string" && c.value.trim()) out.add(c.value.trim());
  }
  return [...out];
}

/**
 * The spec Flexible Discovery runs on: industry and excluded-type requirements become
 * preferences (kind "target"), and leave the provider-facing hard list. Nothing else changes.
 * Strict: returns the spec untouched.
 */
export function relaxForFlexible(spec: DiscoverySpec, industries: IndustryMap): { spec: DiscoverySpec; relaxed: RelaxedCriterion[] } {
  const relaxed: RelaxedCriterion[] = [];
  const seen = new Set<string>();
  const criteria = spec.requirements.criteria.map((c) => {
    if (!relaxable(c)) return c;
    const label = String(c.label ?? c.dimension);
    if (!seen.has(label)) {
      seen.add(label);
      relaxed.push({
        criterionId: c.id, label, dimension: String(c.dimension), was: "required", now: "preference",
        why: c.dimension === "industry"
          ? "no approved tool can prove an industry; Flexible Discovery ranks by how closely each company's own LinkedIn label and description match it"
          : "ranked by the business model each company's own website states; a company shown to be one is ranked last, not removed",
      });
    }
    return { ...c, kind: "target" } as MissionCriterion;
  });
  const relaxedIds = new Set(spec.requirements.criteria.filter(relaxable).map((c) => c.id));
  const movedHard = spec.requirements.hard.filter((h) => relaxedIds.has(h.criterionId));
  const flexible: FlexibleSpec = { version: FLEXIBLE_DISCOVERY_VERSION, relaxed, industries };
  return {
    relaxed,
    spec: {
      ...spec,
      flexible,
      requirements: {
        ...spec.requirements,
        criteria,
        hard: spec.requirements.hard.filter((h) => !relaxedIds.has(h.criterionId)),
        preferences: [
          ...spec.requirements.preferences,
          ...movedHard.filter((h) => Array.isArray(h.values)).map((h) => ({ criterionId: h.criterionId, label: h.label, key: h.key, values: h.values as string[] })),
        ],
      },
    },
  };
}

// ── GPT: related industries, at plan time only ─────────────────────────────

const INDUSTRY_SYSTEM_PROMPT = [
  "You help a B2B lead-discovery tool rank companies by industry.",
  "Given the industries a user asked for, list up to 12 closely related industry labels a company in those industries",
  "might use to describe itself (for example LinkedIn industry names). Only industries that a reasonable buyer would",
  "accept as the same market or an adjacent one. Never name companies. Answer JSON: {\"related\": [string, ...]}.",
].join(" ");

const LABEL = /^[A-Za-z][A-Za-z0-9&,'()\/ .-]{1,59}$/;

/** Keep only plain industry labels, not already requested, deduplicated, at most 12. */
export function cleanRelated(raw: unknown, requested: readonly string[]): string[] {
  const asked = new Set(requested.map((r) => r.toLowerCase().trim()));
  const out: string[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (typeof x !== "string") continue;
    const v = x.trim().replace(/\s+/g, " ");
    if (!LABEL.test(v) || asked.has(v.toLowerCase()) || out.some((o) => o.toLowerCase() === v.toLowerCase())) continue;
    out.push(v);
    if (out.length === 12) break;
  }
  return out;
}

export async function expandIndustries(requested: readonly string[], generate: GenerateJsonFn | null, workspaceId?: string): Promise<IndustryMap> {
  const base = { requested: [...requested], related: [] as string[], source: "none" as const, model: null, error: null };
  if (!requested.length) return base;
  if (!generate) return { ...base, error: "no model configured: only the requested industries are matched" };
  try {
    const res = await generate({ taskType: "orchestration_plan", jsonMode: true, temperature: 0, maxTokens: 300, systemPrompt: INDUSTRY_SYSTEM_PROMPT,
      functionName: "lead-pipeline-flexible-industries", workspaceId, messages: [{ role: "user", content: JSON.stringify({ industries: requested }) }] } as never);
    if (!res.ok) return { ...base, model: res.model ?? null, error: res.error ?? "model call failed" };
    const j = (res.json ?? (() => { try { return JSON.parse(res.content); } catch { return null; } })()) as { related?: unknown } | null;
    const related = cleanRelated(j?.related, requested);
    return { requested: [...requested], related, source: "model", model: res.model ?? null, error: related.length ? null : "the model named no usable related industry" };
  } catch (e) {
    return { ...base, error: `model call threw: ${(e as Error)?.message ?? e}` };
  }
}

/** A map read back from a signed token: re-validated, never trusted as-is. */
export function readIndustryMap(raw: unknown, requested: readonly string[]): IndustryMap {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    requested: [...requested], related: cleanRelated(r.related, requested),
    source: r.source === "model" ? "model" : "none", model: typeof r.model === "string" ? r.model : null,
    error: typeof r.error === "string" ? r.error.slice(0, 200) : null,
  };
}

// ── Match tiers and attribute status ───────────────────────────────────────

export type MatchTier = "strong" | "close" | "exploratory" | "insufficient";
export type AttributeStatus = "verified" | "inferred" | "unknown";
export interface Attribute { status: AttributeStatus; value: string; sources: string[] }
export type AttributeName = "headquarters" | "hiring" | "industry" | "business_model" | "consumer_only" | "size";

export interface FlexibleMatch {
  leadKey: string;
  name: string | null;
  domain: string | null;
  tier: MatchTier;
  /** Why this tier, in order. */
  why: string[];
  attributes: Record<AttributeName, Attribute>;
  /** Every source URL behind any attribute, deduplicated. */
  sources: string[];
}

const TIER_ORDER: Record<MatchTier, number> = { strong: 0, close: 1, exploratory: 2, insufficient: 3 };

function mentions(text: string, phrase: string): boolean {
  const s = stems(phrase);
  return s.length > 0 && s.every((x) => text.includes(x));
}

type Check = NonNullable<PipelineLead["qualification"]>["checks"][number];
const urlsOf = (cs: readonly Check[]) => [...new Set(cs.flatMap((c) => (c.evidence ?? []).map((e) => e.url).filter((u): u is string => !!u)))];

/** One company's attributes and tier. Reads only evidence already gathered. */
export function matchOf(l: PipelineLead, industries: IndustryMap): FlexibleMatch {
  const checks = l.qualification?.checks ?? [];
  const by = (d: string) => checks.filter((c) => c.dimension === d);
  const li = l.company.linkedinUrl ? [l.company.linkedinUrl] : [];

  // Headquarters: the engine's check, else the record's reported country.
  const geo = by("geography");
  const hq: Attribute = geo.some((c) => c.result === "pass")
    ? { status: "verified", value: l.company.hq.country ?? "inside the requested area", sources: urlsOf(geo).length ? urlsOf(geo) : li }
    : l.company.hq.country ? { status: "inferred", value: l.company.hq.country, sources: li }
    : { status: "unknown", value: "not established", sources: [] };

  // Hiring: a dated posting that passed the check is verified; other sales activity is inferred.
  const hire = by("hiring");
  const jobs = l.signals.filter((s) => s.type === "hiring");
  const jobUrls = [...new Set(jobs.map((s) => s.sourceUrl).filter((u): u is string => !!u))];
  const hiring: Attribute = hire.some((c) => c.result === "pass")
    ? { status: "verified", value: "dated job posting for the requested role", sources: urlsOf(hire).length ? urlsOf(hire) : jobUrls }
    : jobs.length ? { status: "inferred", value: "related sales hiring, not confirmed for the requested role or window", sources: jobUrls }
    : { status: "unknown", value: "no job posting found", sources: [] };

  // Industry: never proven; relevance is inferred from the company's own label and description.
  const text = `${l.company.industry.join(" ")} ${l.company.description ?? ""}`.toLowerCase();
  const direct = industries.requested.find((r) => mentions(text, r));
  const related = direct ? undefined : industries.related.find((r) => mentions(text, r));
  const indCheck = by("industry").find((c) => c.result === "pass");
  const industry: Attribute = indCheck
    ? { status: "verified", value: indCheck.reason, sources: urlsOf([indCheck]) }
    : direct ? { status: "inferred", value: `matches “${direct}” (${l.company.industry.join(", ") || "description"})`, sources: li }
    : related ? { status: "inferred", value: `related: “${related}” (${l.company.industry.join(", ") || "description"})`, sources: li }
    : { status: "unknown", value: l.company.industry.length ? `${l.company.industry.join(", ")} — not one of the requested industries` : "no industry stated", sources: li };
  const industryFit: "direct" | "related" | "none" = indCheck || direct ? "direct" : related ? "related" : "none";

  // Business model and consumer-only: the company's own website, when it was read.
  const bm = l.businessModel;
  const site = bm?.url ? [bm.url] : [];
  const business_model: Attribute = !bm || bm.status === "unknown" ? { status: "unknown", value: "not read", sources: site }
    : bm.status === "verified_b2b" ? { status: "verified", value: "B2B", sources: site }
    : bm.status === "likely_b2b" ? { status: "inferred", value: "likely B2B", sources: site }
    : bm.status === "mixed" ? { status: "inferred", value: "mixed (business and consumer)", sources: site }
    : { status: "inferred", value: "not B2B", sources: site };
  const excl = by("exclusion");
  const consumer_only: Attribute = excl.some((c) => c.result === "fail")
    ? { status: "verified", value: "consumer-only", sources: urlsOf(excl).length ? urlsOf(excl) : site }
    : excl.some((c) => c.result === "pass") || bm?.status === "verified_b2b" ? { status: "verified", value: "not consumer-only", sources: urlsOf(excl).length ? urlsOf(excl) : site }
    : bm?.status === "likely_b2b" ? { status: "inferred", value: "not consumer-only", sources: site }
    : bm?.status === "not_b2b" ? { status: "inferred", value: "possibly consumer-only", sources: site }
    : { status: "unknown", value: "not established", sources: [] };

  const sz = by("company_size");
  const size: Attribute = sz.some((c) => c.result === "pass")
    ? { status: "verified", value: "within the requested size", sources: urlsOf(sz).length ? urlsOf(sz) : li }
    : l.company.employeeCount != null ? { status: "inferred", value: `about ${l.company.employeeCount} on LinkedIn`, sources: li }
    : { status: "unknown", value: "not established", sources: [] };

  const attributes = { headquarters: hq, hiring, industry, business_model, consumer_only, size };
  const sources = [...new Set(Object.values(attributes).flatMap((a) => a.sources))];
  const consumer = consumer_only.value === "consumer-only" || consumer_only.value === "possibly consumer-only";

  const why: string[] = [];
  let tier: MatchTier;
  if (!sources.length || (hq.status !== "verified" && hiring.status === "unknown")) {
    tier = "insufficient";
    why.push(!sources.length ? "no source to show" : "neither headquarters nor hiring is established");
  } else if (consumer) {
    tier = "exploratory";
    why.push(`its own website suggests it is ${consumer_only.value.replace("possibly ", "")}, which you asked to exclude`);
  } else if (hq.status === "verified" && hiring.status === "verified" && industryFit === "direct" && (business_model.value === "B2B" || business_model.value === "likely B2B")) {
    tier = "strong";
    why.push(`headquarters and hiring verified; industry matches; ${business_model.value === "B2B" ? "B2B" : "likely B2B"} per its own website`);
  } else if (hq.status === "verified" && hiring.status !== "unknown" && industryFit !== "none") {
    tier = "close";
    why.push(industryFit === "related" ? "industry is related, not one you named" : "industry matches", hiring.status === "verified" ? "hiring verified" : "hiring inferred");
    if (business_model.status === "unknown") why.push("business model not established");
  } else {
    tier = "exploratory";
    if (industryFit === "none") why.push("industry is not one you named or a related one");
    if (hq.status !== "verified") why.push("headquarters not verified");
    if (hiring.status !== "verified") why.push("hiring not verified");
  }
  return { leadKey: l.leadKey, name: l.company.name, domain: l.company.domain, tier, why, attributes, sources };
}

/** Every returned company, best tier first; within a tier the pipeline's own order. */
export function flexibleMatches(leads: readonly PipelineLead[], industries: IndustryMap): FlexibleMatch[] {
  return leads.map((l, i) => ({ m: matchOf(l, industries), i }))
    .sort((a, b) => TIER_ORDER[a.m.tier] - TIER_ORDER[b.m.tier] || a.i - b.i).map((x) => x.m);
}

/**
 * The outcome in Flexible Discovery's own words: only Strong and Close matches count, the rest
 * are named for what they are. Strict (no matches): the outcome unchanged. Only a completed
 * outcome's summary is reworded; a failure, a shortfall's spend and every count stay as decided.
 */
export function flexibleOutcome<T extends { status: string; summary: string }>(matches: readonly FlexibleMatch[] | null, requested: number | null, o: T): T {
  if (!matches || o.status === "failed" || o.status === "blocked" || o.status === "cancelled") return o;
  const n = (t: MatchTier) => matches.filter((m) => m.tier === t).length;
  const counted = n("strong") + n("close");
  const rest = [n("exploratory") ? `${n("exploratory")} exploratory` : "", n("insufficient") ? `${n("insufficient")} with insufficient evidence` : ""].filter(Boolean);
  return { ...o, summary: `Flexible Discovery: ${counted} Strong or Close ${counted === 1 ? "match" : "matches"}${requested ? ` of ${requested} requested` : ""} (${n("strong")} strong, ${n("close")} close)` +
    (rest.length ? `; ${rest.join(", ")} also returned for review.` : ".") };
}
