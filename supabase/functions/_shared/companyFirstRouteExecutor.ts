// THE COMPANY-FIRST EXECUTION RUNTIME.
//
// PR #137 validated the route but still executed through the legacy source path,
// so a mission that resolved to `startup_company_first` still reached broad job
// boards. This module is the missing middle: it takes a VALIDATED route and
// actually drives the funnel.
//
//   discover -> resolve identity -> ENRICH -> company-fit -> hiring verification
//            -> qualified company -> founders -> employer verification
//
// ── THE ORDER IS THE POINT ───────────────────────────────────────────────────
// Enrichment happens BEFORE qualification, not after. The 2026-08-01 benchmark
// showed why: company-search returned a staffing firm under a software-industry
// filter, and it was the only company that "verified as hiring". Qualifying on
// discovery-time evidence produces founder outreach to a job board.
//
// ── NO PROVIDER IMPORTS ──────────────────────────────────────────────────────
// Every Actor call is INJECTED. run-agent supplies real invokers; tests supply
// mocks. That is what lets the end-to-end proof exercise the REAL executor with
// zero paid runs, rather than a detached mock of it.

import {
  compileHarvestCompanyDetailsInput, compileHarvestCompanyEmployeesInput,
  compileHarvestJobSearchInput, compileMemo23YcInput, compileSolidcodeYcInput,
  fanOutSolidcodeTeamSizes, type CompiledActorCall,
} from "./hiringActorInputs.ts";
import {
  dedupeJobs, dedupePeople, normalizeHarvestPerson, normalizeLinkedInCompanyEnriched,
  normalizeLinkedInJob, normalizeMemo23Company, normalizeMemo23OpenJobs,
  normalizeSolidcodeCompany, type NormalizedHiringCompany, type NormalizedHiringJob,
  type NormalizedHiringPerson,
} from "./hiringActorNormalizers.ts";
import {
  advance, evaluateCompanyFit, newCompanyRecord, projectFunnel,
  type CompanyRecordState, type FunnelCounts,
} from "./companyFirstStages.ts";
import {
  identityIsActionable, resolveIdentityAgainstLookups, type IdentityResolution,
} from "./companyIdentityResolution.ts";
import {
  DEFAULT_ROLE_PACKS, filterJobsForPack, type RolePack,
} from "./hiringRolePackFilter.ts";
import { extractAggregatorEvidence } from "./companyAggregatorEvidence.ts";
import {
  recordExecutedSource, type RouteExecutionRecord, type ValidatedRoute,
} from "./hiringRouteContract.ts";

/** One injected Actor call. Returns raw rows; the executor normalizes them. */
export type ActorInvoker = (
  call: CompiledActorCall<unknown>,
) => Promise<Record<string, unknown>[]>;

export interface CompanyFirstRouteDeps {
  /** Runs a compiled Actor call. The ONLY way this module reaches a provider. */
  invoke: ActorInvoker;
  /** Existing canonical employer verification. Never re-implemented here. */
  verifyEmployer: (
    person: NormalizedHiringPerson, companyLinkedInUrl: string,
  ) => { verified: boolean; outcome: string };
  /** Already-completed idempotency keys, so a resume does not re-pay. */
  callCompleted?: (key: string) => boolean;
  onCallComplete?: (key: string) => void;
  log?: (msg: string, meta?: unknown) => void;
}

export interface CompanyFirstRouteOpts {
  route: ValidatedRoute;
  routeRecord: RouteExecutionRecord;
  requestedLeadCount: number;
  taskId: string;
  workspaceId: string;
  /** Company Brain hard constraints. Absent => gates not enforced. */
  brain?: {
    employee_min?: number | null;
    employee_max?: number | null;
    positive_industries?: string[];
    excluded_industries?: string[];
    required_geography?: string | null;
  };
  rolePacks?: readonly RolePack[];
  /** Verified live enum; never numeric days. */
  postedLimit?: "1h" | "24h" | "week" | "month";
  maxCandidates?: number;
  /** memo23 verified enums. */
  ycRegions?: string[];
  ycIndustries?: string[];
  ycMinSize?: string;
  ycMaxSize?: string;
  /** solidcode fan-out bands (one value per call — never combined). */
  solidcodeTeamSizes?: string[];
  foundersPerCompany?: number;
}

