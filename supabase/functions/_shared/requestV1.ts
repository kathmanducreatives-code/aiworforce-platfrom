// WHAT THE USER ASKED FOR, BEFORE ANY SURFACE CLAIMS IT.
//
// ── WHY THIS IS NOT `LeadMissionV1` ────────────────────────────────────────
//
// `LeadMissionV1` is the compiled contract for ONE surface. It carries
// `MissionCompanyProfile` (business models, verticals, stages, employee range),
// `MissionDecisionMakers`, `RequestedOutput` values like `contact_ready_leads`,
// and `required_capabilities` typed as the lead graph's own `CapabilityId`.
// Every one of those is meaningless for "what are my strongest signals?" or
// "turn that into a post", and forcing those requests through it is how a
// read becomes a purchase.
//
// So the universal object is deliberately SMALLER than the lead mission, not
// larger. It says what was asked; it does not say how any surface will serve
// it. `projectToLeadMission` is what turns one into the other, and it is the
// only place lead vocabulary appears.
//
// ── WHAT IS REUSED RATHER THAN REDEFINED ───────────────────────────────────
//
// Three vocabularies in this repo are already surface-neutral and hardened, so
// they are imported verbatim rather than re-declared:
//
//   SignalEvent / SignalSubject / SignalQualifier   missionSignalDescriptor.ts
//     Nine events, three subjects, and a qualifier that already carries
//     role_families, role_terms, topic, region, round_type and direction.
//     Nothing in it mentions leads.
//
//   FieldProvenance + outranks()                    leadMission.ts
//     A ranked precedence lattice — explicit_user_request beats workflow_edit
//     beats company_brain beats system_default beats gpt_inference. A request
//     needs exactly this to decide whether a later inference may overwrite an
//     earlier statement.
//
//   The feasibility grade vocabulary                requestFeasibility.ts
//     Referenced by Stage 0, unchanged.
//
// Redeclaring any of them would create a second vocabulary that drifts from
// the first, which is the failure this whole migration exists to avoid.
//
// Pure types plus narrow guards. No network, no database, no model.

import type {
  SignalEvent, SignalSubject, SignalQualifier,
} from "./missionSignalDescriptor.ts";
import type { FieldProvenance } from "./leadMission.ts";

export const REQUEST_V1_VERSION = "request-v1" as const;

/**
 * WHY THE USER IS ASKING, and therefore what the system is allowed to do.
 *
 * The distinction that matters most is `read` vs `research` vs `source`,
 * because it is the difference between answering for free, paying to check one
 * known thing, and paying to discover unknown things.
 *
 *   converse  no work product. An opinion, a question, a discussion.
 *   read      answer from evidence ALREADY HELD. Must reach no provider.
 *   research  fresh investigation of a KNOWN or REFERENCED entity.
 *   source    discovery of entities we do not yet know about.
 *   monitor   future or recurring observation.
 *   compose   produce content from evidence.
 *
 * `compose` is present from the start deliberately. The Content surface does
 * not exist yet, and a request that asks for one degrades to a clarification —
 * but the vocabulary must not have to change when it arrives, because changing
 * this union later means rewriting every projection that switches on it.
 */
export const REQUEST_OBJECTIVES = [
  "converse", "read", "research", "source", "monitor", "compose",
] as const;
export type RequestObjective = typeof REQUEST_OBJECTIVES[number];

const OBJECTIVE_SET: ReadonlySet<string> = new Set(REQUEST_OBJECTIVES);
export function isRequestObjective(s: string): s is RequestObjective {
  return OBJECTIVE_SET.has(s);
}

/** Objectives that may cause a provider to be paid. */
const SPENDING_OBJECTIVES: ReadonlySet<RequestObjective> = new Set<RequestObjective>([
  "research", "source", "monitor",
]);

/**
 * May this objective reach a paid provider AT ALL?
 *
 * `read` answering from held evidence is the invariant the objective split
 * exists to protect: a question about what we already know must never become a
 * purchase. Enforced structurally by the router — which never hands a `read`
 * an invoker — and asserted here so the rule has one statement.
 */
export function objectiveMaySpend(o: RequestObjective): boolean {
  return SPENDING_OBJECTIVES.has(o);
}

