// WORKFORCE V2 · ROUTING TO DEPARTMENTS.
//
// Chat Brain decides WHAT is asked (objective); this module adds the two
// department rules the objective alone got wrong (audit 2026-11):
//
//   1. PRIORITY QUESTIONS ARE ORION'S BRIEF. "What should I prioritize this
//      week?" was read as `converse` and answered by a free-text reply that
//      only sees counts. It is a request for ORION's ranked, evidence-backed
//      brief, so it is promoted to read · conversation · answer, which the read
//      surface serves from `daily-brief`. Only all-converse (or unscoped read)
//      requests are promoted; nothing that could spend is touched.
//   2. PRONOUN REFERENCES RESOLVE TO WHAT WAS SHOWN. "Why was this lead
//      rejected?" used to search for a company literally named "this lead".
//      The reference is resolved against the companies the last answer showed
//      (presented_referents): one → that company; several → ask which; none →
//      ask for a name. Never a guess.
//
// And it names the department a route belongs to, for reply attribution.
//
// PURE.
import type { RequestV1 } from "./requestV1.ts";
import type { Department } from "./departments.ts";
import type { PresentedReferentSet } from "./referentPersistence.ts";

export const PRIORITY_QUESTION_RE =
  /\b(?:prioriti[sz]e|priorities|top priority|focus on (?:this|next)|what should (?:i|we) (?:focus on|work on|do (?:first|next|this week|today))|what matters most|what needs my attention|brief me|executive (?:brief|summary)|where should (?:i|we) (?:focus|start))\b/i;

/** Promote a priority question to ORION's brief. Returns the request unchanged otherwise. */
export function promoteExecutiveQuestion(request: RequestV1, utterance: string): { request: RequestV1; promoted: boolean } {
  if (!PRIORITY_QUESTION_RE.test(utterance)) return { request, promoted: false };
  const promotable = request.parts.length > 0 && request.parts.every((p) =>
    p.objective === "converse" ||
    (p.objective === "read" && p.output.shape === "answer" && (p.subject.references ?? []).length === 0));
  if (!promotable) return { request, promoted: false };
  const first = request.parts[0];
  return {
    promoted: true,
    request: {
      ...request,
      parts: [{ ...first, objective: "read", subject: { ...first.subject, entity: "conversation", references: [] },
        output: { ...first.output, shape: "answer" }, depends_on: [] }],
    },
  };
}

const PRONOUN_RE = /^(?:this|that|the)\s+(?:lead|company|account|one|prospect|business)$|^(?:it|them|they|this|that|this one|that one)$/i;
export const isPronounReference = (s: string | null | undefined): boolean => PRONOUN_RE.test(String(s ?? "").trim());

export type PronounResolution =
  | { kind: "one"; name: string; domain: string | null }
  | { kind: "many"; names: string[] }
  | { kind: "none" };

/** Resolve "this lead" against the most recent set of companies the conversation showed (newest first). */
export function resolvePronounCompany(setsNewestFirst: Array<PresentedReferentSet | null | undefined>): PronounResolution {
  const latest = setsNewestFirst.find((s) => s && Array.isArray(s.entities) && s.entities.length > 0);
  if (!latest) return { kind: "none" };
  const named = latest.entities.filter((e) => (e.name ?? e.label)?.trim());
  if (named.length === 1) return { kind: "one", name: (named[0].name ?? named[0].label).trim(), domain: named[0].domain ?? null };
  if (named.length > 1) return { kind: "many", names: named.slice(0, 8).map((e) => (e.name ?? e.label).trim()) };
  return { kind: "none" };
}

/** Which department a chat route belongs to. */
export function departmentForRoute(routeKind: string | null | undefined, request?: RequestV1 | null): Department {
  const parts = request?.parts ?? [];
  const entity = parts[0]?.subject.entity;
  const signalsAsked = parts.some((p) => p.subject.entity === "signal" || p.subject.entity === "competitor" || p.subject.entity === "market" ||
    (p.requirements ?? []).length > 0 && p.objective === "monitor");
  switch (routeKind) {
    case "lead_mission": case "research": case "source": return "atlas";
    case "monitor": return "lisa";
    case "compose": return "lyra";
    case "read": return signalsAsked ? "lisa" : entity === "content" ? "lyra" : entity === "company" || entity === "person" ? "atlas" : "orion";
    default: return "orion";
  }
}

const SMALL_TALK_RE = /^(?:hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|great|nice|perfect|got it|sounds good|good (?:morning|afternoon|evening)|bye|see you)\b/i;
const QUESTION_RE = /\?|\b(?:what|which|why|how|should|could|would|who|when|where|compare|explain|evaluate|recommend|is|are|does|do)\b/i;

/**
 * WHICH WORKFORCE TASK AN ORION CONVERSATIONAL REPLY IS — deterministic, no model.
 *
 *   strategic_prioritization  "what should we prioritize / focus on"
 *   simple_chat               greetings, thanks, acknowledgements, very short turns
 *   complex_company_qa        a real business question
 *
 * The hybrid router uses this so small talk never buys a premium model while a
 * business question can (when, and only when, AGENTORY_ROUTE_* says so).
 */
export function orionConverseTask(message: string): "strategic_prioritization" | "simple_chat" | "complex_company_qa" {
  const m = String(message ?? "").trim();
  if (PRIORITY_QUESTION_RE.test(m)) return "strategic_prioritization";
  const words = m.split(/\s+/).filter(Boolean).length;
  if (SMALL_TALK_RE.test(m) && words <= 6) return "simple_chat";
  if (words <= 3 && !m.includes("?")) return "simple_chat";
  return QUESTION_RE.test(m) || words >= 8 ? "complex_company_qa" : "simple_chat";
}
