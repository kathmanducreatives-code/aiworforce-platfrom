// THE FIRST READ OF WHAT THE USER WANTS.
//
// ── WHAT THIS OWNS, AND WHAT IT MUST NOT ───────────────────────────────────
//
// GPT owns semantic understanding: which of six objectives an arbitrary
// sentence expresses, what it is about, what evidence it requires, and what it
// leaves unclear. That is a judgement about language, and it is the one thing
// deterministic code has repeatedly failed at here — three classifiers,
// ~1,780 lines, and "who's building out their sales org?" still does not route.
//
// Deterministic code owns everything that follows. This module returns a
// `RequestV1` and nothing else. It does not choose providers, decide
// feasibility, grant spend authority, resolve identity or touch the database.
// `parseRequestStrict` hard-codes the most important half of that boundary:
// whatever the model says about `authority`, the parsed request comes back
// with `may_spend: false`, because permission is workspace policy and a user's
// confirmation, never a model's opinion.
//
// ── NO KEYWORD DICTIONARIES ────────────────────────────────────────────────
//
// There is no phrase table in this file and there must never be one. The
// existing classifiers are regex-first with a model fallback, which is exactly
// why they generalise so poorly: every unseen phrasing is a new patch. The
// prompt below teaches the DISTINCTIONS — what separates reading from
// researching, researching from sourcing — and lets the model apply them to
// wording nobody anticipated.
//
// The distinction that costs money is stated first and repeated, because it is
// the one that must never be got wrong:
//
//   read      answers from evidence already held        spends nothing
//   research  fresh check of an entity the user NAMED   one scoped paid call
//   source    discovery of entities nobody has named    full discovery spend
//
// ── AND WHY A REFUSAL IS A GOOD OUTCOME ────────────────────────────────────
//
// A malformed answer degrades to a clarification, never to a guess. The repair
// pass exists for answers whose SHAPE was wrong; an answer that is confidently
// wrong about the objective is not repairable, and the ambiguity channel is how
// the model says so. `blocking: true` on an unresolved referent stops execution
// rather than picking an entity, because spending against the wrong company is
// the most expensive mistake this system can make.

import {
  gptStructured, type GptDeps, type GptResult,
} from "./gptProvider.ts";
import { routeModel, type ModelRoute } from "./gptModelRouter.ts";
import { SIGNAL_EVENTS, SIGNAL_SUBJECTS } from "./missionSignalDescriptor.ts";
import { REQUEST_OBJECTIVES, REQUEST_ENTITIES, type RequestV1 } from "./requestV1.ts";
import {
  parseRequestStrict, type ParseViolation,
} from "./requestV1Parser.ts";

export const CHAT_BRAIN_VERSION = "chat-brain-v1" as const;

/**
 * WHAT THE MODEL IS TOLD, AND WHY EACH PART IS THERE.
 *
 * Definitions, not examples. A prompt built from examples teaches the examples;
 * this one states the distinctions and requires the model to apply them.
 */
