// THE DOOR SUPABASE USED TO HOLD.
//
// ── WHAT IS LOST BY LEAVING THE EDGE PLATFORM ──────────────────────────────
//
// A Supabase Edge Function sits behind a gateway that, with the default
// `verify_jwt = true`, refuses any request whose `Authorization` bearer is not
// a JWT signed by this project. The handler only ever runs for a caller the
// platform already vouched for; its own `auth.getUser()` + `workspace_members`
// check is the SECOND gate, not the first.
//
// On Railway there is no such gateway. Mounting `handlePilotChat` on a bare
// `Deno.serve` would publish it to the open internet with the first gate simply
// missing — and since the handlers hold a service-role client, "the handler
// checks anyway" is not a margin worth spending.
//
// So this module is that first gate, and it is deliberately the SAME shape as
// the one it replaces: a decision about the bearer alone, taken before any
// body is read, any database is touched and any handler is entered.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// It does not decide who you are or what you may touch. Membership of a
// workspace is decided by `decideWorkspaceAccess` inside the handlers, against
// the database, exactly as before — this file would be the wrong place for it
// and duplicating it here is precisely the "same logic in two places" the
// migration is meant to avoid.
//
// It also never reads `workspace_id` or `user_id` from the body. The handlers
// derive both from the verified bearer; a gate that pre-read them would invent
// a new trust boundary that the edge deployment never had.
//
// ── SIGNATURE VERIFICATION IS REAL WHEN IT CAN BE ──────────────────────────
//
// Supabase signs user tokens one of two ways, and a gate that knows only one
// of them is worse than a gate that knows neither:
//
//   HS256   the legacy shared secret, `SUPABASE_JWT_SECRET`
//   ES256   asymmetric signing keys, published at the project's JWKS endpoint
//   RS256   the same, with an RSA key
//
// The local stack issues ES256. An earlier version of this file verified HS256
// only and treated every other algorithm as a failed signature, which refused
// EVERY REAL USER TOKEN with `invalid_token` while cheerfully continuing to
// refuse the forgeries — a gate that passes its own tests and rejects all of
// production.
//
// So the rule is: refuse a signature only when the material to check it was
// available and the check FAILED. When the key cannot be obtained — no secret
// for an HS256 token, no reachable JWKS for an ES256 one — the verdict is
// `null`, and the handler's `auth.getUser()` (a call to the Auth server, which
// verifies the signature itself) remains the authority, exactly as it is on the
// edge platform. The gate is then worth only what it can actually prove, which
// is the correct amount.

/** `(key) => value` — Deno.env.get, or a test's map. */
export type EnvRead = (key: string) => string | undefined;

/** What a bearer could be, judged on shape alone — never on a trusted claim. */
export type BearerShape =
  | "jwt"               // three dot-separated base64url segments
  | "secret_key"        // sb_secret_… — a service credential
  | "publishable_key"   // sb_publishable_… — the anon key's replacement
  | "absent"
  | "malformed";

export interface GatewayRefusal {
  status: number;
  /** A stable code, safe to log and to assert on. Never echoes the bearer. */
  error: string;
}

export type GatewayDecision =
  | { ok: true; shape: BearerShape }
  | { ok: false; refusal: GatewayRefusal };

