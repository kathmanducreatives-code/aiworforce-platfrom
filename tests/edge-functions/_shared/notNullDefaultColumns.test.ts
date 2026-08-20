// AN EXPLICIT NULL IS NOT "TAKE THE DEFAULT".
//
// ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// `messages.metadata` is `NOT NULL DEFAULT '{}'::jsonb`. A column default
// applies only when the column is OMITTED from the INSERT. pilot-chat sent
//
//     metadata: actionSource ? {...} : null
//
// so every plainly typed message — anything that was not a card action — sent
// an explicit null and violated the constraint.
//
// AND NOTHING NOTICED, because the insert's error was never read:
//
//     await admin.from("messages").insert({ ... });
//
// PostgREST answered 400, the promise resolved, and pilot-chat carried on and
// replied "Got it — I'll turn this into a sourcing workflow." No user turn was
// recorded, no plan was created, no task was created, and the only evidence
// anywhere was one Postgres line:
//
//     2026-08-20T09:46:04Z  null value in column "metadata" of relation
//                           "messages" violates not-null constraint
//
// From the outside this looked exactly like the model deciding to do nothing.
//
// TWO DEFECTS, TWO TESTS. The null is the cause; the unchecked error is the
// reason it lasted. Fixing only the first leaves the next schema change just as
// silent, so both are pinned here.
//
// ZERO network, ZERO database. These read the source.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string) =>
  Deno.readTextFileSync(new URL(`../../../supabase/functions/${rel}`, import.meta.url));

const PILOT_CHAT = read("pilot-chat/index.ts");

/**
 * Columns that are NOT NULL with a default, per the live schema.
 *
 * For these, omitting the key is correct and sending `null` is a 400. There is
 * no third option: a default cannot rescue an explicit null.
 */
const NOT_NULL_WITH_DEFAULT: ReadonlyArray<readonly [string, string]> = [
  ["messages", "metadata"],
];

Deno.test("1. THE REGRESSION: the user-message insert never sends a null metadata", () => {
  // The insert block, from `.from("messages").insert({` to its closing `});`.
  const at = PILOT_CHAT.indexOf('admin.from("messages").insert({');
  assert(at > 0, "the user-message insert still exists");
  const block = PILOT_CHAT.slice(at, at + 500);
  assertFalse(
    /metadata:[^,}]*\bnull\b/.test(block),
    "metadata must never be sent as an explicit null — the column is NOT NULL " +
    "DEFAULT '{}', so a null is a 400 and the default cannot save it",
  );
  assert(
    /metadata:[\s\S]*?:\s*\{\}/.test(block),
    "the no-action branch sends {} — a value the column accepts",
  );
});

Deno.test("2. AND THE SILENCE IS GONE: the insert's error is read and reported", () => {
  const at = PILOT_CHAT.indexOf('admin.from("messages").insert({');
  const around = PILOT_CHAT.slice(Math.max(0, at - 200), at + 900);
  assert(
    /const\s*\{\s*error:\s*\w+\s*\}\s*=\s*await\s+admin\.from\("messages"\)\.insert/.test(around),
    "the insert result is destructured — a bare `await insert()` cannot fail loudly",
  );
  assert(
    /if\s*\(\s*userMessageError\s*\)/.test(around),
    "the error is branched on, not merely captured",
  );
  assert(
    /return\s+json\(/.test(around),
    "a conversation that lost its user turn must not continue as if it had one",
  );
});

Deno.test("3. the whole file sends no null into a NOT NULL DEFAULT column", () => {
  // Guards the CLASS, not the one line. If another insert to one of these
  // tables appears, it must not reintroduce the same shape.
  for (const [table, column] of NOT_NULL_WITH_DEFAULT) {
    let from = 0;
    const needle = `.from("${table}").insert(`;
    let seen = 0;
    for (;;) {
      const at = PILOT_CHAT.indexOf(needle, from);
      if (at < 0) break;
      seen++;
      const block = PILOT_CHAT.slice(at, at + 500);
      assertFalse(
        new RegExp(`${column}:[^,}]*\\bnull\\b`).test(block),
        `insert #${seen} into ${table} sends ${column}: null — omit the key or ` +
        `send a value, but never null into NOT NULL DEFAULT`,
      );
      from = at + needle.length;
    }
    assert(seen > 0, `expected at least one insert into ${table}`);
  }
});

Deno.test("4. the ledger's null metadata is NOT the same bug", () => {
  // `executionLedger.ts` also writes `metadata: null`, and it is CORRECT there:
  // `lead_execution_calls.metadata` is nullable with no default. Recorded so a
  // future reader does not "fix" a working line by pattern-matching on this
  // file — and so the ledger's own insert failure keeps looking for its real
  // cause instead of being marked solved.
  const ledger = read("_shared/executionLedger.ts");
  assert(ledger.includes("metadata: null"), "the ledger's nullable write is untouched");
  assertEquals(NOT_NULL_WITH_DEFAULT.some(([t]) => t === "lead_execution_calls"), false);
});
