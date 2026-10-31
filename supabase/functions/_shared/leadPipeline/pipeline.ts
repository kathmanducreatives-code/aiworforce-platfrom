// The lead pipeline, end to end, for one ICP walk:
//
//   1 discovery     LeadOcean people search (runDiscovery: approval, ledger,
//                   idempotent pages), narrowed by the ICP and the checkpoint's
//                   excludeIds so nothing already bought is bought again
//   2 dedupe        merged by identifiers (normalize.ts, person_group_id);
//                   companies already walked → duplicate_prior_walk
//   3 history       existing Leads keep their Lead ID; CRM relationships and
//                   holds block outreach (exclusions.ts)
//   4 canonical     Apify company record by LinkedIn URL → the Apify engine's
//                   own evidence items → the shared engine re-decides (HQ, size)
//   5 signals       Apify posts / jobs + LeadOcean funding, for ELIGIBLE leads
//                   only; unavailable → unknown, never a block
//   6 ranking       ordering only; eligibility stays the shared engine's
//   7 phones        LeadOcean phone lookup for eligible decision-makers with a
//                   has_phone flag, top-ranked first, under a lookup cap
//   8 queue         normalized leads with four separate statuses + metrics
//
// Every metered step has its own ceiling, set by the caller's approval; a null
// approval for a step means that step does not run (and costs nothing). The
// shared engine (evaluateEligibility via verifyLeads) is the only qualifier.

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { DiscoveryAdapter, AdapterDeps } from "../discoveryProviders/adapter.ts";
import type { DiscoveryApproval, EnrichmentAuthorization, UsageLedger } from "../discoveryProviders/budget.ts";
import type { CanonicalCompany, CanonicalPerson, MergeResult } from "../discoveryProviders/normalize.ts";
import { runDiscovery, type DiscoveryRun } from "../discoveryProviders/orchestrator.ts";
import { planDiscovery, type DiscoveryPlan, type PlanLimits, type ProviderConnectionState } from "../discoveryProviders/routing.ts";
import { verifyLeads, type VerifiedLead } from "../discoveryProviders/verify.ts";
import type { SharedQualification } from "../discoveryProviders/sharedQualification.ts";
import type { EvidenceItem } from "../candidateObservation.ts";
import type { Eligibility } from "../candidateEligibility.ts";
import { classifyDecisionMakerRole } from "../decisionMaker/roleFamily.ts";
import { compileIcp, icpContradictions, leadoceanHints, type IcpConfig } from "./icp.ts";
import type { DiscoveryRequirements } from "../discoveryProviders/types.ts";
import { advance, newCheckpoint, resumeHints, type CheckpointStore, type WalkCheckpoint } from "./checkpoint.ts";
import { ExclusionIndex, type ExclusionVerdict } from "./exclusions.ts";
import { readCompanyRecords, type CanonicalRun } from "./canonical.ts";
import { collectSignals, type Signal, type SignalPlan, type SignalStatus } from "./signals.ts";
import { DEFAULT_WEIGHTS, rankLeads, type RankResult, type RankWeights } from "./ranking.ts";
import { employmentFrom, enrichPhones, redactPhoneRecord, type PhoneClass, type PhoneRecord, type PhoneTarget } from "./phones.ts";
import { ledgeredInvoker } from "./apifyInvoker.ts";
import { EMPTY_FUNNEL, estimateCandidates, yieldReport, type CandidateEstimate, type FunnelCounts, type YieldReport } from "./metrics.ts";

export const PIPELINE_VERSION = "lead-pipeline-v1" as const;

export type DiscoveryStatus = "new" | "existing" | "duplicate_prior_walk";
export type EnrichmentStatus = "not_requested" | "not_eligible_for_lookup" | "skipped" | PhoneClass;
/**
 * What happened before any Apify spend. `screened_out`: the discovery row's OWN
 * data contradicts a hard requirement (e.g. LeadOcean reports 900 employees for
 * an 11–200 ICP), so no verification is bought for it. That is a cost decision,
 * not a disproof: qualification stays the shared engine's (`pending`), and the
 * lead is neither queued, reviewed nor written to the Leads tables.
 */
