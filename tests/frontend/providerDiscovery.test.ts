// Provider discovery in the browser: off by default, no key in the bundle,
// and no lead shown as more verified than it is.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  creditsLine, phoneLabel, providerDiscoveryUiEnabled, readLeadAttribution, statusLabel, usageLine, verificationBadge,
  connectionAction, type Invoke,
} from "../../src/lib/providerDiscovery.ts";

Deno.test("the UI flag is off unless exactly 'true'", () => {
  assertFalse(providerDiscoveryUiEnabled({}));
  assertFalse(providerDiscoveryUiEnabled({ VITE_PROVIDER_DISCOVERY: "1" }));
  assert(providerDiscoveryUiEnabled({ VITE_PROVIDER_DISCOVERY: "true" }));
});

Deno.test("no provider key, key variable or key storage exists in the frontend source", async () => {
  const files: string[] = [];
  const walk = async (d: string) => {
    for await (const e of Deno.readDir(d)) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) await walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  await walk("src");
  for (const f of files) {
    const s = await Deno.readTextFile(f);
    assertFalse(/VITE_[A-Z_]*(LEADOCEAN|APOLLO)/.test(s), `${f} names a provider key variable`);
    assertFalse(/x-api-key/i.test(s), `${f} sets a provider auth header`);
  }
  const lib = await Deno.readTextFile("src/lib/providerDiscovery.ts");
  const ui = await Deno.readTextFile("src/components/integrations/ProviderConnections.tsx");
  for (const s of [lib, ui]) assertFalse(/localStorage|sessionStorage|indexedDB/.test(s), "a key is never stored in the browser");
  assert(ui.includes(`type="password"`));
  assert(ui.includes("setApiKey('')"), "the field is cleared after every attempt");
});

Deno.test("connect sends the key once to the connections function and nowhere else", async () => {
  const sent: { name: string; body: unknown }[] = [];
  const invoke: Invoke = async <T>(name: string, body: unknown) => {
    sent.push({ name, body });
    return { data: { connection: { provider: "leadocean", status: "connected" } } as T, error: null };
  };
  const r = await connectionAction(invoke, "ws", "leadocean", "connect", "lo_key_1234567890");
  assert(r.ok);
  assertEquals(sent.map((s) => s.name), ["provider-connections"]);
  await connectionAction(invoke, "ws", "leadocean", "verify");
  assertFalse(JSON.stringify(sent[1].body).includes("lo_key"), "only connect carries a key");
});

Deno.test("status words: unavailable, pending terms, connected, rejected", () => {
  assertEquals(statusLabel({ status: "connected", enabled: false, commercialTermsConfirmed: true }).text, "Not available yet");
  assertEquals(statusLabel({ status: "connected", enabled: true, commercialTermsConfirmed: false }).text, "Pending terms review");
  assertEquals(statusLabel({ status: "connected", enabled: true, commercialTermsConfirmed: true }).text, "Connected");
  assertEquals(statusLabel({ status: "invalid", enabled: true, commercialTermsConfirmed: true }).tone, "bad");
  assertEquals(usageLine({ plan: "g", used: 100, limit: 1000, remaining: 900, resetsAt: null, checkedAt: "t" }), "900 of 1,000 credits left");
  assertEquals(creditsLine({ estimatedCredits: { apollo: 0 }, requiresApproval: false }), "No provider credits");
  assertEquals(creditsLine({ estimatedCredits: { leadocean: 15, apollo: 0 }, requiresApproval: true }), "LeadOcean: up to 15");
});

Deno.test("attribution: read only from a versioned record; verification words never overclaim", () => {
  assertEquals(readLeadAttribution({ agentory_discovery: { status: "qualified" } }), null);
  assertEquals(readLeadAttribution(null), null);
  const a = readLeadAttribution({ agentory_discovery: {
    version: "provider-discovery-v1", status: "qualified", verification: "provider_attested",
    providers: [{ provider: "apollo", retrieved_at: "2026-10-27T12:00:00Z" }],
    checks: [{ label: "HQ: US", outcome: "provider_filter", note: "", evidence: [] }, { label: "Industry", outcome: "matched", evidence: [{ provider: "apify" }] }],
    conflicts: [{ field: "employeeCount" }],
  } })!;
  assertEquals(verificationBadge(a), { text: "Provider-filtered", tone: "attested" });
  assertEquals(a.checks[1].sources, ["apify"]);
  assertEquals(a.conflicts, ["employeeCount"]);
  assertEquals(verificationBadge({ status: "needs_verification", verification: null }).tone, "unverified");
  assertEquals(phoneLabel("provider_supplied_unverified"), "Phone from provider · unverified");
  assertEquals(phoneLabel("provider_reported_verified"), "Phone from provider · unverified", "a provider's word is not verification");
  assertEquals(phoneLabel("independently_verified"), "Phone verified");
});
