// ONE QUESTION, ASKED FOR TEN COMPANIES AT A TIME.
//
// `hiring_verification` asked the provider once per company. The Actor accepts
// `company[]` up to 10 and a call takes ~48s whether it carries one company or
// ten, so a slice that could afford one paid search answered ONE company and
// left the rest unassessed.
//
// Run 07e973f1, live: eleven companies enriched, ONE hiring call,
// "the eligible set was empty (29 companies carried no hiring assessment)",
// nothing qualified, no canonical event written.
//
// THE SEMANTICS DO NOT CHANGE. Same twenty titles, same evidence standard,
// same `freeHiringAssessment` first and paid rows only ever upgrading. What
// changes is how many HTTP calls carry the same question.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HIRING_JOB_TITLES,
  HIRING_JOBS_PER_BATCH_COMPANY,
  HIRING_VERIFICATION_BATCH_SIZE,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { compileHarvestJobSearchInput } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  dedupeJobs,
  normalizeLinkedInJob,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { normalizeCompanyLinkedInUrl } from "../../../supabase/functions/_shared/structuredCompanyEnrichment.ts";

const url = (n: number) => `https://www.linkedin.com/company/co-${n}`;
const companies = (n: number) => Array.from({ length: n }, (_, i) => url(i + 1));

/** The batching the engine performs, expressed here so the shape is pinned. */
const batches = (urls: string[]) => {
  const out: string[][] = [];
  for (let i = 0; i < urls.length; i += HIRING_VERIFICATION_BATCH_SIZE) {
    out.push(urls.slice(i, i + HIRING_VERIFICATION_BATCH_SIZE));
  }
  return out;
};

// ── 11 companies → a batch of 10 and a batch of 1 ─────────────────────────

Deno.test("11 companies batch as 10 + 1", () => {
  const b = batches(companies(11));
  assertEquals(b.length, 2, "two calls, not eleven");
  assertEquals(b[0].length, 10);
  assertEquals(b[1].length, 1);
});

Deno.test("the same companies are asked about, none dropped or repeated", () => {
  const all = companies(11);
  const flat = batches(all).flat();
  assertEquals(flat.length, all.length, "every company is asked about exactly once");
  assertEquals(new Set(flat).size, all.length, "and none twice");
  assertEquals(flat.sort(), [...all].sort());
});

Deno.test("fewer provider calls for the same work", () => {
  // The property that motivated this: eleven calls become two.
  const before = 11;
  const after = batches(companies(11)).length;
  assert(after < before, `${after} calls must be fewer than ${before}`);
  assertEquals(after, 2);
});

Deno.test("every batch compiles against the Actor's own limit", () => {
  for (const group of batches(companies(11))) {
    const c = compileHarvestJobSearchInput({
      company: group,
      jobTitles: HIRING_JOB_TITLES,
      maxItems: HIRING_JOBS_PER_BATCH_COMPANY * group.length,
    });
    assert(c.ok, `batch of ${group.length} must compile: ${JSON.stringify((c as { errors?: string[] }).errors)}`);
  }
});

Deno.test("a batch may never exceed the compiler's company ceiling", () => {
  // `compileHarvestJobSearchInput` caps `company[]` at 10, from the Actor's
  // verified card. The batch size must be that limit, not a guess beside it.
  const over = compileHarvestJobSearchInput({
    company: companies(HIRING_VERIFICATION_BATCH_SIZE + 1),
    jobTitles: HIRING_JOB_TITLES, maxItems: 10,
  });
  assertEquals(over.ok, false, "the compiler rejects a batch above its limit");
  assert(HIRING_VERIFICATION_BATCH_SIZE <= 10);
});

// ── the qualifier and evidence standard are untouched ─────────────────────

