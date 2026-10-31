// The ICP WALK strategy: a LeadOcean-led, checkpointed walk over a fixed ICP.
// It is ONE strategy, not the discovery architecture: arbitrary requests go
// through the provider-neutral engine (`discoveryEngine/`: GPT interpreter →
// planner → any provider first → shared eligibility), which can start from
// Apify, LeadOcean or both. This walk keeps its own entry (`lead-pipeline`).
//
//   LeadOcean  DISCOVERS — people search narrowed by the ICP; every field it
//              returns is a provider claim (docs/LEADOCEAN_FINAL_VERDICT.md)
//   Apify      VERIFIES — the company record (identity, domain, HQ, declared size,
//              industry, description), optionally the founder relationship, then
//              optional signals; every item passes the evidence-authority rules
//   Agentory   DECIDES — evaluateEligibility (via verifyLeads) is the only authority
//
//   1 discovery     LeadOcean (runDiscovery: approval, ledger, idempotent pages,
//                   excludeIds from the checkpoint)
//   2 dedupe        merged by identifiers; prior-walk companies and same-LinkedIn
//                   duplicates are never sent to a paid verifier
//   3 history       existing Leads keep their ids; CRM / holds block outreach only
//   4 screen        obvious mismatches on provider claims (no decision-maker, headcount
//                   far outside) are not verified — a spending decision (screen.ts)
//   5 verify        Apify company records for screened-in candidates, highest provider
//                   funding priority first, inside the ceiling (overflow stays
//                   needs_verification)
//   6 eligibility   the shared engine decides: eligible / needs_verification / rejected
//   7 founder check optional, eligible only (founderCheck.ts)
//   8 signals       optional, eligible only; missing signals never block
//   9 rank → ATLAS review queue
//
// Phone lookups are NOT part of discovery: `enrichQueuedPhones` is a separate,
// separately authorized step over the queue. No paid call is retried; every one
// is reserved in the durable ledger first.

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
import { compileIcp, type IcpConfig } from "./icp.ts";
import { advance, newCheckpoint, resumeHints, type CheckpointStore, type WalkCheckpoint } from "./checkpoint.ts";
import { ExclusionIndex, type ExclusionVerdict } from "./exclusions.ts";
import { readCompanyRecords, type CanonicalRun } from "./canonical.ts";
import { collectSignals, type Signal, type SignalPlan, type SignalStatus } from "./signals.ts";
import { DEFAULT_WEIGHTS, rankLeads, type RankResult, type RankWeights } from "./ranking.ts";
import { employmentFrom, enrichPhones, redactPhoneRecord, type PhoneClass, type PhoneRecord, type PhoneTarget } from "./phones.ts";
import { ledgeredInvoker } from "./apifyInvoker.ts";
import { screenCandidates, verificationBatch, type ScreenOutcome } from "./screen.ts";
import { checkFounders, type FounderCheck } from "./founderCheck.ts";
import { COMPANY_RECORD_ACTOR, type CanonicalFacts } from "./canonical.ts";
import { companyLinkedInSlug } from "../decisionMaker/companyIdentity.ts";
import { EMPTY_FUNNEL, estimateCandidates, yieldReport, type CandidateEstimate, type FunnelCounts, type YieldReport } from "./metrics.ts";

export const PIPELINE_VERSION = "lead-pipeline-v1" as const;

