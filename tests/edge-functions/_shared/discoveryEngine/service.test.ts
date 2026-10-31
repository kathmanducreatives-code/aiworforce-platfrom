import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleEngine, parseEngineRequest, readEngineFlags, type EngineDeps } from "../../../../supabase/functions/_shared/discoveryEngine/service.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import type { EngineRow } from "../../../../supabase/functions/_shared/discoveryEngine/projection.ts";
import { fixtureModel, jobRow, NOW, US_RECORD, world, WS } from "./fixtures.ts";

const ENV: Record<string, string> = { DISCOVERY_ENGINE_ENABLED: "true", DISCOVERY_ENGINE_WORKSPACES: WS, DISCOVERY_ENGINE_APIFY_ENABLED: "true",
  PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true" };
const HIRING = "Find US companies hiring Account Executives in the past 30 days.";

function deps(over: Partial<EngineDeps> = {}, env = ENV) {
  const w = world([], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } });
  const written: EngineRow[] = [];
  let modelCalls = 0;
  const d: EngineDeps = {
    userId: "owner", flags: readEngineFlags((k) => env[k]), discoveryFlags: readFlags((k) => env[k]),
    store: { memberRole: (u: string, ws: string) => Promise.resolve(ws === WS ? (u === "owner" ? "owner" : u === "member" ? "member" : null) : null),
      list: () => Promise.resolve([{ provider: "leadocean", status: "connected" }]), secret: () => Promise.resolve("key") } as never,
    model: (s, u) => { modelCalls++; return fixtureModel(s, u); },
    ledger: w.ledger, cache: w.cache, caps: { leadoceanRecords: 50, apifyUsd: 1 },
    loadExisting: () => Promise.resolve([]), leadoceanFor: () => w.l.adapter, apify: w.a.invoke,
    persist: (rows) => { written.push(...rows); return Promise.resolve(); }, now: NOW, ...over,
  };
  return { d, w, written, modelCalls: () => modelCalls };
}
const req = (b: Record<string, unknown>) => parseEngineRequest({ workspace_id: WS, query: HIRING, ...b })!;

Deno.test("engine service: off → 404; outsider / non-allowlisted → 403; a member cannot run", async () => {
  assertEquals((await handleEngine(req({ action: "plan" }), deps({}, {}).d)).status, 404);
  assertEquals((await handleEngine(req({ action: "plan" }), deps({ userId: "stranger" }).d)).status, 403);
  assertEquals((await handleEngine(req({ action: "plan" }), deps({}, { ...ENV, DISCOVERY_ENGINE_WORKSPACES: "x" }).d)).status, 403);
  assertEquals((await handleEngine(req({ action: "run", spec: {}, approval: { plan_hash: "h", leadocean_records: 1, apify_usd: 0.1 } }), deps({ userId: "member" }).d)).status, 403);
});

Deno.test("engine service: plan interprets and explains, calls no provider", async () => {
  const { d, w } = deps();
  const r = await handleEngine(req({ action: "plan" }), d);
  assertEquals(r.status, 200);
  const plan = r.body.plan as { strategy: string; explanation: string[]; estimated: { apifyUsd: number } };
  assertEquals(plan.strategy, "apify");
  assert(plan.explanation.length > 2);
  assertEquals(w.a.calls.length + w.l.calls.length, 0);
});

Deno.test("engine service: run needs the shown spec's plan hash; a tampered spec or an over-limit approval buys nothing", async () => {
  const { d, w, written, modelCalls } = deps();
  const planned = await handleEngine(req({ action: "plan" }), d);
  const spec = planned.body.spec as Record<string, unknown>;
  const hash = (planned.body.plan as { planHash: string }).planHash;
  const tampered = { ...spec, hard: [...(spec.hard as string[]), "employee_range"], grounding: { ...(spec.grounding as object), employee_range: "50-500 employees" }, company: { industries: [], descriptors: [], employees: { min: 50, max: 500 } } };
  assertEquals((await handleEngine(req({ action: "run", spec: tampered, approval: { plan_hash: hash, leadocean_records: 10, apify_usd: 0.5 } }), d)).status, 409, "an ungrounded size cannot slip in");
  assertEquals((await handleEngine(req({ action: "run", spec, approval: { plan_hash: hash, leadocean_records: 10, apify_usd: 5 } }), d)).status, 409, "over the workspace limit");
  assertEquals(w.a.calls.length, 0);
  const ok = await handleEngine(req({ action: "run", spec, approval: { plan_hash: hash, leadocean_records: 10, apify_usd: 0.5 } }), d);
  assertEquals(ok.status, 200);
  assertEquals(modelCalls(), 1, "run re-validates the shown spec; it does not ask GPT again");
  assertEquals(written.length, 1);
  assertEquals(written[0].lead_candidate.status, "qualified");
  assertEquals(written[0].contact, null);
  assert(JSON.stringify(written).includes("apify:companies_by_hiring"));
});

Deno.test("engine service: an approval asking for phones is not a thing — discovery requests none", async () => {
  assertEquals(parseEngineRequest({ action: "run", workspace_id: WS, query: HIRING, spec: {}, approval: { plan_hash: "h", leadocean_records: 1 } }), null, "apify_usd required");
  const { d, w } = deps();
  const planned = await handleEngine(req({ action: "plan" }), d);
  await handleEngine(req({ action: "run", spec: planned.body.spec, approval: { plan_hash: (planned.body.plan as { planHash: string }).planHash, leadocean_records: 10, apify_usd: 0.5 } }), d);
  assertEquals(w.l.calls.filter((c) => c.url.includes("phone")).length, 0);
});
