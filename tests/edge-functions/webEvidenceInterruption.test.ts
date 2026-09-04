// PHASE 4 — A PAGE THAT WAS PAID FOR SURVIVES THE SLICE THAT BOUGHT IT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage b1348724, `pump.co/about`, verbatim from the ledger:
//
//     16:58:00  call started    -> never finalized, no row
//     18:35:09  call succeeded  -> no row
//     18:47:13  call succeeded  -> row written 18:47:16
//
// Three purchases of one page; 24 Firecrawl calls for 17 URLs across the run.
// The write was batched once per company, AFTER every page in the plan. A slice
// that hit its deadline in between had bought pages and lost them, and the next
// slice bought them again because the cache had nothing to say.
//
// ── WHY THE TEST IS SHAPED THIS WAY ────────────────────────────────────────
//
// A platform kill is not an exception. The runner catches a throwing
// `fetchPage` and degrades it to a timeout — deliberately, so one bad URL never
// fails a company — so a test that throws measures the degradation path and not
// durability. What a kill actually leaves behind is whatever was already
// COMMITTED when the fatal line was reached, so that is what these assert on:
// the contents of the store at the instant page 3 was requested.
//
// The store is one object across both slices, which is the only property of a
// database this test needs: it outlives the isolate.
//
// ZERO network, ZERO model, ZERO Firecrawl spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runEvidenceCollection } from "../../supabase/functions/_shared/webEvidenceRunner.ts";
import type { EvidenceDebt } from "../../supabase/functions/_shared/webEvidenceDebt.ts";
import type { CacheReader } from "../../supabase/functions/_shared/webEvidenceRunner.ts";

const debt = (key: string): EvidenceDebt => ({
  company_key: key, company_name: key, domain: `${key}.com`,
  requirement_id: `req-${key}`,
  open_question: `Whether ${key} is a B2B SaaS company`,
  known_evidence_types: [], match_score: 82,
});

const plan1 = (key: string, intents: string[]) => () =>
  Promise.resolve({ plans: [{ company_key: key, research_question: "q", page_intents: intents }] });

interface StoredRow {
  domain: string; page_intent: string; source_url: string;
  source_text: string; fetched_at: string; status: string;
}

/**
 * The smallest thing that behaves like the table: it accepts upserts and it
 * outlives the run. `writeWebEvidence` calls `.from(t).upsert(rows, opts)` and
 * reads `{ error }`, which is the entire surface used here.
 */
