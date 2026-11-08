// Run an approved discovery strategy (`strategy.ts`) end to end.
//
//   authorization  FIRST, before any provider call: the approval must name this
//                  plan's hash and cover its worst case. Apollo never runs.
//   LeadOcean-led  leadocean_only / leadocean_plus_apify run the existing
//                  pipeline (`runLeadPipeline`) on the interpreted requirements:
//                  same ledger, checkpoint, screening, Apify record, shared engine.
//   Apify-led      apify_only / apify_plus_leadocean:
//                    1 job search discovers employers by a dated open role
//                    2 Agentory's history: existing Leads keep their ids, holds block outreach
//                    3 Apify company record (identity, HQ, size), inside the ceiling;
//                      what does not fit stays pending, never dropped
//                    4 LeadOcean decision-makers by exact domain, for companies not
//                      already disproven (apify_plus_leadocean only)
//                    5 cross-provider merge (normalize.ts), then the shared engine
//                      decides on the compiler's criteria, with each evidence source
//                      admitted only if ITS OWN identity names the company
//                    6 ranking → queue / review / excluded (the ATLAS projection's input)
//
// Phone enrichment is never part of discovery: no phone lookup can run here
// (no lookup dependency is accepted), every lead is `enrichment: not_requested`
// and `contactValues` is always empty. Nothing is sent, nothing is written.

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { DiscoveryAdapter } from "../discoveryProviders/adapter.ts";
import type { DiscoveryApproval, UsageLedger } from "../discoveryProviders/budget.ts";
import { mergeRecords } from "../discoveryProviders/normalize.ts";
import { runDiscovery } from "../discoveryProviders/orchestrator.ts";
import { planDiscovery, type ProviderConnectionState } from "../discoveryProviders/routing.ts";
import { evidenceIdentity } from "../discoveryProviders/sharedQualification.ts";
import type { DiscoveryRequirements, ProviderCompany, ProviderPerson } from "../discoveryProviders/types.ts";
import { verifyLeads, type VerifiedLead } from "../discoveryProviders/verify.ts";
import type { EvidenceItem } from "../candidateObservation.ts";
import type { Eligibility } from "../candidateEligibility.ts";
import { classifyDecisionMakerRole } from "../decisionMaker/roleFamily.ts";
import { ledgeredInvoker } from "./apifyInvoker.ts";
import { collapseDuplicateLeads, type MergedLead } from "./identity.ts";
import { apifyPageFetcher, checkBusinessModels, type BusinessModelFinding, type Grounder } from "./businessModelCheck.ts";
import { COMPANY_EMPLOYEES_ACTOR_KEY, companyEmployeesInput, discoverHiringCompanies, discoverPostingCompanies, peopleFromEmployeeRows, slugOf } from "./apifyDiscovery.ts";
import { PIPELINE_ACTORS } from "./apifyInvoker.ts";
import type { Signal } from "./signals.ts";
import { COMPANY_RECORD_ACTOR, readCompanyRecordsCached } from "./canonical.ts";
import type { EvidenceCache } from "./evidenceCache.ts";
import type { CheckpointStore } from "./checkpoint.ts";
import type { ExclusionIndex } from "./exclusions.ts";
import { NON_DECISION_TITLES } from "./icp.ts";
import { bestContact, personVerification, runLeadPipeline, PIPELINE_VERSION, type PipelineLead, type PipelineRun } from "./pipeline.ts";
import { DEFAULT_WEIGHTS, rankLeads } from "./ranking.ts";
import {
  APOLLO_ACCESS_VALIDATED, DISCOVERY_CAPABILITIES, discoveryJobTitles, icpFromSpec, postTopics, sizePreferenceDistance, leadoceanDiscoveryRequirements,
  type DiscoverySpec, type DiscoveryStrategyId, type Limitation, type StrategyPlan,
} from "./strategy.ts";

export const STRATEGY_RUN_VERSION = "discovery-strategy-run-v1" as const;

/** What the owner approved: this plan (hash), at most this spend. */
export interface StrategyApproval {
  planHash: string;
  leadoceanRecords: number;
  apifyUsd: number;
  approvedBy: string;
  approvedAt: string;
}

export interface StrategyRunInput {
  workspaceId: string;
  walkId: string;
  spec: DiscoverySpec;
  plan: StrategyPlan;
  approval: StrategyApproval | null;
  /** The workspace's LeadOcean search adapter; null when not connected. Only search — never a phone lookup. */
  leadocean: DiscoveryAdapter | null;
  apify: ActorInvoker | null;
  connections: ProviderConnectionState[];
  ledger: UsageLedger;
  checkpoints: CheckpointStore;
  existing: ExclusionIndex;
  now?: () => Date;
  actorTimeoutMs?: number;
  /** Per-workspace company-record cache (held migration 20261101120000); null/absent = buy every record. */
  evidenceCache?: EvidenceCache | null;
  /** The shared grounded classifier, for business-model verification (businessModelCheck.ts). */
  groundBusinessModel?: Grounder | null;
  /** The plan's hash-bound permission to count likely business-model matches (strategy.ts `acceptLikely`). */
  acceptLikely?: boolean;
}

export interface ProviderStepOutcome {
  capability: string;
  provider: string;
  status: "completed" | "partial" | "failed" | "skipped" | "not_run";
  reason: string | null;
  spend: { leadoceanRecords: number; apifyUsd: number };
}

