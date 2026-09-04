// A PAGE THAT IS NOT THERE IS AN ANSWER, AND IT MUST BE REMEMBERED.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage d3a79c32, with the first loop fix already deployed: 44 Firecrawl
// calls for 21 distinct URLs. Per domain:
//
//     diligencevault.com   16 calls →  4 URLs →  1 stored row
//     volody.com            7 calls →  3 URLs →  0 stored rows
//     utila.io              3 calls →  3 URLs →  0 stored rows
//
// The companies that reused cleanly were the ones whose pages RESOLVED. The
// ones that looped were the ones whose pages do not exist.
//
// The runner wrote only pages carrying text:
//
//     pages: pages.filter((p) => p.markdown.trim().length > 0)
//
// and set `markdown` to "" for anything unusable. So a 404, an empty body or a
// blocked page stored NOTHING — no row, no record that we had asked — and the
// cache had nothing to say when the next slice came round.
//
// The schema had already said this was wrong, in its own comment:
//
//     "an empty or blocked page is a recorded observation, not a failure to
//      hide … a missing row would look like we never asked."
//
// The tests below would all have passed before this fix, because every cache
// test written for it used pages that succeed. That is the gap.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runEvidenceCollection, type CacheReader,
} from "../../supabase/functions/_shared/webEvidenceRunner.ts";
import { toStoredRows } from "../../supabase/functions/_shared/webEvidenceStore.ts";
import type { EvidenceDebt } from "../../supabase/functions/_shared/webEvidenceDebt.ts";
import type { WebEvidencePage } from "../../supabase/functions/_shared/evidenceRequest.ts";

const debt = (key: string): EvidenceDebt => ({
  company_key: key, company_name: key, domain: `${key}.com`,
  requirement_id: `req-${key}`,
  open_question: `Whether ${key} is a B2B SaaS company`,
  known_evidence_types: [], match_score: 80,
});

const plan = (key: string, intents: string[]) => () =>
  Promise.resolve({ plans: [{ company_key: key, research_question: "q", page_intents: intents }] });

const noClaims = () => Promise.resolve({ claims: [] });

const cache = (
  entries: Record<string, { text: string; status: string }>,
): CacheReader =>
() =>
  Promise.resolve(new Map(Object.entries(entries).map(([intent, v]) => [intent, {
    source_url: `https://x.com/${intent}`,
    source_text: v.text,
    fetched_at: "2026-09-03T10:00:00Z",
    status: v.status,
  }])));

// ─────────────────── the write side: nothing is forgotten ───────────────────

Deno.test("THE LOOP: an unusable page is still written to the cache", async () => {
  // Accumulated across calls, not captured from one. Pages are written ONE AT A
  // TIME the moment each is fetched — batching to the end of the company is
  // where a deadline lands, and lineage b1348724 bought `pump.co/about` three
  // times because two earlier fetches died before the batch write ran.
  const writes: unknown[][] = [];
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("volody")],
    deps: {
      plan: plan("volody", ["pricing", "product", "customers"]),
      extract: noClaims,
      // Every page is a 404 — volody.com's exact shape in d3a79c32.
      fetchPage: () => Promise.resolve({
        ok: true, markdown: "# 404 - Page not found", status: "ok" as const,
      }),
      db: {
        from: () => ({
          upsert: (rows: unknown[]) => {
            writes.push(rows);
            return Promise.resolve({ error: null });
          },
        }),
      } as never,
    },
  });
  const written = writes.flat() as Array<{ status: string; source_text: string }>;
  assertEquals(written.length, 3, "volody.com stored 0 rows for 7 calls");
  // ONE PAGE PER WRITE: the property that makes an interrupted slice lose at
  // most the page it was mid-fetch on, rather than every page before it.
  assertEquals(writes.length, 3, "each page persists on its own, as it is fetched");
  for (const w of writes) assertEquals(w.length, 1);
  for (const r of written) {
    assertEquals(r.status, "not_found");
    assertEquals(r.source_text, "", "a 404 body is never stored as text");
  }
});

Deno.test("toStoredRows keeps unusable pages instead of dropping them", () => {
  const rows = toStoredRows({
    workspace_id: "w", company_key: "c", domain: "x.com", requirement_id: "r",
    pages: [
      { url: "https://x.com/pricing", intent: "pricing", markdown: "real text",
        fetched_at: "2026-09-03T10:00:00Z", status: "ok" },
      { url: "https://x.com/product", intent: "product", markdown: "",
        fetched_at: "2026-09-03T10:00:00Z", status: "not_found" },
    ],
  });
  assertEquals(rows.length, 2);
  assertEquals(rows.map((r) => r.status).sort(), ["not_found", "ok"]);
});

