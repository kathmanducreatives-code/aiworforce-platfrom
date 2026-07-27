// COMPOSABLE JOB-INTENT TAXONOMY.
//
// THE DEFECT THIS REPLACES
//
// Family detection was an ordered list of whole-query regexes over a flat keyword
// bag. That shape cannot express "sales, at leadership seniority, in a security
// vertical", so it produced answers that were wrong in ways no extra regex could
// fix without adding a conditional per query:
//
//   "MSSPs hiring sales leadership"        → gtm_sales aliases → SDR, BDR, SDR
//   "automation integrators"               → agency_services (a systems
//                                            integrator is not a marketing agency)
//   "first salesperson"                    → no family at all
//   "Sales Operations"                     → SDR/BDR/AE (a different discipline)
//
// A request is decomposed into INDEPENDENT dimensions — function, department,
// seniority, team stage, vertical, geography — and the title strategy is derived
// from their combination. New requests are covered by composition, not by adding
// another special case.
//
// Pure — no network, no model call, and NO imports, so the registry can depend on
// this module without a cycle. Title resolution lives in jobFamilyRegistry
// (`resolveJobIntent`), which owns the title data.

// ---------------------------------------------------------------- dimensions --

export type JobFunction =
  | "sales_operations" | "sales_leadership" | "early_sales" | "sales_ic"
  | "software_engineering" | "ai_engineering" | "controls_engineering" | "energy_engineering"
  | "finance_fpa" | "clinical_operations" | "operations" | "marketing"
  | "partnerships" | "executive";

export type Department =
  | "revenue" | "engineering" | "finance" | "operations"
  | "marketing" | "clinical" | "partnerships" | "executive";

export type TeamStage = "first_hire" | "building" | "scaling" | "established";

export type CompanyVertical =
  | "b2b_saas" | "cybersecurity" | "industrial_automation" | "manufacturing"
  | "healthcare" | "logistics" | "energy" | "financial_services" | "agency_services" | "other";

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9&+/ -]+/g, " ").replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------ vertical --
//
// ONE ordered rule table, shared by the taxonomy and by the Pilot contract, so
// the preview and the runtime can never disagree about what industry was asked
// for. Specific verticals are tested BEFORE the generic ones: an "automation
// integrator" is industrial automation, and only an unrecognised services firm
// falls through to `agency_services`.

const VERTICAL_RULES: Array<[CompanyVertical, RegExp]> = [
  ["cybersecurity", /\b(cyber ?security|infosec|mssps?|mdr|managed security|security vendors?|soc providers?)\b/i],
  // MUST precede agency_services: a systems/controls integrator sells automation
  // engineering, not marketing services.
  ["industrial_automation", /\b(automation integrators?|systems? integrators?|controls integrators?|industrial automation|automation compan(?:y|ies)|robotics integrators?|machine builders?)\b/i],
  ["healthcare", /\b(health ?care|hospitals?|health systems?|clinics?|medical devices?|biotech|pharmaceutical|pharma|life sciences|payers?|providers? networks?)\b/i],
  ["logistics", /\b(logistics|freight|3pls?|third[- ]party logistics|trucking|carriers?|supply ?chain compan(?:y|ies)|shipping compan(?:y|ies)|last[- ]mile)\b/i],
  ["energy", /\b(renewable ?energy|clean ?energy|solar|wind (?:energy|power|farms?)|utilit(?:y|ies)|energy compan(?:y|ies)|grid operators?|battery storage)\b/i],
  ["financial_services", /\b(financial[- ]services|fintech|banks?|banking|credit unions?|insurers?|insurance|asset managers?|wealth management|lenders?)\b/i],
  ["manufacturing", /\b(manufactur\w*|fabricat\w*|machine shops?|industrial suppliers?|foundr(?:y|ies)|plants?)\b/i],
  ["b2b_saas", /\b(b2b saas|saas|software as a service|software compan(?:y|ies)|software startups?|software vendors?)\b/i],
  ["agency_services", /\b(agenc(?:y|ies)|consultanc(?:y|ies)|consulting firms?|dev shops?|studios?|msps?)\b/i],
];

