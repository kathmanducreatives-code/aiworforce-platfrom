// ONE ACTOR, ONE IDENTITY.
//
// ── THE TWO VOCABULARIES ─────────────────────────────────────────────────────
//
// This repo names Actors twice. The capability graph, the containment guards,
// the preflight and the engine speak REPO KEYS — `apify_yc_companies_memo23` —
// which exist so a planner can name a capability's provider without being able
// to name an arbitrary Actor. The intelligence registry, the scenario matrix
// and the Apify Store speak STORE IDS — `memo23/y-combinator-scraper`.
//
// Two names for one thing is a defect waiting to happen: a scenario referencing
// `harvestapi/linkedin-company-search` and a capability referencing
// `apify_linkedin_company_search` are talking about the same Actor and cannot
// be compared, so a planner can satisfy one while violating the other, and
// nothing notices.
//
// ── WHY THIS IS A RESOLVER AND NOT A RENAME ──────────────────────────────────
//
// The obvious fix is to rename every repo key to its Store id. That is the
// wrong trade. The repo key is not an accident — it is a DELIBERATE indirection
// that keeps `memo23/y-combinator-scraper` out of any field a model can write
// into, and the containment guards, the preflight's primary rule and several
// hundred test assertions all rest on it. Renaming would dissolve the
// indirection to fix a naming inconsistency, which is a poor exchange.
//
// So the STORE ID becomes the canonical identity — it is what Apify actually
// bills, what the registry is keyed by, and the only name that cannot drift —
// and the repo key stays as the execution alias. This module is the single
// place the two meet, and the mapping it uses is the one the catalog already
// carried on every entry.
//
// PURE. No network, provider, model or database access.

import { HIRING_ACTOR_CATALOG } from "./hiringActorCatalog.ts";
import { APIFY_INTELLIGENCE, actorIntelligence } from "./apifyIntelligenceRegistry.ts";

/** A Store id looks like `username/actor-name`. A repo key never contains `/`. */
export function isStoreId(name: string): boolean {
  return name.includes("/");
}

export interface ActorIdentity {
  /** CANONICAL. What Apify bills, and what the registry is keyed by. */
  store_id: string;
  /**
   * The repo-local alias, when one exists.
   *
   * Null for an Actor the intelligence registry knows about but no capability
   * declares — which is most of the registry. Knowing an Actor exists and being
   * allowed to call it are different things, and this field is where that
   * difference is visible: an Actor with no repo key is not executable, however
   * well documented it is.
   */
  repo_key: string | null;
  /** True when the intelligence registry carries a verified record. */
  has_intelligence: boolean;
  /** True when a capability could actually call it today. */
  executable: boolean;
}

/** Repo key → Store id, built once from the catalog the mapping already lived in. */
const KEY_TO_STORE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.values(HIRING_ACTOR_CATALOG).map((c) => [c.actor_key, c.actor_id]),
  ),
);

/** Store id → repo key. Built by inversion so the two can never disagree. */
const STORE_TO_KEY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(KEY_TO_STORE).map(([k, v]) => [v, k])),
);

/**
 * Resolve either vocabulary to one identity.
 *
 * Returns null only for a name neither vocabulary knows — which is exactly the
 * case that must never become a paid call.
 */
export function resolveActor(name: string): ActorIdentity | null {
  if (isStoreId(name)) {
    const repo_key = STORE_TO_KEY[name] ?? null;
    const has_intelligence = actorIntelligence(name) != null;
    // A Store id nobody has registered AND no capability declares is not an
    // Actor this system knows. Refusing here is what keeps a model-proposed id
    // from becoming a call.
    if (!has_intelligence && repo_key === null) return null;
    return { store_id: name, repo_key, has_intelligence, executable: repo_key !== null };
  }

  const store_id = KEY_TO_STORE[name];
  if (!store_id) return null;
  return {
    store_id,
    repo_key: name,
    has_intelligence: actorIntelligence(store_id) != null,
    executable: true,
  };
}

/** The canonical id for either vocabulary, or null if unknown. */
export function toStoreId(name: string): string | null {
  return resolveActor(name)?.store_id ?? null;
}

