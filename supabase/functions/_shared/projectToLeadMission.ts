// A UNIVERSAL REQUEST, EXPRESSED IN THE LEAD SURFACE'S OWN TERMS.
//
// ── WHY THIS PROJECTS INTO A PROPOSAL, NOT INTO A MISSION ──────────────────
//
// The obvious shape for this module is `RequestV1 -> LeadMissionV1`, building
// the mission field by field. That shape is wrong, and expensively so.
//
// `LeadMissionV1` is not merely a struct; it is the OUTPUT of
// `compileLeadMission`, which merges the model proposal with the Company
// Brain, applies provenance precedence, derives `required_capabilities`,
// records `unrepresented_requirements`, and computes `missionHash` — the value
// that IS checkpoint identity for every persisted run in the system. A second
// constructor would have to reproduce all of that, and any drift between the
// two would orphan checkpoints silently.
//
// So this projects into `GptMissionProposal` — the shape the compiler already
// accepts from the model — and lets the EXISTING compiler produce the mission.
// Equivalence is then structural rather than re-derived: the same compiler,
// the same brain merge, the same hash, by construction.
//
//     RequestV1 ──► GptMissionProposal ──► compileLeadMission ──► LeadMissionV1
//                                          ^^^^^^^^^^^^^^^^^^ unchanged
//
// ── WHAT THIS MODULE IS ALLOWED TO KNOW ────────────────────────────────────
//
// This is the ONLY file in the new path that may mention lead vocabulary.
// `RequestV1` does not know what `contact_ready_leads` is; the compiler does
// not know what a `RequestPart` is. Everything lead-specific about a universal
// request lives here, which is what keeps `LeadMissionV1` lead-specific.
//
// ── WHAT IT REFUSES TO GUESS ───────────────────────────────────────────────
//
// A filter this surface has no field for is NOT dropped. It is returned in
// `unprojected`, so the caller can report it the way
// `unrepresented_requirements` already reports a discarded requirement — a
// requirement silently lost is the failure mode the mission contract was built
// to prevent, and a new layer must not reintroduce it.
//
// Pure. No network, no database, no model.

import type {
  RequestV1, RequestPart, RequestFilter, RequestRequirement,
} from "./requestV1.ts";
import type {
  GptMissionProposal, ProposalConstraint, ProposalPreference,
} from "./leadMissionCompiler.ts";
import type { ResolvedReferentBinding } from "./referentBinding.ts";

export const LEAD_PROJECTION_VERSION = "request-v1-to-lead-proposal-1" as const;

/** Entities the Lead surface can serve. Anything else is not its request. */
const LEAD_ENTITIES: ReadonlySet<string> = new Set(["company", "person", "job"]);

export interface LeadProjection {
  /** Ready for `compileLeadMission({ originalUserQuery, proposal, ... })`. */
  proposal: GptMissionProposal;
  /** Passed alongside; the compiler keeps the honest null. */
  requestedCount: number | null;
  /** Filters and requirements this surface has no vocabulary for. */
  unprojected: string[];
  /** Why the Lead surface cannot serve this request at all. Null when it can. */
  refusal: LeadProjectionRefusal | null;
}

export type LeadProjectionRefusal =
  /** No part asks for a company, person or job. */
  | "not_a_lead_request"
  /** The objective produces no records — `read`, `converse`, `compose`. */
  | "objective_not_servable"
  /** An unresolved ambiguity could send paid work at the wrong entity. */
  | "blocked_by_ambiguity"
  /**
   * A `research` part named nobody.
   *
   * ── WHY THIS IS FATAL RATHER THAN A FALLBACK ────────────────────────────
   *
   * `research` means fresh evidence about an entity the user identified;
   * `source` means discovering entities nobody has named. The capability graph
   * already separates them — `known_companies` non-empty enters at
   * `known_company_resolution` and skips discovery entirely — but it separates
   * them by DATA, not by objective. So a research request that carries no
   * identifier produces an empty `known_companies`, falls to
   * `general_company_discovery`, and buys a full discovery run to answer a
   * question about one company.
   *
   * Measured: "Check whether they're hiring salespeople." with no resolved
   * reference produced `entry: general_company_discovery` and a discovery step.
   * That is the collapse this refusal ends, and it is a spend risk, not a
   * cosmetic one.
   */
  | "research_without_identity";

