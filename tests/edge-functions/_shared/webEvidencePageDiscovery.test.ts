// PAGES ARE DISCOVERED, NOT GUESSED.
//
// Live run 3bc526e2 bought twelve first-party pages from a table of
// conventional paths and seven were 404s. Studycast's /product, /pricing and
// /customers all missed, so the one company the verifier most needed evidence
// for got none, and its business-model claim could never be settled. The
// resolver's own comment had admitted the gap: "only the first candidate path
// is fetched at P2, and `/map`-based recovery is a later phase."
//
// This is that phase. The conventional paths survive as MATCHERS against the
// URLs a site really exposes; they no longer fabricate URLs.
//
// PURE — no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolvePages, resolvePagesFromMap,
} from "../../../supabase/functions/_shared/pageIntentResolver.ts";
import type { PageIntent } from "../../../supabase/functions/_shared/evidenceRequest.ts";

const DOMAIN = "acme.test";
const INTENTS: PageIntent[] = ["homepage", "product", "pricing", "customers", "about"];

/** A realistic map: real pages, an app surface, a legal page, and off-site links. */
const MAP = [
  "https://acme.test/",
  "https://acme.test/platform/overview",
  "https://acme.test/pricing",
  "https://acme.test/about",
  "https://acme.test/blog/why-we-built-this",
  "https://acme.test/login",
  "https://acme.test/privacy",
  "https://app.acme.test/dashboard",
  "https://twitter.com/acme",
  "https://acme.test/careers",
];

Deno.test("only URLs the site actually exposes are selected", () => {
  const sel = resolvePagesFromMap(DOMAIN, INTENTS, MAP, 6);
  const urls = sel.map((s) => s.url);
  for (const u of urls) assert(MAP.includes(u), `${u} was not in the map — it was fabricated`);
  // `/customers` is NOT in the map, so nothing is bought for that intent.
  assertEquals(urls.some((u) => u.includes("/customers")), false,
    "a missing page must not be guessed into existence");
});

Deno.test("a real page wins even when its path is not the conventional one", () => {
  // The site serves /platform/overview, not /product. Guessing bought a 404.
  const sel = resolvePagesFromMap(DOMAIN, ["product"], MAP, 3);
  assertEquals(sel.map((s) => s.url), ["https://acme.test/platform/overview"]);
});

Deno.test("off-domain and app/legal surfaces are refused", () => {
  const sel = resolvePagesFromMap(DOMAIN, INTENTS, MAP, 10);
  const urls = sel.map((s) => s.url);
  for (const bad of [
    "https://twitter.com/acme", "https://app.acme.test/dashboard",
    "https://acme.test/login", "https://acme.test/privacy",
  ]) {
    assertEquals(urls.includes(bad), false, `${bad} must never earn page budget`);
  }
});

Deno.test("the selected page count is bounded, and the cap is honoured exactly", () => {
  for (const cap of [1, 2, 3]) {
    assertEquals(resolvePagesFromMap(DOMAIN, INTENTS, MAP, cap).length <= cap, true, `cap ${cap}`);
  }
  assertEquals(resolvePagesFromMap(DOMAIN, INTENTS, MAP, 0).length, 0);
});

Deno.test("one page is never bought twice, whatever asks for it", () => {
  // `customers` and `case_studies` share conventional paths.
  const sel = resolvePagesFromMap(
    "acme.test", ["customers", "case_studies"],
    ["https://acme.test/case-studies"], 5,
  );
  assertEquals(sel.length, 1, "two intents sharing one real page buy it once");
});

Deno.test("intent priority is the caller's order", () => {
  const sel = resolvePagesFromMap(DOMAIN, ["pricing", "about"], MAP, 2);
  assertEquals(sel.map((s) => s.intent), ["pricing", "about"]);
});

// ── FAILING SAFELY ───────────────────────────────────────────────────────────

Deno.test("an empty, malformed or useless map buys NOTHING", () => {
  for (const [name, map] of [
    ["empty", []],
    ["not an array", null as unknown as string[]],
    ["junk entries", [null, 3, {}, "", "not a url"] as unknown as string[]],
    ["entirely off-site", ["https://twitter.com/acme", "https://news.ycombinator.com/x"]],
    ["only excluded paths", ["https://acme.test/login", "https://acme.test/terms"]],
  ] as Array<[string, string[]]>) {
    assertEquals(resolvePagesFromMap(DOMAIN, INTENTS, map, 5), [], name);
  }
});

Deno.test("no evidence is PENDING, never FAIL — the resolver returns nothing and says nothing", () => {
  // The resolver's ONLY failure mode is an empty list. It cannot express a
  // verdict, so "we could not find a page" can never become "this company is
  // not B2B SaaS".
  const sel = resolvePagesFromMap(DOMAIN, INTENTS, [], 5);
  assertEquals(sel, []);
  assertEquals(Array.isArray(sel), true);
});

Deno.test("a bad domain is refused before any URL is built", () => {
  for (const d of ["", "   ", "not a domain", "http://"]) {
    assertEquals(resolvePagesFromMap(d, INTENTS, MAP, 5), [], d);
  }
});

// ── V1 / COMPANY BRAIN IS NOT CHANGED ────────────────────────────────────────

Deno.test("the conventional-path resolver still behaves exactly as before", () => {
  // V1 callers pass no map and must be untouched: same paths, same order, same
  // dedup. This is the behaviour the Company Brain and the legacy evidence
  // route still depend on.
  const sel = resolvePages("acme.test", ["homepage", "pricing", "product"], 5);
  assertEquals(sel.map((s) => s.url), [
    "https://acme.test/",
    "https://acme.test/pricing",
    "https://acme.test/product",
  ]);
  // NOTE the difference from the map path: these two intents have DIFFERENT
  // first conventional paths (/customers, /case-studies), so V1 buys both. Only
  // the map path can know they are the same page, because only it sees which
  // one the site actually serves. Asserting V1's real behaviour here is the
  // point — this test exists to catch an accidental change to it.
  assertEquals(
    resolvePages("acme.test", ["customers", "case_studies"], 5).map((s) => s.url),
    ["https://acme.test/customers", "https://acme.test/case-studies"],
  );
});

Deno.test("the runner maps before it scrapes, and only for the canonical path", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/webEvidenceRunner.ts", import.meta.url),
  );
  const map = src.indexOf("i.deps.mapSite");
  const fetch = src.indexOf("i.deps.fetchPage");
  assert(map > 0 && fetch > 0);
  assert(map < fetch, "the map must be consulted before any page is fetched");
  // A caller that passes no mapper keeps the old path — V1 is opt-out by default.
  assert(src.includes("targets = resolvePages(req.domain, req.page_intents, allowance);"),
    "the conventional resolver must remain for callers without a mapper");
  // A map that returned nothing is reported, not guessed around.
  assert(src.includes('? "site_unavailable"') && src.includes(': "no_useful_pages"'),
    "an unmapped or useless site must be reported in the existing vocabulary");
});

Deno.test("the map itself is a metered, budgeted provider call", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const m = src.indexOf("mapSite: async ({ domain }");
  assert(m > 0, "the canonical verifier must supply a mapper");
  const body = src.slice(m, m + 1200);
  assert(body.includes('runTool("scrape_url"'), "the map goes through the paid tool path");
  assert(body.includes('capability_key: "web_evidence_verification"'), "under the claim's capability");
  assert(body.includes("auditOwnership()"), "and is attributed in the ledger");
  assert(body.includes("MAP_MAX_URLS"), "the returned list is bounded");
});
