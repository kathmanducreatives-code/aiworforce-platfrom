// MAKING CHAT BRAIN AUTHORITATIVE, WITHOUT MOVING THE MACHINERY UNDER IT.
//
// ── WHY A BINDING RATHER THAN A REWRITE ────────────────────────────────────
//
// `pilot-chat` is 3,132 lines and every downstream stage — cards, previews,
// delegation, Stage 0, credits — reads `decision.workflow_category`. Replacing
// that plumbing and the understanding layer in one change would put a hardened
// pipeline and a brand-new semantic layer at risk simultaneously, and a
// regression would be unattributable between them.
//
// So the DECISION moves and the machinery does not. Chat Brain produces a
// `RequestV1`, the router turns it into a `Route`, and this file states what
// that route means in the vocabulary pilot-chat already speaks. The old
// classifier still runs and is still logged; it is simply no longer what
// decides.
//
// ── WHAT EACH OBJECTIVE REACHES ────────────────────────────────────────────
//
// `converse` and the lead objectives enter pilot-chat's existing categories.
// `read` and `monitor` have their own surfaces and do NOT become a category:
// answering "what are my strongest signals?" through `simple_chat` would let
// the model invent an answer from no data, and turning "keep watching that"
// into a sourcing run would buy something nobody asked for. Each gets the
// narrow surface it needs, and `compose` still has none — which it says.
//
// ── AND WHAT NEVER CROSSES THIS SEAM ───────────────────────────────────────
//
// Spend authority. `Route.may_spend` is computed by the router from workspace
// policy; nothing here can raise it, and the existing confirmation path still
// gates every paid run exactly as before.

import type { Route } from "./objectiveRouter.ts";

export const CHAT_BRAIN_BINDING_VERSION = "chat-brain-binding-v1" as const;

/** The rollback switch. Chat Brain is authoritative unless this says otherwise. */
export const CHAT_BRAIN_FLAG = "CHAT_BRAIN_ENABLED" as const;

/**
 * Is the new understanding path authoritative?
 *
 * DEFAULT ON. Set `CHAT_BRAIN_ENABLED=false` to fall back to the old
 * classifiers wholesale — one variable, no deploy, and the old stack is still
 * present and still running.
 */
export function chatBrainEnabled(readEnv: (k: string) => string | undefined): boolean {
  return String(readEnv(CHAT_BRAIN_FLAG) ?? "true").toLowerCase() !== "false";
}

/**
 * The ONLY legacy category a route may still be expressed as.
 *
 * `converse` has no surface of its own yet, so it enters pilot-chat's existing
 * conversational branch. Every other objective now carries a typed payload to
 * its own surface, and this union exists to make the remaining translation
 * finite, visible, and impossible to widen by accident — a category outside it
 * will not type-check.
 */
export type BoundCategory = "simple_chat";

export type BindingOutcome =
  /** Chat Brain decided; use `category` and ignore the old classifier. */
  | { kind: "category"; category: BoundCategory; reason: string }
  /** A lead mission. The caller compiles `route.lead` and delegates it. */
  | { kind: "lead_route"; reason: string }
  /** Read one page the user named. Reaches Firecrawl and nothing else. */
  | { kind: "url_analysis"; reason: string }
  /** Research a topic via live web search, or say it is not configured. */
  | { kind: "market_research"; reason: string }
  /** Reply now and stop. Nothing is executed, nothing is bought. */
  | { kind: "reply"; message: string; reason: string }
  /** Answer from held evidence. No provider is reachable from this path. */
  | { kind: "read"; reason: string }
  /** Record a monitoring subject. Buys nothing at this moment. */
  | { kind: "monitor"; reason: string }
  /** Chat Brain understood, but this route has no wiring. Old path decides. */
  | { kind: "fallback"; reason: string };

/**
 * What a route means to `pilot-chat`.
 *
 * Total: every route yields an outcome, and the one that means "I have no
 * wiring for this" is explicit rather than a silent default.
 */
export function bindRoute(route: Route): BindingOutcome {
  switch (route.kind) {
    case "blocked":
      // The user must resolve something before anything can run. Answering
      // instead of asking is how a run targets the wrong company.
      return {
        kind: "reply",
        message: route.message ?? "I need one more detail before I can run that.",
        reason: route.reason,
      };

    case "clarify":
      // Understood, and honestly unservable. Saying so beats serving the
      // nearest thing we happen to have.
      return {
        kind: "reply",
        message: route.message ?? "I understood that, but I can't serve it yet.",
        reason: route.reason,
      };

    case "converse":
      return { kind: "category", category: "simple_chat", reason: route.reason };

    case "lead_mission":
      // ── NOT A CATEGORY. THE ROUTE CARRIES ITS OWN PAYLOAD. ─────────────
      //
      // This returned `category: "qualified_lead_sourcing"`, and that string is
      // not a member of `WorkflowCategory`. No branch matched it, so every
      // correctly-understood sourcing request fell through the whole category
      // chain into a deep fallback that delegated with no mission, and
      // orchestrate refused it as `mission_not_compiled`.
      //
      // The caller handles this route directly: it compiles `route.lead` through
      // `compileLeadMission` and delegates the result. Nothing about Stage 0,
      // Stage 1, identity, unlocks, credits or provider selection changes — they
      // are downstream of the mission, and now they actually receive one.
      return { kind: "lead_route", reason: route.reason };

    case "url_analysis":
      // ITS OWN SURFACE, for the same reason `read` and `monitor` have theirs:
      // a page the user named is served by Firecrawl, and turning it into a
      // sourcing category would buy a search for a company already identified
      // by the link.
      return { kind: "url_analysis", reason: route.reason };

    case "market_research":
      // Its own surface, and the one research path with no named subject to
      // bound it — so an unconfigured deployment must say so rather than
      // returning a confident empty result.
      return { kind: "market_research", reason: route.reason };

    case "read":
      // ANSWERED FROM HELD EVIDENCE, reaching no provider. `readSurface`
      // imports no tool registry and no capability engine, so there is nothing
      // on this path to invoke even by mistake.
      return { kind: "read", reason: route.reason };

    case "monitor":
      // RECORDS AN INTENTION; buys nothing now. `run-monitoring-tick` decides
      // when that intention costs money, under its own cadence and period
      // ceiling — both unchanged.
      return { kind: "monitor", reason: route.reason };
  }
}
