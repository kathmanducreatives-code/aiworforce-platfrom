// LEAD V2 P4 — ONE COMPANY, HOWEVER MANY ROUTES FOUND IT.
//
// The engine deduplicated on ONE exact key: `linkedin_company_url ??
// canonical_domain ?? external_source_id`. A company the job route returned
// with its LinkedIn URL and a profile route returned with only its website got
// two keys, entered the pool twice, and could be bought twice — identity,
// enrichment and hiring checks all run per company.
//
// Resolution order (strongest first), per the P4 brief and the frozen plan's
// Candidate Identity section:
//   1. external id      — the provider's own namespaced id ("li_company:123")
//   2. LinkedIn URL     — canonical /company/<slug>
//   3. verified domain  — the company's own domain, never a shared host
//   4. website host     — the website a row carried, same shared-host rule
//   5. guarded fuzzy    — normalized name + same country, only when neither
//                         side has a strong identifier that disagrees
// A strong identifier that DISAGREES blocks the merge (two different LinkedIn
// URLs on one domain are two companies, or one of the rows is wrong) and is
// recorded as a conflict, never resolved by guessing.
//
// The canonical key is the FIRST key the company was given. The engine keys
// ledgers, completed operations and checkpoints on it, so a later, stronger
// identifier is added as an alias and never renames the company.
//
// Pure.

import type { CandidateObservation, EntityHint } from "./candidateObservation.ts";

export const ENTITY_RESOLUTION_VERSION = "entity-resolution-v1" as const;

export type MatchMethod = "external_id" | "linkedin_url" | "verified_domain" | "website" | "fuzzy_name";

/**
 * Hosts many unrelated companies share. A website on one of these says nothing
 * about which company it is.
 */
export const SHARED_HOSTS: ReadonlySet<string> = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "github.com",
  "medium.com", "substack.com", "notion.site", "notion.so", "wixsite.com", "webflow.io", "carrd.co",
  "linktr.ee", "google.com", "sites.google.com", "angel.co", "wellfound.com", "ycombinator.com",
  "crunchbase.com", "apple.com", "apps.apple.com", "play.google.com", "bit.ly", "lnkd.in",
  "producthunt.com", "vercel.app", "netlify.app", "herokuapp.com", "framer.website", "squarespace.com",
  "myshopify.com", "wordpress.com", "blogspot.com",
]);

export function isSharedHost(domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  for (const h of SHARED_HOSTS) if (d === h || d.endsWith(`.${h}`)) return true;
  return false;
}

const LEGAL = /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|bv|plc|pbc|technologies|technology|labs|hq|ai|io)\b\.?/g;
/** Names too generic to match on alone, even with a country. */
const GENERIC_NAMES = new Set(["stealth", "stealthstartup", "confidential", "startup", "company", "unknown", "acme"]);

export function normalizeEntityName(v: string | null): string | null {
  if (!v) return null;
  const n = v.toLowerCase().replace(LEGAL, " ").replace(/[^a-z0-9]+/g, "");
  return n.length >= 4 && !GENERIC_NAMES.has(n) ? n : null;
}

export interface IdentityConflict {
  kind: "linkedin_url_mismatch";
  existing: string;
  incoming: string;
  /** Which identifier matched and was refused because of the disagreement. */
  matched_by: MatchMethod;
}

/** A company the union knows: every identifier any source gave it. */
export interface EntityIdentifiers {
  entity_key: string;
  external_ids: string[];
  linkedin_company_url: string | null;
  domains: string[];
  name: string | null;
  country: string | null;
}

export function identifiersFromHint(entity_key: string, h: EntityHint): EntityIdentifiers {
  const domains = [h.domain, h.website ? hostOf(h.website) : null]
    .filter((d): d is string => !!d && !isSharedHost(d));
  return {
    entity_key, external_ids: [...h.external_ids], linkedin_company_url: h.linkedin_company_url,
    domains: [...new Set(domains)], name: h.name, country: h.country,
  };
}

function hostOf(url: string): string | null {
  const h = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  return h || null;
}

export type Resolution =
  | { kind: "match"; entity_key: string; method: MatchMethod; conflicts: IdentityConflict[] }
  | { kind: "new"; conflicts: IdentityConflict[] };

/**
 * Which known company, if any, this hint is. First strong match wins; a match
 * whose other strong identifier disagrees is refused and reported.
 */
