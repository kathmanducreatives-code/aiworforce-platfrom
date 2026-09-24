// LEAD V2 P4 — WHAT IS KNOWN ABOUT ONE COMPANY, AND FROM WHERE.
//
// A claim store over EvidenceItems. Every item any route produced is kept; the
// graph groups them by dimension, picks the item that currently speaks for the
// dimension, and keeps the ones that disagree as conflicts rather than
// dropping them. Precedence is the frozen plan's: provider_field >
// deterministic_derivation > model_extraction, then confidence, then recency.
// An expired item still appears, marked stale, and never speaks for a
// dimension while a fresh one exists.
//
// Claim types are generic: nothing here knows about hiring, funding or any one
// signal. `gaps` is how later stages (and P5's opportunity reasoner) ask what
// is still unknown about a candidate instead of re-buying what is known.
//
// GPT never writes here. Pure.

import { canonicalJson } from "./providerInputFingerprint.ts";
import type { EvidenceDimension, EvidenceDimension as Dim, EvidenceItem } from "./candidateObservation.ts";
import type { ExecutionDimension } from "./criteriaExecutionPolicy.ts";
import type {
  EvidenceItem as RegistryItem, EvidenceRegistry, EvidenceType,
} from "./leadEvidenceRegistry.ts";

export const EVIDENCE_GRAPH_VERSION = "evidence-graph-v1" as const;

/** Dimensions where two different values cannot both be true at once. */
export const SINGLE_VALUED: ReadonlySet<EvidenceDimension> = new Set<EvidenceDimension>([
  "identity", "geography", "headcount", "company_size_band", "linkedin_member_count", "business_model", "company_stage", "industry",
]);

const METHOD_RANK = { provider_field: 3, deterministic_derivation: 2, model_extraction: 1 } as const;
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;
const STATUS_RANK = { proven: 3, disproven: 3, plausible: 2, unknown: 1 } as const;

export interface EvidenceClaim {
  dimension: EvidenceDimension;
  /** The item that currently speaks for this dimension. Null when every item is stale. */
  current: EvidenceItem | null;
  /** Items agreeing with `current` (different sources, same value). */
  supporting: EvidenceItem[];
  /** Fresh items whose value disagrees with `current`. Single-valued dimensions only. */
  conflicting: EvidenceItem[];
  stale: EvidenceItem[];
  /** Distinct actors that contributed any item. */
  sources: string[];
}

export interface CompanyEvidenceGraph {
  version: typeof EVIDENCE_GRAPH_VERSION;
  company_key: string;
  claims: EvidenceClaim[];
  /** Required dimensions with no fresh, non-unknown item. */
  gaps: EvidenceDimension[];
  conflicts: EvidenceDimension[];
  item_count: number;
}

function valueKey(e: EvidenceItem): string {
  const v = e.value;
  if (e.dimension === "identity" && v && typeof v === "object") {
    const r = v as Record<string, unknown>;
    return canonicalJson([r.linkedin_company_url ?? null, r.domain ?? null]);
  }
  if (e.dimension === "company_size_band" && v && typeof v === "object") {
    // A band is its bounds; the source label is not part of the fact.
    const b = v as { min?: unknown; max?: unknown };
    return canonicalJson([b.min ?? null, b.max ?? null]);
  }
  if ((e.dimension === "headcount" || e.dimension === "linkedin_member_count") && typeof v === "number") {
    // Two sources a few people apart are the same claim, not a conflict.
    return canonicalJson(v < 10 ? Math.round(v) : Math.round(Math.log(v) / Math.log(1.25)));
  }
  return canonicalJson(typeof v === "string" ? v.trim().toLowerCase() : v);
}

/** Best first. */
export function compareEvidence(a: EvidenceItem, b: EvidenceItem): number {
  return (METHOD_RANK[b.method] - METHOD_RANK[a.method]) ||
    (STATUS_RANK[b.status] - STATUS_RANK[a.status]) ||
    (CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]) ||
    (Date.parse(b.observed_at) - Date.parse(a.observed_at)) ||
    a.evidence_id.localeCompare(b.evidence_id);
}

export function isStale(e: EvidenceItem, now: Date): boolean {
  return e.valid_until !== null && Date.parse(e.valid_until) < now.getTime();
}

export function buildCompanyEvidenceGraph(
  company_key: string, items: readonly EvidenceItem[],
  opts: { now?: Date; required?: readonly EvidenceDimension[] } = {},
): CompanyEvidenceGraph {
  const now = opts.now ?? new Date();
  const byId = new Map<string, EvidenceItem>();
  for (const e of items) if (!byId.has(e.evidence_id)) byId.set(e.evidence_id, e);
  const byDim = new Map<EvidenceDimension, EvidenceItem[]>();
  for (const e of byId.values()) {
    const list = byDim.get(e.dimension) ?? [];
    list.push(e);
    byDim.set(e.dimension, list);
  }
  const claims: EvidenceClaim[] = [];
  for (const [dimension, list] of byDim) {
    const stale = list.filter((e) => isStale(e, now));
    const fresh = list.filter((e) => !isStale(e, now)).sort(compareEvidence);
    const current = fresh[0] ?? null;
    const key = current ? valueKey(current) : null;
    const supporting = fresh.slice(1).filter((e) => valueKey(e) === key || !SINGLE_VALUED.has(dimension));
    const conflicting = SINGLE_VALUED.has(dimension)
      ? fresh.slice(1).filter((e) => valueKey(e) !== key && e.status !== "unknown")
      : [];
    claims.push({
      dimension, current, supporting, conflicting, stale,
      sources: [...new Set(list.map((e) => e.source.actor))],
    });
  }
  claims.sort((a, b) => a.dimension.localeCompare(b.dimension));
  const known = new Set(claims.filter((c) => c.current && c.current.status !== "unknown").map((c) => c.dimension));
  return {
    version: EVIDENCE_GRAPH_VERSION, company_key, claims,
    gaps: [...new Set(opts.required ?? [])].filter((d) => !known.has(d)),
    conflicts: claims.filter((c) => c.conflicting.length > 0).map((c) => c.dimension),
    item_count: byId.size,
  };
}