/** Vertical stated by the text, or null when the request never named one. */
export function inferVertical(...sources: Array<string | null | undefined>): CompanyVertical | null {
  const text = sources.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  for (const [key, re] of VERTICAL_RULES) if (re.test(text)) return key;
  return null;
}

// ----------------------------------------------------------------- seniority --
//
// Seniority is only ever reported when the text ACTUALLY states it. An empty
// array means "unspecified", which is different from "individual contributor" —
// conflating the two is what let a request for a CEO *contact* be read as a
// request for a C-level Sales-Operations *hire*.

export type SeniorityToken = "junior" | "ic" | "manager" | "director" | "head" | "vp" | "c_level" | "founder";

/** Ordered so the most senior stated token is reported first. */
const SENIORITY_TOKENS: Array<[SeniorityToken, RegExp]> = [
  ["founder", /\b(founders?|co-?founders?|owners?)\b/i],
  ["c_level", /\b(chief \w+ officer|\bceos?\b|\bcoos?\b|\bcros?\b|\bcfos?\b|\bctos?\b|presidents?|c-level|c-suite)\b/i],
  ["vp", /\b(vps?\b|vice presidents?|svps?\b|leadership)\b/i],
  ["head", /\bheads? of\b/i],
  ["director", /\b(directors?|leaders?|principals?)\b/i],
  ["manager", /\b(managers?|supervisors?)\b/i],
  ["junior", /\b(junior|entry[- ]level|associate|graduate|jr\.?)\b/i],
];

/**
 * Every seniority level the text states, most senior first. Empty when the text
 * never says one.
 */
export function seniorityTokens(text: string): SeniorityToken[] {
  const t = norm(text);
  const out: SeniorityToken[] = [];
  for (const [tok, re] of SENIORITY_TOKENS) if (re.test(t)) out.push(tok);
  // "Head of X" is a director-or-above bar; report both so callers can test
  // either without knowing the wording the user happened to use.
  if (out.includes("head") && !out.includes("director")) out.push("director");
  return out;
}

/** True when nothing above IC was requested — a junior/unspecified hire. */
export function isIcCompatible(tokens: SeniorityToken[]): boolean {
  return !tokens.some((t) => ["manager", "director", "head", "vp", "c_level", "founder"].includes(t));
}

// ---------------------------------------------------------------- team stage --

const FIRST_HIRE_RE = /\b(first \w+ (?:hire|person|rep|engineer|salesperson)|first salespe(?:rson|ople)|founding (?:sdr|ae|salesperson|engineer|team member)|their first|its first|1st (?:sales )?hire)\b/i;
const BUILDING_RE = /\b(expanding|building (?:out )?(?:a|the|its|their)?|standing up|growing (?:its|their|the)|launching (?:a|its|their))\b/i;
const SCALING_RE = /\b(scaling|scale[- ]ups?|doubling|ramping)\b/i;

export function inferTeamStage(text: string): TeamStage {
  const t = norm(text);
  if (FIRST_HIRE_RE.test(t)) return "first_hire";
  if (SCALING_RE.test(t)) return "scaling";
  if (BUILDING_RE.test(t)) return "building";
  return "established";
}

// ------------------------------------------------------------------ function --
//
// Function is decided from the ROLE SIGNAL plus the already-derived seniority and
// team stage. That is what makes "sales leadership", "first salesperson" and
// "SDR" three different answers within one department instead of one alias bag.

