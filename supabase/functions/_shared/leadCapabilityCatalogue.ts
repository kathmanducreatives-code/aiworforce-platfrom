// THE CAPABILITY CATALOGUE — the only vocabulary the model is given.
//
// WHY A SECOND SET OF NAMES.
//
// `leadCapabilityGraph` already names capabilities, but those names are INTERNAL
// execution stages: `known_company_resolution` and `company_identity_resolution`
// are two of them, `hiring_verification` covers both the free and the paid path,
// and `founder_discovery` is a stage that SPENDS. Handing that vocabulary to a
// model invites it to ask for the spending stage by name.
//
// This catalogue is the PUBLIC surface. It says what a mission may need in terms
// of outcomes — "external hiring verification", "founder unlock offered" — and
// deterministic code alone maps those onto internal stages and approved Actors.
// The model therefore has no field in which to name `memo23/y-combinator-scraper`
// and no name for "run the people Actor now": the closest it can express is
// `offer_founder_unlock`, which by construction runs nothing.
//
// ACTOR KEYS ARE DERIVED, NEVER RESTATED. Every `actor_keys` list below is read
// out of `CAPABILITY_REGISTRY` at module load. A second hand-written copy is how
// two registries start disagreeing about what a capability may reach.
//
// PURE. No network, provider, model or database access.

import {
  CAPABILITY_REGISTRY, type CapabilityId,
} from "./leadCapabilityGraph.ts";

export const CAPABILITY_CATALOGUE_VERSION = "lead-capability-catalogue-v1" as const;

export const PUBLIC_CAPABILITY_IDS = [
  "startup_company_discovery",
  "general_company_discovery",
  "known_company_identity_resolution",
  "company_details_enrichment",
  "embedded_hiring_evidence",
  "external_hiring_verification",
  "company_semantic_evaluation",
  "portfolio_ranking",
  "offer_founder_unlock",
  "offer_contact_unlock",
] as const;

export type PublicCapabilityId = typeof PUBLIC_CAPABILITY_IDS[number];

const PUBLIC_SET: ReadonlySet<string> = new Set(PUBLIC_CAPABILITY_IDS);

export function isPublicCapability(s: string): s is PublicCapabilityId {
  return PUBLIC_SET.has(s);
}

/**
 * What choosing this capability actually authorises.
 *
 *   `execution`     — deterministic code may run approved Actors for it.
 *   `free_evidence` — satisfied from evidence already held; never starts a run.
 *   `offer`         — surfaces a button in the Workbench. Runs NOTHING.
 */
export type PublicCapabilityKind = "execution" | "free_evidence" | "offer";

export interface PublicCapabilitySpec {
  id: PublicCapabilityId;
  kind: PublicCapabilityKind;
  /** Shown to the model. Outcome language only — no Actor, no provider, no price. */
  description: string;
  /** Internal stages this expands to. ALWAYS empty for an offer. */
  internal: CapabilityId[];
  /** Whether selecting it can cause paid provider work. */
  paid: boolean;
}

/**
 * THE MAP.
 *
 * `embedded_hiring_evidence` has no internal stage of its own on purpose: it is
 * the FREE branch inside `hiring_verification`, which reads YC `openJobs` and
 * stored evidence before it will consider a paid job search. Giving it a stage
 * would imply a run; giving it none is what makes "we already know they are
 * hiring" cost nothing.
 *
 * The two `offer_*` entries map to NOTHING. That is the entire point — see
 * {@link assertOffersRunNothing}, which turns it from a convention into a test.
 */
