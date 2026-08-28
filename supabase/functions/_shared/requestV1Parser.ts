// READING THE MODEL'S ANSWER, OR REFUSING IT.
//
// ── WHY THIS IS SEPARATE FROM THE PROMPT ───────────────────────────────────
//
// The prompt is persuasion; this is the contract. Every other model seam in
// this repo draws the same line — `parseMissionProposalStrict`,
// `parseSemanticFitStrict`, `parseMissionEvaluationStrict` — and for the same
// reason: a model that returns something ALMOST right must produce a refusal a
// caller can act on, not a half-filled object that looks usable.
//
// ── WHAT "STRICT" MEANS HERE ───────────────────────────────────────────────
//
// A field this parser cannot validate is not defaulted, coerced or guessed. An
// unknown objective is not silently mapped to `converse`; an unparseable part
// does not become an empty one. Both produce a refusal naming what was wrong,
// which the caller either repairs with a second model call or degrades into a
// clarification for the user.
//
// The rule that matters most: NEVER INVENT AN OBJECTIVE. `source` and
// `research` spend money. A parser that filled a missing objective with a
// plausible default would be deciding to spend on the model's behalf, which is
// exactly the authority this layer must not have.
//
// ── AND WHY UNKNOWN FIELDS ARE DROPPED, NOT REFUSED ────────────────────────
//
// A model that returns an extra key is not wrong about the request; a model
// that returns a `source` it cannot justify is. Additive noise is discarded
// silently, structural error is refused loudly.
//
// Pure. No network, no model, no database.

import {
  REQUEST_V1_VERSION, isRequestObjective, REQUEST_ENTITIES,
  type RequestV1, type RequestPart, type RequestObjective, type RequestEntity,
  type RequestFilter, type RequestRequirement, type RequestAmbiguity,
  type RequestOutput, type RequestReference,
} from "./requestV1.ts";
import { isSignalEvent, SIGNAL_SUBJECTS } from "./missionSignalDescriptor.ts";

export const REQUEST_PARSER_VERSION = "request-v1-parser-1" as const;

/** Why an answer could not be read. Named so a repair can target it. */
export type ParseViolation =
  | "not_an_object"
  | "no_parts"
  | "unknown_objective"
  | "unknown_entity"
  | "malformed_part"
  | "malformed_output"
  | "unknown_signal_event"
  | "unknown_signal_subject"
  | "duplicate_part_id"
  | "dangling_dependency"
  | "cyclic_dependency"
  | "no_utterance";

