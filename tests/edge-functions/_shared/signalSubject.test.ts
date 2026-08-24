// The subject model and the canonical vocabulary exist in TypeScript and in
// CHECK constraints. Drift between them fails at insert time, on the write path
// whose whole purpose is to be the one canonical store — so both are pinned to
// the migration, and the migration is read with its comments stripped first.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSignalSubject, canonicalSubjectKey, isSubjectType,
  SUBJECT_KEY_PATTERN, SUBJECT_TYPES,
} from "../../../supabase/functions/_shared/signalSubject.ts";
import {
  SIGNAL_TYPES, signalCategoryOf,
} from "../../../supabase/functions/_shared/signalEvent.ts";

const MIGRATION = await Deno.readTextFile(
  new URL("../../../supabase/migrations/20260824130000_signal_events_subject.sql", import.meta.url),
);

/** SQL with comments removed — the header restates these lists in prose. */
const SQL = MIGRATION.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

function checkValues(constraint: string, column: string): string[] {
  const re = new RegExp(`constraint\\s+${constraint}[\\s\\S]*?check\\s*\\([\\s\\S]*?${column}\\s+in\\s*\\(([^)]*)\\)`, "i");
  const m = SQL.match(re);
  assert(m, `${constraint} must declare an IN list for ${column}`);
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

Deno.test("subject: the type vocabulary matches the database CHECK exactly", () => {
  assertEquals(
    checkValues("signal_events_subject_type_valid", "subject_type").sort(),
    [...SUBJECT_TYPES].sort(),
  );
});

Deno.test("subject: the canonical-key pattern is the same one the database enforces", () => {
  const m = SQL.match(/subject_key\s+is\s+null\s+or\s+subject_key\s*~\s*'([^']+)'/i);
  assert(m, "the migration must constrain subject_key's shape");
  assertEquals(m![1], SUBJECT_KEY_PATTERN.source,
    "a key legal in code and rejected by the database fails every subject write");
});

Deno.test("subject: canonicalisation collapses the spellings that would fragment a subject", () => {
  // One competitor must be one row across scans, not one per spelling.
  for (const variant of ["Outreach", "outreach", "  Outreach  ", "OUTREACH"]) {
    assertEquals(canonicalSubjectKey(variant), "outreach");
  }
  assertEquals(canonicalSubjectKey("Café Ventures"), "cafe-ventures", "accents must collapse");
  assertEquals(canonicalSubjectKey("SDR outreach tooling"), "sdr-outreach-tooling");
  // Nothing usable must be null, never a placeholder: a shared `unknown` key
  // would merge every unidentifiable subject into a single row.
  for (const empty of ["", "   ", "—", "!!!", null, undefined]) {
    assertEquals(canonicalSubjectKey(empty as any), null);
  }
  for (const k of ["outreach", "cafe-ventures", "sdr-outreach-tooling"]) {
    assert(SUBJECT_KEY_PATTERN.test(k), `${k} must satisfy the database pattern`);
  }
});

Deno.test("subject: a subject is all-or-nothing", () => {
  assertEquals(buildSignalSubject("competitor", "Outreach"), {
    subject_type: "competitor", subject_key: "outreach",
  });
  assertEquals(buildSignalSubject("competitor", "  "), null, "no key means no subject");
  assertEquals(buildSignalSubject("vendor", "Outreach"), null, "an unknown type means no subject");
  assertEquals(isSubjectType("market"), true);
  for (const bad of ["Market", "markets", "", null, 1]) assertEquals(isSubjectType(bad), false);
});

Deno.test("vocabulary: the database accepts exactly the non-engagement canonical types", () => {
  // Engagement types live in `engagement_events`, never in `signal_events`, so
  // the store's CHECK is the canonical list minus that category. Derived on both
  // sides so neither can be edited alone.
  const expected = SIGNAL_TYPES.filter((t) => signalCategoryOf(t) !== "engagement");
  assertEquals(checkValues("signal_events_type_valid", "signal_type").sort(), [...expected].sort());
});

Deno.test("vocabulary: the market category is declared, and market types are in it", () => {
  const cats = checkValues("signal_events_category_valid", "signal_category");
  assert(cats.includes("market"), "market events must be storable");
  assertEquals(signalCategoryOf("competitor_activity"), "market");
  assertEquals(signalCategoryOf("market_problem_discussion"), "market");
  // A competitor's motion must never answer a query meaning "this prospect is
  // changing how it sells".
  assert(!["gtm", "growth", "product"].includes(signalCategoryOf("competitor_activity")));
  const expected = new Set(SIGNAL_TYPES.filter((t) => signalCategoryOf(t) !== "engagement").map(signalCategoryOf));
  assertEquals(cats.sort(), [...expected].sort());
});

Deno.test("time honesty: the migration makes an invented occurred_at unrepresentable", () => {
  assert(/alter column occurred_at drop not null/i.test(SQL), "unknown times must be storable");
  const coherent = SQL.match(/constraint\s+signal_events_occurred_at_coherent[\s\S]*?check\s*\(([\s\S]*?)\n\s*\);/i);
  assert(coherent, "the basis and the timestamp must be constrained together");
  const body = coherent![1];
  assert(/'source_reported'\s+and\s+occurred_at\s+is\s+not\s+null/i.test(body),
    "a claimed source time must actually be present");
  assert(/'unknown'\s+and\s+occurred_at\s+is\s+null/i.test(body),
    "an unknown time must not be allowed to carry a timestamp");
});