/** The compiler's own empty proposal, stated once. */
function emptyProposal(): GptMissionProposal {
  return {
    requested_opportunity_count: null,
    requested_contact_ready_count: null,
    company_types: [],
    geographies: [],
    employee_range: { min: null, max: null },
    decision_maker_roles: [],
    hard_constraints: [],
    soft_preferences: [],
    preferred_signals: [],
    adjacent_signals: [],
    excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: [],
    required_evidence: [],
    required_capabilities: [],
    preferred_source_strategy: [],
    evaluation_instructions: "",
    founder_unlock_recommended: false,
    confidence: 0,
    unknowns: [],
    known_companies: [],
    signal_recency_days: null,
    required_signal_terms: [],
    no_broadening_requested: false,
    // A stated geography NARROWS a search; whether it may also REJECT a company
    // is a qualification question the request does not answer, so the compiler's
    // own default stands.
    geography_is_hard: false,
    prohibitions: [],
    // Left null on purpose. `RequestOutput.shape` says `records`; WHICH record
    // — `qualified_companies` or `contact_ready_leads` — is derived by the
    // compiler from the entity and the count fields set below. Asserting it
    // here would give two authorities one answer.
    output_intent: null,
    strategies: [],
  };
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean)
  : typeof v === "string" && v.trim() ? [v.trim()] : [];

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Fold one filter into the proposal.
 *
 * Returns false when this surface has no field for it, so the caller can
 * report rather than discard.
 */
function applyFilter(p: GptMissionProposal, f: RequestFilter): boolean {
  switch (f.field) {
    case "industry":
    case "business_model":
      p.company_types.push(...strs(f.value));
      return true;
    case "geography":
      p.geographies.push(...strs(f.value));
      return true;
    case "employee_count": {
      // `range` carries {min,max}; `eq` carries a single number, which the
      // compiler represents as a degenerate range rather than a new field.
      const v = f.value as { min?: unknown; max?: unknown } | number | null;
      if (typeof v === "number") { p.employee_range = { min: v, max: v }; return true; }
      if (v && typeof v === "object") {
        p.employee_range = { min: num(v.min), max: num(v.max) };
        return true;
      }
      return false;
    }
    case "company_name":
      p.known_companies.push(...strs(f.value));
      return true;
    case "role":
      p.decision_maker_roles.push(...strs(f.value));
      return true;
    case "stage":
      // The compiler reads stage through `hard_constraints`, which is where a
      // named-but-unmodelled axis belongs — carried, not invented as a field.
      for (const s of strs(f.value)) {
        p.hard_constraints.push({
          field: "stage", operator: f.op, value: s,
          reason: "stated in the request",
        } as ProposalConstraint);
      }
      return true;
    default:
      return false;
  }
}

/**
 * Fold one requirement into the proposal's signal vocabulary.
 *
 * Returns the qualifier fields this surface has no channel for, so the caller
 * reports them rather than losing them.
 *
 * ── WHY SOME QUALIFIERS DO NOT FIT ─────────────────────────────────────────
 *
 * `SignalQualifier` is the general vocabulary: role_families, role_terms,
 * topic, region, round_type, direction. `GptMissionProposal` has exactly one
 * channel for it — `required_signal_terms`, which reaches title matching. A
 * comment's TOPIC and an expansion's REGION have nowhere to go.
 *
 * Measured, not assumed. Compiling "Find European SaaS companies expanding
 * into the US" through this projection produced `qualifier: {}` where the
 * deterministic reading produced `{region: "us"}`; the same for
 * `{topic: "sales automation"}`. `direction` survives only because the
 * compiler re-derives it from the query text.
 *
 * Reporting them is the honest interim: the Lead surface genuinely cannot
 * express them today, and saying so out loud is what
 * `unrepresented_requirements` already does for the same class of loss.
 * Silently dropping them would make a narrower search look like the one that
 * was asked for.
 */
