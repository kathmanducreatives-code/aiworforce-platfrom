// A CLAIM MUST POINT AT SOMETHING, AND CODE GOES AND LOOKS.
//
// WHAT THIS REPLACES.
//
// `parseSemanticFitStrict` verified that a passing classifier result carried a
// NON-EMPTY `supporting_evidence` array. That is a check on the array, not on
// the world. A model that had read one line of a LinkedIn description could
// return `["sells B2B API subscriptions"]` and pass, and nothing downstream
// could distinguish that from a phrase quoted out of the company's own words.
//
// The system could therefore be confidently wrong — which is worse than being
// incomplete, because a REVIEW asks a human and a QUALIFIED spends their time.
//
// THE CONTRACT NOW.
//
// The model returns CLAIMS. Each names the evidence ids it rests on and quotes
// a short excerpt from each. `verifyGroundedResult` then checks, for every one:
// the id exists; it belongs to THIS company; it is not invalid; the excerpt is
// really in that source text; the evidence TYPE may support that CLAIM type;
// and any hard fact asserted matches the typed value code already established.
//
// A claim that fails is REMOVED. It does not fail the company and it does not
// fail the run — it simply stops counting, stops appearing in the Workbench,
// and drags the grounding score down until a PASS can no longer be confident.
//
// PURE. No network, provider, model or database access.

import {
  abstractSourceLabel, findEvidence, hardFactsForPrompt,
  type EvidenceItem, type EvidenceRegistry, type EvidenceType,
} from "./leadEvidenceRegistry.ts";

export const GROUNDED_CLAIMS_VERSION = "grounded-claims-v1" as const;

// ───────────────────────────────────────────────────────── the contract ──

export type BusinessModelValue =
  | "b2b_saas" | "ai_saas" | "b2b_software" | "b2b_service" | "consumer" | "unknown";

export type ClaimType =
  | "company_fit" | "business_model" | "commercial_signal"
  | "agentory_use_case" | "timing" | "customer_type" | "product_type";

export type SignalStrength = "strong" | "moderate" | "weak" | "none";

export interface EvidenceExcerpt {
  evidence_id: string;
  excerpt: string;
}

export interface GroundedClaim {
  claim: string;
  claim_type: ClaimType;
  evidence_ids: string[];
  evidence_excerpts: EvidenceExcerpt[];
}

export interface GroundedClassifierResult {
  business_model: {
    value: BusinessModelValue;
    confidence: number;
    claims: GroundedClaim[];
  };
  company_fit: "pass" | "review" | "fail";
  agentory_use_case: "strong" | "plausible" | "weak" | "none";
  mission_signal_assessment: {
    strongest_signal: string | null;
    signal_strength: SignalStrength;
    evidence_ids: string[];
    reason: string;
  };
  supporting_claims: GroundedClaim[];
  conflicting_evidence_ids: string[];
  missing_evidence: string[];
  unknown_fields: string[];
  confidence: number;
  reason: string;
}

export type RejectionReason =
  | "missing_evidence"
  | "unknown_evidence_id"
  | "wrong_company"
  | "excerpt_not_found"
  | "unsupported_evidence_type"
  | "conflicting_evidence_ignored"
  | "hard_fact_mismatch"
  | "invalid_evidence_state";

export interface RejectedClaim {
  claim: string;
  claim_type: ClaimType;
  reason: RejectionReason;
  detail: string;
}

export interface GroundedVerification {
  version: typeof GROUNDED_CLAIMS_VERSION;
  classifier_result: GroundedClassifierResult;
  validated_claims: GroundedClaim[];
  rejected_claims: RejectedClaim[];
  /** 0..1 — the share of material claims that survived verification. */
  grounding_score: number;
  final_grounded_decision: "pass" | "review" | "fail";
  /** Why the decision moved, when it moved. */
  downgrade_reasons: string[];
  /** Conflicts the model failed to acknowledge. Surfaced, never suppressed. */
  unacknowledged_conflicts: string[];
}

// ────────────────────────────────────────────── which evidence proves what ──

/**
 * The permitted evidence types per claim type.
 *
 * BUSINESS MODEL may rest on what the company SAYS IT DOES — its own
 * description, its YC record, its site. A job title cannot establish a business
 * model ("Head of Sales" exists at every company on earth), and neither can an
 * employee count. Industry is context and is handled separately below, because
 * a broad vendor label is the single most over-trusted field in the pipeline.
 *
 * COMMERCIAL SIGNAL may rest ONLY on an actual opening or a dated commercial
 * event. A description saying "we help sales teams" is what the company sells,
 * not evidence that it is hiring.
 */
