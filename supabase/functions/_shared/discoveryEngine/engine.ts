// The discovery engine: executes an approved ExecutionPlan from any combination
// of providers, then hands every candidate to the shared eligibility engine.
//
//   approval  the plan hash, workspace and caps must match; a GPT plan alone buys nothing
//   discover  steps in dependency order, any provider first; seeds deduplicated
//             before a paid follow-up; per-provider remaining budget; timeouts
//   merge     mergeRecords across providers — provenance kept per fact, field
//             disagreements kept as conflicts
//   screen    obvious mismatches on provider claims are not verified (screen.ts)
//   verify    cached company records first (workspace-scoped, fresh), then paid
//             Apify records inside the remaining budget, highest priority first;
//             overflow stays needs_verification
//   decide    verifyLeads → evaluateEligibility, the only hard-qualification
//             authority; a REQUIRED signal must also be evidenced, dated and within
//             its window (it can withhold, never grant)
//   conflicts provider claims that disagree with verified evidence, or with each
//             other, are reported explicitly
//   optional  founder check and signals for eligible companies only
//   rank      lanes from the classification; the score only orders
// Phones are never requested here. No paid call is retried; every one is
// reserved in the ledger first, so a repeated execution replays instead of buying.

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import type { UsageLedger } from "../discoveryProviders/budget.ts";
import { mergeRecords, type CanonicalCompany, type CanonicalPerson } from "../discoveryProviders/normalize.ts";
import { verifyLeads, type VerifiedLead } from "../discoveryProviders/verify.ts";
import type { ProviderCompany, ProviderId, ProviderPerson } from "../discoveryProviders/types.ts";
import type { EvidenceItem } from "../candidateObservation.ts";
import { classifyDecisionMakerRole } from "../decisionMaker/roleFamily.ts";
import { companyLinkedInSlug, normalizeDomain } from "../decisionMaker/companyIdentity.ts";
import { readCompanyRecords, COMPANY_RECORD_ACTOR, type CanonicalFacts } from "../leadPipeline/canonical.ts";
import { ledgeredInvoker } from "../leadPipeline/apifyInvoker.ts";
import { screenCandidates, verificationBatch, type ScreenOutcome } from "../leadPipeline/screen.ts";
import { checkFounders, type FounderCheck } from "../leadPipeline/founderCheck.ts";
import { collectSignals, corroborate, signalFromFunding, type Signal } from "../leadPipeline/signals.ts";
import { DEFAULT_WEIGHTS, rankLeads, type RankResult } from "../leadPipeline/ranking.ts";
import type { ExclusionIndex } from "../leadPipeline/exclusions.ts";
import type { IcpConfig } from "../leadPipeline/icp.ts";
import { isFresh, type EvidenceCache } from "./cache.ts";
import type { ExecutionPlan, PlannedStep } from "./planner.ts";
import { specToRequirements, type DiscoverySpec } from "./spec.ts";
import type { DiscoverySource, SeedCompany, SourceRunResult } from "./sources.ts";

export const ENGINE_VERSION = "discovery-engine-v1" as const;

export interface EngineApproval { workspaceId: string; planHash: string; caps: { leadoceanRecords: number; apifyUsd: number }; approvedBy: string; approvedAt: string }

export interface EngineInput {
  workspaceId: string;
  /** Stable id for this request's executions: the ledger replays under it. */
  runId: string;
  spec: DiscoverySpec;
  plan: ExecutionPlan;
  approval: EngineApproval | null;
  sources: Partial<Record<ProviderId, DiscoverySource>>;
  /** For verification and signal steps (Apify actors). */
  apify: ActorInvoker | null;
  ledger: UsageLedger;
  cache: EvidenceCache;
  existing: ExclusionIndex;
  now?: () => Date;
  stepTimeoutMs?: number;
  cacheMaxAgeDays?: number;
}

