// FIRECRAWL: THE HOMEPAGE FALLBACK, AND EVERY CALL SETTLED.
//
// Canary 3be88a89 (2026-09-25) carried ComfyUI through funding PASS and hiring
// PASS to its last claim, B2B SaaS. The business-model verifier mapped comfy.org
// (120 URLs), found none serving product / pricing / customers / docs / about,
// read NOTHING, and the claim stayed PENDING. Its one Firecrawl purchase — the
// map — also stayed `executed` at its estimate forever: the only settlement pass
// waits for an Apify run receipt Firecrawl never produces, and the map's ledger
// row carried no spec ids for a settlement to find.
//
// The collector below is wired exactly as run-agent's business-model `collect`:
// the real runner, the real spec-governed map and page fetchers on ONE ledger,
// the real page plan and budget. Firecrawl itself is scripted. No network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MAP_LOG_SAMPLE, mappedSample, runEvidenceCollection,
} from "../../../supabase/functions/_shared/webEvidenceRunner.ts";
import {
  BUSINESS_MODEL_MAX_PAGES, BUSINESS_MODEL_PAGE_INTENTS, businessModelVerifier, claimPageBudget, claimPageDebts,
  claimPagePlan, type PageCollection,
} from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import {
  specGovernedMapper, specGovernedPageFetcher, webEvidenceCreditRate,
} from "../../../supabase/functions/_shared/webEvidenceSpec.ts";
import { newSpendLedger, resolveCeilings, spendTotals, settle } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import { settlementPatches } from "../../../supabase/functions/_shared/p2SpinePersistence.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { VerificationTarget } from "../../../supabase/functions/_shared/claimVerifier.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const SCOPE = { workspace_id: "00000000-0000-4000-a000-000000000001", lineage_id: "3be88a89-bfd9-44a6-b0e8-1b54ae3e8761" };
/** The configured account rate — the pricing authority, as canary 9 ran it. */
const RATE = webEvidenceCreditRate((k) => k === "FIRECRAWL_USD_PER_CREDIT" ? "0.005" : undefined, { usd_capped: true });
const NOW = new Date("2026-09-25T10:49:30.000Z");

function state() {
  return {
    spend_ledger: newSpendLedger(resolveCeilings(null, false)),
    mission_trace: newMissionTrace(),
    retrieval_plans: [{ plan_id: "rp_1", version: 1, mission_hash: "mh" }],
  };
}

const target = (slug: string, domain: string): VerificationTarget => ({
  company_key: `https://www.linkedin.com/company/${slug}`, name: slug, domain, linkedin_url: `https://www.linkedin.com/company/${slug}`,
  criterion: { criterion_id: "industry:b2b_saas", dimension: "industry", value: "b2b saas" },
  graph: buildCompanyEvidenceGraph(`https://www.linkedin.com/company/${slug}`, [], { now: NOW }),
});

/** comfy.org as its map answered: 120 URLs, a docs subdomain root first, none on a preferred path. */
const COMFY_MAP: string[] = [
  "https://docs.comfy.org/",
  "https://comfy.org/",
  "https://comfy.org/download",
  "https://comfy.org/cloud",
  "https://comfy.org/careers",
  ...Array.from({ length: 80 }, (_, n) => `https://comfy.org/blog/post-${n}`),
  ...Array.from({ length: 35 }, (_, n) => `https://comfy.org/workflows/w-${n}`),
];

type PageResult = { ok: boolean; markdown: string; status: "ok" | "empty" | "blocked" | "not_found" | "timeout"; status_code?: number | null };
const HOMEPAGE: PageResult = {
  ok: true, status: "ok", status_code: 200,
  markdown: "# ComfyUI\nThe most powerful open source node-based application for generative AI. Comfy Cloud for teams.",
};

