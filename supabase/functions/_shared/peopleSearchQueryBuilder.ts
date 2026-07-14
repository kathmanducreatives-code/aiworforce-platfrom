// Deterministic HarvestAPI people-search query + retry builder. Pure / import-free.
// Turns a lead-sourcing request into structured, schema-valid actor input and
// three materially-distinct retry attempts — so the actor filters on real
// currentJobTitles + locations + a concise fuzzy searchQuery instead of a
// natural-language AI instruction. No LLM is used to construct or repair queries.
//
// Root cause it fixes (live Q1 plan 18ca455c): searchQuery carried the Scout
// prose ("Use apify_people_search to find 10-15 founders…"), currentJobTitles/
// locations were empty, and all three attempts were identical ⇒ 0 items.

// --------------------------------------------------------------- role parsing --

// Canonical person/decision-maker titles, in output priority order.
const ROLE_PATTERNS: Array<[RegExp, string]> = [
  [/\bco[-\s]?founders?\b/i, "Co-Founder"],
  [/\bfounders?\b/i, "Founder"],
  [/\bce[o0]s?\b|\bchief executives?\b/i, "CEO"],
  [/\bowners?\b/i, "Owner"],
  [/\bmanaging directors?\b|\bmd\b/i, "Managing Director"],
  [/\bpresidents?\b/i, "President"],
];
const ROLE_ORDER = ["Founder", "Co-Founder", "CEO", "Owner", "Managing Director", "President"];

/** Parse canonical person titles from free text (handles plurals: "founders"). */
export function parsePersonRoles(text: string | null | undefined): string[] {
  const t = String(text ?? "");
  const found = new Set<string>();
  for (const [re, title] of ROLE_PATTERNS) if (re.test(t)) found.add(title);
  return ROLE_ORDER.filter((r) => found.has(r));
}

/** Broaden a role set toward higher-confidence senior titles (never unrelated). */
export function broadenRoles(roles: string[]): string[] {
  const out = [...roles];
  for (const r of ["Founder", "Co-Founder", "CEO"]) if (!out.includes(r)) out.push(r);
  return ROLE_ORDER.filter((r) => out.includes(r));
}

// ------------------------------------------------------------- market parsing --

// Specific market/category terms first so "B2B SaaS" wins over bare "SaaS".
const MARKET_PATTERNS: Array<[RegExp, string]> = [
  [/\bb2b\s*saas\b/i, "B2B SaaS"],
  [/\bai\s*saas\b/i, "AI SaaS"],
  [/\bfintech\b/i, "Fintech"],
  [/\bcyber\s*security\b/i, "Cybersecurity"],
  [/\bhealth\s*(?:care|tech)\b/i, "Healthcare"],
  [/\be-?commerce\b/i, "E-commerce"],
  [/\bdev\s*tools?\b|\bdeveloper tools\b/i, "Developer Tools"],
  [/\bsaas\b/i, "SaaS"],
  [/\bartificial intelligence\b|\bai\b/i, "AI"],
];

/** Broaden a specific market term to a wider synonym for retry 2. */
const MARKET_BROADEN: Record<string, string> = {
  "B2B SaaS": "SaaS",
  "AI SaaS": "Artificial Intelligence",
  "SaaS": "SaaS",
  "AI": "Artificial Intelligence",
  "Fintech": "Financial Technology",
  "Cybersecurity": "Security",
  "Healthcare": "Healthcare",
  "E-commerce": "E-commerce",
  "Developer Tools": "Developer Tools",
};

/** Extract canonical market/category terms; specific terms suppress the generic. */
export function parseMarketTerms(text: string | null | undefined): string[] {
  const t = String(text ?? "");
  const out: string[] = [];
  for (const [re, term] of MARKET_PATTERNS) {
    if (!re.test(t)) continue;
    // Suppress bare "SaaS"/"AI" when a specific variant is already captured.
    if (term === "SaaS" && out.some((x) => x.endsWith("SaaS"))) continue;
    if (term === "AI" && out.some((x) => x === "AI SaaS" || x === "AI")) continue;
    if (!out.includes(term)) out.push(term);
  }
  return out;
}

