// WHAT EACH ACTOR CAN ACTUALLY PROVE — the one table support is derived from.
//
// ── WHY CAPABILITY SUPPORT MUST BE DERIVED AND NOT DECLARED ─────────────────
//
// `CAPABILITY_REGISTRY` states what a capability produces and, separately, which
// Actors it may call. Nothing checked that the second could deliver the first,
// and three entries could not:
//
//   funding_signal_discovery      claims `funding_event`, calls a YC directory
//                                 scraper whose verified schema has no funding
//                                 field at all
//   expansion_signal_discovery    claims to enumerate expanding companies, calls
//                                 a company-NAME matcher whose own card says
//                                 `not_for: ["semantic/concept search"]`
//   expansion_signal_verification claims `location_evidence` for an EXPANSION,
//                                 calls a JOB search — a role's location is not
//                                 a statement that a company entered a market
//
// Phase 1 marked those three unsupported by hand. Hand-marking does not scale
// and does not prevent the next one: the claim and the provider still live in
// different places, and the only thing joining them is someone remembering.
//
// This module is that join. It records, per EXECUTABLE Actor, which (event,
// subject) evidence it genuinely produces, whether it can DISCOVER by that
// evidence or only VERIFY it on a company already found, and which qualifiers
// it can honour. Support for a signal is then computed, never asserted.
//
// ── THE RULES THIS ENCODES ──────────────────────────────────────────────────
//
// 1. Only Actors with a repo key appear. `HIRING_ACTOR_CATALOG` is the
//    executability boundary — an Actor absent from it cannot be called — so
//    membership here is derived from it and asserted by test in both
//    directions. A "capability" naming an Actor nothing may call is not a
//    capability.
//
// 2. DISCOVERY and VERIFICATION are different powers. `apify_linkedin_job_search`
//    proves hiring inside a company set it is GIVEN and cannot find employers;
//    saying it "supports hiring" without that distinction is how a hiring-first
//    mission got planned with no way to find anyone.
//
// 3. SUBJECT SCOPE IS PART OF THE CLAIM. A company-post source can never
//    satisfy a leadership-post requirement, so evidence is recorded against
//    (event, subject) and not against the event alone.
//
// 4. NO SIGNAL → ACTOR ROUTING LIVES HERE. This says what each Actor can prove.
//    Which Actor to reach for is the planner's decision inside the capability
//    graph, exactly as before.
//
// PURE. No network, provider, model or database access.

import { HIRING_ACTOR_CATALOG } from "./hiringActorCatalog.ts";
import type {
  MissionSignalDescriptor, QualifierKey, SignalEvent, SignalSubject,
} from "./missionSignalDescriptor.ts";
import { isPersonSubject } from "./missionSignalDescriptor.ts";

export const ACTOR_EVIDENCE_VERSION = "actor-evidence-capability-v1" as const;

/** Can this Actor FIND companies by the evidence, or only prove it on known ones? */
export type EvidencePower = "discovery" | "verification";

export interface EvidenceProduction {
  event: SignalEvent;
  subject: SignalSubject;
  power: EvidencePower;
  /** Output fields that carry the proof. From the Actor's verified card. */
  evidence_fields: string[];
  /** Qualifiers this Actor can actually filter or return. */
  qualifiers: QualifierKey[];
  /** Why this claim is believed — a verified schema or an observed run. */
  basis: string;
}

export interface ActorEvidenceRecord {
  /** Repo key. MUST exist in `HIRING_ACTOR_CATALOG`. */
  actor_key: string;
  produces: EvidenceProduction[];
  /**
   * True for the person-stage Actors. These are reachable only through an
   * explicit, credit-reserved unlock and are never scheduled by a plan, so a
   * signal that needs one is `requires_unlock`, not `supported`.
   */
  unlock_gated: boolean;
  /** Non-null when the Actor can only ever return one population. */
  cohort_scope: string | null;
}

