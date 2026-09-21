// THE DOOR SUPABASE USED TO HOLD — every branch of it, as a unit test.
//
// Leaving the edge platform removes a gateway that refused, for free, any
// request whose bearer was not a JWT signed by this project. The handlers hold
// a service-role client, so "the handler checks anyway" is not a margin worth
// spending; this gate replaces the one that was lost, and these cases are the
// only evidence that it actually refuses what the old one refused.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bearerShape, checkRequest, decideGateway, jwtExpired, parseBearer, verifyHs256,
} from "../../../worker/api/gateway.ts";

const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const b64url = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function sign(payload: Record<string, unknown>, secret = SECRET, alg = "HS256") {
  const head = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${head}.${body}.${sigB64}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;
const req = (auth?: string) =>
  new Request("https://api.test/api/pilot-chat", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });

// ── shape ───────────────────────────────────────────────────────────────────

Deno.test("the bearer is read from the header, and nothing else is", () => {
  assertEquals(parseBearer("Bearer abc.def.ghi"), "abc.def.ghi");
  assertEquals(parseBearer("bearer abc.def.ghi"), "abc.def.ghi", "case-insensitive, as HTTP is");
  assertEquals(parseBearer("  Bearer   tok  "), "tok");
  for (const h of [null, undefined, "", "Basic abc", "abc.def.ghi", "Bearer", "Bearer   "]) {
    assertEquals(parseBearer(h), null, `refused: ${JSON.stringify(h)}`);
  }
});

Deno.test("shape recognises the three real credential forms and rejects the rest", () => {
  assertEquals(bearerShape("a.b.c"), "jwt");
  assertEquals(bearerShape("sb_secret_abcdefghij"), "secret_key");
  assertEquals(bearerShape("sb_publishable_abcdefghij"), "publishable_key");
  assertEquals(bearerShape(null), "absent");
  for (const t of ["", "junk", "a.b", "a.b.c.d", "a..c", "has spaces.b.c", "a.b.c!"]) {
    assertEquals(bearerShape(t || null), t ? "malformed" : "absent", `malformed: ${JSON.stringify(t)}`);
  }
});

// ── the decision ────────────────────────────────────────────────────────────

Deno.test("FAIL-CLOSED: no bearer and no shape never proceed", () => {
  assertEquals(decideGateway({ shape: "absent", signature: null }),
    { ok: false, refusal: { status: 401, error: "missing_authorization" } });
  assertEquals(decideGateway({ shape: "malformed", signature: true }),
    { ok: false, refusal: { status: 401, error: "malformed_authorization" } },
    "a 'verified' signature on something that is not a JWT cannot rescue it");
});

Deno.test("A JWT THAT FAILED VERIFICATION IS REFUSED — this is the forged-token case", () => {
  assertEquals(decideGateway({ shape: "jwt", signature: false }),
    { ok: false, refusal: { status: 401, error: "invalid_token" } });
});

Deno.test("signature `null` defers to the handler, and only for a well-formed credential", () => {
  // No JWT secret configured: the handler's own getUser is the authority, and
  // it verifies the signature against the Auth server.
  assert(decideGateway({ shape: "jwt", signature: null }).ok);
  assert(decideGateway({ shape: "secret_key", signature: null }).ok);
  assert(decideGateway({ shape: "publishable_key", signature: null }).ok);
  assertFalse(decideGateway({ shape: "absent", signature: null }).ok);
});

// ── the signature itself ────────────────────────────────────────────────────

Deno.test("HS256 verification accepts this project's tokens and refuses everything else", async () => {
  const good = await sign({ sub: "u1", exp: future() });
  assert(await verifyHs256(good, SECRET));
  assertFalse(await verifyHs256(good, "a-different-secret-of-sufficient-length!!"),
    "another project's secret must not verify");
  assertFalse(await verifyHs256(good.slice(0, -2) + "xy", SECRET), "a tampered signature");
  const tamperedPayload = await sign({ sub: "u1", exp: future() });
  const parts = tamperedPayload.split(".");
  const forged = `${parts[0]}.${b64url(JSON.stringify({ sub: "admin", exp: future() }))}.${parts[2]}`;
  assertFalse(await verifyHs256(forged, SECRET), "a rewritten payload invalidates the signature");
});

Deno.test("`alg: none` is refused — the textbook forgery", async () => {
  const head = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = b64url(JSON.stringify({ sub: "admin", role: "service_role", exp: future() }));
  assertFalse(await verifyHs256(`${head}.${body}.`, SECRET));
  assertFalse(await verifyHs256(`${head}.${body}.anything`, SECRET));
  // And an RS256 header is not quietly verified with the HMAC secret either.
  const rs = await sign({ sub: "u" }, SECRET, "RS256");
  assertFalse(await verifyHs256(rs, SECRET));
});

