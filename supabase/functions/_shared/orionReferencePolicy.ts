// R1.2 · CONSEQUENCE-GATED REFERENCE RESOLUTION. PURE AND DETERMINISTIC.
//
// ── WHY THIS EXISTS (three live TEST runs, 2026-11-16) ──────────────────────
//
// The same prompts in the same order failed differently on every run, because
// two hard "ask the user" gates fired BEFORE anything knew what the request
// would do, on signals the understanding model emits non-deterministically:
//   - Gate A: any back-reference that did not bind to a company → ask. The
//     referent model knew one target type (a company), so "risks and
//     decisions" (ORION's own previous analysis) became an ambiguous singular
//     pronoun whenever more than one company was on record.
//   - Gate B: any blocking ambiguity the model chose to emit → ask, even for a
//     free explanation of work that will not run.
// See docs/release/2026-11-16-r1.2/ROUTING_ROOT_CAUSE.md.
//
// ── THE SEPARATION ─────────────────────────────────────────────────────────
//
// The MODEL interprets (objective, parts, references, ambiguity). THIS MODULE
// decides, from facts it computes itself:
//   1. what each back-reference POINTS AT — earlier conversation CONTENT, a SET
//      of companies, or one ENTITY;
//   2. what the request would DO — answer only, spend, send, or change data;
//   3. whether asking is required, from a fixed table.
//
// ── THE TABLE ──────────────────────────────────────────────────────────────
//
//   target \ consequence        ANSWER                          SPEND / OUTBOUND / MUTATION
//   CONTENT (a draft the        bound by the compose surface    bound by the compose surface
//     compose surface resolves)
//   CONTENT (anything else)     ORION answers from prior turns  ASK what to act on
//   SET, bound                  use it                          use it (Start + guards apply)
//   SET, unbound                ORION answers; says the set     ASK
//                               is unknown, never substitutes
//   ENTITY, bound to exactly 1  use it                          use it
//   ENTITY, unbound/ambiguous   ASK                             ASK
//   model's blocking ambiguity  ORION is told when ORION        ASK (unchanged router behaviour)
//                               answers; a template read keeps
//                               the router's question
//
// FAIL CLOSED: anything that may spend, send or change data keeps every
// question it had. The table can only remove a question from an ANSWER, never
// from anything with a consequence. Delegation, Start confirmation, spend
// ceilings, authorization and workspace isolation are downstream and untouched.

import type { RequestPart, RequestReference, RequestV1 } from "./requestV1.ts";
import { resolveReferents, type ReferentSource, type ResolvedRequest } from "./referentBinding.ts";
import { asConverse, isExecutionRequest, orionRoute, type OrionRouting } from "./orionIntelligence.ts";
import { planCompose } from "./composeSurface.ts";

export const ORION_REFERENCE_POLICY_VERSION = "orion-reference-policy-v1" as const;

export type ReferenceTarget = "content" | "set" | "entity";
export type Consequence = "answer" | "spend" | "outbound" | "mutation";