/** The kind of thing a request is about. */
export const REQUEST_ENTITIES = [
  "company", "person", "job", "signal", "content", "conversation",
  /**
   * A DRAFT WAITING FOR THE USER'S DECISION.
   *
   * Approvals are a first-class thing in this product — their own table, their
   * own nav item, their own dashboard counter — and the vocabulary simply did
   * not name them. "What's waiting for me to approve?" had to be forced into
   * `content`, which is a different question: the drafts Penn has written are
   * not the same set as the drafts still blocking on a person.
   *
   * Adding it is not a new capability. The surface already existed; it was
   * reachable only by a classifier category, so the semantic layer had no way to
   * ask for it.
   */
  "approval",
  /**
   * A CATEGORY, TOPIC OR PROBLEM SPACE — not an organisation.
   *
   * "What's happening in AI recruiting?", "how is the RevOps tooling market
   * moving?". The word is not invented here: `signal_events.subject_type` is
   * already `competitor | company | market`, and documents `market` in exactly
   * these terms. The semantic vocabulary was describing less than the persisted
   * one; this aligns them rather than adding a third.
   */
  "market",
  /**
   * A RIVAL OF THE WORKSPACE'S OWN BUSINESS.
   *
   * "Who are my competitors?", "what are Clay and 11x posting about?". Distinct
   * from `company` because the QUESTION is different: a competitor is defined by
   * its relationship to the workspace, so answering starts from the workspace's
   * own profile — its website, its description, the rivals it already named —
   * not from a population filter.
   *
   * Third and last of the words taken from `signal_events.subject_type`
   * (`competitor | company | market`), which has distinguished these all along.
   */
  "competitor",
] as const;
export type RequestEntity = typeof REQUEST_ENTITIES[number];

/**
 * A named thing the request points at.
 *
 * ── THE DISTINCTION THAT DECIDES WHERE A REFERENCE IS RESOLVED ─────────────
 *
 * Two of these three kinds point at something the system holds, and they are
 * resolved against COMPLETELY DIFFERENT corpora. Collapsing them is not a
 * naming detail; it is the difference between answering a question and
 * refusing it.
 *
 *   named        The user's own words for a thing. "Vercel". Resolved, if at
 *                all, by the surface that consumes it.
 *
 *   saved_set    A DURABLE WORKSPACE COLLECTION — "my leads", "my ICP", "the
 *                companies I'm watching". It lives in the database, it exists
 *                before this conversation started, and it survives after.
 *                Resolved by a SURFACE against workspace rows. It is NOT a
 *                back-reference and must never be resolved against chat
 *                referents: a fresh conversation holds none, so doing so turns
 *                every "what leads do I have?" into "which company do you
 *                mean?".
 *
 *   prior_result A CONVERSATIONAL REFERENT produced by an earlier turn in THIS
 *                conversation — "them", "the second company". Resolved by
 *                `resolveReferents` against the referents persisted on the
 *                message that displayed them, and by nothing else.
 *
 * `pointsBack()` in `referentBinding.ts` is the one place that decides which
 * corpus applies, and it admits `prior_result` alone.
 *
 * A reference is what separates `research` from `source`: investigating a
 * KNOWN entity requires one, and a request without any cannot be research.
 */
export interface RequestReference {
  kind: "named" | "saved_set" | "prior_result";
  /** The user's words, or a stable key when one is resolved. */
  value: string;
  /** Set once a referent is resolved to a real record. */
  resolved_key?: string | null;
}

/**
 * A population filter.
 *
 * DELIBERATELY GENERIC. `MissionCompanyProfile` has `verticals`, `stages`,
 * `employee_range` — company-shaped fields that a person, signal or content
 * request has no use for. Expressing the same thing as `{field, op, value}`
 * lets one shape serve every surface, and makes the lead projection the only
 * code that knows `employee_count` becomes `employee_range`.
 */
export interface RequestFilter {
  field: string;
  op: "eq" | "in" | "range" | "contains" | "not";
  value: unknown;
}

/** Canonical filter fields the Lead projection understands. Others are carried
 *  but not projected, and are reported as unrepresented rather than dropped. */
export const CANONICAL_FILTER_FIELDS = [
  "industry", "business_model", "geography", "employee_count", "stage",
  "company_name", "role",
] as const;

/**
 * Evidence that must hold for a candidate to satisfy the request.
 *
 * The existing signal descriptor, unchanged — this is the whole reason it was
 * worth auditing before designing. `phrase` is the user's own words for the
 * requirement, kept so a preview can quote the request rather than a
 * paraphrase of it.
 */
export interface RequestRequirement {
  event: SignalEvent;
  subject: SignalSubject;
  qualifier?: SignalQualifier;
  phrase: string;
  /** How recent the evidence must be. Null means the request did not say. */
  recency_days?: number | null;
}

