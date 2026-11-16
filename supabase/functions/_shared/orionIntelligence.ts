// R1.1 · ORION'S ROUTING STEP — which questions ORION reasons over, and which
// requests it drafts itself. PURE: no database, no model, no environment.
//
// ── WHAT THE LIVE TESTS SHOWED (2026-11-13, production) ────────────────────
//
// Six of twenty capability prompts ("compare…", "for Hyperbound, which fields
// are saved…", "hiring signals older than 30 days…", "how many leads, qualified
// leads, monitored companies and signals… then the strongest opportunities")
// were understood as a single `read` and answered by the deterministic list
// template: "61 leads saved. • Hyperbound • …". The template is right for
// "list my leads" and wrong for anything that asks for a comparison, an
// explanation, a filter, specific fields or several answers — it silently
// answered one part and dropped the rest.
//
// And every drafting request ("draft a LinkedIn post", "a first LinkedIn
// message", "a cold email and a video script") was delegated to LYRA through
// `orchestrate`, which the release guard (AGENTORY_DELEGATION_ENABLED=false)
// refuses — after the content route had already inserted an empty draft row.
//
// ── THE RULES ───────────────────────────────────────────────────────────────
//
// 1. A SIMPLE LISTING keeps the $0 template ("list my leads", "show my
//    signals", "how many leads do I have?", "show the full list").
// 2. A READ THAT NEEDS REASONING — comparison, explanation, a filter, named
//    fields, several sub-questions, several sources — becomes one `converse`
//    part, answered by ORION from the evidence digest and the authoritative
//    workspace totals. Only where the evidence context is on (it is what makes
//    the answer grounded); a drill-down into a company we showed
//    (`prior_result`) keeps its scoped read.
// 3. "DO NOT EXECUTE" ON A PAID OBJECTIVE ("scrape 500 companies… explain what
//    you can safely do. Do not execute anything") is a question about the
//    work, answered by ORION. It can never start the work.
// 4. WHILE DELEGATION IS OFF, A DRAFT IS WRITTEN BY ORION — text in the chat,
//    nothing persisted, nothing delegated, nothing sent or published. With
//    delegation on, compose keeps its LYRA route unchanged.
//
// Nothing here can make a request spend: reads become `converse`, paid
// objectives under an explicit "do not execute" become `converse`, and a draft
// never reaches the router at all.

import type { RequestPart, RequestV1 } from "./requestV1.ts";
import { orionAnswersCompoundRead } from "./departmentRouting.ts";

export const ORION_INTELLIGENCE_VERSION = "orion-intelligence-v1" as const;

export type DraftKind = "linkedin_post" | "linkedin_message" | "cold_email" | "follow_up" | "video_script" | "campaign" | "other";

export interface OrionRouting {
  /** The request every later step must see (rewritten when rerouted). */
  request: RequestV1;
  reroute: null | "compound_read" | "analytical_read" | "held_records";
  /** Why a read was judged to need reasoning — persisted for audit. */
  reasons: string[];
  /** Set only while delegation is off: ORION writes the draft itself. */
  draft: null | { kinds: DraftKind[] };
}

