// Apify discovery by a dated signal: employers with an open role.
//
// One `harvestapi/linkedin-job-search` run without a company filter (the Apify
// engine's job-first route, P3: every row carries the EMPLOYER's LinkedIn
// company record). Each posting is judged by the Apify engine's own rules before
// it can stand for anything:
//
//   closed posting                 dropped (jobIsOpen)
//   staffing agency / client role  dropped (jobEmployerAgencyReason, jobEmployerIdentityConflict)
//   wrong role or outside window   dropped (jobProvesRequestedHiring: titles are fuzzy)
//   no employer LinkedIn URL       dropped (nothing to verify it by)
//
// What survives becomes (a) one `ProviderCompany` row per employer — a discovery
// row, which proves nothing about HQ or size — and (b) the evidence items the
// Apify engine derives from a job row (observationFromCompany): proven identity
// and proven hiring, dated by the posting, so the shared engine can judge a
// window. HQ and size are left to the company record (canonical.ts).
//
// Spend: one run, reserved in the ledger by the caller's invoker, capped at its
// worst case. A failed run may have billed: it is counted and never retried.

import type { EvidenceItem } from "../candidateObservation.ts";
import { observationFromCompany } from "../candidateObservation.ts";
import {
  jobEmployerAgencyReason, jobEmployerIdentityConflict, jobEmployerToCompany, jobIsOpen, jobProvesRequestedHiring,
  normalizeLinkedInJob, requestedHiringFromSignals, type NormalizedHiringJob,
} from "../hiringActorNormalizers.ts";
import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { ProviderCompany, ProviderPerson } from "../discoveryProviders/types.ts";
import { SIGNAL_ACTORS, signalsFromPosts, worstCaseUsd, type Signal } from "./signals.ts";
import type { DiscoverySpec } from "./strategy.ts";

export const JOB_DISCOVERY_ROUTE = "lead_pipeline_job_discovery" as const;

export interface HiringDiscovery {
  companies: ProviderCompany[];
  /** Apify engine evidence per employer, keyed by LinkedIn company slug. */
  evidence: Map<string, EvidenceItem[]>;
  jobs: Map<string, NormalizedHiringJob[]>;
  rows: number;
  dropped: Record<string, number>;
  spentUsd: number;
  stopped: string | null;
  runId: string | null;
}

export const slugOf = (u: string | null | undefined) => /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(u ?? ""))?.[1]?.toLowerCase().replace(/\/+$/, "") ?? null;

function postedLimit(days: number | null): string {
  if (days != null && days <= 1) return "24h";
  if (days != null && days <= 7) return "week";
  return "month";
}

/** The run's input. Titles and locations follow the catalogued discovery limits (≤3 titles, ≤2 locations). */
export function jobDiscoveryInput(spec: DiscoverySpec, titles: string[], maxItems: number): Record<string, unknown> {
  const hiring = spec.signals.find((s) => s.kind === "hiring");
  return {
    jobTitles: titles.slice(0, 3),
    ...(spec.geography.length ? { locations: spec.geography.slice(0, 2) } : {}),
    postedLimit: postedLimit(hiring?.windowDays ?? null),
    sortBy: "date",
    maxItems,
  };
}