/** run-agent's business-model collector, with Firecrawl scripted. */
async function collect(o: {
  map: string[]; page?: (url: string) => PageResult | Promise<PageResult>;
  s?: ReturnType<typeof state>; targets?: VerificationTarget[];
}) {
  const s = o.s ?? state();
  const fetched: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const targets = o.targets ?? [target("comfyui", "comfy.org")];
  const debts = claimPageDebts(targets);
  const run = await runEvidenceCollection({
    workspace_id: SCOPE.workspace_id, debts,
    budget: claimPageBudget(debts.length, BUSINESS_MODEL_PAGE_INTENTS, BUSINESS_MODEL_MAX_PAGES),
    deps: {
      plan: () => Promise.resolve(claimPagePlan(debts, BUSINESS_MODEL_PAGE_INTENTS)),
      extract: null, db: null, readCache: null, now: () => NOW.toISOString(),
      fetchPage: specGovernedPageFetcher({
        state: s as never, scope: SCOPE, usd_per_credit: RATE.usd_per_credit,
        send: async (spec) => {
          const url = String(spec.serialized_input.url);
          fetched.push(url);
          return await (o.page ?? (() => HOMEPAGE))(url);
        },
      }),
      mapSite: specGovernedMapper({
        state: s as never, scope: SCOPE, usd_per_credit: RATE.usd_per_credit, max_urls: 120,
        send: () => Promise.resolve(o.map),
      }),
      log: (e, m) => logs.push([e, m]),
    },
  });
  const byKey: Record<string, PageCollection> = Object.fromEntries(
    run.companies.map((c) => [c.company_key, { pages_ok: c.pages_ok, outcome: c.outcome }]));
  return { s, run, fetched, logs, byKey, mapLog: logs.find(([e]) => e === "map")?.[1] };
}

// ═════════════════════════════════════════════════ 1. the homepage fallback ══

Deno.test("COMFYUI REPLAY: 120 mapped URLs, no preferred page → the homepage is selected and its page is scraped", async () => {
  const r = await collect({ map: COMFY_MAP });
  assertEquals(r.fetched, ["https://comfy.org/"], "exactly the company's own root — not docs.comfy.org");
  assertEquals(r.byKey["https://www.linkedin.com/company/comfyui"], { pages_ok: 1, outcome: "collected" });
  assertEquals(r.mapLog?.homepage_fallback, true);
  assertEquals(r.mapLog?.mapped, 120);
});

Deno.test("PREFERRED PAGES WIN: when a product/pricing/customers/docs/about page exists, no fallback is taken", async () => {
  // Inside the 120-URL map bound (the mapper keeps the first 120 it is given).
  const r = await collect({ map: ["https://comfy.org/pricing", ...COMFY_MAP.slice(0, 119)] });
  assertEquals(r.fetched, ["https://comfy.org/pricing"], "the preferred page, and not an extra homepage read");
  assertEquals(r.mapLog?.homepage_fallback, false);
});

Deno.test("SAME-SITE ONLY: a map of nothing but other sites gets no homepage invented", async () => {
  const r = await collect({ map: ["https://twitter.com/comfyui", "https://github.com/comfyanonymous/ComfyUI"] });
  assertEquals(r.fetched, []);
  assertEquals(r.mapLog?.homepage_fallback, false);
  assertEquals(r.byKey["https://www.linkedin.com/company/comfyui"].outcome, "no_useful_pages");
});

Deno.test("NO MAP ANSWER, NO FALLBACK: an empty map means the site did not answer — nothing is bought", async () => {
  const r = await collect({ map: [] });
  assertEquals(r.fetched, []);
  assertEquals(r.byKey["https://www.linkedin.com/company/comfyui"].outcome, "site_unavailable");
});

Deno.test("THE ROOT IS THE COMPANY'S OWN HOST even when unmapped; a subdomain root never stands in for it", async () => {
  const r = await collect({ map: ["https://docs.comfy.org/", ...COMFY_MAP.slice(2)] });
  assertEquals(r.fetched, ["https://comfy.org/"]);
});

Deno.test("THE MAP LOG CARRIES A BOUNDED SAMPLE, never the whole map", async () => {
  const r = await collect({ map: COMFY_MAP });
  const sample = r.mapLog?.mapped_sample as string[];
  assert(Array.isArray(sample) && sample.length > 0 && sample.length <= MAP_LOG_SAMPLE, JSON.stringify(sample));
  assertEquals(mappedSample(["https://a.com/x", "https://a.com/x", "not a url", "https://a.com/y"], 5), ["/x", "/y"]);
});