// ── WHAT MAKES A READ NEED REASONING ────────────────────────────────────────
const REASONING_SIGNALS: ReadonlyArray<[string, RegExp]> = [
  ["comparison", /\b(?:compare|comparison|compared|versus|vs\.?|rank(?:ed|ing)?|prioriti[sz]e|strongest|weakest|best|worst|most (?:promising|likely|relevant)|which (?:one|companies|company|leads?|signals?|accounts?) (?:is|are|should|may|might|would|could|have|has))\b/i],
  ["explanation", /\b(?:explain|why|reason(?:ing)?|account(?:s)? for|interpret|assess|evaluate|recommend|implications?|what does .{1,40} mean|tell me what you cannot|what (?:is|are) missing|verification plan)\b/i],
  ["filter", /\b(?:older than|newer than|more than \d+ days|less than \d+ days|over \d+ days|within the (?:last|past)|in the (?:last|past) \d+|since \w+|before \w+ \d|after \w+ \d|stale|historical|only (?:the )?(?:hiring|funding|qualified|verified)|hiring signals?)\b/i],
  ["fields", /\b(?:including|which fields|what fields|fields? (?:are|is)|columns?|what .{0,40}\b(?:is|are) (?:actually )?(?:saved|stored)|decision[- ]makers?|recommended buyer|buyer|fit status|decision status|next action|observed date|confidence|signal type)\b/i],
  // R1.2: judgement and verification questions ("should I contact them?", "can I safely
  // tell a founder…?", "which claims are inference only?") need reasoning too.
  ["judgement", /\b(?:should (?:i|we)|can (?:i|we) (?:safely|honestly|truthfully)|is it (?:safe|true|accurate|fair)|supported (?:only )?by|inference only|independently (?:verified|sourced)|which (?:claims?|facts?|records?|statements?)\b)/i],
  ["multi_part", /\b(?:then|separately|each part|every part|as well as|and also|for each)\b/i],
  ["zero_vs_missing", /\b(?:distinguish|missing (?:data|information|fields)|unknown fields?|zero (?:results)?|empty)\b/i],
];
const SOURCES_RE = /\b(?:company brain|brain|leads?|signals?|accounts?|monitor(?:ed|ing)?|contacts?)\b/gi;

/** Why a read needs reasoning (empty → a simple listing the template serves). */
export function readReasoningSignals(message: string): string[] {
  const m = String(message ?? "");
  const out = REASONING_SIGNALS.filter(([, re]) => re.test(m)).map(([k]) => k);
  if (subQuestions(m).length >= 2) out.push("several_questions");
  const sources = new Set((m.match(SOURCES_RE) ?? []).map((s) => s.toLowerCase().replace(/s$/, "").replace(/^brain$/, "company brain")));
  if (sources.size >= 3) out.push("several_sources");
  return [...new Set(out)];
}

// ── SUB-QUESTIONS: EVERY PART OF A COMPOUND ASK IS KEPT ─────────────────────
const CONSTRAINT_RE = /^(?:answer\b|do not\b|don't\b|use only\b|use (?:our |actual )|only use\b|include source|keep\b|avoid\b|draft only\b|this is planning\b|planning only\b|distinguish\b|cite\b|make sure\b|no (?:fabricat|invent)|be (?:concise|honest|brief))/i;

/**
 * The separate asks in a message, in order. A list of counts ("how many leads,
 * qualified leads, monitored companies, and stored signals") is one ask per
 * item; a list of FIELDS ("with company, signal type, source…") is not split.
 * Instructions about HOW to answer ("answer every part separately", "do not
 * fabricate") are constraints, not questions, and are left out.
 */
export function subQuestions(message: string): string[] {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z])/).flatMap((s) => s.split(/[;,]?\s+(?=then\b)/i));
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim().replace(/^then\s+/i, "").replace(/^and\s+/i, "");
    if (!s || CONSTRAINT_RE.test(s)) continue;
    const counts = s.match(/\bhow many (.+?)(?: (?:exist|are there|do (?:i|we) have|are (?:in|stored|saved))\b|[.?!]?$)/i);
    if (counts) {
      const items = counts[1].split(/,\s*(?:and\s+)?|\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
      if (items.length >= 2) { for (const it of items) out.push(`How many ${it}?`); continue; }
    }
    out.push(/[.?!]$/.test(s) ? s : `${s}.`);
  }
  return out;
}

// ── DRAFTING ────────────────────────────────────────────────────────────────
const DRAFT_KIND_RES: ReadonlyArray<[DraftKind, RegExp]> = [
  ["campaign", /\bcampaign\b/i],
  ["linkedin_post", /\blinkedin (?:post|article|carousel)s?\b|\b(?:a|one|the) (?:\d+-word )?post\b|\bposts? (?:for|on|about) linkedin\b/i],
  ["linkedin_message", /\blinkedin (?:message|dm|inmail|connection (?:request|note))s?\b|\b(?:dm|inmail)s?\b|\bfirst (?:linkedin )?message\b/i],
  ["cold_email", /\bcold e-?mails?\b|\b(?:an?|one|the) (?:short |personali[sz]ed |intro(?:ductory)? )?e-?mail\b(?! to (?:me|myself))/i],
  ["follow_up", /\bfollow[- ]?ups?\b/i],
  ["video_script", /\bvideo scripts?\b|\b\d+[- ]second (?:video|script)\b|\bscripts?\b/i],
];
const DRAFT_VERB_RE = /\b(?:draft|write|create|compose|prepare|produce|rewrite|craft|give me)\b/i;
const DRAFT_NOUN_RE = /\b(?:post|message|e-?mail|script|campaign|dm|inmail|follow[- ]?up|outreach (?:message|copy|draft)|copy|caption|newsletter|announcement)s?\b/i;

