import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { holdsFromOutreach, recordsFromWorkspace } from "../../../../supabase/functions/_shared/leadPipeline/history.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { ApifyRefusal, ledgeredInvoker, pipelineApifyInvoker } from "../../../../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";
import { handleLeadPipeline, parsePipelineRequest, readPipelineFlags, type PipelineDeps } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import { apifyMock, leadOceanMock, NOW, phoneMock, WS } from "./fixtures.ts";

// ── History ─────────────────────────────────────────────────────────────────
Deno.test("history: workspace Leads keep ids; legacy outreach yields holds only (no cross-workspace ids)", () => {
  const recs = [
    ...recordsFromWorkspace(
      [{ id: "acc1", domain: "acmesaas.example", linkedin_url: null, stage: "customer" }],
      [{ id: "ct1", account_id: "acc1", linkedin_url: "https://www.linkedin.com/in/ada-quill" }],
      [{ id: "lc1", account_id: "acc1", contact_id: "ct1", status: "new" }]),
    ...holdsFromOutreach([
      { id: "o1", linkedin_url: "https://www.linkedin.com/in/ed-rook", status: "not_started", last_touch_date: null },
      { id: "o2", linkedin_url: "https://www.linkedin.com/in/bo-lark", status: "in_sequence", last_touch_date: null },
      { id: "o3", linkedin_url: "https://www.linkedin.com/in/old", status: "not_started", last_touch_date: "2025-01-01" },
      { id: "o4", linkedin_url: "https://www.linkedin.com/in/rep", status: "replied", last_touch_date: null },
    ], [{ lead_id: "o1", at: "2026-10-20T00:00:00Z" }], NOW()),
  ];
  const idx = new ExclusionIndex(recs, NOW);
  const acc = idx.company({ domains: ["acmesaas.example"], linkedinUrls: [], providerIds: [] });
  assertEquals([acc.existingLeadIds, acc.crmRelationship], [["lc1"], "customer"]);
  assertEquals(idx.person({ linkedinUrls: ["https://www.linkedin.com/in/ada-quill"], providerIds: [] }).existingLeadIds, ["lc1"]);
  const ed = idx.person({ linkedinUrls: ["https://linkedin.com/in/ed-rook"], providerIds: [] });
  assertEquals([ed.existingLeadIds, ed.blocksOutreach, ed.holds[0].reason], [[], true, "recently_contacted"]);
  assert(idx.person({ linkedinUrls: ["https://linkedin.com/in/bo-lark"], providerIds: [] }).blocksOutreach);
  assertFalse(idx.person({ linkedinUrls: ["https://linkedin.com/in/old"], providerIds: [] }).blocksOutreach, "a touch older than 90 days is not a hold");
  assertEquals(idx.person({ linkedinUrls: ["https://linkedin.com/in/rep"], providerIds: [] }).crmRelationship, "open_deal");
});

