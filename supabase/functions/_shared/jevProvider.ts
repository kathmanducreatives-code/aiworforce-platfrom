// THE JEV ADAPTER — THE ONE PLACE AGENTORY TALKS TO TYPESAFE AI.
//
// Jev is TypeSafe AI's "System One" structured-decision model: it reads one
// `state` and answers typed questions with a choice, probabilities and a
// confidence. Everything here is the DOCUMENTED contract, read 2026-09-27 from
// docs.typesafe.ai (/api, /primitives/choice, /models, /confidence) — no field
// is invented:
//
//   POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <key>
//   { state, model, questions: { <key>: { type: "choice", instructions, criteria } } }
//   → { model, answers: { <key>: { type, choice, probabilities, confidence } },
//       usage: { input_tokens, output_tokens } }
//   request id: response header `x-typesafe-request-id`
//
// Documented limits this adapter respects: at most 255 options per Choice (we
// send ≤ MAX_SNIPPETS + 1); 64k tokens per request. A Choice picks ONE option
// — the API has no multi-select — so each facet's support and contradiction
// are one best snippet each. Price: $0.042 per million input tokens, output
// free (docs.typesafe.ai/models, jev-1.13.0).
//
// ── WHAT THIS ADAPTER IS NOT ──────────────────────────────────────────────
//
//   * Not an authority. It returns RAW answers; `facetAttestation` validates
//     them and nothing downstream reads them in Phase 1.
//   * Not a retry loop. One attempt, bounded by a timeout. A shadow call that
//     fails is a diagnostic, and paying twice for a diagnostic is not worth it.
//   * Not a secret holder. The key is read from the server environment by the
//     caller and passed in; nothing here is importable by the Vite bundle
//     (`supabase/functions` is never built into it).
//
// Pure apart from the injected `fetch`.

import { buildModelTelemetry, type ModelCallTelemetry } from "./modelCostModel.ts";
import {
  ATTESTED_FACETS, EVIDENCE_IS_DATA, FACET_DEFINITIONS, FACET_VERDICTS, VERDICT_DEFINITIONS,
  type AttestedFacet, type RawFacetAnswers, type SnippetSet,
} from "./facetAttestation.ts";

export const JEV_PROVIDER_VERSION = "jev-provider-v1" as const;
export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
/**
 * PINNED, not `jev-latest`. The docs recommend pinning the versioned id when
 * thresholds are tuned against it, and an alias is also unpriced here — which
 * would bill the shadow against the run's UNPRICED-call budget.
 */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";
export const DEFAULT_JEV_TIMEOUT_MS = 5000;
/** The ledger role. Separate from every GPT stage so its spend is its own line. */
export const JEV_MODEL_ROLE = "facet_attestation_jev";
/** "The option to choose when no snippet applies." A plain option, not a reserved word. */
export const NO_SNIPPET = "NONE";

export type JudgeFailure =
  | "no_api_key" | "no_snippets" | "timeout" | "network" | "http_error" | "rate_limited"
  | "overloaded" | "unauthorized" | "rejected_request" | "malformed_response";

export type JudgeOutcome =
  | {
    ok: true;
    answers: RawFacetAnswers;
    model: string;
    latency_ms: number;
    telemetry: ModelCallTelemetry;
    request_id: string | null;
  }
  | {
    ok: false;
    failure: JudgeFailure;
    detail: string;
    latency_ms: number;
    telemetry: ModelCallTelemetry | null;
  };

/** Anything that answers the fixed facet questions over a snippet set. */
export type FacetJudge = (i: { snippets: SnippetSet; facets?: readonly AttestedFacet[] }) => Promise<JudgeOutcome>;

export interface JevDeps {
  apiKey: string | null;
  model?: string;
  timeoutMs?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  /** The existing model-spend seam (`ModelCallCollector.sink`). */
  onModelCall?: (t: ModelCallTelemetry, ok: boolean) => void;
}

const key = (facet: AttestedFacet, part: "verdict" | "support" | "contradiction") => `${facet}__${part}`;

/**
 * The request body, exactly as documented. Pure, so a test can prove what is
 * — and is not — sent: snippet text only ever inside `state`, never in an
 * instruction; no provider name, no workspace data, no user text.
 */
export function buildJevRequest(
  snippets: SnippetSet, model: string, facets: readonly AttestedFacet[] = ATTESTED_FACETS,
): { state: Record<string, unknown>; model: string; questions: Record<string, unknown> } {
  const idCriteria = (none: string): Record<string, string | null> => {
    const c: Record<string, string | null> = {};
    for (const s of snippets.snippets) c[s.snippet_id] = null; // the id names a snippet in the state
    c[NO_SNIPPET] = none;
    return c;
  };
  const questions: Record<string, unknown> = {};
  for (const f of facets) {
    questions[key(f, "verdict")] = {
      type: "choice",
      instructions: `${EVIDENCE_IS_DATA} Statement: ${FACET_DEFINITIONS[f]} Does the evidence state it?`,
      criteria: Object.fromEntries(FACET_VERDICTS.map((v) => [v, VERDICT_DEFINITIONS[v]])),
    };
    questions[key(f, "support")] = {
      type: "choice",
      instructions: `${EVIDENCE_IS_DATA} Which ONE snippet id most directly supports this statement: ${FACET_DEFINITIONS[f]}`,
      criteria: idCriteria("No snippet supports the statement."),
    };
    questions[key(f, "contradiction")] = {
      type: "choice",
      instructions: `${EVIDENCE_IS_DATA} Which ONE snippet id most directly contradicts this statement: ${FACET_DEFINITIONS[f]}`,
      criteria: idCriteria("No snippet contradicts the statement."),
    };
  }
  return {
    state: {
      company: snippets.company_name ?? null,
      evidence_snippets: Object.fromEntries(snippets.snippets.map((s) => [s.snippet_id, s.text])),
    },
    model,
    questions,
  };
}

