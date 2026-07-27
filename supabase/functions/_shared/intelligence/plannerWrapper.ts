// CLAUDE PLANNER WRAPPER — one typed, bounded, fail-safe path to the model.
//
// This does NOT introduce a second Claude integration. `_shared/aiProvider.ts` is
// the repository's provider abstraction (Lovable gateway primary, Anthropic
// optional) and remains the only thing that speaks HTTP to a model. This wrapper
// adds the planning-specific contract on top of it: a strict schema, bounded
// output, one constrained repair attempt, a timeout, and a fallback that is always
// available.
//
// THE INVARIANT: this function never throws and never returns an unvalidated
// strategy. Every failure — timeout, malformed JSON, schema violation, injected
// instruction, provider outage — resolves to `status: "fallback"` with a reason.
// A planner that throws would take down the deterministic runtime it exists to
// advise, which is the opposite of the point.
//
// PHASE 1: NOT WIRED. Nothing in run-agent, orchestrate or pilot-chat calls this.
// It is exercised only by tests, with the model injected. No live model call.

import { generateJson, type GenerateOpts, type GenerateResult } from "../aiProvider.ts";
import { canonicalJson, sha256Hex } from "../planHash.ts";
import { detectInjection } from "../broadeningValidator.ts";
import { assemblePlannerPrompt, verifyTrustBoundary, type AssemblePromptInput } from "./promptAssembly.ts";

export const PLANNER_VERSION = "agentory-planner-1.0.0";
export const PLANNER_TEMPERATURE = 0;
export const PLANNER_MAX_OUTPUT_TOKENS = 1_500;
export const PLANNER_TIMEOUT_MS = 25_000;

/** Bounds applied to every planner response before it is trusted. */
export const PLANNER_BOUNDS = {
  maxSummaryChars: 600,
  maxItemChars: 240,
  maxArrayItems: 12,
  maxApprovals: 8,
} as const;

export type PlannerStatus =
  | "ok"
  | "repaired"
  | "fallback_invalid_json"
  | "fallback_schema_violation"
  | "fallback_injection"
  | "fallback_timeout"
  | "fallback_provider_error"
  | "fallback_disabled";

export interface ClaudeStrategyEnvelope<TStrategy> {
  planner_version: string;
  interpretation: {
    summary: string;
    assumptions: string[];
    ambiguities: string[];
    confidence: number;
  };
  strategy: TStrategy;
  constraints_preserved: string[];
  requested_approvals: Array<{ type: string; reason: string; proposed_change: unknown }>;
  risks: string[];
  fallback_reason?: string;
}

/** Diagnostics. Deliberately carries NO prompt text and NO model reasoning. */
export interface PlannerCallDiagnostics {
  planner_version: string;
  model: string;
  provider: string;
  status: PlannerStatus;
  latency_ms: number;
  input_hash: string;
  output_hash: string | null;
  repair_attempted: boolean;
  /** Present only when the provider reported it. */
  token_usage?: unknown;
}

export type PlannerOutcome<TStrategy> =
  | { ok: true; envelope: ClaudeStrategyEnvelope<TStrategy>; diagnostics: PlannerCallDiagnostics }
  | { ok: false; reason: PlannerStatus; diagnostics: PlannerCallDiagnostics };

/** The model call, injected so tests never touch a network. Defaults to aiProvider. */
export type GenerateJsonFn = (opts: GenerateOpts) => Promise<GenerateResult>;

/**
 * Everything the wrapper needs EXCEPT the prompt.
 *
 * Split out so a caller that assembles its own fenced prompt — the bounded
 * source-feedback adapter does, because its input is aggregate funnel metrics
 * rather than a mission envelope — reaches the model through this same wrapper
 * instead of a second one. The timeout, the throw/timeout distinction, the
 * injection scan, the single constrained repair and the diagnostics are shared.
 */
export interface PlannerCallInput<TStrategy> {
  /** Department-supplied validation of the `strategy` field. Shape-only, no policy. */
  validateStrategy: (candidate: unknown) => { ok: true; strategy: TStrategy } | { ok: false; problem: string };
  /** Always available. Used whenever the model cannot be trusted or reached. */
  fallbackStrategy: TStrategy;
  generate?: GenerateJsonFn;
  timeoutMs?: number;
  workspaceId?: string;
  /**
   * Phase 1 default FALSE. The wrapper refuses to call a model unless the caller
   * has already resolved a feature flag and passed the result. There is no way to
   * reach a model by forgetting an argument.
   */
  enabled?: boolean;
}

export interface PlannerRunInput<TStrategy> extends AssemblePromptInput, PlannerCallInput<TStrategy> {}

/** A prompt that has already been assembled and fenced by the caller. */
export interface AssembledPromptCore {
  systemPrompt: string;
  userMessage: string;
}

export interface PlannerPromptRunInput<TStrategy> extends PlannerCallInput<TStrategy> {
  prompt: AssembledPromptCore;
}