export interface CompanyFirstRouteResult {
  executed_source_order: string[];
  companies: Array<{
    record: CompanyRecordState;
    company: NormalizedHiringCompany;
    identity: IdentityResolution;
    enriched: NormalizedHiringCompany | null;
    hiring_jobs: NormalizedHiringJob[];
    founders: NormalizedHiringPerson[];
  }>;
  funnel: FunnelCounts;
  diagnostics: CompanyFirstRouteDiagnostics;
}

export interface CompanyFirstRouteDiagnostics {
  route: { requested: string; validated: string; executed: string | null; fallback_reason: string | null };
  discovery: Array<{ actor_key: string; input_hash: string; batch: string; rows: number; deduped: number }>;
  identity: { verified: number; ambiguous: number; unresolved: number; mismatch: number };
  enrichment: { requested: number; completed: number; failed: number; skipped_unresolved: number };
  company_brain: {
    evaluated: number; pass: number; reject: number; pending: number;
    failed_gates: Record<string, number>; missing_evidence: Record<string, number>;
    /** Proof the ENRICHED evidence, not discovery evidence, reached the gate. */
    evidence_source: Record<string, number>;
  };
  hiring: {
    companies_checked: number; batches: string[]; role_packs: string[];
    yc_jobs_sufficient: number; job_search_calls: number;
    jobs_returned: number; jobs_deduped: number;
    dispositions: Record<string, number>; aggregator_conflicts: number;
  };
  founders: {
    companies_searched: number; actor_used: string | null; mode: string | null;
    people_returned: number; verified: number; mismatch: number; fallback_reason: string | null;
  };
  cost: { estimated_max_usd: number; note: string };
  skipped_calls: string[];
}

const emptyDiag = (): CompanyFirstRouteDiagnostics => ({
  route: { requested: "", validated: "", executed: null, fallback_reason: null },
  discovery: [], identity: { verified: 0, ambiguous: 0, unresolved: 0, mismatch: 0 },
  enrichment: { requested: 0, completed: 0, failed: 0, skipped_unresolved: 0 },
  company_brain: { evaluated: 0, pass: 0, reject: 0, pending: 0,
    failed_gates: {}, missing_evidence: {}, evidence_source: {} },
  hiring: { companies_checked: 0, batches: [], role_packs: [], yc_jobs_sufficient: 0,
    job_search_calls: 0, jobs_returned: 0, jobs_deduped: 0, dispositions: {}, aggregator_conflicts: 0 },
  founders: { companies_searched: 0, actor_used: null, mode: null,
    people_returned: 0, verified: 0, mismatch: 0, fallback_reason: null },
  cost: { estimated_max_usd: 0,
    note: "compiler estimate only; provider run usage is NOT authoritative account spend" },
  skipped_calls: [],
});

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/**
 * Execute one company-first route end to end.
 *
 * Each stage narrows the set that reaches the next, and every narrowing is
 * recorded — a company that never reaches founder search can always be traced
 * to the gate that stopped it.
 */