/** The bearer token, or null. Never throws, never logs the value. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = m?.[1]?.trim();
  return token ? token : null;
}

const B64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function bearerShape(token: string | null): BearerShape {
  if (!token) return "absent";
  if (token.startsWith("sb_secret_") && token.length > 12) return "secret_key";
  if (token.startsWith("sb_publishable_") && token.length > 17) return "publishable_key";
  const parts = token.split(".");
  if (parts.length === 3 && parts.every((p) => p.length > 0 && B64URL_SEGMENT.test(p))) return "jwt";
  return "malformed";
}

/** base64url → bytes, without throwing on padding. */
function b64urlBytes(s: string): Uint8Array | null {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A JWT's claims, decoded WITHOUT verification — for expiry only, never for trust. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const bytes = b64urlBytes(parts[1]);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** True when `exp` is in the past. An absent `exp` is NOT treated as expired. */
export function jwtExpired(token: string, nowMs: number): boolean {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === "number" && exp * 1000 <= nowMs;
}

/**
 * Verify an HS256 signature against the project's JWT secret.
 *
 * Returns false for every other algorithm, including `none` — a token that
 * declares `alg: "none"` is the textbook forgery and must not be reachable by
 * treating "no signature to check" as "signature checks out".
 */
export async function verifyHs256(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const headerBytes = b64urlBytes(parts[0]);
  if (!headerBytes) return false;
  let alg: unknown;
  try {
    alg = JSON.parse(new TextDecoder().decode(headerBytes))?.alg;
  } catch {
    return false;
  }
  if (alg !== "HS256") return false;
  const sig = b64urlBytes(parts[2]);
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC", key, sig as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

/** A JWT's `alg` and `kid`, read from the header. Untrusted — used only to pick a key. */
export function jwtHeader(token: string): { alg: string | null; kid: string | null } {
  const bytes = b64urlBytes(token.split(".")[0] ?? "");
  if (!bytes) return { alg: null, kid: null };
  try {
    const h = JSON.parse(new TextDecoder().decode(bytes));
    return {
      alg: typeof h?.alg === "string" ? h.alg : null,
      kid: typeof h?.kid === "string" ? h.kid : null,
    };
  } catch {
    return { alg: null, kid: null };
  }
}

/** A JSON Web Key, as the project's JWKS endpoint publishes it. */
export interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  crv?: string;
  [k: string]: unknown;
}

const JWKS_PATH = "/auth/v1/.well-known/jwks.json";
/** How long a fetched key set is reused. Keys rotate rarely; a miss refetches. */
export const JWKS_CACHE_TTL_MS = 10 * 60_000;

/** The algorithms this gate can check for itself. Anything else is deferred, never refused. */
export const VERIFIABLE_ALGS = new Set(["HS256", "ES256", "RS256"]);

function algParams(alg: string): { importAlg: AlgorithmIdentifier | EcKeyImportParams | RsaHashedImportParams; verifyAlg: AlgorithmIdentifier | EcdsaParams } | null {
  if (alg === "ES256") {
    return {
      importAlg: { name: "ECDSA", namedCurve: "P-256" },
      verifyAlg: { name: "ECDSA", hash: "SHA-256" },
    };
  }
  if (alg === "RS256") {
    return {
      importAlg: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verifyAlg: { name: "RSASSA-PKCS1-v1_5" },
    };
  }
  return null;
}

/**
 * Verify an asymmetric JWT against a published key set.
 *
 * The key is selected by `kid` when the token names one, because a key set
 * mid-rotation holds more than one and trying them all would accept a token
 * signed by a key the header says did not sign it.
 */
export async function verifyWithJwks(token: string, keys: readonly Jwk[]): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const { alg, kid } = jwtHeader(token);
  if (!alg) return false;
  const params = algParams(alg);
  if (!params) return false;
  const sig = b64urlBytes(parts[2]);
  if (!sig) return false;
  const candidates = keys.filter((k) =>
    (!kid || !k.kid || k.kid === kid) && (!k.alg || k.alg === alg)
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey(
        "jwk", jwk as JsonWebKey, params.importAlg as AlgorithmIdentifier, false, ["verify"],
      );
      if (await crypto.subtle.verify(params.verifyAlg as AlgorithmIdentifier, key, sig as BufferSource, signed)) {
        return true;
      }
    } catch {
      // A key this runtime cannot import is not a verdict on the token.
      continue;
    }
  }
  return false;
}

export interface JwksSource {
  /** Keys for this project, or null when they cannot be obtained. */
  keys: (kid: string | null) => Promise<readonly Jwk[] | null>;
}

/**
 * The project's key set, fetched once and reused.
 *
 * A `kid` the cache does not hold triggers exactly one refetch — that is a key
 * rotation, and waiting out the TTL would refuse every new token for ten
 * minutes. A fetch that fails returns null, which DEFERS to the handler rather
 * than refusing: an unreachable JWKS endpoint must not take the API down.
 */
