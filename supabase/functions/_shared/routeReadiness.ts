// LEAD V2 — ONE ANSWER TO "MAY THIS ROUTE RUN?".
//
// Two tables used to answer it, and each was consulted directly by whoever
// needed an answer:
//
//   capabilityExecutability   can the ENGINE execute this capability at all?
//   Actor Intelligence        has this actor, for this capability, run live?
//
// The graph asked the first and (for entries only) half of the second; the gap
// router asked only the second; RetrievalPlan validation only the first; the
// verifier runner its own mix; ProviderCallSpec neither. So one route could be
// "ready" to the planner and "blocked" to the router, and a carded actor that
// had never run live could be entered as a user mission's discovery route with
// nothing but a warning — a user mission silently became a provider canary.
//
// Both tables remain as DECLARATIONS. This module is the only place that reads
// them to decide, and every consumer — discovery selection, the gap router, the
// verifier selector, RetrievalPlan validation, ProviderCallSpec compilation —
// asks it and nothing else.
//
// PRODUCTION (every normal Lead V2 mission)
//
//   READY                 executable
//   EXPERIMENTAL          executable only when explicitly allowed
//   CARDED_BUT_NOT_LIVE   NOT executable
//   NEEDS_* / LEGACY_ONLY / NOT_PRESENT   NOT executable
//   UNAVAILABLE           NOT executable (refused this mission)
//
// PROVIDER PROBE (an explicit canary, never a user default)
//
//   as production, plus the named carded/experimental pairs — and only those —
//   so a probe proves exactly the routes it was opened for. A probe is scoped
//   to the workspaces named for it, so no ordinary mission can become one.
//
// Pure. The environment is read only by `readinessPolicyFor`, once, by the caller.

import { readinessOf, type ActorReadiness } from "./actorIntelligence.ts";
import { executabilityStateOf, isCapabilityExecutable } from "./capabilityExecutability.ts";
import { hiringActorCard } from "./hiringActorCatalog.ts";

export const ROUTE_READINESS_VERSION = "route-readiness-v1" as const;

export type RouteMode = "production" | "provider_probe";

/**
 * Capabilities executed by a registered claim verifier rather than a graph
 * step. They are not graph capabilities, so `capabilityExecutability` has no
 * row for them; their executor is the verifier (`claimVerificationPhase.ts`).
 */
export const CLAIM_VERIFIER_CAPABILITIES: ReadonlySet<string> = new Set(["funding_verification", "web_evidence"]);

export interface RouteReadinessDecision {
  actor: string | null;
  capability: string;
  /** Actor Intelligence's class; `ENGINE` for a provider-less step; `UNAVAILABLE` when refused this mission. */
  readiness: ActorReadiness | "ENGINE" | "UNAVAILABLE";
  executable: boolean;
  /** Why it may run, when it may. */
  via: "ready" | "experimental_allowed" | "provider_probe" | "engine_only" | null;
  reason: string;
}

export interface ReadinessPolicy {
  readonly mode: RouteMode;
  decide(actor: string | null, capability: string): RouteReadinessDecision;
  /** For the trace: what this policy permits beyond READY. */
  describe(): { mode: RouteMode; probe_routes: string[]; allow_experimental: string[]; overrides: string[] };
}

export interface ReadinessPolicyOptions {
  mode?: RouteMode;
  /** EXPERIMENTAL pairs explicitly allowed, as `actor|capability`. */
  allow_experimental?: readonly string[];
  /** provider_probe only: the carded / experimental pairs this probe may run. */
  probe_routes?: readonly string[];
  /** Readiness overrides by `actor|capability` — fixtures, never production config. */
  overrides?: Readonly<Record<string, ActorReadiness>>;
  /** A provider refused for this mission (opt-in gate, credit, auth) is UNAVAILABLE. */
  unavailable?: (actor: string, capability: string) => boolean;
}

export const pairKey = (actor: string, capability: string): string => `${actor}|${capability}`;

/** Can anything execute this capability — a graph executor or a claim verifier? */
export function engineExecutes(capability: string): boolean {
  return isCapabilityExecutable(capability) || CLAIM_VERIFIER_CAPABILITIES.has(capability);
}

