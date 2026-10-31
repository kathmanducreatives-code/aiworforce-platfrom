// The provider-discovery service (plan / run), offline: memory store, memory
// ledger, mocked LeadOcean, a mission from the real compiler.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleDiscovery, parseDiscoveryRequest, type DiscoveryDeps } from "../../../../supabase/functions/_shared/discoveryProviders/discoveryService.ts";
import { memoryConnectionStore } from "../../../../supabase/functions/_shared/discoveryProviders/connections.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ProjectedLead } from "../../../../supabase/functions/_shared/discoveryProviders/leadProjection.ts";
import { FIXED_NOW, MARKET, compileManufacturerMission, loPage, loPerson, mockFetch, noSleep } from "./fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MSG = "msg-1";

async function setup(over: { env?: Record<string, string>; userId?: string } = {}) {
  const store = memoryConnectionStore({ [WS]: { owner: "owner", viewer: "member" }, [OTHER]: { stranger: "owner" } });
  await store.store({ workspaceId: WS, provider: "leadocean", status: "connected", keyFingerprint: "abcdef012345", usage: { plan: "growth", used: 0, limit: 1000, remaining: 1000, resetsAt: null, checkedAt: "t" }, lastVerifiedAt: "t", lastError: null, connectedBy: "owner" }, "lo_key_1234567890");
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(MARKET.map(loPerson)) }] });
  const written: ProjectedLead[] = [];
  const mission = compileManufacturerMission().final_mission as unknown as Record<string, unknown>;
  const deps: DiscoveryDeps = {
    userId: over.userId ?? "owner",
    flags: readFlags((n) => ({ PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_DISCOVERY_WORKSPACES: `${WS},${OTHER}`, PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true", ...over.env } as Record<string, string>)[n]),
    store,
    // The mission is on a message in WS only.
    loadMission: async (ws, id) => (ws === WS && id === MSG ? mission : null),
    adapterFor: (_p, key) => leadOceanAdapter({ apiKey: key, fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }),
    verifier: null,
    ledger: memoryLedger(),
    persist: async (rows) => { written.push(...rows); },
    now: FIXED_NOW,
  };
  return { deps, f, written };
}

Deno.test("service: plan is free — it returns the plan and calls no provider", async () => {
  const { deps, f } = await setup();
  const r = await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: "auto" })!, deps);
  assertEquals(r.status, 200);
  const plan = r.body.plan as { steps: { provider: string }[]; requiresApproval: boolean; refused: { provider: string; reason: string }[] };
  assertEquals(plan.steps.map((s) => s.provider), ["leadocean"]);
  assert(plan.requiresApproval);
  assertEquals(Object.fromEntries(plan.refused.map((x) => [x.provider, x.reason])), { apollo: "disabled", apify: "disabled" });
  assertEquals(f.calls.length, 0);
});

Deno.test("service: run needs the approval for exactly the planned hash, then writes only qualified/needs-verification leads", async () => {
  const { deps, f, written } = await setup();
  const planned = await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: ["leadocean"] })!, deps);
  const plan = planned.body.plan as { planHash: string; estimatedCredits: Record<string, number> };
  const noApproval = await handleDiscovery(parseDiscoveryRequest({ action: "run", workspace_id: WS, message_id: MSG, selection: ["leadocean"] })!, deps);
  assertEquals(noApproval.status, 409);
  assertEquals(f.calls.length, 0);
  const ok = await handleDiscovery(parseDiscoveryRequest({ action: "run", workspace_id: WS, message_id: MSG, selection: ["leadocean"], approval: { plan_hash: plan.planHash, max_credits: plan.estimatedCredits } })!, deps);
  assertEquals(ok.status, 200);
  assertEquals((ok.body.run as { counts: unknown }).counts, { qualified: 0, needsVerification: 6, rejected: 4 });
  assertEquals(written.length, 6);
  assert(written.every((w) => w.account.workspace_id === WS));
  assertFalse(JSON.stringify(ok.body).includes("lo_key_1234567890"));
});

Deno.test("service: a member can plan but not run; another workspace cannot read this mission", async () => {
  const viewer = await setup({ userId: "viewer" });
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: "auto" })!, viewer.deps)).status, 200);
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "run", workspace_id: WS, message_id: MSG, selection: "auto", approval: { plan_hash: "x", max_credits: {} } })!, viewer.deps)).status, 403);
  const stranger = await setup({ userId: "stranger" });
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: OTHER, message_id: MSG, selection: "auto" })!, stranger.deps)).status, 404);
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: "auto" })!, stranger.deps)).status, 403);
});

Deno.test("service: off by default, and a workspace outside the allowlist is refused", async () => {
  const off = await setup({ env: { PROVIDER_DISCOVERY_ENABLED: "" } });
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: "auto" })!, off.deps)).status, 404);
  const notListed = await setup({ env: { PROVIDER_DISCOVERY_WORKSPACES: OTHER } });
  assertEquals((await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: "auto" })!, notListed.deps)).status, 403);
});

Deno.test("service: a stored key the provider now rejects marks the connection invalid", async () => {
  const { deps } = await setup();
  const bad = mockFetch({ "POST /v1/search": [{ status: 401, body: { error: { message: "revoked" } } }] });
  deps.adapterFor = (_p, key) => leadOceanAdapter({ apiKey: key, fetch: bad.fetch, sleep: noSleep, now: FIXED_NOW });
  const planned = await handleDiscovery(parseDiscoveryRequest({ action: "plan", workspace_id: WS, message_id: MSG, selection: ["leadocean"] })!, deps);
  const plan = planned.body.plan as { planHash: string; estimatedCredits: Record<string, number> };
  const r = await handleDiscovery(parseDiscoveryRequest({ action: "run", workspace_id: WS, message_id: MSG, selection: ["leadocean"], approval: { plan_hash: plan.planHash, max_credits: plan.estimatedCredits } })!, deps);
  assertEquals((r.body.run as { status: string }).status, "failed");
  assertEquals((await deps.store.list(WS))[0].status, "invalid");
});

Deno.test("service: malformed requests are rejected before anything runs", () => {
  assertEquals(parseDiscoveryRequest({ action: "run", workspace_id: WS, message_id: MSG, selection: ["hubspot"] }), null);
  assertEquals(parseDiscoveryRequest({ action: "delete", workspace_id: WS, message_id: MSG }), null);
  assertEquals(parseDiscoveryRequest({ action: "plan", message_id: MSG }), null);
});