export type DiscoveryStatus = "new" | "existing" | "duplicate_prior_walk";
export type EnrichmentStatus = "not_requested" | "not_eligible_for_lookup" | "skipped" | PhoneClass;
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
  /** Agentory's classification: the shared engine's verdict, plus `rejected` for screened-out and duplicate candidates. */
  classification: "eligible" | "needs_verification" | "rejected";
  /** Why rejected: `verified` = the engine disproved a hard requirement on evidence; `screened` = an obvious mismatch in the provider's claims (no paid verification bought); `duplicate`. */
  rejectionBasis: "verified" | "screened" | "duplicate" | null;
  screen: { outcome: ScreenOutcome; reasons: string[] };
  /** What the Apify company record says (null when it was not read). Display only; qualification reads the evidence. */
  verified: CanonicalFacts | null;
  founderCheck: FounderCheck | null;
  statuses: { discovery: DiscoveryStatus; qualification: Eligibility; enrichment: EnrichmentStatus; outreachReadiness: OutreachReadiness };
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
  /**
   * At most this many phone lookups for the SEPARATE `enrichQueuedPhones` step.
   * runLeadPipeline never looks a phone up; this only feeds the worst-case display.
   */
  phoneLookups: { maxLookups: number; approvedBy: string; approvedAt: string } | null;
  /** Optional founder-relationship check (eligible companies only); null = not run. */
  founderCheck?: { maxUsd: number; perCompany: number } | null;
}

