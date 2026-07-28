// orchestrate: plan a multi-agent workflow and kick off the first step.
// Workflow-aware: produces deep plans (sourcing, research, intel, outreach,
// content, screening, brief) with tool + approval metadata, then deterministic
// expansion to guarantee depth. Tool availability is annotated, never faked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { routeQualifiedLead, extractRequestedLeadCount } from "../_shared/qualifiedLeadRouting.ts";
import { planQualifiedLeadBeforePersistence } from "../_shared/intelligence/leads/leadPlanOrchestration.ts";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { isToolConfigured } from "../_shared/toolRegistry.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { buildDraftOutreachPlan } from "../_shared/draftOutreachPlan.ts";
import { buildCompetitorDiscoveryPlan } from "../_shared/competitorDiscovery.ts";
import { extractContentLoopInput, buildContentLoopPlan } from "../_shared/contentEngagementLoop.ts";
import { separateIntent } from "../_shared/leadIntentModel.ts";
import { filterPlanForMode, isSourceAndQualifyOnly } from "../_shared/executionMode.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ---------- Types ----------

type ToolName =
  | "research_web"
  | "scrape_url"
  | "source_with_apify"
  | "summarize_text"
  | "extract_structured"
  | "draft_outreach"
  | "send_email"
  | null;

type Step = {
  step_index: number;
  agent_slug: "scout" | "aria" | "penn" | "hawk" | "scribe";
  agent_name: string;
  task_title: string;
  task_description: string;
  instruction: string; // back-compat for run-agent
  capability?: string;
  tool_needed: ToolName;
  expected_output: string;
  success_criteria: string;
  requires_approval: boolean;
  needs_approval: boolean; // alias
  planner_source: "ai" | "fallback" | "expansion";
  tool_status?: "ready" | "connector_required";
  connector_required?: string;
};

type Intent =
  | "sourcing"
  | "extraction"
  | "intelligence"
  | "outreach"
  | "content"
  | "screening"
  | "brief"
  | "general";

const KNOWN_AGENTS: Record<string, string> = {
  scout: "Scout",
  aria: "Aria",
  penn: "Penn",
  hawk: "Hawk",
  scribe: "Scribe",
};

// Human-readable, tool-aware limitation messages keyed by tool name.
// We emit these directly into connectors_missing so the UI never shows raw
// env names or surfaces Perplexity for plans that don't actually need it.
const TOOL_LIMITATION_MESSAGE: Record<string, string> = {
  source_with_apify: "Apify token missing — hiring-signal sourcing unavailable.",
  scrape_url: "Firecrawl missing — page extraction unavailable.",
  search_web: "Broad web search is not configured. Use Apify for hiring signals or Firecrawl for specific URLs.",
  research_web: "Perplexity not configured (optional fallback).",
  send_email: "Resend missing — outreach can be drafted but not sent.",
};


function normalizeSlug(s: string | undefined | null): Step["agent_slug"] | null {
  if (!s) return null;
  const slug = String(s).trim().toLowerCase();
  return (KNOWN_AGENTS[slug] ? slug : null) as Step["agent_slug"] | null;
}