// ------------------------------------------------------------------ bounding --

function boundString(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function boundArray(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((x) => boundString(x, maxChars)).filter(Boolean);
}

function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ------------------------------------------------------------- the fallback --

export function fallbackEnvelope<TStrategy>(
  strategy: TStrategy,
  reason: PlannerStatus,
): ClaudeStrategyEnvelope<TStrategy> {
  return {
    planner_version: PLANNER_VERSION,
    interpretation: {
      summary: "Deterministic strategy used; the planner did not produce a usable plan.",
      assumptions: [],
      ambiguities: [],
      confidence: 0,
    },
    strategy,
    constraints_preserved: [],
    requested_approvals: [],
    risks: [],
    fallback_reason: reason,
  };
}

// ------------------------------------------------------------------ parsing --

export type ParseOutcome<TStrategy> =
  | { ok: true; envelope: ClaudeStrategyEnvelope<TStrategy> }
  | { ok: false; status: PlannerStatus; problem: string };

/**
 * Parse and bound one model response.
 *
 * Injection is checked against the WHOLE serialized response, including fields the
 * schema does not define — an instruction smuggled into an unexpected key is still
 * an instruction, and a field-by-field scan would miss it.
 */
export function parsePlannerResponse<TStrategy>(
  raw: unknown,
  validateStrategy: PlannerRunInput<TStrategy>["validateStrategy"],
): ParseOutcome<TStrategy> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: "fallback_schema_violation", problem: "response_not_an_object" };
  }

  const injection = detectInjection(canonicalJson(raw));
  if (injection) {
    return { ok: false, status: "fallback_injection", problem: `injection:${injection}` };
  }

  const o = raw as Record<string, unknown>;
  const interp = (o.interpretation ?? {}) as Record<string, unknown>;

  const strategyCheck = validateStrategy(o.strategy);
  if (!strategyCheck.ok) {
    return { ok: false, status: "fallback_schema_violation", problem: strategyCheck.problem };
  }

  const approvalsRaw = Array.isArray(o.requested_approvals) ? o.requested_approvals : [];
  const requested_approvals = approvalsRaw
    .slice(0, PLANNER_BOUNDS.maxApprovals)
    .map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      return {
        type: boundString(x.type, PLANNER_BOUNDS.maxItemChars),
        reason: boundString(x.reason, PLANNER_BOUNDS.maxItemChars),
        proposed_change: x.proposed_change ?? null,
      };
    })
    .filter((a) => a.type.length > 0);

  return {
    ok: true,
    envelope: {
      planner_version: PLANNER_VERSION,
      interpretation: {
        summary: boundString(interp.summary, PLANNER_BOUNDS.maxSummaryChars),
        assumptions: boundArray(interp.assumptions, PLANNER_BOUNDS.maxArrayItems, PLANNER_BOUNDS.maxItemChars),
        ambiguities: boundArray(interp.ambiguities, PLANNER_BOUNDS.maxArrayItems, PLANNER_BOUNDS.maxItemChars),
        confidence: clamp01(interp.confidence),
      },
      strategy: strategyCheck.strategy,
      constraints_preserved: boundArray(o.constraints_preserved, PLANNER_BOUNDS.maxArrayItems, PLANNER_BOUNDS.maxItemChars),
      requested_approvals,
      risks: boundArray(o.risks, PLANNER_BOUNDS.maxArrayItems, PLANNER_BOUNDS.maxItemChars),
    },
  };
}

// -------------------------------------------------------------------- timeout --

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(onTimeout());
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    });
  });
}

// ------------------------------------------------------------------ the run ---

/**
 * Run the planner.
 *
 * One constrained repair attempt: when the first response is malformed, the model
 * is re-asked with the specific problem appended and NOTHING else changed. It is
 * not a second chance to plan — it is a chance to restate the same plan correctly.
 * An injection finding is never repaired: a response that tried to smuggle an
 * instruction does not get a second attempt.
 */
export async function runPlanner<TStrategy>(
  input: PlannerRunInput<TStrategy>,
): Promise<PlannerOutcome<TStrategy>> {
  return await runPlannerWithPrompt({ ...input, prompt: assemblePlannerPrompt(input) });
}

/**
 * The wrapper's core, over an ALREADY-assembled prompt.
 *
 * `runPlanner` is this function plus `assemblePlannerPrompt`, so mission-shaped
 * callers are unchanged and there is still exactly one path to the model.
 */
