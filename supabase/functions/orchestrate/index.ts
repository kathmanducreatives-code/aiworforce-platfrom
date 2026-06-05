// orchestrate: plan a multi-agent workflow and kick off the first step.
// Workflow-aware: produces deep plans (sourcing, research, intel, outreach,
// content, screening, brief) with tool + approval metadata, then deterministic
// expansion to guarantee depth. Tool availability is annotated, never faked.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { isToolConfigured } from "../_shared/toolRegistry.ts";

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
      execution_mode?: "fast" | "deep" | "outreach";
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

    // ---------- AI planner ----------

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

    const ai = await generateJson({
      taskType: "orchestration_plan",
      systemPrompt: "You are a planning assistant. Respond with valid JSON only.",
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
    });

    let plannerSource: "ai" | "fallback" = "fallback";
    let parsed: { plan_summary: string; steps: Step[] } | null = null;

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

    // Deterministic expansion.
    parsed.steps = expandPlan(user_instruction, intent, parsed.steps);

    // Tool availability annotation.
    const connectorsMissing = annotateTools(parsed.steps);

    console.log("[orchestrate] plan ready", {
      source: plannerSource,
      intent,
      steps: parsed.steps.length,
      agents: parsed.steps.map((s) => s.agent_slug),
      tools: parsed.steps.map((s) => s.tool_needed),
      connectors_missing: connectorsMissing,
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
        plan_summary: parsed.plan_summary,
        steps: parsed.steps,
        status: "executing",
      })
      .select("id")
      .single();

    if (planError || !taskPlan) {
      console.error("[orchestrate] task_plan_insert_failed:", planError);
      return json({ error: "task_plan_insert_failed", details: planError?.message }, 500);
    }

    await admin.from("activity_feed").insert({
      workspace_id,
      plan_id: taskPlan.id,
      event_type: "plan_created",
      title: "Plan created",
      body: parsed.plan_summary,
      metadata: {
        total_steps: parsed.steps.length,
        conversation_id,
        planner: plannerSource,
        provider: ai.provider,
        model: ai.model,
        intent,
        agents: parsed.steps.map((s) => s.agent_slug),
        tools_required: parsed.steps.map((s) => s.tool_needed).filter(Boolean),
        connectors_missing: connectorsMissing,
      },
    });

    // Kick off first step (non-blocking).
    const firstStep = parsed.steps[0];
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
      }),
    }).catch((e) => console.error("[orchestrate] run-agent kickoff failed:", e));

    return json({
      success: true,
      plan_id: taskPlan.id,
      task_plan_id: taskPlan.id,
      plan_summary: parsed.plan_summary,
      total_steps: parsed.steps.length,
      steps_count: parsed.steps.length,
      planner: plannerSource,
      intent,
      agents: parsed.steps.map((s) => s.agent_slug),
      connectors_missing: connectorsMissing,
      plan: parsed,
    });
  } catch (err) {
    console.error("[orchestrate] unexpected:", err);
    return json({ error: "internal_error", details: String(err) }, 500);
  }
});