export interface PipelineInput {
  workspaceId: string;
  walkId: string;
  icp: IcpConfig;
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
  canonical: { spentUsd: number; stopped: string | null; read: number; overBudget: number } | null;
  screening: Record<ScreenOutcome, number>;
  founderCheck: { spentUsd: number; stopped: string | null; confirmed: number } | null;
  signals: { spentUsd: number; stopped: string | null; statuses: SignalStatus[] } | null;
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

function bestContact(l: VerifiedLead): CanonicalPerson | null {
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
  const compiled = compileIcp(input.icp, resume.excludeIds ? { excludeIds: resume.excludeIds } : {});
  const plan = planDiscovery({ requirements: compiled.requirements, connections: input.connections, selection: ["leadocean"], limits: input.limits });
  // One mission id per purchase position: a crashed run re-run before its checkpoint saved replays from the ledger.
  const missionId = `lp:${input.walkId}:r${cp.recordsBought}`;
  const base = (status: PipelineRun["status"], reason: string | null): PipelineRun => ({
    version: PIPELINE_VERSION, status, reason, plan, discovery: null, canonical: null, signals: null, phones: null,
    screening: { verify: 0, duplicate: 0, no_decision_maker: 0, headcount_far_out: 0, unverifiable: 0, already_rejected: 0 }, founderCheck: null,
    queue: [], review: [], excluded: [], funnel: { ...EMPTY_FUNNEL }, estimates: [], contactValues: [],
    yield: yieldReport({ funnel: EMPTY_FUNNEL, leadoceanRecords: 0, apifyUsd: 0, usdPerLeadOceanRecord: input.usdPerLeadOceanRecord ?? null, rejections: [], enrichmentSkips: [] }), checkpoint: cp, spend: { leadoceanRecords: 0, apifyUsd: 0 },
  });
  if (resume.blocked) return base("blocked", resume.blocked);
  if (cp.icpId !== input.icp.id) return base("blocked", `walk ${input.walkId} belongs to ICP ${cp.icpId}`);
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

  // 4 screen: provider claims decide only what is worth verifying
  const screened = screenCandidates(run.leads, input.icp, bestContact, priorCompanies, now());
  const screenOf = new Map(screened.map((x) => [x.companyKey, x]));
  const screening = { verify: 0, duplicate: 0, no_decision_maker: 0, headcount_far_out: 0, unverifiable: 0, already_rejected: 0 } as Record<ScreenOutcome, number>;
  for (const x of screened) screening[x.outcome]++;

  // 5 verify: Apify company records, deduplicated by LinkedIn company, priority-ordered, inside the ceiling
  const timeout = input.actorTimeoutMs ?? 120_000;
  // Every Apify run is reserved in the durable ledger first (replay on re-run, never re-bought after an uncertain charge).
  const apifyCeiling = (input.approvals.canonicalMaxUsd ?? 0) + (input.approvals.signals?.maxUsd ?? 0) + (input.approvals.founderCheck?.maxUsd ?? 0);
  const timed = withTimeout(input.apify, timeout);
  const apify = timed ? ledgeredInvoker(timed, input.ledger, { workspaceId: input.workspaceId, missionId: `${missionId}:apify`, maxUsd: apifyCeiling }) : null;
  let canonical: CanonicalRun | null = null;
  let overBudget = 0;
  let leads = run.leads;
  if (input.approvals.canonicalMaxUsd != null) {
    const { buy, overBudget: over } = verificationBatch(screened, input.approvals.canonicalMaxUsd, COMPANY_RECORD_ACTOR.perStartUsd, COMPANY_RECORD_ACTOR.perItemUsd);
    overBudget = over.length;
    const urlOf = new Map(run.leads.map((l) => [l.company.key, first(l.company.linkedinUrl) ?? ""]));
    // Keyed by LinkedIn slug: one paid item per company, however many rows named it.
    canonical = await readCompanyRecords(buy.map((x) => ({ companyKey: x.slug!, linkedinUrl: urlOf.get(x.companyKey)! })), apify,
      { maxUsd: input.approvals.canonicalMaxUsd, now: now(), idPrefix: missionId });
    for (const x of over) canonical.statuses.push({ companyKey: x.slug!, state: "skipped_budget", reason: "beyond the company-record ceiling; stays needs_verification" });
    if (canonical.evidence.size) {
      const merged: MergeResult = {
        companies: run.leads.map((l) => l.company),
        people: run.leads.flatMap((l) => l.contacts.map((c) => c.person)),
        stats: { companyRows: 0, personRows: 0, companiesMerged: 0, peopleMerged: 0, identityConflicts: 0 },
      };
      const ev = canonical.evidence;
      // The shared engine admits these items only after its own identity and authority checks.
      leads = verifyLeads(compiled.requirements, merged, [], { now, canonicalEvidence: (ids): readonly EvidenceItem[] => {
        for (const u of ids.linkedinUrls) { const e = ev.get(companyLinkedInSlug(u) ?? ""); if (e) return e; }
        return [];
      } });
    }
  }
  const slugOf = (l: VerifiedLead) => companyLinkedInSlug(first(l.company.linkedinUrl));
  const factsOf = (l: VerifiedLead) => canonical?.facts.get(slugOf(l) ?? "") ?? null;
  const screenedOut = (key: string) => { const o = screenOf.get(key)?.outcome; return o === "duplicate" || o === "no_decision_maker" || o === "headcount_far_out"; };
  const eligibilityOf = (l: VerifiedLead): Eligibility => (screenedOut(l.company.key) ? "pending" : l.shared?.eligibility ?? "pending");
  const classify = (l: VerifiedLead): { c: PipelineLead["classification"]; basis: PipelineLead["rejectionBasis"] } => {
    const o = screenOf.get(l.company.key)?.outcome;
    if (o === "duplicate") return { c: "rejected", basis: "duplicate" };
    if (o === "no_decision_maker" || o === "headcount_far_out") return { c: "rejected", basis: "screened" };
    const e = l.shared?.eligibility ?? "pending";
    return e === "eligible" ? { c: "eligible", basis: null } : e === "ineligible" ? { c: "rejected", basis: "verified" } : { c: "needs_verification", basis: null };
  };
  const eligibleLeads = leads.filter((l) => classify(l).c === "eligible");

  // 7 founder check (optional, eligible only)
  let founders: Awaited<ReturnType<typeof checkFounders>> | null = null;
  if (input.approvals.founderCheck) {
    const fc = input.approvals.founderCheck;
    founders = await checkFounders(eligibleLeads.flatMap((l) => {
      const url = first(l.company.linkedinUrl);
      const p = bestContact(l);
      return url ? [{ companyKey: l.company.key, companyLinkedinUrl: url, personName: p ? first(p.fullName) : null }] : [];
    }), apify, { maxUsd: fc.maxUsd, perCompany: fc.perCompany, jobTitles: input.icp.roleTitles, idPrefix: missionId });
  }

  // 8 signals (optional, eligible only)
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

  // 9 ranking (lanes from the classification; the score only orders)
  const ranked = rankLeads(leads.map((l) => {
    const p = bestContact(l);
    const k = classify(l).c;
    return {
      leadKey: l.company.key, eligibility: k === "eligible" ? "eligible" : k === "rejected" ? "ineligible" : "pending", title: p ? first(p.title) : null,
      companyText: [...l.company.industry.flatMap((c) => c.value), ...l.company.keywords.flatMap((c) => c.value), ...(p ? p.headline.map((h) => h.value) : []),
        ...(factsOf(l)?.description ? [factsOf(l)!.description!] : [])],
      industryLabels: [...new Set(l.company.industry.flatMap((c) => c.value))], employeeCount: first(l.company.employeeCount),
      hasPhone: p ? first(p.hasPhone) : null, signals: signalsFor(l, p),
      founderConfirmed: founders ? founders.checks.get(l.company.key)?.state === "confirmed" : null,
    };
  }), input.icp, input.weights ?? DEFAULT_WEIGHTS);
  const rankOf = new Map(ranked.map((r) => [r.leadKey, r]));
  const byKey = new Map(leads.map((l) => [l.company.key, l]));

  // 8 queue
  const out: PipelineLead[] = ranked.map((r) => {
    const l = byKey.get(r.leadKey)!;
    const p = bestContact(l);
    const h = history.get(l.company.key)!;
    const ph: PhoneRecord | null = null;
    const discoveryStatus: DiscoveryStatus = priorCompanies.has(l.company.key) ? "duplicate_prior_walk"
      : h.company.existingLeadIds.length || h.person?.existingLeadIds.length ? "existing" : "new";
    const qualification = eligibilityOf(l);
    // Phones are a separate step (enrichQueuedPhones): discovery never looks one up.
    const enrichment: EnrichmentStatus = "not_requested";
    const blockers = [...h.company.reasons.filter((x) => !x.includes("already in Agentory")), ...(h.person?.reasons.filter((x) => !x.includes("already in Agentory")) ?? [])];

    const role = p ? classifyDecisionMakerRole(first(p.title)) : null;
    const dm = !!role && role.role_family !== "other";
    // ATLAS review queue: eligible, a decision-maker, no hold. A human reviews before any contact.
    const readiness: OutreachReadiness = h.company.blocksOutreach || h.person?.blocksOutreach ? "blocked"
      : r.lane === "queue" && dm ? "ready_for_review" : "not_ready";
    const cls = classify(l);
    return {
      version: PIPELINE_VERSION, leadKey: l.company.key,
      existingLeadIds: [...new Set([...h.company.existingLeadIds, ...(h.person?.existingLeadIds ?? [])])], icpId: input.icp.id,
      company: {
        key: l.company.key, name: first(l.company.name), domain: first(l.company.domain), linkedinUrl: first(l.company.linkedinUrl),
        providerCompanyIds: [...new Set(l.company.sources.map((s) => `${s.provider}:${s.recordId}`))], employeeCount: first(l.company.employeeCount),
        industry: [...new Set(l.company.industry.flatMap((c) => c.value))],
        // The provider's HQ claim, else the canonical record's HQ-flagged location (the one qualification read).
        // The Apify record's HQ-flagged location when read (what qualification used), else the provider's claim, labelled.
        hq: factsOf(l)?.hq
          ? { country: factsOf(l)!.hq!.country, region: null, city: factsOf(l)!.hq!.text.split(",")[0].trim(), source: "apify_linkedin_company_details" }
          : { country: first(l.company.hqCountry), region: first(l.company.hqRegion), city: first(l.company.hqCity), source: first(l.company.hqCountry) ? "provider_claim" : null },
        description: factsOf(l)?.description ?? null,
      },
      person: p ? { key: p.key, name: first(p.fullName), title: first(p.title), linkedinUrl: first(p.linkedinUrl),
        providerPersonId: p.sources.find((s) => s.provider === "leadocean")?.recordId ?? null, roleFamily: role!.role_family, hasPhoneFlag: first(p.hasPhone) } : null,
      classification: cls.c, rejectionBasis: cls.basis,
      screen: { outcome: screenOf.get(l.company.key)?.outcome ?? "verify", reasons: screenOf.get(l.company.key)?.reasons ?? [] },
      verified: factsOf(l), founderCheck: founders?.checks.get(l.company.key) ?? null,
      statuses: { discovery: discoveryStatus, qualification, enrichment, outreachReadiness: readiness },
      qualification: l.shared ? { checks: l.shared.checks, gaps: l.shared.gaps, disproven: l.shared.disproven, evidence_sources: l.shared.evidence_sources } : null,
      canonicalRecord: canonical?.statuses.find((s) => s.companyKey === slugOf(l))?.state ?? "not_requested",
      signals: signalsFor(l, p), rank: rankOf.get(l.company.key)!, phone: ph, outreachBlockers: blockers,
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
    pending: out.filter((x) => x.statuses.qualification === "pending").length,
    ineligible: out.filter((x) => x.statuses.qualification === "ineligible").length,
    decisionMaker: out.filter((x) => x.statuses.discovery === "new" && x.statuses.qualification === "eligible" && x.person && x.person.roleFamily !== "other").length,
    hasPhoneFlag: out.filter((x) => x.statuses.discovery === "new" && x.statuses.qualification === "eligible" && x.person && x.person.roleFamily !== "other" && x.person.hasPhoneFlag === true).length,
    lookedUp: 0,
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

  const apifyUsd = Math.round(((canonical?.spentUsd ?? 0) + (signalRun?.spentUsd ?? 0) + (founders?.spentUsd ?? 0)) * 1e6) / 1e6;
  const partial = run.status === "partial" || !!canonical?.stopped || !!signalRun?.stopped || !!founders?.stopped;
  return {
    version: PIPELINE_VERSION, status: partial ? "partial" : "completed",
    reason: [run.reason, canonical?.stopped && `canonical: ${canonical.stopped}`, founders?.stopped && `founder check: ${founders.stopped}`, signalRun?.stopped && `signals: ${signalRun.stopped}`].filter(Boolean).join("; ") || null,
    plan, discovery,
    canonical: canonical ? { spentUsd: canonical.spentUsd, stopped: canonical.stopped, read: canonical.statuses.filter((s) => s.state === "read").length, overBudget } : null,
    screening, founderCheck: founders ? { spentUsd: founders.spentUsd, stopped: founders.stopped, confirmed: [...founders.checks.values()].filter((c) => c.state === "confirmed").length } : null,
    signals: signalRun ? { spentUsd: signalRun.spentUsd, stopped: signalRun.stopped, statuses: signalRun.statuses } : null,
    phones: null,
    queue: out.filter((x) => x.rank.lane === "queue"), review: out.filter((x) => x.rank.lane === "review"), excluded: out.filter((x) => x.rank.lane === "excluded"),
    funnel, estimates, checkpoint: next,
    yield: yieldReport({
      funnel, leadoceanRecords, apifyUsd, usdPerLeadOceanRecord: input.usdPerLeadOceanRecord ?? null,
      rejections: out.flatMap((x) => x.rejectionBasis === "verified" ? (x.qualification?.disproven ?? []).map((d) => `disproven:${d}`)
        : x.rejectionBasis ? [`${x.rejectionBasis}:${x.screen.outcome}`]
        : x.classification === "needs_verification" ? (x.qualification?.gaps ?? []).map((g) => `unknown:${g}`) : []),
      enrichmentSkips: [],
    }),
    contactValues: [],
    spend: { leadoceanRecords, apifyUsd },
  };
}

/**
 * Optional, separately authorized phone enrichment over a finished run's queue.
 * Never called by runLeadPipeline. Only queued (eligible), unblocked decision-makers
 * with the provider's phone flag are candidates; a founder confirmed by an
 * independent source carries `independent_current` employment, everyone else
 * `provider_consistent` — so no provider number can become verified_person_direct
 * without independent number evidence as well (phones.ts).
 */
export async function enrichQueuedPhones(run: PipelineRun, input: {
  workspaceId: string; approval: { maxLookups: number; approvedBy: string; approvedAt: string };
  deps: AdapterDeps; ledger: UsageLedger; call?: Parameters<typeof enrichPhones>[0]["call"]; probe?: Parameters<typeof enrichPhones>[0]["probe"];
}): Promise<{ records: PhoneRecord[]; skipped: { personKey: string; reason: string }[]; recordsCharged: number; stopped: string | null; contactValues: PipelineRun["contactValues"] }> {
  const targets: PhoneTarget[] = run.queue.filter((l) => l.person).map((l) => ({
    personKey: l.person!.key, leadId: l.existingLeadIds[0] ?? null, providerPersonId: l.person!.providerPersonId, linkedinUrl: l.person!.linkedinUrl,
    eligibility: l.classification === "eligible" ? "eligible" : "pending", hasPhone: l.person!.hasPhoneFlag,
    outreachBlocked: l.statuses.outreachReadiness === "blocked",
    employment: l.founderCheck?.state === "confirmed"
      ? { status: "independent_current", sources: [l.founderCheck.source ?? "apify"], checkedAt: run.queue[0]?.provenance.runAt ?? null }
      : { status: l.founderCheck?.state === "other_decision_maker" ? "unknown" : "provider_consistent", sources: ["leadocean"], checkedAt: null },
  }));
  const allowed = targets.filter((t) => t.hasPhone === true && !t.outreachBlocked).slice(0, input.approval.maxLookups).map((t) => t.personKey);
  const missionId = `lp:${run.checkpoint.walkId}:phones:${run.plan.planHash}`;
  const authorization: EnrichmentAuthorization = { kind: "enrichment", workspaceId: input.workspaceId, missionId, personKeys: allowed,
    revealEmail: false, phones: true, maxCredits: input.approval.maxLookups, approvedBy: input.approval.approvedBy, approvedAt: input.approval.approvedAt };
  const r = await enrichPhones({ workspaceId: input.workspaceId, missionId, authorization, targets, deps: input.deps, ledger: input.ledger, call: input.call, probe: input.probe });
  return {
    records: r.records.map(redactPhoneRecord), skipped: r.skipped, recordsCharged: r.recordsCharged, stopped: r.stopped,
    contactValues: r.records.filter((x) => x.e164).map((x) => ({ personKey: x.personKey, leadId: x.leadId, e164: x.e164!, class: x.class })),
  };
}

/** The exact worst case a pipeline approval allows, before anything runs. */
export function worstCase(plan: DiscoveryPlan, a: PipelineApprovals): { leadoceanRecords: number; apifyUsd: number; lines: string[] } {
  const disc = plan.estimatedCredits.leadocean ?? 0;
  const phones = a.phoneLookups?.maxLookups ?? 0;
  const canon = a.canonicalMaxUsd ?? 0;
  const sig = a.signals?.maxUsd ?? 0;
  const fc = a.founderCheck?.maxUsd ?? 0;
  return {
    leadoceanRecords: disc + phones,
    apifyUsd: Math.round((canon + sig + fc) * 1e6) / 1e6,
    lines: [
      `LeadOcean discovery: ≤${disc} records (${plan.steps.map((s) => `${s.maxPages} page(s) × ≤${s.pageSize}`).join(", ")})`,
      `LeadOcean phone lookups (separate step, enrichQueuedPhones): ≤${phones} records`,
      `Apify company records: ≤$${canon}`,
      `Apify signals: ≤$${sig}`,
      ...(fc ? [`Apify founder check: ≤$${fc}`] : []),
    ],
  };
}