function broadenMarketTerms(terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) {
    const b = MARKET_BROADEN[t] ?? t;
    if (!out.includes(b)) out.push(b);
  }
  return out;
}

/** A concise fuzzy searchQuery from market terms ("B2B SaaS OR AI SaaS"). */
export function buildMarketQuery(terms: string[]): string {
  return terms.filter(Boolean).join(" OR ");
}

// ------------------------------------------------------------ query sanitizer --

// Meta-instruction / agent / tool phrases that must never reach the actor query.
const META_PHRASE_RE = new RegExp(
  [
    "use\\s+apify[_a-z]*",
    "apify[_a-z]*",
    "\\buse\\s+the\\s+[a-z_]+\\s+actor\\b",
    "find\\s+me", "find\\s+\\d+", "get\\s+me", "give\\s+me",
    "using\\s+my\\s+icp", "my\\s+icp", "\\bicp\\b",
    "return\\s+\\d+", "rank\\s+these", "rank\\s+them",
    "source_and_qualify_only", "execution[_\\s]?mode",
    "contact\\s+right\\s+now", "should\\s+contact",
    "hot\\s+leads?", "\\d+\\s*[-–to]+\\s*\\d+\\s*(?:leads?|founders?|results?|people|profiles?)",
  ].join("|"),
  "gi",
);
// Standalone requested counts like "10-15" / "5 leads".
const COUNT_RE = /\b\d+\s*[-–]\s*\d+\b|\b\d+\s+(?:leads?|results?|profiles?|people|founders?|co-?founders?)\b/gi;

/**
 * Strip tool names, agent meta-instructions, requested counts and execution-mode
 * phrases from a raw query. Never used to inject data — only to remove junk. If a
 * caller passes prose, the result is a cleaned remnant; the structured builder
 * (buildMarketQuery) is the authoritative source of the fuzzy query.
 */
