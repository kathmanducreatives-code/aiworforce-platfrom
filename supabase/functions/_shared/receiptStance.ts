// E01 — WHAT A CITED SENTENCE SAYS ABOUT THE REQUIREMENT.
//
// The strict parser proves a receipt is GENUINE: the excerpt is verbatim, the
// item is this company's, fresh, verified, and of a type allowed to speak for
// the criterion. It did not ask what the sentence SAYS. Where an evaluator
// verdict can RAISE a result — an industry outside the controlled vocabulary,
// a mandatory requirement no structured source establishes, an excluded
// company type — a genuine quote could therefore qualify a company although it
// said the opposite (audit E01, reproduced on 8b0e2b6b):
//
//   "We are NOT a recruiting agency"            cited as PASS for "recruiting agency"
//   "Our software helps recruiting agencies"    — its customers, not itself
//   "sells payroll software to startups"        — its audience
//   "founded as a startup in 1998"              — what it was, not what it is
//
// This reads the cited sentence deterministically and says which of those it
// is. It is not a second evaluator: it never says PASS on its own, it only
// refuses a receipt that cannot carry the model's PASS. No model call.
//
// Pure.

export type ReceiptStance =
  /** A current self-description that names the requirement. */
  | "affirms"
  /** The sentence negates the requirement ("we are not …", "no longer …"). */
  | "negated"
  /** The requirement is who the company serves or sells to, not what it is. */
  | "other_subject"
  /** A past or planned state ("founded as", "formerly", "plans to become"). */
  | "not_current"
  /** The sentence does not mention the requirement at all. */
  | "irrelevant";

const STOP = new Set([
  "and", "the", "for", "with", "that", "this", "from", "company", "companies", "kind", "business",
  "businesses", "type", "types", "size", "employees", "employee", "stage",
]);

/** The requirement's content words, as 5-character stems ("recruiting agencies" → recru, agenc). */
export function requirementStems(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of terms) {
    for (const w of String(t ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
      if (/^\d+$/.test(w)) { out.add(w); continue; }
      if (w.length < 3 || STOP.has(w)) continue;
      out.add(w.slice(0, 5));
    }
  }
  return [...out];
}

const NEGATION = /\b(?:not|no|never|nor|neither|without|isn'?t|aren'?t|wasn'?t|weren'?t|no\s+longer)\b/;
const NOT_ONLY = /\bnot\s+(?:only|just|merely)\b/;
const AUDIENCE =
  /\b(?:for|to|help(?:s|ing)?|serv(?:e|es|ing)|support(?:s|ing)?|customers?|clients?|used\s+by|trusted\s+by|partner(?:s|ing)?\s+with|works?\s+with|built\s+for|designed\s+for|sells?\s+to|like|such\s+as|including)\b/;
const NOT_CURRENT =
  /\b(?:founded\s+as|started\s+(?:out\s+)?as|began\s+as|formerly|previously|originally|used\s+to|was\s+once|once\s+was|no\s+longer|plan(?:s|ned|ning)?\s+to|aim(?:s|ed|ing)?\s+to|intend(?:s|ed)?\s+to|hop(?:e|es|ing)\s+to|will\s+(?:become|be)|on\s+track\s+to\s+become)\b/;

/** The sentence of `source` that holds `excerpt` (case-insensitive), or the excerpt itself. */
export function sentenceOf(source: string, excerpt: string): string {
  const s = String(source ?? ""), e = String(excerpt ?? "").trim();
  const at = e ? s.toLowerCase().indexOf(e.toLowerCase()) : -1;
  if (at < 0) return e;
  const before = s.slice(0, at), after = s.slice(at + e.length);
  const start = Math.max(...[".", "!", "?", ";", "\n"].map((p) => before.lastIndexOf(p))) + 1;
  const ends = [".", "!", "?", ";", "\n"].map((p) => after.indexOf(p)).filter((i) => i >= 0);
  const end = at + e.length + (ends.length ? Math.min(...ends) : after.length);
  return s.slice(start, end).trim();
}

/** What the sentence holding `excerpt` says about the requirement named by `terms`. */
export function receiptStance(terms: readonly string[], source: string, excerpt: string): ReceiptStance {
  const stems = requirementStems(terms);
  const sentence = sentenceOf(source, excerpt).toLowerCase();
  const words = sentence.split(/[^a-z0-9']+/).filter(Boolean);
  const hit = words.findIndex((w) => stems.some((s) => /^\d+$/.test(s) ? w === s : w.startsWith(s)));
  if (stems.length === 0 || hit < 0) return "irrelevant";
  if (NOT_CURRENT.test(sentence)) return "not_current";
  // The five words before the requirement are the clause that governs it.
  const lead = words.slice(Math.max(0, hit - 5), hit).join(" ");
  if (NEGATION.test(lead) && !NOT_ONLY.test(lead)) return "negated";
  if (AUDIENCE.test(lead)) return "other_subject";
  return "affirms";
}