Deno.test("expiry is read from the token, and an absent exp is not treated as expired", () => {
  const now = Date.now();
  assert(jwtExpired(`x.${b64url(JSON.stringify({ exp: past() }))}.y`, now));
  assertFalse(jwtExpired(`x.${b64url(JSON.stringify({ exp: future() }))}.y`, now));
  assertFalse(jwtExpired(`x.${b64url(JSON.stringify({ sub: "u" }))}.y`, now),
    "no exp: the handler's getUser decides, as it does on the edge");
  assertFalse(jwtExpired("not-a-jwt", now));
});

// ── end to end over a real Request ──────────────────────────────────────────

Deno.test("WITH THE SECRET: a valid token passes, an expired or foreign one does not", async () => {
  const env = (k: string) => (k === "SUPABASE_JWT_SECRET" ? SECRET : undefined);
  const valid = await sign({ sub: "u1", exp: future() });
  assert((await checkRequest(req(`Bearer ${valid}`), env)).ok);

  const expired = await sign({ sub: "u1", exp: past() });
  const e = await checkRequest(req(`Bearer ${expired}`), env);
  assertEquals(e.ok === false && e.refusal.error, "invalid_token");

  const foreign = await sign({ sub: "u1", exp: future() }, "another-projects-secret-long-enough!!!");
  const f = await checkRequest(req(`Bearer ${foreign}`), env);
  assertEquals(f.ok === false && f.refusal.error, "invalid_token");

  const none = await checkRequest(req(), env);
  assertEquals(none.ok === false && none.refusal.error, "missing_authorization");
});

Deno.test("WITHOUT THE SECRET: shape is still enforced, signature is deferred", async () => {
  const env = () => undefined;
  const foreign = await sign({ sub: "u1", exp: future() }, "another-projects-secret-long-enough!!!");
  assert((await checkRequest(req(`Bearer ${foreign}`), env)).ok,
    "deferred to the handler's getUser, which refuses it against the Auth server");
  const junk = await checkRequest(req("Bearer not-a-credential"), env);
  assertEquals(junk.ok === false && junk.refusal.error, "malformed_authorization");
  const none = await checkRequest(req(), env);
  assertEquals(none.ok === false && none.refusal.error, "missing_authorization");
});

// ══ ASYMMETRIC TOKENS — THE ALGORITHM SUPABASE ACTUALLY ISSUES ═════════════
//
// The first version of this gate verified HS256 and treated everything else as
// a FAILED signature. The local stack issues ES256, so it refused every real
// user token with `invalid_token` while still refusing the forgeries: a gate
// that passed all of its own tests and rejected all of production. These cases
// exist so that cannot happen twice.

import {
  createJwksSource, type Jwk, jwtHeader, verifySignature, verifyWithJwks,
} from "../../../worker/api/gateway.ts";

async function es256Keypair() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey) as Jwk;
  return { pair, jwk: { ...jwk, kid: "key-1", alg: "ES256" } as Jwk };
}

async function signEs256(payload: Record<string, unknown>, key: CryptoKey, kid = "key-1") {
  const head = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`),
  );
  const s = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${head}.${body}.${s}`;
}

Deno.test("the header is read for `alg` and `kid`, and an unreadable one decides nothing", () => {
  assertEquals(jwtHeader(`${b64url(JSON.stringify({ alg: "ES256", kid: "k1" }))}.x.y`),
    { alg: "ES256", kid: "k1" });
  assertEquals(jwtHeader("%%%.x.y"), { alg: null, kid: null });
  assertEquals(jwtHeader(`${b64url("not json")}.x.y`), { alg: null, kid: null });
});

Deno.test("ES256: a real token verifies against the published key set", async () => {
  const { pair, jwk } = await es256Keypair();
  const token = await signEs256({ sub: "u1", exp: future() }, pair.privateKey);
  assert(await verifyWithJwks(token, [jwk]), "THE REGRESSION: this used to be refused");
});

Deno.test("ES256: a forgery with the right `kid` is still refused", async () => {
  const { pair, jwk } = await es256Keypair();
  const good = await signEs256({ sub: "u1", exp: future() }, pair.privateKey);
  assertFalse(await verifyWithJwks(`${good.split(".").slice(0, 2).join(".")}.ZmFrZQ`, [jwk]));
  // A token signed by a DIFFERENT key, presented with the trusted kid.
  const other = await es256Keypair();
  const foreign = await signEs256({ sub: "admin", exp: future() }, other.pair.privateKey);
  assertFalse(await verifyWithJwks(foreign, [jwk]), "another project's key must not verify");
  // A rewritten payload under a real signature.
  const parts = good.split(".");
  const rewritten = `${parts[0]}.${b64url(JSON.stringify({ sub: "admin", exp: future() }))}.${parts[2]}`;
  assertFalse(await verifyWithJwks(rewritten, [jwk]));
});

Deno.test("a `kid` that names a different key is not verified by trying them all", async () => {
  const a = await es256Keypair();
  const b = await es256Keypair();
  const token = await signEs256({ sub: "u1", exp: future() }, b.pair.privateKey, "key-1");
  // `a.jwk` claims kid key-1 but did not sign it; b's key is published as key-2.
  assertFalse(await verifyWithJwks(token, [a.jwk, { ...b.jwk, kid: "key-2" }]),
    "the header names key-1, so key-2 must not be tried");
});