export async function discoverHiringCompanies(
  spec: DiscoverySpec, titles: string[], invoke: ActorInvoker | null,
  opts: { maxItems: number; maxUsd: number; now: Date; idPrefix: string; missionId?: string | null },
): Promise<HiringDiscovery> {
  const out: HiringDiscovery = { companies: [], evidence: new Map(), jobs: new Map(), rows: 0, dropped: {}, spentUsd: 0, stopped: null, runId: null };
  const drop = (why: string) => { out.dropped[why] = (out.dropped[why] ?? 0) + 1; };
  if (!invoke) { out.stopped = "apify_unavailable"; return out; }
  const worst = worstCaseUsd(SIGNAL_ACTORS.jobs, opts.maxItems);
  if (worst > opts.maxUsd + 1e-9) { out.stopped = "budget"; return out; }

  const hiring = spec.signals.find((s) => s.kind === "hiring");
  const requested = hiring ? requestedHiringFromSignals([{ role_families: hiring.roleFamilies, timeframe_days: hiring.windowDays, qualifier: { role_terms: hiring.roleTerms } }]) : null;
  let items: unknown[];
  try {
    const run = await invoke(SIGNAL_ACTORS.jobs.key, jobDiscoveryInput(spec, titles, opts.maxItems), { maxItems: opts.maxItems, idempotencyKey: `${opts.idPrefix}:${SIGNAL_ACTORS.jobs.key}:discovery` });
    items = run.items;
    out.runId = run.runId ?? null;
    out.spentUsd = run.chargedUsd ?? (items.length ? worstCaseUsd(SIGNAL_ACTORS.jobs, items.length) : SIGNAL_ACTORS.jobs.perStartUsd);
  } catch (e) {
    out.spentUsd = worst;
    out.stopped = `job search failed (${(e as Error)?.name ?? "error"}); counted at its worst case, not retried`;
    return out;
  }

  const at = opts.now.toISOString();
  const employers = new Map<string, { row: Record<string, unknown>; jobs: NormalizedHiringJob[] }>();
  for (const raw of items) {
    out.rows++;
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!jobIsOpen(r)) { drop("closed_posting"); continue; }
    if (jobEmployerAgencyReason(r)) { drop("staffing_agency"); continue; }
    if (jobEmployerIdentityConflict(r)) { drop("employer_conflict_or_client_posting"); continue; }
    const job = normalizeLinkedInJob(r);
    if (!jobProvesRequestedHiring(job, requested, opts.now)) { drop("role_or_window_mismatch"); continue; }
    const slug = slugOf(((r.company ?? {}) as Record<string, unknown>).linkedinUrl as string);
    if (!slug) { drop("no_employer_linkedin"); continue; }
    const e = employers.get(slug) ?? { row: r, jobs: [] };
    e.jobs.push(job);
    employers.set(slug, e);
  }

  for (const [slug, { row, jobs }] of employers) {
    const norm = jobEmployerToCompany(row);
    if (!norm) { drop("no_employer_linkedin"); continue; }
    const obs = observationFromCompany(norm, {
      capability: "job_discovery", actor_key: SIGNAL_ACTORS.jobs.key, provider: "apify", route_id: JOB_DISCOVERY_ROUTE,
      plan_version: null, provider_call_id: out.runId, mission_id: opts.missionId ?? null, observed_at: at,
    }, jobs);
    // The posting IS the event: date the hiring evidence by the newest proving posting,
    // so a window ("last 30 days") is judged on when the role was posted, never on when we looked.
    const newest = jobs.map((j) => j.posted_date).filter((d): d is string => !!d && Number.isFinite(Date.parse(d))).sort().at(-1) ?? null;
    const evidence = obs.evidence
      // A discovery row proves neither HQ nor size: the company record decides those.
      .filter((ev) => ev.dimension !== "geography" && ev.dimension !== "company_size_band" && ev.dimension !== "linkedin_member_count")
      .map((ev) => (ev.dimension === "hiring" || ev.dimension === "job") && newest ? { ...ev, occurred_at: ev.dimension === "job" ? ((ev.value as { posted_date?: string })?.posted_date ?? newest) : newest } : ev);
    out.evidence.set(slug, evidence);
    out.jobs.set(slug, jobs);
    out.companies.push({
      provider: "apify", recordId: norm.external_source_id, retrievedAt: at,
      name: norm.company_name, domain: norm.canonical_domain, linkedinUrl: norm.linkedin_company_url,
      industry: norm.provider_industry ? [norm.provider_industry] : null,
      assertedFilters: [], ignoredFilters: [],
    });
  }
  return out;
}

// ── Ported from PR #198 (discoveryEngine/sources/apify.ts): parsers for catalogued
// actors that are NOT on the pipeline allowlist. The planner marks their capabilities
// `not_approved` and the ledgered invoker refuses their actor keys, so these run only
// after a reviewed change adds the actor to PIPELINE_ACTORS. The catalogue's defects
// are enforced here, not left to the caller.


export const POST_SEARCH_ACTOR = "apify_linkedin_post_search" as const;
export const COMPANY_EMPLOYEES_ACTOR_KEY = "apify_linkedin_company_employees" as const;

export function postPostedLimit(days: number | null): string | null {
  if (days == null) return null;
  return days <= 1 ? "24h" : days <= 7 ? "week" : days <= 31 ? "month" : days <= 92 ? "3months" : days <= 183 ? "6months" : "year";
}

/**
 * Post-search rows → the companies whose OWN page posted (identity proven by the
 * page) plus a dated post signal each, for ranking. A post by a person names no
 * company: a headline is not employment (catalogue defect), so it is skipped.
 */
