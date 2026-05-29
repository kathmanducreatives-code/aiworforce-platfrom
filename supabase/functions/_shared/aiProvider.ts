// Shared AI provider adapter. Lovable AI Gateway is the default brain;
// Anthropic is an optional advanced/fallback provider used only when
// ANTHROPIC_API_KEY is set.
//
// Used by: pilot-chat, orchestrate, run-agent.

export type ProviderName = "lovable-ai" | "anthropic";
export type TaskType =
  | "pilot_chat"
  | "orchestration_plan"
  | "agent_execution"
  | "helper";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOpts {
  taskType: TaskType;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  preferredProvider?: ProviderName;
  agentSlug?: string;
  functionName?: string;
  workspaceId?: string;
  // when true, request JSON-shaped output (best-effort)
  jsonMode?: boolean;
}

export interface GenerateResult {
  ok: boolean;
  content: string;
  json?: unknown;
  provider: ProviderName | "none";
  model: string;
  usage?: unknown;
  error?: string;
  errorCode?: string;
  latencyMs: number;
}

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const DEFAULT_MODELS: Record<TaskType, string> = {
  pilot_chat: "google/gemini-3-flash-preview",
  orchestration_plan: "google/gemini-3-flash-preview",
  agent_execution: "google/gemini-3-flash-preview",
  helper: "google/gemini-2.5-flash-lite",
};

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

// ----- JSON extraction (tolerant of fences / preamble / truncation) -----

export function stripFences(s: string): string {
  return s.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export function extractJson(raw: string): unknown {
  const cleaned = stripFences(raw);
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("no JSON found");
  const opener = cleaned[start];
  const closer = opener === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(closer);
  const slice = end > start ? cleaned.slice(start, end + 1) : cleaned.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    let braces = 0, brackets = 0;
    for (const ch of slice) {
      if (ch === "{") braces++;
      else if (ch === "}") braces--;
      else if (ch === "[") brackets++;
      else if (ch === "]") brackets--;
    }
    let repaired = slice.replace(/[\x00-\x1F\x7F]/g, "");
    while (brackets-- > 0) repaired += "]";
    while (braces-- > 0) repaired += "}";
    return JSON.parse(repaired);
  }
}

// ----- Provider callers -----

async function callLovable(
  model: string,
  opts: GenerateOpts,
  apiKey: string,
): Promise<{ ok: boolean; content: string; usage?: unknown; error?: string; errorCode?: string }> {
  const messages: ChatMessage[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  for (const m of opts.messages) messages.push(m);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(LOVABLE_GATEWAY_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      let code = `lovable_${res.status}`;
      if (res.status === 429) code = "rate_limited";
      else if (res.status === 402) code = "credits_exhausted";
      return { ok: false, content: "", error: `Lovable ${res.status}: ${text.slice(0, 300)}`, errorCode: code };
    }
    const data = JSON.parse(text);
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    return { ok: true, content, usage: data?.usage };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, content: "", error: `lovable fetch failed: ${String(e)}`, errorCode: "network_error" };
  }
}

async function callAnthropic(
  opts: GenerateOpts,
  apiKey: string,
): Promise<{ ok: boolean; content: string; usage?: unknown; error?: string; errorCode?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.systemPrompt,
        messages: opts.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, content: "", error: `Anthropic ${res.status}: ${text.slice(0, 300)}`, errorCode: `anthropic_${res.status}` };
    }
    const data = JSON.parse(text);
    const content: string = (data?.content ?? []).map((c: any) => c?.text ?? "").join("\n").trim();
    return { ok: true, content, usage: data?.usage };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, content: "", error: `anthropic fetch failed: ${String(e)}`, errorCode: "network_error" };
  }
}

// ----- Public API -----