const SALES_OPS_RE = /\b(sales op(?:s|erations)|revenue op(?:s|erations)|rev ?ops|gtm op(?:s|erations)|deal desk|revenue strategy (?:and|&) operations|sales strategy (?:and|&) operations)\b/i;
const SALES_IC_RE = /\b(sdrs?|bdrs?|account executives?|\baes?\b|sales development representatives?|business development representatives?|inside sales|sales representatives?|salespe(?:rson|ople)|territory sales|account managers?)\b/i;
const SALES_ANY_RE = /\b(sales|selling|revenue|quota|gtm|go[- ]to[- ]market|new business|commercial)\b/i;
const PARTNERSHIPS_RE = /\b(partnerships?|alliances?|channel partners?|partner managers?|bd leaders?)\b/i;
const CLINICAL_RE = /\b(clinical|patient care|trials?|medical affairs)\b/i;
const CONTROLS_RE = /\b(controls? engineers?|control systems?|\bplc\b|\bscada\b|automation engineers?|instrumentation|robotics engineers?|hmi)\b/i;
const ENERGY_ENG_RE = /\b(grid engineers?|power systems?|transmission engineers?|distribution engineers?|substation|interconnection|electrical engineers?|renewable engineers?)\b/i;
const AI_ENG_RE = /\b(ai engineers?|machine learning|\bml\b|\bllm\b|generative ai|applied scientists?|data scientists?|mlops)\b/i;
const SOFTWARE_ENG_RE = /\b(software engineers?|backend|front[- ]?end|full[- ]?stack|platform engineers?|developers?|\bswe\b|infrastructure engineers?)\b/i;
const FINANCE_RE = /\b(fp&a|fpa|financial planning|financial analysts?|controllers?|accountants?|finance (?:managers?|teams?|leaders?)|treasury)\b/i;
const MARKETING_RE = /\b(marketing|demand gen(?:eration)?|product marketing|brand|content marketing|growth marketing|lifecycle marketing)\b/i;
const OPERATIONS_RE = /\b(operations?|ops\b|supply chain|logistics managers?|program managers?|business operations)\b/i;
const EXECUTIVE_RE = /\b(chief \w+ officer|\bceos?\b|\bcoos?\b|general managers?|managing directors?|executive teams?)\b/i;

export function inferFunction(text: string, seniority: SeniorityToken[], stage: TeamStage): JobFunction | null {
  const t = norm(text);

  // Sales Operations is its own discipline and is matched BEFORE anything that
  // merely contains the word "sales".
  if (SALES_OPS_RE.test(t)) return "sales_operations";

  // Partnerships before generic sales: a partnerships leader is not a quota rep.
  if (PARTNERSHIPS_RE.test(t)) return "partnerships";

  // Clinical operations before generic operations.
  if (CLINICAL_RE.test(t) && OPERATIONS_RE.test(t)) return "clinical_operations";

  // Engineering, most specific discipline first — "controls engineer" and "grid
  // engineer" are not "software engineer".
  if (CONTROLS_RE.test(t)) return "controls_engineering";
  if (ENERGY_ENG_RE.test(t)) return "energy_engineering";
  if (AI_ENG_RE.test(t)) return "ai_engineering";
  if (SOFTWARE_ENG_RE.test(t)) return "software_engineering";

  if (FINANCE_RE.test(t)) return "finance_fpa";
  if (MARKETING_RE.test(t)) return "marketing";

  // SALES, resolved by the OTHER dimensions rather than by a keyword list:
  //   leadership bar   → sales leadership
  //   first hire stage → early / commercial sales
  //   explicit IC role → quota-carrying IC
  if (SALES_ANY_RE.test(t) || SALES_IC_RE.test(t)) {
    if (seniority.some((x) => ["vp", "c_level", "director", "head"].includes(x))) return "sales_leadership";
    if (stage === "first_hire") return "early_sales";
    if (SALES_IC_RE.test(t)) return "sales_ic";
    return "sales_ic";
  }

  if (EXECUTIVE_RE.test(t)) return "executive";
  if (OPERATIONS_RE.test(t)) return "operations";
  return null;
}

/** Department is a deterministic projection of the function. */
export const DEPARTMENT_FOR_FUNCTION: Record<JobFunction, Department> = {
  sales_operations: "revenue",
  sales_leadership: "revenue",
  early_sales: "revenue",
  sales_ic: "revenue",
  software_engineering: "engineering",
  ai_engineering: "engineering",
  controls_engineering: "engineering",
  energy_engineering: "engineering",
  finance_fpa: "finance",
  clinical_operations: "clinical",
  operations: "operations",
  marketing: "marketing",
  partnerships: "partnerships",
  executive: "executive",
};