export const CLAIM_EVIDENCE_RULES: Readonly<Record<ClaimType, {
  allowed: readonly EvidenceType[];
  /** Types that may support but can never be the ONLY evidence. */
  contextual_only: readonly EvidenceType[];
}>> = Object.freeze({
  business_model: {
    allowed: ["company_description", "yc_company_record", "company_website", "company_industry"],
    contextual_only: ["company_industry"],
  },
  customer_type: {
    allowed: ["company_description", "yc_company_record", "company_website", "company_industry"],
    contextual_only: ["company_industry"],
  },
  product_type: {
    allowed: ["company_description", "yc_company_record", "company_website"],
    contextual_only: [],
  },
  company_fit: {
    allowed: [
      "company_description", "yc_company_record", "company_website",
      "company_industry", "company_location", "employee_count", "job_posting", "yc_job",
    ],
    contextual_only: ["company_industry"],
  },
  commercial_signal: {
    allowed: ["job_posting", "yc_job", "funding_signal"],
    contextual_only: [],
  },
  timing: {
    allowed: ["job_posting", "yc_job", "funding_signal"],
    contextual_only: [],
  },
  agentory_use_case: {
    allowed: [
      "company_description", "yc_company_record", "company_website",
      "job_posting", "yc_job",
    ],
    contextual_only: [],
  },
});

/** Claim types that, when wholly unsupported, cannot leave a PASS standing. */
const MATERIAL_CLAIM_TYPES: readonly ClaimType[] = [
  "business_model", "company_fit", "commercial_signal",
];

// ──────────────────────────────────────────────────────────── the parser ──

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map((x) => str(x)).filter((x) => x.length > 0)
    : [];
}
function num01(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function enumOr<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = str(v).toLowerCase();
  return (allowed as readonly string[]).includes(s) ? s as T : fallback;
}

const MODELS: readonly BusinessModelValue[] =
  ["b2b_saas", "ai_saas", "b2b_software", "b2b_service", "consumer", "unknown"];
/**
 * Exported so the PROMPT and the PARSER name the same vocabulary. A claim type
 * the model is not told about is parsed as `company_fit`, which then fails the
 * evidence rules for the claim it was actually making.
 */
export const CLAIM_TYPES: readonly ClaimType[] = [
  "company_fit", "business_model", "commercial_signal",
  "agentory_use_case", "timing", "customer_type", "product_type",
];

function parseClaims(v: unknown): GroundedClaim[] {
  if (!Array.isArray(v)) return [];
  const out: GroundedClaim[] = [];
  for (const raw of v.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const claim = str(c.claim);
    if (!claim) continue;
    const excerpts: EvidenceExcerpt[] = Array.isArray(c.evidence_excerpts)
      ? c.evidence_excerpts
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map((x) => ({ evidence_id: str(x.evidence_id), excerpt: str(x.excerpt) }))
        .filter((x) => x.evidence_id.length > 0)
        .slice(0, 10)
      : [];
    out.push({
      claim,
      claim_type: enumOr(c.claim_type, CLAIM_TYPES, "company_fit"),
      evidence_ids: strArr(c.evidence_ids).slice(0, 10),
      evidence_excerpts: excerpts,
    });
  }
  return out;
}

