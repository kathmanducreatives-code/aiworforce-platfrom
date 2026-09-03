// THE SAME PAGE MUST NOT BE BOUGHT TWICE.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage 40295080, the first live P2 run: 120 Firecrawl requests for 24
// distinct URLs. Metaview, Pump.co and Kody were fetched in NINE consecutive
// slices — the same three pages each time.
//
// The cause was a phase boundary, not a coding error. P2 writes the cache and
// P3 was to read it. But P2 deliberately does not change a qualification
// outcome, so a researched company stays `insufficient_evidence`, the gate
// raises the identical debt next slice, and with nothing reading the cache the
// run buys the pages again. P2 without a read loops by construction.
//
// Two independent stops, tested separately because they fail differently:
//
//   1. THE GATE — a company already researched for this requirement raises no
//      debt at all. Stops the loop.
//   2. THE FETCH — a page already held fresh is reused even when a debt IS
//      raised, by a different requirement or a different mission. Stops the
//      duplication the gate cannot see.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeEvidenceDebts } from "../../supabase/functions/_shared/webEvidenceDebt.ts";
import {
  runEvidenceCollection, type CacheReader,
} from "../../supabase/functions/_shared/webEvidenceRunner.ts";
import {
  isFresh, ttlHoursFor, toStoredRows,
} from "../../supabase/functions/_shared/webEvidenceStore.ts";
import {
  looksLikeMissingPage, MISSING_PAGE_MAX_CHARS,
} from "../../supabase/functions/_shared/pageIntentResolver.ts";
import type { EvidenceDebt } from "../../supabase/functions/_shared/webEvidenceDebt.ts";
import type { MissionEvaluation } from "../../supabase/functions/_shared/missionEvaluation.ts";

const debt = (key: string): EvidenceDebt => ({
  company_key: key, company_name: key, domain: `${key}.com`,
  requirement_id: `req-${key}`,
  open_question: `Whether ${key} is a B2B SaaS company`,
  known_evidence_types: [], match_score: 82,
});

const evaluation = (): MissionEvaluation => ({
  version: "mission-evaluation-v1", decision: "insufficient_evidence",
  mission_fit: "review", icp_fit: "plausible", hiring_fit: "verified",
  confidence: 0.9, match_score: 82, matched_requirements: [],
  failed_requirements: [], reasoning: "", rejection_reasons: [],
  evidence_quality: "strong",
  unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"],
  next_action: null,
} as MissionEvaluation);

const candidate = () => ({
  key: "metaview",
  company: { company_name: "Metaview" },
  enriched: { company_name: "Metaview", canonical_domain: "metaview.ai" },
  mission_evaluation: evaluation(),
  identity: { status: "verified_match" },
  known_evidence_types: [],
});

const plan1 = (key: string, intents: string[]) => () =>
  Promise.resolve({ plans: [{ company_key: key, research_question: "q", page_intents: intents }] });

// ─────────────────────────── 1. the gate stops it ───────────────────────────

Deno.test("THE LOOP: an already-researched requirement raises no debt", () => {
  const first = computeEvidenceDebts([candidate()], { max_companies: 5 });
  assertEquals(first.debts.length, 1, "first slice must raise the debt");
  const rid = first.debts[0].requirement_id;

  // Second slice, same unchanged company — this is exactly the state that
  // produced nine repeated fetches in 40295080.
  const second = computeEvidenceDebts([candidate()], {
    max_companies: 5,
    already_researched: new Set([`metaview:${rid}`]),
  });
  assertEquals(second.debts.length, 0, "the loop must stop here");
});

Deno.test("nine identical slices produce one debt, not nine", () => {
  let researched = new Set<string>();
  let raised = 0;
  for (let slice = 0; slice < 9; slice++) {
    const r = computeEvidenceDebts([candidate()], {
      max_companies: 5, already_researched: researched,
    });
    raised += r.debts.length;
    for (const d of r.debts) {
      researched = new Set([...researched, `${d.company_key}:${d.requirement_id}`]);
    }
  }
  assertEquals(raised, 1, "40295080 raised it nine times");
});

Deno.test("a DIFFERENT requirement on the same company still raises a debt", () => {
  // Reuse must not become suppression: a new question is new work.
  const first = computeEvidenceDebts([candidate()], { max_companies: 5 });
  const other = {
    ...candidate(),
    mission_evaluation: {
      ...evaluation(),
      unknown_fields: ["Whether Metaview sells to banks"],
    } as MissionEvaluation,
  };
  const second = computeEvidenceDebts([other], {
    max_companies: 5,
    already_researched: new Set([`metaview:${first.debts[0].requirement_id}`]),
  });
  assertEquals(second.debts.length, 1);
});

// ────────────────────────── 2. the fetch layer stops it ─────────────────────

const cacheWith = (intents: Record<string, string>): CacheReader => () =>
  Promise.resolve(new Map(Object.entries(intents).map(([intent, text]) => [
    intent,
    {
      source_url: `https://x.com/${intent}`, source_text: text,
      fetched_at: "2026-09-03T00:00:00Z",
      // A cached page is only reusable EVIDENCE when it succeeded. Absences are
      // cached too now — see webEvidenceNegativeCache.test.ts — and they stop a
      // fetch without being reused, so this helper has to say which it is.
      status: "ok",
    },
  ])));