// ── Apify invoker ───────────────────────────────────────────────────────────
Deno.test("apify invoker: allowlist, token in header not URL, USD cap + maxItems on the run, no repeats, no retries", async () => {
  const seen: { url: string; auth: string }[] = [];
  const fetch = (url: string, init: { headers: Record<string, string> }) => { seen.push({ url, auth: init.headers.Authorization }); return Promise.resolve(new Response("[{\"a\":1}]", { status: 200 })); };
  const inv = pipelineApifyInvoker({ token: "tok-123", fetch: fetch as never });
  await inv("apify_linkedin_job_search", { company: ["x"] }, { maxItems: 5, idempotencyKey: "k1" });
  assert(seen[0].url.startsWith("https://api.apify.com/v2/acts/harvestapi~linkedin-job-search/run-sync-get-dataset-items?"));
  assertFalse(seen[0].url.includes("tok-123"));
  assertEquals(seen[0].auth, "Bearer tok-123");
  const q = new URL(seen[0].url).searchParams;
  assertEquals([q.get("maxItems"), q.get("maxTotalChargeUsd")], ["5", "0.00600"]);
  let refused = 0;
  for (const [k, key] of [["apify_google_search", "k2"], ["apify_linkedin_job_search", "k1"]]) { try { await inv(k, {}, { maxItems: 1, idempotencyKey: key }); } catch (e) { if (e instanceof ApifyRefusal) refused++; } }
  assertEquals([refused, seen.length], [2, 1]);
  let calls = 0;
  const bad = pipelineApifyInvoker({ token: "t", fetch: (() => { calls++; return Promise.resolve(new Response("x", { status: 502 })); }) as never });
  await bad("apify_linkedin_job_search", {}, { maxItems: 1, idempotencyKey: "z" }).catch(() => {});
  assertEquals(calls, 1);
});
Deno.test("apify ledger: reserves worst case first, replays a settled run, never re-runs an uncertain one, caps the total", async () => {
  const ledger = memoryLedger();
  let n = 0;
  const inner = () => { n++; return Promise.resolve({ items: [{ x: 1 }], chargedUsd: 0.002 }); };
  const inv = ledgeredInvoker(inner, ledger, { workspaceId: "ws", missionId: "m", maxUsd: 0.01 });
  await inv("apify_linkedin_job_search", {}, { maxItems: 5, idempotencyKey: "a" });
  const replay = await inv("apify_linkedin_job_search", {}, { maxItems: 5, idempotencyKey: "a" });
  assertEquals([n, replay.items.length, replay.chargedUsd], [1, 1, 0]);
  const failing = ledgeredInvoker(() => Promise.reject(new Error("timeout")), ledger, { workspaceId: "ws", missionId: "m", maxUsd: 0.01 });
  await failing("apify_linkedin_job_search", {}, { maxItems: 1, idempotencyKey: "b" }).catch(() => {});
  let again = "";
  await inv("apify_linkedin_job_search", {}, { maxItems: 1, idempotencyKey: "b" }).catch((e) => { again = String(e.message); });
  assert(again.includes("charge_uncertain"));
  let capped = "";
  await inv("apify_linkedin_job_search", {}, { maxItems: 10, idempotencyKey: "c" }).catch((e) => { capped = String(e.message); });
  assert(capped.includes("provider_cap"), "0.002 + 0.002 (uncertain b) + 0.011 > 0.01");
});

// ── Service ─────────────────────────────────────────────────────────────────
const ENV: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: WS, LEAD_PIPELINE_SIGNALS_ENABLED: "true", LEAD_PIPELINE_PHONES_ENABLED: "true",
  PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true" };
function deps(over: Partial<PipelineDeps> = {}, env = ENV) {
  const lo = leadOceanMock();
  const written: PipelineRow[] = [];
  const d: PipelineDeps = {
    userId: "u-owner", flags: readPipelineFlags((k) => env[k]), discoveryFlags: readFlags((k) => env[k]),
    store: {
      memberRole: (u, w) => Promise.resolve(w === WS ? (u === "u-owner" ? "owner" : u === "u-member" ? "member" : null) : null),
      list: () => Promise.resolve([{ provider: "leadocean", status: "connected", usage: { remaining: 500, restrictions: [] } }]),
      secret: () => Promise.resolve("offline-key"),
    } as never,
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(),
    loadExisting: () => Promise.resolve([{ leadId: "lc-delta", kind: "lead_candidate", companyDomain: "deltaflow.example" }]),
    leadoceanFor: () => ({ adapter: lo.adapter, deps: lo.deps }), apify: apifyMock().invoke,
    persist: (rows) => { written.push(...rows); return Promise.resolve(); }, now: NOW, ...over,
  };
  return { d, written, lo };
}
const req = (b: Record<string, unknown>) => parsePipelineRequest({ workspace_id: WS, icp: "icp_a_b2b_saas", walk_id: "walk-1", overrides: { requested_count: 5 }, ...b })!;

