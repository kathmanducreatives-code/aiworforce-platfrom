// Phase 2: Persistent Signal Memory — writer.
//
// Converts tool/agent outputs into structured GTM memory rows so follow-up
// messages can use them. Writes are fire-and-forget: failures are logged but
// never propagate to the caller, so tool/agent execution is never broken by
// a memory write error.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchCompetitors } from "./competitorRegistry.ts";
import { classifyConversationType } from "./competitorDiscovery.ts";
import { buildDecisionMakers } from "./decisionMakers.ts";
import { evaluateDraftGate } from "./draftGate.ts";
import { isSourceAndQualifyOnly } from "./executionMode.ts";
import { guardProviderLeadInsert, type LeadOrigin, type RejectionCounter } from "./leadPersistenceGuard.ts";
import type { NormalizedProviderItem, ProvenanceCtx } from "./leadHandoffGuard.ts";
// Signals Storage V2 (Phase 2) — flagged, best-effort dual-write. These are pure,
// provider-free modules; importing them has no side effects and no DB access until
// a writer is explicitly called under an enabled flag.
import { isSignalsV2Enabled } from "./signalsV2Flag.ts";
import { dualWritePeopleProfileV2, dualWriteHiringSignalV2 } from "./signalsV2DualWrite.ts";
import { jobRecordToSignalEvent, type NormalizedJobLike } from "./jobsSignalAdapter.ts";

// ---------- Inlined normalizers (mirrors src/components/chat/workspace/workbench/normalize.ts) ----------

interface ApifyJobItem {
  company?: string; title?: string; location?: string; url?: string;
  companyUrl?: string; description?: string; postedAt?: string; source?: string; raw: any;
  // Promoted jobs fields (from normalizeApifyItem / apifyJobsNormalizer). Preserve
  // them so the Workbench stops showing "no website" / "proof_incomplete".
  website?: string | null; domain?: string | null; companyLinkedinUrl?: string | null;
  sourceProof?: any[]; sourceQuality?: string | null; posterContactHint?: any;
  industries?: string[]; employeeCount?: number | null; companyDescription?: string | null;
  jobDescription?: string | null;
  // Extended Apify evidence (company identity + job context + provider ids).
  companyLogo?: string | null; companySlogan?: string | null; companyAddress?: any;
  applyUrl?: string | null; employmentType?: string | null; seniorityLevel?: string | null;
  jobFunction?: string | null; salary?: string | null; applicantsCount?: number | null;
  providerJobId?: string | null; providerRefId?: string | null; providerTrackingId?: string | null;
  inputUrl?: string | null;
}
function normalizeApifyItems(output: any): ApifyJobItem[] {
  if (!output) return [];
  const raw =
    (Array.isArray(output.items) && output.items) ||
    (Array.isArray(output.results) && output.results) ||
    (Array.isArray(output.data) && output.data) ||
    (Array.isArray(output.normalized_items) && output.normalized_items) || [];
  return raw.map((it: any) => {
    const jraw = (it.raw && typeof it.raw === "object") ? it.raw : {};
    // company website: prefer the promoted field, then raw clean field, then the
    // provider's own companyWebsite, then legacy fallbacks. FIX: companyWebsite
    // was missing before → accounts had no domain → "no website".
    const website = it.website ?? it.company_website ?? jraw.company_website ?? it.companyWebsite ?? it.companyUrl ?? it.companyLink ?? null;
    return {
      company: it.company ?? it.companyName ?? it.company_name ?? it.organization,
      title: it.title ?? it.job_title ?? it.jobTitle ?? it.position ?? it.name,
      location: it.location ?? it.jobLocation ?? it.formattedLocation ?? it.city,
      url: it.job_url ?? it.url ?? it.jobUrl ?? it.link ?? it.applyUrl,
      companyUrl: website,
      website,
      domain: it.domain ?? jraw.domain ?? null,
      companyLinkedinUrl: it.company_linkedin_url ?? jraw.company_linkedin_url ?? it.companyLinkedinUrl ?? null,
      description: it.job_description ?? it.description ?? it.snippet ?? it.summary,
      companyDescription: it.company_description ?? jraw.company_description ?? null,
      jobDescription: it.job_description ?? jraw.job_description ?? it.description ?? null,
      industries: it.industries ?? jraw.industries ?? [],
      employeeCount: it.employee_count ?? jraw.employee_count ?? null,
      posterContactHint: it.poster_contact_hint ?? jraw.poster_contact_hint ?? null,
      sourceProof: it.source_proof ?? jraw.source_proof ?? [],
      sourceQuality: it.source_quality ?? jraw.source_quality ?? null,
      postedAt: it.posted_at ?? it.postedAt ?? jraw.posted_at ?? it.datePosted ?? null,
      source: it.source ?? it.platform,
      // Extended evidence — prefer the promoted clean field, then the clean raw.
      companyLogo: it.company_logo ?? jraw.company_logo ?? it.companyLogo ?? null,
      companySlogan: it.company_slogan ?? jraw.company_slogan ?? it.companySlogan ?? null,
      companyAddress: it.company_address ?? jraw.company_address ?? null,
      applyUrl: it.apply_url ?? jraw.apply_url ?? it.applyUrl ?? null,
      employmentType: it.employment_type ?? jraw.employment_type ?? it.employmentType ?? null,
      seniorityLevel: it.seniority_level ?? jraw.seniority_level ?? it.seniorityLevel ?? null,
      jobFunction: it.job_function ?? jraw.job_function ?? it.jobFunction ?? null,
      salary: it.salary ?? jraw.salary ?? null,
      applicantsCount: it.applicants_count ?? jraw.applicants_count ?? it.applicantsCount ?? null,
      providerJobId: it.provider_job_id ?? jraw.provider_job_id ?? it.id ?? null,
      providerRefId: it.provider_ref_id ?? jraw.provider_ref_id ?? it.refId ?? null,
      providerTrackingId: it.provider_tracking_id ?? jraw.provider_tracking_id ?? it.trackingId ?? null,
      inputUrl: it.input_url ?? jraw.input_url ?? it.inputUrl ?? null,
      raw: it,
    };
  });
}

interface ApifyPeopleItem {
  full_name?: string; headline?: string; title?: string; location?: string;
  company?: string; profile_url?: string; summary?: string; source?: string; raw: any;
}
function isPeopleOutput(output: any): boolean {
  if (!output) return false;
  if (output.normalized_source_type === "people_profiles") return true;
  if (output.actor_output_type === "people_profiles") return true;
  const list = Array.isArray(output.items) ? output.items : [];
  if (list.length === 0) return false;
  const first = list[0];
  return !!(first && (first.signal_type === "people_profile" || first.profile_url || first.full_name));
}
function normalizeApifyPeople(output: any): ApifyPeopleItem[] {
  if (!output) return [];
  const list = Array.isArray(output.items) ? output.items : [];
  return list.map((it: any) => ({
    full_name: it.full_name ?? it.fullName ?? it.name,
    headline: it.headline,
    title: it.title ?? it.currentJobTitle ?? it.jobTitle,
    location: it.location ?? it.geoLocation,
    company: it.company ?? it.currentCompany ?? it.companyName,
    profile_url: it.profile_url ?? it.profileUrl ?? it.linkedinUrl ?? it.url,
    summary: it.summary ?? it.about,
    source: it.source ?? "apify",
    raw: it,
  }));
}

