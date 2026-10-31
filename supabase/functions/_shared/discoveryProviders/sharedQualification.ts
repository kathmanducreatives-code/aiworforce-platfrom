// ONE QUALIFICATION ENGINE FOR EVERY DISCOVERY PROVIDER.
//
// `verify.ts` checks a merged record against the provider-facing requirements
// and reports what each provider SAID. That is a diagnostic, not a verdict: a
// LeadOcean `hq_country` or an Apollo `estimated_num_employees` is a discovery
// row's claim, and Agentory's hard rules (`candidateEligibility.ts`, Q1–Q4 and
// every canary fix since) do not let a discovery row prove anything.
//
// This module puts the providers' records into the SAME evidence model the
// Apify engine uses and lets the SAME engine decide:
//
//   CanonicalCompany claims + site evidence
//     → EvidenceItems, status weighed by `authorityForEvidence`
//       (source = "<provider>_discovery": named by no proving rule, so at
//        most `plausible`; a rule added there later applies here unchanged)
//     → `buildCompanyEvidenceGraph`
//     → `evaluateEligibility(the compiler's own criteria, graph, …, holds)`
//
// Evidence a provider cannot supply — the company record read after identity
// resolution, the canonical funding pair, dated job postings — comes from the
// Apify engine through `canonicalEvidence`, the documented boundary between
// the two (docs/PROVIDER_DISCOVERY_SHARED_QUALIFICATION.md). Without it a
// provider-only lead is `pending`, which is the truth.
//
// Pure. No network, no clock beyond the caller's `now`.

import { buildCompanyEvidenceGraph, type CompanyEvidenceGraph } from "../evidenceGraph.ts";
import { evaluateEligibility, type EligibilityResult } from "../candidateEligibility.ts";
import { EVIDENCE_VALIDITY_DAYS, type EvidenceDimension, type EvidenceItem } from "../candidateObservation.ts";
import {
  authorityForEvidence, authorityRecord, statusForAuthority, type AuthorityClaim, type AuthorityField,
} from "../evidenceAuthority.ts";
import type { MissionCriterion } from "../missionCriteria.ts";
import type { QualificationHold } from "../qualificationHold.ts";
import { sha256Hex } from "../providerInputFingerprint.ts";
import type { SiteEvidence } from "./adapters/apify.ts";
import type { CanonicalCompany } from "./normalize.ts";
import type { Claim, ProviderId } from "./types.ts";

export const SHARED_QUALIFICATION_VERSION = "discovery-shared-qualification-v1" as const;

/** The authority source key for a provider's discovery rows. No AUTHORITY_RULES entry names one. */
export const discoverySource = (p: ProviderId): string => `${p}_discovery`;
/** The authority source key for the provider layer's own website / open-roles checks. */
export const SITE_CHECK_SOURCE = "apify_discovery_site_check";

export interface SharedQualificationInput {
  /** The compiled mission's criteria, exactly as the compiler emitted them. */
  criteria: readonly MissionCriterion[];
  missionId: string | null;
  now: Date;
  /**
   * Evidence the Apify engine already holds for this company (company record,
   * funding pair, job postings), keyed by the company's domain. Read-only here.
   */
  canonicalEvidence?: (company: { key: string; domains: string[]; linkedinUrls: string[] }) => readonly EvidenceItem[];
  /** Qualification holds the platform placed (historical outreach, CRM relationship, existing Lead). */
  holds?: (company: { key: string; domains: string[] }) => readonly QualificationHold[];
}

export interface SharedQualification {
  version: typeof SHARED_QUALIFICATION_VERSION;
  eligibility: EligibilityResult["eligibility"];
  hard_checks: EligibilityResult["hard_checks"];
  disproven: string[];
  gaps: EvidenceDimension[];
  held: string[];
  /** One line per hard check, for the lead drawer and the run report. */
  checks: { criterion_id: string; dimension: string; result: string; reason: string; actor: string | null }[];
  /** How many items came from each source: shows at a glance what the verdict rests on. */
  evidence_sources: Record<string, number>;
  /** Canonical evidence offered for this company but refused, and why. */
  canonical_refused: { count: number; reason: string } | null;
}

const DAY = 86_400_000;

function itemFrom(
  c: Claim, company_key: string, missionId: string | null, dimension: EvidenceDimension, value: unknown,
  weigh: { claim: AuthorityClaim; field: AuthorityField } | null, now: Date, source: string,
): EvidenceItem {
  const observed_at = c.retrievedAt;
  const decision = weigh
    ? authorityForEvidence({ claim: weigh.claim, source, field: weigh.field, observed_at, now })
    : null;
  const days = EVIDENCE_VALIDITY_DAYS[dimension];
  const t = Date.parse(observed_at);
  return {
    evidence_id: `ev_${sha256Hex(JSON.stringify([source, c.provider, c.recordId, c.sourceField, dimension, value])).slice(0, 24)}`,
    company_key,
    dimension,
    value,
    // Identity is "this record names this domain / profile", which the row
    // does say. Every other dimension's status is the authority layer's.
    status: decision ? statusForAuthority(decision.authority) : "proven",
    source: { provider: c.provider, actor: source, provider_call_id: null, url: null, excerpt: null },
    method: "provider_field",
    observed_at,
    valid_until: days == null || !Number.isFinite(t) ? null : new Date(t + days * DAY).toISOString(),
    confidence: decision?.authority === "proven" ? "high" : decision ? "low" : "medium",
    derived_from: [`${c.provider}:${c.recordId}:${c.sourceField}`],
    mission_id: missionId,
    origin: "lead_mission",
    ...(decision ? { authority: authorityRecord(decision) } : {}),
  };
}

