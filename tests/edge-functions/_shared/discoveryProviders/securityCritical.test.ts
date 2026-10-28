// Security- and money-critical cases for provider discovery, added for the
// independent review of #195. Mocked providers only; ZERO network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requirementsFromMission } from "../../../../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { planDiscovery, type DiscoveryPlan } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { memoryLedger, type DiscoveryApproval, type EnrichmentAuthorization } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { runDiscovery } from "../../../../supabase/functions/_shared/discoveryProviders/orchestrator.ts";
import { enrichContacts } from "../../../../supabase/functions/_shared/discoveryProviders/enrich.ts";
import { projectLead } from "../../../../supabase/functions/_shared/discoveryProviders/leadProjection.ts";
import type { DiscoveryAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapter.ts";
import { FIXED_NOW, MARKET, compileManufacturerMission, conn, loPage, loPerson, mockFetch, noSleep } from "./fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const M = "mission-sec";
const req = () => requirementsFromMission(compileManufacturerMission().final_mission as never);
const lo = (f: ReturnType<typeof mockFetch>) => leadOceanAdapter({ apiKey: "lo_test_key_123456", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW });
const approve = (plan: DiscoveryPlan, maxCredits: DiscoveryApproval["maxCredits"] = { ...plan.estimatedCredits }): DiscoveryApproval =>
  ({ kind: "discovery", workspaceId: WS, missionId: M, planHash: plan.planHash, maxCredits, approvedBy: "owner", approvedAt: "t" });

Deno.test("approval: an inflated client-supplied ceiling never raises spend above the server's estimate", async () => {
  const wrong = Array.from({ length: 10 }, (_, i) => loPerson({ ...MARKET[0], id: `p${i}`, domain: `d${i}.example`, name: `P ${i}`, country: "Germany" }));
  // Page 1 overbills (15 for 10 rows); page 2 would bring it to 25 > estimate 20.
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(wrong, { nextCursor: "c2", credits: 15 }) }, { body: loPage(wrong) }] });
  const r = { ...req(), requestedCount: 10 };
  const plan = planDiscovery({ requirements: r, connections: [conn("leadocean")], selection: ["leadocean"], limits: { maxRecordsPerStep: 20 } });
  assertEquals(plan.estimatedCredits.leadocean, 20);
  const run = await runDiscovery({ workspaceId: WS, missionId: M, requirements: r, plan, approval: approve(plan, { leadocean: 1_000_000 }), adapters: { leadocean: lo(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  assertEquals(f.calls.length, 1);
  assertEquals(run.steps[0].errorKind, "provider_cap");
});

Deno.test("approval: a ceiling BELOW the estimate is refused before any call", async () => {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage([loPerson(MARKET[0])]) }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const run = await runDiscovery({ workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan, { leadocean: plan.estimatedCredits.leadocean! - 1 }), adapters: { leadocean: lo(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  assertEquals(run.status, "blocked");
  assertEquals(f.calls.length, 0);
});

Deno.test("contact values: never held by the run, the ledger, or the projected rows — yet duplicates by email still merge", async () => {
  const a = loPerson({ ...MARKET[0], id: "x1", linkedin: "https://linkedin.com/in/a-1" });
  const b = loPerson({ ...MARKET[0], id: "x2", linkedin: undefined });
  (b.profile_data as Record<string, unknown>).profile_linkedin_url = null;
  const f = mockFetch({ "POST /v1/search": [{ body: loPage([a, b]) }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const run = await runDiscovery({ workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: lo(f) }, ledger, now: FIXED_NOW });
  const everything = JSON.stringify({ run, ledger: [...ledger.entries.values()], rows: run.leads.map((l) => projectLead(l, { workspaceId: WS, missionId: M, run })) });
  assertFalse(everything.includes("avery@stonebridgefab.example"), "no email value anywhere");
  assertFalse(everything.includes("555 0101"), "no phone value anywhere");
  const people = run.leads.flatMap((l) => l.contacts);
  assertEquals(people.length, 1, "the two rows share an email and merge");
  const cp = people[0].person.contactPoints;
  assert(cp.every((c) => c.value.startsWith(`redacted:${c.kind}:`)));
  assertEquals(cp.find((c) => c.kind === "email")!.verification, "provider_reported_verified", "status survives redaction");
});

Deno.test("money: an unexpected adapter failure after a paid call is charge_uncertain — a re-run does not buy the page again", async () => {
  let calls = 0;
  const broken: DiscoveryAdapter = { provider: "leadocean", search: async () => { calls++; throw new TypeError("cannot read property of undefined"); }, verifyKey: async () => { throw new Error("n/a"); } };
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const args = { workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: broken }, ledger, now: FIXED_NOW };
  assertEquals((await runDiscovery(args)).steps[0].errorKind, "charge_uncertain");
  assertEquals((await runDiscovery(args)).steps[0].errorKind, "charge_uncertain");
  assertEquals(calls, 1);
  assertFalse(JSON.stringify((await runDiscovery(args)).steps).includes("cannot read property"), "internal error text is not surfaced");
});

Deno.test("money: two concurrent runs of one approved plan buy the page once (the second sees in_flight)", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(MARKET.map(loPerson)) }] });
  const slow: DiscoveryAdapter = { ...lo(f), search: async (...a) => { calls++; await gate; return lo(f).search(...a); } };
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const ledger = memoryLedger();
  const args = { workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: slow }, ledger, now: FIXED_NOW };
  const first = runDiscovery(args);
  await new Promise((r) => setTimeout(r, 0));
  const second = await runDiscovery(args);
  release();
  const done = await first;
  assertEquals(second.steps[0].errorKind, "in_flight");
  assertEquals(done.status, "completed");
  assertEquals(calls, 1);
  assertEquals(await ledger.spent(WS, M), 10);
});