Deno.test("the twenty-title sales vocabulary is unchanged", () => {
  assertEquals(HIRING_JOB_TITLES.length, 20, "same breadth as the per-company call");
  const joined = HIRING_JOB_TITLES.join(" ").toLowerCase();
  assert(/sales/.test(joined), "the sales-role qualifier still reaches the provider");
  // Every batch carries the WHOLE vocabulary — batching must not shard titles.
  for (const group of batches(companies(11))) {
    const c = compileHarvestJobSearchInput({
      company: group, jobTitles: HIRING_JOB_TITLES,
      maxItems: HIRING_JOBS_PER_BATCH_COMPANY * group.length,
    });
    assertEquals(
      (c as { input?: { jobTitles?: string[] } }).input?.jobTitles?.length, 20,
      "each call asks the full question, not a slice of it",
    );
  }
});

Deno.test("a batch asks for what the calls it replaces would have asked for", () => {
  // Ten companies × ten rows each — the same per-company evidence depth, not a
  // shared pool that would starve the last company in the batch.
  const group = companies(10);
  const c = compileHarvestJobSearchInput({
    company: group, jobTitles: HIRING_JOB_TITLES,
    maxItems: HIRING_JOBS_PER_BATCH_COMPANY * group.length,
  });
  assertEquals((c as { input?: { maxItems?: number } }).input?.maxItems, 100);
});

// ── evidence is partitioned, never shared ─────────────────────────────────

const jobRow = (companyUrl: string, title: string, id: string) => ({
  id, title, linkedinUrl: `https://www.linkedin.com/jobs/view/${id}`,
  company: { name: "X", linkedinUrl: companyUrl, id: companyUrl },
});

Deno.test("a job row reaches only the company it names", () => {
  const group = [url(1), url(2), url(3)];
  const byUrl = new Map(group.map((u) => [normalizeCompanyLinkedInUrl(u)!, u]));

  const rows = [
    jobRow(url(1), "Account Executive", "j1"),
    jobRow(url(1), "Sales Operations", "j2"),
    jobRow(url(3), "Head of Sales", "j3"),
  ];

  const routed = new Map<string, string[]>();
  for (const raw of rows) {
    const j = normalizeLinkedInJob(raw as never);
    const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
    if (!owner) continue;
    routed.set(owner, [...(routed.get(owner) ?? []), j.title ?? ""]);
  }

  assertEquals(routed.get(url(1))?.length, 2);
  assertEquals(routed.get(url(3))?.length, 1);
  assertEquals(
    routed.get(url(2)), undefined,
    "a company with no rows gets none — one company's opening cannot earn another's verdict",
  );
});

Deno.test("a row naming a company outside the batch is dropped, not attributed", () => {
  const byUrl = new Map([[normalizeCompanyLinkedInUrl(url(1))!, url(1)]]);
  const j = normalizeLinkedInJob(jobRow(url(99), "Account Executive", "jX") as never);
  const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
  assertEquals(owner, undefined, "an unknown company's row must not land on a batch member");
});

Deno.test("routing survives URL formatting differences", () => {
  // The batch key and the row both go through `normalizeCompanyLinkedInUrl`, so
  // a trailing slash or a scheme difference cannot orphan a company's evidence.
  const a = normalizeCompanyLinkedInUrl("https://www.linkedin.com/company/acme/");
  const b = normalizeCompanyLinkedInUrl("http://linkedin.com/company/acme");
  assertEquals(a, b);
  assert(a);
});

Deno.test("duplicate rows from a batch are deduplicated per company", () => {
  // The Actor returned 25% duplicate rows in one observed pack; a batch makes
  // that more likely, not less.
  const jobs = [
    normalizeLinkedInJob(jobRow(url(1), "Account Executive", "j1") as never),
    normalizeLinkedInJob(jobRow(url(1), "Account Executive", "j1") as never),
  ];
  assertEquals(dedupeJobs(jobs).length, 1);
});

// ── idempotency: the key must not depend on batch composition ─────────────