const SYSTEM = `You read a user's message to a B2B sales-intelligence assistant and state what they are asking for.

You decide MEANING only. You never choose tools, never decide what is possible, and never grant permission to spend money. Other systems do that using what you return.

OBJECTIVES — pick exactly one per part.

converse  They want your opinion, judgement, explanation, or ordinary conversation. No work product is expected. Questions ABOUT their strategy, their ICP, your reasoning, or costs are converse.
read      They are asking about evidence the system ALREADY HOLD - past runs, saved leads, recorded signals, things they are already watching. Answering costs nothing and reaches no external source.
research  They want a FRESH check on a specific entity they have NAMED or clearly referred to. One targeted investigation.
source    They want to DISCOVER entities nobody has named yet, matching a description. This is the expensive one.
monitor   They want observation to continue into the FUTURE, or to recur.
compose   They want content produced - a post, a draft, hooks, angles.

THE DISTINCTION THAT MATTERS MOST:
- If the message names or points at a specific entity and asks something fresh about it, that is research.
- If it describes a KIND of entity to go and find, that is source.
- If it asks about what the system already knows or already found, that is read.
Phrasing does not decide this. "Show me", "find", "what", "who" appear in all three. Ask instead: does answering require going and looking, and at something already named or something not yet identified?

If answering only requires ranking, filtering, selecting or summarising things the system has already produced or recorded, that is read - even when the wording sounds like a fresh search. Superlatives over the user's own data ("the strongest", "the best", "the most recent", "the top") select from what is already held; they do not ask for new discovery.

EVERY PART IS JUDGED ON ITS OWN. In a message with several asks, decide each part's objective independently, by what THAT ask needs. Do not let a later expensive ask pull an earlier cheap one up to match it: "look at what I have, then go find more" is read followed by source, not source twice.

ENTITY: ${REQUEST_ENTITIES.join(", ")}.
"competitor" means a rival of the USER'S OWN business - "who are my competitors", "what are my competitors posting". A named company the user is researching for its own sake is "company", not "competitor".
"market" means a category, topic or problem space rather than a specific organisation - an industry, a trend, "what's happening in AI recruiting". A question about a NAMED company is research on a company, not on a market.
"approval" means a draft or action waiting for the user to approve it - "what needs my sign-off", "anything waiting on me to approve", "show me pending approvals". It is not the same as "content", which is what has been written.

REFERENCES — what the message points at. Pick the kind by WHERE the thing lives, not by how it is worded.
named         The user's own words for a specific thing: "Vercel", "acme.com", a URL they pasted.
saved_set     A durable collection in their workspace that exists independently of this conversation: "my leads", "my ICP", "the companies I'm watching", "my pipeline", "the ones I saved". Possessives about their own stored data are almost always this.
prior_result  Something YOU showed them earlier IN THIS CONVERSATION, referred to by position or pronoun: "them", "that one", "the second company", "the third". Use this ONLY when the message points back at a list or result from an earlier turn of this same conversation.

The difference matters: prior_result is resolved against what was displayed in this chat, and nothing else. If you mark a durable workspace collection as prior_result, the request is refused with a question about which company was meant. When the user is talking about their own saved data rather than something you just showed them, it is saved_set.
A message with no earlier turn to point back to cannot contain a prior_result.

REQUIREMENTS are evidence that must hold. Use ONLY these events: ${SIGNAL_EVENTS.join(", ")}.
Subjects: ${SIGNAL_SUBJECTS.join(", ")}.
Put the user's own words for a role in qualifier.role_terms, verbatim - not a normalised form. Their words decide what counts as evidence.
If the message requires evidence you have no event for, do not force it into a near-miss event. Leave requirements empty and record it as ambiguity.

FILTERS narrow a population: industry, business_model, geography, employee_count, stage, company_name, role. employee_count takes {min,max}. Only include what the message actually states. Do not infer a geography or an industry the user did not say.

OUTPUT shape: records (a list of entities), events (signal activity), answer (prose), artifact (content).
count is the number they asked for, or null if they named none. Never invent a number.

AMBIGUITY: anything you could not settle.
blocking = true when acting on the wrong reading could target the wrong entity or spend money wrongly - an unresolved "them", "that one", "the second company". Refusing to guess is correct; guessing is not.
blocking = false when the vagueness only makes a result set wider or narrower.

MIXED MESSAGES: one message can contain several asks. Emit one part per ask, and set depends_on when a later part needs an earlier one's results.

Return only JSON matching the schema.`;

// ── THE MODEL-FACING SCHEMA IS STRICTER THAN `RequestV1` ──────────────────
//
// Structured outputs require every property to declare a concrete `type`, every
// object to set `additionalProperties: false`, and `required` to list EVERY
// key — optional fields are expressed as nullable types, not omitted ones.
//
// `RequestFilter.value` is `unknown` in the universal contract because a filter
// value legitimately varies: a list of industries, a {min,max} headcount, a
// name. That cannot be expressed to the model, which rejected the first schema
// outright. So the wire shape splits it into two typed fields — `values` for
// lists and `range` for bounds — and the parser folds them back into `value`.
// The universal contract does not bend to the wire format; the wire format
// carries what the contract needs.
const nullableStr = { type: ["string", "null"] };
const strList = { type: "array", items: { type: "string" } };

const RESPONSE_SCHEMA = {
  name: "request_understanding",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["parts", "ambiguity", "confidence"],
    properties: {
      parts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "objective", "subject", "requirements", "output", "depends_on"],
          properties: {
            id: { type: "string" },
            objective: { type: "string", enum: [...REQUEST_OBJECTIVES] },
            subject: {
              type: "object",
              additionalProperties: false,
              required: ["entity", "references", "filters"],
              properties: {
                entity: { type: "string", enum: [...REQUEST_ENTITIES] },
                references: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["kind", "value"],
                    properties: {
                      kind: { type: "string", enum: ["named", "saved_set", "prior_result"] },
                      value: { type: "string" },
                    },
                  },
                },
                filters: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["field", "op", "values", "range"],
                    properties: {
                      field: { type: "string" },
                      op: { type: "string", enum: ["eq", "in", "range", "contains", "not"] },
                      /** For eq / in / contains / not. Empty when `range` is used. */
                      values: strList,
                      /** For range. Null when `values` is used. */
                      range: {
                        type: ["object", "null"],
                        additionalProperties: false,
                        required: ["min", "max"],
                        properties: {
                          min: { type: ["number", "null"] },
                          max: { type: ["number", "null"] },
                        },
                      },
                    },
                  },
                },
              },
            },
            requirements: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                required: ["event", "subject", "phrase", "recency_days", "qualifier"],
                properties: {
                  event: { type: "string", enum: [...SIGNAL_EVENTS] },
                  subject: { type: "string", enum: [...SIGNAL_SUBJECTS] },
                  phrase: { type: "string" },
                  recency_days: { type: ["number", "null"] },
                  qualifier: {
                    type: "object",
                    additionalProperties: false,
                    required: ["role_terms", "role_families", "topic", "region",
                      "round_type", "direction"],
                    properties: {
                      role_terms: strList,
                      role_families: strList,
                      topic: nullableStr,
                      region: nullableStr,
                      round_type: nullableStr,
                      direction: nullableStr,
                    },
                  },
                },
              },
            },
            output: {
              type: "object", additionalProperties: false,
              required: ["shape", "count"],
              properties: {
                shape: { type: "string", enum: ["records", "events", "answer", "artifact"] },
                count: { type: ["number", "null"] },
              },
            },
            depends_on: strList,
          },
        },
      },
      ambiguity: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["part_id", "field", "question", "blocking"],
          properties: {
            part_id: nullableStr,
            field: { type: "string" },
            question: { type: "string" },
            blocking: { type: "boolean" },
          },
        },
      },
      confidence: { type: "number" },
    },
  },
};

