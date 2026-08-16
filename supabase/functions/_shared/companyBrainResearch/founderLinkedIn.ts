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
// Default points at a profile-detail actor that exists in the current Apify
// store and takes a profile URL/username (verified 2026-07). ALWAYS override via
// env with the actor your Apify account can actually run — a non-existent actor
// id makes every run 404, which reads as "enrichment not working".
export const FOUNDER_ACTOR_FALLBACK = "apimaestro/linkedin-profile-detail";
/**
 * Secondary actor tried when the primary returns nothing or sparse data.
 *
 * WAS `curious_coder/linkedin-profile-scraper`, which could never have worked.
 * Its live schema REQUIRES `cookie` and `userAgent` — a LinkedIn session
 * exported from a browser — and this workflow supplies neither, so every
 * fallback attempt failed on input validation before it scraped anything. It is
 * also rated 1.25 from 14 ratings and down to 31 monthly users from 5834
 * lifetime, which is what an abandoned actor looks like.
 *
 * `harvestapi/linkedin-profile-scraper` needs no cookies, is the
 * best-adopted LinkedIn profile actor on the Store (62332 lifetime, 10513
 * monthly, 4.54 from 80), and takes `urls` — a field `buildProfileActorInput`
 * already sends. Verified against the live Store on 2026-08-16.
 */
export const FOUNDER_ACTOR_FALLBACK_ENV = "APIFY_ACTOR_LINKEDIN_PROFILE_SCRAPER_FALLBACK";
export const FOUNDER_ACTOR_FALLBACK_DEFAULT = "harvestapi/linkedin-profile-scraper";

/** The `/in/<username>` handle from a profile URL (some actors key on it). */
export function profileUsername(profileUrl: string): string {
  const m = asString(profileUrl).match(/\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : "";
}

/**
 * Actor input that the common profile scrapers all understand: each reads its
 * own key and ignores the rest. Always URL/username-driven — NEVER a people
 * search. Sends both URL variants AND the bare username so URL-keyed actors
 * (parseforge-style) and username-keyed actors (apimaestro-style) both work.
 */
export function buildProfileActorInput(profileUrl: string): Record<string, unknown> {
  const username = profileUsername(profileUrl);
  return {
    profileUrls: [profileUrl],
    urls: [profileUrl],
    startUrls: [{ url: profileUrl }],
    profileUrl,
    url: profileUrl,
    ...(username ? { username, usernames: [username], identifier: username } : {}),
    maxItems: 1,
  };
}

/**
 * Actors disagree about nesting: some return the profile at the top level,
 * others under `profile` / `data` / `basic_info` / `element`. Unwrap once.
 */
export function unwrapActorRow(raw: unknown): Record<string, unknown> {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const key of ["profile", "data", "basic_info", "basicInfo", "element", "result"]) {
    const inner = row[key];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { ...(inner as Record<string, unknown>), ...row, [key]: undefined } as Record<string, unknown>;
    }
  }
  return row;
}

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
const CONTACT_KEY_RE = /email|phone|mobile|contact_?info|address|whatsapp|telegram|birthday|birth_?date/i;

/**
 * Strip any contact-shaped fields, RECURSIVELY — actors nest contact blocks
 * under `profile.contact_info` and similar. Onboarding never stores contacts.
 */
export function stripContactFields<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (CONTACT_KEY_RE.test(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = stripContactFields(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) => (x && typeof x === "object" && !Array.isArray(x))
        ? stripContactFields(x as Record<string, unknown>) : x);
    } else {
      out[k] = v;
    }
  }
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

/** Normalize one Apify LinkedIn-profile row → FounderResearch. Pure.
 * Handles the output shapes of the common profile actors (parseforge,
 * automation-lab, atomus, …) via alias lookup + container unwrapping. */
