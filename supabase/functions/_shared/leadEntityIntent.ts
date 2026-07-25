// Immutable, typed Lead ENTITY Intent — the authoritative "what output entity did
// the user request?" layer, compiled from the ORIGINAL user instruction (+ optional
// Company Brain). Deterministic-first; pure (imports only pure role/market parsers).
// No AI selects an actor and no planner-rewritten prose can change target_entity.
//
// This complements the existing leadSearchIntent.ts (which structures search
// DIMENSIONS: categories/roles/triggers/funding/geo). That module has no notion of
// the requested output ENTITY — the gap that let a founder (person) request route
// to the jobs actor (live Q1 plan da79cba3). Signals (hiring/funding/…) qualify the
// people/companies but NEVER set the entity.

import { parsePersonRoles, parseMarketTerms } from "./peopleSearchQueryBuilder.ts";
import type { ExplicitTimingWindow } from "./timingFreshnessPolicy.ts";
import { compileJobSearchSpec, type CompiledJobSearchSpec } from "./jobSearchSpec.ts";

export type TargetEntity = "person" | "company" | "job";
export type OutputType = "qualified_people" | "qualified_companies" | "job_postings";
export type ArtifactType = "person_candidate" | "company_candidate" | "job_signal";
export type LeadSignalType = "hiring" | "funding" | "product_launch" | "expansion" | "new_executive" | "recent_post";

/**
 * SOURCING ORDER for the compiled intent — the compound-intent model.
 *   person_first  — pure people lookup ("find founders in Austin"). No company gate.
 *   company_first — the request qualifies a COMPANY (and/or a company-level signal)
 *                   even when the final output is a person: verify the company + its
 *                   signal FIRST, then find the requested person INSIDE the verified
 *                   company ("founders of SaaS startups hiring Sales Operations").
 *   job_first     — a job/hiring-signal search is the primary lookup.
 * A person noun NEVER erases the company/signal dimensions; it only sets the final
 * output ENTITY. company_gate_required is the invariant the runtime + gates enforce.
 */
export type ExecutionMode = "person_first" | "company_first" | "job_first";

/**
 * How FRESH must the supporting evidence be for the requested output?
 *   identity_only    — "decision-makers at Acme": prove who they are.
 *   current_fit      — "founders of B2B SaaS companies": prove current ICP fit.
 *   recent_signal    — "companies hiring engineers": prove a recent signal.
 *   hot_opportunity  — "hot founders to contact right now": fit AND current timing.
 * Freshness qualifies the evidence contract; it NEVER changes target_entity.
 */
export type FreshnessRequirement = "identity_only" | "current_fit" | "recent_signal" | "hot_opportunity";

export interface IntentEvidenceSpan { field: string; value: string; evidence: string[] }
export interface LeadSignalIntent {
  type: LeadSignalType;
  evidence: string[];
  /**
   * A window the user stated EXPLICITLY ("funded this week"). Typed and compiled
   * here from the immutable instruction so downstream layers never re-guess it from
   * loose keywords. Absent ⇒ the general per-category policy applies.
   */
  window?: ExplicitTimingWindow;
}

