// LEAD V2 — THE HARD "CURRENTLY HIRING <ROLE>" CLAIM, VERIFIED LIKE ANY OTHER.
//
// Hiring used to be an in-slice graph stage that bought a LinkedIn job search
// for EVERY identity-resolved company, before country, size, business model or
// funding had been grounded. A company that had already failed on country still
// paid for a job search, and the search asked for a whole sales vocabulary
// whatever the role (pre-canary compile, 2026-09-24).
//
// Here it is a claim verifier in the verification phase, so it obeys the same
// discipline as the funding and business-model verifiers:
//
//   targeted by the gap router     only PENDING candidates whose hard `hiring`
//                                  claim is open, and only once every cheap hard
//                                  claim (country, size band) is settled
//   re-grounded between verifiers  a candidate a cheaper verifier disproved is
//                                  never a target here
//   ordered by its real estimate   `estimate_per_target_usd` from the card and
//                                  the actual title keywords, not a static hint
//   bought through the spine       ProviderCallSpec → reservation → guard →
//                                  settlement, via `deps.call`
//
// WHAT COUNTS AS AN ANSWER. The provider's title matching is fuzzy (card
// warning), so every returned posting passes a deterministic role test — the
// requested family's own matcher — and the mission's posting window. A matching
// posting is PROVEN open-role evidence (`job_evidence` authority). No matching
// posting on LinkedIn is NOT a disproof — a company may hire elsewhere — so the
// claim stays PENDING, answered, and is not bought again this mission.
//
// Pure apart from `deps.call`.

import type { ClaimVerifier, VerificationTarget, VerifierDeps, VerifierFinding } from "./claimVerifier.ts";
import type { EvidenceItem } from "./candidateObservation.ts";
import { EVIDENCE_VALIDITY_DAYS } from "./candidateObservation.ts";
import { authorityForEvidence, authorityRecord } from "./evidenceAuthority.ts";
import { compileHarvestJobSearchInput } from "./hiringActorInputs.ts";
import { normalizeLinkedInJob, type NormalizedHiringJob } from "./hiringActorNormalizers.ts";
import { normalizeCompanyLinkedInUrl } from "./structuredCompanyEnrichment.ts";
import { estimateCallUsd } from "./budgetPolicy.ts";
import { hiringActorCard } from "./hiringActorCatalog.ts";

export const HIRING_CLAIM_VERIFIER_KEY = "open_role_linkedin_jobs" as const;
export const HIRING_ROUTE_ACTOR = "apify_linkedin_job_search" as const;
/** Job rows asked per company — the same evidence standard the in-slice stage used. */
export const HIRING_ROWS_PER_COMPANY = 10;
/** Companies per slice; one call carries them all (the actor takes up to 10). */
export const HIRING_MAX_TARGETS = 5;

export interface HiringVerifierIO {
  /** The title KEYWORDS to search — the requested role family, already covering-reduced. */
  titles: readonly string[];
  /** The requested role, as a deterministic test on a posting title. */
  matchesRole: (title: string) => boolean;
  /** The role family names the claim asked for, recorded on the evidence. */
  role_families: readonly string[];
  /** The hiring window in days (the criterion's), or null for none. */
  window_days: number | null;
  now?: () => Date;
}

/** The provider's posting-date filter for a window. The enum is 1h | 24h | week | month. */
function postedLimitFor(days: number | null): string | undefined {
  if (days == null) return undefined;
  if (days <= 1) return "24h";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return undefined;
}

/** The input for these companies, compiled against the card's contract. */
export function hiringVerifierInput(io: Pick<HiringVerifierIO, "titles" | "window_days">, companyUrls: readonly string[]):
  Record<string, unknown> | null {
  const postedLimit = postedLimitFor(io.window_days);
  const r = compileHarvestJobSearchInput({
    company: [...companyUrls], jobTitles: [...io.titles],
    maxItems: HIRING_ROWS_PER_COMPANY * companyUrls.length,
    ...(postedLimit ? { postedLimit } : {}),
  } as never) as { ok?: boolean; input?: Record<string, unknown> };
  return r.ok === false || !r.input ? null : r.input;
}

/** The card's price for asking about ONE company with these titles — the ordering estimate. */
export function hiringEstimatePerTargetUsd(io: Pick<HiringVerifierIO, "titles" | "window_days">): number | null {
  const input = hiringVerifierInput(io, ["https://www.linkedin.com/company/estimate"]);
  const card = hiringActorCard(HIRING_ROUTE_ACTOR);
  if (!input || !card) return null;
  return estimateCallUsd(HIRING_ROUTE_ACTOR, card.cost_model, input);
}