const PROJECTABLE_QUALIFIER_FIELDS: ReadonlySet<string> = new Set([
  "role_families", "role_terms",
  // Re-derived by the compiler from the query, so not a loss.
  "direction",
]);

function applyRequirement(p: GptMissionProposal, r: RequestRequirement): string[] {
  if (!p.preferred_signals.includes(r.event)) p.preferred_signals.push(r.event);
  // THE USER'S OWN ROLE WORDS, kept verbatim. `required_signal_terms` is what
  // reaches title matching, and paraphrasing it here would change which jobs
  // count as evidence.
  for (const t of r.qualifier?.role_terms ?? []) {
    if (!p.required_signal_terms.includes(t)) p.required_signal_terms.push(t);
  }
  if (r.recency_days != null && p.signal_recency_days == null) {
    p.signal_recency_days = r.recency_days;
  }
  const lost: string[] = [];
  for (const [k, v] of Object.entries(r.qualifier ?? {})) {
    if (v == null || (Array.isArray(v) && v.length === 0)) continue;
    if (!PROJECTABLE_QUALIFIER_FIELDS.has(k)) lost.push(`qualifier:${k}`);
  }
  return lost;
}

/** The parts this surface is able to serve. */
function leadParts(r: RequestV1): RequestPart[] {
  return r.parts.filter((p) =>
    LEAD_ENTITIES.has(p.subject.entity) &&
    (p.objective === "source" || p.objective === "research" || p.objective === "monitor") &&
    p.output.shape === "records");
}

/**
 * Project a universal request into the Lead surface's proposal.
 *
 * Total: every input yields a result. A request this surface cannot serve
 * returns a `refusal` and an untouched proposal rather than a partial one —
 * a half-built mission is the thing Stage 0 exists to refuse, and producing
 * one here would move that refusal somewhere less honest.
 */
