// Lead action executor — the live bridge between run-agent and the (pure,
// fixture-tested) leadActionRunner. It maps a lead_candidates row into a
// LeadRecord, adapts the real runTool(scrape_url / source_with_apify) calls into
// the runner's injected provider callables, runs the requested action, and
// persists results into EXISTING storage (lead_candidates.raw jsonb, contacts,
// outreach_drafts, approvals) — no schema changes.
//
// Pure helpers (mapFirecrawlResult, normalizePeopleSearchRows, leadRecordFromRow,
// peopleSearchQuery) are exported for unit testing without a DB.

import {
  runCompanyEnrichment, runGenerateOutreach,
  type LeadRecord, type FirecrawlFn, type PeopleSearchInput,
} from "./leadActionRunner.ts";
import type { PeopleSearchContact } from "./decisionMakers.ts";
import { evaluateDraftGate, buildDraftGateInputFromRaw } from "./draftGate.ts";
import { runDecisionMakerAction, type LeadRecordLike } from "./decisionMaker/integration.ts";
import { makePeopleSearchProvider } from "./decisionMaker/providerAdapter.ts";
import {
  buildPersonalizationContext, assessOpenerEligibility, generateOpener,
  buildOpenerStagePayload, buildOpenerObservability, brainContextFromProfile,
  type ModelBoundary, type OutreachOutputMode,
} from "./workbench/openerBackend.ts";
import { makeOpenerModel } from "./workbench/openerModel.ts";
import {
  readAccountState, applyStageUpdate, deriveGateFields, outreachPrerequisite,
  nextBestAction, WORKBENCH_STATE_KEY,
  type CompanyResearchState, type DecisionMakerState,
} from "./workbench/accountState.ts";

export type LeadAction = "research_company" | "find_decision_makers" | "generate_outreach";

/**
 * A lead action operates on EXISTING selected Workbench rows. Validate the
 * request so run-agent can refuse (400) instead of ever falling through to a
 * Scout sourcing workflow when no lead_candidate_ids are supplied.
 */
export function validateLeadActionRequest(
  leadAction: string | undefined,
  leadCandidateIds: unknown,
): { ok: true; ids: string[] } | { ok: false; error: string; message: string } {
  const ids = Array.isArray(leadCandidateIds)
    ? [...new Set(leadCandidateIds.filter((x): x is string => typeof x === "string" && !!x))]
    : [];
  if (ids.length === 0) {
    return { ok: false, error: "lead_action_requires_lead_candidate_ids", message: "Select one or more Workbench rows first." };
  }
  return { ok: true, ids };
}

// Minimal shape of the runTool result / callable we depend on.
export interface ToolResultLike { ok: boolean; data?: unknown; unavailable?: boolean; error?: string }
// ctx is `any` so run-agent's runTool(…, ctx: ToolContext) is assignable here
// (function parameter bivariance) without importing ToolContext.
export type RunToolFn = (toolName: string, input: unknown, ctx: any) => Promise<ToolResultLike>;

