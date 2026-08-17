// THE LEAD WORKFLOW'S ONLY MODEL. GPT, with no fallback.
//
// ── WHY THIS IS NOT `aiProvider.ts` ──────────────────────────────────────────
//
// `aiProvider` is shared product infrastructure: pilot chat, orchestration,
// intent routing, workflow classification, Company Brain generation, the daily
// brief and the Workbench opener all call it, and it fans out across a Gemini
// gateway and Anthropic with automatic fallback between them. That fallback is
// correct for a chat reply — a slightly different model still answers the user.
//
// It is wrong for this workflow. Lead sourcing spends money on the strength of
// what the model decides: which Actors run, what JSON they receive, whether a
// company's evidence qualifies it. A silent degradation to a different model
// mid-run changes those decisions and leaves no trace in the result, and the
// user's bill is already paid by the time anyone notices.
//
// So the lead path imports this module and never `aiProvider`. GPT answers, or
// the stage fails and says so. A wrong actor selection is recoverable; an
// invisible one is not.
//
// ── AND WHY IT DOES NOT RETRY ACROSS MODELS ──────────────────────────────────
//
// `aiProvider` tries Gemini, then a second Gemini model, then Anthropic. On the
// migrated project `LOVABLE_API_KEY` is a placeholder, so every one of its calls
// currently burns two failed authentications before reaching a working provider.
// That is invisible latency against an edge-function wall clock. This module has
// one credential and one endpoint: if it fails, the caller learns immediately.
//
// PURE OF SECRETS. The key is read from the environment at call time and never
// returned, logged, or included in an error — an error path that echoes its own
// credential is how keys reach log aggregators.

export const GPT_PROVIDER_VERSION = "gpt-provider-v1" as const;

/**
 * The model this workflow runs on.
 *
 * Named here rather than passed in, because "which model decided this" must be
 * answerable from the code for a run that spent money, not from whatever a
 * caller happened to pass six frames up.
 */
export const GPT_MODEL = "gpt-4.1" as const;

/** A JSON Schema the model must satisfy. Enforced by the API, not by hope. */
export interface GptSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface GptRequest {
  /** What this call is for. Appears in diagnostics; never sent verbatim. */
  purpose: string;
  system: string;
  user: string;
  /**
   * The output contract, when this caller has no validator of its own.
   *
   * OMIT IT ONLY when a downstream parser already owns the shape — see the
   * `response_format` note in `gptStructured`. Every call still returns a JSON
   * object either way; the question is only which layer defines its contents,
   * and there must be exactly one.
   */
  schema?: GptSchema;
  maxTokens?: number;
  /**
   * Defaults to 0. These are decisions, not drafts — the same request should
   * produce the same plan, and a run that varies for no reason is a run nobody
   * can debug.
   */
  temperature?: number;
}

export type GptResult<T> =
  | { ok: true; value: T; model: string; latency_ms: number }
  | {
    ok: false;
    /** Why it failed, in a form a caller can branch on. */
    code:
      | "no_api_key"
      | "http_error"
      | "transport_error"
      | "empty_response"
      | "unparseable_json"
      | "schema_refused";
    /** Safe to log and to persist. Never contains the key. */
    detail: string;
    latency_ms: number;
  };

export interface GptDeps {
  /** Injected so tests exercise every branch without a network or a key. */
  fetch?: (url: string, init: RequestInit) => Promise<{
    ok: boolean; status: number; text: () => Promise<string>;
  }>;
  readEnv?: (key: string) => string | undefined;
  now?: () => number;
  log?: (msg: string, meta?: unknown) => void;
}

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * Strip anything credential-shaped out of text that will be persisted.
 *
 * NOT PARANOIA — a test caught this leaking. Two paths carry provider text into
 * a stored result: an HTTP error body and a transport error string. Neither is
 * ours, both are echoed, and an auth failure is exactly the case where a
 * provider is most likely to quote the credential it rejected.
 *
 * The known key is removed by value, so nothing depends on guessing its shape;
 * the pattern sweep then catches a DIFFERENT key that might appear in the same
 * text — a key from another service, or one the provider quoted back.
 */
function redact(text: string, key: string): string {
  let out = text;
  if (key) out = out.split(key).join("[redacted]");
  // Any OpenAI-style token, whoever it belongs to.
  return out.replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, "[redacted]");
}

/**
 * Ask GPT for one typed object.
 *
 * NEVER THROWS. Every failure is a value, because the callers are pipeline
 * stages that must decide whether to fall back to a deterministic plan, and an
 * exception thrown through them would abandon a run that has already spent
 * money on discovery.
 */
