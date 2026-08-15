// EVALUATE EVERY ELIGIBLE COMPANY, IN BOUNDED BATCHES, WITHOUT MIXING THEM UP.
//
// WHAT THIS REPLACES.
//
// The classifier ran one company per model call and stopped after about ten.
// A run that discovered forty companies therefore judged a quarter of them and
// silently returned the rest unevaluated, ordered by a deterministic sort that
// had never read a description. "We found 40 companies" and "we assessed 40
// companies" were being reported as the same sentence.
//
// THE RISK BATCHING INTRODUCES, AND THE ANSWER TO IT.
//
// Putting ten companies in one prompt invites the model to explain company C
// using company A's evidence — and because every claim cites an evidence id,
// and every id encodes its own company, that borrowing is DETECTABLE rather
// than plausible-looking. `verifyGroundedResult` already refuses a foreign id;
// this module additionally refuses a whole result whose `company_key` does not
// belong to the batch, and detects results that are missing or duplicated.
//
// ONE BAD COMPANY DOES NOT SPOIL A BATCH. A malformed or unattributable result
// downgrades THAT company to review and leaves the other nine intact — a batch
// is a transport optimisation, not a unit of correctness.
//
// PURE. No network, provider, model or database access.

import {
  CLAIM_TYPES, parseGroundedResult, verifyGroundedResult,
  type GroundedClassifierResult, type GroundedVerification,
} from "./groundedClaims.ts";
import {
  hardFactsForPrompt, registryForPrompt, type EvidenceRegistry,
} from "./leadEvidenceRegistry.ts";

export const BATCH_EVALUATION_VERSION = "grounded-batch-evaluation-v1" as const;

/** Server-side defaults. NEVER accepted from the browser. */
export const DEFAULT_BATCH_SIZE = 8;
export const MAX_BATCH_SIZE = 10;
export const DEFAULT_MAX_EVALUATED = 100;

export interface BatchLimits {
  batch_size: number;
  max_evaluated: number;
}

/** Clamp whatever was configured into what the system will actually honour. */
export function resolveBatchLimits(i: {
  batch_size?: number | null; max_evaluated?: number | null;
} = {}): BatchLimits {
  const b = Number(i.batch_size);
  const m = Number(i.max_evaluated);
  return {
    batch_size: Number.isFinite(b) && b >= 1
      ? Math.min(Math.trunc(b), MAX_BATCH_SIZE) : DEFAULT_BATCH_SIZE,
    max_evaluated: Number.isFinite(m) && m >= 1
      ? Math.min(Math.trunc(m), DEFAULT_MAX_EVALUATED) : DEFAULT_MAX_EVALUATED,
  };
}

export interface BatchMember {
  company_key: string;
  company_name: string | null;
  registry: EvidenceRegistry;
  requiresCommercialSignal: boolean;
}

export type BatchFailureReason =
  | "missing_from_response"
  | "duplicate_in_response"
  | "unknown_company_key"
  | "malformed_result";

export interface BatchOutcome {
  company_key: string;
  verification: GroundedVerification | null;
  failure: BatchFailureReason | null;
  detail: string | null;
}

export interface BatchResult {
  version: typeof BATCH_EVALUATION_VERSION;
  outcomes: BatchOutcome[];
  /** Results the model returned for companies that were not in this batch. */
  foreign_results: string[];
  evaluated: number;
  failed: number;
}

/**
 * The payload for one batch.
 *
 * Every company carries ITS OWN registry, keyed by company. There is no shared
 * evidence section, so there is no place from which a model could draw a fact
 * about one company while writing about another and have it look legitimate.
 */
export function buildBatchPayload(i: {
  batch: readonly BatchMember[];
  originalUserQuery: string | null;
  missionDirectives?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    schema_version: BATCH_EVALUATION_VERSION,
    instruction: BATCH_EVALUATION_PROMPT,
    mission: {
      original_user_query: i.originalUserQuery,
      ...(i.missionDirectives ?? {}),
    },
    companies: i.batch.map((m) => ({
      company_key: m.company_key,
      company_name: m.company_name,
      requires_current_commercial_signal: m.requiresCommercialSignal,
      established_facts: hardFactsForPrompt(m.registry.hard_facts),
      evidence: registryForPrompt(m.registry),
    })),
    // ── THE CLAIM SHAPE IS PART OF THE CONTRACT ───────────────────────────
    //
    // `claims` and `supporting_claims` used to be shown as bare `[]`, with the
    // prose instruction to "cite evidence_ids and quote a short excerpt" and
    // nothing anywhere naming the FIELDS that carry them. The model returned
    // what the shape showed it: empty arrays. Every run therefore verified zero
    // claims, `grounding_score` was structurally always 0, and no company could
    // ever be grounded — the verifier could not refute anything because it was
    // never given anything to check.
    //
    // The item schema is written out here, with the claim-type vocabulary and
    // the excerpt/evidence pairing, because a verifier that cannot receive a
    // claim is not a verifier.
    response_shape: {
      results: [{
        company_key: "must match one of the supplied company_key values",
        business_model: {
          value: "string", confidence: "number", claims: [CLAIM_SHAPE],
        },
        company_fit: "pass|review|fail",
        agentory_use_case: "strong|plausible|weak|none",
        mission_signal_assessment: {
          strongest_signal: "string|null",
          signal_strength: "strong|moderate|weak|none",
          evidence_ids: [], reason: "string",
        },
        supporting_claims: [CLAIM_SHAPE],
        conflicting_evidence_ids: [], missing_evidence: [], unknown_fields: [],
        confidence: "number", reason: "string",
      }],
    },
  };
}