Deno.test("THE HOMEPAGE PAGE IS GROUNDED NORMALLY: the verifier re-grounds on it, and its verdict stands as the claim", async () => {
  // The verifier's own contract: a collection with pages_ok > 0 is re-grounded on
  // the stored pages; whatever that grounding decides — PASS, FAIL or PENDING —
  // is the finding. The fallback only makes the page exist.
  const s = state();
  const reground: string[] = [];
  const v = businessModelVerifier({
    collect: async (targets) => (await collect({ map: COMFY_MAP, s, targets: [...targets] })).byKey,
    reground: (key) => { reground.push(key); return Promise.resolve({ status: "plausible", decision: "b2b_saas_supported", skipped: null }); },
    usd_per_credit: RATE.usd_per_credit,
  });
  const out = await v.verify([target("comfyui", "comfy.org")], {
    call: () => Promise.reject(new Error("not used")), ready: () => true, now: () => NOW.toISOString(), log: () => {},
  }, { mission_id: "m", pending: [] });
  assertEquals(reground, ["https://www.linkedin.com/company/comfyui"], "grounding ran on the homepage");
  assertEquals(out.findings[0].detail.pages_ok, 1);
  assertEquals([out.findings[0].detail.status, out.findings[0].detail.decision], ["plausible", "b2b_saas_supported"]);
});

// ═════════════════════════════════════════════════ 2. every Firecrawl call closes ══

Deno.test("A SUCCESSFUL MAP SETTLES: estimate = reservation = settlement = 1 credit × the configured rate", async () => {
  const r = await collect({ map: COMFY_MAP });
  const map = r.s.spend_ledger.reservations.find((x) => x.provider_call_id.includes("map") ||
    r.s.mission_trace.events.some((e) => e.type === "call_executed" && e.detail.actor === "firecrawl_map" && e.provider_call_id === x.provider_call_id))!;
  assertEquals([map.status, map.estimate_usd, map.provisional_usd, map.settled_usd, map.variance_usd, map.settlement_source, map.settlement_stable],
    ["settled", 0.005, 0.005, 0.005, 0, "derived_floor", true]);
  assert(r.s.mission_trace.events.some((e) => e.type === "call_settled" && e.detail.actor === "firecrawl_map"));
});

Deno.test("A SUCCESSFUL PAGE SETTLES the same way", async () => {
  const r = await collect({ map: COMFY_MAP });
  const pageCall = r.s.mission_trace.events.find((e) => e.type === "call_executed" && e.detail.actor === "firecrawl_scrape")!;
  const page = r.s.spend_ledger.reservations.find((x) => x.provider_call_id === pageCall.provider_call_id)!;
  assertEquals([page.status, page.estimate_usd, page.settled_usd, page.settlement_source], ["settled", 0.005, 0.005, "derived_floor"]);
});

Deno.test("FAILURES CLOSE CORRECTLY: a thrown scrape is released (no credit); a scrape that produced no document settles at $0", async () => {
  const thrown = await collect({ map: COMFY_MAP, page: () => { throw new Error("firecrawl 500"); } }).catch(() => null);
  // The runner may surface the throw; either way the ledger must hold no open Firecrawl call.
  const s1 = thrown?.s;
  if (s1) {
    const pageRes = s1.spend_ledger.reservations.filter((x) => x.status !== "settled");
    assert(pageRes.every((x) => x.status === "released"), JSON.stringify(pageRes.map((x) => x.status)));
  }
  const empty = await collect({ map: COMFY_MAP, page: () => ({ ok: false, markdown: "", status: "not_found", status_code: null }) });
  const pageCall = empty.s.mission_trace.events.find((e) => e.type === "call_executed" && e.detail.actor === "firecrawl_scrape")!;
  const page = empty.s.spend_ledger.reservations.find((x) => x.provider_call_id === pageCall.provider_call_id)!;
  assertEquals([page.status, page.settled_usd, page.settlement_source], ["settled", 0, "derived_floor"],
    "no document, no credit — and still closed");
});