export type ScreeningStatus = "passed" | "screened_out" | "prior_walk";
export type OutreachReadiness =
  /** Eligible, decision-maker, person-associated number, no hold — a human reviews before any contact. */
  | "ready_for_review"
  | "blocked"
  | "not_ready";

export interface PipelineLead {
  version: typeof PIPELINE_VERSION;
  leadKey: string;
  /** Agentory's existing Lead id(s); empty for a new candidate. */
  existingLeadIds: string[];
  icpId: string;
  company: {
    key: string; name: string | null; domain: string | null; linkedinUrl: string | null;
    providerCompanyIds: string[]; employeeCount: number | null; industry: string[];
    hq: { country: string | null; region: string | null; city: string | null; source: string | null };
    description: string | null;
  };
  person: {
    key: string; name: string | null; title: string | null; linkedinUrl: string | null;
    providerPersonId: string | null; roleFamily: string; hasPhoneFlag: boolean | null;
  } | null;
  statuses: { discovery: DiscoveryStatus; screening: ScreeningStatus; qualification: Eligibility; enrichment: EnrichmentStatus; outreachReadiness: OutreachReadiness };
  /** Why the lead was screened out before verification (provider-reported, unverified); empty when it passed. */
  screeningReasons: string[];
  qualification: Pick<SharedQualification, "checks" | "gaps" | "disproven" | "evidence_sources"> | null;
  canonicalRecord: CanonicalRun["statuses"][number]["state"] | "not_requested";
  signals: Signal[];
  rank: RankResult;
  /** Report-safe: no number in any form (contactValues carries it, separately). */
  phone: PhoneRecord | null;
  outreachBlockers: string[];
  provenance: { walkId: string; planHash: string; runAt: string; providers: string[] };
}

export interface PipelineApprovals {
  discovery: DiscoveryApproval | null;
  /** USD ceiling for Apify company records (step 4); null = do not read. */
  canonicalMaxUsd: number | null;
  /** USD ceiling and plan for Apify signals (step 5); null = do not collect. */
  signals: (Omit<SignalPlan, "relevantRoles"> & { relevantRoles?: RegExp }) | null;
  /** At most this many phone lookups (LeadOcean records), by the approver; null = none. */
  phoneLookups: { maxLookups: number; approvedBy: string; approvedAt: string } | null;
}

export interface PipelineInput {
  workspaceId: string;
  walkId: string;
  icp: IcpConfig;
  /**
   * Requirements compiled from an interpreted request (the strategy planner,
   * `strategy.ts`), instead of compiling the ICP's own fixed query. Their
   * `criteria` stay the shared engine's input untouched; `hard` is what the
   * LeadOcean search is planned on. The ICP still supplies narrowing and ranking.
   */
  requirements?: DiscoveryRequirements;
  connections: ProviderConnectionState[];
  limits?: Partial<PlanLimits>;
  approvals: PipelineApprovals;
  leadocean: DiscoveryAdapter | null;
  leadoceanDeps: AdapterDeps | null;
  apify: ActorInvoker | null;
  ledger: UsageLedger;
  checkpoints: CheckpointStore;
  existing: ExclusionIndex;
  weights?: RankWeights;
  now?: () => Date;
  /** Per actor run; a run that does not finish in time counts its worst case and stops that step. */
  actorTimeoutMs?: number;
  /** The plan is computed and returned, nothing is bought. */
  dryRun?: boolean;
  /** USD per LeadOcean record for cost reporting (Free plan: 0 monetary); null = report records only. */
  usdPerLeadOceanRecord?: number | null;
  /** For tests: the phone lookup call. */
  phoneCall?: Parameters<typeof enrichPhones>[0]["call"];
}

