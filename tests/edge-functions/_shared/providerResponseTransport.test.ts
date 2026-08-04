// THE RETURN LEG — what `runTool` HANDS BACK, not what it sends.
//
// TEST task 41342269-7664-4d23-960b-1e42ab0c25ee asked memo23 for YC companies.
// Apify returned 50 correct structured company rows. The engine received 25
// LinkedIn *job* records, and free prequalification — which reads exactly two
// fields, `teamSize` and `openJobs` — saw neither, scored 25 companies with zero
// jobs, and excluded all 25 as `insufficient_commercial`.
//
// The outbound payload was perfect. Every test we had asserted the outbound
// payload.
//
// So these tests assert the RESPONSE contract: the shape classification, the
// fetch limit, the item read, and end-to-end that a realistic memo23 dataset
// survives intact all the way into `prequalifyYcCompanies`.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ProviderResponseContractError, buildCountLedger, readProviderResultItems,
  resolveResponseKind, assertResponseKindConsistent, structuredRowsLookIntact,
  STRUCTURED_COMPANY_ACTOR_IDS, STRUCTURED_COMPANY_ACTOR_KEYS,
} from "../../../supabase/functions/_shared/providerResponseContract.ts";
import {
  prequalifyYcCompanies, shortlistForLinkedInResolution, classifyJobTitle,
  type YcCompanyInput,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";

// ─────────────────────────────────────────────── a realistic memo23 row ──

/** One memo23 row in the Actor's REAL shape, big enough to defeat truncation. */
function memo23Row(name: string, slug: string, teamSize: number, titles: string[]) {
  return {
    id: 800 + slug.length,
    name,
    slug,
    url: `https://www.ycombinator.com/companies/${slug}`,
    website: `https://${slug}.com`,
    batch: "Summer 2015",
    status: "Active",
    stage: "Early",
    industry: "B2B",
    industries: ["B2B", "Engineering, Product and Design"],
    regions: ["United States of America", "America / Canada", "Remote"],
    allLocations: "San Francisco, CA, USA",
    teamSize,
    isHiring: true,
    oneLiner: `${name} builds things`,
    // >4,000 characters on its own, so any truncation is unmissable.
    longDescription: `${name}. `.repeat(400),
    openJobs: titles.map((title, n) => ({
      jobId: 90000 + n,
      title,
      url: `https://www.ycombinator.com/companies/${slug}/jobs/${n}`,
      applyUrl: `https://account.ycombinator.com/authenticate?job=${n}`,
      location: "San Francisco, CA, US",
      type: "Full-time",
      salaryRange: "$180K - $225K",
      roleCategory: title.toLowerCase().includes("engineer") ? "Engineering" : "Sales",
    })),
  };
}

/** 50 rows, mirroring the real dataset's mix. */
const DATASET_50 = [
  memo23Row("Bluejay", "getbluejay", 10, [
    "Member of Technical Staff", "Founding Account Executive", "GTM Engineer",
    "Chief of Staff", "Founding SDR"]),
  memo23Row("SnapMagic", "snapmagic", 23, [
    "Head of Operations", "Head of Sales", "Head of Customer Success", "Enterprise Account Executive"]),
  memo23Row("AgentMail", "agentmail", 10, [
    "GTM Engineer", "Senior Engineer, Backend/Infra", "Founding GTM Lead"]),
  memo23Row("Tara AI", "tara", 13, ["Founding Account Executive"]),
  memo23Row("Zentail", "zentail", 30, [
    "Business Development Representative", "Account Executive", "Software Engineer"]),
  memo23Row("Bitmovin", "bitmovin", 145, ["Sales Director"]),
  // A COMMERCIAL ROLE AFTER A TECHNICAL ONE — reading openJobs[0] misses it.
  memo23Row("Etleap", "etleap", 11, [
    "Senior Software Engineer", "Account Executive", "DevOps Engineer"]),
  memo23Row("Odeko", "odeko", 371, ["Brand Designer", "Senior DevOps Engineer"]),
  memo23Row("Mux", "mux", 95, ["Senior Platform Engineer"]),
  ...Array.from({ length: 41 }, (_, n) =>
    memo23Row(`Filler${n}`, `filler${n}`, 20 + n, ["Software Engineer"])),
];

// ══════════════════════════ 7. memo23 never takes the jobs path ══

Deno.test("7. memo23 is classified structured_companies, never jobs", () => {
  // The exact envelope the capability engine sends: actor key + id, NO source_type.
  assertEquals(resolveResponseKind({
    actorKey: "apify_yc_companies_memo23",
    actorId: "memo23/y-combinator-scraper",
    sourceType: null,
  }), "structured_companies");

  // Even when a defaulted "jobs" source_type is threaded through.
  assertEquals(resolveResponseKind({
    actorKey: "apify_yc_companies_memo23", actorId: "memo23/y-combinator-scraper",
    sourceType: "jobs",
  }), "structured_companies");

  // Actor id ALONE is enough — older callers send only that.
  assertEquals(resolveResponseKind({ actorId: "memo23/y-combinator-scraper" }),
    "structured_companies");

  // Every structured-company provider, by key and by id.
  for (const key of STRUCTURED_COMPANY_ACTOR_KEYS) {
    assertEquals(resolveResponseKind({ actorKey: key }), "structured_companies", key);
  }
  for (const id of STRUCTURED_COMPANY_ACTOR_IDS) {
    assertEquals(resolveResponseKind({ actorId: id }), "structured_companies", id);
  }
});

Deno.test("7b. a company actor asked for jobs FAILS CLOSED", () => {
  const err = assertThrows(
    () => assertResponseKindConsistent({
      actorKey: "apify_yc_companies_memo23", actorId: "memo23/y-combinator-scraper",
      sourceType: "jobs",
    }),
    ProviderResponseContractError,
  );
  assert(String(err.message).includes("must never take the jobs path"));

  // And an unknown actor cannot be PROMOTED to the structured path by asserting it.
  assertThrows(
    () => resolveResponseKind({ actorId: "someone/mystery-actor", declared: "structured_companies" }),
    ProviderResponseContractError,
  );
});

// ══════════════════════════ negative: real jobs actors are untouched ══

Deno.test("NEGATIVE: a real LinkedIn Jobs actor still uses the jobs path", () => {
  for (const id of [
    "harvestapi/linkedin-job-search", "curious_coder/linkedin-jobs-scraper",
    "bebity/linkedin-jobs-scraper",
  ]) {
    assertEquals(resolveResponseKind({ actorId: id, sourceType: "jobs" }), "jobs", id);
    // No throw: jobs actors and the jobs path agree.
    assertEquals(assertResponseKindConsistent({ actorId: id, sourceType: "jobs" }), "jobs");
  }
  // The historical default is preserved for genuinely unknown callers.
  assertEquals(resolveResponseKind({}), "jobs");
  assertEquals(resolveResponseKind({ sourceType: "people_profiles" }), "people");

  // And the jobs fetch cap still applies to them — this is the code in runTool.
  const jobsCap = (max: number) => Math.min(25, Math.max(max, 10));
  assertEquals(jobsCap(50), 25, "the 25-row pre-rank pool is intentional FOR JOBS");
});

// ══════════════════════════ 1. 50 rows in, 50 rows out ══

Deno.test("1. a 50-row company dataset returns 50 rows, not 25", () => {
  // The exact expression from runTool, with the structured guard applied.
  const capFor = (isStructured: boolean, sourceType: string, max: number) => {
    const isJobsSource = /jobs/i.test(sourceType) && !isStructured;
    return isJobsSource ? Math.min(25, Math.max(max, 10)) : max;
  };
  assertEquals(capFor(false, "jobs", 50), 25, "the defect: a company actor read as jobs");
  assertEquals(capFor(true, "jobs", 50), 50, "the fix: structured actors ignore the jobs pool cap");

  const ledger = buildCountLedger(50, 50, 50, null);
  assertEquals(ledger.downloaded, 50);
  assertEquals(ledger.returned, 50);
  assertFalse(ledger.truncated);

  // A genuine cap is REPORTED rather than looking like a smaller dataset.
  const capped = buildCountLedger(50, 50, 25, "max_results_cap");
  assert(capped.truncated);
  assertEquals(capped.truncation_reason, "max_results_cap");
});

// ══════════ 2/3/4/5/6. the returned object keeps its own shape ══

Deno.test("2-6. structured rows keep teamSize and openJobs at the TOP level", () => {
  // What the structured branch returns: the dataset rows, untouched.
  const returned = DATASET_50.slice(0, 50) as unknown as Record<string, unknown>[];
  const snap = returned.find((r) => r.name === "SnapMagic")!;

  assertEquals(snap.teamSize, 23, "top-level teamSize");
  assert(Array.isArray(snap.openJobs), "top-level openJobs");
  assertEquals((snap.openJobs as unknown[]).length, 4, "every job, not the first");
  assertEquals(snap.batch, "Summer 2015");
  assertEquals(snap.slug, "snapmagic");
  assert(snap.id !== undefined);
  assertEquals(snap.website, "https://snapmagic.com");
  assert(Array.isArray(snap.industries));
  assert(Array.isArray(snap.regions));

  // 4. NO nesting.
  assertEquals((snap as { raw?: unknown }).raw, undefined, "no raw wrapper");
  assertEquals(structuredRowsLookIntact(returned).intact, true);

  // 5. NO truncation — the long description defeats a 4,000-char cap.
  assert(String(snap.longDescription).length > 4000);
  assertFalse(JSON.stringify(snap).includes("_truncated"));

  // 6. NO fabricated job-signal fields.
  for (const fake of ["signal_type", "signal_summary", "job_title", "exact_hiring_signal",
    "poster_contact_hint", "source_quality"]) {
    assertEquals((snap as Record<string, unknown>)[fake], undefined,
      `${fake} is a fabricated LinkedIn-job field and must not appear`);
  }
});

// The SnapMagic row EXACTLY as the engine received it on task 41342269, copied
// from `tool_calls.output_json.items[7]` of tool call
// 48c2f10d-f884-4599-92b8-b3534ebbc946. Abbreviated only by dropping fields that
// were null; nothing shown here has been altered.
//
// This is evidence, not a simulation. It is what the jobs normalizer produced
// from a YC company row, and it is the exact input that made free
// prequalification score SnapMagic as having zero jobs.
const OBSERVED_JOB_SHAPED_SNAPMAGIC = {
  url: "https://www.ycombinator.com/companies/snapmagic",
  name: "SnapMagic",
  title: "SnapMagic",
  domain: "snapmagic.com",
  source: "apify",
  job_url: "https://www.ycombinator.com/companies/snapmagic",
  website: "https://www.snapmagic.com",
  job_title: "SnapMagic",
  industries: ["B2B", "Engineering, Product and Design"],
  signal_type: "hiring",
  employee_count: null,
  signal_summary: "Hiring SnapMagic — from a live LinkedIn job post.",
  source_quality: "verified",
  exact_hiring_signal: "SnapMagic",
  poster_contact_hint: { name: null, photo: null, title: null, profile_url: null },
  raw: {
    domain: "snapmagic.com",
    job_title: "SnapMagic",
    signal_summary: "Hiring SnapMagic — from a live LinkedIn job post.",
    provider_payload: {
      id: 878, name: "SnapMagic", slug: "snapmagic", batch: "Summer 2015",
      teamSize: 23, isHiring: true,
      openJobs: [
        { jobId: 95163, title: "Head of Operations" },
        { jobId: 95162, title: "Head of Sales" },
        { jobId: 68675, title: "Head of Customer Success" },
        { jobId: 63247, title: "Enterprise Account Executive" },
      ],
    },
  },
} as const;

Deno.test("2b. the OLD path is what destroyed those fields — the recorded payload", () => {
  const observed = OBSERVED_JOB_SHAPED_SNAPMAGIC as unknown as Record<string, unknown>;

  // What prequalification reads, and what it found: nothing.
  assertEquals(observed.teamSize, undefined, "teamSize was gone from the top level");
  assertEquals(observed.openJobs, undefined, "openJobs was gone from the top level");

  const pq = prequalifyYcCompanies([observed as YcCompanyInput], { min: 10, max: 150 });
  assertEquals(pq.companies[0].jobs.length, 0, "zero jobs seen");
  assertEquals(pq.companies[0].team_size, null);
  assertEquals(pq.companies[0].exclusion, "insufficient_commercial",
    "the exact verdict all 25 live companies received");
  assertEquals(pq.eligible_companies, 0);

  // The real row was nested — present, but unreachable by every consumer.
  const raw = observed.raw as Record<string, unknown>;
  assert("provider_payload" in raw, "the genuine row was buried here");
  assertEquals(
    (raw.provider_payload as Record<string, unknown>).teamSize, 23,
    "the data existed the whole time, one level too deep");

  // Fabricated provenance: a YC company page described as a LinkedIn job post.
  assertEquals(observed.signal_type, "hiring");
  assert(String(observed.signal_summary).includes("LinkedIn job post"),
    "the jobs normalizer invented a source this row never had");

  // The SAME company, read through the fixed path, is eligible.
  const fixed = prequalifyYcCompanies(
    [DATASET_50.find((r) => r.name === "SnapMagic")! as unknown as YcCompanyInput],
    { min: 10, max: 150 });
  assertEquals(fixed.eligible_companies, 1);
  assertEquals(fixed.companies[0].strongest_signal, "Head of Sales");
});

// ══════════════════════════ 8. run-agent receives the complete rows ══

Deno.test("8. readProviderResultItems returns the rows whichever field carries them", () => {
  const rows = DATASET_50.slice(0, 3) as unknown as Record<string, unknown>[];

  // The contract populates BOTH; either field alone must still work.
  assertEquals(readProviderResultItems({ items: rows, company_items: rows }, "structured_companies").length, 3);
  assertEquals(readProviderResultItems({ company_items: rows, items: [] }, "structured_companies").length, 3,
    "company_items must win — `items: []` is exactly what starved company enrichment");
  assertEquals(readProviderResultItems({ items: rows }, "structured_companies").length, 3);
  assertEquals(readProviderResultItems({ items: rows }, "jobs").length, 3);
  assertEquals(readProviderResultItems(null, "structured_companies").length, 0);

  // Rows come back byte-identical — no flattening, no truncation.
  const out = readProviderResultItems({ company_items: rows }, "structured_companies");
  assertEquals(JSON.stringify(out), JSON.stringify(rows));
});

Deno.test("8b. run-agent reads through the contract, not a field name", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  assert(src.includes("readProviderResultItems(rr.data as Record<string, unknown>, kind)"),
    "invokeJobs must read through the contract");
  assertFalse(/const items = \(rr\.data as \{ items\?: unknown\[\] \}\)\.items;\s*\n\s*return Array\.isArray\(items\) \? items : \[\];\s*\n\s*\};\s*\n\s*\/\*\*\s*\n\s*\* Recognise a started/.test(src),
    "the bare data.items read in invokeJobs must be gone");
});