export async function executeCompanyFirstRoute(
  deps: CompanyFirstRouteDeps, opts: CompanyFirstRouteOpts,
): Promise<CompanyFirstRouteResult> {
  const log = deps.log ?? (() => {});
  const d = emptyDiag();
  d.route = {
    requested: opts.route.requested_route,
    validated: opts.route.validated_route,
    executed: null,
    fallback_reason: opts.route.fallback_reason,
  };
  let estCost = 0;

  const run = async (call: CompiledActorCall<unknown>): Promise<Record<string, unknown>[]> => {
    // IDEMPOTENCY: a resumed task must not re-pay for a completed call.
    const key = call.batchIdentity;
    if (deps.callCompleted?.(key)) { d.skipped_calls.push(key); return []; }
    estCost += call.cost.estimated_max_usd;
    const rows = await deps.invoke(call);
    deps.onCallComplete?.(key);
    return rows;
  };

  // ═══ 1. DISCOVERY ════════════════════════════════════════════════════════
  const discovered: NormalizedHiringCompany[] = [];
  const ycOpenJobs = new Map<string, NormalizedHiringJob[]>();
  const maxCandidates = opts.maxCandidates ?? 50;

  for (const source of opts.route.validated_source_order) {
    if (discovered.length >= maxCandidates) break;

    if (source === "apify_yc_companies_memo23") {
      const compiled = compileMemo23YcInput({
        mode: "companies",
        regions: opts.ycRegions ?? ["United States of America"],
        industries: opts.ycIndustries ?? ["B2B"],
        isHiring: true,
        minEmployeeSize: opts.ycMinSize ?? "1+",
        maxEmployeeSize: opts.ycMaxSize ?? "250",
        scrapeOpenJobs: true,
        // Founder enrichment is DELIBERATELY off during broad discovery: it costs
        // an extra request per company for people we have not qualified yet.
        scrapeFounderDetails: false,
        maxItems: maxCandidates,
      });
      if (!compiled.ok) { log("memo23_compile_failed", compiled.errors); continue; }
      const rows = await run(compiled as CompiledActorCall<unknown>);
      const before = rows.length;
      for (const r of rows) {
        const c = normalizeMemo23Company(r);
        discovered.push(c);
        ycOpenJobs.set(c.external_source_id, normalizeMemo23OpenJobs(r));
      }
      d.discovery.push({ actor_key: source, input_hash: compiled.inputHash,
        batch: compiled.batchIdentity, rows: before, deduped: rows.length });
      recordExecutedSource(opts.routeRecord, source);

    } else if (source === "apify_yc_companies_solidcode") {
      // FALLBACK ONLY. It runs when the PRIMARY produced nothing — not merely
      // when the quota is unmet, which would spend on a second YC source on
      // every ordinary run. Explicit size bands are required because a call
      // without them duplicates memo23's coverage at 2x the per-row price.
      if (discovered.length > 0) { d.skipped_calls.push("solidcode:primary_returned_candidates"); continue; }
      if ((opts.solidcodeTeamSizes ?? []).length === 0) {
        d.skipped_calls.push("solidcode:no_team_size_bands_supplied"); continue;
      }
      // teamSize is fanned out — multiple values in one call return ZERO rows.
      const calls = fanOutSolidcodeTeamSizes(
        { regions: ["United States of America"], industries: ["B2B"], isHiring: true,
          includeJobs: true, includeFounders: false, maxResults: maxCandidates },
        opts.solidcodeTeamSizes ?? [],
      );
      for (const compiled of calls) {
        if (!compiled.ok) { log("solidcode_compile_failed", compiled.errors); continue; }
        const rows = await run(compiled as CompiledActorCall<unknown>);
        for (const r of rows) discovered.push(normalizeSolidcodeCompany(r));
        d.discovery.push({ actor_key: source, input_hash: compiled.inputHash,
          batch: compiled.batchIdentity, rows: rows.length, deduped: rows.length });
      }
      if (calls.some((c) => c.ok)) recordExecutedSource(opts.routeRecord, source);

    } else if (source === "apify_linkedin_company_search") {
      // General route discovery is handled by the caller-supplied invoker using
      // the same compiler; candidates are normalized as candidate-only.
      recordExecutedSource(opts.routeRecord, source);
    }
  }

  // Deduplicate candidates on their namespaced source id.
  const seen = new Set<string>();
  const candidates = discovered.filter((c) => {
    if (seen.has(c.external_source_id)) return false;
    seen.add(c.external_source_id); return true;
  });

  // ═══ 2. IDENTITY ═════════════════════════════════════════════════════════
  const rows: CompanyFirstRouteResult["companies"] = [];
  for (const c of candidates) {
    let rec = newCompanyRecord(c.external_source_id);
    // memo23 supplies no LinkedIn URL, so most YC candidates need a lookup.
    let lookups: Array<{ name: string | null; linkedinUrl: string | null; website: string | null }> = [];
    if (!c.linkedin_company_url && (c.company_name || c.canonical_domain)) {
      const compiled = compileHarvestCompanyDetailsInput({
        searches: c.company_name ? [c.company_name] : [],
      });
      if (compiled.ok) {
        const found = await run(compiled as CompiledActorCall<unknown>);
        lookups = found.map((f) => ({
          name: (f.name as string) ?? null,
          linkedinUrl: (f.linkedinUrl as string) ?? null,
          website: (f.website as string) ?? null,
        }));
      }
    }
    const identity = resolveIdentityAgainstLookups({
      company_key: c.external_source_id, name: c.company_name,
      website: c.website, canonical_domain: c.canonical_domain,
      linkedin_company_url: c.linkedin_company_url,
    }, lookups);

    if (identity.status === "verified_match") d.identity.verified++;
    else if (identity.status === "ambiguous") d.identity.ambiguous++;
    else if (identity.status === "mismatch") d.identity.mismatch++;
    else d.identity.unresolved++;

    if (!identityIsActionable(identity)) {
      rec = advance(rec, "identity_pending", identity.status);
      rec.missing_evidence.push(...identity.evidence);
    }
    rows.push({ record: rec, company: c, identity, enriched: null, hiring_jobs: [], founders: [] });
  }

  // ═══ 3. MANDATORY ENRICHMENT ═════════════════════════════════════════════
  // Batched: linkedin-company accepts many URLs per call.
  const enrichable = rows.filter((r) => identityIsActionable(r.identity));
  d.enrichment.skipped_unresolved = rows.length - enrichable.length;
  if (enrichable.length > 0) {
    const compiled = compileHarvestCompanyDetailsInput({
      companies: enrichable.map((r) => r.identity.linkedin_company_url!),
    });
    if (compiled.ok) {
      d.enrichment.requested = enrichable.length;
      const enrichedRows = await run(compiled as CompiledActorCall<unknown>);
      const byUrl = new Map<string, Record<string, unknown>>();
      for (const e of enrichedRows) {
        const u = String(e.linkedinUrl ?? "").toLowerCase().replace(/\/$/, "");
        if (u) byUrl.set(u, e);
      }
      for (const r of enrichable) {
        const key = String(r.identity.linkedin_company_url).toLowerCase().replace(/\/$/, "");
        const hit = byUrl.get(key);
        if (!hit) { d.enrichment.failed++; r.record = advance(r.record, "enrichment_pending", "no_enrichment_row"); continue; }
        // Provenance is PRESERVED: the YC/discovery record stays on `company`,
        // the LinkedIn record lands on `enriched`. Neither overwrites the other.
        r.enriched = normalizeLinkedInCompanyEnriched(hit);
        d.enrichment.completed++;
        r.record = advance(r.record, "enrichment_complete", "linkedin_company_enriched");
      }
    }
  }

  // ═══ 4. COMPANY-FIT GATE (enriched evidence only) ════════════════════════
  for (const r of rows) {
    if (r.record.stage === "identity_pending") {
      r.record = advance(r.record, "company_fit_pending", "identity_unresolved");
      d.company_brain.pending++; d.company_brain.evaluated++;
      bump(d.company_brain.missing_evidence, "identity_unresolved");
      bump(d.company_brain.evidence_source, "none");
      continue;
    }
    const e = r.enriched;
    // PROOF OF HANDOFF: which evidence the gate actually read.
    bump(d.company_brain.evidence_source, e ? "enriched_linkedin_company" : "discovery_only");
    const fit = evaluateCompanyFit({
      company_key: r.company.external_source_id,
      company_name: e?.company_name ?? r.company.company_name,
      identity_status: r.identity.status,
      enrichment_complete: !!e,
      // Exact count from ENRICHMENT only. YC teamSize and employeeCountRange
      // are never read here — both contradicted reality in the benchmark.
      employee_count: e?.employee_count ?? null,
      employee_range_advisory: e?.employee_range_advisory ?? r.company.employee_range_advisory,
      employee_min: opts.brain?.employee_min ?? null,
      employee_max: opts.brain?.employee_max ?? null,
      industry_ids: e?.industry_ids ?? [],
      positive_industries: opts.brain?.positive_industries,
      excluded_industries: opts.brain?.excluded_industries,
      geography: e?.geography ?? r.company.geography,
      required_geography: opts.brain?.required_geography ?? null,
      description: e?.description ?? r.company.description,
      provider_industry: e?.provider_industry ?? r.company.provider_industry,
      canonical_domain: e?.canonical_domain ?? r.company.canonical_domain,
    });
    d.company_brain.evaluated++;
    for (const g of fit.failed_gates) bump(d.company_brain.failed_gates, g);
    for (const m of fit.missing_evidence) bump(d.company_brain.missing_evidence, m);
    r.record.aggregator = fit.aggregator;
    r.record = advance(r.record, fit.stage, fit.reason);
    r.record.failed_gates = fit.failed_gates;
    if (fit.stage === "company_fit_pass") d.company_brain.pass++;
    else if (fit.stage === "company_fit_reject") d.company_brain.reject++;
    else d.company_brain.pending++;
  }

  // ═══ 5. COMPANY-RESTRICTED HIRING VERIFICATION ═══════════════════════════
  const packs = opts.rolePacks ?? DEFAULT_ROLE_PACKS;
  d.hiring.role_packs = packs.map((p) => p.pack_id);
  // ONLY company_fit_pass. A reject never costs a job-search call.
  const fitPass = rows.filter((r) => r.record.stage === "company_fit_pass");
  d.hiring.companies_checked = fitPass.length;

  const needsJobSearch: typeof fitPass = [];
  for (const r of fitPass) {
    r.record = advance(r.record, "hiring_pending", "checking_hiring_signal");
    // YC evidence first — it is already paid for.
    const yc = ycOpenJobs.get(r.company.external_source_id) ?? [];
    const ycHits = packs.flatMap((p) => filterJobsForPack(yc, p).kept);
    if (ycHits.length > 0) {
      r.hiring_jobs = ycHits;
      d.hiring.yc_jobs_sufficient++;
      for (const h of ycHits) bump(d.hiring.dispositions, h.title_judgement.disposition);
      r.record = advance(r.record, "hiring_verified", "yc_open_jobs_matched_pack");
      r.record = advance(r.record, "qualified_company", "hiring_signal_verified");
    } else {
      needsJobSearch.push(r);
    }
  }

  // Batch the remainder, at most 10 companies per call, packs kept separate.
  for (let i = 0; i < needsJobSearch.length; i += 10) {
    const batch = needsJobSearch.slice(i, i + 10);
    const urls = batch.map((b) => b.identity.linkedin_company_url!).filter(Boolean);
    if (urls.length === 0) continue;
    for (const pack of packs) {
      const compiled = compileHarvestJobSearchInput({
        company: urls, jobTitles: [...pack.titles],
        locations: opts.brain?.required_geography ? [opts.brain.required_geography] : undefined,
        postedLimit: opts.postedLimit ?? "month", sortBy: "date", maxItems: 6,
      });
      if (!compiled.ok) { log("job_search_compile_failed", compiled.errors); continue; }
      d.hiring.batches.push(compiled.batchIdentity);
      d.hiring.job_search_calls++;
      const jobRows = await run(compiled as CompiledActorCall<unknown>);
      d.hiring.jobs_returned += jobRows.length;
      const jobs = dedupeJobs(jobRows.map(normalizeLinkedInJob));
      d.hiring.jobs_deduped += jobs.length;
      const kept = filterJobsForPack(jobs, pack).kept;
      for (const j of jobs) {
        const jd = filterJobsForPack([j], pack).kept.length > 0 ? "kept" : "filtered";
        bump(d.hiring.dispositions, jd === "kept" ? "exact_or_family" : "rejected_by_post_filter");
      }
      for (const b of batch) {
        const mine = kept.filter((k) =>
          (k.company_linkedin_url ?? "").toLowerCase().replace(/\/$/, "") ===
          String(b.identity.linkedin_company_url).toLowerCase().replace(/\/$/, ""));
        if (mine.length === 0) continue;
        // AGGREGATOR CHECK: a posting only proves hiring when the posting
        // company is the employer.
        const agg = extractAggregatorEvidence({
          company_name: b.enriched?.company_name ?? b.company.company_name,
          industry_ids: b.enriched?.industry_ids ?? [],
          description: b.enriched?.description ?? null,
          postings: mine.map((m) => ({ job_id: m.job_id, title: m.title, description: m.description })),
        });
        if (agg.status === "supported") {
          d.hiring.aggregator_conflicts++;
          b.record.aggregator = agg;
          continue;   // not proof this company is hiring
        }
        b.hiring_jobs = [...b.hiring_jobs, ...mine];
      }
    }
  }
  for (const r of needsJobSearch) {
    if (r.hiring_jobs.length > 0) {
      r.record = advance(r.record, "hiring_verified", "job_search_matched_pack");
      r.record = advance(r.record, "qualified_company", "hiring_signal_verified");
    } else {
      r.record = advance(r.record, "hiring_not_verified", "no_requested_role_found");
    }
  }

  // ═══ 6. FOUNDER DISCOVERY (qualified companies only) ═════════════════════
  const qualified = rows.filter((r) =>
    r.record.history.some((h) => h.stage === "qualified_company"));
  if (qualified.length > 0) {
    const compiled = compileHarvestCompanyEmployeesInput({
      companies: qualified.map((q) => q.identity.linkedin_company_url!),
      jobTitles: ["Founder", "Co-Founder", "CEO"],
      // The exact live enum — the sibling Actor's "Short" silently costs double.
      profileScraperMode: "Short ($4 per 1k)",
      companyBatchMode: "all_at_once",
      maxItems: qualified.length * (opts.foundersPerCompany ?? 5),
      maxItemsPerCompany: opts.foundersPerCompany ?? 5,
    });
    if (compiled.ok) {
      d.founders.companies_searched = qualified.length;
      d.founders.actor_used = compiled.actorId;
      d.founders.mode = compiled.input.profileScraperMode;
      for (const q of qualified) q.record = advance(q.record, "founder_pending", "searching_founders");
      const people = dedupePeople(
        (await run(compiled as CompiledActorCall<unknown>))
          .map((p) => normalizeHarvestPerson(p, compiled.actorId)));
      d.founders.people_returned = people.length;
      for (const q of qualified) {
        const url = String(q.identity.linkedin_company_url);
        const mine = people.filter((p) => {
          const v = deps.verifyEmployer(p, url);
          return v.verified;
        });
        if (mine.length > 0) {
          q.founders = mine.slice(0, opts.foundersPerCompany ?? 5);
          d.founders.verified += q.founders.length;
          q.record = advance(q.record, "founder_verified", "employer_verified");
          q.record = advance(q.record, "contact_pending", "ready_for_contact_enrichment");
        } else {
          d.founders.mismatch++;
          q.record = advance(q.record, "founder_mismatch", "no_verified_current_employer");
        }
      }
    }
  }

  d.route.executed = opts.routeRecord.executed_route;
  d.cost.estimated_max_usd = Number(estCost.toFixed(6));
  return {
    executed_source_order: [...opts.routeRecord.executed_source_order],
    companies: rows,
    funnel: projectFunnel(rows.map((r) => r.record)),
    diagnostics: d,
  };
}
