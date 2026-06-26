// leadQuality: Claude-Code-level lead scoring. A pure, dependency-free evaluator
// that scores a single sourced lead against Company Brain (ICP/GTM/positioning),
// the user's request, the source type, and any enrichment — like a skilled
// operator deciding "is this actually worth pursuing?".
//
// Hard rules:
//  - Never invent fields. Missing data lowers confidence / score, it does not
//    fabricate a match.
//  - Hard-reject obvious mismatches (wrong strict geography/industry, no real
//    business source, too large when early-stage requested, no signal,
//    job-board/directory posing as a company site, Company Brain disqualifiers).
//  - Prefer fewer strong leads over many weak ones: acceptance requires a
//    "qualified" score, not merely "not rejected".
//
// Scoring (max 100): signal 30 · ICP fit 25 · persona 15 · size/stage 10 ·
// geography 10 · website verification 10.

export interface LeadInput {
  name?: string | null;
  company?: string | null;
  title?: string | null;
  website?: string | null;
  location?: string | null;
  industry?: string | null;
  category?: string | null;
  team_size?: string | null;
  stage?: string | null;
  signal_type?: string | null;
  exact_signal?: string | null;
  source_url?: string | null;
  raw?: unknown;
}

export interface BrainICP {
  buyer_roles?: string[];
  company_size?: string;
  industries?: string[];
  geography?: string;
  pain_points?: string[];
  disqualifiers?: string[];
}

export interface CompanyBrainLite {
  icp?: BrainICP;
  gtm?: { motion?: string; primary_channel?: string; preferred_channels?: string[] };
  positioning?: Record<string, unknown>;
  company?: { stage?: string; industry?: string; category?: string };
}

export interface UserRequest {
  role?: string | null;
  industry?: string | null;
  category?: string | null;
  location?: string | null;
  stage?: string | null;
  strict_location?: boolean;
  strict_industry?: boolean;
  strict_stage?: boolean;
}

export interface Enrichment {
  website_verified?: boolean;
  scraped?: boolean;
}

export type LeadTier = "hot" | "qualified" | "weak" | "rejected";
export type Confidence = "high" | "medium" | "low";

export interface LeadQualityResult {
  accepted: boolean;
  score: number;
  tier: LeadTier;
  reasons: string[];
  reject_reasons: string[];
  confidence: Confidence;
  matched_icp_fields: string[];
  missing_fields: string[];
}

export interface EvaluateLeadQualityArgs {
  lead: LeadInput;
  companyBrain?: CompanyBrainLite | null;
  sourceType?: string | null;
  enrichment?: Enrichment | null;
  userRequest?: UserRequest | null;
  strictness?: "strict" | "flexible";
}

// Hosts that are NOT a company's own website (directories, job boards, social).
const NON_COMPANY_HOSTS =
  /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|lever\.co|greenhouse\.io|workable\.com|wellfound\.com|angel\.co|crunchbase\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|medium\.com|github\.com|google\.com|bing\.com)$/i;

const STAGE_LARGE = /\b(public|ipo|enterprise|fortune|10000\+|5001-10000|1001-5000|501-1000)\b/i;
const EARLY_STAGE_REQ = /\b(early|seed|pre-seed|startup|early-stage|small)\b/i;
// GTM / revenue-team roles whose active hiring is a strong buying signal.
const GTM_ROLE = /\b(gtm|go-?to-?market|sales|growth|account executive|\bae\b|sdr|bdr|revenue|revops|business development|demand gen|head of growth|vp sales|chief revenue)\b/i;
// Seniority/founding markers that strengthen a hiring signal (first GTM hire, etc.).
const SENIOR_OR_FOUNDING = /\b(founding|first|head of|vp|director|lead|chief|principal)\b/i;

// US location recognition — a lead in "San Francisco, CA" or "Austin, Texas"
// matches a "USA" target. Full state names + 2-letter abbreviations + nation.
const US_NAMES = /\b(united states|u\.?s\.?a?\.?|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const US_STATE_ABBR = /,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
function looksUS(loc: string): boolean { return US_NAMES.test(loc) || US_STATE_ABBR.test(loc); }

function lc(s: unknown): string { return String(s ?? "").toLowerCase().trim(); }
function arr(v: unknown): string[] { return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []; }

function hostOf(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return ""; }
}

/** A real company website = a URL whose host is not a known directory/job-board/social host. */
export function isRealCompanyWebsite(url: string | null | undefined): boolean {
  const u = String(url ?? "").trim();
  if (!u) return false;
  const host = hostOf(u);
  if (!host || !host.includes(".")) return false;
  return !NON_COMPANY_HOSTS.test(host);
}

/** True when the only "website" we have is a job board / directory / social link. */
export function isJobBoardOrDirectory(url: string | null | undefined): boolean {
  const host = hostOf(String(url ?? "").trim());
  return !!host && NON_COMPANY_HOSTS.test(host);
}

function containsAny(haystack: string, needles: string[]): string | null {
  const h = lc(haystack);
  for (const n of needles) {
    const t = lc(n);
    if (t && h.includes(t)) return n;
  }
  return null;
}

