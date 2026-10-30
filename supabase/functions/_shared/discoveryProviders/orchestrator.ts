// Run an approved discovery plan: bounded search, merge, verify.
//
//   1. The approval must cover THIS plan (hash, workspace, mission, credits).
//   2. Each step reads at most `maxPages` pages and `maxRecords` rows, and
//      stops as soon as enough leads qualify. Every page reserves its credits
//      under an idempotency key before the call (`budget.ts`).
//   3. A fallback step runs only if the primary failed; it never runs to top up
//      a primary that simply found few rows (that would spend on a provider the
//      user did not need).
//   4. Auth failure, exhausted allowance, rate limiting or an outage stops that
//      provider; an uncertain charge stops it AND blocks a retry of that page.
//   5. Rows from every provider are merged with provenance, then verified
//      against the original hard requirements — with Apify site / open-role
//      evidence when the plan includes a verification step.
//
// Discovery never enriches. Contact values that a search row happened to carry
// keep their provider label (`provider_supplied_unverified` for every phone).

import type { DiscoveryAdapter, SearchPage } from "./adapter.ts";
import type { SiteEvidence, apifyAdapter } from "./adapters/apify.ts";
import { checkDiscoveryApproval, type DiscoveryApproval, type UsageLedger } from "./budget.ts";
import { mergeRecords, type MergeResult } from "./normalize.ts";
import { PROVIDERS } from "./providers.ts";
import type { DiscoveryPlan, PlanStep } from "./routing.ts";
import { ProviderError, type DiscoveryRequirements, type FilterKey, type ProviderCompany, type ProviderId, type ProviderPerson } from "./types.ts";
import { verifyLeads, type VerifiedLead, type VerifyOptions } from "./verify.ts";
import { stableHash } from "./routing.ts";

export interface StepOutcome {
  provider: ProviderId;
  role: PlanStep["role"];
  status: "completed" | "failed" | "skipped" | "stopped";
  reason: string | null;
  errorKind: string | null;
  pages: number;
  rows: number;
  credits: number;
  replayedPages: number;
  ignoredFilters: FilterKey[];
}

export interface DiscoveryRun {
  status: "completed" | "partial" | "blocked" | "failed";
  reason: string | null;
  planHash: string;
  startedAt: string;
  finishedAt: string;
  leads: VerifiedLead[];
  counts: { qualified: number; needsVerification: number; rejected: number };
  steps: StepOutcome[];
  verification: { provider: ProviderId; checked: number; credits: number; stopped: string | null } | null;
  credits: Partial<Record<ProviderId, number>>;
  merge: MergeResult["stats"] | null;
}

export interface RunInput {
  workspaceId: string;
  missionId: string;
  requirements: DiscoveryRequirements;
  plan: DiscoveryPlan;
  approval: DiscoveryApproval | null;
  adapters: Partial<Record<ProviderId, DiscoveryAdapter>>;
  verifier?: ReturnType<typeof apifyAdapter> | null;
  ledger: UsageLedger;
  now?: () => Date;
  /** Reviewed provider-filter trust (verify.ts); defaults to TRUSTED_PROVIDER_FILTERS (none). */
  verifyOptions?: VerifyOptions;
}

/**
 * Discovery keeps NO contact values: a search row's emails and phones are
 * replaced, the moment the page arrives, by an opaque digest that still lets
 * duplicates merge. Status, type and the provider's verification date stay.
 * Neither the ledger, the run, nor the Leads rows ever hold a value; only
 * enrichment, under its own authorization, returns one.
 */
export function redactContactValues(page: SearchPage): SearchPage {
  return {
    ...page,
    people: page.people.map((p) => ({
      ...p,
      contactPoints: (p.contactPoints ?? []).map((c) => ({ ...c, value: `redacted:${c.kind}:${stableHash(c.value.toLowerCase())}` })),
    })),
  };
}

