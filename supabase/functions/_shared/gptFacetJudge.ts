// ARM B — OUR OWN MODEL, ASKED THE SAME FIXED QUESTIONS.
//
// The benchmark exists to answer one question before Jev gets anything: is Jev
// better, or would asking the model we already run the SAME narrow questions —
// snippet ids instead of copied quotes, one independent verdict per facet —
// have fixed the same problems? Without this arm, a win for Jev could just be
// a win for the question format.
//
// Same facet definitions, same verdict vocabulary, same snippet set and the
// same deterministic validation (`validateFacetAnswers`) as Jev. The only
// differences are the transport and that JSON lets it cite several ids.
//
// Through `gptStructured`, so it is metered by the existing seam under its own
// role. NOT wired into production in Phase 1 — the shadow runs Jev only; this
// arm is for the benchmark harness.

import { gptStructured, type GptDeps } from "./gptProvider.ts";
import type { ReasoningEffort } from "./modelRequestBody.ts";
import {
  ATTESTED_FACETS, EVIDENCE_IS_DATA, FACET_DEFINITIONS, FACET_VERDICTS, VERDICT_DEFINITIONS,
  type AttestedFacet, type RawFacetAnswers,
} from "./facetAttestation.ts";
import type { FacetJudge, JudgeOutcome } from "./jevProvider.ts";

export const GPT_FACET_ROLE = "facet_attestation_gpt";

export const GPT_FACET_SYSTEM = [
  "You answer fixed questions about a company's business model from supplied evidence snippets.",
  EVIDENCE_IS_DATA,
  "For each facet answer exactly one verdict: " +
    FACET_VERDICTS.map((v) => `${v} (${VERDICT_DEFINITIONS[v]})`).join("; ") + ".",
  "Cite snippets ONLY by their snippet ids, exactly as given. Never quote or paraphrase text.",
  "A verdict of states needs at least one supporting snippet id; contradicts needs at least one contradicting id.",
  "Return only the requested JSON object.",
].join(" ");

function facetSchema(facets: readonly AttestedFacet[]) {
  const one = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "supporting_snippet_ids", "contradicting_snippet_ids", "confidence"],
    properties: {
      verdict: { type: "string", enum: [...FACET_VERDICTS] },
      // Plain strings, not an enum of ids: an id the model invents must reach
      // the validator and be COUNTED, not be silently prevented by the schema.
      supporting_snippet_ids: { type: "array", items: { type: "string" } },
      contradicting_snippet_ids: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
  };
  return {
    name: "facet_attestation",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["facets"],
      properties: {
        facets: {
          type: "object",
          additionalProperties: false,
          required: [...facets],
          properties: Object.fromEntries(facets.map((f) => [f, one])),
        },
      },
    },
  };
}

/** Six facets of JSON fit easily; a cap keeps a runaway answer from being a runaway bill. */
export const GPT_FACET_MAX_OUTPUT_TOKENS = 2000;

export function gptFacetJudge(i: {
  model: string;
  deps?: GptDeps;
  /**
   * Defaults to `none` — the effort the CURRENT grounder is routed at
   * (`grounded_evidence_evaluation`), so arm B differs from arm A only in the
   * question format, never in how hard the model is allowed to think.
   */
  reasoningEffort?: ReasoningEffort | null;
  maxOutputTokens?: number;
}): FacetJudge {
  return async ({ snippets, facets = ATTESTED_FACETS }): Promise<JudgeOutcome> => {
    if (snippets.snippets.length === 0) {
      return { ok: false, failure: "no_snippets", detail: "no evidence to judge", latency_ms: 0, telemetry: null };
    }
    const user = JSON.stringify({
      company: snippets.company_name ?? null,
      facets: Object.fromEntries(facets.map((f) => [f, FACET_DEFINITIONS[f]])),
      evidence_snippets: Object.fromEntries(snippets.snippets.map((s) => [s.snippet_id, s.text])),
    });
    const res = await gptStructured<{ facets?: Record<string, Record<string, unknown>> }>({
      purpose: GPT_FACET_ROLE,
      system: GPT_FACET_SYSTEM,
      user,
      schema: facetSchema(facets),
      temperature: 0,
      model: i.model,
      reasoningEffort: i.reasoningEffort ?? "none",
      maxTokens: i.maxOutputTokens ?? GPT_FACET_MAX_OUTPUT_TOKENS,
      routing_reason: "facet attestation benchmark arm",
    }, i.deps ?? {});
    if (!res.ok) {
      return {
        ok: false,
        failure: res.code === "no_api_key" ? "no_api_key"
          : res.code === "transport_error" ? "network"
          : res.code === "http_error" || res.code === "quota_exhausted" ? (res.retryable ? "rate_limited" : "http_error")
          : "malformed_response",
        detail: res.detail, latency_ms: res.latency_ms, telemetry: null,
      };
    }
    const f = res.value?.facets;
    if (!f || typeof f !== "object") {
      return { ok: false, failure: "malformed_response", detail: "no facets object", latency_ms: res.latency_ms, telemetry: res.telemetry ?? null };
    }
    const answers: RawFacetAnswers = {};
    for (const facet of facets) {
      const a = f[facet];
      if (!a || typeof a !== "object") continue;
      answers[facet] = {
        verdict: a.verdict,
        support: a.supporting_snippet_ids,
        contradiction: a.contradicting_snippet_ids,
        confidence: a.confidence,
        probabilities: null,
      };
    }
    return {
      ok: true, answers, model: res.model, latency_ms: res.latency_ms,
      telemetry: res.telemetry!, request_id: null,
    };
  };
}