// ─────────────────── the read side: a known absence stops a buy ─────────────

Deno.test("THE LOOP: a known-absent page is not bought again", async () => {
  let fetched = 0;
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("diligencevault")],
    deps: {
      plan: plan("diligencevault", ["pricing", "product", "customers"]),
      extract: noClaims,
      fetchPage: () => { fetched++; return Promise.resolve({ ok: true, markdown: "x", status: "ok" as const }); },
      readCache: cache({
        pricing: { text: "", status: "not_found" },
        product: { text: "", status: "blocked" },
        customers: { text: "", status: "empty" },
      }),
    },
  });
  assertEquals(fetched, 0, "16 calls for 4 URLs is what this prevents");
  assertEquals(r.pages_known_missing, 3);
  assertEquals(r.pages_reused, 0, "an absence is not reuse");
  assertEquals(r.claims_kept, 0);
});

Deno.test("a known-absent page is never shown to the extractor", async () => {
  let sawPages = -1;
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("x")],
    deps: {
      plan: plan("x", ["pricing", "product"]),
      extract: (p) => {
        sawPages = ((p as { pages?: unknown[] }).pages ?? []).length;
        return Promise.resolve({ claims: [] });
      },
      fetchPage: () => Promise.resolve({ ok: true, markdown: "real body", status: "ok" as const }),
      readCache: cache({ pricing: { text: "", status: "not_found" } }),
    },
  });
  // Only the product page it actually fetched. The absent pricing page is a
  // reason not to spend, never a page to reason from.
  assertEquals(sawPages, 1);
});

Deno.test("absence and evidence are counted apart", async () => {
  const r = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("x")],
    deps: {
      plan: plan("x", ["pricing", "product", "customers"]),
      extract: noClaims,
      fetchPage: () => Promise.resolve({ ok: true, markdown: "bought", status: "ok" as const }),
      readCache: cache({
        pricing: { text: "cached real text", status: "ok" },
        product: { text: "", status: "not_found" },
      }),
    },
  });
  assertEquals(r.pages_reused, 1, "the ok page");
  assertEquals(r.pages_known_missing, 1, "the 404");
  assertEquals(r.pages_fetched, 1, "only customers was missing from cache");
});

Deno.test("a cache hit is never re-written as a fresh observation", async () => {
  const written: unknown[] = [];
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("x")],
    deps: {
      plan: plan("x", ["pricing", "product"]),
      extract: noClaims,
      fetchPage: () => Promise.resolve({ ok: true, markdown: "bought", status: "ok" as const }),
      readCache: cache({ pricing: { text: "cached", status: "ok" } }),
      db: {
        from: () => ({
          upsert: (rows: unknown[]) => { written.push(...rows); return Promise.resolve({ error: null }); },
        }),
      } as never,
    },
  });
  assertEquals(written.length, 1, "only the page actually fetched");
  assertEquals((written[0] as { page_intent: string }).page_intent, "product");
});

// ──────────────────────── the full d3a79c32 shape ───────────────────────────

Deno.test("nine slices against an all-404 site buy the pages once", async () => {
  // diligencevault.com's real shape: pages that never resolve, revisited every
  // slice because P2 does not change a qualification outcome.
  const store = new Map<string, { text: string; status: string }>();
  let fetched = 0;
  for (let slice = 0; slice < 9; slice++) {
    await runEvidenceCollection({
      workspace_id: "w", debts: [debt("diligencevault")],
      deps: {
        plan: plan("diligencevault", ["pricing", "product", "customers"]),
        extract: noClaims,
        fetchPage: () => {
          fetched++;
          return Promise.resolve({ ok: true, markdown: "# 404 - Page not found", status: "ok" as const });
        },
        readCache: () =>
          Promise.resolve(new Map([...store].map(([intent, v]) => [intent, {
            source_url: `https://diligencevault.com/${intent}`,
            source_text: v.text, fetched_at: new Date().toISOString(), status: v.status,
          }]))),
        db: {
          from: () => ({
            upsert: (rows: unknown[]) => {
              for (const r of rows as Array<{ page_intent: string; source_text: string; status: string }>) {
                store.set(r.page_intent, { text: r.source_text, status: r.status });
              }
              return Promise.resolve({ error: null });
            },
          }),
        } as never,
      },
    });
  }
  assertEquals(fetched, 3, "d3a79c32 bought these 16 times");
  assertEquals(store.size, 3, "and remembered none of them");
});