export interface StrategyRun {
  version: typeof STRATEGY_RUN_VERSION;
  status: "completed" | "partial" | "blocked";
  reason: string | null;
  strategy: DiscoveryStrategyId | null;
  planHash: string;
  steps: ProviderStepOutcome[];
  queue: PipelineLead[];
  review: PipelineLead[];
  excluded: PipelineLead[];
  /** Records of one company collapsed into one lead (identity.ts). Absent when none. */
  mergedCompanies?: MergedLead[];
  /** Evidence a source offered for a company and the identity rule refused (it named another company). */
  evidenceRefused: { companyKey: string; source: string; reason: string }[];
  limitations: Limitation[];
  spend: { leadoceanRecords: number; apifyUsd: number };
  /** Always empty: discovery never enriches. */
  contactValues: [];
  /** The LeadOcean-led path's full pipeline run (funnel, checkpoint, yield), when it ran. */
  pipeline: Pick<PipelineRun, "funnel" | "checkpoint" | "yield" | "discovery" | "canonical"> | null;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Refuse anything the approval does not cover. Pure; runs before any provider call. */
export function checkStrategyApproval(plan: StrategyPlan, a: StrategyApproval | null): { ok: true } | { ok: false; reason: string } {
  if (plan.status !== "ready" || !plan.strategy) return { ok: false, reason: `plan is not runnable: ${plan.blockedReason ?? plan.status}` };
  if (plan.strategy === "apollo_plus_apify" && !APOLLO_ACCESS_VALIDATED) return { ok: false, reason: "Apollo discovery is disabled until its API access is validated" };
  // Defense in depth: a plan naming a capability that is not available (an actor off the
  // allowlist, a disabled provider) is never run, however it was produced.
  const unavailable = plan.steps.filter((s) => DISCOVERY_CAPABILITIES[s.capability]?.status !== "available");
  if (unavailable.length) return { ok: false, reason: `not runnable: ${unavailable.map((s) => `${s.capability} is ${DISCOVERY_CAPABILITIES[s.capability]?.status ?? "unknown"}`).join("; ")}` };
  if (!a) return { ok: false, reason: "no approval: nothing is called before an owner approves this plan" };
  if (a.planHash !== plan.planHash) return { ok: false, reason: "the approval names a different plan (it changed since it was approved)" };
  if (a.leadoceanRecords < plan.estimate.leadoceanRecords) return { ok: false, reason: `the approval covers ${a.leadoceanRecords} LeadOcean records; the plan needs up to ${plan.estimate.leadoceanRecords}` };
  if (a.apifyUsd + 1e-9 < plan.estimate.apifyUsd) return { ok: false, reason: `the approval covers $${a.apifyUsd} of Apify; the plan needs up to $${plan.estimate.apifyUsd}` };
  return { ok: true };
}

function withTimeout(invoke: ActorInvoker | null, ms: number): ActorInvoker | null {
  if (!invoke) return null;
  return (key, input, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { const e = new Error(`actor run exceeded ${ms} ms`); e.name = "TimeoutError"; reject(e); }, ms);
    invoke(key, input, opts).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function runDiscoveryStrategy(input: StrategyRunInput): Promise<StrategyRun> {
  const now = input.now ?? (() => new Date());
  const { plan, spec } = input;
  const blocked = (reason: string): StrategyRun => ({
    version: STRATEGY_RUN_VERSION, status: "blocked", reason, strategy: plan.strategy, planHash: plan.planHash, steps: [],
    queue: [], review: [], excluded: [], evidenceRefused: [], limitations: plan.limitations, spend: { leadoceanRecords: 0, apifyUsd: 0 }, contactValues: [], pipeline: null,
  });
  const ok = checkStrategyApproval(plan, input.approval);
  if (!ok.ok) return blocked(ok.reason);
  const a = input.approval!;
  // The server's estimate is the ceiling: an approval naming more never raises it.
  const cap = { leadoceanRecords: Math.min(a.leadoceanRecords, plan.estimate.leadoceanRecords), apifyUsd: Math.min(a.apifyUsd, plan.estimate.apifyUsd) };
  const run = plan.strategy === "leadocean_only" || plan.strategy === "leadocean_plus_apify" ? await runLeadOceanLed(input, cap, now)
    : plan.strategy === "apify_only" || plan.strategy === "apify_plus_leadocean" || plan.strategy === "apify_leadocean_concurrent" ? await runApifyLed(input, cap, now)
    : null;
  if (!run) return blocked(`strategy ${plan.strategy} has no executor`);
  return withOneLeadPerCompany(run);
}

/** One company, one lead (identity.ts): collapse across every lane, then re-file by the kept verdict. */
function withOneLeadPerCompany(run: StrategyRun): StrategyRun {
  const all = [...run.queue, ...run.review, ...run.excluded];
  const { leads, merged } = collapseDuplicateLeads(all);
  if (!merged.length) return run;
  return {
    ...run,
    queue: leads.filter((l) => l.rank.lane === "queue"),
    review: leads.filter((l) => l.rank.lane === "review"),
    excluded: leads.filter((l) => l.rank.lane === "excluded"),
    mergedCompanies: merged,
  };
}

// ── LeadOcean-led: the existing pipeline on the interpreted requirements ────

async function runLeadOceanLed(input: StrategyRunInput, cap: { leadoceanRecords: number; apifyUsd: number }, now: () => Date): Promise<StrategyRun> {
  const { plan, spec } = input;
  const withApify = plan.strategy === "leadocean_plus_apify";
  const lo = plan.steps.find((s) => s.role === "discover_people")!;
  const verifyStep = plan.steps.find((s) => s.role === "verify_company");
  const base = {
    workspaceId: input.workspaceId, walkId: input.walkId, icp: icpFromSpec(spec), requirements: leadoceanDiscoveryRequirements(spec),
    connections: input.connections,
    limits: { maxRecordsPerStep: lo.maxItems, overfetch: Math.max(1, Math.ceil(lo.maxItems / spec.requestedCount)), maxCreditsPerMission: cap.leadoceanRecords, maxCreditsPerProvider: { leadocean: cap.leadoceanRecords } },
    approvals: { discovery: null, canonicalMaxUsd: null, signals: null, phoneLookups: null },
    // No phone dependency is handed over: discovery cannot enrich.
    leadocean: input.leadocean, leadoceanDeps: null, apify: withApify ? input.apify : null,
    ledger: input.ledger, checkpoints: input.checkpoints, existing: input.existing, now, actorTimeoutMs: input.actorTimeoutMs,
    evidenceCache: input.evidenceCache ?? null,
  };
  const dry = await runLeadPipeline({ ...base, dryRun: true });
  if (dry.status === "blocked") return { ...emptyRun(input, `LeadOcean plan blocked: ${dry.reason}`), status: "blocked" };
  const est = dry.plan.estimatedCredits.leadocean ?? 0;
  if (est > cap.leadoceanRecords) return { ...emptyRun(input, `LeadOcean plan needs ${est} records; ${cap.leadoceanRecords} approved`), status: "blocked" };
  const discovery: DiscoveryApproval = { kind: "discovery", workspaceId: input.workspaceId, missionId: `lp:${input.walkId}:r${dry.checkpoint.recordsBought}`,
    planHash: dry.plan.planHash, maxCredits: { leadocean: est }, approvedBy: input.approval!.approvedBy, approvedAt: input.approval!.approvedAt };
  const run = await runLeadPipeline({ ...base, approvals: { discovery, canonicalMaxUsd: withApify ? Math.min(cap.apifyUsd, verifyStep?.estimate.apifyUsd ?? cap.apifyUsd) : null, signals: null, phoneLookups: null } });
  const steps: ProviderStepOutcome[] = [{
    capability: lo.capability, provider: "leadocean",
    status: run.discovery?.status === "completed" ? "completed" : run.discovery?.status === "partial" ? "partial" : run.discovery ? "failed" : "not_run",
    reason: run.discovery?.reason ?? (run.status === "blocked" ? run.reason : null), spend: { leadoceanRecords: run.spend.leadoceanRecords, apifyUsd: 0 },
  }];
  if (verifyStep) steps.push({
    capability: verifyStep.capability, provider: "apify",
    status: !run.canonical ? "not_run" : run.canonical.stopped ? "failed" : "completed", reason: run.canonical?.stopped ?? null,
    spend: { leadoceanRecords: 0, apifyUsd: run.spend.apifyUsd },
  });
  return {
    version: STRATEGY_RUN_VERSION, status: run.status === "blocked" ? "blocked" : run.status === "partial" ? "partial" : "completed",
    reason: run.reason, strategy: plan.strategy, planHash: plan.planHash, steps,
    queue: run.queue, review: run.review, excluded: run.excluded, evidenceRefused: [], limitations: plan.limitations,
    spend: run.spend, contactValues: [], pipeline: { funnel: run.funnel, checkpoint: run.checkpoint, yield: run.yield, discovery: run.discovery, canonical: run.canonical },
  };
}

function emptyRun(input: StrategyRunInput, reason: string | null): StrategyRun {
  return {
    version: STRATEGY_RUN_VERSION, status: "completed", reason, strategy: input.plan.strategy, planHash: input.plan.planHash, steps: [],
    queue: [], review: [], excluded: [], evidenceRefused: [], limitations: input.plan.limitations, spend: { leadoceanRecords: 0, apifyUsd: 0 }, contactValues: [], pipeline: null,
  };
}

// ── Concurrent LeadOcean discovery (apify_leadocean_concurrent) ─────────────

/**
 * LeadOcean's half of the concurrent strategy: the mission's requirements it can express
 * (`leadoceanDiscoveryRequirements`: never the hiring signal, never a label it cannot
 * filter exactly), bounded by the plan step and the approved record ceiling. Its rows are
 * candidates and claims — the shared engine decides on proof.
 */
async function leadOceanConcurrentDiscovery(input: StrategyRunInput, step: StrategyPlan["steps"][number], cap: { leadoceanRecords: number }, mission: string):
  Promise<{ companies: ProviderCompany[]; people: ProviderPerson[]; records: number; status: ProviderStepOutcome["status"]; reason: string | null }> {
  const max = Math.min(step.maxItems, cap.leadoceanRecords);
  if (!input.leadocean) return { companies: [], people: [], records: 0, status: "failed", reason: "LeadOcean not connected" };
  if (max < 1) return { companies: [], people: [], records: 0, status: "skipped", reason: "no LeadOcean records approved" };
  const req = leadoceanDiscoveryRequirements(input.spec);
  const sub = planDiscovery({ requirements: req, connections: input.connections, selection: ["leadocean"],
    limits: { maxRecordsPerStep: max, overfetch: 1, maxCreditsPerMission: max, maxCreditsPerProvider: { leadocean: max } } });
  if (sub.status !== "ready") return { companies: [], people: [], records: 0, status: "failed", reason: sub.blockedReason ?? "LeadOcean plan blocked" };
  const est = Math.min(sub.estimatedCredits.leadocean ?? 0, max);
  const run = await runDiscovery({
    workspaceId: input.workspaceId, missionId: `${mission}:lo-concurrent`, requirements: req, plan: sub,
    approval: { kind: "discovery", workspaceId: input.workspaceId, missionId: `${mission}:lo-concurrent`, planHash: sub.planHash, maxCredits: { leadocean: est }, approvedBy: input.approval!.approvedBy, approvedAt: input.approval!.approvedAt },
    adapters: { leadocean: input.leadocean }, verifier: null, ledger: input.ledger, now: input.now ?? (() => new Date()),
  });
  return { companies: run.rows?.companies ?? [], people: run.rows?.people ?? [], records: run.credits.leadocean ?? 0,
    status: run.status === "completed" ? "completed" : run.status === "partial" ? "partial" : "failed",
    reason: run.reason ?? run.steps.find((x) => x.reason)?.reason ?? null };
}

// ── Apify-led: discover by an open role ─────────────────────────────────────

async function runApifyLed(input: StrategyRunInput, cap: { leadoceanRecords: number; apifyUsd: number }, now: () => Date): Promise<StrategyRun> {
  const { plan, spec } = input;
  const at = now().toISOString();
  const mission = `ms:${input.walkId}:${plan.planHash}`;
  const steps: ProviderStepOutcome[] = [];
  const timed = withTimeout(input.apify, input.actorTimeoutMs ?? 120_000);
  // Every Apify run reserves its worst case in the durable ledger first: a re-run replays, an uncertain charge is never re-bought.
  const apify = timed ? ledgeredInvoker(timed, input.ledger, { workspaceId: input.workspaceId, missionId: `${mission}:apify`, maxUsd: cap.apifyUsd }) : null;

  // 1 discovery by the defining signal: open roles (job search) or posts on a topic (post search)
  const jobStep = plan.steps[0];
  const seedUsd = Math.min(cap.apifyUsd, jobStep.estimate.apifyUsd);
  const postActor = PIPELINE_ACTORS["apify_linkedin_post_search"];
  const apifyDiscovery = async (): Promise<Awaited<ReturnType<typeof discoverHiringCompanies>> & { signals?: Signal[] }> =>
    jobStep.capability === "apify.linkedin_job_search"
      ? await discoverHiringCompanies(spec, discoveryJobTitles(spec), apify, { maxItems: jobStep.maxItems, maxUsd: seedUsd, now: now(), idPrefix: mission, missionId: mission })
      : jobStep.capability === "apify.linkedin_post_search" && postActor
      ? await discoverPostingCompanies(spec, postTopics(spec), apify, { maxItems: jobStep.maxItems, maxUsd: seedUsd, now: now(), idPrefix: mission, missionId: mission, perItemUsd: postActor.perItemUsd, perStartUsd: postActor.perStartUsd })
      : { companies: [], evidence: new Map(), jobs: new Map(), rows: 0, dropped: {}, spentUsd: 0, stopped: `no executor for ${jobStep.capability}`, runId: null };
  // CONCURRENT (apify_leadocean_concurrent): LeadOcean searches the SAME mission at the same
  // time, by the filters it can express (never the hiring signal, which only Apify proves).
  // Each provider fails on its own: one's error never stops or erases the other's results.
  const loStep = plan.strategy === "apify_leadocean_concurrent" ? plan.steps.find((x) => x.role === "discover_people") ?? null : null;
  const [apifySettled, loSettled] = await Promise.allSettled([
    apifyDiscovery(),
    loStep ? leadOceanConcurrentDiscovery(input, loStep, cap, mission) : Promise.resolve(null),
  ]);
  const found: Awaited<ReturnType<typeof apifyDiscovery>> = apifySettled.status === "fulfilled" ? apifySettled.value
    : { companies: [], evidence: new Map(), jobs: new Map(), rows: 0, dropped: {}, spentUsd: 0, stopped: `${(apifySettled.reason as Error)?.message ?? "failed"}; not retried`, runId: null };
  steps.push({ capability: jobStep.capability, provider: "apify", status: found.stopped ? "failed" : "completed",
    reason: found.stopped ?? (Object.keys(found.dropped).length ? `dropped postings: ${Object.entries(found.dropped).map(([k, v]) => `${k} ${v}`).join(", ")}` : null),
    spend: { leadoceanRecords: 0, apifyUsd: r6(found.spentUsd) } });
  const concurrentLO = loStep ? (loSettled.status === "fulfilled" && loSettled.value ? loSettled.value
    : { companies: [] as ProviderCompany[], people: [] as ProviderPerson[], records: 0, status: "failed" as const,
      reason: loSettled.status === "rejected" ? `${(loSettled.reason as Error)?.message ?? "failed"}; not retried` : "not run" }) : null;
  if (loStep && concurrentLO) {
    steps.push({ capability: loStep.capability, provider: "leadocean", status: concurrentLO.status, reason: concurrentLO.reason,
      spend: { leadoceanRecords: concurrentLO.records, apifyUsd: 0 } });
  }
  // A people search names employers INSIDE each person row (`person.company`), not as company
  // rows: both are LeadOcean's companies — counted, verified and merged alike.
  const loEmployers = [...(concurrentLO?.companies ?? []), ...(concurrentLO?.people ?? []).map((x) => x.company).filter((c): c is ProviderCompany => !!c)];
  if (found.stopped && !found.companies.length && !loEmployers.length) {
    return { ...emptyRun(input, `discovery failed: ${found.stopped}`), status: "blocked", steps,
      spend: { leadoceanRecords: concurrentLO?.records ?? 0, apifyUsd: r6(found.spentUsd) } };
  }
  let apifySpent = found.spentUsd;

  // 2 history (identity only here; holds block outreach, existing Leads keep their ids)
  const historyOf = (c: { domains: string[]; linkedinUrls: string[]; providerIds: string[] }) => input.existing.company(c);

  // 3 company records: identity, HQ, size — as many as the ceiling allows; the rest stay pending
  const recStep = plan.steps.find((s) => s.capability === "apify.linkedin_company_record")!;
  // A stated size PREFERENCE orders which companies get the limited reads (and, below, the
  // people lookups) — the job row's band is a claim, used for ordering only, never as a gate.
  const prefOrder = (c: ProviderCompany) => sizePreferenceDistance(found.sizeClaims?.get(slugOf(c.linkedinUrl) ?? "") ?? null, spec.preferredEmployees);
  found.companies.sort((a, b) => prefOrder(a) - prefOrder(b));
  // Concurrent: LeadOcean's employers are verified by the SAME record read (their HQ and
  // size are claims until the company record says otherwise); one target per LinkedIn page.
  const verifyRows = [...found.companies, ...loEmployers.filter((c) => !!slugOf(c.linkedinUrl))];
  const targets = [...new Map(verifyRows.map((c) => [slugOf(c.linkedinUrl), { companyKey: `li:${slugOf(c.linkedinUrl)}`, linkedinUrl: c.linkedinUrl ?? "" }])).values()];
  const recBudget = Math.max(0, Math.min(recStep.estimate.apifyUsd, cap.apifyUsd - apifySpent));
  // Fresh records this workspace already bought are reused, not bought again; misses are
  // bought only as far as the ceiling covers — the rest stay needs_verification.
  const canonical = await readCompanyRecordsCached(targets, apify, { maxUsd: recBudget, now: now(), idPrefix: mission, cache: input.evidenceCache ?? null, workspaceId: input.workspaceId, truncateToBudget: true });
  const unaffordable = canonical.statuses.filter((x) => x.state === "skipped_budget");
  apifySpent += canonical.spentUsd;
  steps.push({ capability: recStep.capability, provider: "apify",
    // NOTHING TO VERIFY IS NOT A COMPLETED VERIFICATION (audit S2): no company, no call.
    status: !targets.length ? "not_run" : canonical.stopped ? "failed" : unaffordable.length ? "partial" : "completed",
    reason: !targets.length ? "no company to verify" : canonical.stopped ?? ([unaffordable.length ? `budget: ${unaffordable.length} compan${unaffordable.length === 1 ? "y" : "ies"} left unverified` : null,
      canonical.cached ? `${canonical.cached} reused from the evidence cache` : null, ...canonical.cacheErrors].filter(Boolean).join("; ") || null),
    spend: { leadoceanRecords: 0, apifyUsd: r6(canonical.spentUsd) } });

  // Evidence admitted per source, by its own identity.
  const evidenceRefused: StrategyRun["evidenceRefused"] = [];
  const recordOf = (slug: string | null) => (slug ? canonical.evidence.get(`li:${slug}`) ?? [] : []);
  const canonicalEvidence = (ids: { key: string; domains: string[]; linkedinUrls: string[] }): readonly EvidenceItem[] => {
    const slugs = [...new Set(ids.linkedinUrls.map(slugOf).filter((s): s is string => !!s))];
    const out: EvidenceItem[] = [];
    for (const slug of slugs) {
      for (const [source, items] of [[DISCOVERY_CAPABILITIES[jobStep.capability]?.actorKey ?? jobStep.capability, found.evidence.get(slug) ?? []], [COMPANY_RECORD_ACTOR.key, recordOf(slug)]] as const) {
        if (!items.length) continue;
        const v = evidenceIdentity(items, ids);
        if (v === "match") out.push(...items);
        else if (!evidenceRefused.some((x) => x.companyKey === ids.key && x.source === source)) {
          evidenceRefused.push({ companyKey: ids.key, source, reason: v === "conflict"
            ? "identity conflict: the record's LinkedIn profile matches but its website names a different domain; none of its facts were used"
            : "no proven identity item names this company; none of its facts were used" });
        }
      }
    }
    // Business-model evidence read from THIS company's own site (added below) rides on the
    // record's proven identity: never admitted for a company whose identity is not proven.
    if (out.some((it) => it.dimension === "identity" && it.status === "proven")) out.push(...(siteEvidence.get(ids.key) ?? []));
    return out;
  };
  const siteEvidence = new Map<string, EvidenceItem[]>();

  // Disproven companies get no people bought for them.
  const firstPass = verifyLeads({ ...spec.requirements, targetEntity: "company" }, mergeRecords(found.companies, []), [], { now, canonicalEvidence });
  const disproven = new Set(firstPass.filter((l) => l.shared?.eligibility === "ineligible").flatMap((l) => l.company.domain.map((d) => d.value)));

  // 4 decision-makers by exact domain
  let people: ProviderPerson[] = concurrentLO?.people ?? [];
  let loCompanies: ProviderCompany[] = concurrentLO?.companies ?? [];
  let loRecords = concurrentLO?.records ?? 0;
  const peopleStep = plan.steps.find((s) => s.role === "people_at_companies");
  if (peopleStep?.capability === "apify.company_employees") {
    // Apify decision-makers by LinkedIn company page (PR #198). Reachable only once the
    // actor is on PIPELINE_ACTORS: the approval check and the ledgered invoker refuse it today.
    const urls = found.companies.filter((c) => !c.domain || !disproven.has(c.domain)).map((c) => c.linkedinUrl).filter((u): u is string => !!u);
    const per = Math.max(1, Math.floor(peopleStep.maxItems / Math.max(1, urls.length)));
    try {
      const run = urls.length && apify ? await apify(COMPANY_EMPLOYEES_ACTOR_KEY, companyEmployeesInput(urls, spec.roles, per), { maxItems: per * urls.length, idempotencyKey: `${mission}:${COMPANY_EMPLOYEES_ACTOR_KEY}:people` }) : null;
      people = run ? peopleFromEmployeeRows(run.items, new Set(urls.map((u) => slugOf(u)!)), at) : [];
      const spent = run?.chargedUsd ?? (run ? peopleStep.estimate.apifyUsd : 0);
      apifySpent += spent;
      steps.push({ capability: peopleStep.capability, provider: "apify", status: run ? "completed" : "skipped", reason: run ? null : "no company to look up", spend: { leadoceanRecords: 0, apifyUsd: r6(spent) } });
    } catch (e) {
      apifySpent += peopleStep.estimate.apifyUsd;
      steps.push({ capability: peopleStep.capability, provider: "apify", status: "failed", reason: `${(e as Error)?.message ?? "failed"}; not retried`, spend: { leadoceanRecords: 0, apifyUsd: peopleStep.estimate.apifyUsd } });
    }
  } else if (peopleStep) {
    // Verified-and-eligible companies first, then the rest, in preference order; at most one
    // domain per record the step may buy, so every person returned belongs to a company
    // this run discovered and (where the budget allowed) verified.
    const state = (c: ProviderCompany) => {
      const st = canonical.statuses.find((x) => x.companyKey === `li:${slugOf(c.linkedinUrl)}`)?.state;
      const elig = firstPass.find((l) => l.company.domain.some((d) => d.value === c.domain))?.shared?.eligibility;
      return elig === "eligible" ? 0 : st === "read" ? 1 : 2;
    };
    const ranked = found.companies.filter((c) => !!c.domain && !disproven.has(c.domain)).sort((a, b) => state(a) - state(b) || prefOrder(a) - prefOrder(b));
    const domains = [...new Set(ranked.map((c) => c.domain!))].slice(0, Math.max(1, peopleStep.maxItems));
    if (!domains.length) {
      steps.push({ capability: peopleStep.capability, provider: "leadocean", status: "skipped", reason: "no verified-or-pending company with a domain", spend: { leadoceanRecords: 0, apifyUsd: 0 } });
    } else {
      const req: DiscoveryRequirements = {
        originalQuery: spec.query, targetEntity: "person", requestedCount: domains.length,
        hard: [
          { criterionId: "discovered.companies", key: "known_companies", values: domains, label: "Employer: a discovered company", representable: true },
          { criterionId: "decision_makers.roles", key: "roles", values: spec.roles, label: `Role: ${spec.roles.join(" or ")}`, representable: true },
        ],
        preferences: [], roles: spec.roles, forbidBroadening: [], forbidBroadeningUnread: [], criteria: [],
        providerHints: { leadocean: { excludeTitle: NON_DECISION_TITLES } },
      };
      const max = Math.min(peopleStep.maxItems, cap.leadoceanRecords);
      const sub = planDiscovery({ requirements: req, connections: input.connections, selection: ["leadocean"],
        limits: { maxRecordsPerStep: max, overfetch: Math.max(1, Math.ceil(max / domains.length)), maxCreditsPerMission: max, maxCreditsPerProvider: { leadocean: max } } });
      if (sub.status !== "ready" || !input.leadocean) {
        steps.push({ capability: peopleStep.capability, provider: "leadocean", status: "failed", reason: sub.blockedReason ?? "LeadOcean not connected", spend: { leadoceanRecords: 0, apifyUsd: 0 } });
      } else {
        // The owner approved this strategy and its record ceiling; this sub-plan is bounded by it.
        const est = Math.min(sub.estimatedCredits.leadocean ?? 0, max);
        const run = await runDiscovery({
          workspaceId: input.workspaceId, missionId: `${mission}:lo-people`, requirements: req, plan: sub,
          approval: { kind: "discovery", workspaceId: input.workspaceId, missionId: `${mission}:lo-people`, planHash: sub.planHash, maxCredits: { leadocean: est }, approvedBy: input.approval!.approvedBy, approvedAt: input.approval!.approvedAt },
          adapters: { leadocean: input.leadocean }, verifier: null, ledger: input.ledger, now,
        });
        loRecords = run.credits.leadocean ?? 0;
        people = run.rows?.people ?? [];
        loCompanies = run.rows?.companies ?? [];
        steps.push({ capability: peopleStep.capability, provider: "leadocean",
          status: run.status === "completed" ? "completed" : run.status === "partial" ? "partial" : "failed",
          reason: run.reason ?? run.steps.find((s) => s.reason)?.reason ?? null, spend: { leadoceanRecords: loRecords, apifyUsd: 0 } });
      }
    }
  }

  // 5 merge across providers, then the shared engine decides
  const merged = mergeRecords([...found.companies, ...loCompanies], people);
  let leads = verifyLeads({ ...spec.requirements, targetEntity: peopleStep ? "person" : "company" }, merged, [], { now, canonicalEvidence });

  // 5b PROPORTIONATE BUSINESS-MODEL VERIFICATION (MRLE Phase 1, businessModelCheck.ts): only
  // companies open on NOTHING but the business model are read, as many as the request still
  // needs, ≤3 first-party pages each, one batched run within the step's approved worst case.
  const bmStep = plan.steps.find((s) => s.capability === "apify.website_business_model");
  const businessModel = new Map<string, Omit<BusinessModelFinding, "item">>();
  if (bmStep) {
    const required = String(spec.requirements.criteria.find((c) => c.kind === "hard" && c.dimension === "business_model")?.value ?? "B2B");
    const eligibleNow = leads.filter((l) => l.shared?.eligibility === "eligible").length;
    const need = Math.max(0, spec.requestedCount - eligibleNow);
    const open = leads.filter((l) => l.shared?.eligibility === "pending" && (l.shared.gaps ?? []).length === 1 && l.shared.gaps[0] === "business_model" && !(l.shared.disproven ?? []).length && l.company.domain.length);
    const targets = open.slice(0, Math.min(Math.ceil(need * 1.5), Math.floor(bmStep.maxItems / 3))).map((l) => ({
      companyKey: l.company.key, name: l.company.name[0]?.value ?? null, domain: l.company.domain[0].value,
      linkedinUrl: l.company.linkedinUrl[0]?.value ?? null,
      description: canonical.facts.get(`li:${slugOf(l.company.linkedinUrl[0]?.value) ?? ""}`)?.description ?? null,
    }));
    const budget = Math.max(0, Math.min(bmStep.estimate.apifyUsd, cap.apifyUsd - apifySpent));
    const ground = input.groundBusinessModel ?? null;
    const res = !targets.length || !ground || budget <= 0
      ? { findings: [], spentUsd: 0, stopped: !targets.length ? null : !ground ? "website grounding is not configured" : "budget", runId: null }
      : await checkBusinessModels(targets, required, { fetchPages: apifyPageFetcher(apify, now), ground },
        { maxUsd: budget, idempotencyKey: `${mission}:apify_website_content:business_model`, missionId: mission, now });
    apifySpent += res.spentUsd;
    for (const f of res.findings) {
      const { item, ...shown } = f;
      businessModel.set(f.companyKey, shown);
      if (item) siteEvidence.set(f.companyKey, [item]);
    }
    steps.push({ capability: bmStep.capability, provider: "apify",
      status: !targets.length ? "not_run" : res.stopped ? "failed" : "completed",
      reason: !targets.length ? (need ? "no company open only on the business model" : "the requested number already qualified")
        : res.stopped ?? `${res.findings.filter((x) => x.status === "verified_b2b").length} verified, ${res.findings.filter((x) => x.status === "likely_b2b").length} likely, ${res.findings.filter((x) => x.status === "unknown").length} unknown, ${res.findings.filter((x) => x.status === "not_b2b" || x.status === "mixed").length} not or mixed`,
      spend: { leadoceanRecords: 0, apifyUsd: r6(res.spentUsd) } });
    // The same engine decides again, now with the site evidence.
    if (siteEvidence.size) leads = verifyLeads({ ...spec.requirements, targetEntity: peopleStep ? "person" : "company" }, merged, [], { now, canonicalEvidence });
  }
  // 6 rank and project into the pipeline's lead shape (the ATLAS projection's input)
  const icp = icpFromSpec(spec);
  const eligibilityOf = (l: VerifiedLead): Eligibility => l.shared?.eligibility ?? "pending";
  const history = new Map(leads.map((l) => [l.company.key, historyOf({ domains: l.company.domain.map((d) => d.value), linkedinUrls: l.company.linkedinUrl.map((d) => d.value), providerIds: l.company.sources.map((s) => s.recordId) })]));
  const first = <T>(xs: { value: T }[]): T | null => xs[0]?.value ?? null;
  const postSignals = (slug: string | null) => (found.signals ?? []).filter((x) => slug && x.subject.key === `li:${slug}`);
  const ranked = rankLeads(leads.map((l) => {
    const p = bestContact(l);
    const slug = slugOf(first(l.company.linkedinUrl));
    return {
      leadKey: l.company.key, eligibility: eligibilityOf(l), title: p ? first(p.title) : null,
      companyText: [...l.company.industry.flatMap((c) => c.value), ...(slug && canonical.facts.get(`li:${slug}`)?.description ? [canonical.facts.get(`li:${slug}`)!.description!] : [])],
      industryLabels: [...new Set(l.company.industry.flatMap((c) => c.value))], employeeCount: null, hasPhone: p ? first(p.hasPhone) : null, signals: postSignals(slug),
    };
  }), icp, DEFAULT_WEIGHTS);
  const byKey = new Map(leads.map((l) => [l.company.key, l]));
  const out: PipelineLead[] = ranked.map((r) => {
    const l = byKey.get(r.leadKey)!;
    const p = bestContact(l);
    const h = history.get(l.company.key)!;
    const slug = slugOf(first(l.company.linkedinUrl));
    const facts = slug ? canonical.facts.get(`li:${slug}`) : undefined;
    const role = p ? classifyDecisionMakerRole(first(p.title)) : null;
    const blockers = h.reasons.filter((x) => !x.includes("already in Agentory"));
    const pv = p ? personVerification(p, l.company.domain.map((d) => d.value)) : null;
    if (pv?.status === "employment_mismatch") blockers.push("the provider's own record does not show this person currently at this company");
    return {
      version: PIPELINE_VERSION, leadKey: l.company.key, existingLeadIds: [...h.existingLeadIds], icpId: icp.id,
      company: {
        key: l.company.key, name: first(l.company.name), domain: first(l.company.domain), linkedinUrl: first(l.company.linkedinUrl),
        providerCompanyIds: [...new Set(l.company.sources.map((s) => `${s.provider}:${s.recordId}`))], employeeCount: null,
        industry: [...new Set(l.company.industry.flatMap((c) => c.value))],
        hq: facts?.hq && !evidenceRefused.some((x) => x.companyKey === l.company.key && x.source === COMPANY_RECORD_ACTOR.key)
          ? { country: facts.hq.country, region: null, city: facts.hq.text.split(",")[0].trim(), source: COMPANY_RECORD_ACTOR.key }
          : { country: null, region: null, city: null, source: null },
        description: facts?.description ?? null,
      },
      person: p ? { key: p.key, name: first(p.fullName), title: first(p.title), linkedinUrl: first(p.linkedinUrl),
        providerPersonId: p.sources.find((s) => s.provider === "leadocean")?.recordId ?? null, roleFamily: role!.role_family, hasPhoneFlag: first(p.hasPhone), verification: pv! } : null,
      statuses: {
        discovery: h.existingLeadIds.length ? "existing" : "new", screening: "passed", qualification: eligibilityOf(l),
        enrichment: "not_requested", outreachReadiness: h.blocksOutreach || pv?.status === "employment_mismatch" ? "blocked" : "not_ready",
      },
      screeningReasons: [],
      qualification: l.shared ? { checks: l.shared.checks, gaps: l.shared.gaps, disproven: l.shared.disproven, evidence_sources: l.shared.evidence_sources } : null,
      canonicalRecord: canonical.statuses.find((s) => s.companyKey === (slug ? `li:${slug}` : ""))?.state ?? "not_requested",
      signals: postSignals(slug), rank: r, phone: null, outreachBlockers: blockers,
      ...(businessModel.has(l.company.key) ? { businessModel: businessModel.get(l.company.key)! } : {}),
      // LIKELY, COUNTED ONLY WITH PERMISSION: pending on the business model ALONE, nothing
      // disproven, and the company's own pages make it likely. Never relabelled verified.
      ...(input.acceptLikely === true && eligibilityOf(l) === "pending" && (l.shared?.gaps ?? []).length === 1 && l.shared?.gaps[0] === "business_model"
        && !(l.shared?.disproven ?? []).length && businessModel.get(l.company.key)?.status === "likely_b2b" ? { acceptedAsLikely: true as const } : {}),
      provenance: { walkId: input.walkId, planHash: plan.planHash, runAt: at, providers: [...new Set(l.company.sources.map((s) => s.provider))],
        ...(l.company.conflicts.length ? { conflicts: l.company.conflicts.map((c) => ({ field: c.field, values: c.values.map((v) => ({ provider: v.provider, value: v.value })) })) } : {}) },
    };
  });

  const partial = steps.some((s) => s.status === "failed" || s.status === "partial");
  return {
    version: STRATEGY_RUN_VERSION, status: partial ? "partial" : "completed",
    reason: steps.filter((s) => s.status === "failed" || s.status === "partial").map((s) => `${s.capability}: ${s.reason}`).join("; ") || null,
    strategy: plan.strategy, planHash: plan.planHash, steps,
    queue: out.filter((x) => x.rank.lane === "queue"), review: out.filter((x) => x.rank.lane === "review"), excluded: out.filter((x) => x.rank.lane === "excluded"),
    evidenceRefused, limitations: plan.limitations, spend: { leadoceanRecords: loRecords, apifyUsd: r6(apifySpent) }, contactValues: [], pipeline: null,
  };
}
