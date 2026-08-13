// DOES THIS COMPANY SATISFY THE MISSION?
//
// THE QUESTION NOBODY WAS ASKING.
//
// Three model calls already ran after evidence collection — semantic
// classification, the grounded brain, batch evaluation. All three received the
// Mission, the workspace context and the full evidence registry. None of them
// was asked whether the company satisfied the user's request:
//
//   `CLASSIFIER_SYSTEM_PROMPT`  "You do NOT qualify, approve or reject a
//                                company. A deterministic Company Brain does
//                                that."   → what business model is this?
//   `GROUNDED_CLASSIFIER_PROMPT` "You interpret supplied company evidence."
//                                         → do these claims survive their sources?
//   `POOL_RANKING_PROMPT`        "Never change a decision, tier, score."
//                                         → which of these is the better lead?
//
// Meanwhile the compiled Mission carried `hard_constraints`,
// `required_signal_terms` and a plain-English `evaluation_instructions`
// — "Discover AI startups in the United States, evaluate whether each is an AI
// startup, confirm embedded evidence of hiring software engineers" — into the
// classifier payload, where nothing read them. The instruction was delivered
// and never executed.
//
// This module asks it. It is the only place in the funnel where a model is
// asked to reach a verdict, and the verdict it reaches is about the MISSION,
// not about Agentory's buyer.
//
// ── WHAT KEEPS IT HONEST ────────────────────────────────────────────────────
//
// A claim must POINT at something. Every satisfied requirement cites an
// `evidence_id` from the registry and quotes a verbatim excerpt of that item's
// `source_text`. Both are checked here, against the registry, before the
// verdict is allowed to stand — the same discipline `verifyGroundedResult`
// applies to grounded claims, extended to the Mission verdict because that is
// now the verdict that authorises spending.
//
// An unexplained pass is not a pass. A pass citing evidence that does not exist
// is not a pass. A pass quoting words the source does not contain is not a
// pass. Each of those becomes REVIEW, never a rejection: the company did not
// fail, the answer did.
//
// ── WHAT IT MAY NOT DO ──────────────────────────────────────────────────────
//
// It may not reject for a Brain PREFERENCE. `icp_fit` moves the score and
// nothing else. That is the rule that would have kept AfterQuery — 220
// employees, AI startup, United States, four current software-engineering
// openings — in a run whose Mission asked for exactly that and whose workspace
// happens to prefer 10-150.
//
// PURE. No network, no provider, no model, no database. The classifier is
// injected by the binding.

import type { QualificationContext, BrainAuthority } from "./missionQualificationContext.ts";
import {
  findEvidence, hardFactsForPrompt, registryForPrompt, type EvidenceRegistry,
} from "./leadEvidenceRegistry.ts";

export const MISSION_EVALUATION_VERSION = "mission-evaluation-v1" as const;
export const MISSION_EVALUATION_INPUT_VERSION = "mission-evaluation-input-v1" as const;

// ───────────────────────────────── the verdict ──────────────────────────────

/** Does the company satisfy what the USER asked for? */
export type MissionFit = "pass" | "review" | "fail";
/** How well it matches what the WORKSPACE prefers. Ranking only. */
export type IcpFit = "strong" | "plausible" | "weak";
/** Whether the Mission's required signal is actually evidenced. */
export type HiringFit = "verified" | "plausible" | "absent";
export type EvidenceQuality = "strong" | "moderate" | "weak";

/**
 * The three terminal states, and why `insufficient_evidence` is one of them.
 *
 * "We could not tell" is a different answer from "it does not match", and
 * collapsing them is what let a Workbench show twenty companies as rejected
 * when not one of them had been looked at.
 */
export type EvaluationDecision =
  | "qualified" | "not_qualified" | "insufficient_evidence";

/**
 * WHO decided, recorded on every company.
 *
 * `not_evaluated` is reachable and is not a failure state — it is the honest
 * answer for a company the evaluator never received.
 */