export type FactStatus = "provider_claim" | "verified" | "corroborated" | "contradicted";
export interface FactProvenance {
  fact: string; value: unknown; provider: string; sourceId: string; url: string | null;
  retrievedAt: string; eventAt: string | null; confidence: "high" | "medium" | "low"; status: FactStatus;
}
export interface FactConflict { field: string; values: { value: unknown; provider: string; status: FactStatus }[]; resolution: string }

export interface EngineLead {
  key: string;
  classification: "eligible" | "needs_verification" | "rejected";
  rejectionBasis: "verified" | "screened" | "duplicate" | null;
  reasons: string[];
  company: { name: string | null; domain: string | null; linkedinUrl: string | null; providers: string[] };
  person: { key: string; name: string | null; title: string | null; linkedinUrl: string | null; roleFamily: string; providers: string[] } | null;
  discoveredBy: string[];
  screen: { outcome: ScreenOutcome; reasons: string[] };
  verification: { companyRecord: "read" | "cached" | "not_found" | "skipped_budget" | "unavailable" | "not_requested" | "not_needed"; facts: CanonicalFacts | null };
  qualification: { checks: unknown[]; gaps: string[]; disproven: string[] } | null;
  requestMatch: { signal: string; met: boolean; reason: string }[];
  facts: FactProvenance[];
  conflicts: FactConflict[];
  signals: Signal[];
  founderCheck: FounderCheck | null;
  existingLeadIds: string[];
  outreachBlockers: string[];
  outreachReadiness: "ready_for_review" | "blocked" | "not_ready";
  rank: RankResult;
}

export interface StepOutcome { id: string; provider: ProviderId; capability: string; status: "completed" | "partial" | "failed" | "skipped" | "timeout"; spent: number; unit: "record" | "usd"; items: number; replayed: boolean; notes: string[] }

export interface EngineRun {
  version: typeof ENGINE_VERSION;
  status: "completed" | "partial" | "blocked";
  reason: string | null;
  planHash: string;
  steps: StepOutcome[];
  queue: EngineLead[];
  review: EngineLead[];
  rejected: EngineLead[];
  spend: { leadoceanRecords: number; apifyUsd: number };
  budgetExhausted: boolean;
  cache: { hits: number; purchased: number };
  /** Phone numbers are never requested by discovery. */
  phonesRequested: 0;
}

const first = <T>(xs: { value: T }[]): T | null => xs[0]?.value ?? null;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const US = /^(us|usa|united states( of america)?)$/i;
const country = (v: unknown) => (typeof v === "string" ? (US.test(v.trim()) ? "US" : v.trim().toLowerCase()) : null);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function bestContact(l: VerifiedLead): CanonicalPerson | null {
  const order = { founder: 0, executive_revenue: 1, sales_leadership: 2, growth_leadership: 3, revenue_operations: 4, sales_operations: 5, other: 6 } as const;
  const fam = (p: CanonicalPerson) => order[classifyDecisionMakerRole(first(p.title)).role_family];
  return l.contacts.filter((c) => c.status !== "rejected").map((c) => c.person).sort((a, b) => fam(a) - fam(b) || a.key.localeCompare(b.key))[0] ?? null;
}

const blank = (status: EngineRun["status"], reason: string, planHash: string): EngineRun => ({
  version: ENGINE_VERSION, status, reason, planHash, steps: [], queue: [], review: [], rejected: [],
  spend: { leadoceanRecords: 0, apifyUsd: 0 }, budgetExhausted: false, cache: { hits: 0, purchased: 0 }, phonesRequested: 0,
});