export async function generateText(opts: GenerateOpts): Promise<GenerateResult> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const defaultModel = DEFAULT_MODELS[opts.taskType];
  const started = Date.now();

  type Attempt = { provider: ProviderName; model: string; run: () => Promise<Awaited<ReturnType<typeof callLovable>>> };
  const attempts: Attempt[] = [];

  const wantsAnthropicFirst = opts.preferredProvider === "anthropic" && !!anthropicKey;

  if (wantsAnthropicFirst) {
    attempts.push({ provider: "anthropic", model: ANTHROPIC_MODEL, run: () => callAnthropic(opts, anthropicKey!) });
  }
  if (lovableKey) {
    attempts.push({ provider: "lovable-ai", model: defaultModel, run: () => callLovable(defaultModel, opts, lovableKey) });
    // alt model fallback (different family)
    const alt = "openai/gpt-5-mini";
    if (alt !== defaultModel) {
      attempts.push({ provider: "lovable-ai", model: alt, run: () => callLovable(alt, opts, lovableKey) });
    }
  }
  if (anthropicKey && !wantsAnthropicFirst) {
    attempts.push({ provider: "anthropic", model: ANTHROPIC_MODEL, run: () => callAnthropic(opts, anthropicKey) });
  }

  if (attempts.length === 0) {
    return {
      ok: false,
      content: "",
      provider: "none",
      model: "",
      error: "No AI provider configured (need LOVABLE_API_KEY or ANTHROPIC_API_KEY).",
      errorCode: "no_provider",
      latencyMs: Date.now() - started,
    };
  }

  let lastErr = "no attempts";
  let lastCode = "unknown";
  for (const att of attempts) {
    const r = await att.run();
    if (r.ok && r.content) {
      const latencyMs = Date.now() - started;
      console.log("[aiProvider] ok", {
        fn: opts.functionName, task: opts.taskType, agent: opts.agentSlug,
        provider: att.provider, model: att.model, latencyMs,
      });
      return {
        ok: true, content: r.content, provider: att.provider, model: att.model,
        usage: r.usage, latencyMs,
      };
    }
    lastErr = r.error ?? "unknown error";
    lastCode = r.errorCode ?? "unknown";
    console.warn("[aiProvider] attempt failed", {
      fn: opts.functionName, task: opts.taskType,
      provider: att.provider, model: att.model, error: lastErr,
    });
    // Don't retry on credits_exhausted — surface immediately.
    if (lastCode === "credits_exhausted") break;
  }

  return {
    ok: false, content: "", provider: "none", model: "",
    error: lastErr, errorCode: lastCode, latencyMs: Date.now() - started,
  };
}

export async function generateJson(opts: GenerateOpts): Promise<GenerateResult> {
  const r = await generateText({ ...opts, jsonMode: true });
  if (!r.ok) return r;
  try {
    const parsed = extractJson(r.content);
    return { ...r, json: parsed };
  } catch (e) {
    return { ...r, ok: false, error: `json_parse_failed: ${String(e)}`, errorCode: "json_parse_failed" };
  }
}

// ----- Lightweight metadata logger -----

export async function logProviderCall(
  admin: any,
  meta: {
    workspace_id?: string | null;
    plan_id?: string | null;
    agent_id?: string | null;
    function_name: string;
    agent_slug?: string | null;
    task_type: TaskType;
    provider: ProviderName | "none";
    model: string;
    success: boolean;
    latency_ms: number;
    error_code?: string;
  },
): Promise<void> {
  if (!meta.workspace_id) return;
  try {
    await admin.from("activity_feed").insert({
      workspace_id: meta.workspace_id,
      plan_id: meta.plan_id ?? null,
      agent_id: meta.agent_id ?? null,
      event_type: "ai_provider_call",
      title: `${meta.provider}:${meta.model}`,
      body: meta.success ? "ok" : `failed: ${meta.error_code ?? "unknown"}`,
      metadata: {
        function: meta.function_name,
        agent_slug: meta.agent_slug ?? null,
        task_type: meta.task_type,
        provider: meta.provider,
        model: meta.model,
        success: meta.success,
        latency_ms: meta.latency_ms,
        error_code: meta.error_code ?? null,
      },
    });
  } catch (e) {
    console.warn("[aiProvider] logProviderCall failed:", String(e));
  }
}
