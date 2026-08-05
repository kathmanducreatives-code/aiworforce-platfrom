// A LINKEDIN LABEL IS NOT A BUSINESS MODEL.
//
// `evaluateCompanyFit` rejected a company outright when its enriched industry
// names did not literally contain an ICP phrase:
//
//     else if (!positive_industries.some((x) => names.includes(x.toLowerCase())))
//       failed.push("industry_not_in_icp");
//
// LinkedIn's own vocabulary has no "B2B SaaS". It has "Software Development",
// "Technology, Information and Internet", "IT Services and IT Consulting". Every
// company in the audited run would have hard-FAILED that gate on wording alone —
// including SnapMagic, whose YC one-liner is "AI-assisted electronics design"
// sold to engineering organisations.
//
// So the LABEL becomes weak metadata and the DECISION moves to a structured
// semantic assessment over combined evidence. That is not a loosening: a label
// alone can no longer pass a company either. "Software Development" with no
// other evidence is UNKNOWN, and unknown is REVIEW — never a silent accept and
// never a silent reject.
//
// WHAT STAYS DETERMINISTIC. Facts that are checkable stay checkable: identity
// mismatch, inactive company, geography, a verified headcount clearly over the
// ceiling, consumer-only evidence, absent commercial signal. The model is asked
// to interpret ambiguity, never to overrule a fact.
//
// PURE. The classifier is INJECTED, so the whole decision is testable with no
// model call and no network.

export const SEMANTIC_FIT_VERSION = "company-brain-semantic-fit-v1" as const;

export type BusinessModel =
  | "b2b_saas" | "ai_saas" | "b2b_software" | "b2b_service" | "consumer" | "unknown";

export type CompanyFitVerdict = "pass" | "review" | "fail";
export type AgentoryUseCase = "strong" | "plausible" | "weak" | "none";

/** The structured answer the classifier must return. */
export interface SemanticFitAssessment {
  business_model: BusinessModel;
  company_fit: CompanyFitVerdict;
  confidence: number;
  agentory_use_case: AgentoryUseCase;
  supporting_evidence: string[];
  conflicting_evidence: string[];
  unknown_fields: string[];
  reason: string;
}

/** Everything the assessment may look at. Nothing is privileged over the rest. */
export interface SemanticFitInput {
  /** The user's own words. Highest precedence. */
  original_user_query: string | null;
  /** The compiled mission. Second. */
  mission_verticals: string[];
  mission_geography: string | null;
  /** Workspace context. Third, and only where relevant to THIS mission. */
  workspace_industries: string[];
  company_name: string | null;
  yc_description: string | null;
  website_description: string | null;
  linkedin_description: string | null;
  /** WEAK METADATA. Never decisive on its own, in either direction. */
  linkedin_industry: string | null;
  linkedin_industry_ids: string[];
  employee_count: number | null;
  employee_advisory: string | null;
  geography: string | null;
  /** The commercial signal already proven by the hiring policy. */
  commercial_signal: string | null;
  commercial_tier: "A" | "B" | "C" | null;
}

/** Labels that describe an industry sector, not a business model. */
export const WEAK_INDUSTRY_LABELS: readonly string[] = [
  "software development", "technology, information and internet",
  "it services and it consulting", "internet publishing", "computer software",
  "information technology", "technology", "internet", "computer and network security",
];

export function isWeakIndustryLabel(label: unknown): boolean {
  const l = String(label ?? "").trim().toLowerCase();
  return !!l && WEAK_INDUSTRY_LABELS.some((w) => l.includes(w));
}

// -------------------------------------------------- mission precedence ----

export interface AppliedPolicy {
  mission_verticals: string[];
  /** Workspace categories kept because the mission is about them. */
  workspace_context_applied: string[];
  /** Workspace categories DROPPED as unrelated to this mission. */
  workspace_categories_ignored: string[];
  geography: string | null;
  precedence: readonly ["user_query", "lead_mission", "workspace_brain", "defaults"];
}

/**
 * Decide which context actually governs THIS mission.
 *
 * The workspace Brain lists "B2B SaaS, AI SaaS, Recruiting Agencies". A query
 * about SaaS startups must not be broadened to recruiting agencies merely
 * because the workspace sells to them as well — that is how a mission stops
 * answering the question that was asked.
 *
 * A workspace category is kept only when it overlaps the mission's own
 * verticals or the user's own words.
 */