/**
 * THE TABLE.
 *
 * Every entry was read from the Actor's own card in `hiringActorCatalog` — its
 * verified input schema, its recorded output fields and its `not_for` list. No
 * claim here is aspirational: if a card says the Actor cannot do something, it
 * does not appear.
 *
 * Thirteen Actors are executable, and the table is deliberately uneven because
 * the provider landscape is: hiring has both powers, funding has only discovery,
 * technology has only verification, and the social sources split by SUBJECT
 * rather than by capability.
 *
 * Three asymmetries are load-bearing and none of them is an oversight:
 *
 *   FUNDING has no `verification`. The source finds companies BY a round and
 *   takes no company input, so "did this company raise?" is unanswerable and
 *   the absence of a row proves nothing.
 *
 *   TECHNOLOGY has no `discovery`. BuiltWith's entire input is a domain list,
 *   so "who uses Shopify" has no route and a technology mission cannot plan
 *   discovery through it.
 *
 *   EVERY PERSON-AUTHORED SOCIAL SOURCE is `unlock_gated`, including the topic
 *   search — because a topic search returns identified people, and acquiring
 *   person identity without an accepted unlock is the auto-spend the people
 *   boundary exists to prevent.
 *
 * `headcount_change` appears NOWHERE, and that is the honest entry: growth is a
 * delta over stored readings, no provider returns it, and `headcountGrowth.ts`
 * reports `insufficient_evidence` until snapshots exist.
 */