export interface ParsedRequest {
  request: RequestV1 | null;
  violations: ParseViolation[];
  /** Shape corrections made while reading. Non-fatal, always reported. */
  repairs: string[];
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ENTITY_SET: ReadonlySet<string> = new Set(REQUEST_ENTITIES);
const SUBJECT_SET: ReadonlySet<string> = new Set(SIGNAL_SUBJECTS);
const OUTPUT_SHAPES: ReadonlySet<string> = new Set(["records", "events", "answer", "artifact"]);
const FILTER_OPS: ReadonlySet<string> = new Set(["eq", "in", "range", "contains", "not"]);

function readFilters(v: unknown, repairs: string[]): RequestFilter[] {
  const out: RequestFilter[] = [];
  for (const raw of arr(v)) {
    const f = rec(raw);
    const field = str(f?.field);
    if (!f || !field) { repairs.push("dropped_filter_without_field"); continue; }
    // THE WIRE SHAPE, FOLDED BACK. Structured outputs cannot express a
    // heterogeneous `value`, so the model sends `values` (a list) and `range`
    // ({min,max}); `value` is still accepted for callers that build a request
    // directly. See the schema note in `chatBrain.ts`.
    const wireRange = rec(f.range);
    const wireValues = arr(f.values).map(str).filter(Boolean);
    const value = f.value !== undefined ? f.value
      : wireRange ? { min: numOrNull(wireRange.min), max: numOrNull(wireRange.max) }
      : wireValues.length ? wireValues
      : undefined;
    if (value === undefined) { repairs.push(`dropped_filter_without_value:${field}`); continue; }
    const op = str(f.op);
    if (!FILTER_OPS.has(op)) {
      // A filter whose operator we do not know is still a filter the user
      // stated. `in` is the widest reading, so it cannot narrow a population
      // further than the request asked — the safe direction to be wrong in.
      repairs.push(`filter_op_defaulted:${field}`);
      out.push({ field, op: "in", value });
      continue;
    }
    out.push({ field, op: op as RequestFilter["op"], value });
  }
  return out;
}

function readReferences(v: unknown, repairs: string[]): RequestReference[] {
  const out: RequestReference[] = [];
  for (const raw of arr(v)) {
    const r = rec(raw);
    const value = str(r?.value);
    if (!value) { repairs.push("dropped_reference_without_value"); continue; }
    const kind = str(r?.kind);
    // ABSENT MEANS `one`. Every reference written before cardinality existed
    // selected a single entity, and a missing field must keep meaning that —
    // defaulting to `all` would turn an unreadable answer into a bulk action.
    const cardinality = str(r?.cardinality) === "all" ? "all" as const : "one" as const;
    out.push({
      kind: kind === "saved_set" || kind === "prior_result" ? kind : "named",
      value,
      cardinality,
      resolved_key: typeof r?.resolved_key === "string" ? r.resolved_key : null,
    });
  }
  return out;
}

function readRequirements(
  v: unknown, violations: ParseViolation[], repairs: string[],
): RequestRequirement[] {
  const out: RequestRequirement[] = [];
  for (const raw of arr(v)) {
    const q = rec(raw);
    if (!q) { repairs.push("dropped_requirement_not_an_object"); continue; }
    const event = str(q.event);
    // AN UNKNOWN EVENT IS FATAL, NOT DROPPED. Discarding it would turn "hiring
    // AND funding" into "hiring" — a narrower search presented as the one that
    // was asked for, which is the loss `unrepresented_requirements` exists to
    // make impossible.
    if (!isSignalEvent(event)) { violations.push("unknown_signal_event"); continue; }
    const subject = str(q.subject) || "company";
    if (!SUBJECT_SET.has(subject)) { violations.push("unknown_signal_subject"); continue; }
    const qual = rec(q.qualifier) ?? undefined;
    out.push({
      event, subject: subject as RequestRequirement["subject"],
      qualifier: qual as RequestRequirement["qualifier"],
      phrase: str(q.phrase),
      recency_days: numOrNull(q.recency_days),
    });
  }
  return out;
}

function readOutput(
  v: unknown, violations: ParseViolation[],
): RequestOutput | null {
  const o = rec(v);
  if (!o) { violations.push("malformed_output"); return null; }
  const shape = str(o.shape);
  if (!OUTPUT_SHAPES.has(shape)) { violations.push("malformed_output"); return null; }
  return {
    shape: shape as RequestOutput["shape"],
    count: numOrNull(o.count),
    // ABSENT MEANS `sample` — the bounded page every read returned before this
    // field existed. Only an explicit "all" widens anything.
    completeness: str(o.completeness) === "all" ? "all" : "sample",
  };
}

function readPart(
  raw: unknown, idx: number, violations: ParseViolation[], repairs: string[],
): RequestPart | null {
  const p = rec(raw);
  if (!p) { violations.push("malformed_part"); return null; }

  const objective = str(p.objective);
  // NEVER INVENTED. See the header: `source` and `research` spend money, so a
  // missing objective is a refusal, not a default.
  if (!isRequestObjective(objective)) { violations.push("unknown_objective"); return null; }

  const subj = rec(p.subject);
  const entity = str(subj?.entity);
  if (!ENTITY_SET.has(entity)) { violations.push("unknown_entity"); return null; }

  const output = readOutput(p.output, violations);
  if (!output) return null;

  let id = str(p.id);
  if (!id) { id = `p${idx + 1}`; repairs.push(`part_id_generated:${id}`); }

  return {
    id,
    objective: objective as RequestObjective,
    subject: {
      entity: entity as RequestEntity,
      references: readReferences(subj?.references, repairs),
      filters: readFilters(subj?.filters, repairs),
    },
    requirements: readRequirements(p.requirements, violations, repairs),
    output,
    depends_on: arr(p.depends_on).map(str).filter(Boolean),
  };
}

function readAmbiguity(v: unknown): RequestAmbiguity[] {
  const out: RequestAmbiguity[] = [];
  for (const raw of arr(v)) {
    const a = rec(raw);
    const question = str(a?.question);
    if (!question) continue;
    out.push({
      part_id: typeof a?.part_id === "string" ? a.part_id : null,
      field: str(a?.field) || "unknown",
      // DEFAULTS TO BLOCKING. A model that did not say how serious its own
      // confusion is has not established that proceeding is safe, and the
      // failure this protects against — spending against the wrong entity — is
      // the most expensive one in the system.
      blocking: a?.blocking !== false,
      question,
    });
  }
  return out;
}

/**
 * Read a model answer into a request, or refuse it.
 *
 * `utterance` is supplied by the CALLER, never taken from the model: it is the
 * user's own words, and a model that paraphrased them would silently rewrite
 * the record every downstream preview quotes.
 */
export function parseRequestStrict(raw: unknown, utterance: string): ParsedRequest {
  const violations: ParseViolation[] = [];
  const repairs: string[] = [];

  if (!str(utterance)) return { request: null, violations: ["no_utterance"], repairs };

  const o = rec(raw);
  if (!o) return { request: null, violations: ["not_an_object"], repairs };

  const rawParts = arr(o.parts);
  if (rawParts.length === 0) return { request: null, violations: ["no_parts"], repairs };

  const parts: RequestPart[] = [];
  for (let i = 0; i < rawParts.length; i++) {
    const part = readPart(rawParts[i], i, violations, repairs);
    if (part) parts.push(part);
  }
  if (violations.length > 0) return { request: null, violations, repairs };
  if (parts.length === 0) return { request: null, violations: ["no_parts"], repairs };

  const ids = new Set<string>();
  for (const p of parts) {
    if (ids.has(p.id)) return { request: null, violations: ["duplicate_part_id"], repairs };
    ids.add(p.id);
  }
  for (const p of parts) {
    for (const d of p.depends_on ?? []) {
      if (!ids.has(d)) return { request: null, violations: ["dangling_dependency"], repairs };
    }
  }
  // A CYCLE IS NOT SCHEDULABLE, so it is refused here rather than discovered by
  // whatever tries to run it.
  const state = new Map<string, 0 | 1 | 2>();
  let cyclic = false;
  const byId = new Map(parts.map((p) => [p.id, p]));
  const visit = (id: string) => {
    if (cyclic || state.get(id) === 2) return;
    if (state.get(id) === 1) { cyclic = true; return; }
    state.set(id, 1);
    for (const d of byId.get(id)?.depends_on ?? []) visit(d);
    state.set(id, 2);
  };
  for (const p of parts) visit(p.id);
  if (cyclic) return { request: null, violations: ["cyclic_dependency"], repairs };

  // THE REQUEST'S OBJECTIVE IS THE MOST COMMITTING PART'S, not the first's.
  // A message that reads and then sources is a spending request, and treating
  // it as a read would let the spend happen without the authority check.
  const RANK: Record<RequestObjective, number> = {
    converse: 0, read: 1, compose: 2, monitor: 3, research: 4, source: 5,
  };
  const objective = parts.reduce<RequestObjective>(
    (best, p) => RANK[p.objective] > RANK[best] ? p.objective : best, parts[0].objective);

  const conf = numOrNull(o.confidence);

  return {
    request: {
      version: REQUEST_V1_VERSION,
      utterance,
      objective,
      parts,
      ambiguity: readAmbiguity(o.ambiguity),
      // AUTHORITY IS NOT THE MODEL'S TO GRANT. Set by the caller from workspace
      // policy and the user's confirmation; a model that returned
      // `may_spend: true` must not thereby be allowed to spend.
      authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
      provenance: {},
      confidence: conf === null ? 0.5 : Math.max(0, Math.min(1, conf)),
    },
    violations: [],
    repairs,
  };
}