function pageCredits(step: PlanStep, limit: number): number {
  const c = PROVIDERS[step.provider].cost[step.kind];
  if (!c || c.unit === "free") return 0;
  if (c.unit === "record") return limit * c.creditsPerUnit;
  return c.creditsPerUnit;
}

export async function runDiscovery(input: RunInput): Promise<DiscoveryRun> {
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const { plan, requirements: req } = input;
  const scope = { workspaceId: input.workspaceId, missionId: input.missionId };
  const empty = (status: DiscoveryRun["status"], reason: string): DiscoveryRun => ({
    status, reason, planHash: plan.planHash, startedAt, finishedAt: now().toISOString(), leads: [],
    counts: { qualified: 0, needsVerification: 0, rejected: 0 }, steps: [], verification: null, credits: {}, merge: null,
  });
  const approved = checkDiscoveryApproval(plan, input.approval, scope);
  if (!approved.ok) return empty("blocked", approved.reason);

  // The ceiling is the SERVER's estimate: an approval that names more (the
  // client sends it) never raises what a run may spend; one that names less lowers it.
  const approvalCap = (p: ProviderId) => Math.min(
    input.approval?.maxCredits[p] ?? (plan.requiresApproval ? 0 : Infinity),
    plan.estimatedCredits[p] ?? 0);
  const missionCap = Math.min(plan.limits.maxCreditsPerMission,
    Object.keys(plan.estimatedCredits).reduce((a, p) => a + approvalCap(p as ProviderId), 0));
  const verify = (m: ReturnType<typeof mergeRecords>, ev: SiteEvidence[] = []) => verifyLeads(req, m, ev, { now, ...input.verifyOptions });

  const companyRows: ProviderCompany[] = [];
  const personRows: ProviderPerson[] = [];
  const steps: StepOutcome[] = [];
  const credits: Partial<Record<ProviderId, number>> = {};
  let primaryOk = false;

  for (const step of plan.steps) {
    const out: StepOutcome = { provider: step.provider, role: step.role, status: "completed", reason: null, errorKind: null, pages: 0, rows: 0, credits: 0, replayedPages: 0, ignoredFilters: [] };
    steps.push(out);
    if (step.role === "fallback" && primaryOk) { out.status = "skipped"; out.reason = "primary succeeded"; continue; }
    const adapter = input.adapters[step.provider];
    if (!adapter) { out.status = "failed"; out.errorKind = "not_connected"; out.reason = "no adapter for this workspace"; continue; }

    let cursor: string | null = null;
    for (let page = 0; page < step.maxPages && out.rows < step.maxRecords; page++) {
      const limit = Math.min(step.pageSize, step.maxRecords - out.rows);
      const key = `${input.missionId}:${plan.planHash}:${step.provider}:${step.kind}:p${page}`;
      const cost = pageCredits(step, limit);
      const r = await input.ledger.reserve({ ...scope, provider: step.provider, key, credits: cost, providerCap: approvalCap(step.provider), missionCap: cost === 0 ? Infinity : missionCap });
      if (!r.ok) { out.status = page === 0 ? "failed" : "stopped"; out.reason = `ledger refused page ${page}: ${r.reason}`; out.errorKind = r.reason; break; }
      let res: SearchPage;
      if (r.replay) {
        res = r.result as SearchPage;
        out.replayedPages++;
      } else {
        try {
          res = redactContactValues(await adapter.search(step, req, cursor, limit));
        } catch (e) {
          // An unexpected failure after a paid call may still have billed it.
          const pe = e instanceof ProviderError ? e
            : new ProviderError(step.provider, cost > 0 ? "charge_uncertain" : "outage", "adapter failed after the request");
          if (pe.kind === "charge_uncertain") await input.ledger.markUncertain(key);
          else await input.ledger.release(key);
          out.status = out.pages === 0 ? "failed" : "stopped";
          out.errorKind = pe.kind;
          out.reason = pe.message;
          break;
        }
        await input.ledger.settle(key, res.creditsCharged, res);
        out.credits += res.creditsCharged;
      }
      out.pages++;
      out.rows += res.companies.length + res.people.length;
      for (const f of res.ignoredFilters) if (!out.ignoredFilters.includes(f)) out.ignoredFilters.push(f);
      companyRows.push(...res.companies);
      personRows.push(...res.people);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
      // Enough already? Stop paying for more pages. Counted on the PROVIDER
      // status: more search pages cannot prove what only canonical evidence
      // can, so waiting for shared qualification here would only buy pages.
      const soFar = verify(mergeRecords(companyRows, personRows));
      if (soFar.filter((l) => l.providerStatus === "qualified").length >= req.requestedCount) break;
    }
    credits[step.provider] = (credits[step.provider] ?? 0) + out.credits;
    if (step.role === "primary" && out.status !== "failed") primaryOk = true;
  }

  let merged = mergeRecords(companyRows, personRows);
  let siteEvidence: SiteEvidence[] = [];
  let verification: DiscoveryRun["verification"] = null;

  if (plan.verification && input.verifier && merged.companies.length) {
    const v = plan.verification;
    verification = { provider: v.provider, checked: 0, credits: 0, stopped: null };
    const pending = verify(merged).filter((l) => l.status === "needs_verification"
      && l.checks.some((c) => v.keys.includes(c.key) && c.outcome === "unknown"));
    for (const lead of pending.slice(0, v.maxRuns)) {
      const domain = lead.company.domain[0]?.value;
      if (!domain) continue;
      const key = `${input.missionId}:${plan.planHash}:${v.provider}:verify:${domain}`;
      const r = await input.ledger.reserve({ ...scope, provider: v.provider, key, credits: 1, providerCap: approvalCap(v.provider), missionCap });
      if (!r.ok) { verification.stopped = r.reason; break; }
      if (r.replay) { siteEvidence.push(...(r.result as SiteEvidence[])); verification.checked++; continue; }
      try {
        const ev = await input.verifier.verifyCompanies([{ provider: "apify", recordId: lead.company.key, retrievedAt: now().toISOString(), domain }], req.hard, v.keys);
        await input.ledger.settle(key, 1, ev);
        siteEvidence = siteEvidence.concat(ev);
        verification.checked++;
        verification.credits++;
      } catch (e) {
        // An actor run that failed in an unknown way may still have been billed.
        if (!(e instanceof ProviderError) || e.kind === "charge_uncertain") { await input.ledger.markUncertain(key); verification.stopped = "charge_uncertain"; break; }
        await input.ledger.release(key);
      }
    }
    credits[v.provider] = (credits[v.provider] ?? 0) + verification.credits;
    merged = mergeRecords(companyRows, personRows);
  }

  const ranked = verify(merged, siteEvidence).sort((a, b) => rank(a) - rank(b));
  const qualified = ranked.filter((l) => l.status === "qualified");
  const leads = [...qualified.slice(0, req.requestedCount), ...ranked.filter((l) => l.status !== "qualified")];
  const anyOk = steps.some((s) => s.status === "completed" || s.status === "stopped");
  const allFailed = steps.length > 0 && steps.every((s) => s.status === "failed" || s.status === "skipped") && !anyOk;
  return {
    status: allFailed ? "failed" : steps.some((s) => s.status === "failed" || s.status === "stopped") ? "partial" : "completed",
    reason: allFailed ? steps.map((s) => `${s.provider}: ${s.reason}`).join("; ") : null,
    planHash: plan.planHash, startedAt, finishedAt: now().toISOString(),
    leads,
    counts: {
      qualified: Math.min(qualified.length, req.requestedCount),
      needsVerification: ranked.filter((l) => l.status === "needs_verification").length,
      rejected: ranked.filter((l) => l.status === "rejected").length,
    },
    steps, verification, credits, merge: merged.stats,
  };
}

function rank(l: VerifiedLead): number {
  const s = l.status === "qualified" ? 0 : l.status === "needs_verification" ? 10 : 20;
  return s + (l.verification === "evidence" ? 0 : 1) - Math.min(0.9, l.company.sources.length * 0.1);
}