export interface LeadEntityIntent {
  version: 1;
  original_user_instruction: string;
  target_entity: TargetEntity;
  output_type: OutputType;
  requested_count: number | null;
  person_roles: string[];
  company_categories: string[];
  geographies: string[];
  signals: LeadSignalIntent[];
  /** SOURCING ORDER — see ExecutionMode. Additive; existing consumers ignore it. */
  execution_mode: ExecutionMode;
  /** The person the request ultimately wants ("founder") when company-first; null
   * for pure company/job searches. Preserved so the scoped people search knows the
   * requested role without re-parsing. */
  requested_person_role: string | null;
  /** INVARIANT flag: a candidate for this request cannot reach CONTACT until a
   * target COMPANY is verified/qualified. True for compound "person of <company>"
   * and for pure company/job-qualified requests. */
  company_gate_required: boolean;
  /** A company-level hiring signal is part of the request (drives jobs-first). */
  hiring_signal_required: boolean;
  /** DETERMINISTIC provider search plan for the hiring signal. The jobs actor is
   * driven by THIS, never by original_user_instruction — sending the whole
   * sentence as LinkedIn keywords is what produced 25 irrelevant jobs and zero
   * qualified companies in the 2026-07-25 live run. `not_applicable` for requests
   * with no employer-side hiring signal. */
  job_search_spec: CompiledJobSearchSpec;
  /** Evidence freshness the request demands. Derived from the ORIGINAL instruction;
   * qualifies the evidence contract, never the target entity. */
  freshness: FreshnessRequirement;
  hard_constraints: string[];
  soft_constraints: string[];
  confidence: number;               // 0..1
  clarification_required: boolean;  // true when the target entity can't be established
  evidence_spans: IntentEvidenceSpan[];
}

const lc = (s: unknown) => String(s ?? "").toLowerCase();

// --- explicit requested-OUTPUT phrases (what the user wants returned) ----------
// The last alternation covers a plain "<role> jobs in <place>" ask, which the
// 2026-07-25 review found fell through to clarification_required (placeholder
// person) instead of the job-first path it plainly is.
const JOB_OUTPUT_RE = /\b(job openings?|job postings?|job posts?|open positions?|vacan(?:cy|cies)|open [a-z/ ]{0,20}?(?:jobs?|roles?|positions?)|current [a-z ]{0,20}?jobs?|jobs? (?:open|available|posted)|which jobs?\b|open jobs?|[a-z][a-z ]{1,40}\bjobs?\s+(?:in|near|across|within)\b)/i;
const PERSON_NOUN_RE = /\b(co-?founders?|founders?|ceos?|ctos?|cfos?|coos?|cmos?|cros?|chief [a-z]+ officers?|executives?|decision[-\s]?makers?|buying committee|people|persons?|contacts?|leaders?|operators?|prospects?|buyers?|heads? of\b|vps?|owners?|managing directors?|presidents?|candidates?|job seekers?)\b/i;
const WHO_TO_CONTACT_RE = /\bwho (?:should i|to|can i|do i)\s+(?:contact|reach out to|target|talk to|email|message)\b/i;
const COMPANY_NOUN_RE = /\b(companies|company|startups?|accounts?|businesses|business|orgs?|organi[sz]ations?|firms?|vendors?|employers?|integrators?|manufacturers?)\b/i;

// "<person> OF/AT <company>" — a strong compound signal that the request wants a
// person INSIDE a qualified company (so the text after the connector qualifies a
// company even when parseMarketTerms misses the vertical, e.g. "integrators").
const PERSON_OF_COMPANY_RE = /\b(co-?founders?|founders?|owners?|presidents?|ceos?|ctos?|cfos?|coos?|executives?|leaders?|heads?|managing directors?|vps?|decision[-\s]?makers?)\s+(?:of|at|from|for|running|leading|behind|within|inside)\s+/i;