export interface PipelineRun {
  version: typeof PIPELINE_VERSION;
  status: "completed" | "dry_run" | "blocked" | "partial";
  reason: string | null;
  plan: DiscoveryPlan;
  discovery: Pick<DiscoveryRun, "status" | "reason" | "steps" | "counts" | "credits"> | null;
  canonical: { spentUsd: number; stopped: string | null; read: number } | null;
  signals: { spentUsd: number; stopped: string | null; statuses: SignalStatus[]; skipped: { companyKey: string; reason: string }[] } | null;
  phones: { recordsCharged: number; stopped: string | null; skipped: { personKey: string; reason: string }[] } | null;
  queue: PipelineLead[];
  review: PipelineLead[];
  excluded: PipelineLead[];
  funnel: FunnelCounts;
  estimates: CandidateEstimate[];
  yield: YieldReport;
  /**
   * The numbers the lookups returned, keyed by person — SENSITIVE: for the
   * caller to store in the contact record under the enrichment authorization.
   * Never logged, never in a report; every other field of the run is report-safe.
   */
  contactValues: { personKey: string; leadId: string | null; e164: string; class: PhoneClass }[];
  checkpoint: WalkCheckpoint;
  spend: { leadoceanRecords: number; apifyUsd: number };
}

function withTimeout(invoke: ActorInvoker | null, ms: number): ActorInvoker | null {
  if (!invoke) return null;
  return (key, input, opts) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { const e = new Error(`actor run exceeded ${ms} ms`); e.name = "TimeoutError"; reject(e); }, ms);
    invoke(key, input, opts).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const first = <T>(xs: { value: T }[]): T | null => xs[0]?.value ?? null;

/** The lead's best decision-maker contact (founder first), or null. */
export function bestContact(l: VerifiedLead): CanonicalPerson | null {
  const ok = l.contacts.filter((c) => c.status !== "rejected");
  const order = { founder: 0, executive_revenue: 1, sales_leadership: 2, growth_leadership: 3, revenue_operations: 4, sales_operations: 5, other: 6 } as const;
  const fam = (p: CanonicalPerson) => order[classifyDecisionMakerRole(first(p.title)).role_family];
  return ok.map((c) => c.person).sort((a, b) => fam(a) - fam(b) || a.key.localeCompare(b.key))[0] ?? null;
}