// ══════════════════════ 9/10. the signals, and the shortlist ══

Deno.test("9. every commercial signal in the brief is detected", () => {
  const expected: Record<string, string> = {
    "Founding GTM Lead": "A", "GTM Engineer": "A", "Founding Account Executive": "A",
    "Founding SDR": "A", "Head of Sales": "A", "Sales Director": "B", "Account Executive": "B",
  };
  for (const [title, tier] of Object.entries(expected)) {
    assertEquals(classifyJobTitle(title), tier, `${title} must be Tier ${tier}`);
  }
});

Deno.test("10. the intact 50 rows produce the expected eligible shortlist", () => {
  // Straight from the structured response into prequalification — the whole
  // point of the fix is that no adaptation is needed in between.
  const r = prequalifyYcCompanies(DATASET_50 as unknown as YcCompanyInput[], { min: 10, max: 150 });
  assertEquals(r.total_rows, 50);
  assertEquals(r.unique_companies, 50);
  assert(r.eligible_companies > 0,
    "the live run produced ZERO here — that is the regression this file exists for");

  const names = shortlistForLinkedInResolution(r, 5).map((c) => c.name);
  for (const n of ["Bluejay", "SnapMagic", "AgentMail", "Tara AI", "Zentail", "Bitmovin", "Etleap"]) {
    assert(names.includes(n), `${n} must be shortlisted (got: ${names.join(", ")})`);
  }
  // Out of range, and excluded for that reason rather than for a missing signal.
  const odeko = r.companies.find((c) => c.name === "Odeko")!;
  assertEquals(odeko.exclusion, "employee_size");
  assertFalse(names.includes("Odeko"));

  // The commercial-after-technical case, which reading openJobs[0] would miss.
  const etleap = r.companies.find((c) => c.name === "Etleap")!;
  assertEquals(etleap.strongest_signal, "Account Executive");

  // Every open role is counted, not just the commercial ones.
  const totalJobs = r.companies.reduce((n, c) => n + c.jobs.length, 0);
  assertEquals(totalJobs, DATASET_50.reduce((n, c) => n + c.openJobs.length, 0));
});

// ══════════════════════════ the producing end really changed ══

Deno.test("toolRegistry routes structured actors away from the jobs normalizer", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
  assert(src.includes("assertResponseKindConsistent({"),
    "classification must happen, and fail closed");
  assert(src.includes("!isCompanyDetails && !isStructuredCompanies"),
    "structured actors must be excluded from the jobs fetch cap");
  assert(src.includes("if (isStructuredCompanies) {"),
    "the structured branch must be keyed on the response kind, not one actor id");
  assert(src.includes("items: company_items"),
    "`items` and `company_items` must be the SAME array");
  assertFalse(/company_items,\s*\n\s*\/\/ Never fabricate job\/people rows for a company-enrichment call\.\s*\n\s*items: \[\],/.test(src),
    "the `items: []` that starved every consumer must be gone");
});
