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

/** The seniority BAR the request implies, not a guess at a specific level. */
export type Seniority = "ic" | "manager" | "director" | "vp" | "c_level";

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

const SENIORITY_RULES: Array<[Seniority, RegExp]> = [
  ["c_level", /\b(chief \w+ officer|\bceos?\b|\bcoos?\b|\bcros?\b|\bcfos?\b|\bctos?\b|presidents?|founders?|owners?)\b/i],
  // "leadership" and "head of" are VP-shaped asks; "VP Sales" and "Head of Sales"
  // are the same bar in practice.
  ["vp", /\b(vps?\b|vice presidents?|head of|leadership|svps?\b)\b/i],
  ["director", /\b(directors?|leaders?|principals?)\b/i],
  ["manager", /\b(managers?|supervisors?)\b/i],
];

export function inferSeniority(text: string): Seniority {
  const t = norm(text);
  for (const [level, re] of SENIORITY_RULES) if (re.test(t)) return level;
  return "ic";
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

export function inferFunction(text: string, seniority: Seniority, stage: TeamStage): JobFunction | null {
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
    if (seniority === "vp" || seniority === "c_level" || seniority === "director") return "sales_leadership";
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

/** Geography named by the request. Never invented from the vertical. */
export function inferGeography(text: string): string[] {
  const t = String(text ?? "");
  const found: string[] = [];
  for (const s of US_STATES) if (new RegExp(`\\b${s}\\b`, "i").test(t)) found.push(s);
  if (found.length === 0 && /\b(united states|usa|u\.s\.|\bus\b)\b/i.test(t)) found.push("United States");
  return found;
}

// -------------------------------------------------------------- the compiler --

export interface JobIntent {
  original_query: string;
  function: JobFunction | null;
  department: Department | null;
  seniority: Seniority;
  team_stage: TeamStage;
  vertical: CompanyVertical | null;
  geography: string[];
  /** Registry family key, or null when nothing safe could be inferred. */
  family_key: string | null;
}

/**
 * Decompose a request into its independent dimensions and derive the title
 * strategy from their combination.
 *
 * An UNRECOGNISED request returns `function: null` with no titles. That is
 * deliberate: inventing a family is how a Sales-Operations search became an SDR
 * search. Callers fall back to their own conservative behaviour.
 */
export function compileJobIntent(query: string | null | undefined): JobIntent {
  const text = String(query ?? "");
  const seniority = inferSeniority(text);
  const team_stage = inferTeamStage(text);
  const vertical = inferVertical(text);
  const fn = inferFunction(text, seniority, team_stage);
  return {
    original_query: text,
    function: fn,
    department: fn ? DEPARTMENT_FOR_FUNCTION[fn] : null,
    seniority,
    team_stage,
    vertical,
    geography: inferGeography(text),
    family_key: familyKeyFor(fn, vertical),
  };
}

/** One-line human summary for diagnostics and the CSV export. */
export function summarizeJobIntent(intent: JobIntent): string {
  const parts = [
    intent.function ?? "unclassified_function",
    `department=${intent.department ?? "unknown"}`,
    `seniority=${intent.seniority}`,
    `stage=${intent.team_stage}`,
    `vertical=${intent.vertical ?? "unspecified"}`,
    `geography=${intent.geography.length ? intent.geography.join("/") : "unspecified"}`,
  ];
  return parts.join("; ");
}