Deno.test("DEFERRED, NOT REFUSED: an algorithm or key this gate cannot check", async () => {
  const noSecret = () => undefined;
  const { pair } = await es256Keypair();
  const es = await signEs256({ sub: "u1", exp: future() }, pair.privateKey);

  // No JWKS source at all — an unreachable endpoint must not refuse everyone.
  assertEquals(await verifySignature(es, "jwt", noSecret), null);
  // A source that cannot produce keys: same answer.
  assertEquals(await verifySignature(es, "jwt", noSecret, Date.now,
    { keys: () => Promise.resolve(null) }), null);
  // HS256 with no secret configured.
  const hs = await sign({ sub: "u1", exp: future() });
  assertEquals(await verifySignature(hs, "jwt", noSecret), null);
  // An algorithm this file does not implement is not a verdict on the token.
  const odd = `${b64url(JSON.stringify({ alg: "EdDSA" }))}.${b64url(JSON.stringify({ exp: future() }))}.sig`;
  assertEquals(await verifySignature(odd, "jwt", noSecret), null);

  // And every one of those still PASSES the gate, because the handler's
  // getUser is the authority — which is exactly what the edge platform does.
  for (const v of [null]) assert(decideGateway({ shape: "jwt", signature: v }).ok);
});

Deno.test("EXPIRY NEEDS NO KEY: an expired token is refused whatever it was signed with", async () => {
  const { pair } = await es256Keypair();
  const stale = await signEs256({ sub: "u1", exp: past() }, pair.privateKey);
  assertEquals(await verifySignature(stale, "jwt", () => undefined), false,
    "no JWKS, no secret — and still a refusal, because the token says so itself");
});

Deno.test("ES256 end to end: verified through a key source, forgery refused", async () => {
  const { pair, jwk } = await es256Keypair();
  const source = { keys: () => Promise.resolve([jwk]) };
  const token = await signEs256({ sub: "u1", exp: future() }, pair.privateKey);
  assertEquals(await verifySignature(token, "jwt", () => undefined, Date.now, source), true);
  const forged = `${token.split(".").slice(0, 2).join(".")}.ZmFrZQ`;
  assertEquals(await verifySignature(forged, "jwt", () => undefined, Date.now, source), false);
});

// ── the key source ──────────────────────────────────────────────────────────

function jwksServer(keys: Jwk[], fail = false) {
  let fetches = 0;
  const fetchImpl = ((url: string | URL | Request) => {
    fetches++;
    assert(String(url).endsWith("/auth/v1/.well-known/jwks.json"), String(url));
    return Promise.resolve(fail
      ? new Response("nope", { status: 500 })
      : new Response(JSON.stringify({ keys }), { status: 200 }));
  }) as unknown as typeof fetch;
  return { fetchImpl, count: () => fetches };
}

Deno.test("the key set is fetched once and reused", async () => {
  const { jwk } = await es256Keypair();
  const srv = jwksServer([jwk]);
  let t = 0;
  const src = createJwksSource("https://proj.supabase.co/", srv.fetchImpl, () => t, 1000);
  for (let i = 0; i < 5; i++) await src.keys("key-1");
  assertEquals(srv.count(), 1, "five requests, one fetch");
  t = 2000;
  await src.keys("key-1");
  assertEquals(srv.count(), 2, "and it refreshes after the TTL");
});

Deno.test("A ROTATION REFETCHES IMMEDIATELY — waiting out the TTL would refuse new tokens", async () => {
  const { jwk } = await es256Keypair();
  const srv = jwksServer([jwk]);
  const src = createJwksSource("https://proj.supabase.co", srv.fetchImpl, () => 0);
  await src.keys("key-1");
  assertEquals(srv.count(), 1);
  await src.keys("key-2");
  assertEquals(srv.count(), 2, "an unknown kid is a rotation, not a cache hit");
});

Deno.test("AN UNREACHABLE JWKS ENDPOINT DEFERS — it does not take the API down", async () => {
  const srv = jwksServer([], true);
  const src = createJwksSource("https://proj.supabase.co", srv.fetchImpl, () => 0);
  assertEquals(await src.keys("key-1"), null, "null means 'ask the handler', not 'refuse'");
  assertEquals(await createJwksSource(undefined, srv.fetchImpl).keys(null), null);
});

Deno.test("a momentary fault keeps serving the keys already held", async () => {
  const { jwk } = await es256Keypair();
  let broken = false;
  const fetchImpl = (() => Promise.resolve(broken
    ? new Response("nope", { status: 500 })
    : new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }))) as unknown as typeof fetch;
  let t = 0;
  const src = createJwksSource("https://proj.supabase.co", fetchImpl, () => t, 1000);
  assertEquals((await src.keys("key-1"))?.length, 1);
  broken = true;
  t = 5000;
  assertEquals((await src.keys("key-1"))?.length, 1,
    "a network blip must not start refusing tokens that were valid a second ago");
});