export const ACTOR_EVIDENCE: readonly ActorEvidenceRecord[] = Object.freeze([
  {
    actor_key: "apify_yc_companies_memo23",
    unlock_gated: false,
    cohort_scope: "y_combinator",
    produces: [
      {
        event: "hiring", subject: "company", power: "discovery",
        // The FREE branch: hiring state and open roles arrive with the company,
        // which is why `embedded_hiring_evidence` costs nothing.
        evidence_fields: ["isHiring", "openJobs[]"],
        qualifiers: ["role_terms"],
        basis: "verified schema: isHiring filter; output carries openJobs[] with YC's own role taxonomy",
      },
    ],
  },
  {
    actor_key: "apify_yc_companies_solidcode",
    unlock_gated: false,
    cohort_scope: "y_combinator",
    // Discovery only. Its card records no hiring field, so it proves no signal.
    produces: [],
  },
  {
    actor_key: "apify_linkedin_company_search",
    unlock_gated: false,
    cohort_scope: null,
    // A company NAME index. Its card declares `not_for: ["semantic/concept
    // search", "proving industry", "proving employee size"]`, so it proves no
    // signal whatsoever — it introduces candidates and nothing more.
    produces: [],
  },
  {
    actor_key: "apify_linkedin_company_details",
    unlock_gated: false,
    cohort_scope: null,
    // Firmographic enrichment. Authoritative employeeCount and industry, but a
    // single reading — and a headcount CHANGE needs two, at different times.
    produces: [],
  },
  {
    actor_key: "apify_linkedin_job_search",
    unlock_gated: false,
    cohort_scope: null,
    produces: [
      {
        event: "hiring", subject: "company", power: "verification",
        evidence_fields: ["title", "postedDate", "company{name,linkedinUrl}", "location"],
        // `jobTitles` is a fuzzy search — the card records "Sales Operations
        // Manager" returning "Operation Manager Trainee" — so the role
        // qualifier is honoured only WITH the mandatory deterministic
        // post-filter. Listed because the capability includes that filter.
        qualifiers: ["role_families", "role_terms"],
        basis: "verified schema: company[<=10], jobTitles, postedLimit; observed zero cross-company leakage",
      },
    ],
  },
  {
    actor_key: "apify_funding_rounds_datahyena",
    unlock_gated: false,
    cohort_scope: null,
    produces: [
      {
        // DISCOVERY ONLY, and the distinction is the whole point.
        //
        // This Actor finds companies BY a funding round. It has no company,
        // domain or URL input, so it cannot be asked "did THIS company raise?"
        // — and the absence of a row for a company therefore proves nothing.
        // Declaring it `verification` would let a missing row read as "no
        // funding", which is exactly the fabricated negative the evidence
        // discipline exists to prevent.
        event: "funding", subject: "company", power: "discovery",
        evidence_fields: [
          "company_name", "round_stage", "amount_usd", "announced_date",
          "investors[]", "source_articles[]",
        ],
        // Every qualifier the live schema can genuinely filter on. `round_type`
        // maps to its 24-value stage enum; `region` to 59 ISO country codes.
        qualifiers: ["round_type", "region"],
        basis:
          "live Store schema read 2026-08-22: since/round[]/countries[]/verticals[]/" +
          "minAmountUsd filters, one row per funding event with amount ungated " +
          "(no session cookie). OUTPUT NOT YET OBSERVED — card confidence is low.",
      },
    ],
  },
  {
    actor_key: "apify_linkedin_company_posts",
    unlock_gated: false,
    cohort_scope: null,
    produces: [
      {
        // VERIFICATION, not discovery: it consumes a company LinkedIn URL and
        // cannot find one. Identity must be resolved first.
        event: "post", subject: "company", power: "verification",
        evidence_fields: ["post_url", "posted_at", "text", "author_url"],
        // A topic is checked against the post's own text after the fact; this
        // Actor has no topic filter at all, only a date bound.
        qualifiers: ["topic"],
        basis:
          "live Store schema 2026-08-22: targetUrls + postedLimit/postedLimitDate. " +
          "Scope is enforced by compileCompanyPostsInput, which refuses /in/ URLs — " +
          "the schema itself accepts both shapes. OUTPUT NOT OBSERVED.",
      },
    ],
  },
  {
    actor_key: "apify_linkedin_profile_posts",
    // ── THE PEOPLE BOUNDARY, UNCHANGED ────────────────────────────────────
    //
    // This Actor cannot find a person; it reads a profile URL that must already
    // exist. Producing that URL is `founder_discovery`, which is unlock-gated,
    // so every signal that depends on this one is `requires_unlock` — an offer
    // the user may accept, never work a plan schedules.
    unlock_gated: true,
    cohort_scope: null,
    produces: [
      {
        event: "post", subject: "leadership", power: "verification",
        evidence_fields: ["post_url", "posted_at", "text", "author_url", "author_name"],
        qualifiers: ["topic"],
        basis:
          "live Store schema 2026-08-22: identical to the company posts Actor. " +
          "compileProfilePostsInput refuses /company/ URLs. OUTPUT NOT OBSERVED.",
      },
    ],
  },
  {
    actor_key: "apify_linkedin_post_search",
    // ── WHY A TOPIC SEARCH IS UNLOCK-GATED ────────────────────────────────
    //
    // It can find posts by topic without any prior identity, which is genuinely
    // discovery. But every person-authored result arrives WITH that person's
    // profile — name, URL, headline — and comment scraping returns commenter
    // identities too. That is person data acquired without an unlock.
    //
    // The instruction is "never auto-spend to identify the person", and a topic
    // search that returns fifty identified people is exactly that spend wearing
    // a different name. So the whole Actor is gated, and the company-authored
    // half is reachable through the ungated company-posts Actor instead.
    unlock_gated: true,
    cohort_scope: null,
    produces: [
      {
        event: "post", subject: "leadership", power: "discovery",
        evidence_fields: [
          "post_url", "posted_at", "text", "author_url", "author_name",
          "author_headline",
        ],
        qualifiers: ["topic", "region"],
        basis:
          "live Store schema 2026-08-22: searchQueries (Boolean full-text), " +
          "authorKeywords on headline, authorsCompanies, postedLimit, sortBy. " +
          "OUTPUT NOT OBSERVED.",
      },
      {
        // COMMENTS ARE REAL HERE, and this is the only place they are.
        //
        // `scrapeComments` + `commentsProfileScraperMode` return each comment
        // WITH its author's profile, so "an identified person commented on a
        // post about X" is answerable. The URL-fed Actors also expose comments,
        // but those are engagement RECEIVED on the target's own posts — a
        // different claim, and deliberately not declared as this evidence.
        event: "comment", subject: "leadership", power: "discovery",
        evidence_fields: [
          "commenter_url", "commenter_name", "commenter_headline",
          "posted_at", "text", "parent_post_url",
        ],
        qualifiers: ["topic"],
        basis:
          "live Store schema 2026-08-22: scrapeComments, maxComments, " +
          "commentsPostedLimit, commentsProfileScraperMode. Comments are billed " +
          "per item at the price of a post. OUTPUT NOT OBSERVED.",
      },
    ],
  },
  {
    actor_key: "apify_google_news",
    unlock_gated: false,
    cohort_scope: null,
    produces: [
      {
        // BOTH POWERS, genuinely. A keyword search on a topic finds companies
        // it names; a keyword search on a company NAME plus a topic term checks
        // one already held. The same call shape serves both.
        event: "expansion", subject: "company", power: "discovery",
        evidence_fields: ["title", "url", "source", "published_at", "description"],
        qualifiers: ["topic", "region"],
        basis:
          "live Store schema 2026-08-22: keywords[] with Google News operators, " +
          "timeframe, region_language. decodeUrls forced on so the citation is " +
          "followable. OUTPUT NOT OBSERVED.",
      },
      {
        event: "expansion", subject: "company", power: "verification",
        evidence_fields: ["title", "url", "source", "published_at", "description"],
        qualifiers: ["topic", "region"],
        basis: "same call shape, scoped to a known company name plus a topic term.",
      },
      {
        event: "product_launch", subject: "company", power: "discovery",
        evidence_fields: ["title", "url", "source", "published_at", "description"],
        qualifiers: ["topic"],
        basis: "live Store schema 2026-08-22: keyword search over dated articles.",
      },
      {
        event: "product_launch", subject: "company", power: "verification",
        evidence_fields: ["title", "url", "source", "published_at", "description"],
        qualifiers: ["topic"],
        basis: "same call shape, scoped to a known company name plus a launch term.",
      },
    ],
  },
  {
    actor_key: "apify_builtwith_technology",
    unlock_gated: false,
    cohort_scope: null,
    produces: [
      {
        // VERIFICATION ONLY, and this is the finding that has survived every
        // audit pass unchanged: the entire input is `startDomains` and
        // `maxRequestsPerCrawl`. There is no query field, so "who uses X" has
        // no route through this Actor and a technology mission cannot plan
        // discovery here.
        event: "technology", subject: "company", power: "verification",
        evidence_fields: ["domain", "technologies", "categories"],
        // NO RECENCY. A detection is present-tense and carries no adoption date,
        // so a recency qualifier on a technology signal is reported unhonoured.
        qualifiers: [],
        basis:
          "live Store schema 2026-08-22: exactly two input fields, domain in and " +
          "technologies out. OUTPUT NOT OBSERVED.",
      },
    ],
  },
  {
    actor_key: "apify_linkedin_company_employees",
    unlock_gated: true,
    cohort_scope: null,
    produces: [
      {
        // IDENTITY, NOT ACTIVITY. This finds who the leaders are. It does not
        // return what they posted, so it can never satisfy a `post` or
        // `comment` requirement — only unblock one.
        event: "leadership_change", subject: "leadership", power: "discovery",
        evidence_fields: ["person_name", "person_title", "current_employer"],
        qualifiers: [],
        basis: "verified schema: per-company cap; observed current-employer evidence",
      },
    ],
  },
  {
    // ── CONTACT ENRICHMENT ────────────────────────────────────────────────
    //
    // It DISCOVERS NOTHING. Both siblings above are `power: "discovery"` —
    // they answer "who is the buyer here?" from a company. This one takes a
    // person who is already known and returns more about them, so its only
    // honest power is verification of an identity somebody else established.
    //
    // Listing it as discovery would let a mission requiring a leadership
    // signal be planned around an Actor that cannot find anybody.
    actor_key: "apify_linkedin_profile_enrichment",
    unlock_gated: true,
    cohort_scope: null,
    produces: [
      {
        event: "leadership_change", subject: "leadership", power: "verification",
        evidence_fields: ["person_name", "person_title", "profile_url",
          "current_employer", "business_email"],
        qualifiers: [],
        basis: "live store schema 2026-08-23: takes urls/publicIdentifiers/" +
          "profileIds and returns profile detail; the email event is a " +
          "best-effort lookup, never a guarantee, and no phone is returned",
      },
    ],
  },
  {
    actor_key: "apify_people_search",
    unlock_gated: true,
    cohort_scope: null,
    produces: [
      {
        event: "leadership_change", subject: "leadership", power: "discovery",
        evidence_fields: ["person_name", "person_title", "profile_url"],
        qualifiers: [],
        basis: "verified schema: people search not scoped to a company list",
      },
    ],
  },
]);