export type DecisionSource =
  | "gpt_evaluation"
  | "hard_constraint_rejection"
  | "identity_failure"
  | "insufficient_evidence"
  | "not_evaluated";

/** A Mission requirement the evidence satisfies, with the receipt. */
export interface RequirementMatch {
  requirement: string;
  evidence_id: string;
  /** Copied verbatim from that item's `source_text`. Checked, not trusted. */
  excerpt: string;
}

/** A Mission requirement the evidence does not satisfy. */
export interface RequirementFailure {
  requirement: string;
  /** The evidence that contradicts it, when there is some. Null when absent. */
  evidence_id: string | null;
  why: string;
}

export interface MissionEvaluation {
  version: typeof MISSION_EVALUATION_VERSION;
  decision: EvaluationDecision;
  mission_fit: MissionFit;
  icp_fit: IcpFit;
  hiring_fit: HiringFit;
  /** 0-1. */
  confidence: number;
  /** 0-100. Ranking only — never a threshold. */
  match_score: number;
  matched_requirements: RequirementMatch[];
  failed_requirements: RequirementFailure[];
  reasoning: string;
  rejection_reasons: string[];
  evidence_quality: EvidenceQuality;
  unknown_fields: string[];
  next_action: string | null;
}

/** How much of the model's answer survived validation. */
export type EvaluationParseStatus = "valid" | "repaired" | "invalid_insufficient_evidence";

export interface ParsedMissionEvaluation {
  evaluation: MissionEvaluation;
  parse_status: EvaluationParseStatus;
  /** Safe diagnostics only — never the prompt, the key, or raw model text. */
  raw_shape: {
    received_keys: string[];
    repaired_fields: string[];
    rejected_values: string[];
    /** Requirements dropped because their citation did not check out. */
    dropped_citations: string[];
  };
}

// ───────────────────────────────── the input ────────────────────────────────

export interface MissionEvaluationInput {
  schema_version: typeof MISSION_EVALUATION_INPUT_VERSION;
  instruction: string;
  mission: Record<string, unknown>;
  brain: Record<string, unknown>;
  company: Record<string, unknown>;
}

/**
 * Everything the evaluator sees, assembled from decided values only.
 *
 * NOTHING HERE RE-READS THE USER'S SENTENCE. Every mission field is one the
 * compiler already settled; `original_user_query` travels for explanation, and
 * the evaluator is told in the prompt that the compiled fields govern.
 *
 * The Brain arrives PRE-SPLIT, by `resolveBrainAuthority`, so the model is not
 * asked to work out which workspace fields it is allowed to reject on. It is
 * given two lists and told what each one is for.
 */
export function buildMissionEvaluationInput(i: {
  ctx: QualificationContext;
  authority: BrainAuthority;
  registry: EvidenceRegistry;
  /** The Brain's own plain-English rules, when the workspace wrote any. */
  qualification_rules?: {
    reject_if?: readonly string[];
    manual_review_if?: readonly string[];
    required_evidence?: readonly string[];
  } | null;
}): MissionEvaluationInput {
  const { ctx, authority, registry } = i;
  const directives = ctx.directives ?? {};
  return {
    schema_version: MISSION_EVALUATION_INPUT_VERSION,
    instruction: MISSION_EVALUATION_PROMPT,
    mission: {
      original_user_query: ctx.original_user_query,
      target_entity: ctx.target_entity,
      verticals: ctx.verticals,
      stages: ctx.stages,
      locations: ctx.locations,
      strategies: ctx.strategies,
      required_signal_terms: ctx.role_vocabulary.required_titles,
      role_vocabulary_source: ctx.role_vocabulary.source,
      employee_range: ctx.employee_range,
      // THE FIELDS NOTHING HAS EVER READ. `hard_constraints` is documented as
      // absolute and was enforced nowhere; `evaluation_instructions` is the
      // Mission's own brief and reached the payload unread.
      hard_constraints: ctx.hard_constraints,
      soft_preferences: ctx.soft_preferences,
      evaluation_instructions: directives.evaluation_instructions ?? "",
      required_evidence: directives.required_evidence ?? [],
      preferred_signals: directives.preferred_signals ?? [],
      excluded_signals: directives.excluded_signals ?? [],
      /** Axes the Mission decided. The Brain may not reject on these. */
      mission_owned_axes: authority.mission_owned,
    },
    brain: {
      // MAY REJECT — the workspace can never sell to these.
      hard_constraints: authority.rejecting,
      // MAY ONLY SCORE.
      preferences: authority.preferences,
      qualification_rules: i.qualification_rules ?? null,
      // Recorded so the model is told, not left to infer, where the Mission
      // has already overruled the workspace.
      resolved_conflicts: authority.conflicts,
    },
    company: {
      company_key: registry.company_key,
      // GIVEN, NOT ASKED FOR. Restating one differently is a verification
      // failure, not a stylistic choice.
      established_facts: hardFactsForPrompt(registry.hard_facts),
      evidence: registryForPrompt(registry),
    },
  };
}

