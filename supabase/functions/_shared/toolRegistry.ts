// Shared backend tool registry for the AI workforce.
// All external tool calls go through `runTool` so that:
//   - tool_calls rows are written (queued → running → succeeded|failed|unavailable)
//   - activity_feed gets a "tool_used" or "tool_failed" entry
//   - allowed_agents is enforced server-side
//   - missing API keys produce a graceful "unavailable" instead of a crash
//
// Edge functions import this with a relative path:
//   import { runTool } from "../_shared/toolRegistry.ts";

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ToolContext {
  admin: SupabaseClient;
  workspace_id: string;
  agent_slug: string;
  agent_id: string | null;
  agent_name?: string;
  plan_id?: string | null;
  task_id?: string | null;
  user_id?: string | null;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  unavailable?: boolean;
  awaiting_approval?: boolean;
}

interface ToolDef {
  name: string;
  provider: string;
  description: string;
  allowed_agents: string[];
  requires_approval: boolean;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

// ---------- Tool: research_web (Perplexity) ----------

async function execResearchWeb(input: unknown): Promise<ToolResult> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    return { ok: false, unavailable: true, error: "PERPLEXITY_API_KEY not configured" };
  }

  const i = (input ?? {}) as { query?: string; recency?: string };
  const query = (i.query ?? "").toString().trim();
  if (!query) return { ok: false, error: "missing 'query'" };

  const body: Record<string, unknown> = {
    model: "sonar",
    messages: [
      { role: "system", content: "Be precise, concise, and factual. Cite sources." },
      { role: "user", content: query },
    ],
  };
  if (i.recency) body.search_recency_filter = i.recency;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          ok: true,
          data: {
            content: data?.choices?.[0]?.message?.content ?? "",
            citations: Array.isArray(data?.citations) ? data.citations : [],
            model: data?.model,
          },
        };
      }
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { ok: false, error: `Perplexity ${res.status}: ${JSON.stringify(data?.error ?? data)}` };
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { ok: false, error: `Perplexity fetch failed: ${String(e)}` };
    }
  }
  return { ok: false, error: "Perplexity retry exhausted" };
}

// ---------- Tool: scrape_url (Firecrawl) — declared stub ----------

async function execScrapeUrl(input: unknown): Promise<ToolResult> {
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!FIRECRAWL_API_KEY) {
    return { ok: false, unavailable: true, error: "FIRECRAWL_API_KEY not configured" };
  }
  const i = (input ?? {}) as { url?: string };
  if (!i.url) return { ok: false, error: "missing 'url'" };
  // Minimal call; full Firecrawl wiring deferred.
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: i.url, formats: ["markdown"] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Firecrawl ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Firecrawl fetch failed: ${String(e)}` };
  }
}

// ---------- Tool: send_email (Resend) — approval-gated stub ----------

async function execSendEmail(input: unknown): Promise<ToolResult> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { ok: false, unavailable: true, error: "RESEND_API_KEY not configured" };
  const i = (input ?? {}) as { to?: string; subject?: string; html?: string; from?: string };
  if (!i.to || !i.subject || !i.html) return { ok: false, error: "missing to/subject/html" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: i.from ?? "Workforce <onboarding@resend.dev>",
        to: [i.to],
        subject: i.subject,
        html: i.html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Resend ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Resend fetch failed: ${String(e)}` };
  }
}

// ---------- Registry ----------

const REGISTRY: Record<string, ToolDef> = {
  research_web: {
    name: "research_web",
    provider: "perplexity",
    description: "Live web research with citations via Perplexity Sonar.",
    allowed_agents: ["hawk", "scout"],
    requires_approval: false,
    execute: execResearchWeb,
  },
  scrape_url: {
    name: "scrape_url",
    provider: "firecrawl",
    description: "Scrape a single URL to markdown via Firecrawl.",
    allowed_agents: ["hawk", "scout"],
    requires_approval: false,
    execute: execScrapeUrl,
  },
  send_email: {
    name: "send_email",
    provider: "resend",
    description: "Send a transactional email via Resend (approval-gated).",
    allowed_agents: ["penn"],
    requires_approval: true,
    execute: execSendEmail,
  },
};