// ------------------------------------------------------------ title strategy --
//
// The registry family a function maps to. Sales leadership in a security vertical
// keeps the pre-existing `cybersecurity_sales` key so the established broadening
// behaviour for MSSP requests is unchanged; every other vertical uses the generic
// leadership family. Early sales uses `manufacturing_sales`, the registry's
// commercial-sales family, whose `excluded` list already blocks Sales-Operations
// titles.

/**
 * Verticals that sell a physical or engineered product. Their commercial IC is a
 * "Sales Representative / Territory Sales Manager / Account Manager" — a SaaS
 * company's is an "Account Executive / SDR / BDR". Same function, same seniority,
 * different titles: exactly the kind of distinction a flat alias list cannot make.
 */
const FIELD_SALES_VERTICALS: ReadonlySet<CompanyVertical> = new Set<CompanyVertical>([
  "manufacturing", "industrial_automation", "energy", "logistics",
]);

export function familyKeyFor(fn: JobFunction | null, vertical: CompanyVertical | null): string | null {
  switch (fn) {
    case "sales_operations": return "sales_operations";
    case "sales_leadership": return vertical === "cybersecurity" ? "cybersecurity_sales" : "sales_leadership";
    // A first revenue hire defaults to commercial/field titles; only an explicitly
    // software vertical gets the AE/SDR shape.
    case "early_sales": return vertical === "b2b_saas" ? "sales_ic" : "manufacturing_sales";
    case "sales_ic": return vertical && FIELD_SALES_VERTICALS.has(vertical) ? "manufacturing_sales" : "sales_ic";
    case "software_engineering": return "software_engineering";
    case "ai_engineering": return "ai_engineering";
    case "controls_engineering": return "controls_engineering";
    case "energy_engineering": return "energy_engineering";
    case "finance_fpa": return "finance_operations";
    case "clinical_operations": return "clinical_operations";
    case "operations": return "operations";
    case "marketing": return "marketing";
    case "partnerships": return "partnerships";
    case "executive": return "executive";
    default: return null;
  }
}

// ------------------------------------------------------------------ geography --

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

// UNITED STATES — UNAMBIGUOUS FORMS ONLY.
//
// The previous alternation was `/\b(united states|usa|u\.s\.|\bus\b)\b/i`. Under
// `/i`, `\bus\b` matches the PRONOUN, so:
//
//   "Show us founders in Germany"   ->  ["United States"]
//   "Find us five leads in France"  ->  ["United States"]
//
// The request named another country, and the parser asserted a country the user
// never mentioned. Under the deterministic runtime that silently narrows a search;
// under Claude-first planning it hands the planner a confident false premise.
//
// Lowercase `us` is therefore no longer a United-States signal at all. It is a
// common English pronoun, and no amount of surrounding context makes it reliable.
// Only forms that cannot be an ordinary word are accepted.

/** Forms that are unambiguous regardless of case. */
const US_UNAMBIGUOUS = [
  /\bunited states of america\b/i,
  /\bunited states\b/i,
  /\bu\.s\.a\./i,
  /\bu\.s\./i,
  /\busa\b/i,
];

/**
 * Standalone uppercase `US`, read from the ORIGINAL-CASE text.
 *
 * Case-sensitive on purpose: `US` is the country, `us` is the pronoun, and the
 * distinction is exactly the information the old `/i` flag threw away. Letter
 * look-arounds (rather than `\b`) so `US-based` matches while `USB` does not.
 */
const US_UPPERCASE_STANDALONE = /(?<![A-Za-z])US(?![A-Za-z])/;

/**
 * True when the text carries no lowercase letters at all.
 *
 * In SHOUTED text every word is uppercase, so `US` no longer distinguishes the
 * country from the pronoun — "FIND US FOUNDERS IN GERMANY" would reintroduce the
 * very bug this function exists to remove. The uppercase signal is only trusted
 * when the author was actually using case to mean something.
 */
function isAllUpperCase(text: string): boolean {
  return /[A-Z]/.test(text) && !/[a-z]/.test(text);
}