// Job-SEEKER phrasing — the PERSON is looking for a job. This is NEVER a company
// hiring signal and must stay a pure people search (Case F).
const JOB_SEEKER_RE = /\b(looking for (?:work|a (?:new )?(?:job|role|position|opportunity))|open to work|#?opentowork|seeking (?:work|employment|a (?:new )?(?:job|role|position|opportunity)|opportunities|new opportunities)|job seekers?|available for hire|candidates? (?:looking|seeking|open to work|available|who are looking|for hire))\b/i;

// --- signals (qualify people/companies; NEVER set the entity) ------------------
const SIGNAL_PATTERNS: Array<[LeadSignalType, RegExp]> = [
  ["hiring", /\bhiring\b|\bhiring signals?\b|\bhiring for\b/i],
  ["funding", /\b(recently )?funded\b|\braised (?:funding|capital|a round|\$)|series [a-e]\b|seed round\b|pre-?seed\b/i],
  ["product_launch", /\bproduct launch(?:ed|ing)?\b|\bnew product\b|\bjust launched\b/i],
  ["expansion", /\bexpanding\b|\bexpansion\b|\bscaling (?:up|out|fast|sales|gtm)?\b|\bgrowing (?:their|the) (?:team|sales)\b/i],
  ["new_executive", /\bnew (?:ceo|cto|cfo|coo|cmo|vp|head|exec|executive)\b|\bjust hired a\b/i],
  ["recent_post", /\brecently posted\b|\brecent posts?\b|\bposted (?:on|about)\b|\bengaging with\b/i],
];

/**
 * Explicit timing windows the user can state. Ordered STRICTEST FIRST so
 * "funded this week" never matches the looser "recently" pattern first.
 *
 * These are typed intent, not downstream keyword guessing: the compiled window
 * travels with the signal and the stricter of (explicit, general policy) wins.
 */
const WINDOW_PATTERNS: Array<[ExplicitTimingWindow, RegExp]> = [
  ["this_week", /\b(?:this|the past|the last)\s+week\b|\bin the last 7 days\b|\bpast 7 days\b/i],
  ["this_month", /\b(?:this|the past|the last)\s+month\b|\bin the last 30 days\b|\bpast 30 days\b/i],
  ["last_60_days", /\b(?:in |over )?(?:the )?(?:last|past)\s+(?:60|sixty)\s+days\b/i],
  ["last_6_months", /\b(?:in |over )?(?:the )?(?:last|past)\s+(?:6|six)\s+months\b|\bin the last 180 days\b/i],
  // "recently" is resolved PER CATEGORY: 90d for funding, 30d for hiring.
  ["recently", /\brecent(?:ly)?\b|\bjust\b|\bnewly\b/i],
];

const COUNT_RE = /\b(\d{1,3})\b/;
const GEO_PATTERNS: Array<[RegExp, string]> = [
  [/\bunited states\b|\bu\.?s\.?a?\.?\b|\bamerica\b/i, "United States"],
  [/\bunited kingdom\b|\bu\.?k\.?\b|\bbritain\b/i, "United Kingdom"],
  [/\bnew york(?: city)?\b|\bnyc\b/i, "New York"],
  [/\bsan francisco\b|\bsf bay\b|\bbay area\b/i, "San Francisco"],
  [/\blondon\b/i, "London"],
  [/\bcanada\b/i, "Canada"],
  [/\baustralia\b/i, "Australia"],
  [/\bremote\b/i, "Remote"],
];

function firstMatch(re: RegExp, text: string): string | null {
  const m = text.match(re);
  return m ? m[0] : null;
}

// --- freshness (qualifies the evidence contract; never the entity) -------------
// "hot"/"right now"/"ready to buy" ⇒ fit AND current timing must be proven.
const HOT_RE = /\bhot\b|\bright now\b|\bthis week\b|\bready to (?:buy|talk)\b|\bwarm(?:est)?\b|\burgent(?:ly)?\b|\bhigh[-\s]?intent\b/i;
// A named-account lookup with no fit/signal terms only needs identity.
const AT_NAMED_ACCOUNT_RE = /\b(?:at|from|inside|within)\s+(?:these\s+|the\s+)?(?:accounts?|companies|orgs?)\b|\b(?:at|from)\s+[A-Z][A-Za-z0-9&.\- ]{1,40}\b/;

/** Derive the evidence-freshness requirement from the ORIGINAL instruction.
 * Precedence: hot_opportunity → recent_signal (explicit signal) → identity_only
 * (named-account lookup, no fit/signal terms) → current_fit (default). */
export function deriveFreshnessRequirement(args: {
  text: string;
  signals: LeadSignalIntent[];
  company_categories: string[];
}): FreshnessRequirement {
  const t = args.text ?? "";
  if (HOT_RE.test(t)) return "hot_opportunity";
  if (args.signals.length > 0) return "recent_signal";
  const namedAccountLookup = AT_NAMED_ACCOUNT_RE.test(t) && args.company_categories.length === 0;
  if (namedAccountLookup) return "identity_only";
  return "current_fit";
}

/**
 * Compile the immutable ENTITY intent from the ORIGINAL user instruction. The
 * requested output ENTITY is derived from explicit target nouns / requested-output
 * phrases; signals (hiring/funding/…) qualify but never set the entity.
 * Precedence: explicit job-postings request → job; any person noun → person
 * (signals do not flip); company noun → company; otherwise clarification_required.
 */
export function compileLeadEntityIntent(
  originalInstruction: string | null | undefined,
  opts?: { brainCategories?: string[]; brainGeographies?: string[] },
): LeadEntityIntent {
  const original = String(originalInstruction ?? "");
  const text = original;
  const evidence_spans: IntentEvidenceSpan[] = [];

  // An explicit window qualifies whichever signals the request names ("funded this
  // week"). Strictest pattern wins; absent ⇒ the general per-category policy applies.
  let explicitWindow: ExplicitTimingWindow | undefined;
  let windowEvidence: string | undefined;
  for (const [w, re] of WINDOW_PATTERNS) {
    const ev = firstMatch(re, text);
    if (ev) { explicitWindow = w; windowEvidence = ev; break; }
  }

  const signals: LeadSignalIntent[] = [];
  for (const [type, re] of SIGNAL_PATTERNS) {
    const ev = firstMatch(re, text);
    if (ev) signals.push({ type, evidence: [ev], ...(explicitWindow ? { window: explicitWindow } : {}) });
  }
  if (explicitWindow && windowEvidence && signals.length) {
    evidence_spans.push({ field: "signal_window", value: explicitWindow, evidence: [windowEvidence] });
  }

  const jobEv = firstMatch(JOB_OUTPUT_RE, text);
  const personEv = firstMatch(PERSON_NOUN_RE, text) ?? firstMatch(WHO_TO_CONTACT_RE, text);
  const companyEv = firstMatch(COMPANY_NOUN_RE, text);

  let target_entity: TargetEntity | null = null;
  let confidence = 0.9;
  if (jobEv && !personEv) {
    target_entity = "job";
    evidence_spans.push({ field: "target_entity", value: "job", evidence: [jobEv] });
  } else if (personEv) {
    target_entity = "person";
    evidence_spans.push({ field: "target_entity", value: "person", evidence: [personEv] });
    if (jobEv) confidence = 0.6; // mixed person + job-output phrasing
  } else if (companyEv) {
    target_entity = "company";
    evidence_spans.push({ field: "target_entity", value: "company", evidence: [companyEv] });
  }

  const clarification_required = target_entity == null;
  if (clarification_required) {
    target_entity = "person"; // placeholder; caller MUST honor clarification_required
    confidence = 0.2;
  }

  const output_type: OutputType =
    target_entity === "person" ? "qualified_people"
      : target_entity === "company" ? "qualified_companies"
        : "job_postings";

  const person_roles = parsePersonRoles(text);
  if (person_roles.length) evidence_spans.push({ field: "person_roles", value: person_roles.join(","), evidence: person_roles });
  const company_categories = Array.from(new Set([...parseMarketTerms(text), ...(opts?.brainCategories ?? [])]));
  const geographies: string[] = [];
  for (const [re, g] of GEO_PATTERNS) if (re.test(text) && !geographies.includes(g)) geographies.push(g);
  for (const g of opts?.brainGeographies ?? []) if (!geographies.includes(g)) geographies.push(g);

  const countM = text.match(COUNT_RE);
  const requested_count = countM ? Math.max(1, Math.min(1000, Number(countM[1]))) : null;
  for (const s of signals) evidence_spans.push({ field: "signal", value: s.type, evidence: s.evidence });

  // ---- Compound execution model ------------------------------------------------
  // A person noun sets the final output ENTITY but NEVER erases the company/signal
  // dimensions. When a person request also qualifies a company (an explicit company
  // noun/vertical, a "<person> of <company>" phrasing, or ANY company-level signal
  // such as hiring/funding/expansion), sourcing must be COMPANY-FIRST and CONTACT is
  // gated on a verified company. A pure person lookup, or job-seeker phrasing, stays
  // person-first with no invented company gate.
  const isJobSeeker = JOB_SEEKER_RE.test(text);
  const personOfCompany = PERSON_OF_COMPANY_RE.test(text);
  const hasHiringSignal = signals.some((s) => s.type === "hiring");
  const hasCompanySignal = signals.length > 0; // hiring/funding/expansion/… are company-level
  const hasCompanyQualifier = company_categories.length > 0 || companyEv != null || personOfCompany;

  let execution_mode: ExecutionMode;
  let company_gate_required: boolean;
  let hiring_signal_required = hasHiringSignal && !isJobSeeker;
  let requested_person_role: string | null = null;

  if (target_entity === "person") {
    requested_person_role = person_roles[0] ? lc(person_roles[0]).trim() : (personEv ? lc(personEv).replace(/s\b/, "").trim() : null);
    if (!isJobSeeker && (hasCompanyQualifier || hasCompanySignal)) {
      execution_mode = "company_first";
      company_gate_required = true;
      if (personOfCompany) evidence_spans.push({ field: "execution_mode", value: "company_first", evidence: [firstMatch(PERSON_OF_COMPANY_RE, text) ?? "person-of-company"] });
    } else {
      execution_mode = "person_first";
      company_gate_required = false;
      hiring_signal_required = false; // pure person / job-seeker: no company gate
    }
  } else if (target_entity === "company") {
    execution_mode = "company_first";
    company_gate_required = true;
  } else { // job
    execution_mode = "job_first";
    company_gate_required = hasCompanyQualifier;
  }
  if (clarification_required) { execution_mode = "person_first"; company_gate_required = false; hiring_signal_required = false; }

  return {
    version: 1,
    original_user_instruction: original,
    target_entity: target_entity!,
    output_type,
    requested_count,
    person_roles,
    company_categories,
    geographies,
    signals,
    execution_mode,
    requested_person_role,
    company_gate_required,
    hiring_signal_required,
    job_search_spec: compileJobSearchSpec({
      text,
      hiringSignalRequired: hiring_signal_required,
      requestedPersonRole: requested_person_role,
      personRoles: person_roles,
      jobFirst: execution_mode === "job_first",
    }),
    freshness: deriveFreshnessRequirement({ text, signals, company_categories }),
    hard_constraints: [],
    soft_constraints: signals.map((s) => `signal:${s.type}`),
    confidence,
    clarification_required,
    evidence_spans,
  };
}

// ------------------------------------------------------------- actor plan -------

export interface ActorRef { actor_key: string; actor_implementation: string }
export type RoutingSource = "persisted_intent_contract" | "original_user_instruction" | "explicit_validated_override";

export interface ProviderActorPlan {
  target_entity: TargetEntity;
  /** SOURCING ORDER from the intent. company_first ⇒ run the evidence (jobs) stage
   * BEFORE the identity actor, and gate the final person on a verified company. */
  execution_mode: ExecutionMode;
  /** Convenience mirror of execution_mode === "company_first". */
  company_first: boolean;
  primary_identity_actor: ActorRef;
  evidence_actors: ActorRef[];
  final_artifact_type: ArtifactType;
  routing_source: RoutingSource;
  confidence: number;
}

// Canonical default implementations (the runtime resolves the real actor_id via
// ACTOR_REGISTRY; these are the known defaults for the plan/provenance).
export const ACTOR_IMPL: Record<string, string> = {
  apify_people_search: "harvestapi/linkedin-profile-search",
  apify_jobs: "curious_coder/linkedin-jobs-scraper",
};
const ref = (key: string): ActorRef => ({ actor_key: key, actor_implementation: ACTOR_IMPL[key] ?? key });

export function expectedArtifactType(target: TargetEntity): ArtifactType {
  return target === "person" ? "person_candidate" : target === "company" ? "company_candidate" : "job_signal";
}
export function artifactTypeForActor(actorKey: string | null | undefined): ArtifactType | null {
  const k = lc(actorKey);
  if (!k) return null;
  if (k === "apify_people_search" || k.includes("people") || k.includes("profile") || k.includes("employee")) return "person_candidate";
  if (k === "apify_jobs" || k.includes("jobs") || k.includes("indeed")) return "job_signal";
  if (k.includes("company") || k.includes("serp") || k.includes("google")) return "company_candidate";
  return null;
}

/** Deterministic actor plan. Signals may add an EVIDENCE actor (jobs discovers
 *  hiring companies) but never change the primary identity actor / artifact type. */
export function compileActorPlan(intent: LeadEntityIntent, routing_source: RoutingSource = "persisted_intent_contract"): ProviderActorPlan {
  const hasHiring = intent.signals.some((s) => s.type === "hiring");
  const mode = intent.execution_mode;
  const companyFirst = mode === "company_first";
  if (intent.target_entity === "person") {
    // The people actor still produces the FINAL person artifact (unchanged), but in
    // company_first mode the jobs actor runs FIRST as the company/evidence stage.
    return { target_entity: "person", execution_mode: mode, company_first: companyFirst, primary_identity_actor: ref("apify_people_search"), evidence_actors: (companyFirst || hasHiring) ? [ref("apify_jobs")] : [], final_artifact_type: "person_candidate", routing_source, confidence: intent.confidence };
  }
  if (intent.target_entity === "job") {
    return { target_entity: "job", execution_mode: mode, company_first: companyFirst, primary_identity_actor: ref("apify_jobs"), evidence_actors: [], final_artifact_type: "job_signal", routing_source, confidence: intent.confidence };
  }
  return { target_entity: "company", execution_mode: mode, company_first: companyFirst, primary_identity_actor: ref("apify_jobs"), evidence_actors: [], final_artifact_type: "company_candidate", routing_source, confidence: intent.confidence };
}

// ---------------------------------------------------------- routing conflict ----

export interface RoutingConflictResult {
  result_status: "routing_conflict";
  target_entity: TargetEntity;
  selected_actor: string;
  selected_actor_output_type: ArtifactType | null;
  expected_output_type: ArtifactType;
}

/** A conflict exists when the selected actor cannot yield the intent's expected
 *  final artifact AND is not a legitimate evidence actor for it. person↔job always
 *  conflict; company may use the jobs actor as an evidence stage. */
export function detectRoutingConflict(intent: LeadEntityIntent, selectedActorKey: string | null | undefined): RoutingConflictResult | null {
  const expected = expectedArtifactType(intent.target_entity);
  const selectedOut = artifactTypeForActor(selectedActorKey);
  if (!selectedActorKey || !selectedOut) return null;
  if (selectedOut === expected) return null;
  if (intent.target_entity === "company" && selectedOut === "job_signal") return null; // jobs = evidence for company
  return { result_status: "routing_conflict", target_entity: intent.target_entity, selected_actor: selectedActorKey, selected_actor_output_type: selectedOut, expected_output_type: expected };
}

/** Pre-insert guard: a candidate may persist only when its artifact type matches
 *  the intent's expected final artifact type. */
export function artifactMayPersist(intent: LeadEntityIntent, candidateArtifactType: ArtifactType | null | undefined): boolean {
  return candidateArtifactType === expectedArtifactType(intent.target_entity);
}