export function resolveEntity(known: readonly EntityIdentifiers[], hint: EntityHint): Resolution {
  const inc = identifiersFromHint("", hint);
  const conflicts: IdentityConflict[] = [];

  // A domain or name match whose LinkedIn URLs disagree is two companies (or a
  // wrong row). An id or URL match whose domains disagree is still one company:
  // a LinkedIn page can list a new or parent domain.
  const disagreement = (k: EntityIdentifiers, by: MatchMethod): IdentityConflict | null =>
    by !== "linkedin_url" && by !== "external_id" && k.linkedin_company_url && inc.linkedin_company_url &&
      k.linkedin_company_url !== inc.linkedin_company_url
      ? { kind: "linkedin_url_mismatch", existing: k.linkedin_company_url, incoming: inc.linkedin_company_url, matched_by: by }
      : null;

  const tryMatch = (by: MatchMethod, pred: (k: EntityIdentifiers) => boolean): Resolution | null => {
    for (const k of known) {
      if (!pred(k)) continue;
      const c = disagreement(k, by);
      if (c) { conflicts.push(c); continue; }
      return { kind: "match", entity_key: k.entity_key, method: by, conflicts };
    }
    return null;
  };

  if (inc.external_ids.length) {
    const r = tryMatch("external_id", (k) => k.external_ids.some((x) => inc.external_ids.includes(x)));
    if (r) return r;
  }
  if (inc.linkedin_company_url) {
    const r = tryMatch("linkedin_url", (k) => k.linkedin_company_url === inc.linkedin_company_url);
    if (r) return r;
  }
  if (hint.domain && !isSharedHost(hint.domain)) {
    const d = hint.domain.toLowerCase();
    const r = tryMatch("verified_domain", (k) => k.domains.includes(d));
    if (r) return r;
  }
  const webHost = hint.website ? hostOf(hint.website) : null;
  if (webHost && !isSharedHost(webHost) && webHost !== hint.domain?.toLowerCase()) {
    const r = tryMatch("website", (k) => k.domains.includes(webHost));
    if (r) return r;
  }
  // GUARDED FUZZY: same normalized name, same known country, and no strong
  // identifier on either side that could say otherwise.
  const nm = normalizeEntityName(inc.name);
  if (nm && inc.country) {
    const r = tryMatch("fuzzy_name", (k) =>
      normalizeEntityName(k.name) === nm && !!k.country && k.country.toLowerCase() === inc.country!.toLowerCase() &&
      !(k.linkedin_company_url && inc.linkedin_company_url) &&
      !(k.domains.length && inc.domains.length));
    if (r) return r;
  }
  return { kind: "new", conflicts };
}

/** Adds what an incoming hint knows that the entity did not. Never overwrites. */
export function absorbIdentifiers(k: EntityIdentifiers, hint: EntityHint): EntityIdentifiers {
  const inc = identifiersFromHint(k.entity_key, hint);
  return {
    entity_key: k.entity_key,
    external_ids: [...new Set([...k.external_ids, ...inc.external_ids])],
    linkedin_company_url: k.linkedin_company_url ?? inc.linkedin_company_url,
    domains: [...new Set([...k.domains, ...inc.domains])],
    name: k.name ?? inc.name,
    country: k.country ?? inc.country,
  };
}

/** Which route found a company, and when. One entry per route that saw it. */
export interface FoundBy {
  route_id: string | null;
  capability: string;
  actor_key: string;
  plan_version: number | null;
  provider_call_id: string | null;
  method: MatchMethod | "first_seen";
  observed_at: string;
}

export interface CanonicalCompany {
  entity_key: string;
  identifiers: EntityIdentifiers;
  found_by: FoundBy[];
  observations: CandidateObservation[];
  conflicts: IdentityConflict[];
}

export interface CandidateUnion {
  version: typeof ENTITY_RESOLUTION_VERSION;
  companies: CanonicalCompany[];
}

export function newCandidateUnion(): CandidateUnion {
  return { version: ENTITY_RESOLUTION_VERSION, companies: [] };
}

export function foundByFrom(o: CandidateObservation, method: FoundBy["method"]): FoundBy {
  return {
    route_id: o.route_id, capability: o.capability, actor_key: o.actor_key, plan_version: o.plan_version,
    provider_call_id: o.provider_call_id, method, observed_at: o.observed_at,
  };
}

/** Records a new route on a company once per route/actor; the first sighting stays first. */
export function appendFoundBy(list: FoundBy[], f: FoundBy): FoundBy[] {
  const same = list.some((x) => x.actor_key === f.actor_key && x.capability === f.capability && x.route_id === f.route_id);
  return same ? list : [...list, f];
}

/**
 * Adds one observation. Returns the canonical key and whether it merged into a
 * company the union already had. `newKey` is the key a NEW company gets (the
 * engine's own key); a merge keeps the existing key.
 */
export function unionObservation(
  u: CandidateUnion, o: CandidateObservation, newKey: string,
): { entity_key: string; merged: boolean; method: MatchMethod | null; conflicts: IdentityConflict[] } {
  const res = resolveEntity(u.companies.map((c) => c.identifiers), o.entity_hint);
  const withKey = (key: string) => ({ ...o, evidence: o.evidence.map((e) => ({ ...e, company_key: key })) });
  if (res.kind === "match") {
    const c = u.companies.find((x) => x.entity_key === res.entity_key)!;
    c.identifiers = absorbIdentifiers(c.identifiers, o.entity_hint);
    c.found_by = appendFoundBy(c.found_by, foundByFrom(o, res.method));
    if (!c.observations.some((x) => x.observation_id === o.observation_id)) c.observations.push(withKey(c.entity_key));
    c.conflicts.push(...res.conflicts);
    return { entity_key: c.entity_key, merged: true, method: res.method, conflicts: res.conflicts };
  }
  u.companies.push({
    entity_key: newKey, identifiers: identifiersFromHint(newKey, o.entity_hint),
    found_by: [foundByFrom(o, "first_seen")], observations: [withKey(newKey)], conflicts: [...res.conflicts],
  });
  return { entity_key: newKey, merged: false, method: null, conflicts: res.conflicts };
}

/** True when no paid Company Search is needed to know which company this is. */
export function identityKnown(k: Pick<EntityIdentifiers, "linkedin_company_url">): boolean {
  return !!k.linkedin_company_url;
}