function place(city: string | undefined, region: string | undefined, country: string | undefined): string | null {
  const parts = [city, region, country].map((x) => (x ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Every provider claim about a merged company, as evidence items in the shared model. */
export function evidenceFromCompany(
  c: CanonicalCompany, site: readonly SiteEvidence[], missionId: string | null, now: Date,
): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  const src = (cl: Claim) => discoverySource(cl.provider);
  // Identity: one item per provider record that names a domain or profile.
  const byRecord = new Map<string, { claim: Claim; domain: string | null; li: string | null; name: string | null }>();
  const touch = (cl: Claim) => {
    const k = `${cl.provider}:${cl.recordId}`;
    return byRecord.get(k) ?? byRecord.set(k, { claim: cl, domain: null, li: null, name: null }).get(k)!;
  };
  for (const cl of c.domain) touch(cl).domain = cl.value;
  for (const cl of c.linkedinUrl) touch(cl).li = cl.value;
  for (const cl of c.name) touch(cl).name = cl.value;
  for (const r of byRecord.values()) {
    if (!r.domain && !r.li) continue;
    out.push(itemFrom(r.claim, c.key, missionId, "identity",
      { linkedin_company_url: r.li, domain: r.domain, name: r.name }, null, now, src(r.claim)));
  }
  // Headquarters: one item per provider record, as that record states it.
  const hq = new Map<string, { claim: Claim; city?: string; region?: string; country?: string }>();
  const at = (cl: Claim) => hq.get(`${cl.provider}:${cl.recordId}`) ?? hq.set(`${cl.provider}:${cl.recordId}`, { claim: cl }).get(`${cl.provider}:${cl.recordId}`)!;
  for (const cl of c.hqCountry) at(cl).country = cl.value;
  for (const cl of c.hqRegion) at(cl).region = cl.value;
  for (const cl of c.hqCity) at(cl).city = cl.value;
  for (const h of hq.values()) {
    const v = place(h.city, h.region, h.country);
    if (v) out.push(itemFrom(h.claim, c.key, missionId, "geography", v, { claim: "headquarters", field: "headquarters_flag" }, now, src(h.claim)));
  }
  // Size: a provider's range is a band claim; a bare count is an estimate, never a band and never staff.
  for (const cl of c.employeeRange) {
    if (cl.value.min === null) continue;
    out.push(itemFrom(cl, c.key, missionId, "company_size_band", { min: cl.value.min, max: cl.value.max },
      { claim: "company_size", field: "declared_size_band" }, now, src(cl)));
  }
  for (const cl of c.employeeCount) {
    out.push(itemFrom(cl, c.key, missionId, "headcount", cl.value, { claim: "headcount", field: "declared_size_band" }, now, src(cl)));
  }
  for (const cl of c.industry) {
    for (const v of cl.value) {
      out.push(itemFrom({ ...cl, sourceField: `${cl.sourceField}:${v}` }, c.key, missionId, "industry", v,
        { claim: "industry", field: "industry_taxonomy" }, now, src(cl)));
    }
  }
  // Funding: the provider's statement of an EVENT. Deliberately NOT the
  // canonical funding_record shape (fundingCorroboration.fundingRecordsInGraph
  // reads only that, from the funding pair), so a provider round can never
  // enter decideRecentlyFunded; weighed as a funding claim it is at most
  // plausible. occurred_at is set only from a full date — a year is not a date.
  for (const cl of c.funding) {
    const it = itemFrom(cl, c.key, missionId, "funding", { provider_funding: cl.value },
      { claim: "recently_funded", field: "funding_record" }, now, src(cl));
    out.push(cl.value.roundDate ? { ...it, occurred_at: cl.value.roundDate } : it);
  }
  // The provider layer's own site checks: an undated open-roles count and
  // site text. Neither is a dated posting nor a grounded statement, so the
  // authority layer keeps both below proof.
  for (const s of site) {
    const cl: Claim = { value: null, provider: "apify", recordId: s.runId ?? `${s.kind}:${s.domain}`, sourceField: s.kind, retrievedAt: s.at };
    if (s.kind === "open_roles" && (s.count ?? 0) > 0) {
      out.push(itemFrom(cl, c.key, missionId, "hiring", true, { claim: "open_role", field: "profile_text" }, now, SITE_CHECK_SOURCE));
    }
    if (s.kind === "site_text" && s.text) {
      out.push(itemFrom(cl, c.key, missionId, "web_claim", s.text.slice(0, 280), { claim: "business_model", field: "profile_text" }, now, SITE_CHECK_SOURCE));
    }
  }
  return out;
}

/** The shared engine's verdict on one merged company. */
export function qualifyCompany(
  c: CanonicalCompany, site: readonly SiteEvidence[], input: SharedQualificationInput,
): SharedQualification {
  const ids = {
    key: c.key,
    domains: [...new Set(c.domain.map((d) => d.value))],
    linkedinUrls: [...new Set(c.linkedinUrl.map((d) => d.value))],
  };
  const own = evidenceFromCompany(c, site, input.missionId, input.now);
  // ── ANOTHER COMPANY'S EVIDENCE IS NOT THIS COMPANY'S (audit G04) ────────
  // Canonical evidence is admitted only when it carries a PROVEN identity
  // item naming one of this company's own domains or LinkedIn URLs, so a
  // boundary lookup that resolved to the wrong company cannot lend it facts.
  const offered = input.canonicalEvidence?.(ids) ?? [];
  const matches = offered.some((e) => e.dimension === "identity" && e.status === "proven" && identityMatches(e.value, ids));
  const canonical = matches ? offered.map((e) => ({ ...e, company_key: c.key })) : [];
  const canonical_refused = offered.length && !matches
    ? { count: offered.length, reason: identityConflict(offered, ids)
      ? "identity conflict: the company record's LinkedIn profile matches, but its website names a different domain"
      : "no proven identity item names this company's domain or LinkedIn URL" } : null;
  const graph: CompanyEvidenceGraph = buildCompanyEvidenceGraph(c.key, [...own, ...canonical], { now: input.now });
  const r = evaluateEligibility(input.criteria, graph, undefined, input.holds?.(ids) ?? []);
  const actorOf = (id: string | undefined) => [...own, ...canonical].find((e) => e.evidence_id === id)?.source.actor ?? null;
  const sources: Record<string, number> = {};
  for (const e of [...own, ...canonical]) sources[e.source.actor] = (sources[e.source.actor] ?? 0) + 1;
  return {
    version: SHARED_QUALIFICATION_VERSION,
    eligibility: r.eligibility,
    hard_checks: r.hard_checks,
    disproven: r.disproven,
    gaps: r.gaps,
    held: r.held.map((h) => h.code),
    checks: r.checks.filter((x) => x.kind === "hard").map((x) => ({
      criterion_id: x.criterion_id, dimension: String(x.dimension), result: x.result, reason: x.reason,
      actor: x.provenance?.actor ?? actorOf(x.evidence_ids[0]),
    })),
    evidence_sources: sources,
    canonical_refused,
  };
}

const bareDomain = (v: unknown) => String(v ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0] || null;
const liSlug = (v: unknown) => /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(v ?? ""))?.[1].toLowerCase().replace(/\/+$/, "") ?? null;

function identityMatches(v: unknown, ids: { domains: string[]; linkedinUrls: string[] }): boolean {
  if (!v || typeof v !== "object") return false;
  const r = v as { domain?: unknown; linkedin_company_url?: unknown };
  const d = bareDomain(r.domain);
  const li = liSlug(r.linkedin_company_url);
  return identityVerdict(d, li, ids) === "match";
}

/**
 * Identity verification: does the record describe THIS company?
 *   match     the record names one of the company's domains, or its LinkedIn
 *             profile while naming no different website
 *   conflict  the LinkedIn profile matches but the record's own website is a
 *             DIFFERENT domain than every one the discovery rows gave — two
 *             companies, or a stale profile; either way the record decides
 *             nothing about this one (it stays pending, never rejected)
 *   none      nothing in the record names this company
 */
function identityVerdict(d: string | null, li: string | null, ids: { domains: string[]; linkedinUrls: string[] }): "match" | "conflict" | "none" {
  const domainMatch = !!d && ids.domains.some((x) => bareDomain(x) === d);
  if (domainMatch) return "match";
  const liMatch = !!li && ids.linkedinUrls.some((x) => liSlug(x) === li);
  if (!liMatch) return "none";
  return d && ids.domains.length ? "conflict" : "match";
}

function identityConflict(offered: readonly EvidenceItem[], ids: { domains: string[]; linkedinUrls: string[] }): boolean {
  return offered.some((e) => {
    if (e.dimension !== "identity" || e.status !== "proven" || !e.value || typeof e.value !== "object") return false;
    const r = e.value as { domain?: unknown; linkedin_company_url?: unknown };
    return identityVerdict(bareDomain(r.domain), liSlug(r.linkedin_company_url), ids) === "conflict";
  });
}

/** The compiler's criteria from a compiled mission, untouched. */
export function sharedCriteria(mission: { criteria?: unknown[] } | null | undefined): MissionCriterion[] {
  return (mission?.criteria ?? []).filter((c): c is MissionCriterion =>
    !!c && typeof c === "object" && typeof (c as MissionCriterion).id === "string" && typeof (c as MissionCriterion).kind === "string");
}