function detectIntent(t: string): Intent {
  const s = t.toLowerCase();
  if (/brief me|daily brief|today's brief|brief on today/.test(s)) return "brief";
  if (/https?:\/\//.test(s) || /from this (url|website|page|link)/.test(s)) return "extraction";
  if (/(competitor|market|signals?|today|latest|monitor|changed|funding|hiring trend|pricing|launches?)/.test(s))
    return "intelligence";
  if (/(find|source|sourc(?:e|ing)|discover|identify|candidates?|engineers?|developers?|leads?|prospects?|founders?|companies)/.test(s))
    return "sourcing";
  if (/(rank|screen|score|shortlist|evaluate|compare|fit)/.test(s)) return "screening";
  if (/(outreach|email|message|dm|reach out|follow.?up|sequence|\bsend\b)/.test(s)) return "outreach";
  if (/(write|post|linkedin|blog|article|jd|job description|brief|memo|report|summary)/.test(s)) return "content";
  return "general";
}

// ---------- Step factory ----------

function mkStep(
  step_index: number,
  slug: Step["agent_slug"],
  title: string,
  description: string,
  opts: {
    tool_needed?: ToolName;
    expected_output: string;
    success_criteria: string;
    requires_approval?: boolean;
    planner_source?: Step["planner_source"];
  },
): Step {
  const requires_approval = opts.requires_approval === true;
  return {
    step_index,
    agent_slug: slug,
    agent_name: KNOWN_AGENTS[slug],
    task_title: title,
    task_description: description,
    instruction: description,
    tool_needed: opts.tool_needed ?? null,
    expected_output: opts.expected_output,
    success_criteria: opts.success_criteria,
    requires_approval,
    needs_approval: requires_approval,
    planner_source: opts.planner_source ?? "fallback",
  };
}

// ---------- Deterministic fallback plans per intent ----------

function fallbackPlan(instruction: string, intent: Intent): { plan_summary: string; steps: Step[] } {
  switch (intent) {
    case "sourcing":
      return {
        plan_summary: `Source, rank, and prepare outreach for: ${instruction}`,
        steps: [
          mkStep(0, "scout", "Source companies/leads via Apify", `Find companies/leads matching: ${instruction}`, {
            tool_needed: "source_with_apify",
            expected_output: "List of sourced leads (name, company, title, url, location) with Apify run/dataset reference.",
            success_criteria: "Apify actor returns at least a few candidate results, or surfaces a clear actor-not-configured message.",
          }),
          mkStep(1, "aria", "Rank candidates", `Rank and score the sourced candidates against: ${instruction}`, {
            tool_needed: "extract_structured",
            expected_output: "Ranked list with fit score (0-100) and rationale per candidate.",
            success_criteria: "Every candidate has a score and 1-2 sentence rationale.",
          }),
          mkStep(2, "penn", "Draft outreach", `Draft personalized outreach for the strongest candidates from: ${instruction}`, {
            tool_needed: "draft_outreach",
            requires_approval: true,
            expected_output: "Personalized message per top candidate, ready for review.",
            success_criteria: "Each message references the candidate's background; no auto-send.",
          }),
        ],
      };
    case "extraction":
      return {
        plan_summary: `Extract structured data: ${instruction}`,
        steps: [
          mkStep(0, "hawk", "Scrape source", `Scrape and extract from: ${instruction}`, {
            tool_needed: "scrape_url",
            expected_output: "Raw extracted content (markdown) from the target URL.",
            success_criteria: "Page successfully fetched; content non-empty.",
          }),
          mkStep(1, "scribe", "Summarize findings", `Summarize the extracted content into a brief for: ${instruction}`, {
            tool_needed: "summarize_text",
            expected_output: "Concise brief with key signals, bullets, and source citation.",
            success_criteria: "Brief is grounded in scraped content, no fabrication.",
          }),
        ],
      };
    case "intelligence": {
      const sLower = instruction.toLowerCase();
      const hiringShape = /(hiring|jobs?|roles?|companies?|recruit|engineers?|marketers?|developers?|leads?|founders?)/.test(sLower);
      const hawkTool = hiringShape ? "source_with_apify" : "search_web";
      return {
        plan_summary: `Gather intelligence: ${instruction}`,
        steps: [
          mkStep(0, "hawk", hiringShape ? "Source hiring/company signals" : "Research signals", `Investigate: ${instruction}`, {
            tool_needed: hawkTool,
            expected_output: hiringShape
              ? "List of companies/roles with source URLs and metadata from Apify."
              : "Cited list of recent signals (funding, hiring, launches, pricing).",
            success_criteria: hiringShape
              ? "Apify returns results or clearly reports unavailable."
              : "At least 3 cited signals, or a clear unavailable note.",
          }),
          mkStep(1, "scribe", "Brief summary", `Turn findings into a short intel brief for: ${instruction}`, {
            tool_needed: "summarize_text",
            expected_output: "1-page intel brief with bullets and recommended next action.",
            success_criteria: "Brief references only findings above.",
          }),
        ],
      };
    }
    case "outreach": {
      const wantsSend = /\bsend\b|send.*email/.test(instruction.toLowerCase());
      const steps: Step[] = [
        mkStep(0, "penn", "Draft outreach", `Draft personalized outreach: ${instruction}`, {
          tool_needed: "draft_outreach",
          requires_approval: true,
          expected_output: "Personalized draft(s) ready for human review.",
          success_criteria: "Draft references recipient context; no auto-send.",
        }),
      ];
      if (wantsSend) {
        steps.push(
          mkStep(1, "penn", "Send after approval", `Send the approved outreach for: ${instruction}`, {
            tool_needed: "send_email",
            requires_approval: true,
            expected_output: "Delivery confirmation from the email provider.",
            success_criteria: "Email sent only after explicit approval.",
          }),
        );
      }
      return { plan_summary: `Outreach workflow: ${instruction}`, steps };
    }
    case "content":
      return {
        plan_summary: `Draft content: ${instruction}`,
        steps: [
          mkStep(0, "scribe", "Draft content", instruction, {
            tool_needed: "summarize_text",
            expected_output: "Ready-to-publish draft in the requested format.",
            success_criteria: "Matches the requested length and tone.",
          }),
        ],
      };
    case "screening":
      return {
        plan_summary: `Screen and rank: ${instruction}`,
        steps: [
          mkStep(0, "aria", "Evaluate and rank", instruction, {
            tool_needed: "extract_structured",
            expected_output: "Structured ranking with scores and per-criterion rationale.",
            success_criteria: "Every candidate scored against explicit criteria.",
          }),
        ],
      };
    case "brief": {
      const briefSteps: Step[] = [
        mkStep(0, "scribe", "Internal workspace brief", "Summarize today's activity: pending approvals, active plans, recent task results.", {
          tool_needed: "summarize_text",
          expected_output: "Concise daily brief grouped by approvals, active plans, recent results.",
          success_criteria: "Pulled from workspace data only.",
        }),
      ];
      // Only add a live-pulse step if a live-research tool is actually configured.
      const pulseTool = isToolConfigured("search_web").ready
        ? "search_web"
        : isToolConfigured("research_web").ready
        ? "research_web"
        : null;
      if (pulseTool) {
        briefSteps.push(
          mkStep(1, "hawk", "Live market pulse", "Add a short external intel pulse.", {
            tool_needed: pulseTool,
            expected_output: "3-5 bullet external pulse with citations.",
            success_criteria: "Skipped gracefully if the tool reports unavailable.",
          }),
        );
      }
      return { plan_summary: `Daily brief: ${instruction}`, steps: briefSteps };
    }
    default:
      return {
        plan_summary: `Investigate request: ${instruction}`,
        steps: [
          mkStep(0, "scribe", "Respond from workspace context", instruction, {
            tool_needed: "summarize_text",
            expected_output: "Findings relevant to the user's request from available workspace data.",
            success_criteria: "No fabrication; cite workspace data or clearly note when broader research is unavailable.",
          }),
        ],
      };
  }
}


// ---------- Deterministic expansion ----------

function expandPlan(instruction: string, intent: Intent, steps: Step[]): Step[] {
  const t = instruction.toLowerCase();
  const has = (slug: Step["agent_slug"]) => steps.some((s) => s.agent_slug === slug);
  const find = (slug: Step["agent_slug"]) => steps.find((s) => s.agent_slug === slug);

  if (intent === "sourcing") {
    if (!has("scout")) {
      steps.unshift(
        mkStep(0, "scout", "Source companies/leads via Apify", `Find candidates for: ${instruction}`, {
          tool_needed: "source_with_apify",
          expected_output: "Sourced leads with name, company, title, url, location.",
          success_criteria: "Apify returns results or a clear actor-not-configured message.",
          planner_source: "expansion",
        }),
      );
    }
    if (!has("aria")) {
      steps.push(
        mkStep(0, "aria", "Rank candidates", `Rank candidates against: ${instruction}`, {
          tool_needed: "extract_structured",
          expected_output: "Ranked list with fit score and rationale.",
          success_criteria: "Every candidate scored.",
          planner_source: "expansion",
        }),
      );
    }
    if (!has("penn")) {
      steps.push(
        mkStep(0, "penn", "Draft outreach", `Draft outreach to top candidates for: ${instruction}`, {
          tool_needed: "draft_outreach",
          requires_approval: true,
          expected_output: "Personalized drafts for top candidates.",
          success_criteria: "Drafts ready for approval; no auto-send.",
          planner_source: "expansion",
        }),
      );
    }
  }

  if (intent === "extraction") {
    const first = steps[0];
    if (!first || (first.agent_slug !== "hawk" && first.agent_slug !== "scout") || first.tool_needed !== "scrape_url") {
      steps.unshift(
        mkStep(0, "hawk", "Scrape source", `Scrape and extract from: ${instruction}`, {
          tool_needed: "scrape_url",
          expected_output: "Markdown of the target page.",
          success_criteria: "Non-empty extraction.",
          planner_source: "expansion",
        }),
      );
    }
  }

  if (intent === "intelligence") {
    const hiringShape = /(hiring|jobs?|roles?|companies?|recruit|engineers?|marketers?|developers?|leads?|founders?)/.test(t);
    const defaultTool = hiringShape ? "source_with_apify" : "search_web";
    const hawk = find("hawk");
    if (!hawk) {
      steps.unshift(
        mkStep(0, "hawk", hiringShape ? "Source hiring/company signals" : "Research signals", `Investigate: ${instruction}`, {
          tool_needed: defaultTool,
          expected_output: hiringShape
            ? "Companies/roles with source URLs from Apify."
            : "Cited signals from current sources (if broad search is configured).",
          success_criteria: hiringShape
            ? "Apify returns results or reports unavailable."
            : "At least 3 cited signals, or a clear unavailable note.",
          planner_source: "expansion",
        }),
      );
    } else if (!hawk.tool_needed || hawk.tool_needed === "research_web") {
      hawk.tool_needed = defaultTool;
    }
    if (/(brief|report|summary|memo)/.test(t) && !has("scribe")) {
      steps.push(
        mkStep(0, "scribe", "Brief summary", `Summarize intel for: ${instruction}`, {
          tool_needed: "summarize_text",
          expected_output: "Short intel brief with recommended action.",
          success_criteria: "Grounded in findings above.",
          planner_source: "expansion",
        }),
      );
    }
  }


  if (intent === "outreach") {
    if (!has("penn")) {
      steps.unshift(
        mkStep(0, "penn", "Draft outreach", instruction, {
          tool_needed: "draft_outreach",
          requires_approval: true,
          expected_output: "Personalized drafts ready for approval.",
          success_criteria: "No auto-send.",
          planner_source: "expansion",
        }),
      );
    }
    const wantsSend = /\bsend\b/.test(t);
    const hasSend = steps.some((s) => s.tool_needed === "send_email");
    if (wantsSend && !hasSend) {
      steps.push(
        mkStep(0, "penn", "Send after approval", `Send approved outreach for: ${instruction}`, {
          tool_needed: "send_email",
          requires_approval: true,
          expected_output: "Provider delivery confirmation.",
          success_criteria: "Send only after approval.",
          planner_source: "expansion",
        }),
      );
    }
  }

  if (intent === "content") {
    if (!has("scribe")) {
      steps.unshift(
        mkStep(0, "scribe", "Draft content", instruction, {
          tool_needed: "summarize_text",
          expected_output: "Draft in requested format.",
          success_criteria: "Matches requested length and tone.",
          planner_source: "expansion",
        }),
      );
    }
    if (/(current|today|latest|now)/.test(t) && !has("hawk") && !has("scout")) {
      const broadTool = isToolConfigured("search_web").ready ? "search_web" : "search_web";
      steps.unshift(
        mkStep(0, "hawk", "Research facts", `Gather supporting facts for: ${instruction}`, {
          tool_needed: broadTool,
          expected_output: "Cited supporting facts (if broad search is configured).",
          success_criteria: "Facts have sources, or step reports unavailable.",
          planner_source: "expansion",
        }),
      );
    }
  }


  if (intent === "screening" && !has("aria")) {
    steps.unshift(
      mkStep(0, "aria", "Evaluate and rank", instruction, {
        tool_needed: "extract_structured",
        expected_output: "Structured ranking with scores.",
        success_criteria: "Per-criterion rationale included.",
        planner_source: "expansion",
      }),
    );
  }

  if (intent === "brief") {
    if (!has("scribe")) {
      steps.unshift(
        mkStep(0, "scribe", "Internal workspace brief",
          "Summarize today's workspace activity: pending approvals, active plans, recent task results.", {
          tool_needed: "summarize_text",
          expected_output: "Daily brief from workspace data.",
          success_criteria: "Only workspace data used.",
          planner_source: "expansion",
        }),
      );
    }
    const pulseTool = isToolConfigured("search_web").ready
      ? "search_web"
      : isToolConfigured("research_web").ready
      ? "research_web"
      : null;
    if (!has("hawk") && pulseTool) {
      steps.push(
        mkStep(0, "hawk", "Live market pulse", "Add 3-5 bullets of external intel pulse.", {
          tool_needed: pulseTool,
          expected_output: "External pulse with citations.",
          success_criteria: "Skipped gracefully if the tool reports unavailable.",
          planner_source: "expansion",
        }),
      );
    }
  }


  // Force send_email steps to be approval-gated.
  for (const s of steps) {
    if (s.tool_needed === "send_email") {
      s.requires_approval = true;
      s.needs_approval = true;
    }
  }

  // Renumber.
  steps.forEach((s, i) => (s.step_index = i));
  return steps;
}

// ---------- Tool annotation ----------

function annotateTools(steps: Step[]): string[] {
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    if (!s.tool_needed) continue;
    const status = isToolConfigured(s.tool_needed);
    if (status.ready) {
      s.tool_status = "ready";
      continue;
    }
    s.tool_status = "connector_required";
    s.connector_required = status.env;
    const msg = TOOL_LIMITATION_MESSAGE[s.tool_needed]
      ?? `${s.tool_needed} unavailable (${status.env ?? "not configured"}).`;
    if (!seen.has(msg)) {
      seen.add(msg);
      messages.push(msg);
    }
  }
  return messages;
}


// ---------- JSON parsing helpers (kept for AI output) ----------

function stripFences(s: string): string {
  return s.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "missing_service_role_key", message: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, 500);
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    if ((body as { ping?: unknown })?.ping === true) return json({ ok: true });

    const b = body as Record<string, unknown>;
    const workspace_id = (b.workspace_id ?? b.workspaceId) as string | undefined;
    const user_instruction = (b.user_instruction ?? b.userInstruction) as string | undefined;
    const conversation_id = (b.conversation_id ?? b.conversationId ?? null) as string | null;
    const tool_input = (b.tool_input ?? null) as null | {
      intent?: string;
      tool_name?: string | null;
      source_type?: string | null;
      query?: string;
      role_keywords?: string[];
      location?: string | null;
      max_results?: number;
      needs_enrichment?: boolean;
      needs_outreach?: boolean;
      execution_mode?: "fast" | "deep" | "outreach" | "source_and_qualify_only";
      confidence?: number;
    };

    if (!user_instruction || !workspace_id) {
      return json({ error: "missing_parameter", details: "workspace_id and user_instruction are required" }, 400);
    }

    // Auth.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Membership.
    const { data: member } = await admin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    if (!member) {
      return json({ error: "workspace_not_found", details: "User is not a member", workspace_id }, 404);
    }

    // Best-effort company brain.
    const { data: brainRow } = await admin
      .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
    const companyBrain = (brainRow?.profile ?? {}) as Record<string, unknown>;

    const intent = detectIntent(user_instruction);
    const executionMode = tool_input?.execution_mode ?? "fast";

    // ---------- Staged plan from tool_input (short-circuits AI planner) ----------

    let parsed: { plan_summary: string; steps: Step[] } | null = null;
    let plannerSource: "ai" | "fallback" | "staged" = "fallback";

    // Phase 7 — Founder Content + Engagement Loop. Deterministic staged plan:
    // Scribe (founder post / ideas, Claude-preferred) → Scout (LinkedIn search)
    // → Aria (rank opportunities) → [Scribe comments, Claude-preferred] →
    // [Penn soft DMs, approval-gated]. No auto-post / auto-comment / auto-DM.
    if (tool_input && tool_input.intent === "content_engagement_loop") {
      const ti = tool_input as typeof tool_input & {
        signal_type?: string; competitor_related?: boolean;
        needs_comment_drafts?: boolean; needs_dm_drafts?: boolean;
      };
      const loopInput = extractContentLoopInput(user_instruction);
      // Carry classifier-derived flags onto the parsed input.
      loopInput.competitorRelated = !!ti.competitor_related || loopInput.competitorRelated;
      loopInput.needsCommentDrafts = !!ti.needs_comment_drafts;
      loopInput.needsDmDrafts = !!ti.needs_dm_drafts;
      loopInput.needsEngagementSearch = true;
      const loopPlan = buildContentLoopPlan(loopInput, companyBrain);
      const isCompetitor = (ti.signal_type === "competitor_engagement") || !!loopInput.competitorRelated;
      const cap = Math.max(1, Math.min(10, tool_input.max_results ?? loopPlan.search_budget.max_results_per_query));
      const topic = loopPlan.post_brief.topic || tool_input.query || user_instruction;
      const audience = loopPlan.post_brief.audience ?? "the company's ICP";
      const postSubtype = loopInput.contentFormat === "post_ideas" ? "post_ideas" : "founder_post";
      const engagementQ = loopPlan.engagement_queries.length ? loopPlan.engagement_queries.join(", ") : topic;

      const steps: Step[] = [];

      // 0) Scribe — founder post / ideas (Claude preferred via run-agent routing).
      const scribePost = mkStep(0, "scribe",
        postSubtype === "post_ideas" ? "Draft founder LinkedIn post ideas" : "Draft founder LinkedIn post",
        `Write ${postSubtype === "post_ideas" ? "a set of distinct founder LinkedIn post ideas" : "a founder LinkedIn post"} about: ${topic}. Audience: ${audience}. Tone: ${loopPlan.post_brief.tone}. Angle: ${loopPlan.post_brief.angle}. Ground it in real context — do NOT invent product details, metrics, or customer names. This is a draft for the founder to review and post manually; nothing is auto-posted.`,
        {
          tool_needed: null,
          expected_output: "On-brand founder content draft (no fabricated facts).",
          success_criteria: "Draft produced; grounded; nothing auto-posted.",
          planner_source: "fallback",
        });
      (scribePost as Step & { metadata?: Record<string, unknown> }).metadata = {
        tool_input: {
          ...tool_input,
          content_loop: {
            source: "content_engagement_loop",
            subtype: postSubtype,
            topic,
            audience: loopPlan.post_brief.audience ?? null,
            angle: loopPlan.post_brief.angle,
            engagement_queries: loopPlan.engagement_queries,
            competitor_related: isCompetitor,
          },
        },
      };
      steps.push(scribePost);

      // 1) Scout — find LinkedIn engagement opportunities for the post topic.
      const scoutToolInput = {
        ...tool_input,
        tool_name: "source_with_apify",
        selected_actor_key: "apify_linkedin_posts",
        source_type: "linkedin_engagement",
        query: engagementQ,
        keywords: loopPlan.engagement_queries,
        max_results: cap,
        signal_type: isCompetitor ? "competitor_engagement" : "linkedin_engagement",
      };
      const scoutStep = mkStep(1, "scout",
        isCompetitor ? "Find competitor engagement opportunities" : "Find LinkedIn engagement opportunities",
        `Find up to ${cap} LinkedIn posts / conversations to engage with on: ${engagementQ}. Use the LinkedIn posts actor only. Do not invent profiles or contact info; do not harvest commenter/reactor lists.`,
        {
          tool_needed: "source_with_apify",
          expected_output: "Normalized LinkedIn engagement items (post, author, topic, signal reason).",
          success_criteria: "Actor returns engagement items, or reports unavailable cleanly. No fabricated people.",
          planner_source: "fallback",
        });
      (scoutStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input: scoutToolInput };
      steps.push(scoutStep);

      // 2) Aria — rank engagement opportunities.
      steps.push(mkStep(2, "aria", "Rank engagement opportunities",
        `Rank the LinkedIn engagement opportunities for the post about: ${topic}. Score by ICP fit, relevance to the post, reply-worthiness, and urgency. Label hot | warm | maybe | ignore. Note where a thoughtful comment (or soft DM, if requested) is appropriate.`,
        {
          tool_needed: "extract_structured",
          expected_output: "Ranked engagement opportunities with priority label and rationale.",
          success_criteria: "Every opportunity scored; grounded only in the sourced items.",
          planner_source: "fallback",
        }));

      // 3) Scribe — thoughtful comments (Claude preferred), only if requested.
      if (loopInput.needsCommentDrafts) {
        const scribeComments = mkStep(steps.length, "scribe", "Draft thoughtful comments",
          `Draft a short, human, non-pitchy LinkedIn comment for each top-ranked post related to: ${topic}. Add genuine value; ground each comment in the actual post text. No "great post!" filler, no link drops, no fake familiarity. These are drafts for manual review — nothing is auto-posted.`,
          {
            tool_needed: "summarize_text",
            expected_output: "One thoughtful comment draft per top post, ready for manual review.",
            success_criteria: "Comments specific to each post; nothing auto-posted.",
            planner_source: "fallback",
          });
        (scribeComments as Step & { metadata?: Record<string, unknown> }).metadata = {
          tool_input: {
            ...tool_input,
            content_loop: { source: "content_engagement_loop", subtype: "comment_draft", topic, competitor_related: isCompetitor },
          },
        };
        steps.push(scribeComments);
      }

      // 4) Penn — soft DMs (Claude preferred), approval-gated, only if requested.
      if (loopInput.needsDmDrafts) {
        steps.push(mkStep(steps.length, "penn", "Draft soft follow-up DMs",
          `Draft a soft, no-pitch LinkedIn DM for each top-ranked person engaging on: ${topic}. Reference the specific post/context, ask one light question, no pitch in the first message. Approval required; never send automatically.`,
          {
            tool_needed: "draft_outreach",
            requires_approval: true,
            expected_output: "One soft DM per top person, awaiting approval.",
            success_criteria: "No auto-send; references real post context; no pitch in first message.",
            planner_source: "fallback",
          }));
      }

      steps.forEach((s, idx) => { s.step_index = idx; });
      const tail = loopInput.needsDmDrafts ? " → draft DMs" : loopInput.needsCommentDrafts ? " → draft comments" : "";
      parsed = {
        plan_summary: `${isCompetitor ? "Competitor content loop" : "Content loop"}: post → find engagement → rank${tail}: ${topic.slice(0, 70)}`,
        steps,
      };
      plannerSource = "staged";
    } else if (tool_input && tool_input.intent === "content_creation") {
      const scribeStep = mkStep(
        0,
        "scribe",
        "Write content",
        user_instruction,
        {
          tool_needed: null,
          expected_output: "On-brand content draft (post/report/summary as requested).",
          success_criteria: "Draft produced; no fabricated facts — ask for source context if missing.",
          planner_source: "fallback",
        },
      );
      (scribeStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };
      parsed = { plan_summary: `Content: ${user_instruction.slice(0, 90)}`, steps: [scribeStep] };
      plannerSource = "staged";
    } else if (tool_input && tool_input.intent === "draft_outreach") {
      // Memory-driven outreach follow-up: Pilot already resolved the target
      // leads from conversation memory. Deterministic Penn-only plan — no
      // Scout/Aria/Apify/research_web/Firecrawl, no duplicate Penn steps.
      const built = buildDraftOutreachPlan({
        user_instruction,
        max_results: (tool_input as { max_results?: number | null }).max_results ?? null,
        lead_candidate_ids: (tool_input as { lead_candidate_ids?: string[] | null }).lead_candidate_ids ?? null,
      });
      // Enrich + draft: Hawk (Firecrawl on the remembered leads' websites) → Penn.
      // The Hawk step instruction carries the lead domains as URLs so run-agent
      // scrapes them; Penn then drafts from the enriched context. Approval-gated.
      const enrichFirst = !!(tool_input as { needs_enrichment?: boolean }).needs_enrichment;
      const steps: Step[] = [];
      if (enrichFirst) {
        const hawkStep = mkStep(0, "hawk", "Enrich leads (Firecrawl)",
          `Analyze the company websites for these remembered leads and extract personalization angles (positioning, recent moves, ICP fit). Skip leads without a website. ${user_instruction}`,
          { tool_needed: "scrape_url", expected_output: "Per-lead enrichment notes / personalization angles.", success_criteria: "Only real scraped content; skip missing sites; no fabrication.", planner_source: "fallback" });
        (hawkStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input: { ...tool_input, tool_name: "scrape_url", selected_actor_key: null, source_type: null } };
        steps.push(hawkStep);
      }
      const s0 = built.steps[0];
      const pennStep = mkStep(steps.length, "penn", s0.task_title, s0.task_description, {
        tool_needed: "draft_outreach",
        requires_approval: true,
        expected_output: s0.expected_output,
        success_criteria: s0.success_criteria,
        planner_source: "fallback",
      });
      (pennStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };
      steps.push(pennStep);
      parsed = { plan_summary: enrichFirst ? `Enrich → draft outreach: ${built.plan_summary}`.slice(0, 140) : built.plan_summary, steps };
      plannerSource = "staged";
    } else if (tool_input && tool_input.source_type === "linkedin_comments") {
      // Phase 4.2 — extract commenters from a specific post → rank.
      const cap = Math.max(1, Math.min(50, tool_input.max_results ?? 20));
      const scoutStep = mkStep(0, "scout", "Extract post commenters",
        `Extract up to ${cap} commenters/engagers from the provided LinkedIn post URL(s). Use the post-comments actor only. Do not invent people or contact info; no reactions by default.`,
        {
          tool_needed: "source_with_apify",
          expected_output: "Normalized commenters (name, profile URL, comment text).",
          success_criteria: "Actor returns commenters or reports unavailable cleanly. No fabricated people.",
          planner_source: "fallback",
        });
      (scoutStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };
      const ariaStep = mkStep(1, "aria", "Rank commenters",
        "Rank the commenters by ICP fit, role (founder/GTM/operator), and how warm/relevant their comment is. Label hot | warm | maybe | ignore.",
        { tool_needed: "extract_structured", expected_output: "Ranked commenters with rationale.", success_criteria: "Grounded only in the extracted commenters.", planner_source: "fallback" });
      parsed = { plan_summary: `Extract & rank post commenters`, steps: [scoutStep, ariaStep] };
      plannerSource = "staged";
    } else if (tool_input && (tool_input as { competitor_discovery?: boolean }).competitor_discovery &&
        ((tool_input as { discovery_mode?: string }).discovery_mode === "website" || (tool_input as { discovery_mode?: string }).discovery_mode === "description")) {
      // Phase 4 (dynamic) — competitor discovery: website → Hawk(Firecrawl) first,
      // description → Hawk(infer) first, then Scout(LinkedIn actor) → Aria → [..].
      const ti = tool_input as typeof tool_input & {
        discovery_mode?: "website" | "description"; business_website?: string; business_description?: string;
        needs_comment_drafts?: boolean; needs_dm_drafts?: boolean; signal_type?: string; competitors?: string[];
      };
      const dplan = buildCompetitorDiscoveryPlan(ti.discovery_mode!, {
        website_url: ti.business_website ?? null,
        description: ti.business_description ?? null,
        topic: tool_input.query || user_instruction,
        needs_comment_drafts: ti.needs_comment_drafts,
        needs_dm_drafts: ti.needs_dm_drafts,
        max: tool_input.max_results,
      });
      // The Scout step must run the LinkedIn actor → give it the apify tool_input.
      // The Hawk step (website mode) must only Firecrawl → give it a scrape-only tool_input.
      const knownCompetitors = Array.isArray(ti.competitors) ? ti.competitors : [];
      const scoutToolInput = { ...tool_input, tool_name: "source_with_apify", selected_actor_key: "apify_linkedin_posts", source_type: "linkedin_engagement", competitors: knownCompetitors };
      // competitor_discovery flag on the Hawk inputs makes run-agent skip the
      // optional Perplexity research_web call (inference is Gemini-only) and lets
      // the inference→search threading carry known competitors into Scout.
      const hawkScrapeToolInput = { tool_name: "scrape_url", selected_actor_key: null, source_type: null, query: ti.business_website ?? null, max_results: 1, competitor_discovery: true, discovery_mode: ti.discovery_mode, competitors: knownCompetitors };
      // Inference-only Hawk (description mode): explicit no-tool input so it does
      // NOT inherit the plan's apify tool_input and re-run the LinkedIn actor.
      const hawkInferToolInput = { tool_name: null, selected_actor_key: null, source_type: null, competitor_discovery: true, discovery_mode: ti.discovery_mode, competitors: knownCompetitors };
      const steps: Step[] = dplan.steps.map((s, idx) => {
        const st = mkStep(idx, s.agent_slug, s.task_title, s.task_description, {
          tool_needed: s.tool_needed,
          requires_approval: s.requires_approval ?? false,
          expected_output: "Grounded output for the discovery pipeline; no fabricated competitors/people.",
          success_criteria: "Grounded only in prior steps / actor results. No auto-post/DM/send.",
          planner_source: "fallback",
        });
        if (s.agent_slug === "scout") (st as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input: scoutToolInput };
        else if (s.agent_slug === "hawk") (st as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input: s.tool_needed === "scrape_url" ? hawkScrapeToolInput : hawkInferToolInput };
        return st;
      });
      parsed = { plan_summary: dplan.plan_summary, steps };
      plannerSource = "staged";
    } else if (tool_input && tool_input.source_type === "linkedin_engagement") {
      // Phase 3 — LinkedIn engagement signal engine. Deterministic staged plan:
      // Scout (apify_linkedin_posts) → Aria (rank) → [Scribe comments] → [Penn DMs].
      const ti = tool_input as typeof tool_input & {
        needs_comment_drafts?: boolean; needs_dm_drafts?: boolean; keywords?: string[];
        signal_type?: string; competitors?: string[];
      };
      const isCompetitor = ti.signal_type === "competitor_engagement";
      const cap = Math.max(1, Math.min(20, tool_input.max_results ?? 5));
      const topic = (ti.keywords && ti.keywords.length > 0) ? ti.keywords.join(", ") : (tool_input.query || user_instruction);
      const compNote = isCompetitor && ti.competitors && ti.competitors.length > 0
        ? ` (competitors: ${ti.competitors.join(", ")})` : "";
      const steps: Step[] = [];
      const scoutStep = mkStep(0, "scout",
        isCompetitor ? "Find competitor engagement signals" : "Find LinkedIn engagement signals",
        `Find up to ${cap} LinkedIn posts / people ${isCompetitor ? "engaging around competitors/adjacent tools" : "engaging"} on: ${topic}${compNote}. Use the LinkedIn posts actor only. Do not invent profiles or contact info.`,
        {
          tool_needed: "source_with_apify",
          expected_output: "Normalized LinkedIn engagement items (post, author, topic, signal reason).",
          success_criteria: "Actor returns engagement items, or reports unavailable cleanly. No fabricated people.",
          planner_source: "fallback",
        });
      (scoutStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };
      steps.push(scoutStep);
      steps.push(mkStep(1, "aria", isCompetitor ? "Rank competitor signals" : "Rank engagement signals",
        isCompetitor
          ? `Rank these competitor-engagement signals for: ${topic}${compNote}. Score by ICP fit, founder/GTM/operator role, pain or complaint about the competitor, comparison/switching intent, competitor relevance, recency, and engagement quality. Label hot (explicit complaint/switching/looking for alternatives + high ICP fit) | warm (discussing the competitor/problem, decent ICP fit) | maybe (generic mention) | ignore (irrelevant/non-ICP). Note where a soft comment/DM is appropriate.`
          : `Rank the LinkedIn engagement signals for: ${topic}. Score by ICP fit, role fit (founder/GTM/operator), relevance to Agentory, pain/urgency, and whether engagement is warm enough to comment or DM. Label each hot | warm | maybe | ignore.`,
        {
          tool_needed: "extract_structured",
          expected_output: "Ranked engagement signals with priority label and rationale.",
          success_criteria: "Every signal scored; grounded only in the sourced items.",
          planner_source: "fallback",
        }));
      if (ti.needs_comment_drafts) {
        steps.push(mkStep(2, "scribe", "Draft LinkedIn comments",
          `Draft a short, human, non-pitchy LinkedIn comment for each top-ranked post about: ${topic}. Add genuine value to the post. No "great post!" filler, no fake familiarity, no link drops. Ground each comment in the actual post text.`,
          {
            tool_needed: "summarize_text",
            expected_output: "One thoughtful comment per top post, ready for manual review/posting.",
            success_criteria: "Comments are specific to each post; nothing auto-posted.",
            planner_source: "fallback",
          }));
      }
      if (ti.needs_dm_drafts) {
        steps.push(mkStep(steps.length, "penn", "Draft soft follow-up DMs",
          `Draft a soft, no-pitch LinkedIn DM for each top-ranked person engaging on: ${topic}. Reference the specific post/context, ask one light question, no pitch in the first message. Approval required; never send automatically.`,
          {
            tool_needed: "draft_outreach",
            requires_approval: true,
            expected_output: "One soft DM per top person, awaiting approval.",
            success_criteria: "No auto-send; references real post context; no pitch in first message.",
            planner_source: "fallback",
          }));
      }
      steps.forEach((s, idx) => { s.step_index = idx; });
      const modeLabel = ti.needs_dm_drafts ? "Source → rank → draft DMs"
        : ti.needs_comment_drafts ? "Source → rank → draft comments" : "Source → rank";
      parsed = { plan_summary: `${isCompetitor ? "Competitor engagement" : "LinkedIn engagement"} (${modeLabel}): ${topic}`, steps };
      plannerSource = "staged";
    } else if (tool_input && tool_input.tool_name === "source_with_apify") {
      const cap = Math.max(1, Math.min(200, tool_input.max_results ?? 5));
      const sourcingStep = mkStep(
        0,
        "scout",
        "Source signals via Apify",
        `Find ${cap} ${tool_input.source_type ?? "jobs"} matching: ${tool_input.query || user_instruction}${tool_input.location ? ` in ${tool_input.location}` : ""}${tool_input.role_keywords?.length ? ` (roles: ${tool_input.role_keywords.join(", ")})` : ""}`,
        {
          tool_needed: "source_with_apify",
          expected_output: "Normalized list of signals with company, role, url, location.",
          success_criteria: "Apify returns at least a few results, or reports unavailable cleanly.",
          planner_source: "fallback",
        },
      );
      (sourcingStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };

      const steps: Step[] = [sourcingStep];
      const rankStep = mkStep(1, "aria", "Rank signals", `Score and rank the sourced signals against: ${user_instruction}`, {
        tool_needed: "extract_structured",
        expected_output: "Ranked list with fit score and rationale.",
        success_criteria: "Every signal scored.",
        planner_source: "fallback",
      });
      steps.push(rankStep);

      if (executionMode === "deep" || executionMode === "outreach") {
        steps.push(mkStep(2, "hawk", "Enrich top companies", `Firecrawl the top companies for: ${user_instruction}`, {
          tool_needed: "scrape_url",
          expected_output: "Enrichment notes for top 3-5 companies.",
          success_criteria: "Only top-ranked companies enriched; cost-capped.",
          planner_source: "fallback",
        }));
      }

      // full_gtm_report: when the user asks for a report/summary/brief, add a
      // Scribe report step BEFORE Penn so it can be reviewed before approving
      // any send. Detected from the instruction (deterministic).
      const wantsReport = /\b(report|summary|brief|write[-\s]?up|recap|overview|digest)\b/i.test(user_instruction);
      const isFullGtm = wantsReport && (executionMode === "deep" || executionMode === "outreach");
      if (isFullGtm) {
        steps.push(mkStep(99, "scribe", "Write review report", `Write a short, reviewable report of the sourced and ranked results (and enrichment) for: ${user_instruction}. Ground it only in the prior steps' outputs; do not fabricate.`, {
          tool_needed: "summarize_text",
          expected_output: "Concise report the user can review before approving outreach.",
          success_criteria: "Grounded in prior step outputs; no fabricated companies/people.",
          planner_source: "fallback",
        }));
      }

      if (executionMode === "outreach") {
        steps.push(mkStep(99, "penn", "Draft outreach (top 5)", `Draft personalized outreach for top candidates from: ${user_instruction}`, {
          tool_needed: "draft_outreach",
          requires_approval: true,
          expected_output: "Up to 5 personalized drafts ready for review.",
          success_criteria: "No auto-send; capped at 5 unless user confirms more.",
          planner_source: "fallback",
        }));
      }

      // Re-index step_index to match array position (run-agent chains by array
      // position, so inserted steps must keep these aligned).
      steps.forEach((s, i) => { s.step_index = i; });

      const modeLabel = isFullGtm
        ? (executionMode === "outreach" ? "Source → rank → enrich → report → draft" : "Source → rank → enrich → report")
        : executionMode === "outreach" ? "Source → rank → enrich → draft" : executionMode === "deep" ? "Source → rank → enrich" : "Source → rank";
      parsed = {
        plan_summary: `${modeLabel}: ${tool_input.query || user_instruction}`,
        steps,
      };
      plannerSource = "staged";
    } else if (tool_input && tool_input.tool_name === "scrape_url") {
      const scrapeStep = mkStep(0, "hawk", "Scrape source", `Scrape and extract from: ${user_instruction}`, {
        tool_needed: "scrape_url",
        expected_output: "Markdown + summary of the target page.",
        success_criteria: "Non-empty extraction.",
        planner_source: "fallback",
      });
      (scrapeStep as Step & { metadata?: Record<string, unknown> }).metadata = { tool_input };
      const briefStep = mkStep(1, "scribe", "Summarize findings", `Summarize the extracted content for: ${user_instruction}`, {
        tool_needed: "summarize_text",
        expected_output: "Short brief grounded in scraped content.",
        success_criteria: "No fabrication.",
        planner_source: "fallback",
      });
      parsed = { plan_summary: `Extract and summarize: ${user_instruction}`, steps: [scrapeStep, briefStep] };
      plannerSource = "staged";
    }

    // ---------- AI planner (only if no staged plan) ----------

    let ai: any = null;
    if (!parsed) {

    const orchestratorPrompt = `You are the planner for ScreeningPilot, an AI workforce orchestrator.
Convert the user instruction into a multi-step plan with the right agents, tools, and approval gates.

AGENTS:
- scout  = sourcing, lead/candidate discovery, research collection
- aria   = screening, ranking, scoring, evaluation, fit analysis
- penn   = outreach, follow-up, personalized messages, email drafts (approval-gated sending)
- hawk   = market/competitive intelligence, signals, monitoring, scraping
- scribe = content, summaries, briefs, posts, reports

TOOLS (priority order matters):
- source_with_apify   (apify)        allowed: scout, hawk — PRIMARY for finding companies/leads/hiring signals/jobs/posts
- scrape_url          (firecrawl)    allowed: hawk, scout — PRIMARY for any specific URL/page extraction
- search_web          (gemini_search) allowed: hawk, scout — broad/current web research (may be unavailable; that's fine)
- research_web        (perplexity)   allowed: hawk, scout — OPTIONAL fallback only when explicitly preferred
- summarize_text      (gemini)       allowed: aria, scribe, hawk, scout
- extract_structured  (gemini)       allowed: aria, scribe, hawk, scout
- draft_outreach      (gemini)       allowed: penn
- send_email          (resend)       allowed: penn — ALWAYS requires_approval=true

WORKFLOW ARCHETYPES (use as defaults, deepen when useful):
A. Sourcing (hiring/companies/leads) -> scout(source_with_apify) -> aria(extract_structured) -> penn(draft_outreach, approval) ONLY if outreach was requested
B. Extraction from URL -> hawk(scrape_url) -> scribe(summarize_text)
C. Intelligence (hiring shape: companies/jobs/roles) -> hawk(source_with_apify) -> scribe(summarize_text)
C2. Intelligence (broad market/current events) -> hawk(search_web) -> scribe(summarize_text)
D. Outreach -> penn(draft_outreach, approval); add penn(send_email, approval) only if user said send
E. Content -> scribe(summarize_text); prepend hawk(search_web) only if user wants current facts
F. Screening -> aria(extract_structured)


COMPANY CONTEXT (may be empty):
${JSON.stringify(companyBrain)}

USER INSTRUCTION:
"${user_instruction}"

DETECTED INTENT: ${intent}

RULES:
- agent_slug must be one of: scout, aria, penn, hawk, scribe.
- Never claim live data was retrieved — only describe what the agent will do.
- Default to deeper plans (multi-step) for sourcing, extraction, intelligence, and outreach.
- send_email and any irreversible external action MUST set requires_approval=true.

Return ONLY valid JSON, no prose, no markdown:
{
  "plan_summary": "one sentence",
  "intent": "${intent}",
  "steps": [
    {
      "step_index": 0,
      "agent_slug": "scout",
      "task_title": "Source candidates",
      "task_description": "specific instruction",
      "tool_needed": "research_web",
      "expected_output": "what this step produces",
      "success_criteria": "how we know it worked",
      "requires_approval": false
    }
  ]
}`;

    ai = await generateJson({
      taskType: "orchestration_plan",
      systemPrompt: getAgentorySystemPrompt({
        taskType: "planning",
        currentAgent: "pilot",
        companyBrain: companyBrain as Record<string, unknown> | null,
        actorRegistrySummary: summarizeRegistryForPrompt(),
      }),
      messages: [{ role: "user", content: orchestratorPrompt }],
      temperature: 0.3,
      maxTokens: 2048,
      functionName: "orchestrate",
      workspaceId: workspace_id,
    });

    await logProviderCall(admin, {
      workspace_id,
      function_name: "orchestrate",
      task_type: "orchestration_plan",
      provider: ai.provider,
      model: ai.model,
      success: ai.ok,
      latency_ms: ai.latencyMs,
      error_code: ai.errorCode,
      prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
    });

    if (ai.ok && ai.json) {
      const p = ai.json as { plan_summary?: string; steps?: any[] };
      if (p && Array.isArray(p.steps) && p.steps.length > 0) {
        const normalized: Step[] = p.steps
          .map((s: any, i: number): Step | null => {
            const slug = normalizeSlug(s?.agent_slug);
            if (!slug) return null;
            const desc =
              (typeof s.task_description === "string" && s.task_description.trim()) ||
              (typeof s.instruction === "string" && s.instruction.trim()) ||
              user_instruction;
            const title = (typeof s.task_title === "string" && s.task_title.trim()) || `${KNOWN_AGENTS[slug]} step`;
            const tool = (typeof s.tool_needed === "string" ? s.tool_needed : null) as ToolName;
            const approval = s.requires_approval === true || s.needs_approval === true || tool === "send_email";
            return {
              step_index: typeof s.step_index === "number" ? s.step_index : i,
              agent_slug: slug,
              agent_name: KNOWN_AGENTS[slug],
              task_title: title,
              task_description: desc,
              instruction: desc,
              capability: typeof s.capability === "string" ? s.capability : undefined,
              tool_needed: tool,
              expected_output: typeof s.expected_output === "string" ? s.expected_output : "",
              success_criteria: typeof s.success_criteria === "string" ? s.success_criteria : "",
              requires_approval: approval,
              needs_approval: approval,
              planner_source: "ai",
            };
          })
          .filter((s): s is Step => s !== null);
        if (normalized.length > 0) {
          parsed = { plan_summary: p.plan_summary || `Plan for: ${user_instruction}`, steps: normalized };
          plannerSource = "ai";
        }
      }
    } else {
      console.warn("[orchestrate] AI planner unavailable, falling back:", ai.error);
    }

    if (!parsed) parsed = fallbackPlan(user_instruction, intent);

    // Deterministic expansion (only when not using staged plan).
    parsed.steps = expandPlan(user_instruction, intent, parsed.steps);

    } // end AI planner branch

    // Safety: source_and_qualify_only strips every Penn / outreach / drafting /
    // publishing step from the plan (whatever added it — AI planner, fallback, or
    // staged), so the runtime cannot generate outreach. Applied to ALL plan paths.
    const modeStripped = filterPlanForMode(parsed!.steps as Step[], executionMode);
    parsed!.steps = modeStripped.steps;
    if (modeStripped.removed.length) {
      console.log("[orchestrate] source_and_qualify_only removed steps", modeStripped.removed);
    }

    // Tool availability annotation.
    const connectorsMissing = annotateTools(parsed!.steps);

    console.log("[orchestrate] plan ready", {
      source: plannerSource,
      intent,
      execution_mode: executionMode,
      steps: parsed!.steps.length,
      agents: parsed!.steps.map((s) => s.agent_slug),
      tools: parsed!.steps.map((s) => s.tool_needed),
      connectors_missing: connectorsMissing,
    });

    // ---- QUALIFIED-LEAD PLANNING, BEFORE PERSISTENCE ------------------------
    //
    // The plan the user sees used to be the generic "Scout sources signals, Aria
    // ranks signals" template, persisted here, with Claude called LATER inside
    // run-agent where it could only rewrite an internal keyword list. So the plan
    // on screen never described the actual mission and never reflected anything
    // Claude decided.
    //
    // Planning now happens BEFORE the insert, and what is persisted is what was
    // validated. TIGHTLY GATED: only a qualified-Lead route, only when the
    // existing Claude-first flag AND the workspace allow-list both pass. Every
    // other workflow reaches the unchanged insert below.
    const qlPlan = await planQualifiedLeadBeforePersistence({
      // The Supabase client's generic type is deeper than the brain loader's
      // structural contract; the loader only ever reads one table.
      admin: admin as never, workspaceId: workspace_id, userInstruction: user_instruction ?? "",
      toolInput: (tool_input as Record<string, unknown> | null) ?? null,
      fallbackSteps: parsed!.steps as unknown as Array<Record<string, unknown>>,
      fallbackSummary: parsed!.plan_summary,
    });

    // Persist task_plan.
    const { data: taskPlan, error: planError } = await admin
      .from("task_plans")
      .insert({
        workspace_id,
        user_id: userId,
        created_by: userId,
        goal: user_instruction,
        user_instruction,
        plan_summary: qlPlan?.summary ?? parsed!.plan_summary,
        steps: qlPlan?.steps ?? parsed!.steps,
        status: "executing",
      })
      .select("id")
      .single();

    if (planError || !taskPlan) {
      console.error("[orchestrate] task_plan_insert_failed:", planError);
      return json({ error: "task_plan_insert_failed", details: planError?.message }, 500);
    }

    // Phase A routing — for sourcing/lead intents, separate the request into
    // persona / company profile / signal / role family and decide account_first vs
    // profile_first. Threaded to run-agent as `lead_routing` (authoritative), and
    // recorded on the plan for traceability. Pure / no provider call.
    const leadRouting = (intent === "sourcing" || intent === "extraction")
      ? (() => {
          const si = separateIntent({ message: user_instruction, hardExclusions: (tool_input as { disqualifiers?: string[] } | null)?.disqualifiers ?? undefined });
          return {
            source_strategy: si.source_strategy,
            decision_maker_strategy: si.decision_maker_strategy,
            requested_role_family: si.requested_role_family,
            requested_signal: si.requested_signal,
            target_personas: si.target_personas,
            relaxation_policy: si.relaxation_policy,
          };
        })()
      : null;

    await admin.from("activity_feed").insert({
      workspace_id,
      plan_id: taskPlan.id,
      event_type: "plan_created",
      title: "Plan created",
      body: parsed!.plan_summary,
      metadata: {
        total_steps: parsed!.steps.length,
        conversation_id,
        planner: plannerSource,
        provider: ai?.provider ?? "staged",
        model: ai?.model ?? "n/a",
        intent,
        execution_mode: executionMode,
        agents: parsed!.steps.map((s) => s.agent_slug),
        tools_required: parsed!.steps.map((s) => s.tool_needed).filter(Boolean),
        connectors_missing: connectorsMissing,
        tool_input: tool_input ?? null,
        lead_routing: leadRouting,
        source_and_qualify_only: isSourceAndQualifyOnly(executionMode),
        mode_removed_steps: modeStripped.removed,
      },
    });

    // Kick off first step (non-blocking).
    const firstStep = parsed!.steps[0];
    // DETERMINISTIC route from the user's own words — authoritative over the
    // planner/template, exactly as pilot-chat decides it.
    const qlRoute = routeQualifiedLead(user_instruction ?? "");
    const qualifiedLead = qlRoute.workflowKind === "qualified_lead_sourcing";
    const qualifiedLeadCount = extractRequestedLeadCount(user_instruction ?? "") ?? 5;

    fetch(`${SUPABASE_URL}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        plan_id: taskPlan.id,
        step_index: 0,
        agent_slug: firstStep.agent_slug,
        workspace_id,
        user_id: userId,
        instruction: firstStep.instruction,
        input: user_instruction,
        needs_approval: firstStep.requires_approval === true,
        tool_needed: firstStep.tool_needed,
        // Per-step tool_input wins (lets step 0 use a different tool than the
        // plan default, e.g. discovery's Hawk-scrape step 0 before Scout-apify).
        tool_input: (firstStep as Step & { metadata?: { tool_input?: unknown } }).metadata?.tool_input ?? tool_input ?? null,
        execution_mode: qualifiedLead ? "company_first" : executionMode,
        lead_routing: leadRouting,
        // QUALIFIED-LEAD ROUTE. run-agent's company-first branch needs (a) an
        // unpinned actor so it compiles the entity intent itself, and (b) the
        // FINAL-LEAD quota. Without these the request silently degrades to the
        // legacy account-signal path (the 2026-07-26 manual-run defect).
        ...(qualifiedLead
          ? {
              workflow_kind: "qualified_lead_sourcing",
              requested_lead_count: qualifiedLeadCount,
              quota_policy: "contact_only",
              count_entity: "contact_ready_lead",
            }
          : {}),
        // THE PLAN IS ALREADY MADE. Passing the validated artifact is what stops
        // run-agent planning the same mission a second time — one initial planner
        // request per run, and the strategy that executes is the one on screen.
        ...(qlPlan ? { qualified_lead_plan: qlPlan.artifact } : {}),
      }),
    }).catch((e) => console.error("[orchestrate] run-agent kickoff failed:", e));

    return json({
      success: true,
      plan_id: taskPlan.id,
      task_plan_id: taskPlan.id,
      plan_summary: parsed!.plan_summary,
      total_steps: parsed!.steps.length,
      steps_count: parsed!.steps.length,
      planner: plannerSource,
      intent,
      execution_mode: executionMode,
      agents: parsed!.steps.map((s) => s.agent_slug),
      connectors_missing: connectorsMissing,
      plan: parsed,
    });
  } catch (err) {
    console.error("[orchestrate] unexpected:", err);
    return json({ error: "internal_error", details: String(err) }, 500);
  }
});