Deno.test("THE LOOP: a fresh cached page is reused, never re-fetched", async () => {
  let fetched = 0;
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("metaview")],
    deps: {
      plan: plan1("metaview", ["pricing", "product"]),
      extract: () => Promise.resolve({ claims: [] }),
      fetchPage: () => { fetched++; return Promise.resolve({ ok: true, markdown: "new", status: "ok" as const }); },
      readCache: cacheWith({ pricing: "cached pricing text", product: "cached product text" }),
    },
  });
  assertEquals(fetched, 0, "both pages were held fresh — nothing may be bought");
  assertEquals(r.pages_reused, 2);
  assertEquals(r.pages_fetched, 0);
});

Deno.test("a partial cache buys only the missing page", async () => {
  const urls: string[] = [];
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("metaview")],
    deps: {
      plan: plan1("metaview", ["pricing", "product"]),
      extract: () => Promise.resolve({ claims: [] }),
      fetchPage: (i) => { urls.push(i.url); return Promise.resolve({ ok: true, markdown: "new", status: "ok" as const }); },
      readCache: cacheWith({ pricing: "cached pricing" }),
    },
  });
  assertEquals(r.pages_reused, 1);
  assertEquals(r.pages_fetched, 1);
  assertEquals(urls, ["https://metaview.com/product"]);
});

Deno.test("reused pages still reach the extractor", async () => {
  let seen: string[] = [];
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("metaview")],
    deps: {
      plan: plan1("metaview", ["pricing"]),
      extract: (p) => {
        seen = ((p as { pages?: Array<{ content: string }> }).pages ?? []).map((x) => x.content);
        return Promise.resolve({ claims: [] });
      },
      fetchPage: () => Promise.resolve({ ok: true, markdown: "fresh", status: "ok" as const }),
      readCache: cacheWith({ pricing: "cached pricing text" }),
    },
  });
  assertEquals(seen, ["cached pricing text"], "a cache hit is evidence, not a skip");
});

Deno.test("a cache read that throws degrades to buying, not failing", async () => {
  let fetched = 0;
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("metaview")],
    deps: {
      plan: plan1("metaview", ["pricing"]),
      extract: () => Promise.resolve({ claims: [] }),
      fetchPage: () => { fetched++; return Promise.resolve({ ok: true, markdown: "x", status: "ok" as const }); },
      readCache: () => { throw new Error("db down"); },
    },
  });
  assertEquals(fetched, 1);
  assertEquals(r.pages_fetched, 1);
});

// ───────────────────────────── freshness policy ─────────────────────────────

Deno.test("freshness is per intent and stale pages are re-bought", () => {
  const now = Date.parse("2026-09-03T00:00:00Z");
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
  assert(isFresh(hoursAgo(100), "pricing", now), "pricing lasts 30 days");
  assert(!isFresh(hoursAgo(100), "careers", now), "careers lasts 72h");
  assertEquals(ttlHoursFor("careers"), 72);
  assertEquals(ttlHoursFor("unknown_intent"), 720);
});

// ─────────────────────── soft 404s must not become evidence ─────────────────

Deno.test("the three soft 404s from run 40295080 are recognised", () => {
  // Verbatim openings of what that run actually stored as `status: ok`.
  for (const body of [
    "# 404 - Page not found [Visit Home](https://www.hebbia.com/)",
    "Error 404 # This page took a path we can't trace. The page you're looking for has moved or no longer exists.",
    "# Whoops, that page is gone. Can't find what you were looking for? We can't either.",
  ]) {
    assert(looksLikeMissingPage(body), `must be recognised: ${body.slice(0, 40)}`);
  }
});

Deno.test("a long page mentioning 404 is still a real page", () => {
  const doc = "Our API returns a 404 when the resource is absent. " +
    "x".repeat(MISSING_PAGE_MAX_CHARS);
  assert(!looksLikeMissingPage(doc), "length is what keeps this conservative");
});

Deno.test("a reported 4xx decides without the heuristic", () => {
  assert(looksLikeMissingPage("a perfectly normal looking page body", 404));
  assert(!looksLikeMissingPage("a perfectly normal looking page body", 200));
});

Deno.test("a soft 404 is not usable and its text is not stored", async () => {
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("hebbia")],
    deps: {
      plan: plan1("hebbia", ["locations"]),
      extract: () => { throw new Error("extractor must not see a 404 body"); },
      fetchPage: () => Promise.resolve({
        ok: true, markdown: "# 404 - Page not found", status: "ok" as const,
      }),
    },
  });
  assertEquals(r.companies[0].pages_ok, 0);
  assertEquals(r.companies[0].outcome, "site_unavailable");
  assertEquals(r.claims_kept, 0);
});

// ─────────────────────────── provenance on the row ──────────────────────────

Deno.test("stored rows carry the requirement that prompted the fetch", () => {
  const rows = toStoredRows({
    workspace_id: "w", company_key: "metaview", domain: "metaview.ai",
    requirement_id: "req-abc",
    pages: [{
      url: "https://metaview.ai/pricing", intent: "pricing",
      markdown: "text", fetched_at: "2026-09-03T00:00:00Z", status: "ok",
    }],
  });
  assertEquals(rows[0].requirement_id, "req-abc");
  // The row is still a PAGE: the requirement is provenance, not the answer.
  assertEquals(rows[0].source_text, "text");
  assertEquals(rows[0].page_intent, "pricing");
});