export interface ChatBrainContext {
  /** The durable workspace block — Company Brain, ICP, offer, buyers. C0. */
  workspaceContext?: string | null;
  /** Recent turns, oldest first. Bounded by the caller. */
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  onRoute?: (r: ModelRoute) => void;
  log?: (msg: string, meta?: unknown) => void;
}

export type ChatBrainOutcome =
  | { ok: true; request: RequestV1; repairs: string[]; repaired: boolean }
  | { ok: false; reason: "provider_failure" | "unreadable"; violations: ParseViolation[] };

function userPrompt(utterance: string, ctx: ChatBrainContext): string {
  const parts: string[] = [];
  if (ctx.workspaceContext) {
    // GROUNDING, NOT INSTRUCTION. The workspace block tells the model what "my
    // ICP" refers to; it must not become a source of requirements the user did
    // not ask for.
    parts.push(`WORKSPACE CONTEXT (for resolving what the user refers to — never a source of requirements they did not state):\n${ctx.workspaceContext}`);
  }
  const convo = (ctx.conversation ?? []).slice(-6);
  if (convo.length) {
    parts.push(`RECENT CONVERSATION:\n${convo.map((m) => `${m.role}: ${m.content}`).join("\n")}`);
  }
  parts.push(`MESSAGE:\n${utterance}`);
  return parts.join("\n\n");
}

/**
 * Read one message into a request.
 *
 * Two calls at most: the read, and a repair when the answer's SHAPE was wrong.
 * A second failure degrades to `unreadable`, which the caller turns into a
 * clarification — never into a default objective.
 */
export async function understandRequest(
  utterance: string, ctx: ChatBrainContext, deps: GptDeps,
): Promise<ChatBrainOutcome> {
  const log = ctx.log ?? (() => {});

  const attempt = async (stage: "request_understanding" | "request_understanding_repair",
    extra?: string) => {
    const route = routeModel(stage, {});
    ctx.onRoute?.(route);
    const r: GptResult<unknown> = await gptStructured<unknown>({
      purpose: route.stage,
      system: extra ? `${SYSTEM}\n\nYour previous answer was rejected: ${extra}\nReturn a corrected answer.` : SYSTEM,
      user: userPrompt(utterance, ctx),
      schema: RESPONSE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      maxTokens: 1500,
      model: route.model,
      reasoningEffort: route.reasoning_effort,
      tier: route.tier,
      routing_reason: route.reason,
    }, deps);
    return r;
  };

  const first = await attempt("request_understanding");
  if (!first.ok) {
    log("chat_brain_provider_failed", { code: first.code, detail: first.detail });
    return { ok: false, reason: "provider_failure", violations: [] };
  }

  const parsed = parseRequestStrict(first.value, utterance);
  if (parsed.request) {
    log("chat_brain_understood", {
      objective: parsed.request.objective, parts: parsed.request.parts.length,
      repairs: parsed.repairs.length,
    });
    return { ok: true, request: parsed.request, repairs: parsed.repairs, repaired: false };
  }

  // THE SHAPE WAS WRONG. One repair, told exactly what failed.
  log("chat_brain_rejected", { violations: parsed.violations });
  const second = await attempt("request_understanding_repair", parsed.violations.join(", "));
  if (!second.ok) {
    return { ok: false, reason: "provider_failure", violations: parsed.violations };
  }
  const reparsed = parseRequestStrict(second.value, utterance);
  if (reparsed.request) {
    return { ok: true, request: reparsed.request, repairs: reparsed.repairs, repaired: true };
  }
  log("chat_brain_unreadable", { violations: reparsed.violations });
  return { ok: false, reason: "unreadable", violations: reparsed.violations };
}