interface FirecrawlResult { url?: string; title?: string; markdown?: string; summary?: string; }
function normalizeFirecrawl(output: any): FirecrawlResult {
  if (!output) return {};
  const d = output.data ?? output;
  return {
    url: d.url ?? d.source_url ?? output.url,
    title: d.title ?? d.metadata?.title,
    markdown: d.markdown ?? d.content ?? d.text,
    summary: d.summary ?? output.summary,
  };
}

interface AriaRanking { name?: string; company?: string; score?: number; tier?: string; fit?: string; next?: string; raw: any; }
function normalizeAriaRankings(output: any): AriaRanking[] {
  if (!output) return [];
  const list =
    (Array.isArray(output.rankings) && output.rankings) ||
    (Array.isArray(output.ranked) && output.ranked) ||
    (Array.isArray(output.candidates) && output.candidates) ||
    (Array.isArray(output) && output) || [];
  return list.map((r: any) => ({
    name: r.name ?? r.candidate ?? r.lead ?? r.title,
    company: r.company ?? r.organization,
    score: typeof r.score === "number" ? r.score : typeof r.fit_score === "number" ? r.fit_score : undefined,
    tier: r.tier ?? r.classification ?? r.label,
    fit: r.fit ?? r.fit_reason ?? r.why,
    next: r.next ?? r.next_action ?? r.recommendation,
    raw: r,
  }));
}

interface PennDraft { subject?: string; body?: string; linkedin?: string; personalization?: string; }
function normalizePennDrafts(output: any): PennDraft[] {
  if (!output) return [];
  const list =
    (Array.isArray(output.drafts) && output.drafts) ||
    (Array.isArray(output.emails) && output.emails) ||
    (Array.isArray(output) && output) || [output];
  return list
    .filter((d: any) => d && typeof d === "object")
    .map((d: any) => ({
      subject: d.subject ?? d.title,
      body: d.body ?? d.email ?? d.text ?? d.html,
      linkedin: d.linkedin ?? d.linkedin_note ?? d.dm,
      personalization: d.personalization ?? d.notes,
    }));
}

interface BaseCtx {
  admin: SupabaseClient;
  workspace_id: string;
  conversation_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  /** Requested execution mode; source_and_qualify_only forbids draft writes. */
  execution_mode?: string | null;
  // ---- provider provenance context (Find Leads sourcing) ----
  /** Provider name (e.g. "apify"). */
  provider?: string | null;
  /** Specific actor implementation (e.g. harvestapi/linkedin-profile-search). */
  actor_id?: string | null;
  /** Logical actor key (e.g. apify_people_search). */
  actor_key?: string | null;
  /** Normalized artifact type (person_candidate / company_candidate / job_signal). */
  artifact_type?: string | null;
  provider_run_id?: string | null;
  workflow_run_id?: string | null;
  trace_id?: string | null;
  /** When true, an INVALID provider provenance BLOCKS the lead insert (no verified=false ride-along). */
  enforce_provenance?: boolean;
  /** Origin for leads written in this ctx (default provider_sourced for provider writers). */
  lead_origin?: LeadOrigin;
  /** Accumulates rejected-provenance count/reasons for the terminal no_results payload. */
  provenance_rejections?: RejectionCounter;
}

/**
 * Centralized pre-insert provenance decision for a provider-sourced lead. Returns
 * the raw patch to stamp (lead_origin + provider_provenance) when allowed, or null
 * when the insert must be blocked. When ctx.enforce_provenance is not set, invalid
 * provenance is stamped (verified=false) but not hard-blocked (legacy callers);
 * the draft gate still refuses drafts for verified=false leads.
 */
function leadPersistenceDecision(
  ctx: BaseCtx,
  item: NormalizedProviderItem,
  level: "account" | "person",
): { blocked: boolean; patch: Record<string, unknown> } {
  const origin: LeadOrigin = ctx.lead_origin ?? "provider_sourced";
  const provCtx: ProvenanceCtx = {
    provider: ctx.provider ?? "apify",
    actor_id: ctx.actor_id ?? null,
    actor_key: ctx.actor_key ?? null,
    artifact_type: ctx.artifact_type ?? null,
    provider_run_id: ctx.provider_run_id ?? null,
    workflow_run_id: ctx.workflow_run_id ?? null,
    plan_id: ctx.plan_id ?? null,
    trace_id: ctx.trace_id ?? null,
  };
  const g = guardProviderLeadInsert({ origin, level, item: { ...item, ...(level === "person" ? { person_linkedin_url: item.person_linkedin_url ?? item.profile_url ?? null } : {}) }, ctx: provCtx, counter: ctx.provenance_rejections });
  if (!g.allow && ctx.enforce_provenance === true) {
    return { blocked: true, patch: {} };
  }
  return { blocked: false, patch: { lead_origin: origin, provider_provenance: g.provenance ?? null } };
}

interface ToolCallCtx extends BaseCtx {
  tool_call_id?: string | null;
  tool_name: string;
  selected_actor_key?: string | null;
  output: unknown;
}

interface AgentResultCtx extends BaseCtx {
  agent_slug: string;
  output_text: string;
  structured?: unknown;
  /**
   * Memory-driven draft_outreach: explicit target lead_candidate ids (top N
   * from a prior plan). When present, Penn drafts link to these rather than to
   * lead_candidates created in the current (Penn-only) plan.
   */
  lead_candidate_ids?: string[];
  /**
   * Phase 7 — content-loop metadata. When present, Scribe content is saved as a
   * content_draft tagged with source/subtype/topic/audience/angle so the Signal
   * Feed can surface it as a founder post / post ideas / comment drafts.
   */
  content_loop?: {
    source?: string;
    subtype?: string;
    topic?: string;
    audience?: string | null;
    angle?: string;
    engagement_queries?: string[];
    competitor_related?: boolean;
    related_signal_ids?: string[];
  };
}