// ──────────────────────────────── the prompt ────────────────────────────────

/**
 * The instruction. Versioned with the code that consumes it, and asserted by a
 * test, so what the model is actually asked cannot drift silently.
 */
export const MISSION_EVALUATION_PROMPT = [
  "Decide whether this company satisfies the user's Mission.",
  "",
  "THE MISSION IS THE QUESTION. The `mission` object is the user's request as it",
  "was compiled. Judge against `hard_constraints`, `required_signal_terms`,",
  "`verticals`, `locations`, `stages` and `evaluation_instructions`. Do not",
  "substitute your own idea of a good lead.",
  "",
  "EVERY CLAIM NEEDS A RECEIPT. For each Mission requirement you consider",
  "satisfied, add an entry to matched_requirements citing the evidence_id it",
  "rests on and quoting a short excerpt copied VERBATIM from that item's",
  "source_text. A requirement with no citation does not count as satisfied.",
  "",
  "THE WORKSPACE BRAIN IS NOT THE MISSION.",
  "- brain.hard_constraints may cause a rejection: they say who this workspace",
  "  can never sell to.",
  "- brain.preferences may ONLY move icp_fit and match_score. Never set",
  "  mission_fit to fail because of a preference. A company that satisfies the",
  "  Mission but sits outside the preferred size, industry or business model is",
  "  a QUALIFIED company with a weak icp_fit.",
  "- mission.mission_owned_axes lists axes the Mission decided for itself. The",
  "  workspace has no say on those.",
  "",
  "ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE. If the evidence does not",
  "settle a requirement, name it in unknown_fields and answer 'review'. A failed",
  "data provider means unresolved — never 'the company is not hiring'.",
  "",
  "NEVER INVENT A FACT. Never restate a number, job title or location",
  "differently from the supplied value in established_facts.",
  "",
  "mission_fit: 'pass' only when every hard requirement is satisfied and cited.",
  "             'fail' only on clear evidence AGAINST a requirement.",
  "             'review' when evidence is insufficient — that is a correct answer.",
  "hiring_fit:  'verified' when a cited current opening matches the required role.",
  "icp_fit:     ranking only.",
  "match_score: 0-100, for ordering results. Not a threshold.",
  "",
  "You do not choose data providers, tools or Actors, and you never name one.",
  "Return ONLY this JSON:",
  '{"mission_fit":"pass|review|fail","icp_fit":"strong|plausible|weak",',
  '"hiring_fit":"verified|plausible|absent","confidence":0.0,"match_score":0,',
  '"matched_requirements":[{"requirement":"","evidence_id":"","excerpt":""}],',
  '"failed_requirements":[{"requirement":"","evidence_id":null,"why":""}],',
  '"reasoning":"","rejection_reasons":[],',
  '"evidence_quality":"strong|moderate|weak","unknown_fields":[],"next_action":null}',
].join("\n");

// ──────────────────────────────── the parser ────────────────────────────────

const FITS: readonly string[] = ["pass", "review", "fail"];
const ICPS: readonly string[] = ["strong", "plausible", "weak"];
const HIRINGS: readonly string[] = ["verified", "plausible", "absent"];
const QUALITIES: readonly string[] = ["strong", "moderate", "weak"];