export async function executeDiscovery(input: EngineInput): Promise<EngineRun> {
  const now = input.now ?? (() => new Date());
  const { plan, spec } = input;
  // ── authorization: the plan is not a purchase order ────────────────────────
  const a = input.approval;
  if (!a) return blank("blocked", "an approval naming this plan's hash and caps is required before any paid call", plan.planHash);
  if (a.workspaceId !== input.workspaceId) return blank("blocked", "the approval belongs to another workspace", plan.planHash);
  if (a.planHash !== plan.planHash) return blank("blocked", "the plan changed since it was approved", plan.planHash);
  if (plan.status === "blocked") return blank("blocked", plan.uncertain.join("; ") || "the plan is blocked", plan.planHash);
  const remaining = { record: a.caps.leadoceanRecords, usd: a.caps.apifyUsd };
  const spend = { leadoceanRecords: 0, apifyUsd: 0 };
  const charge = (unit: "record" | "usd", n: number) => {
    if (unit === "record") { remaining.record -= n; spend.leadoceanRecords += n; } else { remaining.usd = r6(remaining.usd - n); spend.apifyUsd = r6(spend.apifyUsd + n); }
  };
  const requirements = specToRequirements(spec);
  const timeoutMs = input.stepTimeoutMs ?? 120_000;
  const steps: StepOutcome[] = [];
  const byStep = new Map<string, SourceRunResult>();
  let budgetExhausted = false;

  // ── discovery steps (any provider, any order the plan chose) ───────────────
  for (const s of plan.steps.filter((x) => x.role === "discover")) {
    const unit = s.estimate.unit;
    const maxCost = Math.max(0, Math.min(s.estimate.worst, unit === "record" ? remaining.record : remaining.usd));
    const out: StepOutcome = { id: s.id, provider: s.provider, capability: s.capability, status: "completed", spent: 0, unit, items: 0, replayed: false, notes: [] };
    steps.push(out);
    const src = input.sources[s.provider];
    if (!src) { out.status = "failed"; out.notes.push(`${s.provider} is not connected for this workspace`); continue; }
    const seeds = s.dependsOn ? seedsFrom(byStep.get(s.dependsOn)) : [];
    if (s.dependsOn && !seeds.length) { out.status = "skipped"; out.notes.push("no companies from the previous step"); continue; }
    if (maxCost <= 0) { out.status = "skipped"; out.notes.push("budget exhausted before this step"); budgetExhausted = true; continue; }
    let res: SourceRunResult | "timeout";
    try {
      res = await withTimeout(src.run({ capability: s.capability, stepId: s.id, spec, requirements, seeds, maxItems: s.maxItems, maxCost,
        workspaceId: input.workspaceId, missionId: input.runId, ledger: input.ledger, now: now() }), timeoutMs);
    } catch (e) { out.status = "failed"; out.notes.push(`step failed (${(e as Error)?.name ?? "error"}); not retried`); continue; }
    if (res === "timeout") {
      // The provider may still bill: count the step's worst case and move on with what other steps found.
      out.status = "timeout"; out.notes.push(`no answer within ${timeoutMs} ms; worst case counted, not retried`);
      out.spent = maxCost; charge(unit, maxCost);
      continue;
    }
    byStep.set(s.id, res);
    out.spent = res.spent; out.replayed = res.replayed; out.items = res.companies.length + res.people.length; out.notes.push(...res.notes);
    charge(unit, res.spent);
    if (res.stopped) { out.status = res.companies.length || res.people.length ? "partial" : "failed"; out.notes.push(`stopped: ${res.stopped}`); if (res.stopped === "budget") budgetExhausted = true; }
  }

  // ── merge across providers (provenance per fact; conflicts kept) ──────────
  const companyRows: ProviderCompany[] = [...byStep.values()].flatMap((r) => r.companies);
  const personRows: ProviderPerson[] = [...byStep.values()].flatMap((r) => r.people);
  const merged = mergeRecords(companyRows, personRows);
  const discoveredSignals = [...byStep.values()].flatMap((r) => r.signals);
  const discoveredBy = new Map<string, Set<string>>();
  for (const [id, r] of byStep) {
    const step = plan.steps.find((x) => x.id === id)!;
    for (const c of [...r.companies, ...r.people.map((p) => p.company).filter((x): x is ProviderCompany => !!x)]) {
      const k = keyFor(merged.companies, c);
      if (k) discoveredBy.set(k, new Set([...(discoveredBy.get(k) ?? []), `${step.provider}:${step.capability}`]));
    }
  }
  // Screening reads size only when the user made it a (grounded) hard constraint.
  const hardSize = spec.hard.includes("employee_range") ? spec.company.employees : null;
  const icpLike: Pick<IcpConfig, "employees"> = { employees: { min: hardSize?.min ?? 1, max: hardSize?.max ?? 1_000_000 } };
  let leads = verifyLeads(requirements, merged, [], { now });
  const screened = screenCandidates(leads, icpLike, bestContact, new Set(), now(), { requireDecisionMaker: spec.target === "people" });
  const screenOf = new Map(screened.map((x) => [x.companyKey, x]));

  // ── verification: cache first, then paid records inside the budget ───────
  const vStep = plan.steps.find((x) => x.capability === "company_record");
  const evidence = new Map<string, EvidenceItem[]>();
  const facts = new Map<string, CanonicalFacts | null>();
  const recordState = new Map<string, EngineLead["verification"]["companyRecord"]>();
  let hits = 0, purchased = 0;
  if (vStep) {
    const want = screened.filter((x) => x.outcome === "verify");
    const toBuy = [];
    for (const x of want) {
      const c = await input.cache.get(input.workspaceId, x.slug!);
      if (c && isFresh(c, now(), input.cacheMaxAgeDays ?? 30)) { evidence.set(x.slug!, c.evidence); facts.set(x.slug!, c.facts); recordState.set(x.slug!, "cached"); hits++; }
      else toBuy.push(x);
    }
    const out: StepOutcome = { id: vStep.id, provider: "apify", capability: "company_record", status: "completed", spent: 0, unit: "usd", items: 0, replayed: false, notes: hits ? [`${hits} company record(s) reused from the cache`] : [] };
    steps.push(out);
    const ceiling = Math.max(0, Math.min(vStep.estimate.worst, remaining.usd));
    const { buy, overBudget } = verificationBatch(toBuy, ceiling, COMPANY_RECORD_ACTOR.perStartUsd, COMPANY_RECORD_ACTOR.perItemUsd);
    for (const x of overBudget) recordState.set(x.slug!, "skipped_budget");
    if (overBudget.length) { budgetExhausted = true; out.notes.push(`${overBudget.length} company record(s) beyond the remaining budget: those candidates stay needs_verification`); }
    if (buy.length) {
      const inv = input.apify ? ledgeredInvoker(input.apify, input.ledger, { workspaceId: input.workspaceId, missionId: `${input.runId}:${vStep.id}`, maxUsd: ceiling }) : null;
      const urlOf = new Map(merged.companies.flatMap((c) => c.linkedinUrl.map((u) => [companyLinkedInSlug(u.value), u.value] as const)));
      const run = await withTimeout(readCompanyRecords(buy.map((x) => ({ companyKey: x.slug!, linkedinUrl: urlOf.get(x.slug!)! })), inv, { maxUsd: ceiling, now: now(), idPrefix: `${input.runId}:${vStep.id}` }), timeoutMs);
      if (run === "timeout") { out.status = "timeout"; out.spent = ceiling; charge("usd", ceiling); for (const x of buy) recordState.set(x.slug!, "unavailable"); }
      else {
        out.spent = run.spentUsd; charge("usd", run.spentUsd);
        if (run.stopped) out.status = "partial";
        for (const st of run.statuses) recordState.set(st.companyKey, st.state === "read" ? "read" : st.state === "not_found" ? "not_found" : st.state === "skipped_budget" ? "skipped_budget" : "unavailable");
        for (const [slug, ev] of run.evidence) {
          evidence.set(slug, ev); facts.set(slug, run.facts.get(slug) ?? null); purchased++;
          await input.cache.put({ workspaceId: input.workspaceId, slug, evidence: ev, facts: run.facts.get(slug) ?? null, observedAt: now().toISOString() });
        }
        out.items = run.evidence.size;
      }
    }
    leads = verifyLeads(requirements, merged, [], { now, canonicalEvidence: (ids): readonly EvidenceItem[] => {
      for (const u of ids.linkedinUrls) { const e = evidence.get(companyLinkedInSlug(u) ?? ""); if (e) return e; }
      return [];
    } });
  }

  // ── decide: shared engine + required-signal match ─────────────────────────
  const slugOf = (c: CanonicalCompany) => companyLinkedInSlug(first(c.linkedinUrl));
  const signalsOf = (c: CanonicalCompany) => {
    const keys = new Set([c.key, ...c.linkedinUrl.map((u) => `li:${companyLinkedInSlug(u.value)}`)]);
    const funding = c.funding.map((f) => signalFromFunding(f.value, { kind: "company", key: c.key }, f.recordId, now(), 365)).filter((x): x is Signal => !!x);
    return corroborate([...discoveredSignals.filter((s) => keys.has(s.subject.key)).map((s) => ({ ...s, subject: { ...s.subject, key: c.key } })), ...funding]);
  };
  const classify = (l: VerifiedLead) => {
    const o = screenOf.get(l.company.key)?.outcome;
    if (o === "duplicate") return { c: "rejected" as const, basis: "duplicate" as const, reasons: screenOf.get(l.company.key)!.reasons };
    if (o === "no_decision_maker" || o === "headcount_far_out") return { c: "rejected" as const, basis: "screened" as const, reasons: screenOf.get(l.company.key)!.reasons };
    const e = l.shared?.eligibility ?? "pending";
    if (e === "ineligible") return { c: "rejected" as const, basis: "verified" as const, reasons: (l.shared?.disproven ?? []).map((d) => `disproven: ${d}`) };
    if (e !== "eligible") return { c: "needs_verification" as const, basis: null, reasons: (l.shared?.gaps ?? []).map((g) => `unverified: ${g}`) };
    return { c: "eligible" as const, basis: null, reasons: [] };
  };
  const requestMatch = (c: CanonicalCompany) => spec.signals.filter((s) => s.required).map((s) => {
    const want = s.kind === "posts" ? "linkedin_post" : s.kind;
    const hit = signalsOf(c).find((x) => x.type === want && x.recency === "recent" && x.confidence !== "low");
    return { signal: s.kind, met: !!hit, reason: hit ? `${hit.type} on ${hit.eventDate!.slice(0, 10)} via ${hit.actor ?? hit.provider}` : `no dated ${s.kind} evidence within ${s.withinDays ?? "the requested"} days` };
  });

  // ── optional: founder check and signals, eligible only ────────────────────
  const eligibleNow = leads.filter((l) => classify(l).c === "eligible" && requestMatch(l.company).every((m) => m.met));
  let founders: Awaited<ReturnType<typeof checkFounders>> | null = null;
  const fStep = plan.steps.find((x) => x.capability === "founder_relationship");
  if (fStep && eligibleNow.length) {
    const ceiling = Math.max(0, Math.min(fStep.estimate.worst, remaining.usd));
    const inv = input.apify ? ledgeredInvoker(input.apify, input.ledger, { workspaceId: input.workspaceId, missionId: `${input.runId}:${fStep.id}`, maxUsd: ceiling }) : null;
    founders = await checkFounders(eligibleNow.flatMap((l) => { const u = first(l.company.linkedinUrl); const p = bestContact(l); return u ? [{ companyKey: l.company.key, companyLinkedinUrl: u, personName: p ? first(p.fullName) : null }] : []; }),
      inv, { maxUsd: ceiling, perCompany: 3, jobTitles: spec.roles.slice(0, 10), idPrefix: `${input.runId}:${fStep.id}` });
    charge("usd", founders.spentUsd);
    steps.push({ id: fStep.id, provider: "apify", capability: "founder_relationship", status: founders.stopped ? "partial" : "completed", spent: founders.spentUsd, unit: "usd", items: founders.checks.size, replayed: false, notes: founders.stopped ? [`stopped: ${founders.stopped}`] : [] });
  }
  let signalRun: Awaited<ReturnType<typeof collectSignals>> | null = null;
  const gStep = plan.steps.find((x) => x.capability === "company_signals");
  if (gStep && eligibleNow.length) {
    const ceiling = Math.max(0, Math.min(gStep.estimate.worst, remaining.usd));
    const inv = input.apify ? ledgeredInvoker(input.apify, input.ledger, { workspaceId: input.workspaceId, missionId: `${input.runId}:${gStep.id}`, maxUsd: ceiling }) : null;
    signalRun = await collectSignals(eligibleNow.map((l) => ({ companyKey: l.company.key, companyLinkedinUrl: first(l.company.linkedinUrl), companyName: first(l.company.name), personKey: null, personLinkedinUrl: null, funding: null, fundingRecordId: null })),
      { collect: { companyPosts: true, jobs: true }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 90, maxUsd: ceiling, relevantRoles: new RegExp((spec.roles.length ? spec.roles : ["sales"]).join("|"), "i") }, inv, now(), `${input.runId}:${gStep.id}`);
    charge("usd", signalRun.spentUsd);
    steps.push({ id: gStep.id, provider: "apify", capability: "company_signals", status: signalRun.stopped ? "partial" : "completed", spent: signalRun.spentUsd, unit: "usd", items: signalRun.signals.length, replayed: false, notes: signalRun.stopped ? [`stopped: ${signalRun.stopped}`] : [] });
  }

  // ── conflicts, provenance, ranking ────────────────────────────────────────
  const icp: IcpConfig = {
    id: "icp_a_b2b_saas", label: spec.query, query: spec.query, requestedCount: spec.quantity,
    employees: { min: spec.company.employees?.min ?? 1, max: spec.company.employees?.max ?? 1_000_000 }, roleTitles: spec.roles,
    leadocean: { industry: [], seniority: [] },
    relevance: { positive: [...spec.company.industries, ...spec.company.descriptors, ...spec.signals.flatMap((s) => s.topics ?? [])].map((x) => x.toLowerCase()), negative: [], industryLabels: [] },
  };
  const built = leads.map((l) => {
    const c = l.company;
    const slug = slugOf(c);
    const f = slug ? facts.get(slug) ?? null : null;
    const cls = classify(l);
    const match = requestMatch(c);
    const finalClass = cls.c === "eligible" && match.some((m) => !m.met) ? "needs_verification" : cls.c;
    const sigs = [...signalsOf(c), ...(signalRun?.signals ?? []).filter((s) => s.subject.key === c.key)];
    const p = bestContact(l);
    return { l, c, f, slug, cls: { ...cls, c: finalClass, reasons: [...cls.reasons, ...match.filter((m) => !m.met).map((m) => `request: ${m.reason}`)] }, match, sigs, p };
  });
  const ranked = rankLeads(built.map((b) => ({
    leadKey: b.c.key, eligibility: b.cls.c === "eligible" ? "eligible" : b.cls.c === "rejected" ? "ineligible" : "pending",
    title: b.p ? first(b.p.title) : null,
    companyText: [...b.c.industry.flatMap((x) => x.value), ...b.c.keywords.flatMap((x) => x.value), ...(b.f?.description ? [b.f.description] : [])],
    industryLabels: [...new Set(b.c.industry.flatMap((x) => x.value))], employeeCount: first(b.c.employeeCount), hasPhone: b.p ? first(b.p.hasPhone) : null, signals: b.sigs,
    founderConfirmed: founders ? founders.checks.get(b.c.key)?.state === "confirmed" : null,
  })), icp, DEFAULT_WEIGHTS);
  const rankOf = new Map(ranked.map((r) => [r.leadKey, r]));

  const out: EngineLead[] = built.map(({ l, c, f, slug, cls, match, sigs, p }) => {
    const ex = input.existing.company({ domains: c.domain.map((d) => d.value), linkedinUrls: c.linkedinUrl.map((d) => d.value), providerIds: c.sources.map((s) => s.recordId) });
    const exP = p ? input.existing.person({ linkedinUrls: p.linkedinUrl.map((d) => d.value), providerIds: p.sources.map((s) => s.recordId) }) : null;
    const blocked = ex.blocksOutreach || !!exP?.blocksOutreach;
    const role = p ? classifyDecisionMakerRole(first(p.title)) : null;
    return {
      key: c.key, classification: cls.c, rejectionBasis: cls.basis, reasons: cls.reasons,
      company: { name: first(c.name), domain: first(c.domain), linkedinUrl: first(c.linkedinUrl), providers: [...new Set(c.sources.map((s) => s.provider))] },
      person: p ? { key: p.key, name: first(p.fullName), title: first(p.title), linkedinUrl: first(p.linkedinUrl), roleFamily: role!.role_family, providers: [...new Set(p.sources.map((s) => s.provider))] } : null,
      discoveredBy: [...(discoveredBy.get(c.key) ?? [])],
      screen: { outcome: screenOf.get(c.key)?.outcome ?? "verify", reasons: screenOf.get(c.key)?.reasons ?? [] },
      verification: { companyRecord: !vStep ? "not_requested" : slug ? recordState.get(slug) ?? (screenOf.get(c.key)?.outcome === "verify" ? "unavailable" : "not_needed") : "unavailable", facts: f },
      qualification: l.shared ? { checks: l.shared.checks, gaps: l.shared.gaps.map(String), disproven: l.shared.disproven } : null,
      requestMatch: match,
      facts: factsFor(c, f, l), conflicts: conflictsFor(c, f),
      signals: sigs, founderCheck: founders?.checks.get(c.key) ?? null,
      existingLeadIds: [...new Set([...ex.existingLeadIds, ...(exP?.existingLeadIds ?? [])])],
      outreachBlockers: [...ex.reasons, ...(exP?.reasons ?? [])].filter((x) => !x.includes("already in Agentory")),
      outreachReadiness: blocked ? "blocked" : cls.c === "eligible" && role && role.role_family !== "other" ? "ready_for_review" : cls.c === "eligible" && spec.target === "companies" ? "ready_for_review" : "not_ready",
      rank: rankOf.get(c.key)!,
    };
  });
  const order = (x: EngineLead) => x.rank.score;
  const partial = steps.some((s) => s.status !== "completed" && s.status !== "skipped") || budgetExhausted;
  return {
    version: ENGINE_VERSION, status: partial ? "partial" : "completed", reason: partial ? steps.filter((s) => s.status !== "completed").map((s) => `${s.id} ${s.provider}/${s.capability}: ${s.status}`).join("; ") || (budgetExhausted ? "budget exhausted" : null) : null,
    planHash: plan.planHash, steps,
    queue: out.filter((x) => x.classification === "eligible").sort((a, b) => order(b) - order(a)),
    review: out.filter((x) => x.classification === "needs_verification").sort((a, b) => order(b) - order(a)),
    rejected: out.filter((x) => x.classification === "rejected"),
    spend, budgetExhausted, cache: { hits, purchased }, phonesRequested: 0,
  };
}

