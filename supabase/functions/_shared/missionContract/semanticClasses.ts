// WHAT KIND OF THING A PHRASE OF THE REQUEST IS (Mission Contract v4).
//
// A lead request mixes six kinds of meaning, and only some of them are criteria a company
// must meet:
//
//   company attribute     what the company IS: industry, business model (B2B), HQ, size
//   qualification         a company attribute the user REQUIRES ("must be B2B")
//   signal                something the company is DOING, dated: hiring, funding, …
//   company status        whether it is operating at all ("active", "defunct")
//   search preference     ranks, never rejects ("preferably 10–200 employees")
//   exclusion             rules companies out ("exclude consumer-only businesses")
//   pipeline operation    how the RESULTS are produced: "no duplicates", "not ones already
//                         in my leads" — never a property of a company
//
// The model reads the request into the contract's fields. When it files a phrase as
// `unsupported` anyway (TEST live pilot 2026-11-21: "active B2B companies" and "duplicates"
// were filed there, and a REQUIRED unsupported item blocks approval), this module breaks
// that phrase into MEANING UNITS from closed vocabularies — the audience words, the company
// status words, the pipeline operations — and reports what is left over. A phrase is
// reclassified only when NOTHING is left over; any residual word keeps the whole phrase
// `unsupported` (and blocking), so nothing the user said is ever dropped or guessed.
//
// Deterministic and pure. Vocabulary, not phrase patterns: "dupes", "repeat companies",
// "the same company twice", "currently operating B2B firms" all resolve through the same
// units.

export type PipelineOperation = "deduplicate" | "exclude_known_records";
export type CompanyStatus = "active" | "inactive";

export type MeaningUnit =
  | { kind: "audience"; audience: "b2b" | "consumer"; words: string[] }
  | { kind: "status"; status: CompanyStatus; words: string[] }
  | { kind: "operation"; operation: PipelineOperation; words: string[] };

/** What the pipeline does for each operation, always (named, so the approval card can say it). */
export const OPERATION_APPLIED_BY: Readonly<Record<PipelineOperation, string>> = Object.freeze({
  deduplicate: "one lead per company: records of the same company (domain, LinkedIn page) are merged into one",
  exclude_known_records: "companies already in this workspace's leads and accounts are excluded",
});

const tokens = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

// ── Closed vocabularies (single words; multi-word units are sequences of these) ──

/** Words that frame a request or name "a company" — they carry no criterion. */
const FRAME = new Set([
  "a", "an", "the", "any", "all", "of", "in", "at", "for", "to", "from", "on", "and", "or", "be", "is", "are", "as", "by", "with", "that", "which", "who",
  "companies", "company", "firms", "firm", "businesses", "business", "orgs", "organizations", "organisations", "ones", "brands", "vendors", "providers", "accounts",
  // ("us" is NOT here: it is a country as often as a pronoun — a stray pronoun stays residual.)
  "only", "must", "should", "strictly", "just", "real", "genuine", "actual", "proper", "legit", "legitimate",
  "find", "show", "list", "give", "get", "me", "i", "we", "our", "my", "include", "including", "want", "need", "looking", "interested", "keep", "return",
  // Pronouns that point back at "the companies" carry no criterion.
  "they", "them", "their", "these", "those", "it", "its", "each", "every", "one", "please", "results", "result", "leads", "lead", "entries", "entry", "list",
]);
/** Negation / exclusion words: an exclusion's polarity, not its object. */
const EXCLUDE = new Set(["exclude", "excluding", "excluded", "no", "not", "without", "except", "remove", "drop", "skip", "avoid", "minus", "never", "dont", "don", "t"]);
/** Audience (business model) words. Composite forms resolve by token sequence below. */
const B2B = new Set(["b2b", "btob"]);
const CONSUMER = new Set(["b2c", "d2c", "dtc", "consumer", "consumers", "retail", "household"]);
/** "only" in "consumer-only" is a frame word; "business-to-business" is three tokens handled below. */
const STATUS_ACTIVE = new Set(["active", "actively", "operating", "operational", "functioning", "trading", "live", "running", "existing", "current", "currently", "established", "going"]);
const STATUS_INACTIVE = new Set(["inactive", "defunct", "dormant", "closed", "dissolved", "shut", "shuttered", "bankrupt", "acquired", "dead"]);
/** Pipeline operation words. */
const DUPLICATE = new Set(["duplicate", "duplicates", "duplicated", "dupes", "dupe", "dups", "dup", "deduplicate", "dedupe", "deduped", "deduplicated", "repeat", "repeats", "repeated", "twice", "same", "again", "double", "doubles", "overlap", "overlapping"]);
const KNOWN = new Set(["already", "existing", "known", "previous", "previously", "contacted", "crm", "pipeline", "database", "have", "had", "saved", "sourced", "imported", "customers", "clients"]);