/** What an unusable answer becomes. Never a pass, never a rejection. */
export const FALLBACK_INSUFFICIENT: MissionEvaluation = Object.freeze({
  version: MISSION_EVALUATION_VERSION,
  decision: "insufficient_evidence",
  mission_fit: "review",
  icp_fit: "weak",
  hiring_fit: "absent",
  confidence: 0,
  match_score: 0,
  matched_requirements: [],
  failed_requirements: [],
  reasoning: "the evaluator response could not be validated — held, not rejected",
  rejection_reasons: [],
  evidence_quality: "weak",
  unknown_fields: ["evaluator_response_unusable"],
  next_action: null,
}) as MissionEvaluation;

function safeJson(s: string): unknown {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

/** Loose whitespace/case comparison — a quote is a quote, not a byte match. */
function containsExcerpt(sourceText: string | null, excerpt: string): boolean {
  if (!sourceText) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const e = norm(excerpt);
  // A one- or two-character "quote" proves nothing and would match everything.
  return e.length >= 4 && norm(sourceText).includes(e);
}

/**
 * Parse an evaluator response, FAIL CLOSED, and CHECK EVERY CITATION.
 *
 * Four rules make an unearned pass impossible. `pass` is the verdict that
 * authorises spending, so it is the one that must be paid for in evidence:
 *
 *   * a citation naming an evidence_id outside this company's registry is
 *     dropped — the id encodes its company, so a borrowed one is detectable;
 *   * a citation whose excerpt is not present in that item's source_text is
 *     dropped — the model quoted something nobody said;
 *   * `mission_fit: "pass"` with no surviving citation becomes `review`;
 *   * an unrecognised enum is a rejection of the FIELD, not of the company.
 *
 * The raw model text is never returned. Only which keys arrived, which values
 * were repaired and which citations failed, so a bad answer is diagnosable
 * without leaking the prompt.
 */
export function parseMissionEvaluationStrict(
  raw: unknown, registry: EvidenceRegistry,
): ParsedMissionEvaluation {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  const fail = (why: string): ParsedMissionEvaluation => ({
    evaluation: { ...FALLBACK_INSUFFICIENT },
    parse_status: "invalid_insufficient_evidence",
    raw_shape: {
      received_keys: o && typeof o === "object" ? Object.keys(o as object) : [],
      repaired_fields: [], rejected_values: [why], dropped_citations: [],
    },
  });
  if (!o || typeof o !== "object") return fail("not_an_object");

  const r = o as Record<string, unknown>;
  const received_keys = Object.keys(r);
  const repaired: string[] = [];
  const rejected: string[] = [];
  const dropped: string[] = [];

  const enumOr = (v: unknown, allowed: readonly string[], fallback: string, field: string) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (allowed.includes(s)) return s;
    if (v !== undefined) rejected.push(`${field}=${JSON.stringify(v)}`);
    repaired.push(field);
    return fallback;
  };

  let mission_fit = enumOr(r.mission_fit, FITS, "review", "mission_fit") as MissionFit;
  const icp_fit = enumOr(r.icp_fit, ICPS, "weak", "icp_fit") as IcpFit;
  const hiring_fit = enumOr(r.hiring_fit, HIRINGS, "absent", "hiring_fit") as HiringFit;
  const evidence_quality =
    enumOr(r.evidence_quality, QUALITIES, "weak", "evidence_quality") as EvidenceQuality;

  const rawConf = Number(r.confidence);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0;
  if (!Number.isFinite(rawConf) || rawConf < 0 || rawConf > 1) repaired.push("confidence");

  const rawScore = Number(r.match_score);
  const match_score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 100) repaired.push("match_score");

  const strArr = (v: unknown, field: string): string[] => {
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    }
    if (v !== undefined) { repaired.push(field); rejected.push(`${field}=not_an_array`); }
    return [];
  };

  // ── CITATIONS ARE CHECKED, NOT TRUSTED ────────────────────────────────────
  const matched_requirements: RequirementMatch[] = [];
  const rawMatched = Array.isArray(r.matched_requirements) ? r.matched_requirements : [];
  if (r.matched_requirements !== undefined && !Array.isArray(r.matched_requirements)) {
    repaired.push("matched_requirements");
  }
  for (const m of rawMatched) {
    if (!m || typeof m !== "object") { dropped.push("malformed_entry"); continue; }
    const e = m as Record<string, unknown>;
    const requirement = String(e.requirement ?? "").trim();
    const evidence_id = String(e.evidence_id ?? "").trim();
    const excerpt = String(e.excerpt ?? "").trim();
    if (!requirement || !evidence_id) { dropped.push(`incomplete:${requirement || "(unnamed)"}`); continue; }
    const item = findEvidence(registry, evidence_id);
    if (!item) { dropped.push(`unknown_evidence_id:${evidence_id}`); continue; }
    if (!containsExcerpt(item.source_text, excerpt)) {
      dropped.push(`excerpt_not_in_source:${evidence_id}`);
      continue;
    }
    matched_requirements.push({ requirement, evidence_id, excerpt });
  }

  const failed_requirements: RequirementFailure[] = [];
  const rawFailed = Array.isArray(r.failed_requirements) ? r.failed_requirements : [];
  for (const f of rawFailed) {
    if (!f || typeof f !== "object") continue;
    const e = f as Record<string, unknown>;
    const requirement = String(e.requirement ?? "").trim();
    if (!requirement) continue;
    const id = typeof e.evidence_id === "string" && e.evidence_id.trim()
      ? e.evidence_id.trim() : null;
    // A contradicting citation must also exist. An invented one is dropped to
    // null rather than discarding the failure — the failure may still be real.
    failed_requirements.push({
      requirement,
      evidence_id: id && findEvidence(registry, id) ? id : null,
      why: String(e.why ?? "").trim(),
    });
  }

  // AN UNCITED PASS IS NOT A PASS.
  if (mission_fit === "pass" && matched_requirements.length === 0) {
    mission_fit = "review";
    repaired.push("mission_fit:pass_without_verified_citation");
  }

  const reasoning = typeof r.reasoning === "string" ? r.reasoning : "";
  const rejection_reasons = strArr(r.rejection_reasons, "rejection_reasons");
  const unknown_fields = strArr(r.unknown_fields, "unknown_fields");
  const next_action = typeof r.next_action === "string" && r.next_action.trim()
    ? r.next_action.trim() : null;

  // Nothing we asked for arrived.
  const gotAnything = ["mission_fit", "icp_fit", "hiring_fit", "reasoning", "match_score"]
    .some((k) => k in r);
  if (!gotAnything) return fail("no_expected_field_present");

  // ── THE DECISION IS DERIVED, NEVER REQUESTED ──────────────────────────────
  //
  // Asking the model for both `mission_fit` and `decision` invites them to
  // disagree, and then something has to pick. There is only one rule and it
  // lives here.
  const decision: EvaluationDecision =
    mission_fit === "pass" ? "qualified"
      : mission_fit === "fail" ? "not_qualified"
      : "insufficient_evidence";

  return {
    evaluation: {
      version: MISSION_EVALUATION_VERSION,
      decision, mission_fit, icp_fit, hiring_fit,
      confidence, match_score,
      matched_requirements, failed_requirements,
      reasoning, rejection_reasons, evidence_quality, unknown_fields, next_action,
    },
    parse_status: repaired.length === 0 && dropped.length === 0 ? "valid" : "repaired",
    raw_shape: {
      received_keys, repaired_fields: repaired,
      rejected_values: rejected, dropped_citations: dropped,
    },
  };
}

/** The evaluation for a company the evaluator never received. */
export function notEvaluated(reason: string): MissionEvaluation {
  return {
    ...FALLBACK_INSUFFICIENT,
    reasoning: reason,
    unknown_fields: ["not_evaluated"],
  };
}
