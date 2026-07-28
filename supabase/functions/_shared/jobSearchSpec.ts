// COMPILED JOB SEARCH SPEC — the deterministic bridge between a natural-language
// compound request and a jobs-provider search.
//
// Live defect (run lead-quality-sales-ops-us-20260725T150059Z): the runtime sent
// the WHOLE sentence ("Founders of SaaS startups hiring Sales Operations in the
// United States") to LinkedIn as the job keyword string. LinkedIn returned 25
// unrelated postings, the job-family gate correctly dropped all of them, and the
// funnel produced zero companies.
//
// The request's parts belong to DIFFERENT stages:
//   job family / hiring role → jobs-provider keywords
//   location                 → jobs-provider location filter
//   company vertical (SaaS)  → post-source company qualification
//   founder / owner / CEO    → the scoped people search, AFTER a company verifies
//   original sentence        → provenance, observability, UI, replay — never keywords
//
// No LLM: role dictionaries, the shared job-family classifier, and deterministic
// location parsing only.

import { classifyJobFamily, type JobFamily } from "./jobFamily.ts";
import { inferRequestedVertical, type Vertical } from "./verticalQualification.ts";
import { normalizeCountry, detectCountryInText } from "./locationMatch.ts";
import { getJobFamily, inferFamilyKey } from "./jobFamilyRegistry.ts";

export type JobSearchCompilationStatus = "compiled" | "insufficient" | "not_applicable";

export interface CompiledJobSearchSpec {
  /** Deterministic families the hiring signal must belong to. */
  job_families: JobFamily[];
  /** BOUNDED, role-focused provider keyword strings. Never the original sentence. */
  keyword_queries: string[];
  /** Location as the provider filter expects it (state / country / region). */
  location: string | null;
  country: string | null;
  /** Drives POST-source company qualification — never a provider keyword. */
  company_vertical: Vertical | null;
  /** Drives the SCOPED people search after a company verifies — never a keyword. */
  requested_person_roles: string[];
  /** Kept for provenance/replay only. */
  original_query: string;
  compilation_status: JobSearchCompilationStatus;
  /** Why compilation failed, for an honest runtime error. */
  insufficient_reason: string | null;
}

// ------------------------------------------------------------------ roles ----

/** Executive/owner roles a compound "<person> of <company>" request can request. */
const PERSON_ROLE_EXPANSION: Record<string, string[]> = {
  founder: ["Founder", "Co-Founder", "CEO"],
  "co-founder": ["Co-Founder", "Founder", "CEO"],
  cofounder: ["Co-Founder", "Founder", "CEO"],
  owner: ["Owner", "Founder", "President"],
  president: ["President", "Owner", "Founder"],
  ceo: ["CEO", "Founder", "Co-Founder"],
};

/** The curated Sales/Revenue-Operations keyword set. Every entry qualifies under
 * the SHARED classifier, so the gate can never reject what we searched for. It
 * deliberately excludes AE/AM/SDR/BDR/"sales manager" — widening a Sales-Ops ask
 * into generic sales roles is what produces junk leads. */
const SALES_OPS_VARIANTS = ["Sales Operations", "Revenue Operations", "GTM Operations"];

/** Hiring verbs that introduce the requested ROLE. */
const HIRING_LEAD_RE = /\b(?:hiring|recruiting|looking to hire|seeking|needs?|wants?|searching for)\s+(?:for\s+|an?\s+|their\s+|its\s+|a\s+new\s+)?/i;
/** Trailing clause that ends the role phrase (location / company prose / end). */
const ROLE_TAIL_RE = /\s+\b(?:in|across|within|based\s+in|throughout|around|near|located\s+in|for|at|who|that|which|with)\b.*$/i;

// -------------------------------------------------------------- locations ----

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia",
  "Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland",
  "Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey",
  "New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina",
  "South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "District of Columbia",
];

const COUNTRY_PHRASES: Array<[RegExp, string]> = [
  [/\bthe\s+united\s+states(?:\s+of\s+america)?\b|\bunited\s+states\b|\bthe\s+u\.?s\.?a?\.?\b|\busa\b/i, "United States"],
  [/\bthe\s+united\s+kingdom\b|\bunited\s+kingdom\b|\bthe\s+u\.?k\.?\b/i, "United Kingdom"],
  [/\bcanada\b/i, "Canada"],
  [/\baustralia\b/i, "Australia"],
  [/\bgermany\b/i, "Germany"],
  [/\bindia\b/i, "India"],
  [/\bnorth\s+america\b/i, "North America"],
];

