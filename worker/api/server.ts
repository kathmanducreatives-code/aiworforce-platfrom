// THE HTTP SURFACE — CORS, THE GATE, THE ROUTE, AND NOTHING ELSE.
//
// Everything this file does was previously done by Supabase's function gateway.
// It is deliberately thin: a request that gets past it is handed to the very
// same handler the edge deployment runs, untouched, with its headers and body
// intact. In particular the `Authorization` header is forwarded VERBATIM,
// because the handlers derive identity from it — rewriting it here, even to
// "normalise" it, would quietly move the trust boundary.
//
// ── THE RESPONSE IS THE HANDLER'S, PLUS CORS ───────────────────────────────
//
// Status, body and content type all come from the handler. This file only adds
// the CORS headers a browser needs, because on Supabase the gateway added them
// to the function's own `cors` object and here nothing would.

import { checkRequest, createJwksSource, type EnvRead, type JwksSource } from "./gateway.ts";
import { apiPathFor } from "../../supabase/functions/_shared/functionEndpoints.ts";
import { loadHandlers, routesToMount, type FunctionHandler } from "./routes.ts";
import type { RailwayServedFunction } from "../../supabase/functions/_shared/functionEndpoints.ts";

/**
 * WHO MAY CALL THE API FROM A BROWSER.
 *
 * `*` is the default because it is what the edge functions already send —
 * every one of them carries `Access-Control-Allow-Origin: *`. Narrowing it here
 * while the edge deployment stays open would not make the system safer; it
 * would only make the two behave differently during the cutover, which is the
 * one thing this migration must avoid. `AGENTORY_API_ALLOWED_ORIGINS` narrows
 * both ends later, deliberately, as its own change.
 *
 * Note that CORS is not an access control in either case: a non-browser client
 * ignores it entirely. What protects these routes is the gate and the
 * membership check, not this header.
 */
export function corsHeadersFor(origin: string | null, env: EnvRead): Record<string, string> {
  const configured = (env("AGENTORY_API_ALLOWED_ORIGINS") ?? "").trim();
  const allowed = configured && configured !== "*"
    ? configured.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const value = !allowed ? "*" : (origin && allowed.includes(origin) ? origin : allowed[0] ?? "null");
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    ...(allowed ? { Vary: "Origin" } : {}),
  };
}

export interface ApiDeps {
  handlers: Map<string, FunctionHandler>;
  env: EnvRead;
  log?: (msg: string, meta?: unknown) => void;
  now?: () => number;
  /**
   * The project's published signing keys, for asymmetric tokens.
   *
   * Built from SUPABASE_URL when absent. A test that passes nothing gets no
   * key source, so its ES256 tokens are DEFERRED rather than refused — which
   * is the same thing a deployment with an unreachable JWKS endpoint does.
   */
  jwks?: JwksSource;
}

/** The route name for a path, or null when this is not an API path at all. */
export function routeNameFor(pathname: string): string | null {
  const m = /^\/api\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * Build the API request handler.
 *
 * Returns null for a path the API does not own, so the caller (the health
 * server) can answer `/health` itself without this file knowing about it.
 */
export function createApiHandler(deps: ApiDeps): (req: Request) => Promise<Response | null> {
  const log = deps.log ?? (() => {});
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    const name = routeNameFor(url.pathname);
    if (!name) return null;

    const cors = corsHeadersFor(req.headers.get("Origin"), deps.env);
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status, headers: { ...cors, "Content-Type": "application/json" },
      });

    // THE PREFLIGHT IS ANSWERED BEFORE THE GATE, ALWAYS. A browser sends no
    // Authorization on an OPTIONS, so authenticating it would refuse every
    // cross-origin caller including the correctly-authenticated ones.
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const handler = deps.handlers.get(name);
    // An unmounted route is a 404 whether or not the caller is authenticated:
    // the gate would tell an unauthenticated prober which routes exist.
    if (!handler) return json({ error: "not_found", route: name }, 404);
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const decision = await checkRequest(req, deps.env, deps.now, deps.jwks);
    if (!decision.ok) {
      // The bearer itself is NEVER logged — only the shape of the refusal.
      log("[api] refused", { route: name, error: decision.refusal.error });
      return json({ error: decision.refusal.error }, decision.refusal.status);
    }

    try {
      const res = await handler(req);
      // The handler's own response, with CORS ensured. Its headers win on a
      // conflict for everything else.
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    } catch (e) {
      // A handler that throws past its own guards is a 500 here, exactly as it
      // would be on the edge runtime — and the stack goes to the logs, never
      // into the response.
      log("[api] handler threw", { route: name, error: String(e).slice(0, 500) });
      return json({ error: "internal_error", route: name }, 500);
    }
  };
}

export interface MountedApi {
  routes: RailwayServedFunction[];
  handle: (req: Request) => Promise<Response | null>;
}

/**
 * Load the configured routes and return the handler that serves them.
 *
 * Returns null when no routes are configured, so a worker-only process starts
 * exactly as it did before this file existed.
 */
export async function mountApi(
  env: EnvRead, log?: (msg: string, meta?: unknown) => void,
): Promise<MountedApi | null> {
  const routes = routesToMount(env);
  if (routes.length === 0) return null;
  const handlers = await loadHandlers(routes);
  const jwks = createJwksSource(env("SUPABASE_URL"));
  log?.("[api] mounted", { routes, paths: routes.map(apiPathFor) });
  return { routes, handle: createApiHandler({ handlers, env, log, jwks }) };
}
