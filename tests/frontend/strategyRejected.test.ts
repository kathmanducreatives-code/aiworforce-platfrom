// The Workbench shows WHO was ruled out and why (backend `rejected`), not just a count.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readStrategyRun } from "../../src/lib/strategyDiscovery.ts";

const base = { status: "completed", steps: [], spend: { apifyUsd: 0.01, leadoceanRecords: 0 }, queue: [], review: [], excludedCount: 2 };

Deno.test("rejected companies are read with their reasons", () => {
  const r = readStrategyRun({ ...base, rejected: [
    { name: "Harbor Kids", domain: "harborkids.example", reasons: ["consumer rules out b2b"] },
    { name: null, domain: "maplecrest.example", reasons: ["Toronto is outside United States", 7] },
  ] })!;
  assertEquals(r.rejected, [
    { name: "Harbor Kids", domain: "harborkids.example", reasons: ["consumer rules out b2b"] },
    { name: "maplecrest.example", domain: "maplecrest.example", reasons: ["Toronto is outside United States"] },
  ]);
});

Deno.test("an older backend (count only) yields an empty list, never a guess", () => {
  assertEquals(readStrategyRun(base)!.rejected, []);
  assertEquals(readStrategyRun({ ...base, rejected: "nope" })!.rejected, []);
});

Deno.test("the panel lists them under the rejected line", () => {
  const src = Deno.readTextFileSync(new URL("../../src/components/discovery/StrategyDiscoveryPanel.tsx", import.meta.url));
  assertEquals(src.includes('data-testid="strategy-rejected-list"'), true);
});
