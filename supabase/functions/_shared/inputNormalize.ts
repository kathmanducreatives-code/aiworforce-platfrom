// Pre-execution input validation + normalization for adaptive workflows.
// Pure / import-free. Fix typos, cap counts, reject raw descriptions as queries,
// and normalize role/industry/location before any tool runs.

const TYPO_MAP: Record<string, string> = {
  ggtm: "GTM",
  gtm: "GTM",
  healtcare: "healthcare",
  helthcare: "healthcare",
  fintec: "fintech",
  saas: "SaaS",
  "b2b": "B2B",
  founderr: "founder",
  foudner: "founder",
  enginer: "engineer",
  markting: "marketing",
  recruting: "recruiting",
  recruitng: "recruiting",
  recuiting: "recruiting",
  agencey: "agency",
  agncy: "agency",
};

// Multi-word phrase fixes applied before word-level fixes.
const PHRASE_FIXES: Array<[RegExp, string]> = [
  [/\bearly[-\s]?startup\b/gi, "early-stage startup"],
  [/\bearly[-\s]?stage[-\s]?startup\b/gi, "early-stage startup"],
  [/\bseries[-\s]?a\b/gi, "Series A"],
  [/\bgo to market\b/gi, "GTM"],
];

/** Normalize a free-text term: phrase fixes → per-word typo fixes. */
export function normalizeTerm(input: string | null | undefined): string {
  let t = (input ?? "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  for (const [re, rep] of PHRASE_FIXES) t = t.replace(re, rep);
  t = t
    .split(" ")
    .map((w) => {
      const key = w.toLowerCase().replace(/[.,;:]+$/, "");
      return TYPO_MAP[key] ?? w;
    })
    .join(" ");
  return t;
}

/** Cap a requested count to a safe range. Default ceiling 25, floor 1, default 5. */
export function capCount(n: unknown, opts: { def?: number; max?: number } = {}): number {
  const def = opts.def ?? 5;
  const max = opts.max ?? 25;
  const num = typeof n === "number" ? n : parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(num) || num <= 0) return def;
  return Math.min(max, Math.max(1, Math.floor(num)));
}

/**
 * Reject raw business descriptions / full sentences as search queries. Returns a
 * cleaned short query, or null if the input is a paragraph (caller falls back to
 * category terms instead of searching a description verbatim).
 */
export function sanitizeQuery(raw: string | null | undefined): string | null {
  const t = normalizeTerm(raw).replace(/[.;:]+$/, "");
  if (!t) return null;
  const words = t.split(" ");
  if (words.length > 8) return null;            // paragraph / description
  if (/[.!?].+/.test(t)) return null;           // internal sentence break
  if (/^(?:we|our|i)\b/i.test(t) && words.length > 4) return null; // "we sell X for Y"
  return t;
}

export interface NormalizedLeadInput {
  query: string | null;
  role_keywords: string[];
  location: string | null;
  industry: string | null;
  count: number;
  dropped_fields: string[]; // unsupported actor fields that were removed
  changes: string[];        // human-readable normalization notes
}

const ALLOWED_KEYS = new Set(["query", "role_keywords", "location", "industry", "count", "company_category", "stage", "source_type", "selected_actor_key", "signal_type", "competitors", "user_input", "max_results", "needs_outreach"]);

/** Validate + normalize a lead/sourcing tool input. Cleans typos, caps count,
 *  drops unsupported actor fields, and refuses raw-description queries. */
export function normalizeLeadInput(input: Record<string, unknown>, opts: { defCount?: number; maxCount?: number } = {}): NormalizedLeadInput {
  const changes: string[] = [];
  const dropped: string[] = [];

  const rawQuery = typeof input.query === "string" ? input.query : "";
  const normQuery = normalizeTerm(rawQuery);
  if (normQuery && normQuery !== rawQuery.trim()) changes.push(`query "${rawQuery.trim()}" → "${normQuery}"`);
  const query = sanitizeQuery(normQuery);
  if (!query && normQuery) changes.push("query looked like a description — using category/role terms instead");

  const rawRoles = Array.isArray(input.role_keywords) ? input.role_keywords.map((r) => String(r)) : [];
  const role_keywords = Array.from(new Set(rawRoles.map((r) => normalizeTerm(r)).filter(Boolean)));

  const location = input.location ? normalizeTerm(String(input.location)) || null : null;
  const industry = input.industry ? normalizeTerm(String(input.industry)) || null : null;

  const count = capCount(input.count ?? input.max_results, { def: opts.defCount ?? 5, max: opts.maxCount ?? 25 });

  for (const k of Object.keys(input)) if (!ALLOWED_KEYS.has(k)) dropped.push(k);
  if (dropped.length) changes.push(`removed unsupported fields: ${dropped.join(", ")}`);

  return { query, role_keywords, location, industry, count, dropped_fields: dropped, changes };
}