/**
 * R1.2 · WHAT THE MESSAGE DOES NOT ASK FOR IS REMOVED BEFORE READING FORMATS.
 * Live: "This is an internal analysis report, not a LinkedIn post, email,
 * marketing draft or campaign." was read as a request for a campaign and a
 * LinkedIn post. A negated clause ("not …", "no …", "rather than …", "instead
 * of …", "do not …") runs to the end of its sentence or clause and is dropped.
 */
export function withoutNegatedClauses(message: string): string {
  return String(message ?? "")
    .replace(/\b(?:not|no|never|rather than|instead of|isn't|is not|aren't|are not|without|don't|do not|doesn't|does not)\b[^.;!?\n]*/gi, " ")
    .replace(/\s+/g, " ").trim();
}

/** The formats a drafting request asks for, in a stable order. Negated formats are not requested. */
export function draftKindsFor(message: string): DraftKind[] {
  const m = withoutNegatedClauses(message);
  const kinds = DRAFT_KIND_RES.filter(([, re]) => re.test(m)).map(([k]) => k);
  // "follow-up email" is a follow-up, not a cold email.
  const out = kinds.includes("follow_up") ? kinds.filter((k) => k !== "cold_email" || /\bcold e-?mail/i.test(m)) : kinds;
  return out;
}

/** Does the message itself ask for an outbound text — "draft a 150-word LinkedIn post"? */
function namesOutboundText(message: string): boolean {
  const m = withoutNegatedClauses(message);
  // "draft" + a format within a few words.
  const near = /\b(?:draft|write|create|compose|prepare|produce|rewrite|craft)\b(?:\W+\w+){0,8}?\W+(?:post|message|e-?mail|script|campaign|dm|inmail|follow[- ]?up|caption|newsletter|announcement)s?\b/i;
  return DRAFT_VERB_RE.test(m) && DRAFT_NOUN_RE.test(m) && near.test(m);
}

/**
 * AN INTERNAL ANALYSIS IS NOT A DRAFT (R1.1 live TEST, test 20). "Produce a
 * weekly executive brief using only workspace data…" was read by Chat Brain as
 * `compose` (an artifact), and every compose request went to the text-draft
 * path. A brief, report, summary or plan built from the workspace's records is
 * ORION's evidence answer — totals, citations, the answer shape — not an
 * outbound text to review before sending.
 */
const INTERNAL_ANALYSIS_RE = /\b(?:brief(?:ing)?|report|summary|summari[sz]e|overview|analysis|breakdown|assessment|review|status update|plan|scorecard|recap)\b/i;
export function isInternalAnalysis(message: string): boolean {
  return INTERNAL_ANALYSIS_RE.test(withoutNegatedClauses(message)) && draftKindsFor(message).length === 0 && !namesOutboundText(message);
}

/**
 * R1.2 · AN EXECUTION REQUEST IS NOT A DRAFT REQUEST. Live: "Find 100 new US
 * companies using Apify, enrich their founders, save them as qualified leads
 * and SEND each founder a LinkedIn message immediately. If disabled, explain…
 * do not execute anything." was refused correctly but labelled as a LinkedIn
 * message draft, because "LinkedIn message" matched a format. Acting on the
 * outside world (send, publish, schedule, scrape, enrich, run Apify, find/source
 * N companies, save as leads) is execution; only an explicit "draft/write a …"
 * of a format makes it (also) a draft request.
 */