export function normalizeFounderProfile(raw: unknown, sourceUrl: string): FounderResearch {
  const row = stripContactFields(unwrapActorRow(raw));

  const name = asString(
    row.fullName ?? row.full_name ?? row.name
    ?? [asString(row.firstName ?? row.first_name), asString(row.lastName ?? row.last_name)].filter(Boolean).join(" "),
  );
  const headline = asString(row.headline ?? row.occupation ?? row.subTitle ?? row.sub_title ?? row.title);
  const location = asString(row.location ?? row.locationName ?? row.geoLocationName ?? row.city ?? row.geo_location);
  const summary = asString(row.summary ?? row.about ?? row.bio ?? row.description);
  const skills = uniq(asStringArray(row.skills ?? row.topSkills ?? row.skill_list));
  const experience = experiences(
    row.experience ?? row.experiences ?? row.positions ?? row.position_history ?? row.positionHistory ?? row.work_experience,
  );
  const education = educations(row.education ?? row.educations ?? row.schools ?? row.education_history);

  const current = experience[0];
  const current_role = asString(row.currentRole ?? row.current_role ?? row.jobTitle ?? row.job_title) || (current?.title ?? "");
  const current_company = asString(row.currentCompany ?? row.current_company ?? row.companyName ?? row.company) || (current?.company ?? "");

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

/**
 * A profile is sparse when it carries fewer than two of the fields a Brain can
 * actually use. Sparse output is a failure to enrich, never a "success".
 */
export function isSparseFounderResearch(r: FounderResearch): boolean {
  const core = [
    r.name,
    r.headline || r.summary,
    r.experience.length ? "x" : "",
    r.current_company || r.current_role,
  ].filter(Boolean).length;
  return core < 2;
}

export interface FounderEnrichResult {
  ok: boolean;
  research: FounderResearch | null;
  error?: string;
  /** true when we deliberately did not call a provider. */
  skipped?: boolean;
  reason?: string;
  /** Which actor produced the result (primary or fallback). */
  actor_used?: string;
}

/**
 * Enrich a founder from their LinkedIn profile URL.
 * Hard rules: consent required, valid /in/ URL required, ONE profile max,
 * contact fields stripped. No provider call happens without `deps.runApifyActor`.
 * If the primary actor returns nothing or sparse data, ONE fallback actor is
 * tried; sparse-after-fallback returns ok:false with the (low-confidence)
 * research attached so the caller can be honest about what was read.
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

  const primary = deps.actorId?.(FOUNDER_ACTOR_ENV, FOUNDER_ACTOR_FALLBACK) ?? FOUNDER_ACTOR_FALLBACK;
  const fallback = deps.actorId?.(FOUNDER_ACTOR_FALLBACK_ENV, FOUNDER_ACTOR_FALLBACK_DEFAULT) ?? FOUNDER_ACTOR_FALLBACK_DEFAULT;
  const actorInput = buildProfileActorInput(input.profileUrl);

  const runOne = async (actor: string): Promise<FounderResearch | null> => {
    // Cap: exactly one profile during onboarding. No people search, no bulk.
    const items = await deps.runApifyActor!(actor, actorInput);
    const first = Array.isArray(items) ? items[0] : null;
    return first ? normalizeFounderProfile(first, input.profileUrl) : null;
  };

  try {
    let actor_used = primary;
    let research = await runOne(primary).catch(() => null);

    // Primary empty/sparse → one shot at the fallback actor (if distinct).
    if ((!research || isSparseFounderResearch(research)) && fallback && fallback !== primary) {
      const second = await runOne(fallback).catch(() => null);
      if (second && (!research || !isSparseFounderResearch(second))) {
        research = second;
        actor_used = fallback;
      }
    }

    if (!research) return { ok: false, research: null, error: "no_profile_returned" };
    if (isSparseFounderResearch(research)) {
      return { ok: false, research, error: "sparse_profile_data", actor_used };
    }
    return { ok: true, research, actor_used };
  } catch (e) {
    return { ok: false, research: null, error: e instanceof Error ? e.message : String(e) };
  }
}
