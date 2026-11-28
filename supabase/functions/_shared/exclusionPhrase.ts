// EXCLUSION PHRASE MATCHING — one rule for every place ATLAS decides an exclusion.
//
// An exclusion REJECTS companies, so a false match is a lost lead and a missed one is a
// company the user said never to target. Substring tests got both wrong:
//   "oil"  matched "toilet" and "boiler"         (false positive: a good company rejected)
//   "ai"   matched "retail" and "maintenance"     (false positive)
//   "AI"   was dropped as too short by stems()    (false negative: an exclusion ignored)
//
// THE RULE: case-insensitive, whole words, the phrase's words in order and adjacent.
//   * words are split on anything that is not a letter or digit ("AI-powered" → ai powered);
//   * "&" reads as "and" ("oil & gas" = "oil and gas");
//   * a plural matches its singular ("staffing agencies" = "staffing agency");
//   * a multiword exclusion needs ALL its words in sequence ("real estate" does not match
//     "estate planning"; it does match "commercial real estate services").
// Pure. No model, no network.

export const EXCLUSION_MATCH_VERSION = "phrase-v1" as const;

/** One word, singular: agencies → agency, services → service, glass → glass. */
function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** The words of a phrase, normalized: lowercase, "&" → and, singular. */
export function phraseTokens(s: unknown): string[] {
  return String(s ?? "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean).map(singular);
}

/** The normalized form two exclusions are compared by ("Staffing Agencies" → "staffing agency"). */
export const normalizePhrase = (s: unknown): string => phraseTokens(s).join(" ");

/** Does `text` contain `phrase` as whole, adjacent words (in order)? */
export function phraseMatches(text: unknown, phrase: unknown): boolean {
  const p = phraseTokens(phrase);
  if (!p.length) return false;
  const t = phraseTokens(text);
  for (let i = 0; i + p.length <= t.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length && ok; j++) ok = t[i + j] === p[j];
    if (ok) return true;
  }
  return false;
}

/**
 * Generic head nouns an exclusion may carry ("staffing AGENCIES", "crypto COMPANIES"). A
 * company's industry rarely repeats them ("Staffing and Recruiting"), so an exclusion also
 * matches on its CORE — the phrase without them — still as whole, adjacent words.
 */
const GENERIC_HEADS = new Set(["agency", "company", "firm", "business", "service", "provider", "organization", "organisation", "vendor", "startup"]);

/** The exclusion's core words ("staffing agencies" → ["staffing"]); the phrase itself when nothing is left. */
export function exclusionCore(phrase: unknown): string[] {
  const p = phraseTokens(phrase);
  const core = p.filter((w) => !GENERIC_HEADS.has(w));
  return core.length ? core : p;
}

/** Does `text` hit the exclusion `phrase` — the full phrase or its core, as whole adjacent words? */
export function exclusionMatches(text: unknown, phrase: unknown): boolean {
  return phraseMatches(text, phrase) || phraseMatches(text, exclusionCore(phrase).join(" "));
}

/** Either phrase contains the other as whole words ("staffing" ~ "staffing agencies"). */
export const phrasesOverlap = (a: unknown, b: unknown): boolean => phraseMatches(a, b) || phraseMatches(b, a);

// ── De-duplication that keeps provenance ────────────────────────────────────

/** Where an exclusion came from. Distinct, so the plan can say which source said what. */
export type ExclusionSource = "request" | "brain_profile" | "brain_profile_generic" | "brain_memory";

export interface ExclusionEntry { value: string; source: ExclusionSource; memoryId?: string | null }

export interface MergedExclusion {
  /** normalizePhrase(value): the identity two entries share. */
  key: string;
  /** The first spelling seen, as the user or the Brain wrote it. */
  value: string;
  /** Every source that named it, in first-seen order. Never collapsed to one. */
  sources: ExclusionSource[];
  /** The approved memories that named it (company_brain_memory.id), sorted. */
  memoryIds: string[];
}

/** One entry per normalized phrase; every source and memory id it came from is kept. */
export function mergeExclusions(entries: readonly ExclusionEntry[]): MergedExclusion[] {
  const out = new Map<string, MergedExclusion>();
  for (const e of entries) {
    const value = String(e.value ?? "").trim();
    const key = normalizePhrase(value);
    if (!key) continue;
    const m = out.get(key) ?? { key, value, sources: [], memoryIds: [] };
    if (!m.sources.includes(e.source)) m.sources.push(e.source);
    if (e.memoryId && !m.memoryIds.includes(e.memoryId)) m.memoryIds.push(e.memoryId);
    out.set(key, m);
  }
  return [...out.values()].map((m) => ({ ...m, memoryIds: [...m.memoryIds].sort() }));
}
