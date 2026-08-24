// The origin vocabulary exists in two places that must agree: the TypeScript
// list every writer validates against, and the CHECK constraint the database
// enforces. A value legal in one and rejected by the other fails at run time,
// on a write path whose whole purpose is attribution — so they are pinned.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSignalOrigin, SIGNAL_ORIGINS, SIGNAL_ORIGIN_SET,
} from "../../../supabase/functions/_shared/signalOrigin.ts";

const MIGRATION = await Deno.readTextFile(
  new URL("../../../supabase/migrations/20260824120000_signal_events_origin.sql", import.meta.url),
);

/**
 * The CHECK values, read from SQL with comments removed FIRST.
 *
 * The migration's header states the same vocabulary in prose. Matching against
 * the raw file would read the documentation instead of the constraint, and
 * would keep passing after someone edited one and not the other — which is the
 * only failure this test exists to catch.
 */
function checkConstraintOrigins(): string[] {
  const sql = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  const m = sql.match(/check\s*\(\s*origin\s+in\s*\(([^)]*)\)/i);
  assert(m, "the migration must declare a CHECK on origin");
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

Deno.test("origin: the code vocabulary and the database CHECK are the same set", () => {
  const sql = checkConstraintOrigins();
  assert(sql.length > 0, "the CHECK must list values");
  assertEquals(
    [...sql].sort(), [...SIGNAL_ORIGINS].sort(),
    "signalOrigin.ts and signal_events_origin_valid must agree exactly",
  );
});

Deno.test("origin: the vocabulary names both producers and every monitoring mode", () => {
  // lead_mission is what makes a Lead by-product distinguishable from
  // intelligence Signals went looking for. Losing it would make the feed's
  // provenance unanswerable, which is the failure the column exists to expose.
  assert(SIGNAL_ORIGIN_SET.has("lead_mission"));
  for (const monitoring of ["scheduled_monitor", "manual_scan", "tracked_company", "competitor_monitor"]) {
    assert(SIGNAL_ORIGIN_SET.has(monitoring), `${monitoring} must be expressible`);
  }
});

Deno.test("origin: the guard rejects near-misses, not just nonsense", () => {
  for (const ok of SIGNAL_ORIGINS) assert(isSignalOrigin(ok));
  for (const bad of [
    "lead-mission", "LEAD_MISSION", " lead_mission", "lead_mission ",
    "radar", "manual", "", null, undefined, 0, {}, ["lead_mission"],
  ]) {
    assertEquals(isSignalOrigin(bad), false, `${JSON.stringify(bad)} must be rejected`);
  }
});

Deno.test("origin: the migration makes the column NOT NULL, not merely constrained", () => {
  const sql = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert(
    /alter\s+column\s+origin\s+set\s+not\s+null/i.test(sql),
    "a nullable origin would answer 'unknown' for exactly the rows whose provenance is in question",
  );
  // The backfill must precede the NOT NULL, or the migration fails wherever rows exist.
  const backfill = sql.search(/update\s+public\.signal_events/i);
  const notNull = sql.search(/alter\s+column\s+origin\s+set\s+not\s+null/i);
  assert(backfill >= 0 && backfill < notNull, "backfill must run before SET NOT NULL");
});
