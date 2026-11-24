// WHAT THE MODEL MAY ASK FOR, AND WHETHER THIS DEPLOYMENT CAN DO IT.
//
// `catalogueForPrompt()` lists every public capability with a description and
// nothing else, so the mission compiler is offered `technology_evidence` and
// `company_post_evidence` — capabilities the engine has no executor for — on
// the same footing as `general_company_discovery`. This states, per capability,
// what the code-owned policies already decide:
//
//   the engine can execute the stage       `routeReadiness.engineExecutes`
//   a provider for it may run in production `PRODUCTION_READINESS.decide`
//                                            (Actor Intelligence readiness:
//                                            READY, never CARDED_BUT_NOT_LIVE)
//   that provider is configured             credential PRESENCE only
//   it needs the user's approval            offers run nothing until accepted
//   it can spend credits                    the catalogue's `paid` flag
//
// A capability is `available` only when EVERY stage it expands to has an
// executor and a ready, configured provider (or needs none). A first cut read
// the executability table alone and advertised `funding_event_discovery` as
// available although its only provider is carded but not live (review of
// da3c0b08). Per-workspace authorisation, credits and per-mission provider
// refusals are enforced where money moves, never stated to a model. No
// credential value, workspace id, provider name or price appears in anything
// this module returns.
//
// PURE apart from `defaultProviderEnabled`'s environment presence check.

import {
  PUBLIC_CAPABILITY_CATALOGUE, PUBLIC_CAPABILITY_IDS, type PublicCapabilityId, type PublicCapabilityKind,
} from "./leadCapabilityCatalogue.ts";
import { CAPABILITY_REGISTRY, type CapabilityId } from "./leadCapabilityGraph.ts";
import { engineExecutes, PRODUCTION_READINESS, type ReadinessPolicy } from "./routeReadiness.ts";

export const CAPABILITY_CONTEXT_VERSION = "capability-context-v2" as const;

export type CapabilityAvailability =
  /** Every internal stage runs end to end in this deployment. */
  | "available"
  /** Can check a company already found, but cannot find new ones by this signal. */
  | "verification_only"
  /** Some stages run and some do not; the request may be only partly answerable. */
  | "partially_available"
  /** Nothing it expands to can run here: requesting it produces nothing. */
  | "not_available"
  /** Runs nothing until the user accepts it in the product. */
  | "offer_requires_user_approval";

export interface CapabilityContextEntry {
  capability: PublicCapabilityId;
  kind: PublicCapabilityKind;
  description: string;
  availability: CapabilityAvailability;
  /** Selecting it can cause paid provider work (each purchase is still separately authorised). */
  may_spend_credits: boolean;
}

export interface CapabilityContextOptions {
  /** The route-readiness policy to ask. Production's by default. */
  policy?: ReadinessPolicy;
  /** Whether a provider is configured in this deployment. */
  providerEnabled?: (provider: string) => boolean;
}

/**
 * Provider configuration by credential PRESENCE. Every provider the capability
 * registry names today is an Apify Actor, so one token decides all of them; an
 * unknown provider family is treated as not configured.
 */
export function defaultProviderEnabled(
  read: (k: string) => string | undefined = (k) => {
    try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k); }
    catch { return undefined; }
  },
): (provider: string) => boolean {
  const apify = !!String(read("APIFY_API_TOKEN") ?? "").trim();
  return (provider) => provider.startsWith("apify_") ? apify : false;
}

/** Can this internal stage run here: an executor, and a ready, configured provider if it needs one. */
export function stageRunnable(stage: CapabilityId, o: CapabilityContextOptions = {}): boolean {
  const policy = o.policy ?? PRODUCTION_READINESS;
  if (!engineExecutes(stage)) return false;
  const providers = (CAPABILITY_REGISTRY[stage]?.providers ?? []) as readonly string[];
  if (providers.length === 0) return policy.decide(null, stage).executable;
  const enabled = o.providerEnabled ?? defaultProviderEnabled();
  return providers.some((p) => enabled(p) && policy.decide(p, stage).executable);
}

/** One capability's availability, from the readiness and executability policies. */
export function capabilityAvailability(id: PublicCapabilityId, o: CapabilityContextOptions = {}): CapabilityAvailability {
  const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
  if (spec.kind === "offer") return "offer_requires_user_approval";
  if (spec.internal.length === 0) return "available"; // free evidence: reads what is already held
  const runnable = spec.internal.filter((c) => stageRunnable(c, o));
  if (runnable.length === spec.internal.length) return "available";
  if (runnable.length === 0) return "not_available";
  return runnable.every((c) => c.endsWith("_verification")) ? "verification_only" : "partially_available";
}

/** The catalogue as the mission compiler sees it under contract v2. */
export function capabilityContextForPrompt(o: CapabilityContextOptions = {}): CapabilityContextEntry[] {
  return PUBLIC_CAPABILITY_IDS.map((id) => ({
    capability: id,
    kind: PUBLIC_CAPABILITY_CATALOGUE[id].kind,
    description: PUBLIC_CAPABILITY_CATALOGUE[id].description,
    availability: capabilityAvailability(id, o),
    may_spend_credits: PUBLIC_CAPABILITY_CATALOGUE[id].paid,
  }));
}

/** How the prompt is told to use `availability`. */
export const CAPABILITY_AVAILABILITY_INSTRUCTION =
  "Each capability carries 'availability'. Request 'available' ones for what the request needs. " +
  "'verification_only' can check companies found another way but cannot find new ones by that " +
  "signal; 'partially_available' runs only part of what it describes. Never request a " +
  "'not_available' capability: if the request depends on one, say so in 'unknowns' so the user " +
  "is told, instead of choosing a near-miss.";