Deno.test("A THROWN SCRAPE, DIRECTLY: the reservation is released and nothing stays open", async () => {
  const s = state();
  const fetch = specGovernedPageFetcher({ state: s as never, scope: SCOPE, usd_per_credit: RATE.usd_per_credit,
    send: () => Promise.reject(new Error("firecrawl timeout")) });
  await fetch({ url: "https://comfy.org/", request_id: "r", company_key: "c" }).catch(() => null);
  assertEquals(s.spend_ledger.reservations.map((x) => x.status), ["released"]);
  assertEquals(spendTotals(s.spend_ledger).mission_committed_usd, 0);
});

Deno.test("TERMINAL INVARIANT: after the business-model collection, no Firecrawl call is open on the ledger", async () => {
  const r = await collect({ map: COMFY_MAP });
  const open = r.s.spend_ledger.reservations.filter((x) => x.status === "reserved" || x.status === "executed");
  assertEquals(open, []);
  // Internally consistent: what the mission committed is exactly what settled.
  const settled = r.s.spend_ledger.reservations.reduce((n, x) => n + (x.settled_usd ?? 0), 0);
  assertEquals(Number(settled.toFixed(4)), spendTotals(r.s.spend_ledger).mission_committed_usd);
  assertEquals(spendTotals(r.s.spend_ledger).mission_committed_usd, 0.01, "one map + one page, one credit each at $0.005");
});

Deno.test("PERSISTENCE: the patch carries the Firecrawl settlement as derived_floor; an Apify receipt stays provider_receipt", async () => {
  const r = await collect({ map: COMFY_MAP });
  const patches = settlementPatches(r.s.spend_ledger);
  assertEquals(patches.length, 2);
  for (const p of patches) assertEquals([p.patch.settlement_source, p.patch.settled_usd], ["derived_floor", 0.005]);
  // An Apify call settled from its receipt keeps the receipt's label.
  const s = state();
  s.spend_ledger.reservations.push({ idempotency_key: "k", provider_call_id: "pc", purpose: "discovery", route_id: null,
    candidate_keys: [], estimate_usd: 0.009, status: "executed", provisional_usd: 0.009, settled_usd: null,
    settlement_source: "derived_floor", variance_usd: null, provider_run_id: "run" } as never);
  settle(s.spend_ledger, "k", 0.009);
  assertEquals(settlementPatches(s.spend_ledger)[0].patch.settlement_source, "provider_receipt");
});

Deno.test("THE CONFIGURED RATE IS THE PRICING AUTHORITY: a different account rate moves estimate and settlement together", async () => {
  const s = state();
  const map = specGovernedMapper({ state: s as never, scope: SCOPE, usd_per_credit: 0.002, max_urls: 120, send: () => Promise.resolve(COMFY_MAP) });
  await map({ domain: "comfy.org", company_key: "c" });
  const r = s.spend_ledger.reservations[0];
  assertEquals([r.estimate_usd, r.settled_usd, r.status], [0.002, 0.002, "settled"]);
  // Unpriced under a USD cap: never sent, nothing reserved.
  const u = state();
  let sent = 0;
  const unpriced = specGovernedMapper({ state: u as never, scope: SCOPE, usd_per_credit: null, max_urls: 120, send: () => { sent++; return Promise.resolve([]); } });
  assertEquals(await unpriced({ domain: "comfy.org", company_key: "c" }), []);
  assertEquals([sent, u.spend_ledger.reservations.length], [0, 0]);
});

Deno.test("THE MAP'S LEDGER ROW CARRIES THE SPEC: run-agent sends `provider_call_spec` with the map, as every page fetch does", () => {
  // Canary 3be88a89's map row had no provider_call_id / idempotency_key, so no
  // settlement patch could find it. The row's identity columns come from the
  // spec in the tool input (`specIdentityColumns`).
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const i = src.indexOf('audit_reason: "discover_pages_for_claim"');
  assert(i > 0, "the map send is where it was");
  const send = src.slice(Math.max(0, i - 900), i);
  assert(send.includes("provider_call_spec: spec,"), "the map send must carry its spec");
});
