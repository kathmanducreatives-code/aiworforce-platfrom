// WHICH ENVIRONMENT IS THIS EDGE FUNCTION ACTUALLY RUNNING IN?
//
// Phase 2 needs a truthful answer, because the answer gates capability selection.
// Hardcoding one is how a production run ends up validated under TEST rules.
//
// THIS IS NOT A NEW CONVENTION. `scripts/verify-deploy-target.mjs` already decides
// this exact question the same way — by resolving the Supabase PROJECT REF and
// comparing it against the two canonical refs. That script guards deploys from the
// outside; this resolves the same fact from inside the running function, using the
// `SUPABASE_URL` the platform injects. The canonical refs are duplicated rather than
// imported because that file is a Node build script and this is Deno edge code; the
// pairing is asserted by runtimeEnvironment.test.ts so the two cannot drift.
//
// IT FAILS CLOSED. An unrecognised ref, a missing URL, or a malformed one resolves
// to NOT-OK, never to a default. "Unknown" must never quietly become "test" — that
// is precisely the mistake that would let production inherit TEST allow-listing.
//
// PROJECT REFS ARE INTERNAL. The resolution returns a MODE and nothing else. No ref
// is ever placed on the mission, in the planner prompt, or in diagnostics.
//
// PURE apart from the injected reader. No network, no database, no provider calls.

import type { AgentoryEnvironmentMode } from "./mission.ts";
import { type EnvReader } from "../signalsV2Flag.ts";

/** The two canonical Supabase projects. Mirrors scripts/verify-deploy-target.mjs. */
/**
 * SINGLE-PROJECT DEPLOYMENT. Both keys hold the SAME ref, deliberately.
 *
 * Agentory previously ran two projects, and this map existed to stop one being
 * mistaken for the other — the audit that created it found the frontend talking
 * to production while the tooling talked to test. As of the migration to
 * `luvostyizefajbltukkc` there is one project serving both roles, so that
 * particular confusion is no longer possible: there is nowhere else to send a
 * request.
 *
 * The map is kept rather than collapsed because the guard it feeds is still
 * worth having, and its meaning has simply changed. It no longer answers "is
 * this test or production" — it answers "is this the project we are supposed to
 * be talking to at all", which is the question that matters while two abandoned
 * projects still exist and still accept credentials.
 *
 * Resolution order puts `production` first, so a ref matching both classifies as
 * production. That is correct: with one live project, everything IS production.
 * No behaviour is lost — every capability in `capabilityRegistry` is enabled for
 * all environments, so nothing was ever test-only.
 */
export const CANONICAL_PROJECT_REFS: Readonly<Record<"production" | "test", string>> = {
  production: "luvostyizefajbltukkc",
  test: "luvostyizefajbltukkc",
};

/** Hosts that mean "a developer's machine", not a deployed project. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "kong", "host.docker.internal"]);

export type EnvironmentUnresolvedReason =
  /** No SUPABASE_URL / project id was readable at all. */
  | "no_project_ref"
  /** Present, but not a URL/ref shape we can decide on. */
  | "malformed_project_ref"
  /** A well-formed ref that is neither canonical project. */
  | "unrecognised_project_ref";

export type EnvironmentResolution =
  | { ok: true; mode: AgentoryEnvironmentMode }
  | { ok: false; reason: EnvironmentUnresolvedReason };

/**
 * Extract the project ref from a Supabase URL.
 *
 * Returns `"local"` for a loopback host — a real, decidable answer — and `null`
 * when the input is not a URL we recognise, which the caller treats as malformed.
 */
export function projectRefFromUrl(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  const host = /^https?:\/\/([^/:]+)/i.exec(raw)?.[1]?.toLowerCase();
  if (!host) return null;
  if (LOCAL_HOSTS.has(host)) return "local";
  const m = /^([a-z0-9]+)\.supabase\.(co|in|net)$/i.exec(host);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve the runtime environment.
 *
 * Resolution order mirrors the deploy guard, narrowed to what exists server-side:
 * an explicit `SUPABASE_PROJECT_ID`, then the ref inside `SUPABASE_URL`.
 *
 * Every failure path returns NOT-OK. There is deliberately no default branch — a
 * mode is only ever returned for a ref that was positively recognised.
 */
export function resolveRuntimeEnvironment(read?: EnvReader): EnvironmentResolution {
  let explicitId: string | undefined;
  let url: string | undefined;
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    explicitId = get("SUPABASE_PROJECT_ID")?.trim();
    url = get("SUPABASE_URL")?.trim();
  } catch {
    // A denied env permission is not a licence to guess.
    return { ok: false, reason: "no_project_ref" };
  }

  let ref: string | null = null;
  if (explicitId) {
    // An explicit id may be a bare ref or a full URL.
    ref = /^[a-z0-9]+$/i.test(explicitId) ? explicitId.toLowerCase() : projectRefFromUrl(explicitId);
    if (!ref) return { ok: false, reason: "malformed_project_ref" };
  } else if (url) {
    ref = projectRefFromUrl(url);
    if (!ref) return { ok: false, reason: "malformed_project_ref" };
  } else {
    return { ok: false, reason: "no_project_ref" };
  }

  if (ref === CANONICAL_PROJECT_REFS.production) return { ok: true, mode: "production" };
  if (ref === CANONICAL_PROJECT_REFS.test) return { ok: true, mode: "test" };
  if (ref === "local") return { ok: true, mode: "development" };
  return { ok: false, reason: "unrecognised_project_ref" };
}

/** A short, ref-free label for diagnostics. Never contains a project ref. */
export function environmentFallbackReason(reason: EnvironmentUnresolvedReason): string {
  return `environment_unresolved:${reason}`;
}