/** Read the model's answer into the contract. Never throws; missing is empty. */
export function parseGroundedResult(raw: unknown): GroundedClassifierResult {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const bm = (r.business_model && typeof r.business_model === "object"
    ? r.business_model : {}) as Record<string, unknown>;
  const sig = (r.mission_signal_assessment && typeof r.mission_signal_assessment === "object"
    ? r.mission_signal_assessment : {}) as Record<string, unknown>;

  return {
    business_model: {
      value: enumOr(bm.value, MODELS, "unknown"),
      confidence: num01(bm.confidence),
      claims: parseClaims(bm.claims),
    },
    company_fit: enumOr(r.company_fit, ["pass", "review", "fail"] as const, "review"),
    agentory_use_case: enumOr(
      r.agentory_use_case, ["strong", "plausible", "weak", "none"] as const, "weak"),
    mission_signal_assessment: {
      strongest_signal: str(sig.strongest_signal) || null,
      signal_strength: enumOr(
        sig.signal_strength, ["strong", "moderate", "weak", "none"] as const, "none"),
      evidence_ids: strArr(sig.evidence_ids).slice(0, 10),
      reason: str(sig.reason),
    },
    supporting_claims: parseClaims(r.supporting_claims),
    conflicting_evidence_ids: strArr(r.conflicting_evidence_ids).slice(0, 20),
    missing_evidence: strArr(r.missing_evidence).slice(0, 20),
    unknown_fields: strArr(r.unknown_fields).slice(0, 20),
    confidence: num01(r.confidence),
    reason: str(r.reason),
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// ───────────────────────────────────────────────────────── the verifier ──

/** Whitespace-insensitive, case-insensitive containment. Nothing looser. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s ]+/g, " ").trim();
}

export function excerptIsPresent(excerpt: string, sourceText: string | null): boolean {
  const e = normalizeForMatch(excerpt);
  if (!e) return false;
  const s = normalizeForMatch(sourceText ?? "");
  if (!s) return false;
  return s.includes(e);
}

export interface VerifyInput {
  registry: EvidenceRegistry;
  result: GroundedClassifierResult;
  /** The mission demands a current commercial signal (e.g. "hiring"). */
  requiresCommercialSignal?: boolean;
  /** Below this, a PASS cannot stand. */
  groundingThreshold?: number;
}

export const DEFAULT_GROUNDING_THRESHOLD = 0.6;

/**
 * Verify every claim against the registry, then decide what survives.
 *
 * ONE INVALID CLAIM NEVER FAILS THE COMPANY. It is removed and recorded. What
 * a company loses by making unsupported claims is CONFIDENCE, not a fair
 * hearing — an ungrounded pass becomes a review, which asks a human, rather
 * than a reject, which throws away a possibly-good lead on the strength of the
 * model's sloppiness.
 */
export function verifyGroundedResult(i: VerifyInput): GroundedVerification {
  const { registry, result } = i;
  const threshold = i.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD;
  const validated: GroundedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const downgrades: string[] = [];

  const reject = (c: GroundedClaim, reason: RejectionReason, detail: string) =>
    rejected.push({ claim: c.claim, claim_type: c.claim_type, reason, detail });

  const checkClaim = (c: GroundedClaim): boolean => {
    if (c.evidence_ids.length === 0 && c.evidence_excerpts.length === 0) {
      reject(c, "missing_evidence", "the claim cites nothing");
      return false;
    }
    const ids = [...new Set([
      ...c.evidence_ids, ...c.evidence_excerpts.map((x) => x.evidence_id),
    ])];
    const items: EvidenceItem[] = [];
    for (const id of ids) {
      const item = findEvidence(registry, id);
      if (!item) {
        reject(c, "unknown_evidence_id", id);
        return false;
      }
      // Belt and braces: the id encodes the company, and the item states it.
      if (item.company_key !== registry.company_key) {
        reject(c, "wrong_company", `${id} belongs to ${item.company_key}`);
        return false;
      }
      if (item.verification_state === "invalid") {
        // A PROVIDER FAILURE CANNOT PROVE ANYTHING ABOUT THE WORLD. It is the
        // reason we do not know, not evidence that the answer is no.
        reject(c, "invalid_evidence_state",
          `${id} is ${item.evidence_type === "provider_failure"
            ? "a provider failure, which cannot support a claim about the company"
            : "invalid"}`);
        return false;
      }
      items.push(item);
    }

    // ── THE EXCERPT MUST REALLY BE THERE ──────────────────────────────────
    for (const ex of c.evidence_excerpts) {
      const item = items.find((x) => x.evidence_id === ex.evidence_id)!;
      if (!excerptIsPresent(ex.excerpt, item.source_text)) {
        reject(c, "excerpt_not_found",
          `"${ex.excerpt.slice(0, 60)}" is not in ${ex.evidence_id}`);
        return false;
      }
    }

    // ── THE EVIDENCE TYPE MUST BE ABLE TO CARRY THE CLAIM ─────────────────
    const rule = CLAIM_EVIDENCE_RULES[c.claim_type];
    const types = items.map((x) => x.evidence_type);
    const disallowed = types.filter((t) => !rule.allowed.includes(t));
    if (disallowed.length > 0) {
      reject(c, "unsupported_evidence_type",
        `${[...new Set(disallowed)].join(", ")} cannot support a ${c.claim_type} claim`);
      return false;
    }
    // A contextual type alone is not proof. "LinkedIn says Software" has never
    // established that a company sells B2B SaaS, and treating it as though it
    // did is how a staffing firm entered the funnel as a software company.
    if (types.length > 0 && types.every((t) => rule.contextual_only.includes(t))) {
      reject(c, "unsupported_evidence_type",
        `${[...new Set(types)].join(", ")} is contextual only and cannot be the sole proof`);
      return false;
    }

    // ── A TIMING CLAIM NEEDS A DATE ───────────────────────────────────────
    if (c.claim_type === "timing" || c.claim_type === "commercial_signal") {
      const current = items.filter((x) => x.freshness === "current");
      if (/\b(now|current|currently|actively|today|this (week|month))\b/i.test(c.claim) &&
          current.length === 0) {
        reject(c, "hard_fact_mismatch",
          "the claim asserts a CURRENT signal but no cited evidence is current");
        return false;
      }
    }

    // ── HARD FACTS MUST MATCH WHAT CODE ESTABLISHED ───────────────────────
    const mismatch = hardFactMismatch(c, registry);
    if (mismatch) {
      reject(c, "hard_fact_mismatch", mismatch);
      return false;
    }
    return true;
  };

  const all = [...result.business_model.claims, ...result.supporting_claims];
  for (const c of all) {
    if (checkClaim(c)) validated.push(c);
  }

  // ── CONFLICTS THE MODEL DID NOT ACKNOWLEDGE ─────────────────────────────
  const conflicting = registry.items.filter((x) => x.verification_state === "conflicting");
  const acknowledged = new Set(result.conflicting_evidence_ids);
  const unacknowledged = conflicting
    .filter((x) => !acknowledged.has(x.evidence_id))
    .map((x) => x.evidence_id);

  const grounding_score = all.length === 0
    ? 0
    : Number((validated.length / all.length).toFixed(4));

  // ── WHAT SURVIVES ───────────────────────────────────────────────────────
  let decision: "pass" | "review" | "fail" = result.company_fit;

  // A REJECT stays a REJECT only when the model was explicit AND its reasoning
  // survived. An unsupported "fail" is as ungrounded as an unsupported "pass".
  if (decision === "fail" && validated.length === 0 && all.length > 0) {
    decision = "review";
    downgrades.push("fail_without_a_single_validated_claim");
  }

  if (decision === "pass") {
    const validTypes = new Set(validated.map((c) => c.claim_type));
    if (validated.length === 0) {
      decision = "review";
      downgrades.push("pass_without_any_validated_claim");
    }
    if (!validTypes.has("business_model") &&
        result.business_model.value !== "unknown") {
      decision = "review";
      downgrades.push("business_model_asserted_without_validated_evidence");
    }
    // A SCORE OVER ZERO CLAIMS IS NOT A LOW SCORE, IT IS NO SCORE.
    //
    // `grounding_score` is `validated / all`, defined as 0 when `all` is empty.
    // Emitting `grounding_score_0_below_0.6` for a response that made no claims
    // reports a measurement that never happened, and reads downstream as though
    // the company scored badly. `pass_without_any_validated_claim` already says
    // the true thing about that response.
    if (all.length > 0 && grounding_score < threshold) {
      decision = "review";
      downgrades.push(
        `grounding_score_${grounding_score}_below_${threshold}`);
    }
    if (i.requiresCommercialSignal && !validTypes.has("commercial_signal")) {
      decision = "review";
      downgrades.push("mission_requires_a_current_signal_and_none_was_grounded");
    }
    if (unacknowledged.length > 0) {
      decision = "review";
      downgrades.push(`material_conflict_unacknowledged:${unacknowledged.join(",")}`);
    }
    if (registry.hard_facts.provider_failed) {
      decision = "review";
      downgrades.push(
        `provider_failure_unresolved:${registry.hard_facts.provider_failures.join(",")}`);
    }
  }

  return {
    version: GROUNDED_CLAIMS_VERSION,
    classifier_result: result,
    validated_claims: validated,
    rejected_claims: rejected,
    grounding_score,
    final_grounded_decision: decision,
    downgrade_reasons: downgrades,
    unacknowledged_conflicts: unacknowledged,
  };
}

/**
 * Does this claim restate a hard fact WRONGLY?
 *
 * The model may cite an employee count; it may not turn "11-50" into "23", and
 * it may not name a job title nobody posted. These are the assertions that read
 * as authoritative in a Workbench row, so they are checked against the typed
 * values code established rather than against the prose.
 */
function hardFactMismatch(c: GroundedClaim, r: EvidenceRegistry): string | null {
  const f = r.hard_facts;
  const text = c.claim;

  // EMPLOYEE COUNT. Any number-of-people assertion must match the typed value.
  const emp = /(\d[\d,]*)\s*(?:\+)?\s*(?:employees|staff|people|headcount)/i.exec(text);
  if (emp) {
    const claimed = Number(emp[1].replace(/,/g, ""));
    if (f.employee_count == null) {
      return `claims ${claimed} employees but no employee count was established`;
    }
    if (Number.isFinite(claimed) && claimed !== f.employee_count) {
      return `claims ${claimed} employees; the established value is ${f.employee_count}`;
    }
  }

  // JOB TITLE. A quoted role must be one that was actually posted.
  //
  // CASE-INSENSITIVE ON THE VERB. This read `/\bhiring\s+.../` with no `i`
  // flag, so a claim beginning "Hiring Head of Sales" — which is how a model
  // naturally writes it, and how every fixture writes it — never matched and
  // was never checked. The rule existed and did nothing.
  const hiring =
    /\b(?:hiring|recruiting|seeking)\s+(?:an?\s+|their\s+first\s+)?([A-Za-z][\w/&+ -]{2,60})/i
      .exec(text);
  if (hiring) {
    const claimed = normalizeForMatch(hiring[1]);
    const known = f.job_titles.map(normalizeForMatch);
    const matched = known.some((t) => t.includes(claimed) || claimed.includes(t));
    if (!matched) {
      return known.length === 0
        ? `claims a role "${hiring[1].trim()}" but no job evidence exists`
        : `claims "${hiring[1].trim()}"; posted roles are: ${f.job_titles.join(", ")}`;
    }
  }

  // GEOGRAPHY. Only checked when the claim names a place AND one is established.
  if (f.geography) {
    const geo = /\b(?:based in|headquartered in|located in)\s+([A-Z][\w .-]{2,40})/.exec(text);
    if (geo) {
      const claimed = normalizeForMatch(geo[1]);
      const known = normalizeForMatch(f.geography);
      if (!known.includes(claimed) && !claimed.includes(known)) {
        return `claims location "${geo[1].trim()}"; the established geography is "${f.geography}"`;
      }
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────── the prompt ──

/** What the grounded classifier is told. Asserted by a test. */
export const GROUNDED_CLASSIFIER_PROMPT = [
  "You interpret supplied company evidence. You do not add to it.",
  "Use ONLY the evidence items provided. Each has an evidence_id.",
  "Every material claim MUST list the evidence_ids it rests on, and MUST quote a",
  "short excerpt copied verbatim from that item's source_text.",
  "Never invent a company fact. If the evidence does not say it, do not claim it.",
  "Never restate a number, job title, or location differently from the supplied value.",
  "Absence of evidence is 'unknown'. It is never proof that something is false.",
  "A failed data provider means UNRESOLVED, never 'the company is not hiring'.",
  "A broad industry label alone does not establish a business model.",
  "A job title alone does not establish a business model.",
  "A company description saying it helps sales teams is NOT evidence that it is hiring.",
  "Only a dated job posting or commercial event may support a current-signal claim.",
  "Name any evidence that conflicts, in conflicting_evidence_ids.",
  "Distinguish facts you were given from inferences you drew.",
  "Return 'review' when the evidence is insufficient — that is the correct answer,",
  "not a failure.",
  "You do not choose data providers, tools or Actors, and you never name one.",
  "You do not decide whether contact details are unlocked.",
  "Return only the requested JSON object. Do not explain your reasoning process.",
].join(" ");

/** The payload the grounded classifier receives. */
export function buildGroundedClassifierPayload(i: {
  registry: EvidenceRegistry;
  originalUserQuery: string | null;
  missionDirectives?: Record<string, unknown> | null;
  requiresCommercialSignal?: boolean;
}): Record<string, unknown> {
  return {
    schema_version: GROUNDED_CLAIMS_VERSION,
    instruction: GROUNDED_CLASSIFIER_PROMPT,
    mission: {
      original_user_query: i.originalUserQuery,
      requires_current_commercial_signal: i.requiresCommercialSignal === true,
      ...(i.missionDirectives ?? {}),
    },
    company: {
      company_key: i.registry.company_key,
      // HARD FACTS ARE GIVEN, NOT ASKED FOR. The model cites them; restating
      // one differently is a verification failure, not a stylistic choice.
      established_facts: hardFactsForPrompt(i.registry.hard_facts),
    },
    evidence: i.registry.items.map((x) => ({
      evidence_id: x.evidence_id,
      evidence_type: x.evidence_type,
      // THE SOURCE IS ABSTRACTED BEFORE IT REACHES THE MODEL.
      //
      // `source` carries the Actor's own name internally ("harvestapi/
      // linkedin-job-search"), which is exactly the vocabulary the compiler
      // stage went to such lengths to keep out of the model's reach — and it
      // would also let a claim cite "harvestapi says so", which is a provider
      // name used as proof rather than evidence.
      source: abstractSourceLabel(x.source),
      source_text: x.source_text,
      structured_value: x.structured_value,
      observed_at: x.observed_at,
      freshness: x.freshness,
      verification_state: x.verification_state,
    })),
    claim_evidence_rules: Object.fromEntries(
      Object.entries(CLAIM_EVIDENCE_RULES).map(([k, v]) => [k, {
        may_cite: v.allowed,
        never_sole_proof: v.contextual_only,
      }]),
    ),
  };
}

// ─────────────────────────────────────────────── the Workbench projection ──

export interface WorkbenchExplanation {
  why_it_matched: { statement: string; evidence: string[] }[];
  current_signal: { statement: string; evidence: string[] } | null;
  uncertainty: string[];
  missing_evidence: string[];
  grounding_score: number;
  confidence_after_grounding: number;
  decision: "pass" | "review" | "fail";
}

/**
 * Build what the user SEES — from validated claims and nothing else.
 *
 * A rejected claim never reaches this function's output. That is the whole
 * point: the sentence a salesperson reads before contacting a stranger has been
 * checked against the evidence it cites.
 */
export function buildWorkbenchExplanation(
  v: GroundedVerification, registry: EvidenceRegistry,
): WorkbenchExplanation {
  // THE SOURCE KIND, NOT THE VENDOR. A salesperson reading "job posting
  // (harvestapi/linkedin-job-search)" learns nothing they can act on and is
  // shown a supplier relationship that is not theirs to know.
  const label = (id: string) => {
    const item = findEvidence(registry, id);
    if (!item) return id;
    return `${item.evidence_type.replace(/_/g, " ")} (${
      abstractSourceLabel(item.source).replace(/_/g, " ")})`;
  };

  const why = v.validated_claims
    .filter((c) => c.claim_type !== "commercial_signal" && c.claim_type !== "timing")
    .map((c) => ({
      statement: c.claim,
      evidence: [...new Set([
        ...c.evidence_ids, ...c.evidence_excerpts.map((x) => x.evidence_id),
      ])].map(label),
    }));

  const signalClaim = v.validated_claims
    .find((c) => c.claim_type === "commercial_signal" || c.claim_type === "timing");

  const uncertainty: string[] = [];
  for (const id of v.unacknowledged_conflicts) {
    const item = findEvidence(registry, id);
    uncertainty.push(item?.source_text
      ? `Conflicting ${item.evidence_type.replace(/_/g, " ")}: ${item.source_text}`
      : `Conflicting evidence: ${id}`);
  }
  for (const item of registry.items) {
    if (item.verification_state === "conflicting" &&
        !v.unacknowledged_conflicts.includes(item.evidence_id)) {
      uncertainty.push(
        `${item.evidence_type.replace(/_/g, " ")} differs between sources.`);
    }
    if (item.evidence_type === "provider_failure") {
      uncertainty.push(
        `A data source failed (${item.source}); this remains unresolved rather than a negative.`);
    }
  }

  // CONFIDENCE AFTER GROUNDING, not the model's own number. A confident claim
  // nobody could verify is exactly the thing this stage exists to discount.
  const confidence_after_grounding = Number(
    (v.classifier_result.confidence * v.grounding_score).toFixed(4));

  return {
    why_it_matched: why,
    current_signal: signalClaim
      ? {
        statement: signalClaim.claim,
        evidence: [...new Set([
          ...signalClaim.evidence_ids,
          ...signalClaim.evidence_excerpts.map((x) => x.evidence_id),
        ])].map(label),
      }
      : null,
    uncertainty: [...new Set(uncertainty)],
    missing_evidence: v.classifier_result.missing_evidence,
    grounding_score: v.grounding_score,
    confidence_after_grounding,
    decision: v.final_grounded_decision,
  };
}