/**
 * Is this Actor reachable only through an accepted unlock?
 *
 * Read by coverage so an unlock-gated Actor is never reported as runnable work.
 * An Actor absent from the table is not gated — it is unknown, and callers must
 * already have refused it for that reason.
 */
export function isUnlockGatedActor(actorKey: string): boolean {
  return ACTOR_EVIDENCE.find((a) => a.actor_key === actorKey)?.unlock_gated === true;
}

/** Actor keys this table describes. */
export function evidenceActorKeys(): string[] {
  return ACTOR_EVIDENCE.map((a) => a.actor_key);
}

/** Actor keys the catalog says are executable. The table must match this set. */
export function executableActorKeys(): string[] {
  return Object.values(HIRING_ACTOR_CATALOG).map((c) => c.actor_key);
}

/**
 * Keys named here that the catalog cannot execute, and vice versa.
 *
 * Both directions matter. A key here that the catalog lacks would claim an
 * Actor nothing may call; a catalog key missing here would be an executable
 * Actor whose powers nobody stated, and a signal it could serve would be
 * reported as a gap. Asserted by test.
 */
export function actorTableDrift(): { unknown_here: string[]; missing_here: string[] } {
  const exec = new Set(executableActorKeys());
  const here = new Set(evidenceActorKeys());
  return {
    unknown_here: [...here].filter((k) => !exec.has(k)),
    missing_here: [...exec].filter((k) => !here.has(k)),
  };
}