export const PUBLIC_CAPABILITY_CATALOGUE:
  Readonly<Record<PublicCapabilityId, PublicCapabilitySpec>> = Object.freeze({
    startup_company_discovery: {
      id: "startup_company_discovery",
      kind: "execution",
      description:
        "Discover early-stage / venture-backed startup companies from startup " +
        "cohort sources. Choose when the query names YC, startups, early-stage " +
        "or venture-backed software companies.",
      internal: ["startup_company_discovery"],
      paid: true,
    },
    general_company_discovery: {
      id: "general_company_discovery",
      kind: "execution",
      description:
        "Discover companies by profile outside startup cohorts — manufacturers, " +
        "agencies, engineering firms, integrators, security companies and other " +
        "general B2B companies.",
      internal: ["general_company_discovery"],
      paid: true,
    },
    known_company_identity_resolution: {
      id: "known_company_identity_resolution",
      kind: "execution",
      description:
        "Resolve companies the user already named to a canonical identity. " +
        "Choose when the query supplies a list of companies rather than a profile.",
      internal: ["known_company_resolution", "company_identity_resolution"],
      paid: true,
    },
    company_details_enrichment: {
      id: "company_details_enrichment",
      kind: "execution",
      description:
        "Collect factual company details — size, industry, description, " +
        "location — for companies whose identity is resolved.",
      internal: ["company_enrichment"],
      paid: true,
    },
    embedded_hiring_evidence: {
      id: "embedded_hiring_evidence",
      kind: "free_evidence",
      description:
        "Use hiring evidence already attached to the discovered companies or " +
        "already stored from earlier work. Costs nothing. Prefer this whenever " +
        "the mission needs hiring evidence at all.",
      internal: [],
      paid: false,
    },
    external_hiring_verification: {
      id: "external_hiring_verification",
      kind: "execution",
      description:
        "Verify hiring activity from an external job source. Request ONLY when " +
        "hiring is genuinely required by the query AND embedded evidence would " +
        "be missing, stale or ambiguous.",
      internal: ["hiring_verification"],
      paid: true,
    },
    company_semantic_evaluation: {
      id: "company_semantic_evaluation",
      kind: "execution",
      description:
        "Judge what each company actually is and whether it fits the mission, " +
        "from collected evidence.",
      internal: ["company_brain_qualification"],
      paid: false,
    },
    portfolio_ranking: {
      id: "portfolio_ranking",
      kind: "execution",
      description: "Rank the evaluated companies and report an honest shortfall.",
      internal: ["persistence"],
      paid: false,
    },
    offer_founder_unlock: {
      id: "offer_founder_unlock",
      kind: "offer",
      description:
        "Offer the user a button to unlock founder / decision-maker details " +
        "later. This does NOT look anyone up and does NOT spend anything. It is " +
        "the ONLY way to express interest in people.",
      internal: [],
      paid: false,
    },
    offer_contact_unlock: {
      id: "offer_contact_unlock",
      kind: "offer",
      description:
        "Offer the user a button to unlock contact details later. This does NOT " +
        "look anything up and does NOT spend anything.",
      internal: [],
      paid: false,
    },
  });

/** Internal stages an offer must never reach. Read by the guards below. */
export const PEOPLE_STAGE_CAPABILITIES: readonly CapabilityId[] = [
  "founder_discovery", "employer_verification", "contact_enrichment",
];

/** Approved Actor keys for a public capability. DERIVED — never restated. */
export function actorKeysFor(id: PublicCapabilityId): string[] {
  return [...new Set(
    PUBLIC_CAPABILITY_CATALOGUE[id].internal
      .flatMap((c) => CAPABILITY_REGISTRY[c].providers),
  )];
}

/**
 * The catalogue as the model receives it.
 *
 * Actor keys are absent BY CONSTRUCTION, not by omission — this builds a new
 * object from three fields and there is no path by which a provider name reaches
 * it. That is what makes "the model cannot name an Actor" a property of the code
 * rather than a hope about the prompt.
 */
export function catalogueForPrompt(): Array<{
  capability: PublicCapabilityId; kind: PublicCapabilityKind; description: string;
}> {
  return PUBLIC_CAPABILITY_IDS.map((id) => ({
    capability: id,
    kind: PUBLIC_CAPABILITY_CATALOGUE[id].kind,
    description: PUBLIC_CAPABILITY_CATALOGUE[id].description,
  }));
}

/** Internal stages for a set of requested public capabilities, deduped. */
export function toInternalCapabilities(
  ids: readonly PublicCapabilityId[],
): CapabilityId[] {
  const out: CapabilityId[] = [];
  for (const id of ids) {
    for (const c of PUBLIC_CAPABILITY_CATALOGUE[id].internal) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** The offers among a set of requested capabilities. */
export function offersFrom(
  ids: readonly PublicCapabilityId[],
): PublicCapabilityId[] {
  return ids.filter((id) => PUBLIC_CAPABILITY_CATALOGUE[id].kind === "offer");
}

/**
 * THE INVARIANT, callable.
 *
 * An offer that quietly acquired an internal stage would put the people Actors
 * back into the automatic graph while still being described in the UI as a
 * locked button. Returns the violations rather than throwing so a test can name
 * them.
 */
export function assertOffersRunNothing(): string[] {
  const bad: string[] = [];
  for (const id of PUBLIC_CAPABILITY_IDS) {
    const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
    if (spec.kind !== "offer") continue;
    if (spec.internal.length > 0) {
      bad.push(`${id} maps to internal stages: ${spec.internal.join(", ")}`);
    }
    if (spec.paid) bad.push(`${id} is marked paid`);
    if (actorKeysFor(id).length > 0) bad.push(`${id} reaches Actor keys`);
  }
  // And no public capability at all may reach a people stage.
  for (const id of PUBLIC_CAPABILITY_IDS) {
    const reached = PUBLIC_CAPABILITY_CATALOGUE[id].internal
      .filter((c) => PEOPLE_STAGE_CAPABILITIES.includes(c));
    if (reached.length > 0) {
      bad.push(`${id} reaches people stage(s): ${reached.join(", ")}`);
    }
  }
  return bad;
}
