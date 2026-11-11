// DETERMINISTIC SCORING FOR ONE MODEL OUTPUT. PURE.
//
// What each score can and cannot tell you:
//   structured_valid   JSON parses and carries every required key (JSON tasks only).
//   icp_adherence      no excluded entity is proposed as a target. A mention in a
//                      sentence that also says "excluded"/"not" is not counted.
//   hallucination      company-shaped names not in the task's allowed set. A
//                      heuristic: it flags, a human confirms.
//   citation_accuracy  share of cited [E#] ids that exist in the prompt.
// Accuracy beyond these needs a human grader; the report says so.

import type { BenchTask } from "./tasks.ts";

export interface BenchScore {
  task_id: string;
  structured_valid: boolean | null;
  icp_violations: string[];
  suspected_hallucinations: string[];
  citations: { cited: string[]; fabricated: string[]; accuracy: number | null };
  /** Required points present (null when the task defines none). */
  required_points: { met: number; of: number } | null;
  /** Entities the answer recommends although it must not. */
  forbidden_recommendations: string[];
  /** Instruction following: within the stated word limit (null when none stated). */
  within_word_limit: boolean | null;
  /**
   * SUCCESS — every deterministic check passes: valid JSON (when required), no
   * ICP violation, no forbidden recommendation, no fabricated citation, every
   * required point present, word limit respected. Correctness beyond these
   * still needs the blind human grade.
   */
  success: boolean;
}

const COMPANY_SHAPE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|LLC|Corp|Software|Fabrication|Works|Tooling|Manufacturing|Industries|Systems|Labs))\b/g;

export function scoreOutput(t: BenchTask, output: string): BenchScore {
  let structured: boolean | null = null;
  if (t.jsonKeys) {
    try {
      const j = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      structured = !!j && typeof j === "object" && t.jsonKeys.every((k) => k in j);
    } catch { structured = false; }
  }
  const sentences = output.split(/(?<=[.!?\n])\s+/);
  const icp = t.excludedEntities.filter((e) =>
    sentences.some((s) => s.includes(e) && !/\b(exclud|not\b|skip|avoid|out of scope|outside)/i.test(s))
  );
  const allowed = new Set(t.allowedEntities.map((e) => e.toLowerCase()));
  // The match may swallow a sentence-initial word ("Prioritize Cloudnova
  // Software"): a name is allowed if any word-suffix of it is; otherwise the
  // two-word tail is reported.
  const halluc = [...new Set([...output.matchAll(COMPANY_SHAPE)].map((m) => m[1]).flatMap((n) => {
    const w = n.split(/\s+/);
    for (let i = 0; i < w.length - 1; i++) if (allowed.has(w.slice(i).join(" ").toLowerCase())) return [];
    return [w.slice(-2).join(" ")];
  }))];
  const cited = [...new Set([...output.matchAll(/\bE(\d+)\b/g)].map((m) => `E${m[1]}`))];
  const fabricated = cited.filter((c) => !t.evidenceIds.includes(c));
  const lower = output.toLowerCase();
  const req = t.mustMention ? { met: t.mustMention.filter((alts) => alts.some((a) => lower.includes(a.toLowerCase()))).length, of: t.mustMention.length } : null;
  const forbidden = (t.mustNotRecommend ?? []).filter((e) =>
    sentences.some((s) => s.includes(e) && /\b(pursue|prioriti|recommend|contact|target|focus on|qualify)\b/i.test(s) && !/\b(exclud|not\b|don't|do not|skip|avoid|outside|deprioriti)/i.test(s))
  );
  const words = output.trim().split(/\s+/).filter(Boolean).length;
  const withinWords = t.maxWords ? words <= t.maxWords : null;
  const success = output.trim().length > 0 && structured !== false && icp.length === 0 && forbidden.length === 0 &&
    fabricated.length === 0 && (!req || req.met === req.of) && withinWords !== false;
  return {
    within_word_limit: withinWords, success,
    required_points: req, forbidden_recommendations: forbidden,
    task_id: t.id, structured_valid: structured, icp_violations: icp, suspected_hallucinations: halluc,
    citations: { cited, fabricated, accuracy: cited.length ? (cited.length - fabricated.length) / cited.length : null },
  };
}

/** Rough input-token estimate for a dry-run cost bound: 1 token ≈ 4 characters, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