export function applyMissionPrecedence(i: {
  original_user_query: string | null;
  mission_verticals: string[];
  mission_geography: string | null;
  workspace_industries: string[];
}): AppliedPolicy {
  const q = String(i.original_user_query ?? "").toLowerCase();
  const verticals = i.mission_verticals.map((v) => v.toLowerCase().trim()).filter(Boolean);
  const kept: string[] = [];
  const ignored: string[] = [];

  for (const w of i.workspace_industries) {
    const wl = w.toLowerCase().trim();
    if (!wl) continue;
    const tokens = wl.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const overlapsMission = verticals.some((v) => wl.includes(v) || v.includes(wl)) ||
      tokens.some((t) => verticals.some((v) => v.includes(t)));
    const inUserWords = tokens.length > 0 && tokens.every((t) => q.includes(t));
    if (overlapsMission || inUserWords) kept.push(w);
    else ignored.push(w);
  }

  return {
    mission_verticals: i.mission_verticals,
    workspace_context_applied: kept,
    workspace_categories_ignored: ignored,
    geography: i.mission_geography,
    precedence: ["user_query", "lead_mission", "workspace_brain", "defaults"] as const,
  };
}

// ------------------------------------------------------ deterministic gates ----

export type HardGate =
  | "identity_mismatch" | "inactive_company" | "unsupported_geography"
  | "employee_count_far_above_ceiling" | "consumer_only" | "no_commercial_signal"
  | "no_agentory_use_case";

export interface HardGateInput {
  identity_status: "verified_match" | "unresolved" | "rejected_mismatch";
  active: boolean;
  geography: string | null;
  required_geography: string | null;
  employee_count: number | null;
  /** The preferred ceiling. A verified count must exceed it CLEARLY to reject. */
  employee_ceiling: number;
  commercial_tier: "A" | "B" | "C" | null;
  semantic: SemanticFitAssessment | null;
}

/** How far above the ceiling counts as "clearly" above. */
export const CEILING_TOLERANCE = 1.0;

/**
 * The facts that reject on their own.
 *
 * Deliberately short. Everything absent from this list is a scoring or review
 * signal, because a company rejected on an uncertain fact is a company nobody
 * can appeal for.
 */
export function failedHardGates(i: HardGateInput): HardGate[] {
  const failed: HardGate[] = [];
  if (i.identity_status === "rejected_mismatch") failed.push("identity_mismatch");
  if (!i.active) failed.push("inactive_company");
  // GEOGRAPHY REJECTS ONLY ON A KNOWN MISMATCH. Unknown geography is a REVIEW
  // question, not a rejection.
  if (i.required_geography && i.geography &&
      !i.geography.toLowerCase().includes(i.required_geography.toLowerCase())) {
    failed.push("unsupported_geography");
  }
  // A VERIFIED count clearly above the ceiling. An unverified or borderline
  // count is REVIEW — the audited data had YC self-reports off by up to 23x.
  if (i.employee_count != null &&
      i.employee_count > i.employee_ceiling * (1 + CEILING_TOLERANCE)) {
    failed.push("employee_count_far_above_ceiling");
  }
  if (i.semantic?.business_model === "consumer") failed.push("consumer_only");
  if (i.commercial_tier === null) failed.push("no_commercial_signal");
  if (i.semantic?.agentory_use_case === "none") failed.push("no_agentory_use_case");
  return failed;
}

// --------------------------------------------------------- the decision ----

export type BrainOutcome = "QUALIFIED" | "REVIEW" | "REJECT";

export interface BrainDecision {
  version: typeof SEMANTIC_FIT_VERSION;
  outcome: BrainOutcome;
  business_model: BusinessModel;
  confidence: number;
  agentory_use_case: AgentoryUseCase;
  failed_hard_gates: HardGate[];
  unknown_fields: string[];
  supporting_evidence: string[];
  conflicting_evidence: string[];
  reason: string;
  policy: AppliedPolicy;
}

/**
 * Decide one company. TOTAL — every input yields exactly one outcome.
 *
 * There is no path that returns nothing. A silent NOT_EVALUATED after the
 * prerequisites pass is what produced "0 passed, 0 held as unknown" for seven
 * enriched companies.
 */
export function decideCompanyBrain(i: {
  gates: HardGateInput;
  semantic: SemanticFitAssessment | null;
  policy: AppliedPolicy;
  /** Tier B with no supporting signal is a REVIEW, never a pass. */
  hiring_verified: boolean;
}): BrainDecision {
  const failed = failedHardGates({ ...i.gates, semantic: i.semantic });
  const s = i.semantic;
  const base = {
    version: SEMANTIC_FIT_VERSION,
    business_model: s?.business_model ?? "unknown",
    confidence: s?.confidence ?? 0,
    agentory_use_case: s?.agentory_use_case ?? "weak",
    failed_hard_gates: failed,
    unknown_fields: s?.unknown_fields ?? ["semantic_assessment_absent"],
    supporting_evidence: s?.supporting_evidence ?? [],
    conflicting_evidence: s?.conflicting_evidence ?? [],
    policy: i.policy,
  };

  if (failed.length > 0) {
    return { ...base, outcome: "REJECT", reason: `hard gate failed: ${failed.join(", ")}` };
  }
  // NO ASSESSMENT IS NOT A REJECTION. An absent classifier means the question
  // was never asked, which is precisely what REVIEW is for.
  if (!s) {
    return { ...base, outcome: "REVIEW",
      reason: "no semantic assessment available — held for review, not rejected" };
  }
  if (s.company_fit === "fail") {
    return { ...base, outcome: "REJECT", reason: s.reason || "semantic assessment: not a fit" };
  }
  if (s.company_fit === "review" || s.business_model === "unknown" ||
      s.unknown_fields.length > 0 || !i.hiring_verified ||
      s.agentory_use_case === "weak") {
    return { ...base, outcome: "REVIEW",
      reason: s.reason || "likely fit, with one or more facts still uncertain" };
  }
  return { ...base, outcome: "QUALIFIED", reason: s.reason || "strong fit with a current signal" };
}