function seedsFrom(r: SourceRunResult | undefined): SeedCompany[] {
  if (!r) return [];
  const seen = new Set<string>();
  const out: SeedCompany[] = [];
  // Deduplicated BEFORE the paid follow-up: one seed per LinkedIn company / domain.
  for (const c of [...r.companies, ...r.people.map((p) => p.company).filter((x): x is ProviderCompany => !!x)]) {
    const k = companyLinkedInSlug(c.linkedinUrl) ?? normalizeDomain(c.domain);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, name: c.name ?? null, domain: normalizeDomain(c.domain), linkedinUrl: c.linkedinUrl ?? null });
  }
  return out;
}

function keyFor(companies: CanonicalCompany[], c: ProviderCompany): string | null {
  const slug = companyLinkedInSlug(c.linkedinUrl), dom = normalizeDomain(c.domain);
  return companies.find((x) => (slug && x.linkedinUrl.some((u) => companyLinkedInSlug(u.value) === slug)) || (dom && x.domain.some((d) => normalizeDomain(d.value) === dom)))?.key ?? null;
}

/** Every important fact with its provenance; a provider claim stays a claim unless verified evidence agrees. */
function factsFor(c: CanonicalCompany, f: CanonicalFacts | null, l: VerifiedLead): FactProvenance[] {
  const out: FactProvenance[] = [];
  const verifiedHq = f?.hq?.country ? country(f.hq.country) : null;
  const add = (fact: string, claims: { value: unknown; provider: string; recordId: string; retrievedAt: string; providerUpdatedAt?: string | null; sourceField: string }[], verify?: (v: unknown) => FactStatus | null) => {
    for (const x of claims) out.push({ fact, value: x.value, provider: x.provider, sourceId: `${x.recordId}:${x.sourceField}`, url: null, retrievedAt: x.retrievedAt, eventAt: x.providerUpdatedAt ?? null, confidence: "low", status: verify?.(x.value) ?? "provider_claim" });
  };
  add("hq_country", c.hqCountry, (v) => (verifiedHq ? (country(v) === verifiedHq ? "corroborated" : "contradicted") : null));
  add("employee_count", c.employeeCount);
  add("employee_range", c.employeeRange);
  add("industry", c.industry);
  add("funding", c.funding);
  add("domain", c.domain);
  for (const chk of (l.shared?.checks ?? []) as { dimension: string; result: string; reason: string; actor: string | null }[]) {
    out.push({ fact: chk.dimension, value: chk.reason, provider: chk.actor ?? "agentory", sourceId: chk.actor ?? "shared_engine", url: null, retrievedAt: new Date(0).toISOString(), eventAt: null,
      confidence: chk.result === "pass" ? "high" : "medium", status: chk.result === "pass" ? "verified" : chk.result === "fail" ? "contradicted" : "provider_claim" });
  }
  return out;
}