/**
 * ONE CLAIM, as `parseClaims`/`verifyGroundedResult` expect to receive it.
 *
 * Every field is the one the verifier actually reads: a mis-named key here is
 * indistinguishable, downstream, from the model declining to make a claim.
 */
export const CLAIM_SHAPE = Object.freeze({
  claim: "one specific, checkable statement about THIS company",
  claim_type: CLAIM_TYPES.join("|"),
  evidence_ids: ["evidence_id values from this company's evidence list"],
  evidence_excerpts: [{
    evidence_id: "one of the ids above",
    excerpt: "a SHORT verbatim substring copied from that item's source_text",
  }],
});

export const BATCH_EVALUATION_PROMPT = [
  "You assess several companies in one request. Judge each one SEPARATELY.",
  "Each company has its own evidence list. Never use one company's evidence to",
  "support a statement about another — evidence ids encode their company and a",
  "borrowed id is detected and discarded.",
  "Return exactly one result per supplied company_key, and no others.",
  "Every material claim must cite evidence_ids and quote a short verbatim excerpt",
  "from that item's source_text.",
  // WITHOUT THIS, `company_fit: pass` and `supporting_claims: []` is a
  // well-formed response — and it is the one that was returned every time,
  // leaving the verifier nothing to check and the company ungroundable.
  "A 'pass' REQUIRES at least one supporting_claims entry. If you cannot cite",
  "evidence for a claim, do not make the claim — answer 'review' instead.",
  "Copy excerpts character-for-character from source_text; a paraphrase does not",
  "match and the claim is discarded.",
  "Never invent a company fact. Never restate a supplied number, job title or",
  "location differently.",
  "Absence of evidence is unknown; it is never proof that something is false.",
  "A failed data provider means UNRESOLVED, never 'the company is not hiring'.",
  "Return 'review' when evidence is insufficient — that is the correct answer.",
  "You do not choose data providers, tools or Actors, and you never name one.",
  "Return only the requested JSON object. Do not explain your reasoning process.",
].join(" ");

/**
 * Read a batch response, attribute each result, and verify every claim.
 *
 * ATTRIBUTION BEFORE VERIFICATION. A result is matched to its company by
 * `company_key` and verified against THAT company's registry — never against
 * whichever registry happens to be first. A result naming a company outside the
 * batch is recorded as foreign and discarded rather than being matched by
 * position, which is how an off-by-one would attach one company's judgement to
 * another's row.
 */
export function evaluateBatchResponse(i: {
  batch: readonly BatchMember[];
  raw: unknown;
  groundingThreshold?: number;
}): BatchResult {
  const byKey = new Map(i.batch.map((m) => [m.company_key, m]));
  const outcomes: BatchOutcome[] = [];
  const foreign: string[] = [];
  const seen = new Set<string>();

  const rows = readResultRows(i.raw);

  for (const row of rows) {
    const key = typeof row?.company_key === "string" ? row.company_key.trim() : "";
    if (!key || !byKey.has(key)) {
      if (key) foreign.push(key);
      continue;
    }
    if (seen.has(key)) {
      // A SECOND OPINION ON THE SAME COMPANY IS NOT MORE INFORMATION. Which of
      // the two is right is unknowable here, so neither is trusted.
      const existing = outcomes.find((o) => o.company_key === key);
      if (existing) {
        existing.verification = null;
        existing.failure = "duplicate_in_response";
        existing.detail = "the model returned more than one result for this company";
      }
      continue;
    }
    seen.add(key);
    const member = byKey.get(key)!;
    try {
      const parsed: GroundedClassifierResult = parseGroundedResult(row);
      const verification = verifyGroundedResult({
        registry: member.registry,
        result: parsed,
        requiresCommercialSignal: member.requiresCommercialSignal,
        ...(i.groundingThreshold != null
          ? { groundingThreshold: i.groundingThreshold } : {}),
      });
      outcomes.push({ company_key: key, verification, failure: null, detail: null });
    } catch (e) {
      // ONE COMPANY'S MALFORMED RESULT DOES NOT DISCARD THE BATCH.
      outcomes.push({
        company_key: key, verification: null, failure: "malformed_result",
        detail: String(e).slice(0, 200),
      });
    }
  }

  // Companies the model simply did not answer about.
  for (const m of i.batch) {
    if (seen.has(m.company_key)) continue;
    outcomes.push({
      company_key: m.company_key, verification: null,
      failure: "missing_from_response",
      detail: "the model returned no result for this company",
    });
  }

  return {
    version: BATCH_EVALUATION_VERSION,
    outcomes,
    foreign_results: [...new Set(foreign)],
    evaluated: outcomes.filter((o) => o.verification !== null).length,
    failed: outcomes.filter((o) => o.verification === null).length,
  };
}

/** Accept `{results:[…]}`, a bare array, or a `{companies:[…]}` variant. */
function readResultRows(raw: unknown): Array<Record<string, unknown>> {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (Array.isArray(o)) return o.filter(isObj);
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["results", "companies", "evaluations"]) {
      if (Array.isArray(r[k])) return (r[k] as unknown[]).filter(isObj);
    }
  }
  return [];
}
function isObj(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Split the eligible pool into batches, honouring the evaluation ceiling. */
export function planBatches<T>(
  eligible: readonly T[], limits: BatchLimits,
): { batches: T[][]; evaluated_cap: number; beyond_cap: number } {
  const capped = eligible.slice(0, limits.max_evaluated);
  const batches: T[][] = [];
  for (let i = 0; i < capped.length; i += limits.batch_size) {
    batches.push(capped.slice(i, i + limits.batch_size));
  }
  return {
    batches,
    evaluated_cap: capped.length,
    beyond_cap: Math.max(0, eligible.length - capped.length),
  };
}