export function companiesFromPostRows(items: readonly unknown[], opts: { now: Date; windowDays: number; runId: string | null; missionId?: string | null }): HiringDiscovery & { signals: Signal[] } {
  const out: HiringDiscovery & { signals: Signal[] } = { companies: [], evidence: new Map(), jobs: new Map(), rows: 0, dropped: {}, spentUsd: 0, stopped: null, runId: opts.runId, signals: [] };
  const drop = (why: string) => { out.dropped[why] = (out.dropped[why] ?? 0) + 1; };
  const at = opts.now.toISOString();
  for (const it of items) {
    out.rows++;
    const row = (it ?? {}) as Record<string, unknown>;
    if (row.type && row.type !== "post") { drop("not_a_post"); continue; }
    const author = (row.author ?? {}) as Record<string, unknown>;
    if (author.type !== "company") { drop("person_author_names_no_company"); continue; }
    const slug = slugOf(author.linkedinUrl as string);
    if (!slug) { drop("no_company_linkedin"); continue; }
    const url = `https://www.linkedin.com/company/${slug}`;
    const sig = signalsFromPosts([row], { kind: "company", key: `li:${slug}` }, SIGNAL_ACTORS.companyPosts, { chargedUsd: null }, opts.now, opts.windowDays);
    out.signals.push(...sig);
    if (out.evidence.has(slug)) continue;
    out.companies.push({ provider: "apify", recordId: `li_company:${slug}`, retrievedAt: at, name: typeof author.name === "string" ? author.name : null, linkedinUrl: url, assertedFilters: [], ignoredFilters: [] });
    out.evidence.set(slug, [{
      evidence_id: `post_identity_${slug}`.slice(0, 64), company_key: null, dimension: "identity",
      value: { linkedin_company_url: url, domain: null, name: author.name ?? null }, status: "proven",
      source: { provider: "apify", actor: POST_SEARCH_ACTOR, provider_call_id: opts.runId, url, excerpt: null },
      method: "provider_field", observed_at: at, valid_until: null, confidence: "high", derived_from: [], mission_id: opts.missionId ?? null, origin: "lead_mission",
    } as EvidenceItem]);
  }
  return out;
}

export async function discoverPostingCompanies(
  spec: DiscoverySpec, topics: string[], invoke: ActorInvoker | null,
  opts: { maxItems: number; maxUsd: number; now: Date; idPrefix: string; missionId?: string | null; perItemUsd: number; perStartUsd: number },
): Promise<HiringDiscovery & { signals: Signal[] }> {
  const empty = (stopped: string) => ({ ...companiesFromPostRows([], { now: opts.now, windowDays: 90, runId: null }), stopped });
  if (!invoke) return empty("apify_unavailable");
  if (!topics.length) return empty("no post topic");
  const per = Math.max(1, Math.floor(opts.maxItems / topics.length));
  const worst = opts.perStartUsd + opts.perItemUsd * per * topics.length;
  if (worst > opts.maxUsd + 1e-9) return empty("budget");
  const s = spec.signals.find((x) => x.kind === "social_activity");
  const posted = postPostedLimit(s?.windowDays ?? null);
  try {
    const run = await invoke(POST_SEARCH_ACTOR, { searchQueries: topics, maxPosts: per, ...(posted ? { postedLimit: posted } : {}), sortBy: "date", profileScraperMode: "short", scrapeComments: false, scrapeReactions: false },
      { maxItems: per * topics.length, idempotencyKey: `${opts.idPrefix}:${POST_SEARCH_ACTOR}:discovery` });
    const out = companiesFromPostRows(run.items, { now: opts.now, windowDays: s?.windowDays ?? 90, runId: run.runId ?? null, missionId: opts.missionId });
    out.spentUsd = run.chargedUsd ?? (opts.perStartUsd + opts.perItemUsd * run.items.length);
    return out;
  } catch (e) {
    return { ...empty(`post search failed (${(e as Error)?.name ?? "error"}); counted at its worst case, not retried`), spentUsd: worst };
  }
}

/**
 * Company-employees rows → decision-maker people at the seed companies. A person
 * counts only through a CURRENT position at a seed company (matched by LinkedIn
 * company slug); their linkedinUrl is an opaque member id, never a vanity URL.
 */
export function peopleFromEmployeeRows(items: readonly unknown[], seedSlugs: ReadonlySet<string>, at: string): ProviderPerson[] {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const out: ProviderPerson[] = [];
  for (const it of items) {
    const p = (it ?? {}) as Record<string, unknown>;
    const pos = (Array.isArray(p.currentPositions) ? p.currentPositions as Record<string, unknown>[] : [])
      .find((x) => x.current !== false && seedSlugs.has(slugOf(x.companyLinkedinUrl as string) ?? ""));
    if (!pos) continue;
    const slug = slugOf(pos.companyLinkedinUrl as string)!;
    out.push({
      provider: "apify", recordId: `li_member:${p.id ?? p.linkedinUrl}`, retrievedAt: at,
      fullName: s(p.fullName) ?? ([s(p.firstName), s(p.lastName)].filter(Boolean).join(" ") || null), firstName: s(p.firstName),
      title: s(pos.title), linkedinUrl: s(p.linkedinUrl),
      company: { provider: "apify", recordId: `li_company:${slug}`, retrievedAt: at, name: s(pos.companyName), linkedinUrl: `https://www.linkedin.com/company/${slug}` },
      employerIsCurrent: true,
    });
  }
  return out;
}

/** The company-employees input, with the catalogue's exact Short-mode value (any other value bills the Full price). */
export function companyEmployeesInput(companyUrls: string[], roles: string[], perCompany: number): Record<string, unknown> {
  return { companies: companyUrls, jobTitles: roles.slice(0, 10), profileScraperMode: "Short ($4 per 1k)", maxItems: perCompany * companyUrls.length, maxItemsPerCompany: perCompany, companyBatchMode: "all_at_once" };
}