/** Disagreements: between providers, and between a provider claim and verified evidence. */
function conflictsFor(c: CanonicalCompany, f: CanonicalFacts | null): FactConflict[] {
  const out: FactConflict[] = c.conflicts.map((x) => ({ field: x.field, values: x.values.map((v) => ({ value: v.value, provider: v.provider, status: "provider_claim" as const })), resolution: "unresolved between providers: the shared engine reads verified evidence only" }));
  const verifiedHq = f?.hq?.country ?? null;
  const claims = c.hqCountry.filter((h) => verifiedHq && country(h.value) !== country(verifiedHq));
  if (claims.length) out.push({ field: "hq_country", values: [...claims.map((h) => ({ value: h.value, provider: h.provider, status: "contradicted" as const })), { value: verifiedHq, provider: "apify_linkedin_company_details", status: "verified" as const }], resolution: "the verified company record governs; the provider claim is contradicted" });
  if (f?.sizeBand) {
    const outside = c.employeeCount.filter((n) => n.value < f.sizeBand!.min || (f.sizeBand!.max != null && n.value > f.sizeBand!.max));
    if (outside.length) out.push({ field: "employees", values: [...outside.map((n) => ({ value: n.value, provider: n.provider, status: "contradicted" as const })), { value: `${f.sizeBand.min}-${f.sizeBand.max ?? "+"}`, provider: "apify_linkedin_company_details", status: "verified" as const }], resolution: "the declared size band governs; the provider headcount is contradicted" });
  }
  return out;
}

export type { PlannedStep };