export function sanitizeSearchQuery(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(META_PHRASE_RE, " ")
    .replace(COUNT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------------------------------------------- intent parse --

export interface DeferredQualification {
  /** e.g. "10-150" — no supported actor field, applied in enrichment/ranking. */
  employee_count?: string;
  company_stage?: string;
  /** Any ICP condition not expressible as an actor filter (never discarded). */
  raw_notes: string[];
}

export interface PeopleSearchIntent {
  roles: string[];
  marketTerms: string[];
  locations: string[];
  deferred: DeferredQualification;
}

const LOCATION_PATTERNS: Array<[RegExp, string]> = [
  [/\bunited states\b|\bu\.?s\.?a\.?\b|\bamerica\b|\bus\b/i, "United States"],
  [/\bunited kingdom\b|\bu\.?k\.?\b|\bbritain\b/i, "United Kingdom"],
  [/\bnew york\b|\bnyc\b/i, "New York"],
  [/\bsan francisco\b|\bsf bay\b|\bbay area\b/i, "San Francisco"],
  [/\blondon\b/i, "London"],
  [/\bremote\b/i, "Remote"],
];
const EMPLOYEE_RE = /\b(\d+\s*[-–]\s*\d+|\d+\+?)\s*(?:employees?|people|headcount|person)\b/i;
const STAGE_RE = /\b(pre-?seed|seed|series\s+[a-e]|bootstrapped|growth[-\s]?stage)\b/i;

/** Deterministically parse a people-search request into structured filters. */
export function parsePeopleSearchIntent(text: string | null | undefined): PeopleSearchIntent {
  const t = String(text ?? "");
  const roles = parsePersonRoles(t);
  const marketTerms = parseMarketTerms(t);
  const locations: string[] = [];
  for (const [re, loc] of LOCATION_PATTERNS) if (re.test(t) && !locations.includes(loc)) locations.push(loc);

  const raw_notes: string[] = [];
  const deferred: DeferredQualification = { raw_notes };
  const emp = t.match(EMPLOYEE_RE);
  if (emp) {
    deferred.employee_count = emp[1].replace(/\s+/g, "");
    raw_notes.push(`employee_count=${deferred.employee_count} (no actor filter; qualify downstream)`);
  }
  const stage = t.match(STAGE_RE);
  if (stage) {
    deferred.company_stage = stage[1];
    raw_notes.push(`company_stage=${stage[1]} (qualify downstream)`);
  }
  return { roles, marketTerms, locations, deferred };
}

// -------------------------------------------------------------- attempt builder --

export type PeopleAttemptLabel = "exact" | "broadened" | "minimal_safe";

export interface PeopleAttempt {
  label: PeopleAttemptLabel;
  /** Official HarvestAPI actor input (only supported fields). */
  payload: Record<string, unknown>;
  fingerprint: string;
}

export interface AttemptOptions {
  maxItems: number;
  /** takePages for a capped probe (default 1). */
  takePages?: number;
  startPage?: number;
  profileScraperMode?: string;
}

/** Stable short fingerprint over the payload's identity fields (djb2 → base36). */
export function peopleAttemptFingerprint(payload: Record<string, unknown>): string {
  const norm = {
    t: Array.isArray(payload.currentJobTitles) ? [...payload.currentJobTitles].map(String).sort() : [],
    l: Array.isArray(payload.locations) ? [...payload.locations].map(String).sort() : [],
    q: typeof payload.searchQuery === "string" ? payload.searchQuery.toLowerCase() : "",
    m: Number(payload.maxItems) || 0,
    p: Number(payload.takePages) || 0,
  };
  const s = JSON.stringify(norm);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "pa_" + h.toString(36);
}

function basePayload(roles: string[], locations: string[], opts: AttemptOptions): Record<string, unknown> {
  const p: Record<string, unknown> = {
    profileScraperMode: opts.profileScraperMode ?? "Full",
    maxItems: Math.max(1, Math.min(100, opts.maxItems)),
    takePages: Math.max(1, Math.floor(opts.takePages ?? 1)),
    startPage: Math.max(1, Math.floor(opts.startPage ?? 1)),
  };
  if (roles.length) p.currentJobTitles = roles;
  if (locations.length) p.locations = locations;
  return p;
}

/**
 * Build three materially-distinct, deterministic attempts:
 *   1. exact        — parsed roles + exact market query + geography
 *   2. broadened    — role aliases (adds CEO) + broadened market wording + geography
 *   3. minimal_safe — high-confidence roles + geography, market phrase REMOVED
 *                     (downstream Company Brain qualification decides ICP fit)
 * Every later attempt relaxes at least one restriction. Only official fields; no
 * unsupported employee-size/company attributes are ever emitted.
 */
export function buildPeopleSearchAttempts(intent: PeopleSearchIntent, opts: AttemptOptions): PeopleAttempt[] {
  const roles = intent.roles.length ? intent.roles : ["Founder", "Co-Founder", "CEO"];
  const locations = intent.locations;

  // 1) exact
  const exact = basePayload(roles, locations, opts);
  const exactQ = buildMarketQuery(intent.marketTerms);
  if (exactQ) exact.searchQuery = exactQ;

  // 2) broadened — relax roles + market wording, keep geography
  const broad = basePayload(broadenRoles(roles), locations, opts);
  const broadQ = buildMarketQuery(broadenMarketTerms(intent.marketTerms));
  if (broadQ) broad.searchQuery = broadQ;

  // 3) minimal_safe — drop the (possibly over-restrictive) market phrase entirely
  const minimal = basePayload(broadenRoles(roles), locations, opts);

  return ([
    ["exact", exact],
    ["broadened", broad],
    ["minimal_safe", minimal],
  ] as Array<[PeopleAttemptLabel, Record<string, unknown>]>).map(([label, payload]) => ({
    label,
    payload,
    fingerprint: peopleAttemptFingerprint(payload),
  }));
}

/** Build the single best (exact) attempt payload for a one-shot call. */
export function buildPeopleSearchPayload(text: string | null | undefined, opts: AttemptOptions): Record<string, unknown> {
  return buildPeopleSearchAttempts(parsePeopleSearchIntent(text), opts)[0].payload;
}