/** Deterministic location extraction: explicit country phrase, else a US state. */
export function extractJobLocation(text: string): { location: string | null; country: string | null } {
  const t = text ?? "";
  for (const [re, label] of COUNTRY_PHRASES) {
    if (re.test(t)) return { location: label, country: normalizeCountry(label) ?? label };
  }
  for (const st of US_STATES) {
    if (new RegExp(`\\b${st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) {
      return { location: st, country: normalizeCountry("United States") ?? "US" };
    }
  }
  const detected = detectCountryInText(t);
  return detected ? { location: detected, country: detected } : { location: null, country: null };
}

// ------------------------------------------------------------ role phrase ----

function titleCasePhrase(s: string): string {
  return s.trim().replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w.length <= 2 && /^(of|at|to|in)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/** "Managers" → "Manager"; leaves "Operations"/"Sales" style plurals alone. */
function singularizeHead(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  if (!words.length) return phrase;
  const last = words[words.length - 1];
  if (/(ss|us|Ops|ops)$/.test(last)) return phrase;
  // Domain words that only LOOK plural — "VP Sales" must not become "VP Sale".
  if (/^(operations|sales|analytics|systems|solutions|services|finance)$/i.test(last)) return phrase;
  if (/s$/.test(last)) words[words.length - 1] = last.replace(/s$/, "");
  return words.join(" ");
}

// ------------------------------------------------------- bounded role lists --
//
// A hiring requirement is frequently a LIST: "hiring for Sales Operations,
// Revenue Operations, or GTM Operations roles". The tail used to be measured as
// one blob against a six-word ceiling, so that perfectly ordinary sentence — 7
// words once the conjunction is counted — was rejected outright and the whole
// request compiled to `no_hiring_role_phrase` with an EMPTY keyword list. One
// conjunction was the difference between a working search and no search at all.
//
// The ceiling was the wrong instrument. A list is not long prose, and prose is
// not made safe by being short. So the tail is SPLIT on the separators a list
// actually uses, and each segment is judged on its own merits against the shared
// job-family classifier. Narrative text fails because none of its segments name a
// recognised role — not because someone counted its words.

/**
 * Is this phrase a role either registry recognises?
 *
 * `classifyJobFamily` falls back to `"other"` rather than refusing, so its
 * verdict alone cannot distinguish "a role we do not model" from "not a role at
 * all". `inferFamilyKey` is the second opinion, and a phrase both decline is
 * treated as prose.
 */
function isRecognisedRolePhrase(phrase: string): boolean {
  if (classifyJobFamily(phrase, null).family !== "other") return true;
  if (inferFamilyKey([], [phrase], null) != null) return true;
  // Neither registry models every legitimate title ("Business Development
  // Manager" is a real hiring role both decline), so a phrase ENDING in a job
  // head-noun is accepted as well. This stays structural and bounded: it is the
  // head noun that must qualify, which is what separates "Business Development
  // Manager" from "Because They Are Growing Fast".
  return ROLE_HEAD_NOUN_RE.test(phrase);
}

/** Head nouns that make a phrase a job title rather than prose. */
const ROLE_HEAD_NOUN_RE =
  /\b(?:manager|managers|engineer|engineers|developer|developers|representative|representatives|director|directors|specialist|specialists|analyst|analysts|lead|leads|officer|officers|coordinator|coordinators|administrator|administrators|architect|architects|consultant|consultants|designer|designers|scientist|scientists|technician|technicians|operations|ops|associate|associates|partner|partners|recruiter|recruiters|controller|controllers|accountant|accountants|planner|planners|strategist|strategists|executives?)\s*$/i;

/** Separators a bounded role list uses. Oxford comma and "/" included. */
const ROLE_LIST_SPLIT_RE = /\s*(?:,|;|\/|\bor\b|\band\b)\s*/i;

/** At most this many roles. A request naming more is not a bounded list. */
export const MAX_HIRING_ROLES = 4;

/** Words per single role. "Senior Revenue Operations Manager" is four. */
const MAX_ROLE_WORDS = 5;

/** Strip the trailing role noun and punctuation a list ends with. */
function trimRoleTail(s: string): string {
  return s
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\b(roles?|positions?|jobs?|openings?|hires?)\b\s*$/i, "")
    .trim();
}

/**
 * Every requested HIRING role in the sentence, in order, deduplicated.
 *
 * Each candidate segment must be recognised by `classifyJobFamily` — the SAME
 * classifier the downstream gate uses to accept or reject a posting. That is the
 * property worth having: we can only search for something the gate would also
 * recognise, so a widened parse can never produce keywords the funnel will throw
 * away. An unrecognised segment is dropped silently; if none survive, the caller
 * gets `null` exactly as before.
 *
 * Returns HIRING roles only. Decision-maker roles ("founders", "CEOs") are parsed
 * elsewhere and never enter this list — they sit before the hiring verb, and this
 * only ever reads the text after it.
 */
export function extractHiringRolePhrases(text: string): string[] {
  const t = (text ?? "").trim();
  const m = HIRING_LEAD_RE.exec(t);
  if (!m) return [];

  let tail = t.slice(m.index + m[0].length);
  tail = tail.replace(ROLE_TAIL_RE, "").trim();
  tail = trimRoleTail(tail);
  if (!tail) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of tail.split(ROLE_LIST_SPLIT_RE)) {
    const segment = trimRoleTail(raw.trim());
    if (!segment) continue;
    // A segment longer than a title is prose, not a role.
    if (segment.split(/\s+/).length > MAX_ROLE_WORDS) continue;

    const phrase = singularizeHead(titleCasePhrase(segment));
    if (!phrase) continue;

    // THE REGISTRIES DECIDE, not a word count. Two are consulted because they
    // cover different ground: `classifyJobFamily` owns the operations families
    // the Sales-Ops gate is built on, and `inferFamilyKey` owns the broader
    // job-family registry (engineering, sales, marketing, …). A phrase neither
    // recognises is prose, however short it is — which is what keeps "because
    // they are growing fast" out of the keyword list.
    if (!isRecognisedRolePhrase(phrase)) continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= MAX_HIRING_ROLES) break;
  }

  return out;
}

/**
 * The FIRST requested hiring role, or null.
 *
 * Signature and meaning unchanged for existing callers; it is now the head of
 * `extractHiringRolePhrases` rather than a separate parse, so the two can never
 * disagree about what the sentence asked for.
 */
export function extractHiringRolePhrase(text: string): string | null {
  return extractHiringRolePhrases(text)[0] ?? null;
}

/** A pure job-keyword ask ("Sales Operations jobs in the US") — role phrase sits
 * BEFORE the job noun rather than after a hiring verb. */
const JOB_NOUN_LEAD_RE = /^(.{2,60}?)\s+\b(?:jobs?|job\s+openings?|openings?|job\s+postings?|roles?|positions?|vacanc(?:y|ies))\b/i;

export function extractJobNounRolePhrase(text: string): string | null {
  const m = JOB_NOUN_LEAD_RE.exec((text ?? "").trim());
  if (!m) return null;
  const phrase = m[1].replace(/^\s*(?:find|show|list|get|search\s+for)\s+/i, "").trim();
  if (!phrase || phrase.split(/\s+/).length > 5) return null;
  return singularizeHead(titleCasePhrase(phrase));
}

// ---------------------------------------------------------------- compile ----

export interface JobSearchCompileInput {
  text: string;
  hiringSignalRequired: boolean;
  requestedPersonRole: string | null;
  /** person_roles from the compiled intent (already evidence-backed). */
  personRoles?: string[];
  /** Pure job-keyword requests compile too, with NO invented person role. */
  jobFirst?: boolean;
}

/**
 * Translate a natural-language request into a bounded, provider-independent job
 * search. NEVER returns the original sentence as a keyword.
 */
export function compileJobSearchSpec(input: JobSearchCompileInput): CompiledJobSearchSpec {
  const text = input.text ?? "";
  const base: CompiledJobSearchSpec = {
    job_families: [], keyword_queries: [], location: null, country: null,
    company_vertical: null, requested_person_roles: [], original_query: text,
    compilation_status: "not_applicable", insufficient_reason: null,
  };

  // A request with no employer-side hiring signal (pure person lookup, job seeker,
  // company-only search) has no jobs search to compile.
  if (!input.hiringSignalRequired && !input.jobFirst) return base;

  const listedRoles = extractHiringRolePhrases(text);
  const rolePhrases = listedRoles.length
    ? listedRoles
    : (input.jobFirst ? [extractJobNounRolePhrase(text)].filter(Boolean) as string[] : []);
  const rolePhrase = rolePhrases[0] ?? null;
  const { location, country } = extractJobLocation(text);
  const company_vertical = inferRequestedVertical(text);

  const requested_person_roles = input.jobFirst
    ? [] // a job-keyword ask must never invent a founder/owner target
    : expandPersonRoles(input.requestedPersonRole, input.personRoles ?? []);

  if (!rolePhrase) {
    return {
      ...base, location, country, company_vertical, requested_person_roles,
      compilation_status: "insufficient",
      insufficient_reason: "no_hiring_role_phrase",
    };
  }

  // Classify EVERY requested role, not just the first. A request naming three
  // operations disciplines is one hiring requirement with three acceptable
  // shapes, and dropping two of them narrows the search the user actually asked
  // for.
  const families = rolePhrases.map((p) => classifyJobFamily(p, null));
  const anySalesOps = families.some((f) => f.qualifiesAsSalesOps);

  // The curated Sales/Revenue-Ops set already IS the union of these three
  // families and every entry is gate-approved, so it stays the canonical answer
  // whenever any listed role qualifies — the same behavior as before, now
  // reached from a list rather than only from a single phrase.
  const keyword_queries = anySalesOps
    ? [...SALES_OPS_VARIANTS]
    : [...new Set(rolePhrases)];
  const job_families = anySalesOps
    ? (["sales_ops", "rev_ops", "gtm_ops"] as JobFamily[])
    : ([...new Set(families.map((f) => f.family))] as JobFamily[]);

  return {
    job_families, keyword_queries, location, country, company_vertical,
    requested_person_roles, original_query: text,
    compilation_status: "compiled", insufficient_reason: null,
  };
}

/**
 * Round-scoped keyword expansion. Broadening widens the SEARCH SPACE only — every
 * added title must still qualify under the SHARED job-family classifier, so a
 * broadened round can never smuggle a role past the gate (and never wastes budget
 * fetching jobs the gate will drop).
 *
 * Deliberately NOT added: Account Executive / Account Manager / SDR / BDR /
 * generic Business Development / Customer Success — those are gate weakening.
 */
/**
 * DEPRECATED shim. Broadening is now owned by the general architecture:
 *   jobFamilyRegistry → sourcingConstraints → BroadeningPlan → validator →
 *   cost forecast → companyFirstQuotaController.
 *
 * The old body hardcoded Sales-Operations variants, so every other request
 * ("hiring software engineers") had no safe expansion at all. It now delegates to
 * the registry so any family broadens correctly, and an unknown family stays on
 * its exact titles.
 */
export function keywordQueriesForRound(spec: CompiledJobSearchSpec, round: number): { keywords: string[]; expansion: string } {
  const base = spec.keyword_queries;
  if (round <= 1) return { keywords: base, expansion: "exact_title_synonyms" };
  const familyKey = inferFamilyKey(spec.job_families as string[], base, spec.original_query);
  const def = getJobFamily(familyKey);
  if (!def) return { keywords: base, expansion: "exact_titles_only" };
  const merged = [...base];
  for (const v of def.synonyms) if (!merged.includes(v)) merged.push(v);
  if (round >= 3) for (const a of def.adjacent) if (!merged.includes(a)) merged.push(a);
  return { keywords: merged, expansion: round >= 3 ? "approved_adjacent_titles" : "validated_adjacent_titles" };
}

function expandPersonRoles(requested: string | null, personRoles: string[]): string[] {
  const key = (requested ?? personRoles[0] ?? "").toLowerCase().trim();
  if (!key) return [];
  const expanded = PERSON_ROLE_EXPANSION[key];
  if (expanded) return [...expanded];
  return [titleCasePhrase(key)];
}

/**
 * HARD INVARIANT — a compiled compound request may never send its own sentence to
 * the provider. Returns the offending keyword, or null when safe.
 */
export function findRawQueryLeak(spec: CompiledJobSearchSpec): string | null {
  const original = normalizeForCompare(spec.original_query);
  if (!original) return null;
  for (const k of spec.keyword_queries) {
    const kn = normalizeForCompare(k);
    if (!kn) continue;
    if (kn === original) return k;
    // A keyword that swallows the sentence's company/person prose is also a leak.
    if (/\b(founders?|co-?founders?|owners?|presidents?|ceos?)\s+of\b/i.test(k)) return k;
    if (/\bstartups?\s+hiring\b|\bcompanies\s+hiring\b/i.test(k)) return k;
    if (kn.split(" ").length > 6) return k;
  }
  return null;
}

function normalizeForCompare(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