/** The compact form a Workbench row and a checkpoint carry. */
export interface EvidenceGraphProjection {
  company_key: string;
  dimensions: Array<{
    dimension: EvidenceDimension;
    value: unknown;
    status: EvidenceItem["status"] | "stale";
    method: EvidenceItem["method"] | null;
    confidence: EvidenceItem["confidence"] | null;
    sources: string[];
    source_urls: string[];
    conflicting_values: unknown[];
    valid_until: string | null;
  }>;
  gaps: EvidenceDimension[];
  conflicts: EvidenceDimension[];
}

export function projectEvidenceGraph(g: CompanyEvidenceGraph): EvidenceGraphProjection {
  return {
    company_key: g.company_key,
    dimensions: g.claims.map((c) => ({
      dimension: c.dimension,
      value: c.current?.value ?? c.stale[0]?.value ?? null,
      status: c.current ? c.current.status : "stale",
      method: c.current?.method ?? null,
      confidence: c.current?.confidence ?? null,
      sources: c.sources,
      source_urls: [...new Set([c.current, ...c.supporting].map((e) => e?.source.url).filter((u): u is string => !!u))].slice(0, 5),
      conflicting_values: c.conflicting.map((e) => e.value).slice(0, 3),
      valid_until: c.current?.valid_until ?? null,
    })),
    gaps: g.gaps,
    conflicts: g.conflicts,
  };
}

// ── THE ENGINE'S EVIDENCE REGISTRY, READ AS CLAIMS ──────────────────────────
//
// The registry (`leadEvidenceRegistry.ts`) is what qualification cites: the
// enriched row, the cited job postings, fetched pages. It already holds every
// stage's facts for a company, so the graph reads it rather than asking each
// stage to write twice. A provider failure is not a negative fact and is not a
// claim.


const REGISTRY_DIMENSION: Readonly<Partial<Record<EvidenceType, Dim>>> = Object.freeze({
  // Identity is the union's (entityResolution), not a registry claim: the
  // registry's website/identity_match values are a different shape.
  company_description: "web_claim", company_industry: "industry",
  // The registry's `employee_count` is the LinkedIn record's `employeeCount`:
  // associated members, not staff (companySize.ts). Filed where it cannot
  // answer a size criterion.
  employee_count: "linkedin_member_count", linkedin_associated_members: "linkedin_member_count",
  company_size_band: "company_size_band", company_location: "geography", job_posting: "job", yc_job: "job",
  yc_company_record: "company_stage", funding_signal: "funding", expansion_signal: "expansion",
  launch_signal: "product_launch", web_page: "web_claim",
});

export function evidenceFromRegistry(r: EvidenceRegistry | null, missionId: string | null = null): EvidenceItem[] {
  if (!r) return [];
  const out: EvidenceItem[] = [];
  for (const it of r.items as RegistryItem[]) {
    const dimension = REGISTRY_DIMENSION[it.evidence_type];
    if (!dimension) continue;
    const observed = it.observed_at ?? new Date(0).toISOString();
    out.push({
      evidence_id: `reg_${it.evidence_id}`, company_key: r.company_key, dimension,
      value: it.structured_value ?? it.source_text,
      status: it.verification_state === "verified" ? "proven"
        : it.verification_state === "invalid" ? "unknown" : "plausible",
      source: {
        provider: it.evidence_type === "web_page" ? "firecrawl" : "apify", actor: it.source,
        provider_call_id: null, url: it.source_url, excerpt: it.source_text ? it.source_text.slice(0, 280) : null,
      },
      method: "provider_field", observed_at: observed,
      // The registry's own freshness: a stale item is past its validity now.
      valid_until: it.freshness === "stale" ? new Date(0).toISOString() : null,
      confidence: it.verification_state === "verified" ? "high" : "medium",
      derived_from: [], mission_id: missionId,
      origin: it.evidence_type === "web_page" ? "web" : "lead_mission",
    });
  }
  return out;
}

/** The evidence dimensions a mission's HARD criteria need proven. */
export function requiredEvidenceDimensions(
  policy: { dimensions: Record<ExecutionDimension, { hard_values: unknown[] }> } | null,
  signals: readonly string[] = [],
): Dim[] {
  const map: Record<ExecutionDimension, Dim | null> = {
    geography: "geography", industry: "industry", company_size: "company_size_band",
    company_stage: "company_stage", company_kind: null, exclusion: null,
  };
  const out = new Set<Dim>();
  for (const [d, a] of Object.entries(policy?.dimensions ?? {}) as Array<[ExecutionDimension, { hard_values: unknown[] }]>) {
    if (a.hard_values.length && map[d]) out.add(map[d]!);
  }
  for (const s of signals) {
    if (s === "hiring") out.add("hiring");
    else if (s === "funding") out.add("funding");
    else if (s === "expansion") out.add("expansion");
    else if (s === "product_launch") out.add("product_launch");
  }
  return [...out];
}