// ─────────────── the real lookup, not an injected stand-in ──────────────────
//
// Every test above injects `readCache`, so none of them touch the SQL that
// actually decides what comes back. Reverting `readFreshPages` to its old
// `.eq("status", "ok")` filter left all seven of them green — the exact filter
// that caused d3a79c32. These exercise the query builder itself.

import { readFreshPages } from "../../supabase/functions/_shared/webEvidenceStore.ts";

function fakeDb(rows: Array<Record<string, unknown>>) {
  const filters: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
    order: () => builder,
    limit: () => Promise.resolve({
      // Apply only the filters the caller actually asked for, so a status
      // filter added back to the query changes what this returns.
      data: rows.filter((r) =>
        filters.every(([c, v]) => c === "workspace_id" || c === "domain" || r[c] === v)),
      error: null,
    }),
  };
  return { from: () => builder } as never;
}

Deno.test("readFreshPages returns absences, not only successes", async () => {
  const now = Date.parse("2026-09-03T12:00:00Z");
  const fresh = "2026-09-03T11:00:00Z";
  const got = await readFreshPages(
    fakeDb([
      { source_url: "https://x.com/pricing", page_intent: "pricing",
        source_text: "real", fetched_at: fresh, status: "ok" },
      { source_url: "https://x.com/product", page_intent: "product",
        source_text: "", fetched_at: fresh, status: "not_found" },
      { source_url: "https://x.com/about", page_intent: "about",
        source_text: "", fetched_at: fresh, status: "blocked" },
    ]),
    { workspace_id: "w", domain: "x.com", now },
  );
  assertEquals(got.size, 3, "a status filter here is what caused d3a79c32");
  assertEquals(got.get("product")?.status, "not_found");
  assertEquals(got.get("about")?.status, "blocked");
  assertEquals(got.get("pricing")?.status, "ok");
});

Deno.test("readFreshPages still drops stale rows whatever their status", async () => {
  const now = Date.parse("2026-09-03T12:00:00Z");
  const got = await readFreshPages(
    fakeDb([
      // careers TTL is 72h; this is four days old.
      { source_url: "https://x.com/careers", page_intent: "careers",
        source_text: "", fetched_at: "2026-08-30T12:00:00Z", status: "not_found" },
    ]),
    { workspace_id: "w", domain: "x.com", now },
  );
  assertEquals(got.size, 0, "an absence expires like anything else");
});

// ── AN INTERRUPTED SLICE KEEPS WHAT IT ALREADY BOUGHT ───────────────────────
//
// Lineage b1348724 bought 24 pages for 17 URLs. `pump.co/about` three times:
//
//     16:58:00  call started    -> never finalized, no row
//     18:35:09  call succeeded  -> no row
//     18:47:13  call succeeded  -> row written 18:47:16
//
// The write was batched to the end of the company, so a slice that died
// part-way lost every page it had fetched, and the next slice bought them
// again. This is the regression test for that.

Deno.test("a slice that dies mid-company keeps the pages already fetched", async () => {
  const persisted: Array<{ source_url: string }> = [];
  let fetches = 0;
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan("pump", ["pricing", "product", "customers"]),
      extract: noClaims,
      fetchPage: (i) => {
        fetches++;
        // The third fetch dies the way an Edge slice does: mid-call, after two
        // pages have already been bought.
        if (fetches === 3) throw new Error("execution deadline reached");
        return Promise.resolve({ ok: true, markdown: `body ${i.url}`, status: "ok" as const });
      },
      db: {
        from: () => ({
          upsert: (rows: unknown[]) => {
            persisted.push(...(rows as Array<{ source_url: string }>));
            return Promise.resolve({ error: null });
          },
        }),
      } as never,
    },
  });
  // Under the old batched write this was ZERO: the two paid-for pages died with
  // the slice and were re-bought next time.
  assert(persisted.length >= 2,
    `pages bought before the failure must survive it, got ${persisted.length}`);
  const urls = persisted.map((p) => p.source_url);
  assert(urls.includes("https://pump.com/pricing"));
  assert(urls.includes("https://pump.com/product"));
});
