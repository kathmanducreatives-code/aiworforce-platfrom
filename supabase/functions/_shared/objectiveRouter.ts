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
import {
  planMarketResearch, type MarketResearchPlan,
} from "./marketResearchSurface.ts";
import { planCompose, type ComposePlan } from "./composeSurface.ts";
import {
  planSignalSourcing, type SignalSourcingPlan,
} from "./signalSourcingSurface.ts";

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
  | "url_analysis"
  /**
   * A topic, not an organisation. Served by live web search when the deployment
   * has it, and refused honestly when it does not.
   */
  | "market_research"
  /** Write something. `compose.kind` says whether it has a recipient. */
  | "compose"
  /** Source public activity, rivals, or the people who engaged with a post. */
  | "signal_sourcing"
  /**
   * Write something AND go looking for engagement on that subject.
   *
   * Two asks in one message, which `RequestV1` represents as two parts. The
   * classifier expressed it as an `execution_mode` on a single category because
   * it had no way to say "this message contains two things".
   */
  | "content_engagement_loop";

export interface Route {
  version: typeof OBJECTIVE_ROUTER_VERSION;
  kind: RouteKind;
  objective: RequestObjective;
  /** Present only for `lead_mission`. Absent everywhere else, deliberately. */
  lead?: LeadProjection;
  /** Present only for `url_analysis`. Carries the page and the question. */
  url?: UrlAnalysisPlan;
  /** Present only for `market_research`. Carries the topic. */
  market?: MarketResearchPlan;
  /** Present only for `compose`. Says what is written and for whom. */
  compose?: ComposePlan;
  /** Present only for `signal_sourcing`. Says which of the three kinds. */
  signals?: SignalSourcingPlan;
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

/**
 * Objectives with a surface.
 *
 * `compose` used to be deliberately absent, on the reasoning that the Content
 * surface did not exist. Two DID exist — Penn's approval-gated outreach drafts
 * and Scribe's content — and both sat below a refusal that returned before
 * either could be reached. Absence here is a claim that nothing can serve the
 * objective, and that claim was false.
 */
const SERVABLE: ReadonlySet<RequestObjective> = new Set<RequestObjective>([
  "converse", "read", "research", "source", "monitor", "compose",
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

  // ── WRITE SOMETHING AND FIND ENGAGEMENT ON IT ────────────────────────────
  //
  // Checked before either half, because either half alone would claim it and
  // silently drop the other: routing to `compose` writes the post and never
  // looks for engagement; routing to `signal_sourcing` searches and never
  // writes. The compound shape is two parts in one message, and it is only this
  // when BOTH are present.
  const composeForLoop = planCompose(request);
  const signalsForLoop = planSignalSourcing(request);
  if (composeForLoop?.kind === "content" && signalsForLoop?.kind === "engagement") {
    return {
      ...base, kind: "content_engagement_loop",
      compose: composeForLoop, signals: signalsForLoop,
      part_ids: [composeForLoop.part_id, signalsForLoop.part_id],
      may_spend: opts.spendAllowed,
      reason: "content_and_engagement",
    };
  }

  // ── SOURCING ACTIVITY IS NOT SOURCING COMPANIES ──────────────────────────
  //
  // Before the lead projection, and `person` is why the order matters: pulling
  // the commenters off a post has `entity: person`, which IS a lead entity, so
  // without this the request would compile into a mission to go and find people
  // matching a description — buying a discovery run instead of reading one post.
  const signalPlan = signalsForLoop;
  if (signalPlan) {
    return {
      ...base, kind: "signal_sourcing", signals: signalPlan,
      part_ids: [signalPlan.part_id],
      may_spend: opts.spendAllowed,
      reason: `signal_sourcing:${signalPlan.kind}`,
    };
  }

  // ── WRITING IS ITS OWN WORK ──────────────────────────────────────────────
  //
  // Before the lead projection: a request to write is not a request to find,
  // and projecting it would read the description of what to write as a
  // description of companies to source.
  const composePlan = composeForLoop;
  if (composePlan) {
    return {
      ...base, kind: "compose", compose: composePlan,
      part_ids: [composePlan.part_id],
      // OUTREACH NEVER SPENDS FROM HERE. Drafting is a model call the existing
      // path owns, and sending is approval-gated downstream — neither is a
      // provider purchase this router authorises.
      may_spend: false,
      requires_confirmation: composePlan.kind === "outreach",
      reason: `compose:${composePlan.kind}`,
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

  // ── A MARKET IS NOT A POPULATION TO SOURCE ───────────────────────────────
  //
  // Also before the lead projection. A topic has no company profile, so the
  // projection would either refuse it or — worse — treat the topic words as a
  // description of companies to go and find, buying a discovery run for a
  // question that asked for none.
  const marketPlan = planMarketResearch(request);
  if (marketPlan.topic && marketPlan.part_id) {
    return {
      ...base, kind: "market_research", market: marketPlan,
      part_ids: [marketPlan.part_id],
      may_spend: opts.spendAllowed,
      reason: "topic_research",
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