Deno.test("the operation key is per company, not per batch", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("const hiringOperationKey");
  assert(i > 0, "hiring verification must derive a per-company operation key");
  const block = ENGINE.slice(i, i + 900);
  assert(
    /input_fingerprint: inputFingerprint\(\{\s*company: \[url\]/.test(block),
    "the fingerprint must be the SINGLE-company input — a batch-derived key " +
      "changes as batches change and would re-POST answered companies",
  );
  assert(block.includes("company_key: c.key"), "keyed by the company it answers for");
});

Deno.test("a company already answered is not re-asked", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("const needsPaid:");
  const block = ENGINE.slice(i, i + 1200);
  assert(block.includes("shouldSkipProviderCall"), "the resume ledger is consulted");
  assert(block.includes("completed_operations.includes(opKey)"),
    "and so is this run's own record of what it has already asked");
});

Deno.test("every company in a batch is marked asked, including zero-result ones", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("for (const g of group) {\n          asked.add(g.c.key);");
  assert(i > 0, "the whole batch is recorded as asked, not only the rows that returned");
  const block = ENGINE.slice(i, i + 400);
  assert(block.includes("completed_operations.push(g.opKey)"),
    "a company answered `no openings` has been investigated and must not be paid for twice");
});

Deno.test("a zero-result company gets an explicit investigated reason", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  assert(
    ENGINE.includes('asked.has(c.key) ? "job_search_returned_no_matching_role"'),
    "`we asked and there are none` must be distinguishable from `nobody looked`",
  );
});

Deno.test("the deadline is checked per batch, not per company", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("for (let i = 0; i < needsPaid.length; i += BATCH)");
  assert(i > 0);
  const block = ENGINE.slice(i, i + 400);
  assert(
    block.includes('deps.deadline?.expired("apify_linkedin_job_search")'),
    "a batch costs one call, so one call's budget is what must be available",
  );
});

Deno.test("the engine DROPS an unattributable row rather than guessing an owner", () => {
  // The routing test above reimplements the partition locally, so it passes
  // even if the engine misattributes — the same call-site hole that shipped the
  // compiler fold and the frontier count. Pinned by source.
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("for (const raw of rows) {\n          const j = normalizeLinkedInJob(raw);");
  assert(i > 0, "the batch partition must exist");
  const block = ENGINE.slice(i, i + 500);
  assert(
    /if \(!owner\) continue;/.test(block),
    "a row whose company is not in this batch must be dropped outright — " +
      "attributing it to any batch member is how one company's opening earns another's verdict",
  );
  assert(
    block.includes("byUrl.get(j.company_linkedin_url)"),
    "ownership comes from the row's own company URL, never from position",
  );
});

// ── A PENDING RUN BELONGS TO THE QUESTION THAT STARTED IT ─────────────────
//
// Run ede69c8c, live, on the first batched mission. Batching worked — ten
// companies in one call, then one — but BOTH ledger rows carried the same
// provider_run_id:
//
//   call 1  companies=10  run_id=ju8MYeOYSgoQ9zBAv  timed_out
//   call 2  companies=1   run_id=ju8MYeOYSgoQ9zBAv  timed_out
//
// The batch of ten timed out and was recorded pending; the batch of one then
// ADOPTED it, because adoption matched on capability+provider alone. That
// company was never asked about, and the other batch's answer would have been
// read as its own.
//
// The flaw predates batching — a per-company call would have inherited another
// company's run the same way — but a batch of ten beside a batch of one is
// what made it unmissable.

Deno.test("adoption requires the same input, not just the same stage", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("const inFlight = (opts.state?.pending_runs ?? []).find(");
  assert(i > 0, "the adoption lookup must exist");
  const block = ENGINE.slice(i, i + 400);
  assert(
    block.includes("r.input_fingerprint === thisFingerprint"),
    "a run may only be adopted by a call asking the same question",
  );
  assert(
    block.includes("!!r.input_fingerprint"),
    "an entry with no recorded question is not adopted — one re-POST is cheaper " +
      "than attributing one batch's answer to another",
  );
});

Deno.test("a pending run records what it was asked", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("state.pending_runs.push({");
  const block = ENGINE.slice(i, i + 500);
  assert(
    block.includes("input_fingerprint: attemptFingerprint"),
    "without the fingerprint the adoption check above can never match",
  );
});