function domainFromUrl(u?: string | null): string | null {
  if (!u || typeof u !== "string") return null;
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function tierToPriority(tier?: string | null): string | null {
  if (!tier) return null;
  const t = String(tier).toLowerCase();
  if (t.includes("hot")) return "hot";
  if (t.includes("warm")) return "warm";
  if (t.includes("maybe")) return "maybe";
  if (t.includes("ignore") || t.includes("cold")) return "ignore";
  return null;
}

// ---------- Public entry: tool-call outputs ----------

export async function writeMemoryFromToolCall(ctx: ToolCallCtx): Promise<void> {
  try {
    if (!ctx.conversation_id && ctx.plan_id) {
      ctx.conversation_id = await resolveConversationId(ctx.admin, ctx.plan_id);
    }
    const tool = ctx.tool_name;
    console.log("[memoryWriter] tool_call", {
      tool,
      plan_id: ctx.plan_id,
      tool_call_id: ctx.tool_call_id,
      conv: ctx.conversation_id,
    });
    if (tool === "source_with_apify") {
      const out = ctx.output as any;
      if (isLinkedinCommentersOutput(out, ctx.selected_actor_key)) {
        await writeLinkedinCommenters(ctx, out);
      } else if (isLinkedinEngagementOutput(out, ctx.selected_actor_key)) {
        await writeLinkedinEngagement(ctx, out);
      } else if (isPeopleOutput(out)) {
        await writeApifyPeople(ctx, out);
      } else {
        await writeApifyJobs(ctx, out);
      }
      return;
    }
    if (tool === "scrape_url") {
      await writeFirecrawl(ctx, ctx.output);
      return;
    }
  } catch (e) {
    console.warn("[memoryWriter] tool_call write failed:", e);
  }
}

// ---------- Public entry: agent outputs ----------

export async function writeMemoryFromAgentResult(ctx: AgentResultCtx): Promise<void> {
  try {
    if (!ctx.conversation_id && ctx.plan_id) {
      ctx.conversation_id = await resolveConversationId(ctx.admin, ctx.plan_id);
    }
    const slug = (ctx.agent_slug || "").toLowerCase();
    if (slug === "aria") {
      await writeAriaRankings(ctx);
      return;
    }
    if (slug === "penn") {
      await writePennDrafts(ctx);
      return;
    }
    if (slug === "scribe") {
      await writeScribeContent(ctx);
      return;
    }
  } catch (e) {
    console.warn("[memoryWriter] agent write failed:", e);
  }
}

async function resolveConversationId(admin: SupabaseClient, planId: string): Promise<string | null> {
  try {
    const { data } = await admin
      .from("messages")
      .select("conversation_id")
      .filter("metadata->>plan_id", "eq", planId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data as any)?.conversation_id as string) ?? null;
  } catch {
    return null;
  }
}

// ---------- Apify jobs (companies hiring) ----------

