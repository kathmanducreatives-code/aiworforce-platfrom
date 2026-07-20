// Deterministic quality scoring across the candidates a SINGLE model call
// returns.
//
// WHY
//   The model already returns a primary and an alternative, but the primary was
//   always used if it validated and the alternative was kept only as a spare.
//   So a vague "I was impressed by your innovative approach" primary won over a
//   specific, evidence-led alternative — and if the primary failed validation
//   the whole request failed even when the alternative was good.
//
//   This picks the strongest VALID candidate. It never rescues an invalid one:
//   safety validation runs first and is not part of the score.
//
// No model call. No network. Pure and deterministic — the same candidates always
// produce the same winner.

export interface CandidateInput {
  text: string;
  /** Evidence ids the model claimed, already filtered to the allowed set. */
  used_evidence_ids: string[];
  /** Seller claim ids the model claimed, already filtered to the allowed set. */
  used_seller_claim_ids: string[];
}

export interface ScoredCandidate extends CandidateInput {
  score: number;
  /** Human-readable contributions, for observability. Never shown to the user. */
  reasons: string[];
}

/**
 * Filler that adds length without adding information. Scored DOWN rather than
 * rejected: a phrase like "noticed" can be perfectly truthful when it precedes
 * real evidence, so a hard ban would reject good messages. Unsupported PRAISE
 * is different and is rejected by the validator, not here.
 */
const FILLER_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bi wanted to (?:reach out|share|connect)\b/i, label: "filler_wanted_to" },
  { re: /\bjust reaching out\b/i, label: "filler_just_reaching_out" },
  { re: /\bi hope (?:you|this)\b/i, label: "filler_hope" },
  { re: /\bquick question\b/i, label: "filler_quick_question" },
  { re: /\bi came across\b/i, label: "filler_came_across" },
  { re: /\btouching base\b/i, label: "filler_touching_base" },
];

/** Vague admiration with nothing behind it. */
const VAGUE_ADMIRATION: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b(?:impressive|exciting|amazing|incredible|inspiring)\b/i, label: "vague_admiration" },
  { re: /\b(?:innovative|cutting[- ]edge|game[- ]changing|revolutionary)\b/i, label: "vague_buzzword" },
  { re: /\blove what you(?:'re| are) doing\b/i, label: "vague_love_what" },
];

/** Direct, checkable observation language. */
const DIRECT_OBSERVATION: ReadonlyArray<RegExp> = [
  /\bsaw\b/i,
  /\bnoticed in the\b/i,
  /\byour team is hiring\b/i,
  /\byou(?:'re| are) hiring\b/i,
  /\bthe (?:role|posting|listing)\b/i,
  /\byour company is building\b/i,
];

/** Length above which a first line starts to feel like a paragraph. */
const COMFORTABLE_MAX_CHARS = 220;

export interface ScoreOptions {
  personalization_depth: string;
  /** The prospect company name, so we can credit explicit relevance. */
  company_name?: string | null;
  /** The recipient's first name, likewise. */
  recipient_first_name?: string | null;
}

/**
 * Score one candidate. Higher is better. Scores are comparable only within a
 * single request — they are not a quality rating in absolute terms.
 */
export function scoreOpenerCandidate(c: CandidateInput, opts: ScoreOptions): ScoredCandidate {
  const reasons: string[] = [];
  let score = 0;
  const text = c.text;

  // Grounding: an evidence-led specific message is the whole point of "specific".
  if (opts.personalization_depth === "specific" && c.used_evidence_ids.length > 0) {
    score += 4;
    reasons.push("uses_verified_evidence");
  }

  // Seller relevance: the message says something the Brain actually supports.
  if (c.used_seller_claim_ids.length > 0) {
    score += 3;
    reasons.push("uses_seller_claim");
  }

  // Explicit relevance to THIS account/person rather than a generic line.
  const company = opts.company_name?.trim();
  if (company && text.toLowerCase().includes(company.toLowerCase())) {
    score += 1;
    reasons.push("names_company");
  }
  const first = opts.recipient_first_name?.trim();
  if (first && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
    score += 1;
    reasons.push("names_recipient");
  }

  // Direct observation language beats vague gesturing.
  if (DIRECT_OBSERVATION.some((re) => re.test(text))) {
    score += 2;
    reasons.push("direct_observation");
  }

  for (const { re, label } of VAGUE_ADMIRATION) {
    if (re.test(text)) {
      score -= 3;
      reasons.push(`penalty_${label}`);
    }
  }
  for (const { re, label } of FILLER_PATTERNS) {
    if (re.test(text)) {
      score -= 2;
      reasons.push(`penalty_${label}`);
    }
  }

  // Brevity, but only as a tiebreak — never enough to beat grounding.
  if (text.length <= COMFORTABLE_MAX_CHARS) {
    score += 1;
    reasons.push("comfortable_length");
  }

  return { ...c, score, reasons };
}

/**
 * Choose the best of the already-VALIDATED candidates.
 *
 * Ties break toward the shorter message, then toward the earlier candidate, so
 * selection is fully deterministic.
 */
export function selectBestCandidate(
  candidates: CandidateInput[],
  opts: ScoreOptions,
): ScoredCandidate | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((c) => scoreOpenerCandidate(c, opts));

  let best = scored[0];
  for (const c of scored.slice(1)) {
    if (c.score > best.score) best = c;
    else if (c.score === best.score && c.text.length < best.text.length) best = c;
  }
  return best;
}