/**
 * The name the ENGINE needs to actually run this Actor, or null.
 *
 * Null means "known but not executable": the registry describes it, no
 * capability declares it, and calling it would bypass the containment guard.
 * The caller must treat that as a reason to skip, never as a reason to guess.
 */
export function toRepoKey(name: string): string | null {
  return resolveActor(name)?.repo_key ?? null;
}

/** Do two names — in either vocabulary — refer to the same Actor? */
export function sameActor(a: string, b: string): boolean {
  const x = toStoreId(a);
  const y = toStoreId(b);
  return x !== null && x === y;
}

/**
 * Every Actor the registry describes but no capability can call.
 *
 * Not a fault: the registry is knowledge, and knowing that Crunchbase exists is
 * useful before anything may call it. This exists so the gap is VISIBLE — a
 * scenario promising a funding source that no capability declares would
 * otherwise plan a step that silently never runs.
 */
export function describedButNotExecutable(): string[] {
  return registeredStoreIds().filter((id) => !STORE_TO_KEY[id]);
}

/**
 * Store ids the intelligence registry carries a record for.
 *
 * DERIVED, never listed. A hand-maintained copy of the registry's keys is a
 * second source of truth about which Actors exist, and it would drift the first
 * time someone registered an Actor without remembering to update it — which is
 * the exact class of defect this whole module exists to remove.
 */
export function registeredStoreIds(): string[] {
  return Object.keys(APIFY_INTELLIGENCE);
}

/** Every repo key the catalog defines, with its Store id. For diagnostics. */
export function identityTable(): Array<{ repo_key: string; store_id: string }> {
  return Object.entries(KEY_TO_STORE).map(([repo_key, store_id]) => ({ repo_key, store_id }));
}

/**
 * Consistency between the two sources, as a list of problems.
 *
 * Empty means the catalog and the registry agree about every Actor they both
 * describe. Anything here is a naming drift that would let a planner satisfy
 * one authority while violating the other.
 */
export function identityDrift(): string[] {
  const problems: string[] = [];

  for (const card of Object.values(HIRING_ACTOR_CATALOG)) {
    if (!isStoreId(card.actor_id)) {
      problems.push(`${card.actor_key}: actor_id "${card.actor_id}" is not a username/name Store id`);
    }
    if (isStoreId(card.actor_key)) {
      problems.push(`${card.actor_key}: a repo key must not look like a Store id`);
    }
  }

  // Two repo keys pointing at one Store id would make `toRepoKey` lossy and the
  // containment guard ambiguous.
  const seen = new Map<string, string>();
  for (const [key, id] of Object.entries(KEY_TO_STORE)) {
    const prior = seen.get(id);
    if (prior) problems.push(`${id} is claimed by both ${prior} and ${key}`);
    else seen.set(id, key);
  }

  return problems;
}

/**
 * Executable Actors the registry has never described.
 *
 * NOT drift — the names agree, and the engine has always called these. It is a
 * KNOWLEDGE gap: the pipeline spends on them with no verified adoption, price
 * or defect record behind the decision. Kept separate from `identityDrift`
 * because a naming inconsistency is a bug to fix now, while this is a backlog
 * of verification work, and conflating the two would make the drift check
 * permanently red and therefore ignored.
 */
export function executableWithoutIntelligence(): string[] {
  return Object.entries(KEY_TO_STORE)
    .filter(([, id]) => !actorIntelligence(id))
    .map(([key, id]) => `${key} (${id})`);
}

/** Resolve a mixed-vocabulary list to executable repo keys, dropping what cannot run. */
export function executableRepoKeys(
  names: readonly string[],
): { keys: string[]; skipped: Array<{ name: string; reason: string }> } {
  const keys: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const n of names) {
    const id = resolveActor(n);
    if (!id) {
      skipped.push({ name: n, reason: "neither vocabulary knows this Actor" });
      continue;
    }
    if (!id.repo_key) {
      skipped.push({
        name: n,
        reason: `${id.store_id} is described but no capability declares it, so calling it ` +
          `would bypass the containment guard`,
      });
      continue;
    }
    if (!keys.includes(id.repo_key)) keys.push(id.repo_key);
  }
  return { keys, skipped };
}