export function projectToLeadMission(
  request: RequestV1,
  /**
   * The bindings the RESOLVER produced, if any.
   *
   * The request itself is never mutated — the semantic object stays what the
   * model said. This is the sidecar being READ, which is the only way a
   * resolved referent can contribute a real company name to the proposal.
   */
  bindings: readonly ResolvedReferentBinding[] = [],
): LeadProjection {
  const unprojected: string[] = [];
  const proposal = emptyProposal();

  if (request.ambiguity.some((a) => a.blocking)) {
    return { proposal, requestedCount: null, unprojected, refusal: "blocked_by_ambiguity" };
  }

  const parts = leadParts(request);
  if (parts.length === 0) {
    // Distinguish "not our entity" from "our entity, wrong objective", because
    // the two produce different answers to the user.
    const anyLeadEntity = request.parts.some((p) => LEAD_ENTITIES.has(p.subject.entity));
    return {
      proposal, requestedCount: null, unprojected,
      refusal: anyLeadEntity ? "objective_not_servable" : "not_a_lead_request",
    };
  }

  // ── RESEARCH REQUIRES AN IDENTITY, BEFORE ANYTHING IS PROJECTED ──────────
  //
  // Checked here as well as in the router, deliberately: the router owns what a
  // request CAUSES, but a caller that projects directly must not be able to
  // turn a nameless research request into a discovery run.
  const researchParts = parts.filter((p) => p.objective === "research");
  const identified = (p: RequestPart) =>
    (p.subject.references ?? []).some((r) => (r.resolved_key ?? r.value ?? "").trim()) ||
    (p.subject.filters ?? []).some((f) => f.field === "company_name");
  if (researchParts.length > 0 && !researchParts.some(identified)) {
    return {
      proposal: emptyProposal(), requestedCount: null, unprojected,
      refusal: "research_without_identity",
    };
  }

  let requestedCount: number | null = null;
  let wantsPeople = false;

  for (const part of parts) {
    if (part.subject.entity === "person") wantsPeople = true;

    for (const f of part.subject.filters ?? []) {
      if (!applyFilter(proposal, f)) {
        unprojected.push(`filter:${f.field}`);
      }
    }
    for (const req of part.requirements ?? []) {
      unprojected.push(...applyRequirement(proposal, req));
    }

    // WHICH COMPANY THIS PART WAS BOUND TO, if the resolver bound one.
    const bound = bindings.find(
      (b) => b.part_id === part.id && b.entity_type === "company");

    for (const ref of part.subject.references ?? []) {
      // ── THE NAME TRAVELS, THE URL DOES NOT ──────────────────────────────
      //
      // `scanProposalForViolations` refuses ANY url anywhere in a proposal —
      // the same scan that blocks actor references and vendor names — because
      // a proposal that can name a URL can name a provider. Passing a resolved
      // LinkedIn key here is a FATAL compilation error
      // (`url:known_companies[0]`), not a nicety.
      //
      // Passing the name is also the right pipeline behaviour: resolving a
      // named company to an identity is exactly what `known_company_resolution`
      // exists to do, and it is the entry capability for these missions.
      //
      // A resolved referent therefore needs a channel that is NOT the proposal.
      // Phase E owns that; until it exists, a referent contributes its label
      // and the pipeline re-resolves it.
      // ── A BOUND REFERENT CONTRIBUTES THE COMPANY'S NAME, NOT THE WORD ──
      //
      // Without this, "check the second company" put the literal string "the
      // second company" into `known_companies` and the mission asked the
      // pipeline to go and find a company by that name. The binding is what
      // knows the phrase meant Linear.
      //
      // STILL ONLY A NAME. The binding's exact identity — its domain and its
      // LinkedIn URL — does NOT come through here; it travels in the sidecar to
      // `known_company_resolution`. So `scanProposalForViolations` is unweakened
      // and still refuses every URL, and the guard below makes that structural
      // rather than a property of whatever produced the label: a company name
      // has no slash in it, and anything that does falls back to the resolved
      // name and then to the user's own words.
      const boundName = bound
        ? [bound.label, bound.identity.name].find(
          (v): v is string => typeof v === "string" && !!v.trim() && !v.includes("/"))
        : undefined;
      const label = (boundName ?? ref.value ?? "").trim();
      if (label) proposal.known_companies.push(label);
    }

    // THE HIGHEST COUNT ANY PART ASKED FOR. Null stays null — "the user asked
    // for no particular number" is a distinct fact the mission preserves, and
    // defaulting here would erase it.
    if (part.output.count != null) {
      requestedCount = Math.max(requestedCount ?? 0, part.output.count);
    }
  }

  // ── WHICH COUNT FIELD THE COMPILER ACTUALLY READS ────────────────────────
  //
  // `requested_opportunity_count`, always — measured, not assumed. The obvious
  // reading is that a person request should fill
  // `requested_contact_ready_count`, and that is what this did first. Compiling
  // "Find founders of US B2B SaaS startups hiring Sales Operations. Return 25
  // qualified leads." with only that field set produced
  // `requested_count: null`: the number the user said, silently dropped.
  //
  // The contact-ready figure is still stated for a person request, from the
  // SAME source value, so the two can never disagree — it says how many
  // contact-ready leads are wanted, while `requested_opportunity_count` is what
  // becomes the mission's `requested_count`.
  proposal.requested_opportunity_count = requestedCount;
  if (wantsPeople) proposal.requested_contact_ready_count = requestedCount;

  proposal.confidence = request.confidence;
  // NON-BLOCKING AMBIGUITY IS AN UNKNOWN, NOT A SILENCE. `unknowns` is the
  // compiler's existing channel for "the request said something we could not
  // pin down", and it feeds `unrepresented_requirements`.
  proposal.unknowns = request.ambiguity.filter((a) => !a.blocking).map((a) => a.question);

  const dedupe = <T,>(a: T[]): T[] => [...new Set(a)];
  proposal.company_types = dedupe(proposal.company_types);
  proposal.geographies = dedupe(proposal.geographies);
  proposal.known_companies = dedupe(proposal.known_companies);
  proposal.decision_maker_roles = dedupe(proposal.decision_maker_roles);

  return { proposal, requestedCount, unprojected: dedupe(unprojected), refusal: null };
}
