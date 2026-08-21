// ONE CHAT-COMPLETIONS BODY, TWO MODEL FAMILIES.
//
// ── THE WALL THIS EXISTS TO REMOVE ──────────────────────────────────────────
//
// Agentory speaks to OpenAI down two independent transports, and they disagree
// about what a request looks like:
//
//   gptProvider          temperature: 0, max_tokens, no reasoning_effort
//   leadStrategy/shared  reasoning_effort: "none", max_completion_tokens
//
// That was not an accident of style. `adapters/shared.ts` says why:
//
//     "`reasoning_effort: "none"` is required by the gpt-5.6-* chat models.
//      `max_tokens` / non-default `temperature` are rejected by GPT-5 models;
//      only `max_completion_tokens` may cap the response."
//
// So the two bodies encode two model families, and the transport that carries
// mission compilation, discovery selection and execution planning can only
// speak to gpt-4.1. Pointing it at `gpt-5.6-luna` would 400 every request —
// which is the real reason those three stages were never moved, and no comment
// anywhere said so.
//
// The routing question cannot be decided while the answer is unreachable from
// half the system. This makes the body a function of the MODEL rather than of
// which file you happen to be in.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
//
// It changes no model and no effort. Every existing caller produces the same
// body it produced before — there is a test that asserts the strategist's is
// byte-identical — because a capability change and a routing change arriving
// together is how you lose the ability to say which one broke something.
//
// PURE. No network, no clock, no environment.

export const MODEL_REQUEST_BODY_VERSION = "model-request-body-v1" as const;

/**
 * Does this model take the GPT-5 request shape?
 *
 * Matched on the family prefix rather than an allow-list of ids, because the
 * failure mode of a missing id is a 400 on every call to a model somebody just
 * added, and the failure mode of an over-broad match is a parameter omitted
 * from a model that would have accepted it. The second is survivable.
 *
 * Both id shapes reach here — `gpt-5.6-luna` and `openai/gpt-5.6-luna` — so the
 * vendor prefix is stripped first.
 */
export function usesGpt5RequestShape(model: string): boolean {
  const bare = String(model ?? "").trim().toLowerCase().replace(/^[a-z0-9_-]+[/:]/i, "");
  return bare.startsWith("gpt-5") || bare.startsWith("o1") || bare.startsWith("o3");
}

/** How hard the model should think. `null` omits the field entirely. */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ChatBodyInput {
  model: string;
  systemPrompt: string;
  userMessage: string;
  /**
   * The cap on generated tokens.
   *
   * ONE FIELD, TWO WIRE NAMES. GPT-5 rejects `max_tokens` outright; gpt-4.1
   * does not know `max_completion_tokens`. A caller says how many tokens it
   * wants and this decides what to call it, which is the entire reason a caller
   * should not be writing this body by hand.
   */
  maxOutputTokens?: number | null;
  /**
   * Sent only to models that accept it, and only when non-null.
   *
   * gpt-4.1 has no such parameter; sending one is a 400. GPT-5 chat models
   * REQUIRE it. So "omit" and "none" are different instructions and the type
   * keeps them apart.
   */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * Omitted for GPT-5, which rejects any non-default value.
   *
   * Determinism is not lost by this: the GPT-5 chat models are effectively
   * greedy at `reasoning_effort: "none"`, and the callers that cared about
   * `temperature: 0` are the ones still on gpt-4.1.
   */
  temperature?: number | null;
  /** A strict JSON Schema. Without one the body asks for `json_object`. */
  schema?: { name: string; schema: Record<string, unknown> } | null;
}

/**
 * The exact body to POST to /v1/chat/completions.
 *
 * Field ORDER is preserved per family, because the strategist's body is
 * compared byte-for-byte in a test — the cheapest way to prove that unifying
 * two builders changed neither.
 */
export function buildChatCompletionsBody(i: ChatBodyInput): Record<string, unknown> {
  const messages = [
    { role: "system", content: i.systemPrompt },
    { role: "user", content: i.userMessage },
  ];
  const response_format = i.schema
    ? {
      type: "json_schema",
      json_schema: { name: i.schema.name, strict: true, schema: i.schema.schema },
    }
    : { type: "json_object" };

  if (usesGpt5RequestShape(i.model)) {
    return {
      model: i.model,
      messages,
      // REQUIRED by the gpt-5.6-* chat models. A caller that names no effort
      // gets `none`, which is what this pipeline has always sent on the path
      // that already speaks to them — not a new default invented here.
      reasoning_effort: i.reasoningEffort ?? "none",
      ...(i.maxOutputTokens ? { max_completion_tokens: i.maxOutputTokens } : {}),
      response_format,
      // NO `temperature`. Not "defaulted to 1" — omitted. A non-default value
      // is rejected outright, and sending the default is a field that can only
      // ever cost a round trip.
    };
  }

  return {
    model: i.model,
    temperature: i.temperature ?? 0,
    ...(i.maxOutputTokens ? { max_tokens: i.maxOutputTokens } : {}),
    messages,
    response_format,
    // NO `reasoning_effort`. gpt-4.1 has no such parameter and rejects it, so a
    // caller that names an effort for a 4.1 model is recorded in telemetry and
    // not sent — the effort is a routing FACT, and the body is a wire detail.
  };
}