function withinWindow(job: NormalizedHiringJob, days: number | null, now: Date): boolean {
  if (days == null || !job.posted_date) return true;
  const t = Date.parse(job.posted_date);
  return !Number.isFinite(t) || now.getTime() - t <= days * 86_400_000;
}

function openRoleItem(t: VerificationTarget, jobs: NormalizedHiringJob[], io: HiringVerifierIO,
  providerCallId: string, observedAt: string, missionId: string | null): EvidenceItem {
  const a = authorityForEvidence({
    claim: "open_role", source: HIRING_ROUTE_ACTOR, field: "job_posting", observed_at: observedAt,
    now: io.now?.() ?? new Date(),
  });
  const days = EVIDENCE_VALIDITY_DAYS.hiring ?? null;
  const top = jobs[0];
  return {
    evidence_id: `hir_${t.company_key}_open_role`.slice(0, 64),
    company_key: t.company_key,
    dimension: "hiring",
    value: {
      open_role: true,
      role_families: [...io.role_families],
      titles: jobs.slice(0, 5).map((j) => j.title).filter(Boolean),
    },
    status: a.authority === "proven" ? "proven" : "plausible",
    authority: authorityRecord(a),
    source: {
      provider: "apify", actor: HIRING_ROUTE_ACTOR, provider_call_id: providerCallId,
      url: top?.job_url ?? null, excerpt: top?.title ?? null,
    },
    method: "provider_field",
    observed_at: observedAt,
    valid_until: days == null ? null : new Date(Date.parse(observedAt) + days * 86_400_000).toISOString(),
    confidence: "high",
    derived_from: [],
    mission_id: missionId,
    origin: "lead_mission",
  } as EvidenceItem;
}

export function hiringClaimVerifier(io: HiringVerifierIO): ClaimVerifier & { estimate_per_target_usd: () => number | null } {
  return {
    key: HIRING_CLAIM_VERIFIER_KEY,
    claim: "open_role",
    route_actor: HIRING_ROUTE_ACTOR,
    max_targets: HIRING_MAX_TARGETS,
    estimate_per_target_usd: () => hiringEstimatePerTargetUsd(io),
    async verify(targets, deps: VerifierDeps, ctx) {
      const findings: VerifierFinding[] = [];
      if (targets.length === 0 || io.titles.length === 0 || !deps.ready(HIRING_ROUTE_ACTOR)) {
        return { findings, pending: [] };
      }
      // A company is asked about by its LinkedIn page; one without it cannot be.
      const asked = targets
        .map((t) => ({ t, url: normalizeCompanyLinkedInUrl(t.linkedin_url) }))
        .filter((x): x is { t: VerificationTarget; url: string } => !!x.url);
      if (asked.length === 0) return { findings, pending: [] };
      const input = hiringVerifierInput(io, asked.map((x) => x.url));
      if (!input) {
        deps.log("hiring_verifier_input_refused", { companies: asked.length });
        return { findings, pending: [] };
      }
      const out = await deps.call({
        actor_key: HIRING_ROUTE_ACTOR, capability: "hiring_verification", input,
        candidate_keys: asked.map((x) => x.t.company_key), purpose: "hiring_evidence",
      });
      if (out.status !== "ok") {
        // Refused (budget, readiness), failed, or still running: nothing is
        // marked answered, so the gap stays open for a later slice.
        deps.log("hiring_verifier_call", { status: out.status, reason: "reason" in out ? out.reason : null });
        return { findings, pending: [] };
      }
      const now = io.now?.() ?? new Date();
      const at = deps.now();
      const jobs = out.rows.map((r) => normalizeLinkedInJob(r));
      for (const { t, url } of asked) {
        const mine = jobs.filter((j) => normalizeCompanyLinkedInUrl(j.company_linkedin_url) === url);
        const matching = mine.filter((j) => !!j.title && io.matchesRole(j.title) && withinWindow(j, io.window_days, now));
        findings.push({
          company_key: t.company_key,
          item: matching.length > 0 ? openRoleItem(t, matching, io, out.provider_call_id, at, ctx.mission_id) : null,
          answered: true,
          detail: {
            postings_returned: mine.length,
            postings_matching_role: matching.length,
            rejected_titles: mine.filter((j) => !matching.includes(j)).map((j) => j.title).slice(0, 5),
            verdict: matching.length > 0 ? "open_role_proven" : "no_matching_posting_on_linkedin_pending",
          },
        });
      }
      return { findings, pending: [] };
    },
  };
}
