import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseStrictConstraints, buildAttemptStrategy, validateSourcingResults,
  runAdaptiveSourcing, resolveMaxAttempts, type RunAttempt, type SourcedItem,
} from "../../functions/_shared/sourcingRetry.ts";

const crit = (over: Partial<Parameters<typeof buildAttemptStrategy>[1]> = {}) =>
  ({ requested: 5, role: "GTM", industry: "B2B SaaS", location: "USA", ...over });

// helper: a runner that yields a fixed sequence of item-batches per attempt
function sequenceRunner(batches: SourcedItem[][]): RunAttempt {
  let i = 0;
  return async () => ({ items: batches[i++] ?? [] });
}
const leads = (n: number, prefix = "co") =>
  Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, company: `${prefix}${i}`, title: "GTM Lead", source_url: `https://x/${prefix}${i}` }));

Deno.test("#1 first attempt enough → one attempt, complete", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints("find 5"), maxAttempts: 3, runAttempt: sequenceRunner([leads(5)]) });
  assertEquals(r.attempts.length, 1);
  assertEquals(r.status, "complete");
  assertEquals(r.found, 5);
});

Deno.test("#2 1 then 4 → two attempts, complete, deduped", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([leads(1), leads(4, "b")]) });
  assertEquals(r.status, "complete");
  assertEquals(r.found, 5);
  assertEquals(r.attempts.length, 2);
});

Deno.test("#3 0,3,1 → partial 4/5 after max attempts", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([[], leads(3, "b"), leads(1, "c")]) });
  assertEquals(r.found, 4);
  assertEquals(r.status, "partial");
  assertEquals(r.attempts.length, 3);
});

Deno.test("#4 duplicates across attempts are not overcounted", async () => {
  const same = leads(3);
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([same, same, leads(1, "z")]) });
  assertEquals(r.found, 4); // 3 unique + 1 new, dupes ignored
});

Deno.test("#5 strict London → location not broadened", () => {
  const strict = parseStrictConstraints("Find exactly 5 SDR leads in London. Do not broaden outside London.");
  assert(strict.location, "London must be strict");
  assert(strict.count_exact);
  // role aliases still allowed at attempt 2
  const a2 = buildAttemptStrategy(2, crit({ role: "SDR", location: "London" }), strict);
  assert(a2.role_keywords.length > 1, "SDR should broaden to aliases");
  // later attempts never relax location
  const a5 = buildAttemptStrategy(5, crit({ role: "SDR", location: "London" }), strict);
  assert(!a5.relax_location, "location must stay strict");
});

Deno.test("#6 typo handled upstream (resolveMaxAttempts + exact)", () => {
  assertEquals(resolveMaxAttempts("find 5 founders", parseStrictConstraints("find 5 founders")), 3);
  assertEquals(resolveMaxAttempts("find exactly 5", parseStrictConstraints("find exactly 5")), 5);
});

Deno.test("#7 tool/auth failure → failed immediately, no further attempts", async () => {
  let calls = 0;
  const runner: RunAttempt = async () => { calls++; return { items: [], tool_failed: true, error: "apify_unauthorized" }; };
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: runner });
  assertEquals(r.status, "failed");
  assertEquals(calls, 1, "must not retry after a tool failure");
});

Deno.test("#8 no usable results after all attempts → failed (not complete)", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([[], [], []]) });
  assertEquals(r.found, 0);
  assertEquals(r.status, "failed");
});

Deno.test("#9 attempt log captured with strategy + counts", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([leads(1), leads(4, "b")]) });
  assert(/Exact search/i.test(r.attempts[0].strategy));
  assert(/role aliases/i.test(r.attempts[1].strategy));
  assertEquals(r.attempts[1].total_accepted, 5);
});

Deno.test("#10 requested count respected — never exceeds", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit({ requested: 5 }), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([leads(10)]) });
  assertEquals(r.found, 5, "cap at requested even if actor returns more");
});

Deno.test("persistence cap: 5+5 raw across 2 attempts → exactly 5 accepted (memory input)", async () => {
  // attempt 1 returns 5 unique, attempt 2 returns 5 more — accepted must cap at 5.
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([leads(5), leads(5, "b")]) });
  assertEquals(r.found, 5);
  assertEquals(r.accepted.length, 5, "memoryWriter must receive only the 5 accepted");
  // attempts still record the raw counts (10 total seen) for the activity log
  assertEquals(r.attempts[0].result_count, 5);
  assertEquals(r.attempts.length, 1, "stops once 5 met on attempt 1");
});

Deno.test("persistence cap: partial → accepted == persisted count (4)", async () => {
  const r = await runAdaptiveSourcing({ criteria: crit(), strict: parseStrictConstraints(""), maxAttempts: 3, runAttempt: sequenceRunner([leads(2), leads(2, "b"), []]) });
  assertEquals(r.status, "partial");
  assertEquals(r.accepted.length, 4);
  assertEquals(r.found, 4);
});

Deno.test("validateSourcingResults filters unnamed + strict-location mismatches", () => {
  const items: SourcedItem[] = [
    { name: "A", title: "GTM Lead", location: "London" },
    { name: "", title: "GTM" },                       // no name → drop
    { name: "B", title: "GTM Lead", location: "Berlin" }, // wrong location under strict
  ];
  const kept = validateSourcingResults(items, crit({ location: "London" }), { location: true, industry: false, stage: false, count_exact: false });
  assertEquals(kept.length, 1);
  assertEquals(kept[0].name, "A");
});

Deno.test("partial under strict requests permission to broaden", async () => {
  const strict = parseStrictConstraints("Find 5 SDR leads in London. Do not broaden outside London.");
  const r = await runAdaptiveSourcing({ criteria: crit({ role: "SDR", location: "London" }), strict, maxAttempts: 3, runAttempt: sequenceRunner([leads(2), leads(1, "b"), []]) });
  assertEquals(r.status, "partial");
  assert(r.needs_permission_to_broaden, "should offer to broaden location");
});