/**
 * What to produce.
 *
 * `shape` is generic on purpose: `contact_ready_leads` is a PROJECTION of
 * `records` + `entity: person`, not a canonical concept. `count` is null when
 * the user asked for no particular number — the same honest distinction
 * `LeadMissionV1.requested_count` makes, kept for the same reason.
 */
export interface RequestOutput {
  shape: "records" | "events" | "answer" | "artifact";
  count: number | null;
}

/**
 * ONE SELF-CONTAINED ASK.
 *
 * A message may carry several — "find recently funded agencies and give me 3
 * post ideas" is two parts with a dependency, not one request with a confused
 * category. Phase F schedules them; the shape exists from the start so that
 * phase adds no new contract.
 */
export interface RequestPart {
  /** Stable within this request. Referenced by `depends_on`. */
  id: string;
  objective: RequestObjective;
  subject: {
    entity: RequestEntity;
    references?: RequestReference[];
    filters?: RequestFilter[];
  };
  requirements?: RequestRequirement[];
  output: RequestOutput;
  /** Part ids that must complete first. Empty or absent means independent. */
  depends_on?: string[];
}

/**
 * SOMETHING WE COULD NOT SETTLE.
 *
 * `blocking` is the field that matters. An ambiguity that could send paid work
 * at the wrong entity must stop the request; one that only narrows a result set
 * may be reported and proceeded past. The repo already draws this line in two
 * places under different names — `clarification_required` on
 * `leadEntityIntent` (we cannot tell what you mean) and
 * `unrepresented_requirements` on `LeadMissionV1` (we understood but cannot
 * express it) — and keeping both distinct here is what stops a Signals request
 * being refused by a Leads-shaped guard.
 */
export interface RequestAmbiguity {
  part_id: string | null;
  field: string;
  question: string;
  blocking: boolean;
}

/**
 * WHAT THIS REQUEST IS ALLOWED TO SPEND.
 *
 * On the REQUEST, never on the part. A mixed request has one budget, not one
 * per ask — otherwise decomposing a message would multiply what it may cost.
 */
export interface SpendAuthority {
  may_spend: boolean;
  max_cost_units: number | null;
  requires_confirmation: boolean;
}

export interface RequestV1 {
  version: typeof REQUEST_V1_VERSION;
  /** IMMUTABLE. The user's words, never a rewrite. Same rule as
   *  `LeadMissionV1.original_user_query`, and for the same reason. */
  utterance: string;
  /** The dominant objective. Individual parts may differ; this is what the
   *  request is FOR, and what a single-part request is routed by. */
  objective: RequestObjective;
  parts: RequestPart[];
  ambiguity: RequestAmbiguity[];
  authority: SpendAuthority;
  /** Which authority set each field. Reused lattice — see the header. */
  provenance: Record<string, FieldProvenance>;
  confidence: number;
}

/** Is any unresolved ambiguity severe enough to stop work? */
export function hasBlockingAmbiguity(r: RequestV1): boolean {
  return r.ambiguity.some((a) => a.blocking);
}

/**
 * May this request cause spend right now?
 *
 * Three independent conditions, all required. Separated so a refusal can say
 * WHICH one failed rather than "not allowed".
 */
export function requestMaySpend(r: RequestV1): {
  allowed: boolean;
  reason: "ok" | "objective_is_free" | "blocked_by_ambiguity" | "no_authority";
} {
  if (!r.authority.may_spend) return { allowed: false, reason: "no_authority" };
  if (hasBlockingAmbiguity(r)) return { allowed: false, reason: "blocked_by_ambiguity" };
  if (!r.parts.some((p) => objectiveMaySpend(p.objective))) {
    return { allowed: false, reason: "objective_is_free" };
  }
  return { allowed: true, reason: "ok" };
}

/** Parts in dependency order, or null when the graph has a cycle. */
export function orderParts(parts: readonly RequestPart[]): RequestPart[] | null {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const state = new Map<string, 0 | 1 | 2>();
  const out: RequestPart[] = [];
  let cyclic = false;
  const visit = (id: string) => {
    if (cyclic) return;
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) { cyclic = true; return; }
    const p = byId.get(id);
    if (!p) return;                       // a dangling id is not a cycle
    state.set(id, 1);
    for (const d of p.depends_on ?? []) visit(d);
    state.set(id, 2);
    out.push(p);
  };
  for (const p of parts) visit(p.id);
  return cyclic ? null : out;
}
