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
import { discoverHiringCompanies, slugOf } from "./apifyDiscovery.ts";
import { COMPANY_RECORD_ACTOR, readCompanyRecords, type CanonicalRun } from "./canonical.ts";
import type { CheckpointStore } from "./checkpoint.ts";
import type { ExclusionIndex } from "./exclusions.ts";
import { NON_DECISION_TITLES } from "./icp.ts";
import { bestContact, runLeadPipeline, PIPELINE_VERSION, type PipelineLead, type PipelineRun } from "./pipeline.ts";
import { DEFAULT_WEIGHTS, rankLeads } from "./ranking.ts";
import {
  APOLLO_ACCESS_VALIDATED, hiringTitles, icpFromSpec, leadoceanDiscoveryRequirements,
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
  if (plan.strategy === "leadocean_only" || plan.strategy === "leadocean_plus_apify") return runLeadOceanLed(input, cap, now);
  if (plan.strategy === "apify_only" || plan.strategy === "apify_plus_leadocean") return runApifyLed(input, cap, now);
  return blocked(`strategy ${plan.strategy} has no executor`);
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

// ── Apify-led: discover by an open role ─────────────────────────────────────

async function runApifyLed(input: StrategyRunInput, cap: { leadoceanRecords: number; apifyUsd: number }, now: () => Date): Promise<StrategyRun> {
  const { plan, spec } = input;
  const at = now().toISOString();
  const mission = `ms:${input.walkId}:${plan.planHash}`;
  const steps: ProviderStepOutcome[] = [];
  const timed = withTimeout(input.apify, input.actorTimeoutMs ?? 120_000);
  // Every Apify run reserves its worst case in the durable ledger first: a re-run replays, an uncertain charge is never re-bought.
  const apify = timed ? ledgeredInvoker(timed, input.ledger, { workspaceId: input.workspaceId, missionId: `${mission}:apify`, maxUsd: cap.apifyUsd }) : null;

  // 1 discovery by an open role
  const jobStep = plan.steps.find((s) => s.capability === "apify.linkedin_job_search")!;
  const titles = hiringTitles(spec);
  const found = await discoverHiringCompanies(spec, titles, apify, { maxItems: jobStep.maxItems, maxUsd: Math.min(cap.apifyUsd, jobStep.estimate.apifyUsd), now: now(), idPrefix: mission, missionId: mission });
  steps.push({ capability: jobStep.capability, provider: "apify", status: found.stopped ? "failed" : "completed",
    reason: found.stopped ?? (Object.keys(found.dropped).length ? `dropped postings: ${Object.entries(found.dropped).map(([k, v]) => `${k} ${v}`).join(", ")}` : null),
    spend: { leadoceanRecords: 0, apifyUsd: r6(found.spentUsd) } });
  if (found.stopped && !found.companies.length) {
    return { ...emptyRun(input, `discovery failed: ${found.stopped}`), status: "blocked", steps, spend: { leadoceanRecords: 0, apifyUsd: r6(found.spentUsd) } };
  }
  let apifySpent = found.spentUsd;

  // 2 history (identity only here; holds block outreach, existing Leads keep their ids)
  const historyOf = (c: { domains: string[]; linkedinUrls: string[]; providerIds: string[] }) => input.existing.company(c);

  // 3 company records: identity, HQ, size — as many as the ceiling allows; the rest stay pending
  const recStep = plan.steps.find((s) => s.capability === "apify.linkedin_company_record")!;
  const targets = found.companies.map((c) => ({ companyKey: `li:${slugOf(c.linkedinUrl)}`, linkedinUrl: c.linkedinUrl ?? "" }));
  const recBudget = Math.max(0, Math.min(recStep.estimate.apifyUsd, cap.apifyUsd - apifySpent));
  const fits = Math.max(0, Math.floor((recBudget - COMPANY_RECORD_ACTOR.perStartUsd + 1e-9) / COMPANY_RECORD_ACTOR.perItemUsd));
  const bought = targets.slice(0, fits);
  const unaffordable = targets.slice(fits);
  const canonical: CanonicalRun = bought.length
    ? await readCompanyRecords(bought, apify, { maxUsd: recBudget, now: now(), idPrefix: mission })
    : { evidence: new Map(), facts: new Map(), statuses: [], spentUsd: 0, stopped: null };
  for (const t of unaffordable) canonical.statuses.push({ companyKey: t.companyKey, state: "skipped_budget", reason: `the approved Apify ceiling ($${cap.apifyUsd}) is exhausted; left needs_verification` });
  apifySpent += canonical.spentUsd;
  steps.push({ capability: recStep.capability, provider: "apify",
    status: canonical.stopped ? "failed" : unaffordable.length ? "partial" : "completed",
    reason: canonical.stopped ?? (unaffordable.length ? `budget: ${unaffordable.length} compan${unaffordable.length === 1 ? "y" : "ies"} left unverified` : null),
    spend: { leadoceanRecords: 0, apifyUsd: r6(canonical.spentUsd) } });

  // Evidence admitted per source, by its own identity.
  const evidenceRefused: StrategyRun["evidenceRefused"] = [];
  const recordOf = (slug: string | null) => (slug ? canonical.evidence.get(`li:${slug}`) ?? [] : []);
  const canonicalEvidence = (ids: { key: string; domains: string[]; linkedinUrls: string[] }): readonly EvidenceItem[] => {
    const slugs = [...new Set(ids.linkedinUrls.map(slugOf).filter((s): s is string => !!s))];
    const out: EvidenceItem[] = [];
    for (const slug of slugs) {
      for (const [source, items] of [["apify_linkedin_job_search", found.evidence.get(slug) ?? []], [COMPANY_RECORD_ACTOR.key, recordOf(slug)]] as const) {
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
    return out;
  };

  // Disproven companies get no people bought for them.
  const firstPass = verifyLeads({ ...spec.requirements, targetEntity: "company" }, mergeRecords(found.companies, []), [], { now, canonicalEvidence });
  const disproven = new Set(firstPass.filter((l) => l.shared?.eligibility === "ineligible").flatMap((l) => l.company.domain.map((d) => d.value)));

  // 4 decision-makers by exact domain
  let people: ProviderPerson[] = [];
  let loCompanies: ProviderCompany[] = [];
  let loRecords = 0;
  const peopleStep = plan.steps.find((s) => s.capability === "leadocean.people_by_domain");
  if (peopleStep) {
    const domains = [...new Set(found.companies.map((c) => c.domain).filter((d): d is string => !!d && !disproven.has(d)))];
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
  const leads = verifyLeads({ ...spec.requirements, targetEntity: peopleStep ? "person" : "company" }, merged, [], { now, canonicalEvidence });
  // 6 rank and project into the pipeline's lead shape (the ATLAS projection's input)
  const icp = icpFromSpec(spec);
  const eligibilityOf = (l: VerifiedLead): Eligibility => l.shared?.eligibility ?? "pending";
  const history = new Map(leads.map((l) => [l.company.key, historyOf({ domains: l.company.domain.map((d) => d.value), linkedinUrls: l.company.linkedinUrl.map((d) => d.value), providerIds: l.company.sources.map((s) => s.recordId) })]));
  const first = <T>(xs: { value: T }[]): T | null => xs[0]?.value ?? null;
  const ranked = rankLeads(leads.map((l) => {
    const p = bestContact(l);
    const slug = slugOf(first(l.company.linkedinUrl));
    return {
      leadKey: l.company.key, eligibility: eligibilityOf(l), title: p ? first(p.title) : null,
      companyText: [...l.company.industry.flatMap((c) => c.value), ...(slug && canonical.facts.get(`li:${slug}`)?.description ? [canonical.facts.get(`li:${slug}`)!.description!] : [])],
      industryLabels: [...new Set(l.company.industry.flatMap((c) => c.value))], employeeCount: null, hasPhone: p ? first(p.hasPhone) : null, signals: [],
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
        providerPersonId: p.sources.find((s) => s.provider === "leadocean")?.recordId ?? null, roleFamily: role!.role_family, hasPhoneFlag: first(p.hasPhone) } : null,
      statuses: {
        discovery: h.existingLeadIds.length ? "existing" : "new", screening: "passed", qualification: eligibilityOf(l),
        enrichment: "not_requested", outreachReadiness: h.blocksOutreach ? "blocked" : "not_ready",
      },
      screeningReasons: [],
      qualification: l.shared ? { checks: l.shared.checks, gaps: l.shared.gaps, disproven: l.shared.disproven, evidence_sources: l.shared.evidence_sources } : null,
      canonicalRecord: canonical.statuses.find((s) => s.companyKey === (slug ? `li:${slug}` : ""))?.state ?? "not_requested",
      signals: [], rank: r, phone: null, outreachBlockers: blockers,
      provenance: { walkId: input.walkId, planHash: plan.planHash, runAt: at, providers: [...new Set(l.company.sources.map((s) => s.provider))] },
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
