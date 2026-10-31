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
import type { ProviderCompany } from "../discoveryProviders/types.ts";
import { SIGNAL_ACTORS, worstCaseUsd } from "./signals.ts";
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