async function writeApifyJobs(ctx: ToolCallCtx, output: any): Promise<void> {
  const items = normalizeApifyItems(output);
  console.log("[memoryWriter] apify_jobs items:", items.length);
  if (items.length === 0) return;
  const seenAccountIds = new Set<string>();

  // Resolve the V2 flag ONCE per call (see writeApifyPeople for the OFF guarantee).
  const v2Enabled = isSignalsV2Enabled();

  for (const it of items) {
    // Company domain: prefer the safely-parsed domain from the normalizer, then
    // parse the company website. Job-listing URLs are never company domains.
    let domain = (it.domain ?? domainFromUrl(it.website ?? it.companyUrl)) || null;
    if (domain && /linkedin\.com$|indeed\.com$|wellfound\.com$|ziprecruiter\.com$|glassdoor\.com$/i.test(domain)) {
      domain = null; // not a real company domain
    }
    const name = (it.company ?? "").trim();
    if (!name && !domain) continue;

    const accountRow: any = {
      workspace_id: ctx.workspace_id,
      name: name || domain || "Unknown",
      domain: domain ? domain.toLowerCase() : null,
      website_url: it.website ?? it.companyUrl ?? null,
      location: it.location ?? null,
      source: it.source ?? "apify_jobs",
      raw: it.raw ?? {},
    };
    const onConflict = "workspace_id,name";
    let accountId: string | null = null;
    const { data: acc, error: accErr } = await ctx.admin
      .from("accounts")
      .upsert(accountRow, { onConflict })
      .select("id")
      .maybeSingle();
    if (accErr) {
      console.warn("[memoryWriter] accounts upsert err:", accErr.message, { onConflict, name, domain });
      const { data: existing } = await ctx.admin
        .from("accounts")
        .select("id")
        .eq("workspace_id", ctx.workspace_id)
        .eq(domain ? "domain" : "name", domain ?? name)
        .maybeSingle();
      accountId = existing?.id ?? null;
    } else {
      accountId = acc?.id ?? null;
    }
    if (!accountId) {
      console.warn("[memoryWriter] no accountId for item", { name, domain });
      continue;
    }
    if (seenAccountIds.has(accountId)) continue;
    seenAccountIds.add(accountId);

    // Insert signal
    const { data: sig } = await ctx.admin
      .from("signals")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        task_id: ctx.task_id ?? null,
        tool_call_id: ctx.tool_call_id ?? null,
        source: "apify_jobs",
        signal_type: "hiring_signal",
        signal_label: it.title ?? null,
        title: `${it.company ?? domain ?? "Unknown"} hiring ${it.title ?? "a role"}`,
        description: it.description ?? null,
        source_url: it.url ?? null,
        raw: it.raw ?? {},
      })
      .select("id")
      .maybeSingle();

    // Provenance guard — an invalid provider provenance BLOCKS this insert when
    // enforcement is on (Find Leads sourcing). No verified=false ride-along.
    const jobDecision = leadPersistenceDecision(ctx, {
      company: name, source_url: it.url ?? null, url: it.url ?? null, job_url: it.url ?? null,
      website: it.website ?? it.companyUrl ?? null, domain: domain ?? null,
      company_linkedin_url: it.companyLinkedinUrl ?? null, evidence_url: it.url ?? null,
      provider_item_id: it.providerJobId ?? it.providerRefId ?? null,
    }, "account");
    if (jobDecision.blocked) continue;

    // Insert lead_candidate. Persist the preserved source data at raw TOP LEVEL
    // (clean names) so Workbench/CSV can read it — not buried under { hiring }.
    // Real source proof only; never a fake proof_incomplete URL.
    await ctx.admin
      .from("lead_candidates")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        account_id: accountId,
        signal_id: sig?.id ?? null,
        lead_type: "company",
        status: "new",
        reason: `${it.title ?? "Role"} @ ${it.company ?? domain ?? ""}`.trim(),
        raw: {
          ...jobDecision.patch,
          hiring: it.raw ?? {},
          company_website: it.website ?? null,
          website: it.website ?? null,
          domain: domain ?? it.domain ?? null,
          company_linkedin_url: it.companyLinkedinUrl ?? null,
          company_logo: it.companyLogo ?? null,
          company_slogan: it.companySlogan ?? null,
          company_address: it.companyAddress ?? null,
          job_url: it.url ?? null,
          apply_url: it.applyUrl ?? null,
          source_url: it.url ?? null,
          job_title: it.title ?? null,
          exact_hiring_signal: it.title ? `${it.title}${it.company ? ` @ ${it.company}` : ""}` : null,
          company_description: it.companyDescription ?? null,
          job_description: it.jobDescription ?? null,
          industries: it.industries ?? [],
          employee_count: it.employeeCount ?? null,
          employment_type: it.employmentType ?? null,
          seniority_level: it.seniorityLevel ?? null,
          job_function: it.jobFunction ?? null,
          salary: it.salary ?? null,
          posted_at: it.postedAt ?? null,
          applicants_count: it.applicantsCount ?? null,
          poster_contact_hint: it.posterContactHint ?? null,
          provider_job_id: it.providerJobId ?? null,
          provider_ref_id: it.providerRefId ?? null,
          provider_tracking_id: it.providerTrackingId ?? null,
          input_url: it.inputUrl ?? null,
          source_proof: it.sourceProof ?? [],
          source_quality: it.sourceQuality ?? (it.url || it.website ? "partial" : "incomplete"),
          // Promote match-tier + funding contract to TOP-LEVEL raw (run-agent's
          // tierAndCount labels them onto it.raw) so Workbench/CSV read them —
          // otherwise they'd stay nested under raw.hiring.* and never surface.
          ...((it.raw && typeof it.raw === "object") ? (() => {
            const r = it.raw as Record<string, unknown>;
            const patch: Record<string, unknown> = {};
            if (r.match_tier != null) patch.match_tier = r.match_tier;
            if (r.funding_required != null) patch.funding_required = r.funding_required;
            if (r.funding_proof_found != null) patch.funding_proof_found = r.funding_proof_found;
            if (r.funding_source_url != null) patch.funding_source_url = r.funding_source_url;
            if (Array.isArray(r.missing_evidence) && r.missing_evidence.length) patch.missing_evidence = r.missing_evidence;
            return patch;
          })() : {}),
          // Decision-maker discovery from JOB-POST evidence only (poster hint +
          // description clues). No live people search here — that runs later,
          // per company, on the "Find decision-makers" action. Never fabricated.
          ...(() => {
            const dm = buildDecisionMakers({
              poster: it.posterContactHint ?? null,
              jobTitle: it.title ?? null,
              descriptionText: it.jobDescription ?? null,
            });
            return {
              decision_makers: dm.decision_makers,
              decision_maker_status: dm.needs_manual_review ? "needs_manual_review" : "poster_hint",
              buyer_clues: dm.buyer_clues,
            };
          })(),
        },
      });

    // Signals V2 (Phase 2) — flagged, best-effort dual-write of the canonical hiring
    // event into signal_events (+ signal_event_evidence). The canonical, VALIDATED
    // SignalEvent is built by the shared jobsSignalAdapter: only GTM hiring roles
    // (sales/revops/growth) with a source-backed posting date and a grounded company
    // pass — everything else is rejected there and never persisted. Runs only after
    // the authoritative legacy account + signals + lead_candidate writes above; never
    // affects legacy state. `accountId` is a real grounded entity; `sig.id` is a real
    // legacy hiring row (created above, not fabricated for this).
    if (v2Enabled) {
      try {
        const company_ref = normalizeJobCompanyRef(it.companyLinkedinUrl, domain, name);
        if (company_ref) {
          const normalizedJob: NormalizedJobLike = {
            company: it.company ?? null,
            jobTitle: it.title ?? null,
            linkedinUrl: it.companyLinkedinUrl ?? null,
            website: it.website ?? null,
            domain: domain ?? null,
            jobUrl: it.url ?? null,
            postedAt: it.postedAt ?? null,
            seniorityLevel: it.seniorityLevel ?? null,
            jobFunction: it.jobFunction ?? null,
            raw: (it.raw && typeof it.raw === "object") ? it.raw : {},
          };
          const { signal, rejected } = jobRecordToSignalEvent({
            job: normalizedJob,
            workspace_id: ctx.workspace_id,
            company_ref,
            observedAt: new Date().toISOString(),
            provider: ctx.provider ?? "apify",
            actorKey: ctx.actor_key ?? ctx.selected_actor_key ?? undefined,
            actorId: ctx.actor_id ?? undefined,
          });
          if (!rejected && signal) {
            await dualWriteHiringSignalV2({ admin: ctx.admin, enabled: v2Enabled }, signal, {
              workspace_id: ctx.workspace_id,
              account_id: accountId,
              legacy_signal_id: sig?.id ?? null,
              source_record_id: it.providerJobId ?? it.providerRefId ?? null,
            });
          }
        }
      } catch (e) {
        console.warn("[memoryWriter] signals-v2 hiring dual-write skipped:", (e as Error)?.message);
      }
    }
  }
}

/** Canonical company key for a job's SignalEvent: prefer the company LinkedIn URL,
 * then the real company domain, then the lowercased name. Returns "" when nothing
 * usable is present (the dual-write is then skipped, never fabricated). */