Deno.test("service: off → 404; not allowlisted → 403; non-member → 403; member cannot run", async () => {
  assertEquals((await handleLeadPipeline(req({ action: "plan" }), deps({}, {}).d)).status, 404);
  assertEquals((await handleLeadPipeline(req({ action: "plan" }), deps({}, { ...ENV, LEAD_PIPELINE_WORKSPACES: "other" }).d)).status, 403);
  assertEquals((await handleLeadPipeline(req({ action: "plan" }), deps({ userId: "stranger" }).d)).status, 403);
  assertEquals((await handleLeadPipeline(req({ action: "run", approval: { plan_hash: "x", leadocean_records: 5 } }), deps({ userId: "u-member" }).d)).status, 403);
  assertEquals(parsePipelineRequest({ action: "run", workspace_id: WS, icp: "icp_c", walk_id: "w" }), null);
});

Deno.test("service: plan is a free dry run with the exact worst case; run needs the same hash and enough records", async () => {
  const { d, lo } = deps();
  // A discovery approval cannot ask for phone lookups: refused at parse, not ignored.
  assertEquals(parsePipelineRequest({ action: "plan", workspace_id: WS, icp: "icp_a_b2b_saas", walk_id: "walk-1", approval: { plan_hash: "-", leadocean_records: 0, phone_lookups: 2 } }), null);
  const plan = await handleLeadPipeline(req({ action: "plan", approval: { plan_hash: "-", leadocean_records: 0, canonical_max_usd: 0.03, signals_max_usd: 0.05 } }), d);
  assertEquals(plan.status, 200);
  assertEquals(lo.calls.length, 0);
  const hash = (plan.body.plan as { planHash: string }).planHash;
  const est = (plan.body.plan as { estimatedCredits: { leadocean: number } }).estimatedCredits.leadocean;
  assertEquals(est, 15, "5 requested × overfetch 3");
  const wc = plan.body.worstCase as { leadoceanRecords: number; apifyUsd: number };
  assertEquals(wc, { ...wc, leadoceanRecords: est, apifyUsd: 0.08 }, "no phone records in a discovery worst case");
  assertEquals((await handleLeadPipeline(req({ action: "run", approval: { plan_hash: "wrong", leadocean_records: 5 } }), d)).status, 409);
  assertEquals((await handleLeadPipeline(req({ action: "run", approval: { plan_hash: hash, leadocean_records: est - 1 } }), d)).status, 409);
  assertEquals(lo.calls.length, 0, "refused runs buy nothing");
});

Deno.test("service: an approved run writes eligible + pending leads; existing Lead is updated, not re-created; no message, no call", async () => {
  const ph = phoneMock();
  const { d, written, lo } = deps();
  const plan = await handleLeadPipeline(req({ action: "plan" }), d);
  const hash = (plan.body.plan as { planHash: string }).planHash;
  const r = await handleLeadPipeline(req({ action: "run", approval: { plan_hash: hash, leadocean_records: 15, canonical_max_usd: 0.03, signals_max_usd: 0.05, phone_lookups: 0 } }), d);
  assertEquals(r.status, 200);
  assertEquals(lo.calls.length, 1);
  assertEquals(ph.calls.length, 0);
  const byDomain = Object.fromEntries(written.map((w) => [w.account.domain, w]));
  assertFalse("betacloud.example" in byDomain, "ineligible not written");
  assertEquals(byDomain["deltaflow.example"].existingLeadId, "lc-delta");
  assertEquals(byDomain["acmesaas.example"].lead_candidate.status, "qualified");
  assertEquals(byDomain["gammaops.example"].lead_candidate.status, "new");
  assert(written.every((w) => w.contact?.phone === null), "no lookups approved, no numbers");
  assert(byDomain["acmesaas.example"].lead_candidate.reason.startsWith("Eligible;"));
  assertEquals((r.body.spend as { leadoceanRecords: number }).leadoceanRecords, 5);
});