const EXECUTION_RE = /\b(?:send|sends|sending|deliver|publish|schedule|post (?:it|them|this|that)|message (?:every|each|all|them)|dm (?:every|each|all|them)|reach out to|email (?:every|each|all|them)|enrich(?:es|ing)?|scrape|scraping|apify|run (?:a |the )?(?:mission|search|scan|campaign)|launch (?:a |the )?campaign|(?:find|source|discover|get) \d+|save (?:them|these|those)|start (?:outreach|monitoring))\b/i;
export function isExecutionRequest(message: string): boolean {
  return EXECUTION_RE.test(withoutNegatedClauses(message)) && !namesOutboundText(message);
}

/** Is this turn a drafting request? (compose objective, or an explicit "draft/write a <format>") */
export function wantsDraft(request: RequestV1, message: string): boolean {
  if (isInternalAnalysis(message)) return false;
  if (isExecutionRequest(message)) return false;
  if (request.parts.some((p) => p.objective === "compose")) return true;
  return namesOutboundText(message);
}

// ── "DO NOT EXECUTE" ────────────────────────────────────────────────────────
const NO_EXECUTION_RE = /\b(?:do nothing|don't do anything|do not do anything|just (?:explain|tell me)(?: why| what| the)?)\b|\b(?:do not|don't|dont|without) (?:execute|run|start|spend|launch|trigger|send|actually (?:run|do))\b|\b(?:planning only|plan only|before taking (?:any )?action|do not (?:take|perform) (?:any )?action|explain (?:first|before))\b/i;
const HELD_RECORDS_RE = /\b(?:actually saved|already (?:saved|stored|have)|stored|saved|existing|in my (?:current )?workspace|from (?:our|my) (?:records|workspace))\b/i;
const PAID = new Set(["source", "research", "monitor"]);

const hasPriorResult = (p: RequestPart) => (p.subject.references ?? []).some((r) => r.kind === "prior_result");

function asConverse(request: RequestV1, o: { dropAmbiguity?: boolean } = {}): RequestV1 {
  const first = request.parts[0];
  return {
    ...request,
    // R1.2 (live TEST 3): when ORION only EXPLAINS work it will not run, a
    // question about that work's action or targets is moot — asking "which
    // action?" instead of explaining was the defect. Kept for every other reroute.
    ...(o.dropAmbiguity ? { ambiguity: [] } : {}),
    parts: [{ ...first, objective: "converse", requirements: [],
      subject: { ...first.subject, entity: "conversation", references: [], filters: [] },
      output: { ...first.output, shape: "answer" }, depends_on: [] }],
  };
}

/**
 * THE ONE ROUTING STEP pilot-chat applies after understanding and before the
 * router. `evidenceEnabled` is AGENTORY_ORION_EVIDENCE_CONTEXT for this
 * workspace; `delegationEnabled` is AGENTORY_DELEGATION_ENABLED.
 */
