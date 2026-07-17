// run-agent ↔ jobs-signal bridge (Phase B). Pure glue: builds SignalCandidates
// from run-agent's post-company-enrichment state, adapts the canonical
// source_with_apify jobs path as the injected executor, and exposes the timing
// verdicts run-agent threads into the EXISTING final-state reducer. No second
// qualification system; timing_sufficient never means qualify_now.

import {
  runJobsSignalEnrichment,
  type SignalActorExecutor, type SignalActorExecuteArgs, type SignalActorExecuteResult,
  type SignalCandidate, type JobsSignalRunResult,
} from "./jobsSignalOrchestrator.ts";
import { classifyGtmRole, JOBS_ACTOR_KEY, JOBS_ACTOR_ID, type NormalizedJobLike } from "./jobsSignalAdapter.ts";
import type { EnrichmentClock } from "./companyEnrichmentOrchestrator.ts";
import type { EvidenceContract } from "./evidenceContract.ts";
import type { EvidenceSufficiencyResult } from "./evidenceSufficiency.ts";
import type { TimingAssessment } from "./timingAssessment.ts";

export { runJobsSignalEnrichment };
export type { SignalCandidate, JobsSignalRunResult };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** GTM role keywords the jobs actor is asked to search for (bounds cost/noise). */
export const GTM_ROLE_KEYWORDS = [
  "sales", "account executive", "business development", "revenue operations", "revops",
  "sales operations", "go-to-market", "growth", "demand generation",
];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : null));

/** Canonical company identity for grouping/lookup: LinkedIn URL → domain → name. */
export function companyKeyForItem(raw: Row): string | null {
  const url = str(raw.company_linkedin_url) ?? str(raw.companyLinkedinUrl);
  if (url) { const m = url.match(/\/company\/([^/?#]+)/i); if (m) return `li:linkedin.com/company/${m[1].toLowerCase()}`; }
  const domain = str(raw.domain) ?? str(raw.company_website) ?? str(raw.website);
  if (domain) { try { const h = new URL(/^https?:/.test(domain) ? domain : `https://${domain}`).host.replace(/^www\./, ""); if (h) return `dom:${h.toLowerCase()}`; } catch { /* ignore */ } }
  const name = str(raw.company) ?? str(raw.companyName);
  if (name) return `name:${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  return null;
}

export interface BuildSignalCandidatesArgs {
  // deno-lint-ignore no-explicit-any
  items: any[];
  candidateIdOf: (item: Row) => string;
  sufficiencyByCandidate: Map<string, EvidenceSufficiencyResult>;
  hardBlockedIds?: Set<string>;
}

/** Map run-agent accepted items into SignalCandidates using the post-enrichment
 * sufficiency verdicts. Candidates with no groundable company are still included
 * (companyKey null) so they are planned + staged truthfully — never looked up. */
export function buildSignalCandidates(args: BuildSignalCandidatesArgs): SignalCandidate[] {
  return (args.items ?? []).map((item) => {
    const raw = (item?.raw ?? {}) as Row;
    const id = args.candidateIdOf(item);
    const suff = args.sufficiencyByCandidate.get(id);
    return {
      candidateId: id,
      companyKey: companyKeyForItem(raw),
      companyLinkedInUrl: str(raw.company_linkedin_url) ?? str(raw.companyLinkedinUrl),
      companyName: str(item?.company) ?? str(raw.company) ?? str(raw.companyName),
      personRef: str(item?.source_url) ?? str(raw.profile_url) ?? id,
      // Absent post-enrichment sufficiency ⇒ treat identity/fit as unsettled so we
      // never spend a signal lookup on an unverified candidate.
      sufficiency: suff ?? ({ identityComplete: false, fitComplete: false, nextDecision: "structured_company_enrichment" } as unknown as EvidenceSufficiencyResult),
      hardBlocked: args.hardBlockedIds?.has(id) === true,
      existingSignals: [],
    } satisfies SignalCandidate;
  });
}

// ------------------------------------------------ real executor adapter -------

// deno-lint-ignore no-explicit-any
export type RunToolFn = (tool: string, input: unknown, ctx: any) => Promise<{ ok?: boolean; data?: any; error?: unknown; unavailable?: boolean }>;

/** Tolerantly map one source_with_apify job item into the adapter's NormalizedJobLike. */
export function toNormalizedJob(it: Row): NormalizedJobLike {
  const raw = (it?.raw && typeof it.raw === "object") ? it.raw as Row : it;
  return {
    company: str(it.company) ?? str(raw.companyName) ?? str(raw.company),
    jobTitle: str(it.job_title) ?? str(it.title) ?? str(raw.title) ?? str(raw.jobTitle),
    linkedinUrl: str(it.company_linkedin_url) ?? str(raw.companyLinkedinUrl) ?? str(raw.company_linkedin_url),
    website: str(it.company_website) ?? str(it.website) ?? str(raw.companyWebsite),
    jobUrl: str(it.job_url) ?? str(it.url) ?? str(it.source_url) ?? str(raw.link) ?? str(raw.jobUrl),
    postedAt: str(it.posted_at) ?? str(raw.postedAt) ?? str(raw.postedDate) ?? str(raw.listedAt) ?? str(raw.publishedAt),
    seniorityLevel: str(it.seniority_level) ?? str(raw.seniorityLevel),
    raw,
  };
}

/**
 * Adapt the canonical source_with_apify JOBS path (actor apify_jobs /
 * curious_coder/linkedin-jobs-scraper) into the injected signal executor. Actor
 * identity is fixed here — never from user/tool/planner/model. Only GTM-hiring
 * roles for the specific company are requested; results become NormalizedJobLike[].
 */
export function makeJobsSignalExecutor(runTool: RunToolFn, ctx: unknown, opts: { allowDisabled?: boolean } = {}): SignalActorExecutor {
  return async (a: SignalActorExecuteArgs): Promise<SignalActorExecuteResult> => {
    try {
      const rr = await runTool("source_with_apify", {
        tool_name: "source_with_apify",
        selected_actor_key: JOBS_ACTOR_KEY,   // registry resolves the actor_id; never a caller value
        source_type: "jobs",
        input: {
          companyName: a.companyName ?? undefined,
          companyLinkedInUrl: a.companyLinkedInUrl ?? undefined,
          keywords: GTM_ROLE_KEYWORDS.join(" OR "),
        },
        role_keywords: GTM_ROLE_KEYWORDS,
        max_results: Math.max(1, a.maxItems ?? 10),
        defer_persistence: true,
        ...(opts.allowDisabled ? { allow_disabled: true } : {}),
      }, ctx);
      if (rr && rr.ok && rr.data) {
        const items: Row[] = Array.isArray(rr.data.items) ? rr.data.items : [];
        // Only keep GTM-hiring roles; the adapter re-checks, this just trims payload.
        const jobs = items.map(toNormalizedJob).filter((j) => !!classifyGtmRole(j.jobTitle));
        return { items: jobs, providerRunId: str(rr.data.run_id) ?? undefined };
      }
      return { error: (rr && rr.error) ?? "apify_failed" };
    } catch (e) { return { error: e }; }
  };
}

// ------------------------------------------------- timing → run-agent ---------

/** True when timing is required and this candidate has NOT established it — the
 * persistence gate must force-stage (missing) or the reducer will reject
 * (contradicted). timing_sufficient does NOT force-accept. */
export function timingStagesCandidate(t: TimingAssessment | undefined): boolean {
  if (!t) return false;
  return t.decision === "missing_timing_evidence" || t.decision === "timing_contradicted";
}
