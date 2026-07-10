// Founder LinkedIn enrichment (Onboarding v3, Step 1).
//
// Runs ONLY on an explicit user click, ONLY on a user-supplied profile URL, and
// ONLY with recorded consent. Never scrapes contacts or email addresses, never
// searches for people. The Apify actor id is configurable via
// APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER (actors change; never hardcode forever).
//
// `normalizeFounderProfile` is pure → fixture-tested, no provider in tests.

import {
  type FounderResearch, type FounderExperience, type FounderEducation,
  type ResearchDeps, asString, asStringArray, uniq, confidenceFrom, isHttpUrl,
} from "./types.ts";

export const FOUNDER_ACTOR_ENV = "APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER";
export const FOUNDER_ACTOR_FALLBACK = "atomus/linkedin-profile-scraper";

/** Only linkedin.com/in/<slug> profile URLs are accepted. */
export function isLinkedInProfileUrl(url: unknown): boolean {
  const s = asString(url);
  if (!isHttpUrl(s)) return false;
  try {
    const u = new URL(s);
    return /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/in\/[^/]+/i.test(u.pathname);
  } catch { return false; }
}

// Contact-shaped keys we refuse to carry out of the provider payload.
const CONTACT_KEY_RE = /email|phone|mobile|contact_info|address/i;

/** Strip any contact-shaped fields; onboarding never does contact enrichment. */
export function stripContactFields<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!CONTACT_KEY_RE.test(k)) out[k] = v;
  return out as T;
}

function experiences(v: unknown): FounderExperience[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const title = asString(e.title ?? e.position ?? e.role);
    const company = asString(e.company ?? e.companyName ?? e.organisation);
    const duration = asString(e.duration ?? e.dateRange ?? e.period);
    return title || company ? { title, company, ...(duration ? { duration } : {}) } : null;
  }).filter((x): x is FounderExperience => !!x);
}

function educations(v: unknown): FounderEducation[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    const school = asString(e.school ?? e.schoolName ?? e.title);
    const degree = asString(e.degree ?? e.degreeName ?? e.subtitle);
    return school ? { school, ...(degree ? { degree } : {}) } : null;
  }).filter((x): x is FounderEducation => !!x);
}

// Signals that make a founder credible — derived only from text we actually read.
const CREDIBILITY_RE = /\b(founder|co-?founder|ceo|cto|exited?|acquired|ipo|yc|y combinator|techstars|series [a-e]|raised)\b/i;
const GTM_RE = /\b(sales|revenue|revops|gtm|go-?to-?market|growth|outbound|marketing|bd|business development|pipeline|demand gen)\b/i;

/** Derive credibility signals from the experience/headline we actually read. */
export function deriveCredibilitySignals(r: { headline: string; summary: string; experience: FounderExperience[] }): string[] {
  const out: string[] = [];
  if (CREDIBILITY_RE.test(r.headline)) out.push(r.headline);
  if (CREDIBILITY_RE.test(r.summary)) out.push(r.summary.slice(0, 140));
  for (const e of r.experience) {
    const line = [e.title, e.company].filter(Boolean).join(" at ");
    if (CREDIBILITY_RE.test(line)) out.push(line);
  }
  return uniq(out).slice(0, 6);
}

/** What the founder's background implies for GTM — evidence-derived, not guessed. */
export function deriveGtmRelevance(r: { headline: string; summary: string; skills: string[]; experience: FounderExperience[] }): string[] {
  const out: string[] = [];
  if (GTM_RE.test(r.headline)) out.push(`Headline shows GTM background: ${r.headline}`);
  for (const e of r.experience) {
    const line = [e.title, e.company].filter(Boolean).join(" at ");
    if (GTM_RE.test(e.title)) out.push(`GTM experience: ${line}`);
  }
  const gtmSkills = r.skills.filter((s) => GTM_RE.test(s));
  if (gtmSkills.length) out.push(`GTM-relevant skills: ${gtmSkills.slice(0, 5).join(", ")}`);
  return uniq(out).slice(0, 6);
}

/** Normalize one Apify LinkedIn-profile row → FounderResearch. Pure. */
export function normalizeFounderProfile(raw: unknown, sourceUrl: string): FounderResearch {
  const row = stripContactFields((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>);

  const name = asString(row.fullName ?? row.name ?? [asString(row.firstName), asString(row.lastName)].filter(Boolean).join(" "));
  const headline = asString(row.headline ?? row.occupation);
  const location = asString(row.location ?? row.locationName ?? row.geoLocationName);
  const summary = asString(row.summary ?? row.about ?? row.bio);
  const skills = uniq(asStringArray(row.skills));
  const experience = experiences(row.experience ?? row.experiences ?? row.positions);
  const education = educations(row.education ?? row.educations ?? row.schools);

  const current = experience[0];
  const current_role = asString(row.currentRole ?? row.jobTitle) || (current?.title ?? "");
  const current_company = asString(row.currentCompany ?? row.companyName) || (current?.company ?? "");

  const missing_evidence: string[] = [];
  if (!name) missing_evidence.push("founder name");
  if (!headline && !summary) missing_evidence.push("headline / summary");
  if (!experience.length) missing_evidence.push("work experience");
  if (!current_company) missing_evidence.push("current company");

  const signals = [name, headline, summary, current_company, location].filter(Boolean).length
    + (experience.length ? 1 : 0) + (education.length ? 1 : 0) + (skills.length ? 1 : 0);

  return {
    name, headline, location, current_role, current_company,
    experience, education, skills, summary,
    credibility_signals: deriveCredibilitySignals({ headline, summary, experience }),
    gtm_relevance: deriveGtmRelevance({ headline, summary, skills, experience }),
    source_url: sourceUrl,
    confidence: confidenceFrom(signals, missing_evidence.length),
    missing_evidence,
  };
}

export interface FounderEnrichResult {
  ok: boolean;
  research: FounderResearch | null;
  error?: string;
  /** true when we deliberately did not call a provider. */
  skipped?: boolean;
  reason?: string;
}

/**
 * Enrich a founder from their LinkedIn profile URL.
 * Hard rules: consent required, valid /in/ URL required, ONE profile max,
 * contact fields stripped. No provider call happens without `deps.runApifyActor`.
 */
export async function enrichFounderFromLinkedIn(
  input: { profileUrl: string; consent: boolean },
  deps: ResearchDeps,
): Promise<FounderEnrichResult> {
  if (!input.consent) {
    return { ok: false, research: null, skipped: true, reason: "consent_not_given" };
  }
  if (!isLinkedInProfileUrl(input.profileUrl)) {
    return { ok: false, research: null, skipped: true, reason: "invalid_linkedin_profile_url" };
  }
  if (!deps.runApifyActor) {
    return { ok: false, research: null, skipped: true, reason: "apify_not_configured" };
  }

  const actor = deps.actorId?.(FOUNDER_ACTOR_ENV, FOUNDER_ACTOR_FALLBACK) ?? FOUNDER_ACTOR_FALLBACK;
  try {
    // Cap: exactly one profile during onboarding. No people search, no bulk.
    const items = await deps.runApifyActor(actor, { profileUrls: [input.profileUrl], maxItems: 1 });
    const first = Array.isArray(items) ? items[0] : null;
    if (!first) return { ok: false, research: null, error: "no_profile_returned" };
    return { ok: true, research: normalizeFounderProfile(first, input.profileUrl) };
  } catch (e) {
    return { ok: false, research: null, error: e instanceof Error ? e.message : String(e) };
  }
}