export function readinessPolicy(o: ReadinessPolicyOptions = {}): ReadinessPolicy {
  const mode: RouteMode = o.mode ?? "production";
  const experimental = new Set(o.allow_experimental ?? []);
  const probe = new Set(mode === "provider_probe" ? (o.probe_routes ?? []) : []);
  const overrides = o.overrides ?? {};
  return {
    mode,
    describe: () => ({
      mode, probe_routes: [...probe], allow_experimental: [...experimental], overrides: Object.keys(overrides),
    }),
    decide(actor, capability) {
      const no = (readiness: RouteReadinessDecision["readiness"], reason: string): RouteReadinessDecision =>
        ({ actor, capability, readiness, executable: false, via: null, reason });
      if (!engineExecutes(capability)) {
        return no(actor ? (overrides[pairKey(actor, capability)] ?? readinessOf(actor, capability).readiness) : "ENGINE",
          `${capability} is not executable by the engine (${executabilityStateOf(capability)})`);
      }
      if (!actor) return { actor, capability, readiness: "ENGINE", executable: true, via: "engine_only", reason: "no provider" };
      const key = pairKey(actor, capability);
      if (o.unavailable?.(actor, capability)) return no("UNAVAILABLE", `${actor} was refused for this mission`);
      const record = readinessOf(actor, capability);
      const readiness = overrides[key] ?? record.readiness;
      const yes = (via: RouteReadinessDecision["via"], reason: string): RouteReadinessDecision =>
        ({ actor, capability, readiness, executable: true, via, reason });
      switch (readiness) {
        case "READY":
          return yes("ready", record.live_evidence ? `live-proven: ${record.live_evidence}` : "READY");
        case "EXPERIMENTAL":
          if (experimental.has(key)) return yes("experimental_allowed", "EXPERIMENTAL, explicitly allowed");
          if (probe.has(key)) return yes("provider_probe", "EXPERIMENTAL, opened for this provider probe");
          return no(readiness, `${key} is EXPERIMENTAL: not explicitly allowed`);
        case "CARDED_BUT_NOT_LIVE":
          if (probe.has(key)) return yes("provider_probe", "never run live; opened for this provider probe");
          return no(readiness, `${key} is CARDED_BUT_NOT_LIVE: never run live in Lead V2; only an explicit provider probe may run it`);
        default:
          return no(readiness, `${key} is ${readiness}: ${record.reason}`);
      }
    },
  };
}

/** Every normal Lead V2 mission. */
export const PRODUCTION_READINESS: ReadinessPolicy = readinessPolicy();

/** The same policy, with this mission's refused providers marked UNAVAILABLE. */
export function withUnavailable(
  p: ReadinessPolicy, unavailable: (actor: string, capability: string) => boolean,
): ReadinessPolicy {
  return {
    mode: p.mode,
    describe: p.describe,
    decide(actor, capability) {
      const d = p.decide(actor, capability);
      if (!d.executable || !actor || !unavailable(actor, capability)) return d;
      return { ...d, readiness: "UNAVAILABLE", executable: false, via: null, reason: `${actor} was refused for this mission` };
    },
  };
}

/** Workspaces whose missions run as provider probes, and the routes a probe opens. */
export const PROVIDER_PROBE_WORKSPACES_ENV = "LEAD_V2_PROVIDER_PROBE_WORKSPACES";
export const PROVIDER_PROBE_ROUTES_ENV = "LEAD_V2_PROVIDER_PROBE_ROUTES";
export const ALLOW_EXPERIMENTAL_ENV = "LEAD_V2_ALLOW_EXPERIMENTAL_ROUTES";

const list = (v: string | undefined | null): string[] =>
  String(v ?? "").split(",").map((s) => s.trim()).filter((s) => s.includes("|") || s.length > 0);

/**
 * The policy for a mission in this workspace. Production unless the workspace
 * is named as a probe workspace AND probe routes are named — both explicit, so
 * no configuration default can turn user missions into canaries.
 */
export function readinessPolicyFor(
  workspaceId: string | null | undefined, read: (k: string) => string | undefined,
): ReadinessPolicy {
  const experimental = list(read(ALLOW_EXPERIMENTAL_ENV)).filter((s) => s.includes("|"));
  const probeWorkspaces = list(read(PROVIDER_PROBE_WORKSPACES_ENV));
  const probeRoutes = list(read(PROVIDER_PROBE_ROUTES_ENV)).filter((s) => s.includes("|"));
  const probing = !!workspaceId && probeWorkspaces.includes(String(workspaceId)) && probeRoutes.length > 0;
  if (!probing && experimental.length === 0) return PRODUCTION_READINESS;
  return readinessPolicy({
    mode: probing ? "provider_probe" : "production",
    allow_experimental: experimental,
    probe_routes: probing ? probeRoutes : [],
  });
}

/**
 * A capability with its providers: which of them may run, and whether the
 * capability can run at all. A provider-less capability (known companies,
 * qualification, persistence) runs when the engine executes it.
 */
export function capabilityRunnable(
  policy: ReadinessPolicy, capability: string, providers: readonly string[],
): { runnable: boolean; providers: string[]; refused: RouteReadinessDecision[]; readiness: string; reason: string } {
  if (providers.length === 0) {
    const d = policy.decide(null, capability);
    return { runnable: d.executable, providers: [], refused: d.executable ? [] : [d], readiness: d.readiness, reason: d.reason };
  }
  const decisions = providers.map((p) => policy.decide(p, capability));
  const ok = decisions.filter((d) => d.executable);
  const refused = decisions.filter((d) => !d.executable);
  const best = ok[0] ?? decisions[0];
  return {
    runnable: ok.length > 0,
    providers: ok.map((d) => d.actor!),
    refused,
    readiness: best.readiness,
    reason: ok.length > 0 ? best.reason : refused.map((d) => d.reason).join("; "),
  };
}

/**
 * May a route controller ADD a route through this actor? The policy's decision,
 * plus a card: an uncarded actor has no bounded, priced input to compile.
 */
export function routeActorReady(
  actor: string, capability: string, policy: ReadinessPolicy = PRODUCTION_READINESS,
): { ready: true } | { ready: false; reason: string } {
  const d = policy.decide(actor, capability);
  if (!d.executable) return { ready: false, reason: d.reason };
  if (!hiringActorCard(actor)) return { ready: false, reason: `${actor} has no actor card` };
  return { ready: true };
}