/**
 * The documented response, read into raw facet answers. Reads `answers[key].choice`,
 * `.probabilities` and `.confidence` and nothing else. Null when the body is
 * not the documented shape — a verdict question missing counts as malformed;
 * the id questions may be absent and simply cite nothing.
 */
export function parseJevResponse(body: unknown, facets: readonly AttestedFacet[] = ATTESTED_FACETS): RawFacetAnswers | null {
  if (!body || typeof body !== "object") return null;
  const answers = (body as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") return null;
  const a = answers as Record<string, unknown>;
  const choiceOf = (k: string) => {
    const x = a[k];
    if (!x || typeof x !== "object") return null;
    const c = x as { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown };
    return c.type === "choice" && typeof c.choice === "string" ? c : null;
  };
  const out: RawFacetAnswers = {};
  for (const f of facets) {
    const verdict = choiceOf(key(f, "verdict"));
    if (!verdict) return null;
    out[f] = {
      verdict: verdict.choice,
      support: choiceOf(key(f, "support"))?.choice ?? null,
      contradiction: choiceOf(key(f, "contradiction"))?.choice ?? null,
      confidence: verdict.confidence,
      probabilities: verdict.probabilities,
    };
  }
  return out;
}

function failureFor(status: number): JudgeFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 422 || status === 400) return "rejected_request";
  if (status === 429) return "rate_limited";
  if (status === 529 || status === 503) return "overloaded";
  return "http_error";
}

/** Ask Jev the fixed facet questions. Never throws; a failure is an outcome. */
export async function evaluateFacets(
  i: { snippets: SnippetSet; facets?: readonly AttestedFacet[] }, deps: JevDeps,
): Promise<JudgeOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const model = (deps.model ?? DEFAULT_JEV_MODEL).trim() || DEFAULT_JEV_MODEL;
  const facets = i.facets ?? ATTESTED_FACETS;
  const meter = (usage: { input_tokens: number | null; output_tokens: number | null }, ok: boolean, answeredBy = model) => {
    const t = buildModelTelemetry({
      role: JEV_MODEL_ROLE, model: answeredBy, reasoning_effort: null,
      usage: { input_tokens: usage.input_tokens, cached_input_tokens: null, output_tokens: usage.output_tokens },
      latency_ms: now() - started,
    });
    try { deps.onModelCall?.(t, ok); } catch { /* a ledger fault must not become a Jev fault */ }
    return t;
  };
  const fail = (failure: JudgeFailure, detail: string, reached: boolean): JudgeOutcome => ({
    ok: false, failure, detail: detail.slice(0, 200), latency_ms: now() - started,
    // A call that reached Jev may have been billed; it is recorded as unpriced
    // (no counts), never as free. One that never left is not a model call.
    telemetry: reached ? meter({ input_tokens: null, output_tokens: null }, false) : null,
  });

  if (!deps.apiKey) return fail("no_api_key", "JEV_API_KEY is not set", false);
  if (i.snippets.snippets.length === 0) return fail("no_snippets", "no evidence to judge", false);

  const body = buildJevRequest(i.snippets, model, facets);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, deps.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS));
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(JEV_API_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError");
    return fail(aborted ? "timeout" : "network", aborted ? "no answer within the timeout" : "the request did not complete", true);
  }
  let text = "";
  try {
    text = await res.text();
  } catch {
    clearTimeout(timer);
    return fail(controller.signal.aborted ? "timeout" : "network", "the response body could not be read", true);
  }
  clearTimeout(timer);
  // Never the body of an error: it may echo the request, which carries evidence.
  if (!res.ok) return fail(failureFor(res.status), `HTTP ${res.status}`, true);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("malformed_response", "the body is not JSON", true);
  }
  const usage = (json as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  const counts = {
    input_tokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
    output_tokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
  };
  const answeredBy = typeof (json as { model?: unknown }).model === "string" ? (json as { model: string }).model : model;
  const answers = parseJevResponse(json, facets);
  if (!answers) {
    const t = meter(counts, false, answeredBy);
    return { ok: false, failure: "malformed_response", detail: "the answers are not the documented shape", latency_ms: now() - started, telemetry: t };
  }
  const telemetry = meter(counts, true, answeredBy);
  return {
    ok: true, answers, model: answeredBy, latency_ms: now() - started, telemetry,
    request_id: res.headers?.get?.("x-typesafe-request-id") ?? null,
  };
}

/** A judge bound to its deps — the shape the shadow and the benchmark take. */
export function jevJudge(deps: JevDeps): FacetJudge {
  return (i) => evaluateFacets(i, deps);
}