/** Does the text name the United States in an unambiguous way? */
export function mentionsUnitedStates(text: string): boolean {
  const t = String(text ?? "");
  if (US_UNAMBIGUOUS.some((re) => re.test(t))) return true;
  return !isAllUpperCase(t) && US_UPPERCASE_STANDALONE.test(t);
}

/**
 * Geography named by the request. Never invented from the vertical.
 *
 * Still US-only — full worldwide normalization is a later phase. What changed is
 * that a NON-US request now correctly resolves to `[]` (nothing named that this
 * parser understands) instead of to the United States.
 */
export function inferGeography(text: string): string[] {
  const t = String(text ?? "");
  const found: string[] = [];
  for (const s of US_STATES) if (new RegExp(`\\b${s}\\b`, "i").test(t)) found.push(s);
  if (found.length === 0 && mentionsUnitedStates(t)) found.push("United States");
  return found;
}

// ------------------------------------------------------- clause segmentation --
//
// THE DEFECT THIS FIXES
//
// "Find founders of SaaS startups hiring Sales Operations" was read as ONE bag of
// words, so "founders" — which describes the PERSON TO CONTACT — was scored as the
// seniority of the JOB BEING HIRED. The request was reported as a company hiring
// a C-level Sales-Operations employee, which nobody asked for.
//
// The request is split at the hiring verb. Everything after it describes the ROLE
// BEING HIRED; everything before it describes the COMPANY and the DECISION-MAKER
// to contact. The two are then classified independently and never share a field.

const HIRING_PIVOT_RE = /\b(hiring|recruiting|looking to hire|seeking|searching for|expanding|growing|building out|standing up|that need|who need|with an open|with open)\b/i;

export interface RequestClauses {
  /** Company + person-target text — everything before the hiring verb. */
  personClause: string;
  /** The role being hired — everything after the hiring verb. */
  hiringClause: string;
  /** False when no hiring verb was found; the whole text is then the hiring clause. */
  split: boolean;
}

export function splitRequestClauses(text: string): RequestClauses {
  const t = String(text ?? "");
  const m = HIRING_PIVOT_RE.exec(t);
  if (!m || m.index < 0) return { personClause: "", hiringClause: t, split: false };
  return {
    personClause: t.slice(0, m.index),
    hiringClause: t.slice(m.index + m[0].length),
    split: true,
  };
}

// ------------------------------------------------------- decision-maker intent --

/** Person-target phrases, mapped to the canonical roles Agentory will contact. */
const DECISION_MAKER_RULES: Array<[RegExp, string[]]> = [
  // A "founder" ask conventionally covers the whole founding/CEO set.
  [/\b(founders?|co-?founders?)\b/i, ["Founder", "Co-Founder", "CEO"]],
  [/\bowners?\b/i, ["Owner", "Founder", "CEO"]],
  [/\bceos?\b|\bchief executive officers?\b/i, ["CEO"]],
  [/\bctos?\b|\bchief technology officers?\b/i, ["CTO"]],
  [/\bcoos?\b/i, ["COO"]],
  [/\bcfos?\b/i, ["CFO"]],
  [/\bcros?\b/i, ["CRO"]],
  [/\bpresidents?\b/i, ["President"]],
  [/\bheads? of ([a-z& ]+?)\b(?: at| in| for|$|,)/i, []],   // captured below
  [/\bdecision[-\s]?makers?\b/i, ["Founder", "CEO", "VP"]],
  [/\bexecutives?\b/i, ["CEO", "COO", "VP"]],
];

export interface DecisionMakerIntent {
  /** Canonical roles to contact. EMPTY when the request never named a person. */
  roles: string[];
  seniority: SeniorityToken[];
  /** A contactable person must currently work at the qualified company. */
  currentEmployerRequired: boolean;
}

