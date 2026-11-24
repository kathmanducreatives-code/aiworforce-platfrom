// Workspace provider connections — flags, roles, isolation, and the rule that a
// key never leaves the server. Mocked verifier; ZERO network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleConnections, memoryConnectionStore, verifierFrom, type Verifier } from "../../../../supabase/functions/_shared/discoveryProviders/connections.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { apolloAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apollo.ts";
import { ProviderError } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import { FIXED_NOW, mockFetch, noSleep } from "./fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = "lo_live_SECRET_abcdef123456";

const env = (over: Record<string, string> = {}) => (n: string) => ({
  PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_DISCOVERY_WORKSPACES: `${WS},${OTHER}`,
  PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true",
  PROVIDER_APOLLO_ENABLED: "true", APOLLO_COMMERCIAL_TERMS_CONFIRMED: "true",
  ...over,
} as Record<string, string>)[n];

const okVerifier: Verifier = async () => ({ plan: "growth", used: 100, limit: 1000, remaining: 900, resetsAt: "2026-11-01T00:00:00Z", checkedAt: FIXED_NOW().toISOString() });
const members = { [WS]: { owner: "owner", viewer: "member" }, [OTHER]: { stranger: "owner" } };

function ctx(over: { env?: Record<string, string>; verify?: Verifier; userId?: string | null } = {}) {
  const store = memoryConnectionStore(members);
  return { store, c: { userId: over.userId === undefined ? "owner" : over.userId, flags: readFlags(env(over.env)), store, verify: over.verify ?? okVerifier, now: FIXED_NOW } };
}

Deno.test("flags: everything is off by default", async () => {
  const f = readFlags(() => undefined);
  assertFalse(f.enabled);
  assertEquals(f.workspaces.size, 0);
  assertEquals(f.provider, { apollo: false, leadocean: false, apify: false });
  assertEquals(f.commercialTerms.leadocean, false);
  const store = memoryConnectionStore(members);
  const r = await handleConnections({ action: "list", workspaceId: WS }, { userId: "owner", flags: f, store, verify: okVerifier });
  assertEquals(r.status, 404);
});

Deno.test("flags: a workspace outside the allowlist is refused", async () => {
  const { c } = ctx({ env: { PROVIDER_DISCOVERY_WORKSPACES: OTHER } });
  assertEquals((await handleConnections({ action: "list", workspaceId: WS }, c)).status, 403);
});

Deno.test("connect: a verified key is stored server-side and never returned", async () => {
  const { store, c } = ctx();
  const r = await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, c);
  assertEquals(r.status, 200);
  const conn = r.body.connection as Record<string, unknown>;
  assertEquals(conn.status, "connected");
  assertEquals((conn.usage as { remaining: number }).remaining, 900);
  assertEquals(String(conn.keyFingerprint).length, 12);
  assertFalse(JSON.stringify(r.body).includes(KEY));
  assertFalse(JSON.stringify(r.body).includes("SECRET"));
  assertEquals(await store.secret(WS, "leadocean"), KEY);
  const list = await handleConnections({ action: "list", workspaceId: WS }, { ...c, userId: "viewer" });
  assertFalse(JSON.stringify(list.body).includes(KEY));
  assertEquals((list.body.connections as { provider: string; status: string }[]).map((x) => [x.provider, x.status]), [["apollo", "not_connected"], ["leadocean", "connected"], ["apify", "not_connected"]]);
});

Deno.test("connect: a key the provider rejects is not stored", async () => {
  const { store, c } = ctx({ verify: async (p) => { throw new ProviderError(p, "auth_failed", "invalid api key", 401); } });
  const r = await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, c);
  assertEquals(r.status, 400);
  assertEquals(r.body.error, "The provider rejected this key.");
  assertEquals(store.rows.size, 0);
  assertEquals(store.secrets.size, 0);
});

