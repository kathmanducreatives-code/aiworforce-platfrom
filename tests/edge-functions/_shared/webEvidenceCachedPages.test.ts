// A PAGE WE ALREADY HOLD IS NOT LOST TO A MAP THAT MISSED IT, AND A 404 ANSWERS ONLY ITS OWN URL.
//
// Production Fuse AI rerun, task 0553512c (2026-09-27). The verifier mapped
// fuseai.com (118 URLs) and the map resolved ONE page — /company, as "about":
//
//   [pages:map]                          selected: [ "https://fuseai.com/company" ]
//   [pages:evidence-cache-known-missing] url: "https://fuseai.com/about", intent: "about", status: "not_found"
//   [verifier_ran]                       recorded: 0   → no re-grounding, no claim, PENDING
//
// Two defects, both in the runner:
//
//   A  The cache is keyed by INTENT (newest row per intent), so the 404 cached
//      for /about "answered" /company, which was never fetched.
//   B  The fresh /pricing page cached 2026-09-16 — the page the previous run was
//      grounded on — was ignored because this map did not select a pricing URL.
//
// The collector is wired as run-agent's business-model `collect`: the real
// runner, the real spec-governed map and page fetchers on one ledger, the real
// plan and budget; Firecrawl and the cache are scripted. The map is the
// production sample, which the resolver reads exactly as production did.
//
// ZERO network, providers, models or database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cachedPageFor, heldPages, runEvidenceCollection } from "../../../supabase/functions/_shared/webEvidenceRunner.ts";
import { canonicalPageUrl } from "../../../supabase/functions/_shared/webEvidenceStore.ts";
import {
  BUSINESS_MODEL_MAX_PAGES, BUSINESS_MODEL_PAGE_INTENTS, businessModelVerifier, claimPageBudget, claimPageDebts,
  claimPagePlan, type PageCollection,
} from "../../../supabase/functions/_shared/businessModelVerifier.ts";
import {
  specGovernedMapper, specGovernedPageFetcher, webEvidenceCreditRate,
} from "../../../supabase/functions/_shared/webEvidenceSpec.ts";
import { newSpendLedger, resolveCeilings } from "../../../supabase/functions/_shared/budgetPolicy.ts";
import { newMissionTrace } from "../../../supabase/functions/_shared/missionTrace.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import type { VerificationTarget } from "../../../supabase/functions/_shared/claimVerifier.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const SCOPE = { workspace_id: "00000000-0000-4000-a000-000000000001", lineage_id: "0553512c-8e0b-4641-9a18-f91deb68d0ef" };
const RATE = webEvidenceCreditRate(() => undefined, { usd_capped: false }); // production: no account rate
const NOW = new Date("2026-09-27T05:50:00.000Z");
const KEY = "https://www.linkedin.com/company/fuseaicom";

/** The production map's sample, verbatim — the resolver selects only /company from it. */
const RERUN_MAP = [
  "/sitemap.xml", "/founders", "/", "/prospect", "/engage", "/signals", "/marketing", "/rev-ops", "/sales",
  "/blog", "/machine-version", "/company",
].map((p) => `https://fuseai.com${p}`);

type Cached = { source_url: string; source_text: string; fetched_at: string; status: string };
const PRICING_TEXT = "Built for teams running outbound as a repeatable system. Shared team workspace with 5+ seats. 50/seat.";
/** The workspace cache as production held it for fuseai.com (readFreshPages: newest row per intent). */
const PROD_CACHE: Record<string, Cached> = {
  pricing: { source_url: "https://fuseai.com/pricing", source_text: PRICING_TEXT, fetched_at: "2026-09-16T09:42:15.839Z", status: "ok" },
  product: { source_url: "https://fuseai.com/product", source_text: "", fetched_at: "2026-09-16T09:42:06.889Z", status: "not_found" },
  about: { source_url: "https://fuseai.com/about", source_text: "", fetched_at: "2026-09-14T07:17:49.928Z", status: "not_found" },
  homepage: { source_url: "https://fuseai.com/", source_text: "The #1 AI-Native Sales Platform.", fetched_at: "2026-09-15T10:53:01.565Z", status: "ok" },
};

/** The cache as `readFreshPages` returns it: keyed by canonical URL, the intent riding along. */
function byUrl(cache: Record<string, Cached> | Array<Cached & { page_intent: string }>) {
  const rows = Array.isArray(cache) ? cache : Object.entries(cache).map(([page_intent, c]) => ({ ...c, page_intent }));
  return new Map(rows.map((r) => [canonicalPageUrl(r.source_url), r]));
}

type PageResult = { ok: boolean; markdown: string; status: "ok" | "empty" | "blocked" | "not_found" | "timeout"; status_code?: number | null };
const COMPANY_PAGE: PageResult = { ok: true, status: "ok", status_code: 200, markdown: "# Fuse\nWe build the AI sales platform for revenue teams." };

const target = (): VerificationTarget => ({
  company_key: KEY, name: "Fuse AI", domain: "fuseai.com", linkedin_url: KEY,
  criterion: { criterion_id: "industry:b2b_saas", dimension: "industry", value: "b2b saas" },
  graph: buildCompanyEvidenceGraph(KEY, [], { now: NOW }),
});

