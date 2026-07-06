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
  runCompanyEnrichment, runDecisionMakerDiscovery, runGenerateOutreach,
  buildPeopleSearchInput, type LeadRecord, type FirecrawlFn, type PeopleSearchFn, type PeopleSearchInput,
} from "./leadActionRunner.ts";
import type { PeopleSearchContact } from "./decisionMakers.ts";

export type LeadAction = "research_company" | "find_decision_makers" | "generate_outreach";

// Minimal shape of the runTool result / callable we depend on.
export interface ToolResultLike { ok: boolean; data?: unknown; unavailable?: boolean; error?: string }
// ctx is `any` so run-agent's runTool(…, ctx: ToolContext) is assignable here
// (function parameter bivariance) without importing ToolContext.
export type RunToolFn = (toolName: string, input: unknown, ctx: any) => Promise<ToolResultLike>;

export interface ExecCtx {
  admin: any;                 // supabase service client (same one run-agent holds)
  workspace_id: string;
  plan_id: string;
  task_id: string;
  agent_id?: string | null;
  agent_slug?: string | null;
  agent_name?: string | null;
  user_id?: string | null;
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
    out.push({ name, title: str(it?.title) ?? str(it?.headline) ?? str(it?.position), linkedin_url: linkedin, company: str(it?.company) ?? str(it?.companyName), headline: str(it?.headline) });
  }
  return out;
}

async function loadLeads(ctx: ExecCtx, leadIds: string[]): Promise<any[]> {
  const { data } = await ctx.admin
    .from("lead_candidates")
    .select("id, raw, account_id, accounts(name, domain, website_url, linkedin_url)")
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
      const peopleSearch: PeopleSearchFn = async (input) => {
        const r = await ctx.runTool("source_with_apify", {
          tool_name: "source_with_apify", selected_actor_key: "apify_people_search", source_type: "people_profiles",
          query: peopleSearchQuery(input), company_linkedin_url: input.company_linkedin_url, domain: input.domain,
          role_keywords: input.titles, max_results: input.max_results,
        }, ctx.toolCtx);
        return r.ok ? normalizePeopleSearchRows(r.data) : [];
      };
      const res = await runDecisionMakerDiscovery(lead, { peopleSearch });
      await patchLeadRaw(ctx, lead.lead_candidate_id, row.raw, {
        decision_makers: res.decision_makers,
        decision_maker_status: res.needs_manual_review ? "needs_manual_review" : "resolved",
        buyer_clues: res.buyer_clues,
      });
      // Persist the top confident decision-maker as a contact candidate (with proof).
      const top = res.decision_makers.find((d) => d.linkedinUrl && d.confidence !== "low") ?? null;
      if (top?.linkedinUrl && !row.contact_id) {
        const { data: c } = await ctx.admin.from("contacts").insert({
          workspace_id: ctx.workspace_id, full_name: top.name, title: top.title, linkedin_url: top.linkedinUrl, email: top.email,
          raw: { source: top.source, via: "decision_maker_discovery", confidence: top.confidence, evidence_url: top.evidence_url, email_source_url: top.email_source_url },
        }).select("id").maybeSingle();
        if (c?.id) await ctx.admin.from("lead_candidates").update({ contact_id: c.id }).eq("id", lead.lead_candidate_id);
      }
      per_lead.push({ lead_candidate_id: lead.lead_candidate_id, company: lead.company_name, needs_manual_review: res.needs_manual_review, used_people_search: res.used_people_search, decision_makers: res.decision_makers });

    } else if (action === "generate_outreach") {
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