export async function runPlannerWithPrompt<TStrategy>(
  input: PlannerPromptRunInput<TStrategy>,
): Promise<PlannerOutcome<TStrategy>> {
  const started = Date.now();
  const assembled = input.prompt;
  const inputHash = await sha256Hex(canonicalJson({
    system: assembled.systemPrompt,
    user: assembled.userMessage,
    version: PLANNER_VERSION,
  }));

  const baseDiag = (status: PlannerStatus, extra: Partial<PlannerCallDiagnostics> = {}): PlannerCallDiagnostics => ({
    planner_version: PLANNER_VERSION,
    model: extra.model ?? "",
    provider: extra.provider ?? "none",
    status,
    latency_ms: Date.now() - started,
    input_hash: inputHash,
    output_hash: extra.output_hash ?? null,
    repair_attempted: extra.repair_attempted ?? false,
    ...(extra.token_usage !== undefined ? { token_usage: extra.token_usage } : {}),
  });

  // DISABLED IS THE DEFAULT. No flag resolved, no model call.
  if (input.enabled !== true) {
    return { ok: false, reason: "fallback_disabled", diagnostics: baseDiag("fallback_disabled") };
  }

  // The boundary is verified before the prompt leaves this function, not after.
  const boundary = verifyTrustBoundary(assembled.userMessage);
  if (!boundary.ok) {
    return { ok: false, reason: "fallback_injection", diagnostics: baseDiag("fallback_injection") };
  }

  const generate = input.generate ?? generateJson;
  const timeoutMs = input.timeoutMs ?? PLANNER_TIMEOUT_MS;

  // A THROW is not a TIMEOUT. Catching the rejection here, before the timeout
  // wrapper sees it, keeps the two distinguishable in diagnostics — otherwise every
  // network failure is reported as a timeout and the real cause is invisible.
  const guarded = (opts: GenerateOpts): Promise<GenerateResult> =>
    generate(opts).catch((e) => ({
      ok: false, content: "", provider: "none" as const, model: "",
      error: String(e), errorCode: "provider_exception", latencyMs: 0,
    }));

  const call = (userMessage: string): Promise<GenerateResult> =>
    withTimeout(
      guarded({
        taskType: "orchestration_plan",
        // CLAUDE-FIRST MEANS CLAUDE.
        //
        // `orchestration_plan` maps to a Gemini model on the Lovable gateway, and
        // aiProvider tries Lovable FIRST whenever LOVABLE_API_KEY is present. Both
        // keys are configured, so without this the Agentory planner — the whole
        // point of which is that CLAUDE authors the strategy — would silently be
        // authored by Gemini, and the diagnostics would report `lovable-ai`.
        //
        // This asks for Anthropic explicitly. It is a PREFERENCE, not a
        // requirement: `wantsAnthropicFirst` only reorders the attempts when
        // ANTHROPIC_API_KEY exists, so an environment without it still falls
        // through to the existing providers rather than losing planning entirely.
        preferredProvider: "anthropic",
        systemPrompt: assembled.systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: PLANNER_TEMPERATURE,
        maxTokens: PLANNER_MAX_OUTPUT_TOKENS,
        jsonMode: true,
        functionName: "agentory-planner",
        workspaceId: input.workspaceId,
      }),
      timeoutMs,
      () => ({
        ok: false, content: "", provider: "none" as const, model: "",
        error: "planner_timeout", errorCode: "timeout", latencyMs: timeoutMs,
      }),
    );

  let res = await call(assembled.userMessage);
  if (!res.ok) {
    const status: PlannerStatus = res.errorCode === "timeout" ? "fallback_timeout" : "fallback_provider_error";
    return { ok: false, reason: status, diagnostics: baseDiag(status, { model: res.model, provider: res.provider }) };
  }

  let parsed = parsePlannerResponse<TStrategy>(res.json, input.validateStrategy);
  let repairAttempted = false;

  // ONE repair, and never for an injection finding.
  if (!parsed.ok && parsed.status !== "fallback_injection") {
    repairAttempted = true;
    const repairMessage = [
      assembled.userMessage,
      "",
      "<repair_request>",
      `Your previous response was rejected: ${parsed.problem}.`,
      "Return the SAME plan, corrected to match <output_schema> exactly.",
      "Return ONLY the JSON object. Do not add fields. Do not explain.",
      "</repair_request>",
    ].join("\n");

    res = await call(repairMessage);
    if (!res.ok) {
      const status: PlannerStatus = res.errorCode === "timeout" ? "fallback_timeout" : "fallback_provider_error";
      return {
        ok: false, reason: status,
        diagnostics: baseDiag(status, { model: res.model, provider: res.provider, repair_attempted: true }),
      };
    }
    parsed = parsePlannerResponse<TStrategy>(res.json, input.validateStrategy);
  }

  if (!parsed.ok) {
    return {
      ok: false, reason: parsed.status,
      diagnostics: baseDiag(parsed.status, { model: res.model, provider: res.provider, repair_attempted: repairAttempted }),
    };
  }

  // Hash the BOUNDED envelope, not the raw response: the bounded value is what any
  // downstream consumer actually sees.
  const outputHash = await sha256Hex(canonicalJson(parsed.envelope));
  return {
    ok: true,
    envelope: parsed.envelope,
    diagnostics: baseDiag(repairAttempted ? "repaired" : "ok", {
      model: res.model, provider: res.provider,
      output_hash: outputHash, repair_attempted: repairAttempted,
      token_usage: res.usage,
    }),
  };
}