export async function gptStructured<T>(
  req: GptRequest, deps: GptDeps = {},
): Promise<GptResult<T>> {
  const readEnv = deps.readEnv ?? ((k: string) => Deno.env.get(k));
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const started = now();
  const elapsed = () => now() - started;

  const key = readEnv("OPENAI_API_KEY");
  if (!key) {
    // NOT A DEGRADATION. The caller decides what to do without a model; this
    // module will not quietly answer with a different one.
    return { ok: false, code: "no_api_key", detail: "OPENAI_API_KEY is not set", latency_ms: elapsed() };
  }

  const doFetch = deps.fetch ?? ((url: string, init: RequestInit) =>
    fetch(url, init) as unknown as Promise<{
      ok: boolean; status: number; text: () => Promise<string>;
    }>);

  let raw: string;
  try {
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GPT_MODEL,
        temperature: req.temperature ?? 0,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        // STRUCTURED OUTPUT, ENFORCED BY THE API. `strict` makes the model
        // unable to return a shape the schema forbids, which removes the whole
        // class of "the model answered in prose today" failures that a
        // parse-and-hope approach lives with.
        //
        // ── WHY A SCHEMA IS OPTIONAL ──────────────────────────────────────
        //
        // A schema here is a SECOND statement of what a valid answer is. Where
        // the caller has no other validator that is exactly what you want. But
        // several lead-intelligence stages answer through
        // `intelligence/plannerWrapper`, which already parses the envelope,
        // scans it for injection, and makes one constrained repair — it IS the
        // authority on their shape. Declaring a strict schema in front of it
        // would create two definitions of one contract, and two definitions
        // drift; that drift is precisely how a field the parser reads becomes
        // unemittable and a constraint silently disappears.
        //
        // So a caller WITH its own validator asks for `json_object` — the
        // answer is still guaranteed to be JSON, and the existing parser stays
        // the single authority on what the JSON must contain.
        response_format: req.schema
          ? {
            type: "json_schema",
            json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema },
          }
          : { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // The status and a bounded excerpt only. A provider error body can echo
      // request content, and this string is persisted into task results.
      return {
        ok: false, code: "http_error",
        detail: redact(`OpenAI returned HTTP ${res.status}: ${body.slice(0, 300)}`, key),
        latency_ms: elapsed(),
      };
    }
    raw = await res.text();
  } catch (e) {
    return {
      ok: false, code: "transport_error",
      detail: redact(String(e).slice(0, 300), key), latency_ms: elapsed(),
    };
  }

  let content: string | undefined;
  try {
    const parsed = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string; refusal?: string | null } }>;
    };
    const choice = parsed.choices?.[0]?.message;
    // A REFUSAL IS NOT AN EMPTY ANSWER. The model declining is a distinct
    // outcome from it failing, and a caller may reasonably treat them
    // differently — one is worth retrying with a different prompt, the other
    // is not.
    if (choice?.refusal) {
      return {
        ok: false, code: "schema_refused",
        detail: redact(`the model refused: ${String(choice.refusal).slice(0, 200)}`, key),
        latency_ms: elapsed(),
      };
    }
    content = choice?.content ?? undefined;
  } catch {
    return { ok: false, code: "unparseable_json", detail: "the API envelope was not JSON", latency_ms: elapsed() };
  }

  if (!content || !content.trim()) {
    return { ok: false, code: "empty_response", detail: "the model returned no content", latency_ms: elapsed() };
  }

  try {
    const value = JSON.parse(content) as T;
    log("gpt_call_ok", { purpose: req.purpose, model: GPT_MODEL, latency_ms: elapsed() });
    return { ok: true, value, model: GPT_MODEL, latency_ms: elapsed() };
  } catch {
    // `strict` should make this unreachable. It is handled anyway, because
    // "unreachable" is a claim about a provider we do not control.
    return {
      ok: false, code: "unparseable_json",
      detail: "the content field was not valid JSON despite a strict schema",
      latency_ms: elapsed(),
    };
  }
}

/** Is the lead workflow's model available at all? For preflight, not for routing. */
export function gptAvailable(readEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): boolean {
  return !!readEnv("OPENAI_API_KEY");
}

/** Compact record of one call, for the execution state. Carries no payload. */
export function gptDiagnostics<T>(purpose: string, r: GptResult<T>): Record<string, unknown> {
  return {
    purpose,
    provider: "openai",
    model: r.ok ? r.model : GPT_MODEL,
    ok: r.ok,
    latency_ms: r.latency_ms,
    ...(r.ok ? {} : { failure_code: r.code, detail: r.detail }),
  };
}
