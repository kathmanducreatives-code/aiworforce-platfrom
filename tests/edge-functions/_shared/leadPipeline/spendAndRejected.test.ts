// Two honesty fixes found with `npm run dev:atlas` (2026-11-09):
// 1. The website-pages step reported $0 whenever Apify returned no charge (run-sync never
//    does; the crawler is compute-billed) or the run failed. The ledger always settled the
//    worst case, but the run's reported spend — what the Workbench shows — understated it.
// 2. A run returned only `excludedCount`: the user could not see WHICH companies were
//    ruled out or why.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { apifyPageFetcher, checkBusinessModels } from "../../../../supabase/functions/_shared/leadPipeline/businessModelCheck.ts";
import { WEBSITE_PAGES_WORST_USD } from "../../../../supabase/functions/_shared/leadPipeline/apifyInvoker.ts";
import { rejectedSummary } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";

const now = () => new Date("2026-11-09T00:00:00Z");
const target = { companyKey: "domain:a.example", domain: "a.example" };

Deno.test("website spend: no charge from Apify → the run's worst case, never $0", async () => {
  const invoke: ActorInvoker = () => Promise.resolve({ items: [{ url: "https://a.example/", text: "Software for finance teams.", crawl: { httpStatusCode: 200 } }], runId: "r" });
  const r = await apifyPageFetcher(invoke, now)([target], { maxUsd: 1, idempotencyKey: "k" });
  assertEquals(r.spentUsd, WEBSITE_PAGES_WORST_USD);
  assert(WEBSITE_PAGES_WORST_USD > 0);
});

Deno.test("website spend: a reported charge is used as is", async () => {
  const invoke: ActorInvoker = () => Promise.resolve({ items: [], runId: "r", chargedUsd: 0.004 });
  const r = await apifyPageFetcher(invoke, now)([target], { maxUsd: 1, idempotencyKey: "k" });
  assertEquals(r.spentUsd, 0.004);
});

Deno.test("website spend: nothing to fetch, or no Apify, costs nothing", async () => {
  assertEquals((await apifyPageFetcher(null, now)([target], { maxUsd: 1, idempotencyKey: "k" })).spentUsd, 0);
  const never: ActorInvoker = () => { throw new Error("must not run"); };
  assertEquals((await apifyPageFetcher(never, now)([], { maxUsd: 1, idempotencyKey: "k" })).spentUsd, 0);
});

Deno.test("website spend: a FAILED page run may have billed → its worst case, and nothing is retried", async () => {
  let calls = 0;
  const r = await checkBusinessModels([{ companyKey: "k1", name: "A", domain: "a.example", linkedinUrl: null, description: null }], "b2b",
    { fetchPages: () => { calls++; return Promise.reject(new Error("apify 502")); }, ground: (() => { throw new Error("no"); }) as never },
    { maxUsd: 1, idempotencyKey: "k", missionId: null, now });
  assertEquals(calls, 1);
  assertEquals(r.spentUsd, WEBSITE_PAGES_WORST_USD);
  assertEquals(r.findings.map((f) => f.status), ["unknown"]);
});

Deno.test("rejectedSummary: names each ruled-out company with its failing reasons, bounded", () => {
  const lead = (name: string, reason: string) => ({
    leadKey: `domain:${name}.example`, company: { name, domain: `${name}.example`, linkedinUrl: null },
    qualification: { checks: [{ result: "pass", reason: "ok" }, { result: "fail", reason }] }, screeningReasons: [], rank: { explanation: "Ineligible" },
  }) as never;
  const r = rejectedSummary([lead("harbor", "consumer rules out b2b"), lead("maplecrest", "Toronto is outside United States")]);
  assertEquals(r.map((x) => [x.name, x.reasons]), [["harbor", ["consumer rules out b2b", "Ineligible"]], ["maplecrest", ["Toronto is outside United States", "Ineligible"]]]);
  assertEquals(rejectedSummary(Array.from({ length: 80 }, (_, i) => lead(`c${i}`, "x")) as never).length, 50);
});
