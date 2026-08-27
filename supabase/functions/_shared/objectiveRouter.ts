// WHAT A UNDERSTOOD REQUEST ACTUALLY CAUSES.
//
// ── THE BOUNDARY THIS FILE DEFENDS ─────────────────────────────────────────
//
// GPT decided what the user meant. Everything from here is deterministic: which
// surface serves it, whether it may spend, and what happens when no surface can.
// The model's `RequestV1` is an INPUT to this function and never an authority
// over it — in particular `authority.may_spend` arrives hard-coded false from
// `parseRequestStrict`, and only the caller's workspace policy can raise it.
//
// ── WHY `read` IS STRUCTURALLY UNABLE TO SPEND ─────────────────────────────
//
// Not "does not spend" — CANNOT. A read route carries no provider surface and
// no mission, so there is nothing for a downstream stage to invoke even by
// mistake. That is stronger than a flag someone can forget to check, and it is
// the invariant the objective split exists to create: asking what we already
// know must never become a purchase.
//
// ── AND WHY AN UNSERVABLE OBJECTIVE CLARIFIES ──────────────────────────────
//
// `compose` has no execution surface yet. A router that quietly fell back to
// the nearest thing it could do would answer a different question than the one
// asked — the failure mode this whole migration exists to end. It returns
// `clarify` with the reason, and the user is told plainly.
//
// Pure. No network, no database, no model.

import {
  objectiveMaySpend, hasBlockingAmbiguity,
  type RequestV1, type RequestPart, type RequestObjective,
} from "./requestV1.ts";
import { projectToLeadMission, type LeadProjection } from "./projectToLeadMission.ts";
import type { ResolvedReferentBinding } from "./referentBinding.ts";
import { planUrlAnalysis, type UrlAnalysisPlan } from "./urlAnalysisSurface.ts";

export const OBJECTIVE_ROUTER_VERSION = "objective-router-v1" as const;

/** Where a request is sent. One per objective, plus the two refusals. */
export type RouteKind =
  /** Ordinary assistant reply. No work product, no spend. */
  | "converse"
  /** Answered from evidence already held. Reaches no provider, by construction. */
  | "read"
  /** A Lead mission. `research` and `source` differ by whether an entity was named. */
  | "lead_mission"
  /** A recurring observation subject. */
  | "monitor"
  /** Understood, but this system cannot serve it yet. */
  | "clarify"
  /** Understood, and blocked until the user resolves something. */
  | "blocked"
  /**
   * A page the user named, read directly.
   *
   * `research` whose reference is a URL. It cannot go down the lead path: the
   * URL would enter `known_companies` and `scanProposalForViolations` refuses
   * any url in a proposal, so a request the system can serve for the price of
   * one Firecrawl call was being refused as uncompilable.
   */
  | "url_analysis";

export interface Route {
  version: typeof OBJECTIVE_ROUTER_VERSION;
  kind: RouteKind;
  objective: RequestObjective;
  /** Present only for `lead_mission`. Absent everywhere else, deliberately. */
  lead?: LeadProjection;
  /** Present only for `url_analysis`. Carries the page and the question. */
  url?: UrlAnalysisPlan;
  /** Which parts this route serves. */
  part_ids: string[];
  /**
   * MAY THIS ROUTE CAUSE SPEND? Decided here, from the objective AND the
   * authority the caller granted — never from anything the model returned.
   */
  may_spend: boolean;
  /** True when the user must confirm before anything is bought. */
  requires_confirmation: boolean;
  /** What to say when the route is `clarify` or `blocked`. */
  message: string | null;
  reason: string;
}

/** Objectives with a surface today. `compose` is deliberately absent. */
const SERVABLE: ReadonlySet<RequestObjective> = new Set<RequestObjective>([
  "converse", "read", "research", "source", "monitor",
]);

export interface RouteOptions {
  /**
   * Workspace policy: may this request spend at all?
   *
   * SUPPLIED BY THE CALLER, from workspace state and the user's action — never
   * read from the request. `parseRequestStrict` sets `may_spend: false` on
   * everything the model produces precisely so this cannot be bypassed.
   */
  spendAllowed: boolean;
  /** True when the surface requires an explicit Start before buying. */
  confirmationRequired?: boolean;
  /**
   * The bindings the resolver produced for this request, if any.
   *
   * READ, NEVER DECIDED HERE. The router does not resolve referents and cannot;
   * it passes them to the projection so a bound referent contributes the
   * company's real name instead of the word the user used for it. A caller that
   * supplies none behaves exactly as it did before bindings existed.
   */
  bindings?: readonly ResolvedReferentBinding[];
}

const partsFor = (r: RequestV1, pred: (p: RequestPart) => boolean) =>
  r.parts.filter(pred).map((p) => p.id);

/**
 * Decide what a request causes.
 *
 * ORDER IS MEANING. A blocking ambiguity stops everything before a surface is
 * chosen, because the cheapest refusal is the one taken before any commitment.
 * Then the unservable objectives, so an honest "I cannot do that yet" is never
 * mistaken for a failure to understand. Only then the surfaces.
 */
