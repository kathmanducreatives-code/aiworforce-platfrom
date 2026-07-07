import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { selectTopSignals } from "./signalRanking.ts";

interface Row { id: string; score: number; verified: boolean; created_at?: string | null }

const opts = {
  score: (r: Row) => r.score,
  verified: (r: Row) => r.verified,
  createdAt: (r: Row) => r.created_at,
};

Deno.test("returns highest scores first, verified only", () => {
  const rows: Row[] = [
    { id: "a", score: 90, verified: true },
    { id: "b", score: 40, verified: false },
    { id: "c", score: 75, verified: true },
    { id: "d", score: 55, verified: true },
  ];
  const top = selectTopSignals(rows, { ...opts, limit: 2 });
  assertEquals(top.map((r) => r.id), ["a", "c"]);
});

Deno.test("unverified signals never appear in the top list", () => {
  const rows: Row[] = [
    { id: "u", score: 99, verified: false },
    { id: "v", score: 10, verified: true },
  ];
  const top = selectTopSignals(rows, { ...opts, limit: 10 });
  assertEquals(top.map((r) => r.id), ["v"]);
});

Deno.test("ties broken by freshness (newer first)", () => {
  const rows: Row[] = [
    { id: "old", score: 50, verified: true, created_at: "2026-01-01T00:00:00Z" },
    { id: "new", score: 50, verified: true, created_at: "2026-07-01T00:00:00Z" },
  ];
  const top = selectTopSignals(rows, opts);
  assertEquals(top.map((r) => r.id), ["new", "old"]);
});

Deno.test("limit caps the result set", () => {
  const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ id: String(i), score: i, verified: true }));
  assertEquals(selectTopSignals(rows, { ...opts, limit: 10 }).length, 10);
});