// ------------------------------------------------------------- the prompt ----

/**
 * The instruction handed to the classifier.
 *
 * Kept here so the contract is versioned with the code that consumes it, and so
 * a test can assert what the model is actually asked.
 */
export function buildSemanticFitPrompt(i: SemanticFitInput, policy: AppliedPolicy): string {
  return [
    "Assess whether this company fits the buyer profile for THIS mission.",
    "",
    `MISSION (highest precedence): ${i.original_user_query ?? "(none)"}`,
    `Mission verticals: ${policy.mission_verticals.join(", ") || "(none)"}`,
    `Mission geography: ${policy.geography ?? "(none)"}`,
    policy.workspace_context_applied.length
      ? `Relevant workspace context: ${policy.workspace_context_applied.join(", ")}`
      : "Relevant workspace context: (none)",
    policy.workspace_categories_ignored.length
      ? `IGNORE these unrelated workspace categories: ${policy.workspace_categories_ignored.join(", ")}`
      : "",
    "",
    "EVIDENCE",
    `Company: ${i.company_name ?? "(unknown)"}`,
    `YC description: ${i.yc_description ?? "(none)"}`,
    `Website description: ${i.website_description ?? "(none)"}`,
    `LinkedIn description: ${i.linkedin_description ?? "(none)"}`,
    `LinkedIn industry (WEAK METADATA — never decisive alone): ${i.linkedin_industry ?? "(none)"}`,
    `Employees: ${i.employee_count ?? "(unknown)"}${i.employee_advisory ? ` (advisory: ${i.employee_advisory})` : ""}`,
    `Location: ${i.geography ?? "(unknown)"}`,
    `Current commercial signal: ${i.commercial_signal ?? "(none)"} (tier ${i.commercial_tier ?? "none"})`,
    "",
    "RULES",
    "- A LinkedIn industry label such as 'Software Development' is NOT a business model.",
    "  Do not reject for the absence of the exact words 'B2B SaaS', and do not accept",
    "  on the label alone.",
    "- Judge who the company SELLS TO from the product and customer evidence.",
    "- If evidence is genuinely missing, say so in unknown_fields and answer 'review'.",
    "- Answer 'fail' only for clear evidence against: consumer-only, or no credible",
    "  use case for an AI GTM/recruiting workforce.",
    "",
    "Return ONLY this JSON:",
    '{"business_model":"b2b_saas|ai_saas|b2b_software|b2b_service|consumer|unknown",',
    '"company_fit":"pass|review|fail","confidence":0.0,',
    '"agentory_use_case":"strong|plausible|weak|none","supporting_evidence":[],',
    '"conflicting_evidence":[],"unknown_fields":[],"reason":""}',
  ].filter(Boolean).join("\n");
}

/** Parse and clamp a classifier response. Anything malformed becomes UNKNOWN. */
export function parseSemanticFit(raw: unknown): SemanticFitAssessment | null {
  const o = typeof raw === "string" ? safeJson(raw) : raw;
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const model = String(r.business_model ?? "unknown") as BusinessModel;
  const fit = String(r.company_fit ?? "review") as CompanyFitVerdict;
  const use = String(r.agentory_use_case ?? "weak") as AgentoryUseCase;
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    business_model: ["b2b_saas", "ai_saas", "b2b_software", "b2b_service", "consumer", "unknown"]
      .includes(model) ? model : "unknown",
    company_fit: ["pass", "review", "fail"].includes(fit) ? fit : "review",
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0) || 0)),
    agentory_use_case: ["strong", "plausible", "weak", "none"].includes(use) ? use : "weak",
    supporting_evidence: arr(r.supporting_evidence),
    conflicting_evidence: arr(r.conflicting_evidence),
    unknown_fields: arr(r.unknown_fields),
    reason: String(r.reason ?? ""),
  };
}

function safeJson(s: string): unknown {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}