export function createJwksSource(
  supabaseUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
  ttlMs = JWKS_CACHE_TTL_MS,
): JwksSource {
  const base = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  let cached: { keys: Jwk[]; at: number } | null = null;

  const fetchKeys = async (): Promise<Jwk[] | null> => {
    if (!base) return null;
    try {
      const res = await fetchImpl(`${base}${JWKS_PATH}`, { method: "GET" });
      if (!res.ok) return null;
      const body = await res.json() as { keys?: unknown };
      if (!Array.isArray(body?.keys)) return null;
      return body.keys as Jwk[];
    } catch {
      return null;
    }
  };

  return {
    keys: async (kid) => {
      const fresh = cached && now() - cached.at < ttlMs;
      if (fresh && (!kid || cached!.keys.some((k) => k.kid === kid))) return cached!.keys;
      const keys = await fetchKeys();
      if (keys) {
        cached = { keys, at: now() };
        return keys;
      }
      // A failed refetch still answers with what is cached, if anything: a
      // momentary network fault should not start refusing valid tokens.
      return cached?.keys ?? null;
    },
  };
}

export interface GatewayInput {
  /** The shape of the presented bearer. */
  shape: BearerShape;
  /**
   * Signature + expiry verdict, when the secret was available:
   *   true  — verified
   *   false — presented but invalid or expired
   *   null  — not checked here (no secret); the handler's getUser decides
   */
  signature: boolean | null;
}

/**
 * The gate's decision. Pure, so every branch is a unit test rather than a
 * deployment you have to attack to be sure of.
 *
 * FAIL-CLOSED IN EVERY BRANCH: the only `ok` outcomes are a credential-shaped
 * bearer whose signature either verified or was deliberately deferred to the
 * handler. There is no path where an absent or malformed bearer proceeds.
 */
export function decideGateway(i: GatewayInput): GatewayDecision {
  if (i.shape === "absent") return { ok: false, refusal: { status: 401, error: "missing_authorization" } };
  if (i.shape === "malformed") return { ok: false, refusal: { status: 401, error: "malformed_authorization" } };
  // Opaque keys carry no signature of their own; Supabase validates them, and
  // the handlers put a service credential to the Auth admin API before trusting
  // it (see serviceRoleAuth.ts). Shape is all this gate can add.
  if (i.shape !== "jwt") return { ok: true, shape: i.shape };
  if (i.signature === false) return { ok: false, refusal: { status: 401, error: "invalid_token" } };
  return { ok: true, shape: i.shape };
}

/**
 * Apply the gate to a real request.
 *
 * `OPTIONS` never reaches here — the server answers the preflight before
 * authenticating, because a browser sends no credentials on a preflight and
 * refusing it would break CORS for correctly-authenticated callers.
 */
export async function checkRequest(
  req: Request, env: EnvRead, now: () => number = Date.now, jwks?: JwksSource,
): Promise<GatewayDecision> {
  const token = parseBearer(req.headers.get("Authorization"));
  const shape = bearerShape(token);
  return decideGateway({ shape, signature: await verifySignature(token, shape, env, now, jwks) });
}

/**
 * The signature verdict: true, false, or `null` for "not checkable here".
 *
 * EXPIRY IS CHECKED FOR EVERY JWT, whatever the algorithm — it needs no key,
 * and an expired token is a refusal the handler would also make.
 */
export async function verifySignature(
  token: string | null, shape: BearerShape, env: EnvRead,
  now: () => number = Date.now, jwks?: JwksSource,
): Promise<boolean | null> {
  if (shape !== "jwt" || !token) return null;
  if (jwtExpired(token, now())) return false;
  const { alg, kid } = jwtHeader(token);
  if (!alg || !VERIFIABLE_ALGS.has(alg)) {
    // An algorithm this gate does not implement is DEFERRED, not refused. The
    // Auth server knows what it signs with; this file must not out-guess it.
    return null;
  }
  if (alg === "HS256") {
    const secret = (env("SUPABASE_JWT_SECRET") ?? "").trim();
    return secret ? await verifyHs256(token, secret) : null;
  }
  const keys = await jwks?.keys(kid);
  return keys ? await verifyWithJwks(token, keys) : null;
}
