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
import { cachedAnswerFor, runEvidenceCollection } from "../../../supabase/functions/_shared/webEvidenceRunner.ts";
import {
  BUSINESS_MODEL_MAX_PAGES, BUSINESS_MODEL_PAGE_INTENTS, claimPageBudget, claimPageDebts, claimPagePlan, type PageCollection,
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
      readCache: o.cache ? () => Promise.resolve(new Map(Object.entries(o.cache!))) : null,
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

// ── THE PRODUCTION RERUN: /company IS FETCHED ────────────────────────────────

Deno.test("FUSE RERUN 2 (A): the /about 404 no longer answers /company — it is fetched and read", async () => {
  const r = await collect({ map: RERUN_MAP, cache: PROD_CACHE });
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.c.pages_fetched, r.c.pages_known_missing, r.c.pages_ok, r.c.outcome], [1, 0, 1, "collected"]);
  assert(r.events.includes("evidence-cache-other-url"), "the stale /about entry is named, not silently used");
});

// ── A: A KNOWN-MISSING PAGE ANSWERS ONLY ITS OWN URL ─────────────────────────

Deno.test("A: the same URL cached as not_found is still an answer — never bought twice", async () => {
  const cache = { about: { source_url: "https://fuseai.com/company", source_text: "", fetched_at: "2026-09-20T00:00:00Z", status: "not_found" } };
  const r = await collect({ map: RERUN_MAP, cache });
  assertEquals(r.fetched, []);
  assertEquals([r.c.pages_known_missing, r.c.pages_ok], [1, 0]);
});

Deno.test("A: URL variants (www, trailing slash, query) are the same URL", () => {
  const missing = { source_url: "https://www.fuseai.com/company/", source_text: "", status: "not_found" };
  assert(cachedAnswerFor(missing, "https://fuseai.com/company") === missing);
  assert(cachedAnswerFor(missing, "https://fuseai.com/company?ref=nav") === missing);
  assertEquals(cachedAnswerFor(missing, "https://fuseai.com/about"), undefined);
  assertEquals(cachedAnswerFor(undefined, "https://fuseai.com/about"), undefined);
});

Deno.test("A: a USABLE page cached under the intent is still reused for free, whatever URL the map chose", async () => {
  const cache = { about: { source_url: "https://fuseai.com/about", source_text: "About Fuse: the AI sales platform for teams.", fetched_at: "2026-09-20T00:00:00Z", status: "ok" } };
  const r = await collect({ map: RERUN_MAP, cache });
  assertEquals(r.fetched, [], "unchanged: an ok page of the intent is not re-bought");
  assertEquals([r.c.pages_reused, r.c.pages_ok], [1, 1]);
});

Deno.test("no cache at all: exactly the old behaviour — the selected page is bought", async () => {
  const r = await collect({ map: RERUN_MAP, cache: null });
  assertEquals(r.fetched, ["https://fuseai.com/company"]);
  assertEquals([r.c.pages_reused, r.c.pages_ok], [0, 1]);
});