export function extractDecisionMaker(personClause: string): DecisionMakerIntent {
  const t = String(personClause ?? "");
  const roles: string[] = [];

  // "Heads of Engineering" / "Directors of Clinical Operations" keep their own
  // wording — inventing a generic role would lose the department the user named.
  const headOf = /\b(heads?|directors?|vps?|vice presidents?) of ([a-z&][a-z& ]*?)(?=\s+(?:at|in|for|from)\b|[,.]|$)/i.exec(t);
  if (headOf) {
    const level = headOf[1].replace(/s$/i, "").replace(/^vp$/i, "VP");
    const dept = headOf[2].trim().split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    roles.push(`${level[0].toUpperCase()}${level.slice(1)} of ${dept}`);
  }

  for (const [re, mapped] of DECISION_MAKER_RULES) {
    if (mapped.length && re.test(t)) for (const r of mapped) if (!roles.includes(r)) roles.push(r);
  }

  return {
    roles,
    // Seniority of the PERSON, read from the person clause AND the roles it
    // resolved to — a "founders" ask expands to include the CEO, so the bar it
    // actually searches is founder AND c_level. Read only from this clause, so
    // the job being hired can never inherit it.
    seniority: roles.length ? seniorityTokens(`${t} ${roles.join(" ")}`) : [],
    // Only meaningful when there is a person to verify.
    currentEmployerRequired: roles.length > 0,
  };
}

// -------------------------------------------------------------- the compiler --

/** The role being hired. Independent of who Agentory will contact about it. */
export interface HiringRoleIntent {
  /** The clause the classification was actually read from. */
  rawText: string;
  function: JobFunction | null;
  department: Department | null;
  /** Stated levels only. EMPTY means unspecified — never "IC by default". */
  seniority: SeniorityToken[];
  teamStage: TeamStage;
  /** Canonical titles; resolved by jobFamilyRegistry.resolveJobIntent. */
  titles: string[];
}

export interface JobIntent {
  original_query: string;
  hiring_role: HiringRoleIntent;
  decision_maker: DecisionMakerIntent;
  vertical: CompanyVertical | null;
  geography: string[];
  /** Registry family key for the HIRING role, or null when unknown. */
  family_key: string | null;
}

/**
 * Decompose a request into two INDEPENDENT entities plus the shared company
 * dimensions.
 *
 * The hiring role is classified from the hiring clause alone, so a request for a
 * CEO *contact* can never raise the seniority of the *job*. The decision-maker is
 * extracted from the person clause alone, so a request for a VP of Sales *hire*
 * can never invent a person target.
 */
export function compileJobIntent(query: string | null | undefined): JobIntent {
  const text = String(query ?? "");
  const clauses = splitRequestClauses(text);

  // Company-level dimensions read the WHOLE request: the vertical, geography and
  // team stage describe the target company, not one clause of the sentence.
  const vertical = inferVertical(text);
  const geography = inferGeography(text);
  const teamStage = inferTeamStage(text);

  // Role-level dimensions read the HIRING clause only.
  const hiringSeniority = seniorityTokens(clauses.hiringClause);
  const fn = inferFunction(clauses.hiringClause, hiringSeniority, teamStage);

  return {
    original_query: text,
    hiring_role: {
      rawText: clauses.hiringClause.trim(),
      function: fn,
      department: fn ? DEPARTMENT_FOR_FUNCTION[fn] : null,
      seniority: hiringSeniority,
      teamStage,
      titles: [],   // filled by resolveJobIntent, which owns the title data
    },
    decision_maker: extractDecisionMaker(clauses.personClause),
    vertical,
    geography,
    family_key: familyKeyFor(fn, vertical),
  };
}

/** One-line human summary for diagnostics and the CSV export. */
export function summarizeJobIntent(intent: JobIntent): string {
  const h = intent.hiring_role;
  const d = intent.decision_maker;
  return [
    `hiring=${h.function ?? "unclassified"}`,
    `department=${h.department ?? "unknown"}`,
    `hiring_seniority=${h.seniority.length ? h.seniority.join("/") : "unspecified"}`,
    `stage=${h.teamStage}`,
    `decision_maker=${d.roles.length ? d.roles.join("/") : "none"}`,
    `decision_maker_seniority=${d.seniority.length ? d.seniority.join("/") : "none"}`,
    `vertical=${intent.vertical ?? "unspecified"}`,
    `geography=${intent.geography.length ? intent.geography.join("/") : "unspecified"}`,
  ].join("; ");
}
