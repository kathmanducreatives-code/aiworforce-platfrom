// WHERE EACH FUNCTION LIVES — ONE TABLE, READ BY EVERY CALLER.
//
// Until now every hand-off hard-coded its destination:
//
//     fetch(`${SUPABASE_URL}/functions/v1/run-agent`, …)      // orchestrate
//     fetch(`${SUPABASE_URL}/functions/v1/run-agent`, …)      // run-agent's chain
//     fetch(`${SUPABASE_URL}/functions/v1/orchestrate`, …)    // pilot-chat
//
// Nine such literals span five files. Moving a function to the Railway API by
// editing them would mean nine independent chances to miss one — and a missed
// one is silent: the call still succeeds, against the OLD deployment, so two
// copies of the same handler run the same mission from different hosts.
//
// So the destination becomes a lookup instead of a literal. Every caller asks
// this module, and this module reads the environment:
//
//   AGENTORY_API_URL        the Railway API's base, e.g. https://api.example.app
//   AGENTORY_API_FUNCTIONS  which functions it currently serves: a comma list
//                           of names, or `*` for all of them
//
// ── WHY TWO VARIABLES AND NOT ONE ──────────────────────────────────────────
//
// Because the cutover is per-function and must be reversible in seconds. With
// one variable, pointing at Railway would move everything at once and the only
// way back would be a redeploy. With two, `AGENTORY_API_FUNCTIONS=pilot-chat`
// moves exactly one route while the rest stay on Supabase, and emptying the
// variable moves it straight back — no build, no deploy, no code change.
//
// ── AND WHY THE DEFAULT IS "NOTHING MOVED" ─────────────────────────────────
//
// Both unset is today's behaviour, exactly: every URL this returns is the
// Supabase one it replaced. A deployment that never sets these variables
// cannot be changed by this module's existence.

/**
 * The functions the Railway API is able to serve.
 *
 * A name outside this set is NEVER routed to Railway, whatever the environment
 * says — `AGENTORY_API_FUNCTIONS=daily-brief` would otherwise produce a URL
 * that 404s, turning a configuration typo into a broken hand-off. The router
 * in `worker/api/routes.ts` is built from this same list, so the two cannot
 * drift: a function is routable here only if something answers it there.
 */
export const RAILWAY_SERVED_FUNCTIONS = [
  "pilot-chat",
  "run-agent",
  "orchestrate",
  "enqueue-lead-mission",
] as const;

export type RailwayServedFunction = typeof RAILWAY_SERVED_FUNCTIONS[number];

const SERVED = new Set<string>(RAILWAY_SERVED_FUNCTIONS);

/** `(key) => value` — Deno.env.get, or a test's map. */
export type EnvRead = (key: string) => string | undefined;

/** The path the Railway API serves a function on. One place, so both ends agree. */
export function apiPathFor(name: string): string {
  return `/api/${name}`;
}

/**
 * Which functions the environment currently sends to Railway.
 *
 * Unknown names are dropped rather than honoured (see RAILWAY_SERVED_FUNCTIONS),
 * and an absent base URL means nothing is migrated no matter what the list says
 * — there would be nowhere to send it.
 */
export function migratedFunctions(env: EnvRead): Set<string> {
  const base = (env("AGENTORY_API_URL") ?? "").trim();
  if (!base) return new Set();
  const raw = (env("AGENTORY_API_FUNCTIONS") ?? "").trim();
  if (!raw) return new Set();
  if (raw === "*") return new Set(SERVED);
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name && SERVED.has(name)) out.add(name);
  }
  return out;
}

/** True when this deployment sends `name` to the Railway API. */
export function isMigrated(name: string, env: EnvRead): boolean {
  return migratedFunctions(env).has(name);
}

/**
 * The absolute URL to invoke `name` on, for THIS deployment.
 *
 * Throws only when neither host is configured — a caller with no SUPABASE_URL
 * and no API URL has no destination at all, and a silent relative URL would
 * fail much later and much less clearly.
 */
export function functionUrl(name: string, env: EnvRead): string {
  const base = (env("AGENTORY_API_URL") ?? "").trim().replace(/\/+$/, "");
  if (base && isMigrated(name, env)) return `${base}${apiPathFor(name)}`;
  const supabase = (env("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!supabase) {
    throw new Error(
      `functionUrl(${name}): neither SUPABASE_URL nor a migrated AGENTORY_API_URL is configured`,
    );
  }
  return `${supabase}/functions/v1/${name}`;
}

/**
 * The base every non-migrated function is reached through.
 *
 * `run-agent` passes this to its continuation dispatcher, which appends its own
 * function name; keeping it here means that path moves with the same switch.
 */
export function functionsBaseUrl(env: EnvRead): string | null {
  const supabase = (env("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  return supabase ? `${supabase}/functions/v1` : null;
}