export function orionRoute(request: RequestV1, message: string, o: { evidenceEnabled: boolean; delegationEnabled: boolean }): OrionRouting {
  const unchanged: OrionRouting = { request, reroute: null, reasons: [], draft: null };
  if (!request.parts.length) return unchanged;

  // 4. Drafting while delegation is off: ORION writes it. Never with delegation
  //    on (LYRA's route is unchanged), never for a paid objective that is not
  //    paired with a compose ask.
  if (!o.delegationEnabled && wantsDraft(request, message)) {
    const paidOnly = request.parts.every((p) => PAID.has(p.objective));
    if (!paidOnly || request.parts.some((p) => p.objective === "compose")) {
      const kinds = draftKindsFor(message);
      return { ...unchanged, draft: { kinds: kinds.length ? kinds : ["other"] } };
    }
  }

  if (!o.evidenceEnabled) {
    // R1 behaviour without the evidence context: only the compound rule existed,
    // and it too needs the evidence context, so nothing is rerouted.
    return unchanged;
  }

  // An internal analysis is ORION's evidence answer — read as `compose` (R1.1
  // test 20) or, R1.2 live test 12, as a `read` pointing back at the previous
  // analysis ("a founder-only summary of risks and decisions"). Never a paid part.
  if (request.parts.some((p) => p.objective === "compose" || p.objective === "read" || p.objective === "converse") &&
      !request.parts.some((p) => PAID.has(p.objective)) && isInternalAnalysis(message)) {
    return { request: asConverse(request), reroute: "analytical_read", reasons: ["internal_analysis_not_a_draft"], draft: null };
  }

  // 3. A paid objective with an explicit "do not execute" is a question about it.
  if (request.parts.some((p) => PAID.has(p.objective)) && NO_EXECUTION_RE.test(message)) {
    return { request: asConverse(request, { dropAmbiguity: true }), reroute: "held_records", reasons: ["no_execution_requested"], draft: null };
  }
  // R1.2: an execution request read only as compose (no paid part) is not a
  // draft either; while delegation is off ORION explains what is not enabled.
  if (!o.delegationEnabled && request.parts.some((p) => p.objective === "compose") && isExecutionRequest(message)) {
    return { request: asConverse(request, { dropAmbiguity: true }), reroute: "held_records", reasons: ["execution_request_not_a_draft"], draft: null };
  }
  // …and so is "what is saved about X" read as research while delegation is off.
  if (!o.delegationEnabled && request.parts.every((p) => p.objective === "research") &&
      !request.parts.some(hasPriorResult) && HELD_RECORDS_RE.test(message)) {
    return { request: asConverse(request), reroute: "held_records", reasons: ["asks_about_held_records"], draft: null };
  }

  // 2. Reads that need reasoning.
  const readish = request.parts.every((p) => p.objective === "read" || p.objective === "converse");
  if (!readish || !request.parts.some((p) => p.objective === "read")) return unchanged;
  // R1.2: a follow-up that points back ("these companies") AND needs reasoning
  // ("which claims are inference only? can I tell a founder…? explain") is
  // ORION's answer — it sees the prior turns and what was presented. Live, it
  // went to the list template ("Those 8: …") and answered neither part. A plain
  // drill-down ("show me the second one") keeps its scoped read.
  if (request.parts.some(hasPriorResult)) {
    const why = readReasoningSignals(message);
    return why.length
      ? { request: asConverse(request), reroute: "analytical_read", reasons: ["follow_up", ...why], draft: null }
      : unchanged;
  }
  const compound = orionAnswersCompoundRead(request);
  if (compound.rerouted) return { request: compound.request, reroute: "compound_read", reasons: ["compound"], draft: null };
  const reasons = readReasoningSignals(message);
  if (!reasons.length) return unchanged;
  return { request: asConverse(request), reroute: "analytical_read", reasons, draft: null };
}

/**
 * R1.2 (live TEST 13) · WILL ORION ONLY EXPLAIN THIS EXECUTION REQUEST?
 * True exactly when `orionRoute` turns an execution request into an
 * explanation (an explicit "do not execute / do nothing / just explain", or an
 * execution request while delegation is off). pilot-chat then skips the
 * "which companies do you mean?" referent question: nothing will act on them.
 */
export function explainsWithoutActing(request: RequestV1, message: string, o: { evidenceEnabled: boolean; delegationEnabled: boolean }): boolean {
  const r = orionRoute(request, message, o);
  return r.reroute === "held_records" &&
    (r.reasons.includes("no_execution_requested") || r.reasons.includes("execution_request_not_a_draft"));
}

/**
 * R1.2 (live TEST 12) · MAY ORION ANSWER WITHOUT RESOLVING WHAT THE MESSAGE
 * POINTS BACK AT? pilot-chat asks "which company do you mean?" when a
 * back-reference does not resolve. That question is right when an answer or an
 * action depends on ONE entity, and wrong when:
 *   - ORION will only explain an execution request it will not run
 *     (`explainsWithoutActing`, live test 13), or
 *   - the message asks for an internal analysis of what the conversation
 *     already covered ("a founder-only summary of risks and decisions") —
 *     ORION answers from the prior turns, and nothing is bought or acted on.
 * A reference to a SINGLE entity ("that one", "that company", "the second
 * one") is still asked about, and so is anything paid or outbound.
 */
export function answersWithoutResolvingTargets(request: RequestV1, message: string, o: { evidenceEnabled: boolean; delegationEnabled: boolean }): boolean {
  if (explainsWithoutActing(request, message, o)) return true;
  const singular = request.parts.some((p) => (p.subject.references ?? []).some((r) => r.kind === "prior_result" && r.cardinality === "one"));
  if (singular) return false;
  const r = orionRoute(request, message, o);
  return !r.draft && r.reasons.includes("internal_analysis_not_a_draft");
}