Deno.test("connect: malformed keys, disabled providers and unconfirmed commercial terms are refused before any call", async () => {
  let calls = 0;
  const counting: Verifier = async (...a) => { calls++; return okVerifier(...a); };
  assertEquals((await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: "has space" }, ctx({ verify: counting }).c)).status, 400);
  assertEquals((await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, ctx({ verify: counting, env: { PROVIDER_LEADOCEAN_ENABLED: "" } }).c)).status, 403);
  const terms = await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, ctx({ verify: counting, env: { LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "false" } }).c);
  assertEquals(terms.status, 403);
  assert(String(terms.body.error).includes("commercial terms"));
  assertEquals(calls, 0);
});

Deno.test("roles: a member may list but not connect or disconnect; a non-member may not even list", async () => {
  const { c } = ctx({ userId: "viewer" });
  assertEquals((await handleConnections({ action: "list", workspaceId: WS }, c)).status, 200);
  assertEquals((await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, c)).status, 403);
  assertEquals((await handleConnections({ action: "disconnect", workspaceId: WS, provider: "leadocean" }, c)).status, 403);
  assertEquals((await handleConnections({ action: "list", workspaceId: WS }, { ...c, userId: "stranger" })).status, 403);
  assertEquals((await handleConnections({ action: "list", workspaceId: WS }, { ...c, userId: null })).status, 401);
});

Deno.test("isolation: one workspace's key is invisible to another and cannot be used from it", async () => {
  const { store, c } = ctx();
  await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, c);
  const r = await handleConnections({ action: "list", workspaceId: OTHER }, { ...c, userId: "stranger" });
  assertEquals((r.body.connections as { status: string }[]).every((x) => x.status === "not_connected"), true);
  assertEquals((await handleConnections({ action: "verify", workspaceId: OTHER, provider: "leadocean" }, { ...c, userId: "stranger" })).status, 404);
  assertEquals(await store.secret(OTHER, "leadocean"), null);
  // An owner of the other workspace cannot reach into this one.
  assertEquals((await handleConnections({ action: "disconnect", workspaceId: WS, provider: "leadocean" }, { ...c, userId: "stranger" })).status, 403);
  assertEquals(await store.secret(WS, "leadocean"), KEY);
});

Deno.test("health: a re-verify that the provider now rejects marks the connection invalid; disconnect deletes the key", async () => {
  const { store, c } = ctx();
  await handleConnections({ action: "connect", workspaceId: WS, provider: "leadocean", apiKey: KEY }, c);
  const bad = await handleConnections({ action: "verify", workspaceId: WS, provider: "leadocean" }, { ...c, verify: async (p) => { throw new ProviderError(p, "auth_failed", "revoked", 401); } });
  assertEquals((bad.body.connection as { status: string }).status, "invalid");
  const gone = await handleConnections({ action: "disconnect", workspaceId: WS, provider: "leadocean" }, c);
  assertEquals((gone.body.connection as { status: string }).status, "not_connected");
  assertEquals(store.secrets.size, 0);
});

Deno.test("verification calls are free: LeadOcean /v1/account, Apollo usage_stats + People Search with one row", async () => {
  const f = mockFetch({
    "GET /v1/account": [{ body: { success: true, data: { account: { plan: "starter" }, key: { scopes: ["search"] }, records: { ceiling: 100, used: 5, remaining: 95, resetsAt: "2026-11-01T00:00:00Z" } } } }],
    "POST /api/v1/usage_stats/api_usage_stats": [{ body: {} }],
    "POST /api/v1/mixed_people/api_search": [{ body: { total_entries: 0, people: [] } }],
  });
  const verify = verifierFrom((p, k) => (p === "leadocean" ? leadOceanAdapter : apolloAdapter)({ apiKey: k, fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }));
  assertEquals((await verify("leadocean", KEY)).remaining, 95);
  await verify("apollo", "ap_key_123456789");
  assertEquals(f.calls.map((x) => `${x.method} ${new URL(x.url).pathname}`), ["GET /v1/account", "POST /api/v1/usage_stats/api_usage_stats", "POST /api/v1/mixed_people/api_search"]);
  // Apollo filters are query parameters, as documented.
  assertEquals(new URL(f.calls[2].url).searchParams.get("per_page"), "1");
  assertFalse(f.calls.some((x) => x.url.includes(KEY)), "keys travel in headers, never URLs");
});