// ── 1. WHAT A REFERENCE POINTS AT ──────────────────────────────────────────
const ORDINAL_RE = /\b(?:first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\b/i;
const SINGULAR_RE = /^(?:it|this|that|this one|that one|the one|(?:this|that|the) (?:company|lead|account|founder|prospect|business|startup|firm|candidate))$/i;
// A plural noun that names companies (or the people at them) is a SET.
const COMPANY_SET_RE = /\b(?:companies|leads|accounts|founders|prospects|candidates|firms|businesses|startups|organisations|organizations|owners|ceos|people|contacts)\b/i;
// A bare plural pronoun or quantifier with no noun of its own is a SET too.
const PLURAL_PRONOUN_RE = /\b(?:these|those|them|they|all|every|each|both|several)\b/i;
const CONTENT_RE = /\b(?:claims?|answers?|responses?|repl(?:y|ies)|analys[ie]s|reports?|briefs?|briefing|findings?|risks?|decisions?|recommendations?|suggestions?|summary|summaries|priorities|plans?|points?|conclusions?|assessments?|reasoning|breakdown|overview|table|list|draft|post|message|email|script|numbers|metrics|figures|above|earlier|previous|what you (?:said|wrote|recommended|suggested|found))\b/i;

/**
 * Deterministic. Order matters and is conservative: anything that can name a
 * single company is an ENTITY first; a plural company noun is a SET; a noun
 * naming conversation content (and no company) is CONTENT; a bare plural
 * pronoun is a SET; an unrecognised value falls back on cardinality — "all" is
 * a SET, anything else an ENTITY (which asks when it cannot bind).
 */
export function referenceTarget(ref: Pick<RequestReference, "value" | "cardinality">, presentedNames: readonly string[] = []): ReferenceTarget {
  const v = String(ref.value ?? "").trim().toLowerCase().replace(/[.?!,;:]+$/g, "");
  const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  if (presentedNames.some((n) => norm(n) && norm(n) === norm(v))) return "entity";
  if (ORDINAL_RE.test(v) || SINGULAR_RE.test(v)) return "entity";
  if (COMPANY_SET_RE.test(v)) return "set";
  // "those findings", "the risks and decisions", "that internal report": the
  // noun names conversation content, whatever determiner precedes it.
  if (CONTENT_RE.test(v)) return "content";
  if (PLURAL_PRONOUN_RE.test(v)) return "set";
  return ref.cardinality === "all" ? "set" : "entity";
}

// ── 2. WHAT THE REQUEST WOULD DO ───────────────────────────────────────────
const PAID = new Set(["source", "research"]);

/**
 * Deterministic, from the request's structure and ORION's routing decision —
 * never from whether the model emitted an ambiguity.
 *   ANSWER   reads, conversation, internal analysis, ORION's text-only drafts,
 *            and an execution request ORION will only EXPLAIN.
 *   SPEND    any part that may buy work (source, research).
 *   MUTATION monitoring (creates a watch and scheduled spend), and compose that
 *            is not ORION's text draft (it creates a content row / a mission).
 *   OUTBOUND compose aimed at people (outreach) or any send/publish wording.
 */
export function consequenceOf(request: RequestV1, message: string, orion: OrionRouting): Consequence {
  if (orion.draft) return "answer";
  if (orion.reroute) return "answer";
  const objectives = request.parts.map((p) => p.objective);
  if (objectives.some((o) => PAID.has(o))) return "spend";
  if (objectives.includes("monitor")) return "mutation";
  if (objectives.includes("compose")) {
    return planCompose(request)?.kind === "outreach" || isExecutionRequest(message) ? "outbound" : "mutation";
  }
  return "answer";
}

// ── 3. THE DECISION ────────────────────────────────────────────────────────
export interface ReferenceLog {
  part_id: string;
  value: string;
  cardinality: "one" | "all" | null;
  target: ReferenceTarget;
  bound: boolean;
}

export interface TurnRouting {
  version: typeof ORION_REFERENCE_POLICY_VERSION;
  consequence: Consequence;
  /** Set → reply with this question and stop. Nothing has been routed or spent. */
  ask: null | { question: string; reason: string; part_id: string | null };
  /**
   * The request every later step must see. CONTENT references stay on it (a
   * compose surface needs "that post" to find the draft) but are never resolved
   * against companies; for an ANSWER, unmatched set references are removed, and
   * where ORION answers, the model's blocking questions become `notes`.
   */
  request: RequestV1;
  orion: OrionRouting;
  resolution: ResolvedRequest;
  /** Facts for ORION's prompt (answer path): what was pointed at but not bound, and questions the model raised. */
  notes: string[];
  references: ReferenceLog[];
  blocking_fields: string[];
  decision: string;
}

const isPriorResult = (r: RequestReference) => r.kind === "prior_result";

function withoutReferences(request: RequestV1, drop: (part: RequestPart, ref: RequestReference) => boolean): RequestV1 {
  return {
    ...request,
    parts: request.parts.map((p) => ({
      ...p,
      subject: { ...p.subject, references: (p.subject.references ?? []).filter((r) => !drop(p, r)) },
    })),
  };
}

/**
 * THE ONE ROUTING-POLICY STEP pilot-chat applies after the model's reading:
 * classify references, resolve only those that can name companies, route with
 * `orionRoute`, compute the consequence, and decide whether to ask.
 */
export function planTurnRouting(i: {
  request: RequestV1;
  message: string;
  source: ReferentSource | null;
  evidenceEnabled: boolean;
  delegationEnabled: boolean;
  /**
   * The request's back-references point at a CONTENT DRAFT the compose surface
   * resolves itself ("regenerate that post", "an image for it") — pre-existing
   * behaviour (`resolveLatestContentItem`). Every reference is then CONTENT.
   */
  referencesPointAtContentDraft?: boolean;
}): TurnRouting {
  const presentedNames = (i.source?.entities ?? []).flatMap((e) => [e.label, e.name ?? ""]).filter(Boolean) as string[];
  const references: ReferenceLog[] = [];
  const targetOf = new Map<RequestReference, ReferenceTarget>();
  for (const p of i.request.parts) {
    for (const r of p.subject.references ?? []) {
      if (!isPriorResult(r)) continue;
      const target = i.referencesPointAtContentDraft ? "content" : referenceTarget(r, presentedNames);
      targetOf.set(r, target);
      references.push({ part_id: p.id, value: String(r.value ?? "").slice(0, 80), cardinality: r.cardinality ?? null, target, bound: false });
    }
  }

  // CONTENT is never resolved against companies: it is answered from the prior turns.
  const withoutContent = withoutReferences(i.request, (_p, r) => targetOf.get(r) === "content");
  const resolution = resolveReferents(withoutContent, i.source);
  const failedParts = new Set(resolution.failures.map((f) => f.part_id));
  // A content-draft reference is BOUND by the compose surface (`resolveLatestContentItem`,
  // workspace-scoped and typed). Any other content reference is bound to nothing.
  // A SINGULAR reference ("that one", "it", "the second one") is bound only when
  // it resolved to exactly ONE company. The resolver honours the model's
  // cardinality, so "that one" labelled `all` would otherwise bind the whole
  // set — the words are more specific than the label, and they say one.
  const refsPerPart = new Map<string, number>();
  for (const ref of references) refsPerPart.set(ref.part_id, (refsPerPart.get(ref.part_id) ?? 0) + 1);
  const bindingsFor = (partId: string) => resolution.bindings.filter((b) => b.part_id === partId).length;
  for (const ref of references) {
    if (ref.target === "content") { ref.bound = Boolean(i.referencesPointAtContentDraft); continue; }
    ref.bound = !failedParts.has(ref.part_id);
    if (ref.bound && ref.target === "entity" && refsPerPart.get(ref.part_id) === 1 && bindingsFor(ref.part_id) !== 1) ref.bound = false;
  }

  const blocking_fields = i.request.ambiguity.filter((a) => a.blocking).map((a) => String(a.field ?? ""));
  const o = { evidenceEnabled: i.evidenceEnabled, delegationEnabled: i.delegationEnabled };
  const orion = orionRoute(i.request, i.message, o);
  const consequence = consequenceOf(i.request, i.message, orion);

  const unboundEntity = references.find((r) => r.target === "entity" && !r.bound);
  const unboundSet = references.filter((r) => r.target === "set" && !r.bound);
  const content = references.filter((r) => r.target === "content" && !r.bound);
  const failureFor = (partId: string) => resolution.failures.find((f) => f.part_id === partId) ?? null;
  const base = { version: ORION_REFERENCE_POLICY_VERSION, consequence, orion, resolution, references, blocking_fields } as const;

  // ENTITY that cannot be bound to exactly one company → ASK, whatever the consequence.
  if (unboundEntity) {
    const f = failureFor(unboundEntity.part_id);
    return { ...base, request: i.request, notes: [], decision: "ask:entity_unbound",
      ask: { question: f?.question ?? `Which company do you mean by "${unboundEntity.value}"?`, reason: `referent:${f?.reason ?? "ambiguous_referent"}`, part_id: unboundEntity.part_id } };
  }

  if (consequence !== "answer") {
    // FAIL CLOSED: anything that may spend, send or change data keeps every question.
    if (unboundSet.length) {
      const f = failureFor(unboundSet[0].part_id);
      return { ...base, request: i.request, notes: [], decision: "ask:set_unbound_with_consequence",
        ask: { question: f?.question ?? "Which companies do you mean?", reason: `referent:${f?.reason ?? "set_unbound"}`, part_id: unboundSet[0].part_id } };
    }
    if (content.length) {
      return { ...base, request: i.request, notes: [], decision: "ask:content_target_with_consequence",
        ask: { question: `Before I act on "${content[0].value}", tell me exactly which companies or records it should apply to.`, reason: "referent:content_not_actionable", part_id: content[0].part_id } };
    }
    // The model's blocking ambiguities stay on the request; the router asks.
    return { ...base, request: i.request, notes: [], ask: null, decision: `proceed:${consequence}` };
  }

  // ANSWER: never ask about content or an unmatched set; never invent the set.
  const notes: string[] = [];
  for (const c of content) {
    notes.push(`The user's message refers back to earlier conversation content ("${c.value}"). Answer from the prior turns; if those turns do not contain it, say so plainly.`);
  }
  for (const s of unboundSet) {
    notes.push(`The user's message refers to "${s.value}", but no set of companies shown earlier in this conversation matches it. Do NOT guess or substitute companies: say that the referenced set could not be identified from this conversation's stored results, answer only what the stored records and prior turns support, and ask which companies are meant if the answer depends on them.`);
  }
  const unmatched = new Set(unboundSet.map((s) => s.part_id + "\u0000" + s.value));
  const answerRequest = withoutReferences(i.request,
    (p, r) => unmatched.has(p.id + "\u0000" + String(r.value ?? "").slice(0, 80)));
  // Route the cleaned request. A free answer that points at something no stored
  // record binds (earlier content, an unmatched set) is ORION's answer from the
  // prior turns — never a template read, which would list the workspace's
  // records in place of the set the user meant. ORION's text draft is kept.
  let orionFinal = orionRoute(answerRequest, i.message, o);
  if (!orionFinal.draft && !orionFinal.reroute && (content.length || unboundSet.length)) {
    orionFinal = { request: asConverse(answerRequest), reroute: "reference_answer", reasons: ["refers_to_unbound_conversation_content"], draft: null };
  }
  // WHO ANSWERS DECIDES WHO ASKS. When ORION writes the answer (a reroute, its
  // text draft, or a conversation turn), the model's blocking questions are
  // handed to ORION, which asks only if it truly cannot answer. When a
  // deterministic surface answers (a template read), it cannot ask a nuanced
  // question, so the router's question stays exactly as before.
  const orionAnswers = !!orionFinal.draft || !!orionFinal.reroute ||
    orionFinal.request.parts.every((p) => p.objective === "converse");
  const questions = orionAnswers
    ? i.request.ambiguity.filter((a) => a.blocking).map((a) => a.question).filter(Boolean) : [];
  if (questions.length) {
    notes.push(`Points the user's message may leave open (answer if you can from the facts and prior turns; otherwise ask ONE short question): ${questions.join(" | ")}`);
  }
  const request = orionAnswers
    ? { ...orionFinal.request, ambiguity: orionFinal.request.ambiguity.filter((a) => !a.blocking) }
    : orionFinal.request;
  orionFinal = { ...orionFinal, request };
  return { ...base, orion: orionFinal, request, notes, ask: null,
    decision: content.length || unboundSet.length || questions.length ? "proceed:answer_with_notes" : "proceed:answer" };
}
