// WHO MAY ACT AS THE SERVICE — verified with the authority, not string-compared.
//
// `run-agent` and `enqueue-lead-mission` trusted a caller as the service only
// when its bearer was the SAME STRING as their own SUPABASE_SERVICE_ROLE_KEY.
// A project can hold more than one valid service credential: production's edge
// runtime is injected with one service_role JWT, while the project's API-keys
// endpoint — and therefore the Railway worker — carries another. Both are real
// service credentials for the same project. The string comparison refused one of
// them, and every Lead V2 continuation dispatch in run 4250f181 ended in
// `401 unauthorized`.
//
// NOT A LOOSER CHECK. A bearer that is not our own key is put to the only
// authority that can answer: Supabase Auth's admin API, which accepts nothing
// but a service credential for THIS project. The anon key, a user JWT, another
// project's key and junk are refused exactly as before — and a bearer that does
// not even claim to be a service credential never causes a network call.
//
// Pure except for the injected `fetch`.

export interface ServiceAuthDeps {
  /** This function's own `SUPABASE_SERVICE_ROLE_KEY`. */
  envServiceKey: string | null | undefined;
  /** This project's URL — the only Auth server that may vouch for a key. */
  supabaseUrl: string | null | undefined;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

/** A verified answer is reused briefly; a refusal on 401/403 too. */
export const SERVICE_AUTH_CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { ok: boolean; at: number }>();

/** Tests only. */
export function resetServiceAuthCache(): void {
  cache.clear();
}

/** The `role` claim of a JWT, read WITHOUT trusting it — only to decide whether asking is worthwhile. */
export function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b + "=".repeat((4 - (b.length % 4)) % 4)));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Could this be a service credential at all? Everything else is refused offline. */
export function looksLikeServiceCredential(token: string): boolean {
  if (token.startsWith("sb_secret_")) return true;
  return jwtRole(token) === "service_role";
}

async function fingerprint(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Is this bearer a service credential for this project?
 *
 * 1. Exactly our own key — yes, no network.
 * 2. Does not claim to be a service credential — no, no network.
 * 3. Claims to be one — ask Supabase Auth's admin endpoint; only 200 is yes.
 */
export async function isServiceRoleBearer(
  bearer: string | null | undefined,
  deps: ServiceAuthDeps,
): Promise<boolean> {
  const token = (bearer ?? "").trim();
  if (!token) return false;
  if (deps.envServiceKey && token === deps.envServiceKey) return true;
  if (!looksLikeServiceCredential(token) || !deps.supabaseUrl) return false;

  const key = await fingerprint(token);
  const now = (deps.now ?? Date.now)();
  const hit = cache.get(key);
  if (hit && now - hit.at < SERVICE_AUTH_CACHE_TTL_MS) return hit.ok;

  let status = 0;
  try {
    const res = await deps.fetch(
      `${deps.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users?page=1&per_page=1`,
      { method: "GET", headers: { apikey: token, Authorization: `Bearer ${token}` } },
    );
    status = res.status;
    try { await res.body?.cancel(); } catch { /* nothing to release */ }
  } catch {
    // A transport failure is not a verdict about the key: refuse now, ask again next time.
    return false;
  }
  const ok = status === 200;
  if (ok || status === 401 || status === 403) cache.set(key, { ok, at: now });
  return ok;
}
