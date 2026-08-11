// Structured lead-search intent parser (Part 1). Pure / import-free so it is
// fully unit-testable. It captures the SEARCH dimensions the existing
// extractLeadIntent (leadIntent.ts) doesn't structure — company category,
// GTM motion, hiring/funding triggers, funding requirement, and per-dimension
// relaxation permission — so leadProviderQueryBuilder can produce targeted
// provider queries instead of one mega keyword string. Never invents intent;
// Company-Brain fields backfill what the user left implicit.

export interface CompanySizePreference { min?: number; max?: number; strict: boolean }

export interface LeadSearchIntent {
  original_query: string;
  requested_count: number;

  company_categories: string[];
  must_have_categories: string[];

  role_terms: string[];
  must_have_roles: string[];

  motion_terms: string[];      // outbound, founder-led sales, GTM, pipeline generation
  trigger_terms: string[];     // recently funded, hiring, first sales hire, growing sales team

  funding_required: boolean;
  funding_preferred: boolean;

  locations: string[];
  location_groups: string[];   // e.g. "US", "EU" — expanded by the query builder
  /** True when the user explicitly named a geography — it is a HARD filter and
   *  must NOT be silently relaxed to a wider region. */
  location_explicit: boolean;

  company_size_preference?: CompanySizePreference;

  hard_disqualifiers: string[];
  soft_preferences: string[];

  relaxation_allowed: {
    location: boolean;
    exact_role: boolean;
    funding: boolean;
    size: boolean;
    category: boolean;
  };
}

export interface BrainForIntent {
  industries?: string[];
  disqualifiers?: string[];
  excluded_industries?: string[];
  geography?: string | string[];
  company_size?: string;
  buyer_roles?: string[];
}

const lc = (s: string) => s.toLowerCase();

// Default off-ICP exclusions when the Brain doesn't specify (mirrors companyIcpFilter).
const DEFAULT_DISQUALIFIERS = [
  "manufacturing", "pharma", "pharmaceutical", "chemical", "packaging", "hospital",
  "healthcare provider", "university", "government", "local services", "recruiting agency",
  "staffing agency", "oil", "mining", "logistics", "construction",
];

// Category detection (most-specific first). Not SaaS-only: an ecommerce brand or
// a recruitment agency is a valid target and must resolve to a real category
// instead of falling through to a generic keyword search.
const CATEGORY_PATTERNS: Array<{ re: RegExp; canonical: string; adds: string[] }> = [
  { re: /\bai\s*saas\b|\bai\s+software\b/i, canonical: "AI SaaS", adds: ["B2B SaaS", "software"] },
  { re: /\bai\s+(startups?|compan)/i, canonical: "AI SaaS", adds: ["B2B SaaS", "software"] },
  { re: /\bb2b\s*saas\b/i, canonical: "B2B SaaS", adds: ["software"] },
  { re: /\bfintech\b/i, canonical: "fintech", adds: ["financial software"] },
  { re: /\bhealth\s*tech\b|\bhealthtech\b/i, canonical: "healthtech", adds: ["healthcare software"] },
  { re: /\b(recruit(ing|ment)|staffing)\s+(agenc|firm|business)/i, canonical: "recruitment agency", adds: ["staffing"] },
  { re: /\bmarketing\s+agenc/i, canonical: "marketing agency", adds: ["agency"] },
  { re: /\becommerce\b|\be-commerce\b|\bonline\s+(store|retail|brand)|\bdtc\b|\bd2c\b/i, canonical: "ecommerce", adds: ["retail", "consumer brand"] },
  { re: /\bmarketplace\b/i, canonical: "marketplace", adds: [] },
  { re: /\bsaas\b/i, canonical: "SaaS", adds: ["software"] },
  { re: /\bsoftware\b/i, canonical: "software", adds: [] },
];