/**
 * Break one phrase into meaning units. `residual` is every content word no unit explains;
 * an empty residual means the phrase is fully understood as these units.
 */
export function meaningUnits(span: string): { units: MeaningUnit[]; residual: string[]; negated: boolean } {
  const t = tokens(span);
  const units: MeaningUnit[] = [];
  const used = new Set<number>();
  const take = (i: number) => used.add(i);
  const negated = t.some((w) => EXCLUDE.has(w));
  // business-to-business / business-to-consumer(s) / direct-to-consumer
  for (let i = 0; i + 2 < t.length; i++) {
    if (t[i + 1] === "to" && (t[i] === "business" || t[i] === "direct")) {
      const third = t[i + 2];
      if (t[i] === "business" && (third === "business" || third === "businesses")) { units.push({ kind: "audience", audience: "b2b", words: t.slice(i, i + 3) }); [i, i + 1, i + 2].forEach(take); }
      else if (third === "consumer" || third === "consumers") { units.push({ kind: "audience", audience: "consumer", words: t.slice(i, i + 3) }); [i, i + 1, i + 2].forEach(take); }
    }
  }
  // Operations first: "already in my CRM", "existing customers" are records, not a status.
  const dupIdx = t.map((w, i) => (DUPLICATE.has(w) && !used.has(i) ? i : -1)).filter((i) => i >= 0);
  // "same" / "again" / "twice" / "double" alone are not a duplicate unless a real duplicate word
  // or "twice"/"again" names a repetition of results.
  const strongDup = dupIdx.some((i) => !["same", "again", "double"].includes(t[i]));
  if (strongDup) { units.push({ kind: "operation", operation: "deduplicate", words: dupIdx.map((i) => t[i]) }); dupIdx.forEach(take); }
  const knownIdx = t.map((w, i) => (KNOWN.has(w) && !used.has(i) ? i : -1)).filter((i) => i >= 0);
  // A known-records operation needs a word that points at the user's OWN records.
  const ownRecords = t.some((w, i) => !used.has(i) && ["already", "crm", "contacted", "saved", "sourced", "imported", "previously", "customers", "clients", "database", "pipeline"].includes(w));
  if (ownRecords && knownIdx.length) { units.push({ kind: "operation", operation: "exclude_known_records", words: knownIdx.map((i) => t[i]) }); knownIdx.forEach(take); }
  for (let i = 0; i < t.length; i++) {
    if (used.has(i)) continue;
    const w = t[i];
    if (B2B.has(w)) { units.push({ kind: "audience", audience: "b2b", words: [w] }); take(i); }
    else if (CONSUMER.has(w)) { units.push({ kind: "audience", audience: "consumer", words: [w] }); take(i); }
    else if (STATUS_ACTIVE.has(w)) { units.push({ kind: "status", status: "active", words: [w] }); take(i); }
    else if (STATUS_INACTIVE.has(w)) { units.push({ kind: "status", status: "inactive", words: [w] }); take(i); }
  }
  // "in business" / "still around" — a status idiom made of frame words + a status word.
  const residual = t.filter((w, i) => !used.has(i) && !FRAME.has(w) && !EXCLUDE.has(w) && !["still", "around", "anymore", "out", "up"].includes(w));
  return { units: mergeUnits(units), residual, negated };
}

function mergeUnits(units: MeaningUnit[]): MeaningUnit[] {
  const out: MeaningUnit[] = [];
  for (const u of units) {
    const same = out.find((x) => x.kind === u.kind && (x.kind === "audience" ? x.audience === (u as typeof x).audience : x.kind === "status" ? x.status === (u as typeof x).status : x.operation === (u as typeof x).operation));
    if (same) same.words.push(...u.words); else out.push({ ...u, words: [...u.words] });
  }
  return out;
}

/** Is this phrase a pipeline instruction only (nothing about the companies themselves)? */
export function operationsOnly(span: string): PipelineOperation[] | null {
  const m = meaningUnits(span);
  if (m.residual.length || !m.units.length || m.units.some((u) => u.kind !== "operation")) return null;
  return m.units.map((u) => (u as Extract<MeaningUnit, { kind: "operation" }>).operation);
}