async function collect(o: { map: string[]; cache: Record<string, Cached> | null; page?: (url: string) => PageResult }) {
  const s = { spend_ledger: newSpendLedger(resolveCeilings(null, false)), mission_trace: newMissionTrace(), retrieval_plans: [{ plan_id: "rp_1", version: 1, mission_hash: "mh" }] };
  const fetched: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const debts = claimPageDebts([target()]);
  const run = await runEvidenceCollection({
    workspace_id: SCOPE.workspace_id, debts,
    budget: claimPageBudget(debts.length, BUSINESS_MODEL_PAGE_INTENTS, BUSINESS_MODEL_MAX_PAGES),
    deps: {
      plan: () => Promise.resolve(claimPagePlan(debts, BUSINESS_MODEL_PAGE_INTENTS)),
      extract: null, db: null, now: () => NOW.toISOString(),
      readCache: o.cache ? () => Promise.resolve(byUrl(o.cache!)) : null,
      fetchPage: specGovernedPageFetcher({
        state: s as never, scope: SCOPE, usd_per_credit: RATE.usd_per_credit,
        send: (spec) => { const url = String(spec.serialized_input.url); fetched.push(url); return Promise.resolve((o.page ?? (() => COMPANY_PAGE))(url)); },
      }),
      mapSite: specGovernedMapper({
        state: s as never, scope: SCOPE, usd_per_credit: RATE.usd_per_credit, max_urls: 120,
        send: () => Promise.resolve(o.map),
      }),
      log: (e, m) => logs.push([e, m]),
    },
  });
  const c = run.companies[0];
  return { run, c, fetched, logs, events: logs.map(([e]) => e), byKey: { [c.company_key]: { pages_ok: c.pages_ok, outcome: c.outcome } as PageCollection } };
}

// ── THE PRODUCTION RERUN, REPLAYED ────────────────────────────────────────────

Deno.test("FUSE RERUN 2: /company is fetched and the held /pricing counts — the claim can be re-read", async () => {
  const r = await collect({ map: RERUN_MAP, cache: PROD_CACHE });
  assertEquals(r.fetched, ["https://fuseai.com/company"], "A: the /about 404 no longer answers /company");
  assertEquals([r.c.pages_reused, r.c.pages_fetched, r.c.pages_known_missing, r.c.pages_ok], [1, 1, 0, 2]);
  assertEquals(r.c.outcome, "collected", "production: recorded 0, no re-grounding");
  assert(r.events.includes("evidence-cache-held"), "B: the pricing page we already hold");
  assert(r.events.includes("evidence-cache-other-url"), "the stale /about entry is named, not silently used");
});

Deno.test("the verifier now re-grounds Fuse AI: pages_ok > 0 reaches the canonical re-read", async () => {
  const reground: string[] = [];
  const v = businessModelVerifier({
    collect: async () => (await collect({ map: RERUN_MAP, cache: PROD_CACHE })).byKey,
    reground: (key) => { reground.push(key); return Promise.resolve({ status: "proven", decision: "accepted", skipped: null }); },
    usd_per_credit: RATE.usd_per_credit,
  });
  const out = await v.verify([target()], {
    call: () => Promise.reject(new Error("not used")), ready: () => true, now: () => NOW.toISOString(), log: () => {},
  }, { mission_id: "m", pending: [] });
  assertEquals(reground, [KEY]);
  assertEquals(out.findings[0].detail.pages_ok, 2);
});

// ── A: A KNOWN-MISSING PAGE ANSWERS ONLY ITS OWN URL ─────────────────────────

Deno.test("A: the same URL cached as not_found is still an answer — never bought twice", async () => {
  const cache = { about: { source_url: "https://fuseai.com/company", source_text: "", fetched_at: "2026-09-20T00:00:00Z", status: "not_found" } };
  const r = await collect({ map: RERUN_MAP, cache });
  assertEquals(r.fetched, []);
  assertEquals([r.c.pages_known_missing, r.c.pages_ok], [1, 0]);
});

Deno.test("A: URL variants (www, trailing slash, query) are the same URL — another URL is not", () => {
  const missing = { source_url: "https://www.fuseai.com/company/", source_text: "", fetched_at: "2026-09-20T00:00:00Z", status: "not_found", page_intent: "about" };
  const cache = byUrl([missing]);
  assert(cachedPageFor(cache, "https://fuseai.com/company") === missing);
  assert(cachedPageFor(cache, "https://fuseai.com/company?ref=nav") === missing);
  assertEquals(cachedPageFor(cache, "https://fuseai.com/about"), undefined);
});

Deno.test("B: a usable page of the same intent at ANOTHER URL does not answer the selected URL — it is fetched, and the cached page is held", async () => {
  // Identity is the URL. /about (ok, cached) is not /company (selected): the map's
  // page is bought, and the page we hold is still read, free.
  const cache = [{ source_url: "https://fuseai.com/about", page_intent: "about", source_text: "About Fuse: the AI sales platform for teams.", fetched_at: "2026-09-20T00:00:00Z", status: "ok" }];
  const r = await collect({ map: RERUN_MAP, cache: cache as never });
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.c.pages_fetched, r.c.pages_reused, r.c.pages_ok], [1, 1, 2]);
});