function normalizeJobCompanyRef(
  companyLinkedinUrl: string | null | undefined,
  domain: string | null | undefined,
  name: string | null | undefined,
): string {
  const li = typeof companyLinkedinUrl === "string" ? companyLinkedinUrl.trim() : "";
  if (li) {
    try {
      const u = new URL(li);
      if (u.protocol === "http:" || u.protocol === "https:") {
        return `${u.host.replace(/^www\./i, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
      }
    } catch { /* fall through */ }
  }
  if (domain && domain.trim()) return domain.trim().toLowerCase();
  if (name && name.trim()) return name.trim().toLowerCase();
  return "";
}

// ---------- Apify people profiles ----------

async function writeApifyPeople(ctx: ToolCallCtx, output: any): Promise<void> {
  const people = normalizeApifyPeople(output);
  if (people.length === 0) return;

  // Resolve the V2 flag ONCE per call. When OFF this stays false and no V2 code
  // path below runs — zero extra DB work, legacy behaviour byte-for-byte identical.
  const v2Enabled = isSignalsV2Enabled();

  for (const p of people) {
    const linkedin = p.profile_url ?? null;
    const fullName = (p.full_name ?? "").trim();
    if (!linkedin && !fullName) continue;

    // Do NOT write email/phone unless present in source data.
    const rawEmail = (p.raw && typeof p.raw === "object" && (p.raw as any).email) || null;
    const rawPhone = (p.raw && typeof p.raw === "object" && (p.raw as any).phone) || null;

    const contactRow = {
      workspace_id: ctx.workspace_id,
      full_name: fullName || null,
      title: p.title ?? null,
      headline: p.headline ?? null,
      company: p.company ?? null,
      location: p.location ?? null,
      linkedin_url: linkedin,
      email: typeof rawEmail === "string" && rawEmail.includes("@") ? rawEmail : null,
      phone: typeof rawPhone === "string" ? rawPhone : null,
      source: p.source ?? "apify_people",
      raw: p.raw ?? {},
    };

    let contactId: string | null = null;
    if (linkedin) {
      const { data: c } = await ctx.admin
        .from("contacts")
        .upsert(contactRow, { onConflict: "workspace_id,linkedin_url" })
        .select("id")
        .maybeSingle();
      contactId = c?.id ?? null;
    } else {
      const { data: c } = await ctx.admin.from("contacts").insert(contactRow).select("id").maybeSingle();
      contactId = c?.id ?? null;
    }
    if (!contactId) continue;

    const { data: sig } = await ctx.admin
      .from("signals")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        task_id: ctx.task_id ?? null,
        tool_call_id: ctx.tool_call_id ?? null,
        source: "apify_people",
        signal_type: "people_profile",
        signal_label: p.headline ?? p.title ?? null,
        title: fullName || (linkedin ?? "Profile"),
        description: p.summary ?? null,
        source_url: linkedin,
        raw: p.raw ?? {},
      })
      .select("id")
      .maybeSingle();

    const peopleDecision = leadPersistenceDecision(ctx, {
      person: fullName || null, name: fullName || null, company: p.company ?? null,
      source_url: linkedin, url: linkedin, person_linkedin_url: linkedin, profile_url: linkedin,
      evidence_url: linkedin,
    }, "person");
    if (peopleDecision.blocked) continue;

    await ctx.admin
      .from("lead_candidates")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        contact_id: contactId,
        signal_id: sig?.id ?? null,
        lead_type: "person",
        status: "new",
        reason: [p.title, p.company].filter(Boolean).join(" @ ") || null,
        // artifact_type is preserved in raw (no dedicated column / no migration).
        raw: { ...peopleDecision.patch, artifact_type: ctx.artifact_type ?? "person_candidate", profile: p.raw ?? {} },
      });

    // Signals V2 (Phase 2) — flagged, best-effort dual-write of this ACCEPTED
    // identity into lead_evidence. Reaches here ONLY after the authoritative legacy
    // contact + signals + lead_candidate writes above succeeded and the provenance
    // gate passed (blocked people already `continue`d). Never affects legacy state.
    if (v2Enabled) {
      try {
        const rid = (p.raw && typeof p.raw === "object")
          ? ((p.raw as any).id ?? (p.raw as any).public_identifier ?? (p.raw as any).publicIdentifier ?? null)
          : null;
        await dualWritePeopleProfileV2({ admin: ctx.admin, enabled: v2Enabled }, {
          workspace_id: ctx.workspace_id,
          contact_id: contactId,
          legacy_signal_id: sig?.id ?? null,
          provider: ctx.provider ?? "apify",
          actor_key: ctx.actor_key ?? ctx.selected_actor_key ?? null,
          actor_id: ctx.actor_id ?? null,
          profile_url: linkedin,
          source_record_id: typeof rid === "string" ? rid : null,
          observed_at: new Date().toISOString(),
          full_name: fullName || null,
          title: p.title ?? null,
          company: p.company ?? null,
          location: p.location ?? null,
          headline: p.headline ?? null,
        });
      } catch (e) {
        console.warn("[memoryWriter] signals-v2 people dual-write skipped:", (e as Error)?.message);
      }
    }
  }
}

// ---------- Phase 3: LinkedIn engagement ----------

function isLinkedinEngagementOutput(output: any, selectedActorKey?: string | null): boolean {
  if (selectedActorKey === "apify_linkedin_posts" || selectedActorKey === "apify_linkedin_profile_posts") return true;
  if (!output) return false;
  if (output.normalized_source_type === "linkedin_engagement") return true;
  if (output.actor_output_type === "linkedin_posts" || output.actor_output_type === "linkedin_profile_posts") return true;
  const list = Array.isArray(output.items) ? output.items : [];
  return list.length > 0 && list[0]?.type === "linkedin_engagement";
}

async function writeLinkedinEngagement(ctx: ToolCallCtx, output: any): Promise<void> {
  const items: any[] = Array.isArray(output?.items) ? output.items : [];
  if (items.length === 0) return;
  // Phase 4.2 — competitor-discovery context (Hawk's inferred competitors).
  const discovery = output?.discovery ?? null;

  for (const it of items) {
    const postUrl = it.post_url ?? null;
    const profileUrl = it.post_author_profile_url ?? it.commenter_profile_url ?? null;
    const fullName = it.post_author_name ?? it.commenter_name ?? null;
    const topic = it.topic ?? null;
    // Skip empty items (nothing to anchor on).
    if (!postUrl && !profileUrl && !it.post_text) continue;

    // Phase 4 + 4.2 — this is a competitor signal if EITHER the post content
    // mentions a seed competitor, OR it came from a competitor-discovery search
    // (Hawk's inferred competitors threaded via output.discovery). Otherwise it
    // stays a generic linkedin_engagement signal.
    const matchText = `${it.post_text ?? ""} ${topic ?? ""} ${fullName ?? ""} ${it.post_author_company ?? ""}`;
    const comps = matchCompetitors(matchText);
    const seed = comps[0] ?? null;
    const inferredName = Array.isArray(discovery?.inferred_competitors) ? (discovery.inferred_competitors[0] as string | undefined) : undefined;
    const isCompetitor = !!seed || !!discovery;
    const signalType = isCompetitor ? "competitor_engagement" : "linkedin_engagement";
    const competitorName = seed?.name ?? inferredName ?? null;
    const competitorRaw = isCompetitor
      ? {
          competitor_key: seed?.key ?? null,
          competitor_name: competitorName,
          competitor_category: seed?.category ?? discovery?.competitor_category ?? null,
          competitor_confidence: seed ? 0.7 : 0.5,
          competitor_source: seed ? "post_content" : "ai_inferred",
          matched_terms: seed?.matched_terms ?? [],
          conversation_type: classifyConversationType(matchText),
          matched_query: discovery?.matched_query ?? it.topic ?? null,
          original_business_description: discovery?.original_business_description ?? null,
          original_website_url: discovery?.original_website_url ?? null,
          hypothesis_reason: discovery?.hypothesis_reason ?? (seed ? `seed competitor (${seed.matched_terms.join(", ")})` : null),
          original_signal_type: "linkedin_engagement",
        }
      : null;
    const reason = it.signal_reason
      ?? (isCompetitor
        ? (seed
            ? `Engaging with content related to competitor ${seed.name} (${seed.matched_terms.join(", ")})`
            : `Engaging with content related to inferred competitor${competitorName ? ` ${competitorName}` : "/category"}`)
        : null);

    // Optional account from author company (best-effort, deduped by name).
    let accountId: string | null = null;
    const company = (it.post_author_company ?? "").trim();
    if (company) {
      const accountRow: Record<string, unknown> = {
        workspace_id: ctx.workspace_id,
        name: company,
        source: "linkedin_engagement",
        raw: { from: "linkedin_engagement" },
      };
      const { data: acc } = await ctx.admin
        .from("accounts")
        .upsert(accountRow, { onConflict: "workspace_id,name" })
        .select("id")
        .maybeSingle();
      accountId = acc?.id ?? null;
    }

    // Signal — always written for an engagement item.
    const { data: sig } = await ctx.admin
      .from("signals")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        task_id: ctx.task_id ?? null,
        tool_call_id: ctx.tool_call_id ?? null,
        source: ctx.selected_actor_key ?? "apify_linkedin_posts",
        signal_type: signalType,
        signal_label: (isCompetitor ? (competitorName ?? (competitorRaw?.competitor_category ?? null)) : topic),
        title: [fullName, isCompetitor ? (competitorName ?? "competitor") : topic].filter(Boolean).join(" — ") || (postUrl ?? "LinkedIn engagement"),
        description: reason ?? (it.post_text ? String(it.post_text).slice(0, 500) : null),
        source_url: postUrl,
        raw: isCompetitor
          ? {
              ...(typeof (it.raw ?? it) === "object" ? (it.raw ?? it) : { value: it.raw ?? it }),
              ...competitorRaw,
            }
          : (it.raw ?? it),
      })
      .select("id")
      .maybeSingle();

    // Contact — only if we have a profile URL (never invent email/phone).
    let contactId: string | null = null;
    if (profileUrl || fullName) {
      const contactRow = {
        workspace_id: ctx.workspace_id,
        account_id: accountId,
        full_name: fullName,
        title: it.post_author_title ?? null,
        headline: it.post_author_title ?? null,
        company: company || null,
        linkedin_url: profileUrl,
        email: null,
        phone: null,
        source: "linkedin_engagement",
        raw: it.raw ?? it,
      };
      if (profileUrl) {
        const { data: c } = await ctx.admin
          .from("contacts")
          .upsert(contactRow, { onConflict: "workspace_id,linkedin_url" })
          .select("id")
          .maybeSingle();
        contactId = c?.id ?? null;
      } else {
        const { data: c } = await ctx.admin.from("contacts").insert(contactRow).select("id").maybeSingle();
        contactId = c?.id ?? null;
      }
    }

    // Lead candidate (person engaging on a relevant post).
    const engDecision = leadPersistenceDecision(ctx, {
      person: fullName || null, name: fullName || null, company: company || null,
      source_url: postUrl ?? profileUrl, url: postUrl ?? profileUrl,
      person_linkedin_url: profileUrl, profile_url: profileUrl, evidence_url: postUrl ?? profileUrl,
    }, "person");
    if (engDecision.blocked) continue;

    await ctx.admin.from("lead_candidates").insert({
      workspace_id: ctx.workspace_id,
      conversation_id: ctx.conversation_id ?? null,
      plan_id: ctx.plan_id ?? null,
      account_id: accountId,
      contact_id: contactId,
      signal_id: sig?.id ?? null,
      lead_type: "person",
      status: "new",
      reason: reason
        ?? (isCompetitor ? `Competitor signal: ${competitorName ?? "category"}` : (topic ? `Engaging with content about ${topic}` : null)),
      raw: isCompetitor
        ? { ...engDecision.patch, competitor_engagement: it.raw ?? it, competitor_key: seed?.key ?? null, competitor_name: competitorName, competitor_source: competitorRaw?.competitor_source }
        : { ...engDecision.patch, linkedin_engagement: it.raw ?? it },
    });
  }
}

// ---------- Phase 4.2: LinkedIn post commenters ----------

function isLinkedinCommentersOutput(output: any, selectedActorKey?: string | null): boolean {
  if (selectedActorKey === "apify_linkedin_post_comments") return true;
  if (!output) return false;
  if (output.normalized_source_type === "linkedin_comments") return true;
  if (output.actor_output_type === "linkedin_post_commenters") return true;
  const list = Array.isArray(output.items) ? output.items : [];
  return list.length > 0 && list[0]?.type === "linkedin_commenter";
}

async function writeLinkedinCommenters(ctx: ToolCallCtx, output: any): Promise<void> {
  const items: any[] = Array.isArray(output?.items) ? output.items : [];
  if (items.length === 0) return;
  for (const it of items) {
    const profileUrl = it.commenter_profile_url ?? it.profile_url ?? null;
    const fullName = it.commenter_name ?? it.name ?? null;
    const postUrl = it.post_url ?? null;
    if (!profileUrl && !fullName) continue;

    // Signal: this person engaged on a (competitor/category) post.
    const { data: sig } = await ctx.admin
      .from("signals")
      .insert({
        workspace_id: ctx.workspace_id,
        conversation_id: ctx.conversation_id ?? null,
        plan_id: ctx.plan_id ?? null,
        task_id: ctx.task_id ?? null,
        tool_call_id: ctx.tool_call_id ?? null,
        source: "apify_linkedin_post_comments",
        signal_type: "competitor_engagement",
        signal_label: "post commenter",
        title: `${fullName ?? "Commenter"} commented on a post`,
        description: it.comment_text ? String(it.comment_text).slice(0, 500) : "Commented on a competitor/category post",
        source_url: postUrl,
        raw: { ...(typeof (it.raw ?? it) === "object" ? (it.raw ?? it) : {}), conversation_type: "audience_engagement", competitor_source: "post_comments", original_signal_type: "linkedin_engagement" },
      })
      .select("id")
      .maybeSingle();

    let contactId: string | null = null;
    if (profileUrl || fullName) {
      const contactRow = {
        workspace_id: ctx.workspace_id,
        full_name: fullName,
        headline: it.commenter_headline ?? it.headline ?? null,
        title: it.commenter_title ?? null,
        linkedin_url: profileUrl,
        email: null,   // never invent
        phone: null,   // never invent
        source: "linkedin_post_comments",
        raw: it.raw ?? it,
      };
      if (profileUrl) {
        const { data: c } = await ctx.admin.from("contacts").upsert(contactRow, { onConflict: "workspace_id,linkedin_url" }).select("id").maybeSingle();
        contactId = c?.id ?? null;
      } else {
        const { data: c } = await ctx.admin.from("contacts").insert(contactRow).select("id").maybeSingle();
        contactId = c?.id ?? null;
      }
    }

    const commenterDecision = leadPersistenceDecision(ctx, {
      person: fullName || null, name: fullName || null,
      source_url: postUrl ?? profileUrl, url: postUrl ?? profileUrl,
      person_linkedin_url: profileUrl, profile_url: profileUrl, evidence_url: postUrl ?? profileUrl,
    }, "person");
    if (commenterDecision.blocked) continue;

    await ctx.admin.from("lead_candidates").insert({
      workspace_id: ctx.workspace_id,
      conversation_id: ctx.conversation_id ?? null,
      plan_id: ctx.plan_id ?? null,
      contact_id: contactId,
      signal_id: sig?.id ?? null,
      lead_type: "person",
      status: "new",
      reason: "Commented on competitor/category post",
      raw: { ...commenterDecision.patch, linkedin_post_commenter: it.raw ?? it },
    });
  }
}

// ---------- Firecrawl scrape ----------

async function writeFirecrawl(ctx: ToolCallCtx, output: unknown): Promise<void> {
  const f = normalizeFirecrawl(output);
  if (!f.url && !f.markdown && !f.summary) return;

  // Attach to most recent lead_candidate / account in this plan if any.
  let leadCandidateId: string | null = null;
  let accountId: string | null = null;
  if (ctx.plan_id) {
    const { data: lc } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id")
      .eq("workspace_id", ctx.workspace_id)
      .eq("plan_id", ctx.plan_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    leadCandidateId = lc?.id ?? null;
    accountId = lc?.account_id ?? null;
  }

  // Phase 2 patch: URL analysis with no prior lead context should still create
  // lightweight account memory (e.g. "Analyze https://stripe.com/jobs" → Stripe).
  if (!accountId && f.url) {
    const domain = domainFromUrl(f.url);
    if (domain) {
      // Title-case the bare domain label (e.g. "stripe.com" → "Stripe").
      const label = domain.split(".")[0];
      const name = label ? label.charAt(0).toUpperCase() + label.slice(1) : domain;
      const accountRow: Record<string, unknown> = {
        workspace_id: ctx.workspace_id,
        name,
        domain,
        website_url: f.url,
        source: "firecrawl/url_analysis",
        raw: { source_url: f.url, title: f.title ?? null, via: "url_analysis" },
      };
      // Conflict target = (workspace_id, name): that is the unique constraint
      // that survives the memory migrations (the domain index is dropped).
      const { data: acc, error: accErr } = await ctx.admin
        .from("accounts")
        .upsert(accountRow, { onConflict: "workspace_id,name" })
        .select("id")
        .maybeSingle();
      if (accErr) {
        console.warn("[memoryWriter] url_analysis account upsert err:", accErr.message, { domain });
        const { data: existing } = await ctx.admin
          .from("accounts")
          .select("id")
          .eq("workspace_id", ctx.workspace_id)
          .eq("domain", domain)
          .maybeSingle();
        if (existing?.id) {
          accountId = existing.id;
        } else {
          // No row yet and the upsert couldn't infer the conflict target —
          // insert directly so url_analysis always yields account memory.
          const { data: inserted } = await ctx.admin
            .from("accounts")
            .insert(accountRow)
            .select("id")
            .maybeSingle();
          accountId = inserted?.id ?? null;
        }
      } else {
        accountId = acc?.id ?? null;
      }
    }
  }

  await ctx.admin.from("lead_enrichments").insert({
    workspace_id: ctx.workspace_id,
    lead_candidate_id: leadCandidateId,
    account_id: accountId,
    source_url: f.url ?? null,
    summary: f.summary ?? (f.markdown ? f.markdown.slice(0, 2000) : null),
    raw: { firecrawl: output },
  });

  // Also save a generic snapshot for url_analysis follow-ups.
  await ctx.admin.from("saved_outputs").insert({
    workspace_id: ctx.workspace_id,
    conversation_id: ctx.conversation_id ?? null,
    plan_id: ctx.plan_id ?? null,
    task_id: ctx.task_id ?? null,
    type: "workflow_summary",
    title: f.title ?? f.url ?? "Scrape",
    body: f.summary ?? (f.markdown ? f.markdown.slice(0, 8000) : null),
    raw: { firecrawl: output },
  });
}

// ---------- Aria rankings ----------

async function writeAriaRankings(ctx: AgentResultCtx): Promise<void> {
  const structured = ctx.structured ?? safeParseRankings(ctx.output_text);
  const rankings = normalizeAriaRankings(structured);
  if (rankings.length === 0) return;

  // Match by company name or contact name within current plan/conversation.
  const filters: any = { workspace_id: ctx.workspace_id };
  if (ctx.plan_id) filters.plan_id = ctx.plan_id;
  const { data: leads } = await ctx.admin
    .from("lead_candidates")
    .select("id, account_id, contact_id, accounts!inner(name), contacts(full_name)")
    .match(filters)
    .limit(500);

  if (!leads || leads.length === 0) return;

  for (const r of rankings) {
    const target = (r.name ?? r.company ?? "").toLowerCase().trim();
    if (!target) continue;
    const match = leads.find((l: any) => {
      const an = (l.accounts?.name ?? "").toLowerCase();
      const cn = (l.contacts?.full_name ?? "").toLowerCase();
      return an === target || cn === target || an.includes(target) || cn.includes(target);
    });
    if (!match) continue;
    await ctx.admin
      .from("lead_candidates")
      .update({
        fit_score: typeof r.score === "number" ? r.score : null,
        priority: tierToPriority(r.tier),
        reason: r.fit ?? null,
        next_action: r.next ?? null,
      })
      .eq("id", match.id);
  }
}

function safeParseRankings(text: string): unknown {
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (m) return JSON.parse(m[1]);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- Penn outreach drafts ----------

async function writePennDrafts(ctx: AgentResultCtx): Promise<void> {
  // Global safety: never write an outreach draft in source_and_qualify_only.
  if (isSourceAndQualifyOnly(ctx.execution_mode)) {
    console.warn("[memoryWriter] draft persistence blocked: source_and_qualify_only mode");
    return;
  }
  const drafts = normalizePennDrafts(ctx.structured ?? safeParseRankings(ctx.output_text) ?? { body: ctx.output_text });
  if (drafts.length === 0) return;

  // Try to attach to most recent approval for this task (if any).
  let approvalId: string | null = null;
  if (ctx.task_id) {
    const { data: appr } = await ctx.admin
      .from("approvals")
      .select("id")
      .eq("task_id", ctx.task_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    approvalId = appr?.id ?? null;
  }

  // Attach each draft to a lead. Resolution priority:
  //   1) explicit lead_candidate_ids (memory-driven draft_outreach follow-up) —
  //      those leads live in a PRIOR plan, so plan_id lookup wouldn't find them;
  //   2) lead_candidates created in this plan (sourcing → outreach in one plan);
  //   3) most recent leads in this conversation (memory follow-up, no ids given).
  type LeadRef = { id: string; account_id: string | null; contact_id: string | null; raw?: Record<string, unknown> | null };
  let leadIds: LeadRef[] = [];
  if (Array.isArray(ctx.lead_candidate_ids) && ctx.lead_candidate_ids.length > 0) {
    const wanted = ctx.lead_candidate_ids.slice(0, drafts.length);
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id, raw")
      .eq("workspace_id", ctx.workspace_id)
      .in("id", wanted);
    const byId = new Map((ls ?? []).map((l: any) => [l.id, l as LeadRef]));
    leadIds = wanted.map((id) => byId.get(id)).filter(Boolean) as LeadRef[];
  }
  if (leadIds.length === 0 && ctx.plan_id) {
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id, raw")
      .eq("workspace_id", ctx.workspace_id)
      .eq("plan_id", ctx.plan_id)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .limit(drafts.length);
    leadIds = (ls ?? []) as LeadRef[];
  }
  if (leadIds.length === 0 && ctx.conversation_id) {
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id, raw")
      .eq("workspace_id", ctx.workspace_id)
      .eq("conversation_id", ctx.conversation_id)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .limit(drafts.length);
    leadIds = (ls ?? []) as LeadRef[];
  }

  let blocked = 0;
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d.body || !d.body.trim()) continue;
    const link = leadIds[i] ?? null;

    // Global draft gate: a draft may be persisted ONLY for a real persisted lead
    // that is contact-ready with canonical decision `contact`. This blocks drafts
    // to LLM-fabricated recipients and drafts with 0 qualified leads (the Q1 bug),
    // in every execution mode.
    const raw = (link?.raw ?? {}) as Record<string, unknown>;
    // Provider-backed identity MUST come from the persisted provenance record
    // (verified=true), never from raw-field presence or an LLM boolean. A
    // person-level draft additionally requires provenance.level === "person".
    const prov = (raw.provider_provenance ?? null) as { verified?: boolean; level?: string } | null;
    const provVerified = prov?.verified === true;
    const evidenceUrl = (raw.evidence_url ?? raw.source_url ?? (raw.run_trace as Record<string, unknown> | undefined)?.evidence_type) as unknown;
    const gate = evaluateDraftGate({
      execution_mode: ctx.execution_mode,
      canonical_final_decision: (raw.canonical_final_decision as string) ?? null,
      contact_ready: raw.contact_ready === true,
      provider_company_identity: provVerified,
      provider_or_verified_person_identity: provVerified && prov?.level === "person",
      person_company_association: provVerified && prov?.level === "person" && !!(raw.company || raw.company_name),
      evidence_url_supported: typeof evidenceUrl === "string" && /^https?:\/\//i.test(evidenceUrl),
      hard_disqualifier_hit: (raw.canonical_final_decision as string) === "skip",
      persisted_lead_candidate_id: link?.id ?? null,
    });
    if (!gate.allowed) {
      blocked++;
      continue; // never persist an ungated draft
    }

    await ctx.admin.from("outreach_drafts").insert({
      workspace_id: ctx.workspace_id,
      lead_candidate_id: link!.id,
      account_id: link?.account_id ?? null,
      contact_id: link?.contact_id ?? null,
      approval_id: approvalId,
      channel: d.linkedin ? "linkedin" : "email",
      subject: d.subject ?? null,
      body: d.body,
      personalization_notes: d.personalization ?? null,
      status: "draft",
      raw: d,
    });
  }
  if (blocked > 0) console.warn(`[memoryWriter] draft gate blocked ${blocked}/${drafts.length} draft(s): not contact-ready / no persisted lead`);
}

// ---------- Scribe content/reports ----------

/** Render a parsed JSON content object/array into clean readable text. */
function renderStructuredContent(parsed: unknown): string | null {
  if (parsed == null) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  const parts: string[] = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((x, i) => {
      if (typeof x === "string" && x.trim()) parts.push(`${i + 1}. ${x.trim()}`);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const t = (o.text ?? o.comment ?? o.content ?? o.post ?? o.body) as string | undefined;
        if (typeof t === "string" && t.trim()) parts.push(`${i + 1}. ${t.trim()}`);
      }
    });
    return parts.join("\n\n") || null;
  }
  const o = parsed as Record<string, unknown>;
  const main = (o.post ?? o.content ?? o.body ?? o.text) as string | undefined;
  if (typeof main === "string" && main.trim()) parts.push(main.trim());
  if (Array.isArray(o.post_ideas)) o.post_ideas.forEach((p, i) => { if (typeof p === "string" && p.trim()) parts.push(`Idea ${i + 1}: ${p.trim()}`); });
  if (Array.isArray(o.comments)) o.comments.forEach((c, i) => {
    const t = typeof c === "string" ? c : ((c as Record<string, unknown>)?.comment ?? (c as Record<string, unknown>)?.text);
    if (typeof t === "string" && t.trim()) parts.push(`Comment ${i + 1}: ${t.trim()}`);
  });
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Clean a Scribe output for storage/display: strip markdown ```json fences,
 * parse JSON to readable prose when possible, and derive a clean title. Never
 * stores a raw "```json" fence as the title/body.
 */
export function cleanScribeOutput(raw: string): { body: string; title: string; structured: Record<string, unknown> | null } {
  let text = (raw ?? "").trim();
  let structured: Record<string, unknown> | null = null;
  const fence = text.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  const inner = (fence ? fence[1] : text).trim();
  if (/^[[{]/.test(inner)) {
    try {
      const parsed = JSON.parse(inner);
      if (parsed && typeof parsed === "object") structured = Array.isArray(parsed) ? { items: parsed } : parsed as Record<string, unknown>;
      text = renderStructuredContent(parsed) ?? inner;
    } catch {
      text = inner; // parse failed → at least drop the fences
    }
  } else if (fence) {
    text = inner; // non-JSON fenced text → drop the fences
  }
  text = text.trim();
  const title = (text.split("\n").find((l) => l.trim()) ?? "Content draft").replace(/^#+\s*/, "").replace(/^[`*_>\-\s]+/, "").slice(0, 120) || "Content draft";
  return { body: text, title, structured };
}

async function writeScribeContent(ctx: AgentResultCtx): Promise<void> {
  const text = (ctx.output_text ?? "").trim();
  if (!text) return;
  const cleaned = cleanScribeOutput(text);
  const cl = ctx.content_loop;
  // Content-loop drafts carry source/subtype/topic/audience/angle so the Signal
  // Feed can surface founder posts, post ideas, and comment drafts distinctly.
  const raw: Record<string, unknown> = cl
    ? {
        source: cl.source ?? "content_engagement_loop",
        subtype: cl.subtype ?? "founder_post",
        topic: cl.topic ?? null,
        audience: cl.audience ?? null,
        angle: cl.angle ?? null,
        engagement_queries: Array.isArray(cl.engagement_queries) ? cl.engagement_queries : [],
        competitor_related: !!cl.competitor_related,
        related_signal_ids: Array.isArray(cl.related_signal_ids) ? cl.related_signal_ids : [],
      }
    : {};
  await ctx.admin.from("saved_outputs").insert({
    workspace_id: ctx.workspace_id,
    conversation_id: ctx.conversation_id ?? null,
    plan_id: ctx.plan_id ?? null,
    task_id: ctx.task_id ?? null,
    type: "content_draft",
    title: cleaned.title,
    body: cleaned.body,
    raw: cleaned.structured ? { ...raw, structured: cleaned.structured } : raw,
  });
}
