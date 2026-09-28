// WHO IS CALLING — one real user, verified by Supabase Auth.
//
// The Supabase gateway accepts the PUBLIC anon key as a valid JWT, so "the
// request reached the function" proves nothing about the caller. A user
// endpoint must ask Auth who the bearer is; the anon key, a service key and
// junk are all refused here, before the handler reads its body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthDeps {
  env: (k: string) => string | undefined;
  fetch: typeof fetch;
}

export const defaultAuthDeps: AuthDeps = {
  env: (k) => Deno.env.get(k),
  fetch: (input, init) => fetch(input, init),
};

export type UserAuth = { ok: true; userId: string; token: string } | { ok: false; status: 401 | 500; error: string };

export function bearerOf(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export async function authenticateUser(req: Request, deps: AuthDeps = defaultAuthDeps): Promise<UserAuth> {
  const url = deps.env("SUPABASE_URL");
  const anon = deps.env("SUPABASE_ANON_KEY");
  if (!url || !anon) return { ok: false, status: 500, error: "server_misconfigured" };
  const token = bearerOf(req);
  const service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || token === anon || (service && token === service)) return { ok: false, status: 401, error: "unauthorized" };
  const client = createClient(url, anon, {
    global: { fetch: deps.fetch, headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data, error } = await client.auth.getUser(token);
    const id = data?.user?.id ?? null;
    if (error || !id) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, userId: id, token };
  } catch {
    return { ok: false, status: 401, error: "unauthorized" };
  }
}
