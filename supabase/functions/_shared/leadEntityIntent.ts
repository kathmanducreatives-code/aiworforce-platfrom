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

export type TargetEntity = "person" | "company" | "job";
export type OutputType = "qualified_people" | "qualified_companies" | "job_postings";
export type ArtifactType = "person_candidate" | "company_candidate" | "job_signal";
export type LeadSignalType = "hiring" | "funding" | "product_launch" | "expansion" | "new_executive" | "recent_post";

export interface IntentEvidenceSpan { field: string; value: string; evidence: string[] }
export interface LeadSignalIntent { type: LeadSignalType; evidence: string[] }

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
  hard_constraints: string[];
  soft_constraints: string[];
  confidence: number;               // 0..1
  clarification_required: boolean;  // true when the target entity can't be established
  evidence_spans: IntentEvidenceSpan[];
}

const lc = (s: unknown) => String(s ?? "").toLowerCase();

// --- explicit requested-OUTPUT phrases (what the user wants returned) ----------
const JOB_OUTPUT_RE = /\b(job openings?|job postings?|job posts?|open positions?|vacan(?:cy|cies)|open [a-z/ ]{0,20}?(?:jobs?|roles?|positions?)|current [a-z ]{0,20}?jobs?|jobs? (?:open|available|posted)|which jobs?\b|open jobs?)\b/i;
const PERSON_NOUN_RE = /\b(co-?founders?|founders?|ceos?|ctos?|cfos?|coos?|cmos?|cros?|chief [a-z]+ officers?|executives?|decision[-\s]?makers?|buying committee|people|persons?|contacts?|leaders?|operators?|prospects?|buyers?|heads? of\b|vps?|owners?|managing directors?|presidents?)\b/i;
const WHO_TO_CONTACT_RE = /\bwho (?:should i|to|can i|do i)\s+(?:contact|reach out to|target|talk to|email|message)\b/i;
const COMPANY_NOUN_RE = /\b(companies|company|startups?|accounts?|businesses|business|orgs?|organi[sz]ations?|firms?|vendors?|employers?)\b/i;

// --- signals (qualify people/companies; NEVER set the entity) ------------------
const SIGNAL_PATTERNS: Array<[LeadSignalType, RegExp]> = [
  ["hiring", /\bhiring\b|\bhiring signals?\b|\bhiring for\b/i],
  ["funding", /\b(recently )?funded\b|\braised (?:funding|capital|a round|\$)|series [a-e]\b|seed round\b|pre-?seed\b/i],
  ["product_launch", /\bproduct launch(?:ed|ing)?\b|\bnew product\b|\bjust launched\b/i],
  ["expansion", /\bexpanding\b|\bexpansion\b|\bscaling (?:up|out|fast|sales|gtm)?\b|\bgrowing (?:their|the) (?:team|sales)\b/i],
  ["new_executive", /\bnew (?:ceo|cto|cfo|coo|cmo|vp|head|exec|executive)\b|\bjust hired a\b/i],
  ["recent_post", /\brecently posted\b|\brecent posts?\b|\bposted (?:on|about)\b|\bengaging with\b/i],
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

  const signals: LeadSignalIntent[] = [];
  for (const [type, re] of SIGNAL_PATTERNS) {
    const ev = firstMatch(re, text);
    if (ev) signals.push({ type, evidence: [ev] });
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
  if (intent.target_entity === "person") {
    return { target_entity: "person", primary_identity_actor: ref("apify_people_search"), evidence_actors: hasHiring ? [ref("apify_jobs")] : [], final_artifact_type: "person_candidate", routing_source, confidence: intent.confidence };
  }
  if (intent.target_entity === "job") {
    return { target_entity: "job", primary_identity_actor: ref("apify_jobs"), evidence_actors: [], final_artifact_type: "job_signal", routing_source, confidence: intent.confidence };
  }
  return { target_entity: "company", primary_identity_actor: ref("apify_jobs"), evidence_actors: [], final_artifact_type: "company_candidate", routing_source, confidence: intent.confidence };
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
