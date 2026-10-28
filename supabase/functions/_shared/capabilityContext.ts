// WHAT THE MODEL MAY ASK FOR, AND WHETHER THIS DEPLOYMENT CAN DO IT.
//
// `catalogueForPrompt()` lists every public capability with a description and
// nothing else, so the mission compiler is offered `technology_evidence` and
// `company_post_evidence` — capabilities the engine has no executor for — on
// the same footing as `general_company_discovery`. `capabilityExecutability`
// records exactly that gap (its header: the graph entered such capabilities,
// the engine finished them as skipped, and feasibility still reported the
// signal satisfied). This joins the two, from the code-owned tables, so the
// prompt states what is true rather than what was hand-written about it.
//
// ── THE LAYERS, AND WHICH ONES A MISSION PROMPT MAY CARRY ───────────────────
//
//   1. exists in the codebase       the catalogue                     → stated
//   2. the engine can execute it    capabilityExecutability           → stated
//   3. needs the user's approval    offers run nothing until accepted → stated
//   4. can spend credits            the catalogue's `paid` flag       → stated
//   5. enabled for the workspace /  credential presence, workspace    → NOT here
//      credentialed / authorised    flags, the credit authorisation
//      for this mission             — decided by code at execution
//
// Layer 5 never reaches a model: it is per workspace, can name a vendor or an
// account, and is enforced where the money moves (the credit and provider
// gates), not in an interpretation prompt. No credential, workspace id,
// provider or price appears in anything this module returns.
//
// PURE.

import {
  PUBLIC_CAPABILITY_CATALOGUE, PUBLIC_CAPABILITY_IDS, type PublicCapabilityId, type PublicCapabilityKind,
} from "./leadCapabilityCatalogue.ts";
import { executabilityStateOf } from "./capabilityExecutability.ts";

export const CAPABILITY_CONTEXT_VERSION = "capability-context-v1" as const;

export type CapabilityAvailability =
  /** Every internal stage runs end to end. */
  | "available"
  /** Can check a company already found, but cannot find new ones by this signal. */
  | "verification_only"
  /** No executor in this deployment: requesting it produces nothing. */
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

/** One capability's availability, derived from the executability table. */
export function capabilityAvailability(id: PublicCapabilityId): CapabilityAvailability {
  const spec = PUBLIC_CAPABILITY_CATALOGUE[id];
  if (spec.kind === "offer") return "offer_requires_user_approval";
  if (spec.internal.length === 0) return "available"; // free evidence: reads what is already held
  const states = spec.internal.map((c) => executabilityStateOf(c));
  if (states.every((s) => s === "executable")) return "available";
  if (states.some((s) => s === "executable")) return "verification_only";
  return "not_available";
}

/** The catalogue as the mission compiler sees it under contract v2. */
export function capabilityContextForPrompt(): CapabilityContextEntry[] {
  return PUBLIC_CAPABILITY_IDS.map((id) => ({
    capability: id,
    kind: PUBLIC_CAPABILITY_CATALOGUE[id].kind,
    description: PUBLIC_CAPABILITY_CATALOGUE[id].description,
    availability: capabilityAvailability(id),
    may_spend_credits: PUBLIC_CAPABILITY_CATALOGUE[id].paid,
  }));
}

/** How the prompt is told to use `availability`. */
export const CAPABILITY_AVAILABILITY_INSTRUCTION =
  "Each capability carries 'availability'. Request 'available' ones for what the request needs. " +
  "'verification_only' can check companies found another way but cannot find new ones by that " +
  "signal. Never request a 'not_available' capability: if the request depends on one, say so in " +
  "'unknowns' so the user is told, instead of choosing a near-miss.";
