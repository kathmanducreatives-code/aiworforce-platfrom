// LEAD V2 P5 — GPT EXPLAINS A LEAD IT CANNOT PROMOTE.
//
// One batched call for the candidates code has already found eligible. The
// model sees, per candidate, the ceiling it may not exceed, the evidence items
// it may cite (id, dimension, value, source) and the gaps code has already
// listed. It returns a label and one or two sentences per candidate, each
// citing evidence ids.
//
// EVERYTHING IT RETURNS IS VALIDATED by `applyReasoning`: the label is capped
// at the ceiling, a sentence citing an id this candidate does not have is
// deleted, and a label whose sentences all die drops a level. So the worst a
// bad answer can do is leave a lead with a weaker explanation than it deserved
// — never a wrong label, never a hidden gap, never an invented fact.
//
// Absent (no key, flag off, call failed) the system is unchanged: the ceiling
// stands as the label and code writes the reasons.

import { gptStructured, type GptDeps } from "./gptProvider.ts";
import { routeModel, type ModelRoute } from "./gptModelRouter.ts";
import type { CompanyEvidenceGraph } from "./evidenceGraph.ts";
import type { CeilingResult } from "./opportunityLabel.ts";

export const REASONER_MAX_CANDIDATES = 10;

export const REASONER_SCHEMA = {
  name: "opportunity_reasoning",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company_key", "label", "why_surfaced"],
          properties: {
            company_key: { type: "string" },
            label: { type: "string", enum: ["exact_match", "strong_opportunity", "worth_considering", "low_priority"] },
            why_surfaced: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text", "evidence_ids"],
                properties: {
                  text: { type: "string", description: "One sentence a salesperson can act on. No adjectives you cannot cite." },
                  evidence_ids: { type: "array", items: { type: "string" }, description: "Ids from this candidate's citable list. A sentence with none is deleted." },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const REASONER_SYSTEM = [
  "You explain why each company surfaced for a B2B lead research mission.",
  "For every candidate you are given a ceiling — the highest label its evidence supports — the evidence you may cite, and the gaps code has already identified.",
  "Choose a label AT OR BELOW the ceiling. Choosing lower is right when the evidence is thin; choosing higher is impossible and will be capped.",
  "Write one or two sentences per candidate. Every sentence must cite evidence ids from that candidate's citable list; a sentence citing nothing real is deleted, and a candidate whose sentences are all deleted loses a level.",
  "Never claim a fact the evidence does not contain, never restate a headcount or a range as something more precise, and never mention a gap as if it were satisfied — the missing list is written by code and travels with the lead whatever you say.",
].join("\n");

export interface ReasonerCandidate {
  company_key: string;
  name: string | null;
  ceiling: CeilingResult;
  graph: CompanyEvidenceGraph;
}

/** What the model sees. Evidence only — no raw provider payloads, no contacts. */
export function reasonerPayload(i: {
  request: string; candidates: readonly ReasonerCandidate[];
}): Record<string, unknown> {
  return {
    request: i.request,
    candidates: i.candidates.slice(0, REASONER_MAX_CANDIDATES).map((c) => ({
      company_key: c.company_key,
      company: c.name,
      ceiling: c.ceiling.ceiling,
      evidence_coverage: c.ceiling.evidence_coverage,
      missing_evidence: c.ceiling.missing_evidence,
      citable_evidence: c.graph.claims
        .filter((x) => x.current)
        .map((x) => ({
          evidence_id: x.current!.evidence_id, dimension: x.dimension, value: x.current!.value,
          status: x.current!.status, source: x.current!.source.actor, url: x.current!.source.url,
        }))
        .filter((x) => c.ceiling.citable_ids.includes(x.evidence_id)),
    })),
  };
}

export type ReasonerProposals = Record<string, { label?: unknown; why_surfaced?: unknown }>;

/** Proposals by company key. Unknown keys are dropped; nothing else is trusted here. */
export function parseReasonerResult(raw: unknown, known: ReadonlySet<string>): ReasonerProposals {
  const out: ReasonerProposals = {};
  const list = (raw as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) return out;
  for (const c of list) {
    const r = c as { company_key?: unknown; label?: unknown; why_surfaced?: unknown };
    const key = typeof r?.company_key === "string" ? r.company_key : "";
    if (!key || !known.has(key)) continue;
    out[key] = { label: r.label, why_surfaced: r.why_surfaced };
  }
  return out;
}

export function makeGptOpportunityReasoner(deps: GptDeps = {}, ctx: { onRoute?: (r: ModelRoute) => void } = {}) {
  return async (i: { request: string; candidates: readonly ReasonerCandidate[] }): Promise<ReasonerProposals> => {
    const candidates = i.candidates.slice(0, REASONER_MAX_CANDIDATES);
    if (candidates.length === 0) return {};
    const route = routeModel("opportunity_reasoning", { batch_size: candidates.length });
    ctx.onRoute?.(route);
    const r = await gptStructured<Record<string, unknown>>({
      purpose: route.stage,
      system: REASONER_SYSTEM,
      user: JSON.stringify(reasonerPayload({ request: i.request, candidates })),
      schema: REASONER_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 1200,
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
    }, deps);
    if (!r.ok) {
      (deps.log ?? (() => {}))("gpt_opportunity_reasoner_failed", { code: r.code, detail: r.detail });
      return {};
    }
    return parseReasonerResult(r.value, new Set(candidates.map((c) => c.company_key)));
  };
}