// Role library → canonical role_terms. Detection is by explicit mention.
const ROLE_PATTERNS: Array<{ re: RegExp; terms: string[] }> = [
  { re: /\bfounding\s+(ae|account executive)\b/i, terms: ["Founding Account Executive", "Account Executive"] },
  { re: /\bfounding\s+sdr\b/i, terms: ["Founding SDR", "Sales Development Representative"] },
  { re: /\bsdr'?s?\b|\bsales development\b/i, terms: ["SDR", "Sales Development Representative"] },
  { re: /\bbdr'?s?\b|\bbusiness development rep/i, terms: ["BDR", "Business Development Representative"] },
  { re: /\baccount executive'?s?\b|\bae'?s?\b/i, terms: ["Account Executive", "Sales Executive"] },
  { re: /\brev\s*ops\b|\brevenue operations\b/i, terms: ["Revenue Operations", "RevOps", "GTM Operations"] },
  // Sales Operations expands to the adjacent GTM-ops family (recall without drift).
  { re: /\bsales ops\b|\bsales operations\b/i, terms: ["Sales Operations", "RevOps", "Revenue Operations", "GTM Operations"] },
  { re: /\bhead of (sales|revenue|growth)\b/i, terms: ["Head of Sales", "Head of Revenue", "Head of Growth"] },
  { re: /\bvp (of )?(sales|revenue|growth)\b/i, terms: ["VP Sales", "VP Revenue", "VP Growth"] },
  { re: /\bgtm\b|\bgo-?to-?market\b/i, terms: ["GTM Lead", "Go-to-Market"] },
  // Non-sales roles so recruitment/ecommerce ICPs resolve real hiring signals.
  { re: /\b(engineering|technical|tech)\s+recruiters?\b/i, terms: ["Engineering Recruiter", "Technical Recruiter"] },
  { re: /\brecruiters?\b|\btalent acquisition\b/i, terms: ["Recruiter", "Talent Acquisition"] },
  { re: /\blifecycle\s+(marketer|marketing)\b/i, terms: ["Lifecycle Marketing", "CRM Marketing", "Retention Marketing"] },
  { re: /\bgrowth\b/i, terms: ["Growth Lead"] },
];

const MOTION_PATTERNS: Array<{ re: RegExp; term: string }> = [
  { re: /\boutbound\b/i, term: "outbound" },
  { re: /\bfounder-?led sales\b/i, term: "founder-led sales" },
  { re: /\bpipeline (generation|gen)\b/i, term: "pipeline generation" },
  { re: /\bgtm\b|\bgo-?to-?market\b/i, term: "GTM" },
  { re: /\bfirst sales (hire|team)\b/i, term: "first sales hire" },
];

const TRIGGER_PATTERNS: Array<{ re: RegExp; term: string }> = [
  { re: /\brecently funded\b|\bjust raised\b|\bnewly funded\b/i, term: "recently funded" },
  { re: /\braised (a )?\$?\d|\bseries [a-e]\b|\bseed round\b|\bseed[- ]funded\b/i, term: "funding round" },
  { re: /\bhiring\b|\blooking to hire\b|\bopen roles?\b/i, term: "hiring" },
  { re: /\bfirst sales (hire|team)\b|\bbuilding (a|their|its) sales team\b/i, term: "first sales hire" },
  { re: /\bgrowing (the )?sales team\b|\bscaling (sales|gtm)\b/i, term: "growing sales team" },
];

function detectLocations(msg: string): { locations: string[]; groups: string[] } {
  const groups: string[] = [];
  const locations: string[] = [];
  const m = lc(msg);
  if (/\bus\s*\+\s*eu\b|\bus\s+and\s+eu\b|\bus\/eu\b/.test(m)) { groups.push("US", "EU"); }
  else {
    if (/\b(us|usa|united states)\b/.test(m)) groups.push("US");
    if (/\beu\b|\beurope\b/.test(m)) groups.push("EU");
  }
  if (/\bunited kingdom\b|\buk\b/.test(m)) locations.push("United Kingdom");
  if (/\bgermany\b/.test(m)) locations.push("Germany");
  if (/\bnetherlands\b/.test(m)) locations.push("Netherlands");
  if (/\bfrance\b/.test(m)) locations.push("France");
  if (/\bremote\b/.test(m)) locations.push("Remote");
  return { locations: [...new Set(locations)], groups: [...new Set(groups)] };
}

function sizeFromText(msg: string, brainSize?: string): CompanySizePreference | undefined {
  const m = lc(msg + " " + (brainSize ?? ""));
  if (/\bsmall\b|\bearly-?stage\b|\bstartup\b|\bseed\b/.test(m)) return { max: 150, strict: false };
  if (/\bmid-?market\b/.test(m)) return { min: 150, max: 1000, strict: false };
  if (/\benterprise\b/.test(m)) return { min: 1000, strict: false };
  const range = m.match(/(\d+)\s*[-–]\s*(\d+)\s*(employees|people|staff)?/);
  if (range) return { min: Number(range[1]), max: Number(range[2]), strict: false };
  return undefined;
}

/** Parse a user query + optional Company Brain into structured search intent. */
export function extractLeadSearchIntent(opts: { message: string; brain?: BrainForIntent | null }): LeadSearchIntent {
  const message = (opts.message ?? "").trim();
  const brain = opts.brain ?? null;

  // requested_count: "find N", "N leads/companies", else default 5.
  const countM = message.match(/\bfind\s+(\d{1,3})\b/i) ?? message.match(/\b(\d{1,3})\s+(leads?|companies|accounts|prospects?)\b/i);
  const requested_count = countM ? Math.max(1, Math.min(50, Number(countM[1]))) : 5;

  // categories
  const company_categories: string[] = [];
  const must_have_categories: string[] = [];
  for (const c of CATEGORY_PATTERNS) {
    if (c.re.test(message)) {
      if (!company_categories.includes(c.canonical)) company_categories.push(c.canonical);
      for (const a of c.adds) if (!company_categories.includes(a)) company_categories.push(a);
      if (must_have_categories.length === 0) must_have_categories.push(c.canonical); // most specific
    }
  }
  // Brain industries backfill when the user named none.
  if (company_categories.length === 0 && brain?.industries?.length) company_categories.push(...brain.industries);

  // roles
  const role_terms: string[] = [];
  const must_have_roles: string[] = [];
  for (const r of ROLE_PATTERNS) {
    if (r.re.test(message)) {
      for (const t of r.terms) if (!role_terms.includes(t)) role_terms.push(t);
      if (!must_have_roles.includes(r.terms[0])) must_have_roles.push(r.terms[0]);
    }
  }
  if (role_terms.length === 0 && brain?.buyer_roles?.length) role_terms.push(...brain.buyer_roles);

  const motion_terms = MOTION_PATTERNS.filter((p) => p.re.test(message)).map((p) => p.term);
  const trigger_terms = [...new Set(TRIGGER_PATTERNS.filter((p) => p.re.test(message)).map((p) => p.term))];

  const funding_required = /\brecently funded\b|\bjust raised\b|\bnewly funded\b|\bmust be funded\b|\bfunded\b(?!.*\bideal)/i.test(message)
    && !/\bideally funded\b|\bpreferably funded\b/i.test(message);
  const funding_preferred = !funding_required && /\bideally funded\b|\bpreferably funded\b|\bbonus if funded\b/i.test(message);

  const loc = detectLocations(message);
  // A geography named in THIS prompt is explicit (a hard filter). Brain-backfilled
  // geography is not — it may be relaxed. "anywhere/global/worldwide" opts out.
  const globalOptOut = /\b(anywhere|global(ly)?|worldwide|any (location|region|geo)|location[- ]agnostic)\b/i.test(message);
  const location_explicit = !globalOptOut && (loc.groups.length > 0 || loc.locations.length > 0);
  // Brain geography backfill.
  if (loc.groups.length === 0 && loc.locations.length === 0 && brain?.geography) {
    const g = Array.isArray(brain.geography) ? brain.geography : [brain.geography];
    for (const x of g) { if (/\bus\b|united states/i.test(x)) loc.groups.push("US"); else loc.locations.push(x); }
  }

  const company_size_preference = sizeFromText(message, brain?.company_size);

  // The user may EXPLICITLY target a category that is normally excluded (e.g.
  // "find recruitment agencies"). In that case the matching disqualifiers must
  // be dropped — never sabotage the exact search the user asked for. This
  // honours the priority order: explicit user prompt > brain/default safety.
  const targetsRecruiting = /\b(recruit(ing|ment)|staffing)\s+(agenc|firm|business|compan)|\b(recruit(ing|ment)|staffing)\s+(agenc|firm)|\bstaffing\b.*\bagenc/i.test(message);
  const targetsAgency = /\b(agenc(y|ies))\b/i.test(message);
  const dropForTarget = (term: string): boolean => {
    const t = term.toLowerCase();
    if (targetsRecruiting && /(recruit|staffing)/.test(t)) return true;
    if (targetsAgency && /\bagenc/.test(t)) return true;
    return false;
  };

  const hard_disqualifiers = [...new Set([
    ...(brain?.disqualifiers ?? []),
    ...(brain?.excluded_industries ?? []),
    ...((brain?.disqualifiers?.length || brain?.excluded_industries?.length) ? [] : DEFAULT_DISQUALIFIERS),
  ])].filter((d) => !dropForTarget(d));

  const soft_preferences: string[] = [];
  if (/\bearly-?stage\b|\bstartup\b|\bseed\b/i.test(message)) soft_preferences.push("early-stage");
  if (motion_terms.includes("outbound")) soft_preferences.push("outbound motion");

  return {
    original_query: message,
    requested_count,
    company_categories,
    must_have_categories,
    role_terms,
    must_have_roles,
    motion_terms,
    trigger_terms,
    funding_required,
    funding_preferred,
    locations: loc.locations,
    location_groups: loc.groups,
    location_explicit,
    company_size_preference,
    hard_disqualifiers,
    soft_preferences,
    relaxation_allowed: {
      // An explicitly-named geography is a hard filter — never relax it silently.
      location: !location_explicit,
      exact_role: true,
      funding: !funding_required ? true : true, // funding can relax to 'secondary' (never claim funded)
      size: !(company_size_preference?.strict),
      category: false,                            // never relax the must-have category
    },
  };
}

// ── THE SAME DTO, PROJECTED FROM THE CANONICAL MISSION ──────────────────────
//
// `extractLeadSearchIntent` above reads the user's sentence with a category
// table, a role table, a motion table, a trigger table, a geography table and a
// size table. run-agent then let its output OVERWRITE the provider query and the
// location for a jobs search (`planScoutQueries` → `normalizedQuery`/`location`),
// and hand its `funding_required` and category set to the lead TIERING — so a
// regex decided what was searched for and which results counted, after the
// Mission had decided both from the same words.
//
// This projection answers the same questions from decided Mission fields. What
// it still does is FORMATTING: turning "United States" into the query builder's
// `US` group is provider-input shaping of an already-decided value, not a
// reading of the request.

export interface MissionForSearchIntent {
  original_user_query?: string;
  requested_count?: number | null;
  company_profile?: {
    verticals?: string[];
    stages?: string[];
    locations?: string[];
    employee_range?: { min?: number; max?: number };
  };
  required_signals?: Array<{ type?: string; role_families?: string[] } | null>;
  required_signal_terms?: string[];
  geography_is_hard?: boolean;
  no_broadening_requested?: boolean;
}

/** Split decided locations into the query builder's groups and single locations. */
function locationsForQueryBuilder(
  decided: string[],
): { locations: string[]; groups: string[] } {
  const groups: string[] = [];
  const locations: string[] = [];
  for (const raw of decided) {
    const v = lc(String(raw ?? "").trim());
    if (!v) continue;
    if (/^(us|usa|u\.s\.?a?\.?|united states|america|north america)$/.test(v)) groups.push("US");
    else if (/^(eu|europe|emea)$/.test(v)) groups.push("EU");
    else locations.push(String(raw).trim());
  }
  return { locations: [...new Set(locations)], groups: [...new Set(groups)] };
}

/**
 * Project the Scout search intent out of a decided Mission.
 *
 * Mission fields answer WHAT to search for; the Company Brain answers what this
 * workspace excludes, which is where `extractLeadSearchIntent` read it from too.
 *
 * A disqualifier that collides with the Mission's OWN target vertical is dropped,
 * for the same reason the text version dropped one that collided with an explicit
 * "find recruitment agencies": a safety default must not sabotage the exact
 * search that was asked for. The difference is that the collision is now judged
 * against a decided field rather than against the sentence.
 */
export function leadSearchIntentFromMission(
  mission: MissionForSearchIntent, brainInput?: BrainForIntent | null,
): LeadSearchIntent {
  const brain = brainInput ?? null;

  const verticals = (mission.company_profile?.verticals ?? [])
    .map((v) => String(v ?? "").trim()).filter(Boolean);
  const company_categories = verticals.length
    ? [...verticals]
    : [...(brain?.industries ?? [])];
  const must_have_categories = verticals.length ? [verticals[0]] : [];

  const signals = (mission.required_signals ?? []).filter(Boolean);
  const roleTerms = [
    ...(mission.required_signal_terms ?? []),
    ...signals.flatMap((s) => s?.role_families ?? []),
  ].map((t) => String(t ?? "").replace(/[_-]+/g, " ").trim()).filter(Boolean);
  const role_terms = roleTerms.length ? [...new Set(roleTerms)] : [...(brain?.buyer_roles ?? [])];
  const must_have_roles = roleTerms.length ? [roleTerms[0]] : [];

  const trigger_terms = [...new Set(
    signals.map((s) => String(s?.type ?? "").trim()).filter(Boolean),
  )];
  const funding_required = trigger_terms.includes("funding");

  const decidedLocations = (mission.company_profile?.locations ?? [])
    .map((l) => String(l ?? "").trim()).filter(Boolean);
  const loc = decidedLocations.length
    ? locationsForQueryBuilder(decidedLocations)
    : (() => {
      // Brain backfill, exactly as before: a workspace geography is not an
      // explicit request and stays relaxable.
      const g = brain?.geography
        ? (Array.isArray(brain.geography) ? brain.geography : [brain.geography])
        : [];
      return locationsForQueryBuilder(g);
    })();
  const location_explicit = decidedLocations.length > 0 &&
    (mission.geography_is_hard ?? true);

  const range = mission.company_profile?.employee_range;
  const company_size_preference: CompanySizePreference | undefined = range
    ? {
      ...(typeof range.min === "number" ? { min: range.min } : {}),
      ...(typeof range.max === "number" ? { max: range.max } : {}),
      strict: mission.no_broadening_requested === true,
    }
    : undefined;

  const collidesWithTarget = (term: string): boolean => {
    const t = lc(term);
    return company_categories.some((c) => {
      const v = lc(c);
      return !!v && (v.includes(t) || t.includes(v));
    });
  };
  const hard_disqualifiers = [...new Set([
    ...(brain?.disqualifiers ?? []),
    ...(brain?.excluded_industries ?? []),
    ...((brain?.disqualifiers?.length || brain?.excluded_industries?.length)
      ? [] : DEFAULT_DISQUALIFIERS),
  ])].filter((d) => !collidesWithTarget(d));

  const stages = (mission.company_profile?.stages ?? [])
    .map((s) => String(s ?? "").trim()).filter(Boolean);
  const soft_preferences = stages.some((s) => /startup|seed|early/i.test(s))
    ? ["early-stage"] : [];

  const noBroadening = mission.no_broadening_requested === true;

  return {
    original_query: String(mission.original_user_query ?? ""),
    requested_count: Math.max(1, Math.min(50, mission.requested_count ?? 5)),
    company_categories,
    must_have_categories,
    role_terms,
    must_have_roles,
    // The Mission carries no GTM-motion concept. Empty is the honest answer;
    // inventing one would mean reading the sentence again to find it.
    motion_terms: [],
    trigger_terms,
    funding_required,
    funding_preferred: false,
    locations: loc.locations,
    location_groups: loc.groups,
    location_explicit,
    company_size_preference,
    hard_disqualifiers,
    soft_preferences,
    relaxation_allowed: {
      location: !location_explicit && !noBroadening,
      exact_role: !noBroadening,
      funding: true,
      size: !noBroadening && !(company_size_preference?.strict),
      category: false,
    },
  };
}