export interface ExecCtx {
  admin: any;                 // supabase service client (same one run-agent holds)
  workspace_id: string;
  /** Null for a direct Workbench action, which has no orchestrated plan. */
  plan_id: string | null;
  task_id: string;
  agent_id?: string | null;
  agent_slug?: string | null;
  agent_name?: string | null;
  user_id?: string | null;
  /** Requested execution mode; source_and_qualify_only forbids draft writes. */
  execution_mode?: string | null;
  /**
   * EXPLICIT outreach output mode. Absent → full_draft, which is exactly the
   * pre-existing behaviour for every non-Workbench caller.
   */
  output_mode?: OutreachOutputMode | null;
  /** Injected in tests so no model is ever reached. */
  openerModel?: ModelBoundary;
  runTool: RunToolFn;
  toolCtx: unknown;           // ToolContext passed straight through to runTool
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Injectable-friendly clock. Stage timestamps must be deterministic in tests. */
function nowIso(): string {
  return new Date().toISOString();
}

/** A posting older than 60 days may not ground a "they're hiring" claim. */
const POSTING_FRESH_DAYS = 60;
export function isFreshPosting(postedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!postedAt) return false;
  const t = Date.parse(postedAt);
  if (Number.isNaN(t)) return false;
  return (now.getTime() - t) <= POSTING_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

/** Map a lead_candidates DB row (with joined account) into a runner LeadRecord. */
export function leadRecordFromRow(row: any): LeadRecord {
  const raw = (row?.raw && typeof row.raw === "object") ? row.raw as Record<string, any> : {};
  const account = row?.accounts ?? row?.account ?? {};
  return {
    lead_candidate_id: row?.id,
    company_name: str(account?.name) ?? str(raw.company_name) ?? str(raw.company),
    website: str(raw.company_website) ?? str(raw.website) ?? str(account?.website_url),
    company_website: str(raw.company_website) ?? str(raw.website),
    domain: str(raw.domain) ?? str(account?.domain),
    company_linkedin_url: str(raw.company_linkedin_url) ?? str(account?.linkedin_url),
    company_description: str(raw.company_description),
    job_description: str(raw.job_description),
    job_title: str(raw.job_title),
    job_url: str(raw.job_url) ?? str(raw.source_url),
    posted_at: str(raw.posted_at),
    employee_count: typeof raw.employee_count === "number" ? raw.employee_count : null,
    industries: Array.isArray(raw.industries) ? raw.industries : null,
    poster_contact_hint: (raw.poster_contact_hint && typeof raw.poster_contact_hint === "object") ? raw.poster_contact_hint : null,
    gate_decision: str(raw.gate_decision),
    source_quality: str(raw.source_quality),
    source_proof: Array.isArray(raw.source_proof) ? raw.source_proof : [],
    why_now: str(raw.why_now),
    icp_fit_summary: str(raw.icp_fit_summary),
    evidence_summary: str(raw.evidence_summary),
    missing_evidence: Array.isArray(raw.missing_evidence) ? raw.missing_evidence : null,
    company_enrichment: (raw.company_enrichment && typeof raw.company_enrichment === "object") ? raw.company_enrichment : null,
    decision_makers: Array.isArray(raw.decision_makers) ? raw.decision_makers : null,
  };
}

/** Adapt a scrape_url ToolResult into the runner's Firecrawl page shape. */
export function mapFirecrawlResult(res: ToolResultLike | null): { markdown: string | null; title?: string | null } | null {
  if (!res || !res.ok || !res.data || typeof res.data !== "object") return null;
  const d = res.data as Record<string, unknown>;
  const markdown = str(d.markdown) ?? str(d.content) ?? str(d.text) ?? str(d.summary);
  return markdown ? { markdown, title: str(d.title) } : null;
}

/** Deterministic, single-company people-search query from the constrained titles. */
export function peopleSearchQuery(input: PeopleSearchInput): string {
  return `${input.titles.join(" OR ")} at ${input.company}`;
}

/** Normalize Apify people-search output rows into PeopleSearchContact[]. */
export function normalizePeopleSearchRows(data: unknown): PeopleSearchContact[] {
  const items = (data && typeof data === "object" && Array.isArray((data as any).items))
    ? (data as any).items as any[]
    : Array.isArray(data) ? data as any[] : [];
  const out: PeopleSearchContact[] = [];
  for (const it of items) {
    const name = str(it?.name) ?? str(it?.full_name) ?? ([str(it?.firstName), str(it?.lastName)].filter(Boolean).join(" ") || null);
    const linkedin = str(it?.linkedin_url) ?? str(it?.linkedinUrl) ?? str(it?.profile_url) ?? str(it?.profileUrl) ?? str(it?.url);
    if (!name || !linkedin) continue;   // never fabricate — require name + profile
    // Candidate's CURRENT company (name + LinkedIn URL) — used to verify they
    // actually belong to the selected lead. Nested (currentPosition) or flat.
    const cp = Array.isArray(it?.currentPosition) ? (it.currentPosition[0] ?? {}) : (it?.currentPosition ?? {});
    const company = str(it?.company) ?? str(it?.companyName) ?? str(it?.currentCompany) ?? str(cp?.companyName) ?? str(cp?.company);
    const companyUrl = str(it?.companyLinkedinUrl) ?? str(it?.companyUrl) ?? str(it?.companyPageUrl) ?? str(cp?.companyLinkedinUrl) ?? str(cp?.companyUrl) ?? str(cp?.companyPageUrl);
    out.push({ name, title: str(it?.title) ?? str(it?.headline) ?? str(it?.position), linkedin_url: linkedin, company, company_url: companyUrl, headline: str(it?.headline) });
  }
  return out;
}

async function loadLeads(ctx: ExecCtx, leadIds: string[]): Promise<any[]> {
  const { data } = await ctx.admin
    .from("lead_candidates")
    .select("id, raw, workspace_id, account_id, accounts(name, domain, website_url, linkedin_url)")
    .in("id", leadIds);
  return Array.isArray(data) ? data : [];
}

/** Merge a patch into a lead's raw jsonb without dropping existing keys. */
async function patchLeadRaw(ctx: ExecCtx, leadId: string, existingRaw: any, patch: Record<string, unknown>): Promise<void> {
  const base = (existingRaw && typeof existingRaw === "object") ? existingRaw : {};
  await ctx.admin.from("lead_candidates").update({ raw: { ...base, ...patch } }).eq("id", leadId);
}

export interface LeadActionOutcome {
  action: LeadAction;
  per_lead: Array<Record<string, unknown>>;
  summary: string;
  needs_approval: boolean;
}

/**
 * Execute one Workbench lead action live, per selected lead. Approval-gated and
 * evidence-first; never sends. Returns a structured, user-visible outcome.
 */
export async function executeLeadAction(action: LeadAction, leadIds: string[], ctx: ExecCtx): Promise<LeadActionOutcome> {
  const ids = [...new Set((leadIds ?? []).filter((x) => typeof x === "string" && x))];
  const rows = ids.length ? await loadLeads(ctx, ids) : [];
  const per_lead: Array<Record<string, unknown>> = [];
  let needsApproval = false;

  for (const row of rows) {
    const lead = leadRecordFromRow(row);

    if (action === "research_company") {
      const firecrawl: FirecrawlFn = async (url) => mapFirecrawlResult(await ctx.runTool("scrape_url", { url, extraction_goal: `Company research for ${lead.company_name ?? url}`, max_pages: 1 }, ctx.toolCtx));
      const res = await runCompanyEnrichment(lead, firecrawl);
      if (res.status !== "blocked") {
        // Record the stage in the account state as well, so a later action can
        // read what research established without re-deriving it from prose.
        const e = res.enrichment;
        const evidence_urls = Array.isArray(e?.evidence_urls) ? e.evidence_urls : [];
        const researchPayload: CompanyResearchState = {
          summary: (e?.company_summary as string | undefined) ?? null,
          evidence_urls,
          missing_evidence: Array.isArray(e?.missing_evidence) ? e.missing_evidence : [],
          confidence: (e?.confidence as string | undefined) ?? null,
          // "Provider completed" is not enough: usable means we actually hold a
          // summary backed by at least one source.
          usable: !!e?.company_summary && evidence_urls.length > 0,
        };
        const merged = applyStageUpdate(
          readAccountState(row.raw as Record<string, unknown>, lead.lead_candidate_id),
          "company_research",
          { status: res.status === "enriched" ? "succeeded" : "partial", reason_code: res.blocked_reason ?? null, payload: researchPayload },
          nowIso(),
        );
        await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, {
          company_enrichment: res.enrichment,
          [WORKBENCH_STATE_KEY]: merged,
        });
      }
      per_lead.push({ lead_candidate_id: lead.lead_candidate_id, company: lead.company_name, status: res.status, blocked_reason: res.blocked_reason, pages_fetched: res.pages_fetched, summary_lines: res.summary_lines });

    } else if (action === "find_decision_makers") {
      // Reliable pipeline (identity → bounded search → normalize → verify current
      // employer → classify role → dedupe → rank → verified-only persistence).
      // It replaces the legacy peopleContactsToDecisionMakers path, which accepted
      // name-only and headline matches and collapsed every provider failure into
      // an empty array.
      const res = await runDecisionMakerAction(
        lead as unknown as LeadRecordLike,
        { workspace_id: ctx.workspace_id },
        {
          provider: makePeopleSearchProvider(ctx.runTool, ctx.toolCtx),
          lookupContacts: async (workspaceId) => {
            const { data } = await ctx.admin.from("contacts").select("id, linkedin_url").eq("workspace_id", workspaceId);
            return (data ?? []) as Array<{ id: string; linkedin_url: string | null }>;
          },
          persistContact: async (c) => {
            const { data, error } = await ctx.admin.from("contacts").upsert({
              workspace_id: c.workspace_id, full_name: c.full_name, title: c.title,
              linkedin_url: c.linkedin_url,
              raw: { via: "decision_maker_discovery", ...c.provenance },
            }, { onConflict: "workspace_id,linkedin_url" }).select("id").maybeSingle();
            if (error || !data?.id) throw new Error("contact_write_failed");
            await ctx.admin.from("lead_candidates").update({ contact_id: data.id }).eq("id", c.lead_candidate_id);
            return data.id as string;
          },
          // Ownership comes from the row we already loaded — no extra round-trip,
          // and it is the same record the action operates on.
          resolveLeadWorkspace: async () => (row?.workspace_id as string | undefined) ?? null,
        },
      );

      // raw.decision_makers is ALSO read by runGenerateOutreach, which expects the
      // legacy DecisionMaker shape (name / title / linkedinUrl / company_match).
      // Persist a superset: legacy keys keep outreach personalization working,
      // new keys carry the verification detail.
      const rawDecisionMakers = res.decision_makers.map((d) => ({
        name: d.full_name,
        title: d.current_title,
        linkedinUrl: d.linkedin_url,
        source: "linkedin_people_search",
        confidence: d.confidence,
        evidence_url: d.linkedin_url,
        contact_status: "profile_only",
        email: null,
        email_source_url: null,
        company_match: {
          status: d.verification_status === "verified" ? "verified" : "likely",
          reason: d.verification_methods.join(", ") || "verified current employer",
          matched_on: d.verification_methods,
        },
        // New-engine detail, additive.
        full_name: d.full_name,
        linkedin_url: d.linkedin_url,
        current_title: d.current_title,
        current_company_name: d.current_company_name,
        role_family: d.role_family,
        verification_status: d.verification_status,
        verification_methods: d.verification_methods,
        rank: d.rank,
        rank_reasons: d.rank_reasons,
        persisted: d.persisted,
      }));

      const topDm = res.decision_makers[0];
      const dmPayload: DecisionMakerState = {
        verified_count: res.verified_profile_count,
        manual_review_count: res.manual_review_count,
        primary_full_name: topDm?.full_name ?? null,
        primary_linkedin_url: topDm?.linkedin_url ?? null,
        primary_role_family: topDm?.role_family ?? null,
        primary_company_name: topDm?.current_company_name ?? null,
        primary_verification_methods: topDm?.verification_methods ?? [],
        contact_id: topDm?.contact_id ?? null,
      };
      const dmMerged = applyStageUpdate(
        readAccountState(row.raw as Record<string, unknown>, lead.lead_candidate_id),
        "decision_makers",
        { status: res.status === "succeeded" ? "succeeded" : (res.status as never), reason_code: res.reason_code, payload: dmPayload },
        nowIso(),
      );
      // Record the provenance the draft gate reads. This does NOT lower the bar:
      // employerVerification only reaches "verified" on an identifier match, and
      // the person came from a provider run — so a verified decision-maker IS
      // provider-backed person identity with a verified company association.
      const gateFields = deriveGateFields(dmMerged);

      await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, {
        decision_makers: rawDecisionMakers,
        decision_maker_status: res.status,
        decision_maker_reason_code: res.reason_code,
        [WORKBENCH_STATE_KEY]: dmMerged,
        ...(gateFields.canonical_final_decision
          ? {
            canonical_final_decision: gateFields.canonical_final_decision,
            contact_ready: gateFields.contact_ready,
            provider_provenance: gateFields.provider_provenance,
            evidence_url: gateFields.evidence_url,
          }
          : {}),
        // Array (not just counts) so the UI can still say who was dropped and why.
        decision_makers_rejected: (res.rejected_profiles as Array<Record<string, unknown>>).map((r) => ({
          name: r.full_name, title: r.current_title, linkedin_url: r.linkedin_url, reason: r.reason_code,
        })),
        decision_makers_rejection_summary: res.rejection_summary,
      });

      // The pipeline's canonical status is carried through verbatim — downstream
      // must never re-infer it from decision_makers.length.
      per_lead.push({
        lead_candidate_id: res.lead_candidate_id,
        company: lead.company_name,
        status: res.status,
        reason_code: res.reason_code,
        retryable: res.retryable,
        decision_makers: res.decision_makers,
        provider_run_id: res.provider_run_id,
        returned_profile_count: res.returned_profile_count,
        verified_profile_count: res.verified_profile_count,
        rejected_count: res.rejected_profile_count,
        manual_review_count: res.manual_review_count,
        persisted_count: res.persisted_count,
        existing_contact_count: res.existing_contact_count,
        needs_manual_review: res.status === "needs_manual_review",
        observability: res.observability,
      });

    } else if (action === "generate_outreach" && ctx.output_mode === "personalized_opener") {
      // ---- PERSONALIZED OPENER -------------------------------------------
      // Explicitly requested mode. Gates on WORKBENCH-established evidence
      // rather than the sourcing-era draft-gate fields, and produces ONE short
      // opening line — never an email. The legacy full_draft path below is
      // untouched, so every non-Workbench caller behaves exactly as before.
      const acctOpener = readAccountState(row.raw as Record<string, unknown>, lead.lead_candidate_id);

      // Saved Company Brain for THIS workspace only.
      const { data: brainRow } = await ctx.admin
        .from("company_brain").select("profile, updated_at").eq("workspace_id", ctx.workspace_id).maybeSingle();

      const rawRow = (row.raw ?? {}) as Record<string, unknown>;
      const openerCtx = buildPersonalizationContext({
        lead_candidate_id: lead.lead_candidate_id,
        company_name: lead.company_name ?? null,
        industry: Array.isArray(lead.industries) ? (lead.industries[0] ?? null) : null,
        account: acctOpener,
        // Compatibility fallback for accounts whose decision-maker run predates
        // the namespaced stage — the resolver decides whether it is usable.
        legacy_decision_makers: rawRow.decision_makers,
        brain_profile: brainRow?.profile ?? null,
        // Saved ICP selects WHICH seller outcome is most relevant. It never
        // contributes a prospect fact and never reaches the message verbatim.
        saved_icp: brainRow?.profile ?? null,
        // Brain provenance: the row is workspace-keyed, so workspace_id IS its
        // identity. updated_at distinguishes versions.
        company_brain_id: ctx.workspace_id,
        company_brain_updated_at: brainRow?.updated_at ?? null,
        icp_matched_criteria: typeof rawRow.icp_fit_summary === "string" ? [rawRow.icp_fit_summary] : [],
        why_now: typeof rawRow.why_now === "string" ? rawRow.why_now : null,
        job_posting: lead.job_title
          ? { role: lead.job_title ?? null, fresh: isFreshPosting(lead.posted_at), source_domain: undefined }
          : null,
      });

      // A hard saved-ICP disqualifier overrides everything.
      const icpExcluded = rawRow.canonical_final_decision === "skip" ||
        (typeof rawRow.gate_decision === "string" && rawRow.gate_decision === "reject");

      const eligibility = assessOpenerEligibility(openerCtx, icpExcluded);
      const model = ctx.openerModel ?? makeOpenerModel({ workspaceId: ctx.workspace_id, agentSlug: ctx.agent_slug ?? "penn" });
      const openerResult = await generateOpener(openerCtx, eligibility, model);

      const stagePayload = buildOpenerStagePayload(openerResult, nowIso());
      const persisted = openerResult.status === "succeeded";

      // Merge into the OUTREACH stage only — research, ICP and decision-maker
      // state are carried through untouched, and a failed retry keeps the last
      // valid opener.
      const openerMerged = applyStageUpdate(
        acctOpener,
        "outreach",
        {
          status: persisted ? "succeeded" : (openerResult.status === "blocked" ? "failed" : openerResult.status as never),
          reason_code: openerResult.reason_code,
          payload: persisted ? stagePayload : null,
        },
        nowIso(),
      );
      await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, { [WORKBENCH_STATE_KEY]: openerMerged });