Deno.test("money: an exhausted allowance at plan time refuses the provider (run-time 402: discoveryProviders.test.ts)", async () => {
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean", { remainingCredits: 0 })], selection: ["leadocean"] });
  assertEquals(plan.status, "blocked");
  assertEquals(plan.refused[0].reason, "allowance exhausted");
});

Deno.test("enrichment: the authorization's credit ceiling holds across people", async () => {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(MARKET.slice(0, 2).map(loPerson)) }], "POST /v1/enrich": [{ body: { found: true, data: loPerson(MARKET[0]), meta: { credits: 1 } } }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const run = await runDiscovery({ workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: lo(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  const people = run.leads.flatMap((l) => l.contacts.map((c) => c.person));
  assertEquals(people.length, 2);
  const auth: EnrichmentAuthorization = { kind: "enrichment", workspaceId: WS, missionId: M, personKeys: people.map((p) => p.key), revealEmail: true, phones: false, maxCredits: 1, approvedBy: "owner", approvedAt: "t" };
  const out = await enrichContacts({ workspaceId: WS, missionId: M, authorization: auth, people, deps: { apiKey: "k_123456789", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }, ledger: memoryLedger() });
  assertEquals(out.map((o) => o.status), ["enriched", "refused"]);
  assertEquals(out[1].reason, "ledger: provider_cap");
  assertEquals(f.calls.filter((c) => c.url.endsWith("/v1/enrich")).length, 1);
});

Deno.test("boundary: discovery writes no outreach — only accounts, contacts and a lead_candidate with no next action", async () => {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(MARKET.map(loPerson)) }] });
  const plan = planDiscovery({ requirements: req(), connections: [conn("leadocean")], selection: ["leadocean"] });
  const run = await runDiscovery({ workspaceId: WS, missionId: M, requirements: req(), plan, approval: approve(plan), adapters: { leadocean: lo(f) }, ledger: memoryLedger(), now: FIXED_NOW });
  for (const row of run.leads.map((l) => projectLead(l, { workspaceId: WS, missionId: M, run })).filter((x) => x !== null)) {
    assertEquals(Object.keys(row!).sort(), ["account", "contacts", "lead_candidate"]);
    assert(["qualified", "new"].includes(row!.lead_candidate.status));
    assertFalse("next_action" in row!.lead_candidate);
    assertFalse(/outreach|draft|sequence|send/i.test(JSON.stringify(Object.keys(row!.lead_candidate))));
  }
  // The only contact-value path is enrichment, and it rejects a discovery approval (discoveryProviders.test.ts).
});
