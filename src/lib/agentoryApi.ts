// ONE TRANSPORT, TWO DESTINATIONS.
//
// Every backend call in this app goes through `supabase.functions.invoke`,
// which hard-codes the destination: the Supabase function gateway for this
// project. As functions move to the Railway API, the call sites must be able to
// reach either host — and must not each learn how.
//
// So the call sites keep calling ONE function, and this module decides where it
// goes. The return shape is `supabase.functions.invoke`'s own `{ data, error }`
// including `error.context` as a real `Response`, because that is what
// `readErrorBody` unwraps to turn a 403 into a sentence the user can act on.
// A transport that returned a tidier shape would silently break that.
//
// ── CONFIGURATION ──────────────────────────────────────────────────────────
//
//   VITE_AGENTORY_API_URL        the Railway API base, e.g. https://api.example
//   VITE_AGENTORY_API_FUNCTIONS  which functions go there: a comma list, or `*`
//
// Both unset — the default, and what a production build has today — means every
// call goes to Supabase exactly as before. The two variables mirror the
// server-side `AGENTORY_API_URL` / `AGENTORY_API_FUNCTIONS` deliberately: a
// cutover is the same switch on both sides, and a rollback is emptying it.
//
// ── WHAT THE BROWSER SENDS ─────────────────────────────────────────────────
//
// The signed-in user's access token, and nothing else. No service role, no
// workspace claim, no user id: the server derives all three from this token
// (see workspaceAccessGuard.ts). A request with no session falls back to the
// publishable key, which reaches the server and is refused there — the same
// outcome `functions.invoke` produces today, decided in the same place.

// ── WHY THE SUPABASE CLIENT IS IMPORTED LAZILY ─────────────────────────────
//
// A top-level `import { supabase } from '@/integrations/supabase/client'` makes
// this module unimportable under Deno, because the `@/` alias does not resolve
// there — the exact trap `continuationErrors.ts` was split out to escape. The
// routing decision and the Railway request are then untestable, which is
// backwards: they are the new code, and the part a cutover depends on.
//
// So the client is loaded inside the branch that needs it. The Railway path
// never touches it, and `tests/frontend/agentoryApi.test.ts` drives that path
// end to end with an injected `fetch`.
async function supabaseClient() {
  const mod = await import('@/integrations/supabase/client');
  return mod.supabase;
}

/** The functions the Railway API is able to serve. Mirrors functionEndpoints.ts. */
export const RAILWAY_SERVED_FUNCTIONS = [
  'pilot-chat',
  'run-agent',
  'orchestrate',
  'enqueue-lead-mission',
] as const;

export type ServedFunction = typeof RAILWAY_SERVED_FUNCTIONS[number];

export interface TransportConfig {
  baseUrl?: string;
  functions?: string;
}

export type Destination =
  | { transport: 'supabase'; name: string }
  | { transport: 'railway'; name: string; url: string };

/**
 * Where a call to `name` goes, given this build's configuration.
 *
 * Pure, and exported, so the routing decision is a unit test rather than
 * something you discover by watching the network tab. Unknown names are never
 * sent to Railway however the variables are set — the API would 404 them, and a
 * typo in an environment variable should not be able to break a call site.
 */
export function resolveDestination(name: string, config: TransportConfig): Destination {
  const base = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
  const raw = (config.functions ?? '').trim();
  if (!base || !raw) return { transport: 'supabase', name };
  if (!(RAILWAY_SERVED_FUNCTIONS as readonly string[]).includes(name)) {
    return { transport: 'supabase', name };
  }
  const migrated = raw === '*'
    ? new Set<string>(RAILWAY_SERVED_FUNCTIONS)
    : new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return migrated.has(name)
    ? { transport: 'railway', name, url: `${base}/api/${name}` }
    : { transport: 'supabase', name };
}

/** This build's configuration, read once from Vite's env. */
export function currentConfig(): TransportConfig {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    baseUrl: env.VITE_AGENTORY_API_URL,
    functions: env.VITE_AGENTORY_API_FUNCTIONS,
  };
}

/** `functions.invoke`'s result shape, which every call site already handles. */
export interface InvokeResult<T> {
  data: T | null;
  error: (Error & { context?: Response }) | null;
}

function httpError(res: Response): Error & { context: Response } {
  // THE SAME MESSAGE `functions.invoke` PRODUCES, so a call site that shows
  // `error.message` reads identically on both transports — and `context` is the
  // unread Response, which is what `readErrorBody` needs to do better than the
  // message.
  const e = new Error('Edge Function returned a non-2xx status code') as Error & { context: Response };
  e.context = res;
  return e;
}

export interface InvokeDeps {
  config?: TransportConfig;
  /** The bearer to send on the Railway path. Injected for tests. */
  accessToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

async function sessionToken(): Promise<string | null> {
  try {
    const { data } = await (await supabaseClient()).auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Call a backend function, wherever it currently lives.
 *
 * NEVER THROWS for an HTTP failure — it returns `{ data: null, error }`, as
 * `functions.invoke` does, because every call site is written against that
 * contract. A transport failure (DNS, offline) becomes an `error` with no
 * `context`, which is also what the Supabase client does.
 */
export async function invokeFunction<T = unknown>(
  name: string, body: unknown, deps: InvokeDeps = {},
): Promise<InvokeResult<T>> {
  const dest = resolveDestination(name, deps.config ?? currentConfig());
  if (dest.transport === 'supabase') {
    const { data, error } = await (await supabaseClient()).functions.invoke(name, { body });
    return { data: (data ?? null) as T | null, error: (error ?? null) as InvokeResult<T>['error'] };
  }

  const doFetch = deps.fetchImpl ?? fetch;
  const token = (await (deps.accessToken ?? sessionToken)())
    // No session: the publishable key travels instead, reaches the server, and
    // is refused there. Never a service credential — that key is not in this
    // bundle and must never be.
    ?? (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SUPABASE_PUBLISHABLE_KEY
    ?? '';

  let res: Response;
  try {
    res = await doFetch(dest.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (e) {
    return { data: null, error: new Error(e instanceof Error ? e.message : 'Failed to send a request') };
  }

  if (!res.ok) return { data: null, error: httpError(res) };
  try {
    return { data: (await res.json()) as T, error: null };
  } catch {
    // A 2xx with an unreadable body is a server bug, reported as an error
    // rather than as `data: null` that a call site would misread as success.
    return { data: null, error: httpError(res) };
  }
}