export function listTools() {
  return Object.values(REGISTRY).map((t) => ({
    name: t.name,
    provider: t.provider,
    allowed_agents: t.allowed_agents,
    requires_approval: t.requires_approval,
  }));
}

// ---------- Main entry point ----------

export async function runTool(
  toolName: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = REGISTRY[toolName];
  if (!tool) {
    console.error("[toolRegistry] tool_not_found:", toolName);
    return { ok: false, error: `tool_not_found:${toolName}` };
  }

  if (!tool.allowed_agents.includes(ctx.agent_slug)) {
    console.warn("[toolRegistry] tool_forbidden:", { tool: toolName, agent: ctx.agent_slug });
    await logToolCall(ctx, tool, input, {
      ok: false,
      error: `agent '${ctx.agent_slug}' not allowed to use '${toolName}'`,
    }, "failed");
    return { ok: false, error: "tool_forbidden" };
  }

  // Insert queued row + write activity.
  const startedAt = new Date().toISOString();
  const { data: row } = await ctx.admin
    .from("tool_calls")
    .insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      tool_name: tool.name,
      provider: tool.provider,
      input_json: safeJson(input),
      status: "running",
      started_at: startedAt,
      created_by: ctx.user_id ?? null,
    })
    .select("id")
    .single();

  // Approval gate — refuse to execute, create approval, return awaiting_approval.
  if (tool.requires_approval) {
    await ctx.admin.from("approvals").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      title: `${ctx.agent_name ?? ctx.agent_slug} requests ${tool.name}`,
      description: `Approval required to execute ${tool.name} via ${tool.provider}.`,
      status: "pending",
    });
    if (row?.id) {
      await ctx.admin.from("tool_calls").update({ status: "queued" }).eq("id", row.id);
    }
    await ctx.admin.from("activity_feed").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      agent_id: ctx.agent_id ?? null,
      event_type: "tool_awaiting_approval",
      title: `${ctx.agent_name ?? ctx.agent_slug} ${tool.name} awaiting approval`,
      body: `${tool.name} requires approval before running.`,
      metadata: { tool: tool.name, provider: tool.provider, tool_call_id: row?.id },
    });
    return { ok: false, awaiting_approval: true, error: "awaiting_approval" };
  }

  // Execute.
  let result: ToolResult;
  try {
    result = await tool.execute(input, ctx);
  } catch (e) {
    result = { ok: false, error: `tool_threw:${String(e)}` };
  }

  const status = result.ok ? "succeeded" : result.unavailable ? "unavailable" : "failed";
  const completedAt = new Date().toISOString();

  if (row?.id) {
    await ctx.admin.from("tool_calls").update({
      status,
      output_json: safeJson(result.data ?? null),
      error: result.error ?? null,
      completed_at: completedAt,
    }).eq("id", row.id);
  }

  await ctx.admin.from("activity_feed").insert({
    workspace_id: ctx.workspace_id,
    plan_id: ctx.plan_id ?? null,
    agent_id: ctx.agent_id ?? null,
    event_type: result.ok ? "tool_used" : "tool_failed",
    title: `${ctx.agent_name ?? ctx.agent_slug} ${result.ok ? "used" : "could not use"} ${tool.name}`,
    body: result.ok
      ? `${tool.provider} responded successfully.`
      : result.unavailable
        ? `${tool.provider} is not configured. ${result.error ?? ""}`
        : `${tool.provider} failed: ${result.error ?? "unknown"}`,
    metadata: {
      tool: tool.name,
      provider: tool.provider,
      tool_call_id: row?.id ?? null,
      status,
    },
  });

  return result;
}

async function logToolCall(
  ctx: ToolContext,
  tool: ToolDef,
  input: unknown,
  result: ToolResult,
  status: string,
) {
  try {
    await ctx.admin.from("tool_calls").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      tool_name: tool.name,
      provider: tool.provider,
      input_json: safeJson(input),
      output_json: safeJson(result.data ?? null),
      status,
      error: result.error ?? null,
      created_by: ctx.user_id ?? null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[toolRegistry] logToolCall failed:", e);
  }
}

function safeJson(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return { _unserializable: true };
  }
}