      if (persisted) needsApproval = true;

      per_lead.push({
        lead_candidate_id: lead.lead_candidate_id,
        company: lead.company_name,
        output_mode: "personalized_opener",
        status: openerResult.status,
        reason_code: openerResult.reason_code,
        opener: openerResult.opener ?? null,
        alternative_opener: openerResult.alternative_opener ?? null,
        personalization_depth: openerResult.personalization_depth,
        used_evidence_ids: openerResult.used_evidence_ids,
        validation: openerResult.validation ?? null,
        approval_required: true,
        approval_status: "draft",
        sent: false,
        retryable: openerResult.status === "timed_out" || openerResult.status === "failed",
        observability: buildOpenerObservability({
          lead_candidate_id: lead.lead_candidate_id,
          workspace_id: ctx.workspace_id,
          ctx: openerCtx,
          eligibility,
          result: openerResult,
          persisted,
        }),
      });

    } else if (action === "generate_outreach") {
      // ---- LEGACY FULL DRAFT (unchanged) ---------------------------------
      // Centralized draft gate — no outreach_drafts insert may bypass it. A draft
      // is allowed ONLY for a persisted, provider-verified, contact-ready lead whose
      // canonical decision is `contact`, and never when the mode forbids drafting.
      // Overlay the provenance the Workbench stages established, so the gate
      // evaluates the CURRENT account state rather than only sourcing-era fields.
      const acct = readAccountState(row.raw as Record<string, unknown>, lead.lead_candidate_id);
      const derived = deriveGateFields(acct);
      const gateRaw = {
        ...((row.raw ?? {}) as Record<string, unknown>),
        ...(derived.canonical_final_decision
          ? {
            canonical_final_decision: derived.canonical_final_decision,
            contact_ready: derived.contact_ready,
            provider_provenance: derived.provider_provenance,
            evidence_url: derived.evidence_url ?? (row.raw as Record<string, unknown>)?.evidence_url,
            company: derived.company ?? (row.raw as Record<string, unknown>)?.company,
          }
          : {}),
      };
      const gate = evaluateDraftGate(buildDraftGateInputFromRaw(
        gateRaw,
        { execution_mode: ctx.execution_mode, persisted_lead_candidate_id: lead.lead_candidate_id },
      ));
      if (!gate.allowed) {
        // Name the SPECIFIC missing prerequisite instead of "complete the
        // required previous step first".
        const prereq = outreachPrerequisite(acct);
        per_lead.push({
          lead_candidate_id: lead.lead_candidate_id, company: lead.company_name,
          status: "blocked_draft_gate",
          reason_code: prereq.reason,
          message: prereq.message,
          blocked_reasons: gate.blocked_reasons,
          next_best_action: nextBestAction(acct),
        });
        continue;
      }
      const res = runGenerateOutreach(lead);
      if (res.ready && res.draft.status === "draft_needs_approval") {
        const { data: d } = await ctx.admin.from("outreach_drafts").insert({
          workspace_id: ctx.workspace_id, lead_candidate_id: lead.lead_candidate_id, contact_id: row.contact_id ?? null,
          channel: "email", subject: res.draft.subject, body: res.draft.body, status: "draft",
          personalization_notes: (res.draft.risk_notes ?? []).join(" | ") || null,
          raw: res.draft,
        }).select("id").maybeSingle();
        needsApproval = true;
        per_lead.push({ lead_candidate_id: lead.lead_candidate_id, company: lead.company_name, status: "draft_needs_approval", draft_id: d?.id ?? null, recipient: res.draft.recipient_name, missing_context: res.draft.missing_context, risk_notes: res.draft.risk_notes });
      } else {
        per_lead.push({ lead_candidate_id: lead.lead_candidate_id, company: lead.company_name, status: "insufficient_context", missing_context: res.draft.missing_context, message: res.draft.body });
      }
    }
  }

  const summary = summarize(action, per_lead);
  return { action, per_lead, summary, needs_approval: needsApproval };
}

function summarize(action: LeadAction, per: Array<Record<string, unknown>>): string {
  if (action === "research_company") {
    const enriched = per.filter((p) => p.status === "enriched" || p.status === "needs_verification").length;
    const blocked = per.filter((p) => p.status === "blocked").length;
    return `Researched ${per.length} compan${per.length === 1 ? "y" : "ies"}: ${enriched} enriched, ${blocked} blocked (no site/proof or rejected).`;
  }
  if (action === "find_decision_makers") {
    const resolved = per.filter((p) => !p.needs_manual_review).length;
    return `Decision-makers for ${per.length} compan${per.length === 1 ? "y" : "ies"}: ${resolved} resolved, ${per.length - resolved} need manual review.`;
  }
  const drafted = per.filter((p) => p.status === "draft_needs_approval").length;
  return `Prepared ${drafted} draft${drafted === 1 ? "" : "s"} for approval (${per.length - drafted} skipped for insufficient context). Nothing sent.`;
}