Deno.test("A: the store's two rows for one intent are two pages — the 404 answers /about only", async () => {
  const cache = [
    { source_url: "https://fuseai.com/about", page_intent: "about", source_text: "", fetched_at: "2026-09-26T07:00:00Z", status: "not_found" },
    { source_url: "https://fuseai.com/company", page_intent: "about", source_text: "About Fuse", fetched_at: "2026-09-20T07:00:00Z", status: "ok" },
  ];
  const r = await collect({ map: RERUN_MAP, cache: cache as never });
  assertEquals(r.fetched, [], "/company is held (cache hit by URL) — nothing is bought");
  assertEquals([r.c.pages_reused, r.c.pages_known_missing, r.c.pages_ok], [1, 0, 1]);
});

// ── B: WHAT WE HOLD COUNTS EVEN WHEN THE MAP MISSES IT ───────────────────────

Deno.test("B: a map that answered nothing still leaves the held pages readable — nothing is bought", async () => {
  const r = await collect({ map: [], cache: PROD_CACHE });
  assertEquals(r.fetched, []);
  assertEquals([r.c.pages_reused, r.c.pages_ok, r.c.outcome], [1, 1, "collected"],
    "previously `site_unavailable` with the pricing page sitting in the cache");
});

Deno.test("B: held pages are only fresh, usable pages of the REQUESTED intents", async () => {
  const cache: Record<string, Cached> = {
    pricing: { ...PROD_CACHE.pricing, status: "not_found", source_text: "" },    // not usable
    careers: { source_url: "https://fuseai.com/careers", source_text: "Join us", fetched_at: "2026-09-20T00:00:00Z", status: "ok" }, // not requested
    homepage: PROD_CACHE.homepage,                                                // not a business-model intent
  };
  const r = await collect({ map: [], cache });
  assertEquals([r.c.pages_reused, r.c.pages_ok, r.c.outcome], [0, 0, "site_unavailable"], "unchanged when nothing usable is held");
});

Deno.test("B: a held page the map ALSO selected is read once, not twice", async () => {
  const r = await collect({ map: [...RERUN_MAP, "https://fuseai.com/pricing"], cache: PROD_CACHE });
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.c.pages_reused, r.c.pages_ok], [1, 2]);
  assertEquals(r.logs.filter(([e, m]) => (e === "evidence-cache-held" || e === "evidence-cache-hit") && m.intent === "pricing").length, 1);
});

Deno.test("B: the map picks a sibling URL (/pricing-2, a 404) — the fresh /pricing we hold is still read", async () => {
  // Held by intent, identified by URL: a map selecting ANOTHER pricing URL no
  // longer hides the pricing page the cache holds. Before, the selected intent
  // excluded it and this company reached the grounder with no pricing page.
  const cache = [{ source_url: "https://fuseai.com/pricing", page_intent: "pricing", source_text: PRICING_TEXT, fetched_at: "2026-09-16T09:42:15.839Z", status: "ok" }];
  const r = await collect({
    map: ["https://fuseai.com/pricing-2"], cache: cache as never,
    page: () => ({ ok: false, markdown: "", status: "not_found", status_code: 404 }),
  });
  assertEquals(r.fetched, ["https://fuseai.com/pricing-2"], "the selected URL is its own page, asked once");
  assertEquals([r.c.pages_reused, r.c.pages_ok, r.c.outcome], [1, 1, "collected"]);
});

Deno.test("B: a map selecting ANOTHER URL of an intent does not hide the fresh page held for it", () => {
  const cache = byUrl([{ source_url: "https://fuseai.com/pricing", page_intent: "pricing", source_text: "50/seat", fetched_at: "2026-09-16T00:00:00Z", status: "ok" }]);
  const held = heldPages(cache, ["pricing", "product"], ["https://fuseai.com/pricing-2"]);
  assertEquals(held.map((h) => [h.intent, h.hit.source_url]), [["pricing", "https://fuseai.com/pricing"]]);
  assertEquals(heldPages(cache, ["pricing"], ["https://www.fuseai.com/pricing/"]), [], "the map's own URL is read once, as a hit");
});

Deno.test("B: of several fresh pages for one intent, the newest is held", () => {
  const cache = byUrl([
    { source_url: "https://fuseai.com/pricing", page_intent: "pricing", source_text: "old", fetched_at: "2026-09-10T00:00:00Z", status: "ok" },
    { source_url: "https://fuseai.com/plans", page_intent: "pricing", source_text: "new", fetched_at: "2026-09-16T00:00:00Z", status: "ok" },
  ]);
  assertEquals(heldPages(cache, ["pricing"], []).map((h) => h.hit.source_text), ["new"]);
});

Deno.test("no cache at all: exactly the old behaviour — the selected page is bought", async () => {
  const r = await collect({ map: RERUN_MAP, cache: null });
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.c.pages_reused, r.c.pages_ok], [0, 1]);
});