export function routeRequest(request: RequestV1, opts: RouteOptions): Route {
  const base = {
    version: OBJECTIVE_ROUTER_VERSION,
    objective: request.objective,
    part_ids: request.parts.map((p) => p.id),
    may_spend: false,
    requires_confirmation: opts.confirmationRequired !== false,
    message: null as string | null,
  };

  // ── A BLOCKING AMBIGUITY STOPS EVERYTHING ────────────────────────────────
  //
  // Before a surface is chosen, because targeting the wrong entity is the most
  // expensive mistake available and the cheapest place to refuse is here.
  if (hasBlockingAmbiguity(request)) {
    const q = request.ambiguity.find((a) => a.blocking)!;
    return { ...base, kind: "blocked", message: q.question,
      reason: `blocking_ambiguity:${q.field}` };
  }

  // ── AN OBJECTIVE WITH NO SURFACE SAYS SO ─────────────────────────────────
  const unservable = request.parts.filter((p) => !SERVABLE.has(p.objective));
  if (unservable.length === request.parts.length) {
    return {
      ...base, kind: "clarify",
      part_ids: unservable.map((p) => p.id),
      message: request.parts.some((p) => p.objective === "compose")
        ? "I understood that as a content request. Content generation isn't wired up yet, so I can't produce it."
        : "I understood the request, but I don't have a way to serve it yet.",
      reason: `no_surface:${[...new Set(unservable.map((p) => p.objective))].join(",")}`,
    };
  }

  // ── CONVERSATION IS CONVERSATION ─────────────────────────────────────────
  if (request.parts.every((p) => p.objective === "converse")) {
    return { ...base, kind: "converse", may_spend: false, requires_confirmation: false,
      reason: "no_work_product" };
  }

  // ── READ CANNOT SPEND, BY CONSTRUCTION ───────────────────────────────────
  //
  // No `lead` projection is attached, so this route carries nothing a provider
  // could be invoked from. The absence IS the guarantee.
  if (request.parts.every((p) => p.objective === "read" || p.objective === "converse")) {
    return {
      ...base, kind: "read", may_spend: false, requires_confirmation: false,
      part_ids: partsFor(request, (p) => p.objective === "read"),
      reason: "answerable_from_held_evidence",
    };
  }

  // ── MONITOR ──────────────────────────────────────────────────────────────
  if (request.parts.every((p) => p.objective === "monitor" || p.objective === "read"
    || p.objective === "converse")) {
    return {
      ...base, kind: "monitor",
      part_ids: partsFor(request, (p) => p.objective === "monitor"),
      may_spend: opts.spendAllowed && objectiveMaySpend("monitor"),
      reason: "future_observation",
    };
  }

  // ── A NAMED PAGE IS READ, NOT SEARCHED FOR ───────────────────────────────
  //
  // BEFORE the lead projection, and that order is the point: the projection puts
  // a reference's value into `known_companies`, and a URL there is refused by
  // the proposal safety scan. Checked here, the URL never reaches a proposal at
  // all, so the scan stays exactly as strict as it was.
  //
  // Only `research` qualifies. A `read` quoting a URL is asking what is already
  // held about it and must reach no provider; a `source` request describes a
  // population and has no single page to read.
  const urlPlan = planUrlAnalysis(request);
  if (urlPlan.url) {
    return {
      ...base, kind: "url_analysis", url: urlPlan,
      part_ids: urlPlan.part_id ? [urlPlan.part_id] : base.part_ids,
      // One scoped fetch of a page the user named, under the caller's authority
      // exactly like any other research.
      may_spend: opts.spendAllowed,
      reason: "named_page_analysis",
    };
  }

  // ── RESEARCH AND SOURCE BOTH BECOME A LEAD MISSION ───────────────────────
  //
  // They differ by whether an entity was named, which the projection already
  // reads as `known_companies`. One surface, one contract, one set of gates —
  // Stage 0, Stage 1, credits and provider selection all unchanged.
  const lead = projectToLeadMission(request, opts.bindings ?? []);
  if (lead.refusal) {
    return {
      ...base, kind: "clarify",
      // AN UNRESOLVED RESEARCH TARGET ASKS, IT DOES NOT SEARCH. Falling back to
      // discovery would answer a question about one company by paying to find
      // many — see `research_without_identity`.
      message: lead.refusal === "research_without_identity"
        ? "Which company should I look into? I can check a specific one, but I won't go searching without knowing who you mean."
        : lead.refusal === "not_a_lead_request"
        ? "I understood the request, but it isn't something the lead pipeline can serve."
        : "I understood the request, but I can't turn it into a run yet.",
      reason: `lead_projection_refused:${lead.refusal}`,
    };
  }
  return {
    ...base, kind: "lead_mission", lead,
    part_ids: partsFor(request, (p) => objectiveMaySpend(p.objective)),
    // THE ONLY PLACE `may_spend` BECOMES TRUE, and it needs BOTH the objective
    // and the caller's authority. Either alone is insufficient.
    may_spend: opts.spendAllowed && request.parts.some((p) => objectiveMaySpend(p.objective)),
    reason: request.parts.some((p) => p.objective === "research")
      ? "named_entity_investigation" : "discovery",
  };
}