// ─────────────────────────────────────────────────────── resolving support ──

export type SignalSupportStatus =
  /** An executable, non-unlock Actor can produce this evidence. */
  | "supported"
  /**
   * The evidence needs a person identified first, and person discovery is
   * unlock-gated. NOT a gap — the work exists and is deliberately not automatic.
   */
  | "requires_unlock"
  /** No executable Actor produces this evidence at this subject scope. */
  | "capability_gap";

export interface SignalDependency {
  kind: "unlock";
  /** The public capability that must be offered and accepted. */
  capability: string;
  reason: string;
}

export interface SignalSupport {
  signal: MissionSignalDescriptor;
  status: SignalSupportStatus;
  /** Actors that can FIND companies by this evidence. */
  discovery_actors: string[];
  /** Actors that can PROVE it on a company already found. */
  verification_actors: string[];
  /** Work that must be authorised before this signal could be pursued at all. */
  dependencies: SignalDependency[];
  /** Qualifiers the request stated that no available Actor can honour. */
  unhonoured_qualifiers: QualifierKey[];
  /** Why, in a sentence a user can act on. Empty when fully supported. */
  reason: string;
}

/**
 * Events no provider can return, because they are DERIVED from stored history.
 *
 * The distinction matters to a user. "No source exists" invites them to go
 * looking for one; "this needs a second reading of a company we have already
 * measured once" tells them the capability arrives on its own, from work the
 * system is already doing.
 *
 * `headcount_change` is the only member and is likely to stay so: it is the
 * one requirement in the vocabulary that is a comparison rather than an
 * observation.
 */
const DERIVED_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  headcount_change:
    "headcount growth is COMPUTED, not retrieved — no provider returns 'this " +
    "company grew', and none can. It is a delta between two dated employee " +
    "counts, which company enrichment already produces and now stores in " +
    "company_headcount_snapshots. A company measured once has a size; growth " +
    "becomes answerable the next time that company is enriched, at least 30 " +
    "days later. Nothing needs to be bought for it.",
});

/** Producers of a given (event, subject), split by power and unlock gating. */
function producersFor(event: SignalEvent, subject: SignalSubject) {
  const discovery: ActorEvidenceRecord[] = [];
  const verification: ActorEvidenceRecord[] = [];
  for (const a of ACTOR_EVIDENCE) {
    for (const p of a.produces) {
      if (p.event !== event || p.subject !== subject) continue;
      (p.power === "discovery" ? discovery : verification).push(a);
    }
  }
  return { discovery, verification };
}

/** Qualifiers any available producer can honour for this (event, subject). */
function honouredQualifiers(
  event: SignalEvent, subject: SignalSubject,
): Set<QualifierKey> {
  const out = new Set<QualifierKey>();
  for (const a of ACTOR_EVIDENCE) {
    for (const p of a.produces) {
      if (p.event === event && p.subject === subject) {
        for (const q of p.qualifiers) out.add(q);
      }
    }
  }
  return out;
}

/**
 * Can this requirement be served, and if not, why not?
 *
 * ── WHY A PERSON SIGNAL IS TWO SEPARATE QUESTIONS ───────────────────────────
 *
 * "Whose leadership has recently posted about US expansion" needs two things:
 * the leader must be IDENTIFIED, and their post must be FOUND. The first is
 * possible and unlock-gated; the second has no registered source at all.
 *
 * Reporting one verdict would misstate the position either way. Called a gap,
 * it hides that half the chain exists; called unlock-required, it promises that
 * paying would answer the question — and it would not. So the dependency is
 * recorded ALONGSIDE the status, and the status describes the evidence itself.
 */
