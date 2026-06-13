// Phase 2: Persistent Signal Memory — writer.
//
// Converts tool/agent outputs into structured GTM memory rows so follow-up
// messages can use them. Writes are fire-and-forget: failures are logged but
// never propagate to the caller, so tool/agent execution is never broken by
// a memory write error.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchCompetitors } from "./competitorRegistry.ts";
import { classifyConversationType } from "./competitorDiscovery.ts";

// ---------- Inlined normalizers (mirrors src/components/chat/workspace/workbench/normalize.ts) ----------

interface ApifyJobItem {
  company?: string; title?: string; location?: string; url?: string;
  companyUrl?: string; description?: string; postedAt?: string; source?: string; raw: any;
}
function normalizeApifyItems(output: any): ApifyJobItem[] {
  if (!output) return [];
  const raw =
    (Array.isArray(output.items) && output.items) ||
    (Array.isArray(output.results) && output.results) ||
    (Array.isArray(output.data) && output.data) ||
    (Array.isArray(output.normalized_items) && output.normalized_items) || [];
  return raw.map((it: any) => ({
    company: it.companyName ?? it.company ?? it.company_name ?? it.organization,
    title: it.title ?? it.jobTitle ?? it.position ?? it.name,
    location: it.location ?? it.jobLocation ?? it.formattedLocation ?? it.city,
    url: it.url ?? it.jobUrl ?? it.link ?? it.applyUrl,
    companyUrl: it.companyUrl ?? it.companyLink ?? it.company_website,
    description: it.description ?? it.snippet ?? it.summary,
    postedAt: it.postedAt ?? it.posted_at ?? it.datePosted,
    source: it.source ?? it.platform,
    raw: it,
  }));
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

  for (const it of items) {
    // Only treat companyUrl as a company domain source; job listing URLs are
    // not company domains.
    let domain = domainFromUrl(it.companyUrl);
    if (domain && /linkedin\.com$|indeed\.com$|wellfound\.com$|ziprecruiter\.com$|glassdoor\.com$/i.test(domain)) {
      domain = null; // not a real company domain
    }
    const name = (it.company ?? "").trim();
    if (!name && !domain) continue;

    const accountRow: any = {
      workspace_id: ctx.workspace_id,
      name: name || domain || "Unknown",
      domain: domain ? domain.toLowerCase() : null,
      website_url: it.companyUrl ?? null,
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

    // Insert lead_candidate
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
        raw: { hiring: it.raw ?? {} },
      });
  }
}

// ---------- Apify people profiles ----------

async function writeApifyPeople(ctx: ToolCallCtx, output: any): Promise<void> {
  const people = normalizeApifyPeople(output);
  if (people.length === 0) return;

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
        raw: { profile: p.raw ?? {} },
      });
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
        ? { competitor_engagement: it.raw ?? it, competitor_key: seed?.key ?? null, competitor_name: competitorName, competitor_source: competitorRaw?.competitor_source }
        : { linkedin_engagement: it.raw ?? it },
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

    await ctx.admin.from("lead_candidates").insert({
      workspace_id: ctx.workspace_id,
      conversation_id: ctx.conversation_id ?? null,
      plan_id: ctx.plan_id ?? null,
      contact_id: contactId,
      signal_id: sig?.id ?? null,
      lead_type: "person",
      status: "new",
      reason: "Commented on competitor/category post",
      raw: { linkedin_post_commenter: it.raw ?? it },
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
  type LeadRef = { id: string; account_id: string | null; contact_id: string | null };
  let leadIds: LeadRef[] = [];
  if (Array.isArray(ctx.lead_candidate_ids) && ctx.lead_candidate_ids.length > 0) {
    const wanted = ctx.lead_candidate_ids.slice(0, drafts.length);
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id")
      .eq("workspace_id", ctx.workspace_id)
      .in("id", wanted);
    const byId = new Map((ls ?? []).map((l: any) => [l.id, l as LeadRef]));
    leadIds = wanted.map((id) => byId.get(id)).filter(Boolean) as LeadRef[];
  }
  if (leadIds.length === 0 && ctx.plan_id) {
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id")
      .eq("workspace_id", ctx.workspace_id)
      .eq("plan_id", ctx.plan_id)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .limit(drafts.length);
    leadIds = (ls ?? []) as LeadRef[];
  }
  if (leadIds.length === 0 && ctx.conversation_id) {
    const { data: ls } = await ctx.admin
      .from("lead_candidates")
      .select("id, account_id, contact_id")
      .eq("workspace_id", ctx.workspace_id)
      .eq("conversation_id", ctx.conversation_id)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .limit(drafts.length);
    leadIds = (ls ?? []) as LeadRef[];
  }

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d.body || !d.body.trim()) continue;
    const link = leadIds[i] ?? null;
    await ctx.admin.from("outreach_drafts").insert({
      workspace_id: ctx.workspace_id,
      lead_candidate_id: link?.id ?? null,
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
}

// ---------- Scribe content/reports ----------

async function writeScribeContent(ctx: AgentResultCtx): Promise<void> {
  const text = (ctx.output_text ?? "").trim();
  if (!text) return;
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
    title: text.split("\n")[0].slice(0, 120),
    body: text,
    raw,
  });
}