/**
 * Score and classify a single lead. Pure — same inputs always yield the same result.
 */
export function evaluateLeadQuality(args: EvaluateLeadQualityArgs): LeadQualityResult {
  const lead = args.lead ?? {};
  const brain = args.companyBrain ?? {};
  const icp = brain.icp ?? {};
  const req = args.userRequest ?? {};
  const enr = args.enrichment ?? {};
  const strict = (args.strictness ?? "flexible") === "strict";
  const sourceType = lc(args.sourceType ?? req.category ?? "");
  const isPeople = sourceType.includes("people") || sourceType.includes("profile");
  const isHiring = sourceType.includes("hiring") || sourceType.includes("job");

  const reasons: string[] = [];
  const reject_reasons: string[] = [];
  const matched_icp_fields: string[] = [];
  const missing_fields: string[] = [];

  const name = lc(lead.name ?? lead.company);
  const title = lc(lead.title);
  const location = lc(lead.location);
  const industry = lc(lead.industry ?? lead.category);
  const haystack = [lead.name, lead.company, lead.title, lead.industry, lead.category, lead.exact_signal, lead.signal_type]
    .map(lc).join(" ");

  // ---- field presence (for confidence + missing_fields) ----
  if (!name) missing_fields.push("name");
  if (!location) missing_fields.push("location");
  if (!industry) missing_fields.push("industry");
  if (!lead.website) missing_fields.push("website");
  if (isHiring && !lead.exact_signal && !lead.signal_type) missing_fields.push("signal");

  // ===================== HARD REJECTS =====================
  // No name/source at all.
  if (!name) reject_reasons.push("missing name/company");

  // Geography (strict): request location wins, else ICP geography.
  const geoTarget = lc(req.location || icp.geography);
  const geoStrict = strict || !!req.strict_location;
  if (geoTarget && location) {
    const targetIsUS = /\b(usa|u\.?s\.?a?\.?|united states|america)\b/.test(geoTarget);
    const geoMatch = location.includes(geoTarget) || geoTarget.includes(location) ||
      (targetIsUS && looksUS(location));
    if (geoMatch) { matched_icp_fields.push("geography"); reasons.push(`location matches ${req.location || icp.geography}`); }
    else if (geoStrict) reject_reasons.push("wrong geography (strict)");
  }

  // Industry / category mismatch.
  const industryTargets = [req.industry, req.category, ...(arr(icp.industries))].filter(Boolean) as string[];
  if (industryTargets.length) {
    const hit = containsAny(haystack, industryTargets);
    if (hit) { matched_icp_fields.push("industry"); reasons.push(`industry/category matches ${hit}`); }
    else if (strict || req.strict_industry) reject_reasons.push("wrong industry/category");
  }

  // Company Brain disqualifiers.
  const dq = arr(icp.disqualifiers);
  const dqHit = dq.length ? containsAny(haystack, dq) : null;
  if (dqHit) reject_reasons.push(`matches disqualifier: ${dqHit}`);

  // Website / source reality.
  const realSite = isRealCompanyWebsite(lead.website);
  const jobBoardSite = isJobBoardOrDirectory(lead.website);
  const hasUsableSource = realSite || !!lead.source_url || isHiring; // hiring leads come from a job post
  if (!hasUsableSource) reject_reasons.push("no clear business website/source");
  if (jobBoardSite && !isHiring) reject_reasons.push("directory/job-board URL treated as company site");

  // Size/stage: reject obviously-too-large when early-stage requested.
  const stageReq = lc(req.stage || icp.company_size);
  const wantsEarly = EARLY_STAGE_REQ.test(stageReq);
  const sizeHay = [lead.team_size, lead.stage, lead.category, lead.exact_signal].map(lc).join(" ");
  if (wantsEarly && STAGE_LARGE.test(sizeHay)) reject_reasons.push("company too large for early-stage request");

  // Signal presence (hiring/intent sources must carry a signal).
  const hasSignal = !!lead.exact_signal || !!lead.signal_type || isHiring || isPeople;
  if (!hasSignal && (isHiring || sourceType.includes("signal"))) reject_reasons.push("no relevant signal");

  // ===================== SCORING =====================
  let score = 0;

  // Signal / intent strength (30). For hiring-signal sources the company IS the
  // lead and the active role they're hiring is the buying signal — so a relevant
  // GTM/Sales hire counts heavily (a founding/first GTM hire even more), and a
  // missing company website does NOT weaken the signal.
  // Whether THIS lead's hired role is a GTM/revenue role (based on the lead's
  // own signal, not merely the request — so a non-GTM hire isn't over-credited
  // just because the user asked for GTM).
  const signalText = `${lc(lead.exact_signal)} ${lc(lead.signal_type)} ${title}`;
  const isGtmHire = GTM_ROLE.test(signalText);
  const isSeniorFounding = SENIOR_OR_FOUNDING.test(signalText);
  if (isHiring) {
    if (isGtmHire && isSeniorFounding) { score += 30; reasons.push(`strong hiring signal: ${lead.exact_signal ?? "founding/senior GTM hire"}`); }
    else if (isGtmHire) { score += 26; reasons.push(`active GTM hiring${lead.exact_signal ? `: ${lead.exact_signal}` : ""}`); }
    else if (lead.exact_signal) { score += 20; reasons.push(`hiring signal: ${lead.exact_signal}`); }
    else { score += 16; reasons.push("active hiring signal"); }
  } else if (lead.exact_signal) { score += 30; reasons.push(`signal: ${lead.exact_signal}`); }
  else if (lead.signal_type) { score += 22; reasons.push(`signal: ${lead.signal_type}`); }
  else if (isPeople) { score += 12; } // a relevant person IS a soft signal
  else { score += 4; }

  // ICP fit (25): industry + pain-point alignment
  let icpPts = 0;
  if (matched_icp_fields.includes("industry")) icpPts += 16;
  else if (isHiring && industryTargets.length && !reject_reasons.some((r) => r.includes("industry"))) {
    // Hiring search was scoped to the requested industry and nothing contradicts
    // it — credit it as consistent (not a fabricated exact match).
    icpPts += 12; matched_icp_fields.push("industry"); reasons.push(`industry consistent with scoped search (${industryTargets[0]})`);
  }
  const painHit = arr(icp.pain_points).length ? containsAny(haystack, arr(icp.pain_points)) : null;
  if (painHit) { icpPts += 9; matched_icp_fields.push("pain_point"); reasons.push(`addresses pain point: ${painHit}`); }
  if (icpPts === 0 && industryTargets.length === 0) icpPts = 8; // no ICP to match against → neutral partial
  score += Math.min(25, icpPts);

  // Buyer/persona relevance (15)
  const personaRoles = [req.role, ...arr(icp.buyer_roles)].filter(Boolean) as string[];
  if (isHiring && isGtmHire) {
    // Hiring for the targeted GTM role IS the persona-relevance signal here.
    score += 15; matched_icp_fields.push("buyer_role"); reasons.push("hiring for the targeted GTM role");
  } else if (personaRoles.length && title) {
    const roleHit = containsAny(title, personaRoles) || /\b(founder|co-?founder|ceo|cto|coo|cmo|cro|vp|head of|director|chief)\b/i.test(title) ? (containsAny(title, personaRoles) ?? "leadership") : null;
    if (roleHit) { score += 15; matched_icp_fields.push("buyer_role"); reasons.push(`persona matches ${roleHit}`); }
  } else if (!personaRoles.length) {
    score += 8; // no persona requirement → partial credit
  } else if (!title && isPeople) {
    missing_fields.push("title");
  }

  // Company size / stage (10). A founding/first GTM hire is itself an
  // early-stage signal even when team_size is unknown.
  const foundingHire = /\b(founding|first)\b/.test(signalText);
  if (foundingHire && !STAGE_LARGE.test(sizeHay)) { score += 10; matched_icp_fields.push("stage"); reasons.push("founding hire → early-stage fit"); }
  else if (stageReq && sizeHay) {
    if (wantsEarly && !STAGE_LARGE.test(sizeHay)) { score += 10; matched_icp_fields.push("stage"); reasons.push("size/stage fits early-stage"); }
    else if (!wantsEarly) { score += 6; }
  } else { score += 4; }

  // Geography (10)
  if (matched_icp_fields.includes("geography")) score += 10;
  else if (!geoTarget) score += 5; // no geo requirement
  else if (!location) { /* unknown — no credit */ }

  // Website verification (10)
  if (enr.website_verified || (enr.scraped && realSite)) { score += 10; reasons.push("website verified"); }
  else if (realSite) score += 6;
  else if (jobBoardSite) { /* no credit */ }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ===================== TIER / ACCEPTANCE =====================
  const hardRejected = reject_reasons.length > 0;
  let tier: LeadTier;
  if (hardRejected) tier = "rejected";
  else if (score >= 80) tier = "hot";
  else if (score >= 60) tier = "qualified";
  else if (score >= 35) tier = "weak";
  else tier = "rejected";

  // Accept only qualified+ AND not hard-rejected (prefer fewer strong leads).
  const accepted = !hardRejected && (tier === "hot" || tier === "qualified");

  // Confidence from data completeness + enrichment.
  const knownFields = [name, location, industry, lead.website, title].filter(Boolean).length;
  let confidence: Confidence;
  if ((enr.website_verified || realSite) && knownFields >= 4 && matched_icp_fields.length >= 2) confidence = "high";
  else if (knownFields >= 2 && (matched_icp_fields.length >= 1 || isHiring)) confidence = "medium";
  else confidence = "low";

  return {
    accepted,
    score,
    tier,
    reasons,
    reject_reasons,
    confidence,
    matched_icp_fields: Array.from(new Set(matched_icp_fields)),
    missing_fields: Array.from(new Set(missing_fields)),
  };
}

/** One-line user-facing "why this lead is qualified" from the evaluation. */
export function buildWhyThisLead(r: LeadQualityResult): string {
  if (r.reject_reasons.length) return r.reject_reasons.join("; ");
  if (!r.reasons.length) return "Matched the requested criteria.";
  return r.reasons.slice(0, 3).join(" + ") + ".";
}