export function resolveSignalSupport(sig: MissionSignalDescriptor): SignalSupport {
  const { event, subject } = sig;
  const { discovery, verification } = producersFor(event, subject);

  const openDiscovery = discovery.filter((a) => !a.unlock_gated);
  const openVerification = verification.filter((a) => !a.unlock_gated);
  const gatedAll = [...discovery, ...verification].filter((a) => a.unlock_gated);

  // A person-level requirement always depends on identity first, whether or not
  // anything can then prove the event.
  const dependencies: SignalDependency[] = [];
  if (isPersonSubject(subject)) {
    dependencies.push({
      kind: "unlock",
      capability: "offer_founder_unlock",
      reason:
        `this signal is about a person at the company, so that person must be ` +
        `identified before anything can be proven about them. Person discovery ` +
        `is offered as an explicit unlock and is never run automatically.`,
    });
  }

  const stated = Object.keys(sig.qualifier ?? {}) as QualifierKey[];
  const honoured = honouredQualifiers(event, subject);
  const unhonoured = stated.filter((q) => !honoured.has(q));

  if (openDiscovery.length > 0 || openVerification.length > 0) {
    return {
      signal: sig, status: "supported",
      discovery_actors: openDiscovery.map((a) => a.actor_key),
      verification_actors: openVerification.map((a) => a.actor_key),
      dependencies,
      unhonoured_qualifiers: unhonoured,
      reason: unhonoured.length === 0 ? "" :
        `served, but no available source can filter on ${unhonoured.join(", ")} — ` +
        `that part is checked after the fact rather than requested.`,
    };
  }

  if (gatedAll.length > 0) {
    return {
      signal: sig, status: "requires_unlock",
      discovery_actors: [], verification_actors: [],
      dependencies,
      unhonoured_qualifiers: unhonoured,
      reason:
        `this evidence is produced only by an unlock-gated source ` +
        `(${gatedAll.map((a) => a.actor_key).join(", ")}), so it cannot be ` +
        `collected until the unlock is accepted.`,
    };
  }

  // ── AN EVENT THAT IS COMPUTED, NOT RETRIEVED ──────────────────────────────
  //
  // "No Actor produces this" is true of headcount growth and deeply misleading
  // about it. No provider returns "this company grew" and none ever will —
  // growth is a DELTA over readings this system already takes and now stores.
  // Reporting it with the same sentence as a genuinely absent capability would
  // send a user looking for a source that cannot exist.
  const derived = DERIVED_EVENTS[event];
  if (derived) {
    return {
      signal: sig, status: "capability_gap",
      discovery_actors: [], verification_actors: [],
      dependencies, unhonoured_qualifiers: unhonoured,
      reason: derived,
    };
  }

  return {
    signal: sig, status: "capability_gap",
    discovery_actors: [], verification_actors: [],
    dependencies,
    unhonoured_qualifiers: unhonoured,
    reason:
      `no registered Actor produces "${event}" evidence about ` +
      `${subject === "company" ? "a company" : "a person"}. ` +
      (isPersonSubject(subject)
        ? `Identifying the person is possible behind an unlock, but nothing can ` +
          `then retrieve what they published.`
        : `Nothing was planned or collected for it.`),
  };
}

/** Resolve a whole mission's requirements. */
export function resolveAllSignalSupport(
  signals: readonly MissionSignalDescriptor[],
): SignalSupport[] {
  return signals.map(resolveSignalSupport);
}

/**
 * Evidence a capability's declared providers can genuinely produce.
 *
 * This is what turns Phase 1's hand-set `supported: false` into a derived fact:
 * a capability claiming evidence none of its providers produces is a claim the
 * table can refute. `capabilityEvidenceDrift` in the graph test reads this.
 */
export function evidenceProducedBy(actorKeys: readonly string[]): EvidenceProduction[] {
  const out: EvidenceProduction[] = [];
  for (const key of actorKeys) {
    const rec = ACTOR_EVIDENCE.find((a) => a.actor_key === key);
    if (!rec) continue;
    out.push(...rec.produces);
  }
  return out;
}

/** Every (event, subject) pair any executable, non-gated Actor can serve. */
export function supportedEvidencePairs(): Array<{ event: SignalEvent; subject: SignalSubject }> {
  const seen = new Set<string>();
  const out: Array<{ event: SignalEvent; subject: SignalSubject }> = [];
  for (const a of ACTOR_EVIDENCE) {
    if (a.unlock_gated) continue;
    for (const p of a.produces) {
      const k = `${p.event}/${p.subject}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ event: p.event, subject: p.subject });
    }
  }
  return out;
}