export async function runLeadPipeline(input: PipelineInput): Promise<PipelineRun> {
  const now = input.now ?? (() => new Date());
  const at = now().toISOString();
  const cp = (await input.checkpoints.load(input.workspaceId, input.walkId)) ?? newCheckpoint(input.workspaceId, input.walkId, input.icp.id, at);
  const resume = resumeHints(cp);
  const extra = resume.excludeIds ? { excludeIds: resume.excludeIds } : {};
  const compiled = input.requirements
    ? { requirements: { ...input.requirements, providerHints: { leadocean: leadoceanHints(input.icp, { ...(input.requirements.providerHints?.leadocean ?? {}), ...extra }) } } }
    : compileIcp(input.icp, extra);
  const plan = planDiscovery({ requirements: compiled.requirements, connections: input.connections, selection: ["leadocean"], limits: input.limits });
  // One mission id per purchase position: a crashed run re-run before its checkpoint saved replays from the ledger.
  const missionId = `lp:${input.walkId}:r${cp.recordsBought}`;
  const base = (status: PipelineRun["status"], reason: string | null): PipelineRun => ({
    version: PIPELINE_VERSION, status, reason, plan, discovery: null, canonical: null, signals: null, phones: null,
    queue: [], review: [], excluded: [], funnel: { ...EMPTY_FUNNEL }, estimates: [], contactValues: [],
    yield: yieldReport({ funnel: EMPTY_FUNNEL, leadoceanRecords: 0, apifyUsd: 0, usdPerLeadOceanRecord: input.usdPerLeadOceanRecord ?? null, rejections: [], enrichmentSkips: [] }), checkpoint: cp, spend: { leadoceanRecords: 0, apifyUsd: 0 },
  });
  if (resume.blocked) return base("blocked", resume.blocked);
  if (cp.icpId !== input.icp.id) return base("blocked", `walk ${input.walkId} belongs to ICP ${cp.icpId}`);
  // A request no company can satisfy is refused as such, before any plan is bought.
  const contradictions = icpContradictions(input.icp);
  if (contradictions.length) return base("blocked", `contradictory_requirements: ${contradictions.join("; ")}`);
  if (plan.status !== "ready") return base("blocked", plan.blockedReason);
  if (input.dryRun) return base("dry_run", null);

  // 1 discovery
  const run = await runDiscovery({
    workspaceId: input.workspaceId, missionId, requirements: compiled.requirements, plan, approval: input.approvals.discovery,
    adapters: input.leadocean ? { leadocean: input.leadocean } : {}, verifier: null, ledger: input.ledger, now,
  });
  const discovery = { status: run.status, reason: run.reason, steps: run.steps, counts: run.counts, credits: run.credits };
  if (run.status === "blocked" || run.status === "failed") return { ...base("blocked", run.reason ?? run.status), discovery };
  const leadoceanRecords = run.credits.leadocean ?? 0;

  // 2 dedupe against prior walks
  const priorCompanies = new Set(cp.seenCompanyKeys);
  // 3 history
  const history = new Map<string, { company: ExclusionVerdict; person: ExclusionVerdict | null }>();
  for (const l of run.leads) {
    const c = l.company;
    const p = bestContact(l);
    history.set(c.key, {
      company: input.existing.company({ domains: c.domain.map((d) => d.value), linkedinUrls: c.linkedinUrl.map((d) => d.value), providerIds: c.sources.map((s) => s.recordId) }),
      person: p ? input.existing.person({ linkedinUrls: p.linkedinUrl.map((d) => d.value), providerIds: p.sources.map((s) => s.recordId) }) : null,
    });
  }

  // 3b screening: a lead its own discovery row contradicts gets no paid verification.
  const screened = new Map<string, string[]>();
  for (const l of run.leads) {
    if (l.status === "rejected" && l.rejectionBasis === "provider_reported" && !priorCompanies.has(l.company.key)) {
      screened.set(l.company.key, l.checks.filter((c) => c.outcome === "contradicted").map((c) => `${c.label}: ${c.note} (provider-reported, unverified)`));
    }
  }

  // 4 canonical company records → shared engine re-decides
  const timeout = input.actorTimeoutMs ?? 120_000;
  // Every Apify run is reserved in the durable ledger first (replay on re-run, never re-bought after an uncertain charge).
  const apifyCeiling = (input.approvals.canonicalMaxUsd ?? 0) + (input.approvals.signals?.maxUsd ?? 0);
  const timed = withTimeout(input.apify, timeout);
  const apify = timed ? ledgeredInvoker(timed, input.ledger, { workspaceId: input.workspaceId, missionId: `${missionId}:apify`, maxUsd: apifyCeiling }) : null;
  let canonical: CanonicalRun | null = null;
  let leads = run.leads;
  if (input.approvals.canonicalMaxUsd != null) {
    const targets = run.leads.filter((l) => !screened.has(l.company.key) && l.status !== "rejected" && !priorCompanies.has(l.company.key))
      .map((l) => ({ companyKey: l.company.key, linkedinUrl: first(l.company.linkedinUrl) ?? "" }));
    canonical = await readCompanyRecords(targets, apify, { maxUsd: input.approvals.canonicalMaxUsd, now: now(), idPrefix: missionId });
    if (canonical.evidence.size) {
      const merged: MergeResult = {
        companies: run.leads.map((l) => l.company),
        people: run.leads.flatMap((l) => l.contacts.map((c) => c.person)),
        stats: { companyRows: 0, personRows: 0, companiesMerged: 0, peopleMerged: 0, identityConflicts: 0 },
      };
      const ev = canonical.evidence;
      leads = verifyLeads(compiled.requirements, merged, [], { now, canonicalEvidence: (ids): readonly EvidenceItem[] => ev.get(ids.key) ?? [] });
    }
  }
  const eligibilityOf = (l: VerifiedLead): Eligibility => l.shared?.eligibility ?? "pending";

  // 5 signals: eligible, not previously walked, and not held from outreach
  // (signals only rank a lead for outreach; a held lead cannot be contacted, so
  // buying its posts and jobs is spend with no use).
  const blocked = (l: VerifiedLead) => { const h = history.get(l.company.key); return !!(h?.company.blocksOutreach || h?.person?.blocksOutreach); };
  const signalSkipped = leads.filter((l) => eligibilityOf(l) === "eligible" && !priorCompanies.has(l.company.key) && blocked(l))
    .map((l) => ({ companyKey: l.company.key, reason: "outreach_blocked: an existing hold or CRM relationship blocks outreach; signals not bought" }));
  const eligibleLeads = leads.filter((l) => eligibilityOf(l) === "eligible" && !priorCompanies.has(l.company.key) && !blocked(l));
  let signalRun: Awaited<ReturnType<typeof collectSignals>> | null = null;
  if (input.approvals.signals) {
    const s = input.approvals.signals;
    const relevantRoles = s.relevantRoles ?? /\b(sdr|bdr|sales development|account executive|revenue|demand gen|growth|marketing|outbound)\b/i;
    signalRun = await collectSignals(eligibleLeads.map((l) => {
      const p = bestContact(l);
      const f = l.company.funding[0];
      return { companyKey: l.company.key, companyLinkedinUrl: first(l.company.linkedinUrl), companyName: first(l.company.name),
        personKey: p?.key ?? null, personLinkedinUrl: p ? first(p.linkedinUrl) : null, funding: f?.value ?? null, fundingRecordId: f?.recordId ?? null };
    }), { ...s, relevantRoles }, apify, now(), missionId);
  }
  const signalsFor = (l: VerifiedLead, p: CanonicalPerson | null) =>
    (signalRun?.signals ?? []).filter((s) => s.subject.key === l.company.key || (p && s.subject.key === p.key));

  // 6 ranking
  const ranked = rankLeads(leads.map((l) => {
    const p = bestContact(l);
    return {
      leadKey: l.company.key, eligibility: priorCompanies.has(l.company.key) ? "ineligible" : eligibilityOf(l), title: p ? first(p.title) : null,
      companyText: [...l.company.industry.flatMap((c) => c.value), ...l.company.keywords.flatMap((c) => c.value), ...(p ? p.headline.map((h) => h.value) : []),
        ...(canonical?.facts.get(l.company.key)?.description ? [canonical!.facts.get(l.company.key)!.description!] : [])],
      industryLabels: [...new Set(l.company.industry.flatMap((c) => c.value))], employeeCount: first(l.company.employeeCount),
      hasPhone: p ? first(p.hasPhone) : null, signals: signalsFor(l, p),
    };
  }), input.icp, input.weights ?? DEFAULT_WEIGHTS).map((r) => screened.has(r.leadKey)
    ? { ...r, lane: "excluded" as const, explanation: `Screened out before verification (no Apify spend): ${screened.get(r.leadKey)!.join("; ")}.` }
    : r);
  const rankOf = new Map(ranked.map((r) => [r.leadKey, r]));

  // 7 phones: eligible decision-makers, top-ranked first, at most maxLookups
  const byKey = new Map(leads.map((l) => [l.company.key, l]));
  const targets: PhoneTarget[] = [];
  for (const r of ranked) {
    const l = byKey.get(r.leadKey)!;
    const p = bestContact(l);
    if (!p) continue;
    const h = history.get(l.company.key);
    targets.push({
      personKey: p.key, leadId: h?.person?.existingLeadIds[0] ?? h?.company.existingLeadIds[0] ?? null,
      providerPersonId: p.sources.find((s) => s.provider === "leadocean")?.recordId ?? null, linkedinUrl: first(p.linkedinUrl),
      eligibility: r.lane === "queue" ? "eligible" : r.eligibility === "eligible" ? "pending" : r.eligibility,
      hasPhone: first(p.hasPhone), outreachBlocked: !!(h?.company.blocksOutreach || h?.person?.blocksOutreach),
      employment: employmentFrom({ providerSaysCurrent: first(p.employerIsCurrent), providerEmployerDomain: first(l.company.domain), companyDomains: l.company.domain.map((d) => d.value) }),
    });
  }
  let phones: Awaited<ReturnType<typeof enrichPhones>> | null = null;
  if (input.approvals.phoneLookups && input.leadoceanDeps) {
    const a = input.approvals.phoneLookups;
    const allowed = targets.filter((t) => t.eligibility === "eligible" && t.hasPhone === true && !t.outreachBlocked && t.employment.status !== "mismatch")
      .slice(0, a.maxLookups).map((t) => t.personKey);
    // Its own ledger scope: the ledger's provider cap sums a mission's LeadOcean usage,
    // so sharing the discovery mission id would count discovery records against the lookup cap.
    const phoneMission = `${missionId}:phones`;
    const authorization: EnrichmentAuthorization = { kind: "enrichment", workspaceId: input.workspaceId, missionId: phoneMission, personKeys: allowed,
      revealEmail: false, phones: true, maxCredits: a.maxLookups, approvedBy: a.approvedBy, approvedAt: a.approvedAt };
    phones = await enrichPhones({ workspaceId: input.workspaceId, missionId: phoneMission, authorization, targets, deps: input.leadoceanDeps, ledger: input.ledger, call: input.phoneCall });
  }
  const phoneOf = new Map((phones?.records ?? []).map((r) => [r.personKey, r]));
  const skippedOf = new Map((phones?.skipped ?? []).map((s) => [s.personKey, s.reason]));

  // 8 queue
  const out: PipelineLead[] = ranked.map((r) => {
    const l = byKey.get(r.leadKey)!;
    const p = bestContact(l);
    const h = history.get(l.company.key)!;
    const ph = p ? phoneOf.get(p.key) ?? null : null;
    const discoveryStatus: DiscoveryStatus = priorCompanies.has(l.company.key) ? "duplicate_prior_walk"
      : h.company.existingLeadIds.length || h.person?.existingLeadIds.length ? "existing" : "new";
    const qualification = eligibilityOf(l);
    const enrichment: EnrichmentStatus = ph ? ph.class : !input.approvals.phoneLookups ? "not_requested"
      : p && skippedOf.has(p.key) ? (r.lane === "queue" ? "skipped" : "not_eligible_for_lookup") : "not_eligible_for_lookup";
    const blockers = [...h.company.reasons.filter((x) => !x.includes("already in Agentory")), ...(h.person?.reasons.filter((x) => !x.includes("already in Agentory")) ?? [])];
    if (ph?.doNotCall) blockers.push("number is flagged do-not-call");
    const role = p ? classifyDecisionMakerRole(first(p.title)) : null;
    const dm = !!role && role.role_family !== "other";
    const readiness: OutreachReadiness = blockers.length && (h.company.blocksOutreach || h.person?.blocksOutreach || ph?.doNotCall) ? "blocked"
      : r.lane === "queue" && dm && (ph?.class === "unverified_person_associated" || ph?.class === "verified_person_direct") ? "ready_for_review" : "not_ready";
    const screening: ScreeningStatus = priorCompanies.has(l.company.key) ? "prior_walk" : screened.has(l.company.key) ? "screened_out" : "passed";
    return {
      version: PIPELINE_VERSION, leadKey: l.company.key,
      existingLeadIds: [...new Set([...h.company.existingLeadIds, ...(h.person?.existingLeadIds ?? [])])], icpId: input.icp.id,
      company: {
        key: l.company.key, name: first(l.company.name), domain: first(l.company.domain), linkedinUrl: first(l.company.linkedinUrl),
        providerCompanyIds: [...new Set(l.company.sources.map((s) => `${s.provider}:${s.recordId}`))], employeeCount: first(l.company.employeeCount),
        industry: [...new Set(l.company.industry.flatMap((c) => c.value))],
        // The provider's HQ claim, else the canonical record's HQ-flagged location (the one qualification read).
        hq: first(l.company.hqCountry) || !canonical?.facts.get(l.company.key)?.hq
          ? { country: first(l.company.hqCountry), region: first(l.company.hqRegion), city: first(l.company.hqCity), source: first(l.company.hqCountry) ? "provider" : null }
          : { country: canonical.facts.get(l.company.key)!.hq!.country, region: null, city: canonical.facts.get(l.company.key)!.hq!.text.split(",")[0].trim(), source: "apify_linkedin_company_details" },
        description: canonical?.facts.get(l.company.key)?.description ?? null,
      },
      person: p ? { key: p.key, name: first(p.fullName), title: first(p.title), linkedinUrl: first(p.linkedinUrl),
        providerPersonId: p.sources.find((s) => s.provider === "leadocean")?.recordId ?? null, roleFamily: role!.role_family, hasPhoneFlag: first(p.hasPhone) } : null,
      statuses: { discovery: discoveryStatus, screening, qualification, enrichment, outreachReadiness: readiness },
      screeningReasons: screened.get(l.company.key) ?? [],
      qualification: l.shared ? { checks: l.shared.checks, gaps: l.shared.gaps, disproven: l.shared.disproven, evidence_sources: l.shared.evidence_sources } : null,
      canonicalRecord: canonical?.statuses.find((s) => s.companyKey === l.company.key)?.state ?? "not_requested",
      signals: signalsFor(l, p), rank: rankOf.get(l.company.key)!, phone: ph ? redactPhoneRecord(ph) : null, outreachBlockers: blockers,
      provenance: { walkId: input.walkId, planHash: plan.planHash, runAt: at, providers: [...new Set(l.company.sources.map((s) => s.provider))] },
    };
  });

  // Metrics
  const people = out.filter((x) => x.person);
  const funnel: FunnelCounts = {
    discovered: run.steps.reduce((a, s) => a + s.rows, 0),
    unique: out.length,
    newToAgentory: out.filter((x) => x.statuses.discovery === "new").length,
    eligible: out.filter((x) => x.statuses.discovery === "new" && x.statuses.qualification === "eligible").length,
    pending: out.filter((x) => x.statuses.qualification === "pending" && x.statuses.screening !== "screened_out").length,
    screenedOut: out.filter((x) => x.statuses.screening === "screened_out").length,
    ineligible: out.filter((x) => x.statuses.qualification === "ineligible").length,
    decisionMaker: out.filter((x) => x.statuses.discovery === "new" && x.statuses.qualification === "eligible" && x.person && x.person.roleFamily !== "other").length,
    hasPhoneFlag: out.filter((x) => x.statuses.discovery === "new" && x.statuses.qualification === "eligible" && x.person && x.person.roleFamily !== "other" && x.person.hasPhoneFlag === true).length,
    lookedUp: (phones?.records ?? []).length,
    personAssociated: people.filter((x) => x.phone?.class === "unverified_person_associated" || x.phone?.class === "verified_person_direct").length,
    verifiedDirect: people.filter((x) => x.phone?.class === "verified_person_direct").length,
    switchboard: people.filter((x) => x.phone?.class === "company_switchboard").length,
    invalidOrMismatched: people.filter((x) => x.phone?.class === "invalid_or_mismatched").length,
    noNumber: people.filter((x) => x.phone?.class === "no_number").length,
    outreachReady: out.filter((x) => x.statuses.outreachReadiness === "ready_for_review").length,
  };
  const estimates = [50, 100].flatMap((n) => [estimateCandidates(funnel, n, "person_associated"), estimateCandidates(funnel, n, "verified_direct")]);

  // Checkpoint
  const personIds = run.leads.flatMap((l) => l.contacts.flatMap((c) => c.person.sources.filter((s) => s.provider === "leadocean").map((s) => s.recordId)));
  const moreStep = run.steps.find((s) => s.provider === "leadocean");
  const next = advance(cp, { personIds, companyKeys: out.map((x) => x.company.key), pages: moreStep?.pages ?? 0, records: leadoceanRecords, morePages: (moreStep?.rows ?? 0) > 0, now: at });
  await input.checkpoints.save(next);

  const apifyUsd = Math.round(((canonical?.spentUsd ?? 0) + (signalRun?.spentUsd ?? 0)) * 1e6) / 1e6;
  const partial = run.status === "partial" || !!canonical?.stopped || !!signalRun?.stopped || !!phones?.stopped;
  return {
    version: PIPELINE_VERSION, status: partial ? "partial" : "completed",
    reason: [run.reason, canonical?.stopped && `canonical: ${canonical.stopped}`, signalRun?.stopped && `signals: ${signalRun.stopped}`, phones?.stopped && `phones: ${phones.stopped}`].filter(Boolean).join("; ") || null,
    plan, discovery,
    canonical: canonical ? { spentUsd: canonical.spentUsd, stopped: canonical.stopped, read: canonical.statuses.filter((s) => s.state === "read").length } : null,
    signals: signalRun ? { spentUsd: signalRun.spentUsd, stopped: signalRun.stopped, statuses: signalRun.statuses, skipped: signalSkipped } : null,
    phones: phones ? { recordsCharged: phones.recordsCharged, stopped: phones.stopped, skipped: phones.skipped } : null,
    queue: out.filter((x) => x.rank.lane === "queue"), review: out.filter((x) => x.rank.lane === "review"), excluded: out.filter((x) => x.rank.lane === "excluded"),
    funnel, estimates, checkpoint: next,
    yield: yieldReport({
      funnel, leadoceanRecords: leadoceanRecords + (phones?.recordsCharged ?? 0), apifyUsd, usdPerLeadOceanRecord: input.usdPerLeadOceanRecord ?? null,
      rejections: out.flatMap((x) => x.statuses.qualification === "ineligible" ? (x.qualification?.disproven.length ? x.qualification.disproven.map((d) => `disproven:${d}`) : [x.statuses.discovery === "duplicate_prior_walk" ? "duplicate_prior_walk" : "ineligible"])
        : x.statuses.screening === "screened_out" ? ["screened_out"]
        : x.statuses.qualification === "pending" ? (x.qualification?.gaps ?? []).map((g) => `unknown:${g}`) : []),
      enrichmentSkips: (phones?.skipped ?? []).map((k) => k.reason.replace(/\(.*\)/, "").trim()),
    }),
    contactValues: (phones?.records ?? []).filter((x) => x.e164).map((x) => ({ personKey: x.personKey, leadId: x.leadId, e164: x.e164!, class: x.class })),
    spend: { leadoceanRecords: leadoceanRecords + (phones?.recordsCharged ?? 0), apifyUsd },
  };
}

/** The exact worst case a pipeline approval allows, before anything runs. */
export function worstCase(plan: DiscoveryPlan, a: PipelineApprovals): { leadoceanRecords: number; apifyUsd: number; lines: string[] } {
  const disc = plan.estimatedCredits.leadocean ?? 0;
  const phones = a.phoneLookups?.maxLookups ?? 0;
  const canon = a.canonicalMaxUsd ?? 0;
  const sig = a.signals?.maxUsd ?? 0;
  return {
    leadoceanRecords: disc + phones,
    apifyUsd: Math.round((canon + sig) * 1e6) / 1e6,
    lines: [
      `LeadOcean discovery: ≤${disc} records (${plan.steps.map((s) => `${s.maxPages} page(s) × ≤${s.pageSize}`).join(", ")})`,
      `LeadOcean phone lookups: ≤${phones} records`,
      `Apify company records: ≤$${canon}`,
      `Apify signals: ≤$${sig}`,
    ],
  };
}
