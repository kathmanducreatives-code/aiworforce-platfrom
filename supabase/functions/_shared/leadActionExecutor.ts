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
  runTool: RunToolFn;
  toolCtx: unknown;           // ToolContext passed straight through to runTool
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
        await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, { company_enrichment: res.enrichment });
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

      await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, {
        decision_makers: rawDecisionMakers,
        decision_maker_status: res.status,
        decision_maker_reason_code: res.reason_code,
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

    } else if (action === "generate_outreach") {
      // Centralized draft gate — no outreach_drafts insert may bypass it. A draft
      // is allowed ONLY for a persisted, provider-verified, contact-ready lead whose
      // canonical decision is `contact`, and never when the mode forbids drafting.
      const gate = evaluateDraftGate(buildDraftGateInputFromRaw(
        (row.raw ?? {}) as Record<string, unknown>,
        { execution_mode: ctx.execution_mode, persisted_lead_candidate_id: lead.lead_candidate_id },
      ));
      if (!gate.allowed) {
        per_lead.push({ lead_candidate_id: lead.lead_candidate_id, company: lead.company_name, status: "blocked_draft_gate", blocked_reasons: gate.blocked_reasons });
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