function makeStore() {
  const rows: StoredRow[] = [];
  const db = {
    from: () => ({
      upsert: (incoming: Record<string, unknown>[]) => {
        for (const r of incoming) rows.push(r as unknown as StoredRow);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as never;

  /** The cache reader a LATER slice gets: whatever survived. */
  const readCache: CacheReader = (domain) =>
    Promise.resolve(
      new Map(
        rows.filter((r) => r.domain === domain).map((r) => [r.page_intent, {
          source_url: r.source_url,
          source_text: r.source_text,
          fetched_at: r.fetched_at,
          status: r.status,
        }]),
      ),
    );
  return { rows, db, readCache };
}

const INTENTS = ["pricing", "product", "about"];

Deno.test("THE INTERRUPTION: pages bought before the kill are already committed", async () => {
  const store = makeStore();
  let atDeath: StoredRow[] | null = null;

  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", INTENTS),
      extract: () => Promise.resolve({ claims: [] }),
      db: store.db,
      readCache: store.readCache,
      fetchPage: (i) => {
        // The isolate is killed here, on the third page, exactly as b1348724
        // was. Snapshot what is durable at that instant.
        if (i.url.endsWith("/about")) atDeath ??= [...store.rows];
        return Promise.resolve({
          ok: true, markdown: `text for ${i.url}`, status: "ok" as const,
        });
      },
    },
  });

  // Re-bound so the narrowing is on a plain union rather than on a variable
  // TypeScript only ever sees assigned inside a callback.
  const durable = atDeath as StoredRow[] | null;
  assert(durable !== null, "the third page must have been reached, or this proves nothing");
  assertEquals(
    durable.map((r) => r.page_intent).sort(),
    ["pricing", "product"],
    "the two pages already paid for must be on disk BEFORE the third is " +
      "requested; batching the write to the end of the company is what bought " +
      "`pump.co/about` three times",
  );
  for (const r of durable) {
    assert(r.source_text.trim().length > 0, `${r.page_intent} was committed empty`);
  }
});

Deno.test("THE RESUME: the next slice re-buys only what survived the kill", async () => {
  const store = makeStore();
  let atDeath: StoredRow[] | null = null;

  // ── SLICE 1: killed while fetching the third page ────────────────────────
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", INTENTS),
      extract: () => Promise.resolve({ claims: [] }),
      db: store.db,
      readCache: store.readCache,
      fetchPage: (i) => {
        if (i.url.endsWith("/about")) atDeath ??= [...store.rows];
        return Promise.resolve({ ok: true, markdown: `text for ${i.url}`, status: "ok" as const });
      },
    },
  });

  // ── SLICE 2 RESUMES FROM WHAT WAS DURABLE, NOT FROM WHAT SLICE 1 ENDED
  //    UP WITH ───────────────────────────────────────────────────────────────
  //
  // The isolate died at the third fetch, so the rest of slice 1 never ran.
  // Seeding the next slice's cache from the death snapshot is what makes this
  // an interruption test rather than a second cache-reuse test: with the write
  // batched to the end of the company, the snapshot is EMPTY and every page is
  // bought a second time.
  const durable = atDeath as StoredRow[] | null;
  assert(durable !== null, "the third page must have been reached");
  const resumed = makeStore();
  resumed.rows.push(...durable);

  const bought: string[] = [];
  const r2 = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", INTENTS),
      extract: () => Promise.resolve({ claims: [] }),
      db: resumed.db,
      readCache: resumed.readCache,
      fetchPage: (i) => {
        bought.push(i.url);
        return Promise.resolve({ ok: true, markdown: `text for ${i.url}`, status: "ok" as const });
      },
    },
  });

  assertEquals(bought, ["https://pump.com/about"],
    "only the page the killed slice never finished buying may be bought; " +
      "batching the write to the end of the company re-bought all three");
  assertEquals(r2.pages_reused, 2, "the two survivors must be REUSED, not re-fetched");
  assertEquals(r2.pages_fetched, 1);
});

Deno.test("a page that came back unusable is committed too, and not re-bought", async () => {
  // Absence is an answer and it was paid for. If only successes survived the
  // slice, a 404 would be re-requested on every continuation for ever — the
  // d3a79c32 shape, one domain fetched 16 times for 4 URLs.
  const store = makeStore();
  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", ["pricing"]),
      extract: () => Promise.resolve({ claims: [] }),
      db: store.db,
      readCache: store.readCache,
      fetchPage: () =>
        Promise.resolve({ ok: false, markdown: "", status: "not_found" as const }),
    },
  });
  assertEquals(store.rows.length, 1, "the absence must be recorded");

  const bought: string[] = [];
  const r2 = await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", ["pricing"]),
      extract: () => Promise.resolve({ claims: [] }),
      db: store.db,
      readCache: store.readCache,
      fetchPage: (i) => {
        bought.push(i.url);
        return Promise.resolve({ ok: false, markdown: "", status: "not_found" as const });
      },
    },
  });
  assertEquals(bought, [], "a known-absent page must not be requested again");
  assertEquals(r2.pages_known_missing, 1);
});

Deno.test("each page is committed in its own write, not one batch at the end", async () => {
  // The property that makes an interruption survivable, stated directly: the
  // number of writes tracks the number of pages. One batched write per company
  // is what the b1348724 loss looked like in the code.
  const writes: number[] = [];
  const rows: StoredRow[] = [];
  const db = {
    from: () => ({
      upsert: (incoming: Record<string, unknown>[]) => {
        writes.push(incoming.length);
        for (const r of incoming) rows.push(r as unknown as StoredRow);
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as never;

  await runEvidenceCollection({
    workspace_id: "w", debts: [debt("pump")],
    deps: {
      plan: plan1("pump", INTENTS),
      extract: () => Promise.resolve({ claims: [] }),
      db,
      readCache: () => Promise.resolve(new Map()),
      fetchPage: (i) =>
        Promise.resolve({ ok: true, markdown: `text for ${i.url}`, status: "ok" as const }),
    },
  });

  assertEquals(writes.length, 3, "three pages must mean three writes");
  assertEquals(writes, [1, 1, 1], "each write carries exactly the page just fetched");
});
