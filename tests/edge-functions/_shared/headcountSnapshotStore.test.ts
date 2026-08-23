// THE SERIES, AND THE RULES THE SQL CANNOT ENFORCE.
//
// ── WHAT THIS PINS ──────────────────────────────────────────────────────────
//
// The migration refuses a non-positive count, a row with no identity, and a
// same-day duplicate. It cannot know that a YC scraper's `teamSize` is
// self-reported and was observed stale, that two companies sharing a name are
// not one series, or that a provider's observation time is not the write time.
//
// Those three are the rules that decide whether a growth verdict means
// anything, and they live in `headcountSnapshotStore`. Each is asserted here
// against the case that would otherwise produce confident, invented growth.
//
// PURE. No database, no network, no model call.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSnapshotRow, companyKeyFor, readSeries, seriesReadiness,
  isSameDayDuplicate, isExactHeadcountSource, EXACT_HEADCOUNT_SOURCES,
  HEADCOUNT_SNAPSHOT_TABLE, type HeadcountSnapshotRow,
} from "../../../supabase/functions/_shared/headcountSnapshotStore.ts";
import {
  evaluateHeadcountGrowth, evaluateGtmGrowth,
} from "../../../supabase/functions/_shared/headcountGrowth.ts";
import {
  resolveSignalSupport,
} from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import {
  describeSignal,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";

const WS = "11111111-1111-1111-1111-111111111111";
const LI = "https://www.linkedin.com/company/vaultline";

const input = (over: Record<string, unknown> = {}) => ({
  workspace_id: WS,
  linkedin_company_url: LI,
  canonical_domain: "vaultline.io",
  company_name: "Vaultline",
  employee_count: 50,
  observed_at: "2026-05-01T00:00:00.000Z",
  source: "apify_linkedin_company_details",
  ...over,
});

// ═══════════════ 1-3. ONLY A MEASUREMENT MAY ENTER A SERIES ════════════════

Deno.test("1. only a source verified to return an EXACT count may write a reading", () => {
  // A number is not a measurement because it is a number. The YC scraper's
  // teamSize was observed stale (ShipBob returned 1), the company SEARCH's band
  // disagreed with reality in four of eight rows, and the funding source's
  // bucket was populated on 28%. Differencing any of those measures provider
  // disagreement rather than hiring.
  assertEquals(EXACT_HEADCOUNT_SOURCES, ["apify_linkedin_company_details"]);
  assert(isExactHeadcountSource("apify_linkedin_company_details"));

  for (const wrong of [
    "apify_yc_companies_memo23", "apify_linkedin_company_search",
    "apify_funding_rounds_datahyena", "apify_yc_companies_solidcode",
  ]) {
    assertFalse(isExactHeadcountSource(wrong));
    const r = buildSnapshotRow(input({ source: wrong }));
    assertEquals(r.row, null, `${wrong} must not be able to write a reading`);
    assertEquals(r.rejected, "source_not_exact");
    assert(/band|self-declared/.test(r.reason));
  }
});

Deno.test("2. a missing count is not a zero, and a band is not a count", () => {
  for (const bad of [undefined, null, 0, -5, 12.5, Number.NaN]) {
    const r = buildSnapshotRow(input({ employee_count: bad }));
    assertEquals(r.row, null, `employee_count ${String(bad)} must be refused`);
    assertEquals(r.rejected, "no_exact_count");
  }
  // A band arriving as text is refused by the same rule.
  assertEquals(buildSnapshotRow(input({ employee_count: "51-200" })).rejected,
    "no_exact_count");

  assert(buildSnapshotRow(input()).row, "a real integer reading is accepted");
});

Deno.test("3. a reading with no resolvable identity is refused", () => {
  const r = buildSnapshotRow(input({
    linkedin_company_url: null, canonical_domain: null,
  }));
  assertEquals(r.row, null);
  assertEquals(r.rejected, "no_identity");
  // The reason must say WHY a name is not enough, because a name is the
  // tempting fallback and the one that silently merges two companies.
  assert(/company NAME/.test(r.reason));

  // Either identity alone is sufficient.
  assert(buildSnapshotRow(input({ canonical_domain: null })).row);
  assert(buildSnapshotRow(input({ linkedin_company_url: null })).row);
});

// ═══════════════ 4-5. WHAT GROUPS A SERIES ═════════════════════════════════

Deno.test("4. the series key is identity, never a name", () => {
  // The funding validation run attached an Australian fintech's round to a
  // Montreal music ensemble also called Constantinople. A series keyed on a
  // name would difference two different companies and call the gap growth.
  assertEquals(companyKeyFor(LI, null), "li:vaultline");
  assertEquals(companyKeyFor(null, "Vaultline.IO"), "dom:vaultline.io");
  assertEquals(companyKeyFor(null, null), null);

  // The LinkedIn URL wins when both are present: it is the identity this
  // system resolves to and it survives a domain change.
  assertEquals(companyKeyFor(LI, "other.com"), "li:vaultline");
});

Deno.test("5. the same company under different URL forms is ONE series", () => {
  // The post actor returns `/company/stripe/posts`; enrichment returns
  // `/company/stripe`; a user may paste a trailing slash. Three spellings of
  // one company must not become three series, each with one reading and no
  // growth forever.
  const forms = [
    "https://www.linkedin.com/company/vaultline",
    "https://www.linkedin.com/company/vaultline/",
    "https://www.linkedin.com/company/vaultline/posts",
    "https://linkedin.com/company/Vaultline",
  ];
  const keys = new Set(forms.map((f) => companyKeyFor(f, null)));
  assertEquals(keys.size, 1, `expected one key, got ${[...keys].join(", ")}`);
});

// ═══════════════ 6-7. OBSERVATION TIME IS NOT WRITE TIME ═══════════════════

Deno.test("6. the provider's observation time is preserved, not replaced", () => {
  // A backfill inserts old observations today. Dating them now would report a
  // two-month change as having happened this afternoon.
  const r = buildSnapshotRow(input({ observed_at: "2026-01-15T09:00:00.000Z" }));
  assertEquals(r.row!.observed_at, "2026-01-15T09:00:00.000Z");

  // A malformed date is refused rather than silently replaced with now().
  assertEquals(buildSnapshotRow(input({ observed_at: "last Tuesday" })).rejected,
    "observed_at_invalid");

  // Absent, it defaults to now — the common live case.
  const now = buildSnapshotRow(input({ observed_at: null }));
  assert(now.row);
});

Deno.test("7. a second reading on the same day is a repeat, not an observation", () => {
  // Enrichment may run several times a day across missions. Same-day rows carry
  // no new information and would drag the earliest reading forward, silently
  // shortening every growth window.
  const first = buildSnapshotRow(input({ observed_at: "2026-05-01T08:00:00.000Z" })).row!;
  const sameDay = buildSnapshotRow(input({ observed_at: "2026-05-01T20:00:00.000Z" })).row!;
  const nextDay = buildSnapshotRow(input({ observed_at: "2026-05-02T08:00:00.000Z" })).row!;

  assert(isSameDayDuplicate(sameDay, [first]));
  assertFalse(isSameDayDuplicate(nextDay, [first]));

  // A different SOURCE on the same day is not a duplicate — two providers
  // disagreeing is worth keeping, and the constraint is per source.
  const otherSource = { ...sameDay, source: "some_other_source" };
  assertFalse(isSameDayDuplicate(otherSource, [first]));
});

// ═══════════════ 8-10. THE SERIES FEEDS THE VERDICT ════════════════════════

const row = (day: string, n: number): HeadcountSnapshotRow =>
  buildSnapshotRow(input({ observed_at: `${day}T00:00:00.000Z`, employee_count: n })).row!;

Deno.test("8. stored rows become the series the evaluator consumes, oldest first", () => {
  // Deliberately inserted out of order: storage order is arrival order, and the
  // evaluator documents that it expects chronological input.
  const rows = [row("2026-08-01", 70), row("2026-05-01", 50), row("2026-06-15", 60)];
  const series = readSeries(rows, "li:vaultline");

  assertEquals(series.map((s) => s.employee_count), [50, 60, 70]);
  assertEquals(series.length, 3);

  // Rows for a DIFFERENT company are excluded: a series spanning two companies
  // is not a series.
  const other = buildSnapshotRow(input({
    linkedin_company_url: "https://www.linkedin.com/company/other",
    canonical_domain: null, employee_count: 999,
  })).row!;
  assertEquals(readSeries([...rows, other], "li:vaultline").length, 3);
});

Deno.test("9. THE CAPABILITY UNBLOCKS: two stored readings produce a real verdict", () => {
  // The whole point of the table. Before it, `evaluateHeadcountGrowth` could
  // only ever return insufficient_evidence, for every company, forever.
  const now = new Date("2026-08-22T00:00:00.000Z");

  const oneReading = evaluateHeadcountGrowth(
    readSeries([row("2026-05-01", 50)], "li:vaultline"), {}, now);
  assertEquals(oneReading.verdict, "insufficient_evidence");

  const twoReadings = evaluateHeadcountGrowth(
    readSeries([row("2026-05-01", 50), row("2026-08-01", 70)], "li:vaultline"), {}, now);
  assertEquals(twoReadings.verdict, "growth_confirmed");
  assertEquals(twoReadings.percent_change, 40);
  // The verdict cites the readings it used, which is only possible because the
  // series was kept rather than collapsed into one prior value.
  assert(/2026-05-01/.test(twoReadings.reason));
  assert(/2026-08-01/.test(twoReadings.reason));

  // And GTM growth still needs the commercial half.
  assertEquals(evaluateGtmGrowth({
    headcount: twoReadings, hiring_role_families: ["engineering"],
  }).verdict, "no_gtm_growth");
  assertEquals(evaluateGtmGrowth({
    headcount: twoReadings, hiring_role_families: ["gtm_sales"],
  }).verdict, "gtm_growth_confirmed");
});

Deno.test("10. readiness says whether waiting would help, and why", () => {
  // "Unsupported" and "answerable after the next enrichment" are different
  // answers, and a user deciding whether to keep this account is owed the
  // second one.
  const none = seriesReadiness([], "li:vaultline");
  assertEquals(none.reading_count, 0);
  assertFalse(none.differenceable);

  const one = seriesReadiness([row("2026-05-01", 50)], "li:vaultline");
  assertEquals(one.reading_count, 1);
  assertFalse(one.differenceable);
  assert(/next enrichment/.test(one.reason),
    "a single reading must say the capability arrives on its own");
  assertFalse(/provider|actor|source/i.test(one.reason.split("not by asking")[0]),
    "it must not suggest buying anything");

  const two = seriesReadiness(
    [row("2026-05-01", 50), row("2026-08-01", 70)], "li:vaultline");
  assert(two.differenceable);
  assertEquals(two.earliest_observed_at, "2026-05-01T00:00:00.000Z");
  assertEquals(two.latest_observed_at, "2026-08-01T00:00:00.000Z");
});

// ═══════════════ 11. THE HONEST REPORT WHILE THE SERIES IS SHALLOW ═════════

Deno.test("11. growth reports that it is COMPUTED, never that no source exists", () => {
  // Until a workspace has depth, growth is still unanswerable — but the reason
  // must not send a user hunting for a provider that cannot exist.
  const support = resolveSignalSupport(describeSignal("headcount_change", "company"));
  assertEquals(support.status, "capability_gap");
  assert(/COMPUTED, not retrieved/.test(support.reason));
  assert(/company_headcount_snapshots/.test(support.reason),
    "the reason should name where the readings accumulate");
  assert(/Nothing needs to be bought/.test(support.reason));

  // And no Actor is offered for it, because none produces it.
  assertEquals(support.discovery_actors, []);
  assertEquals(support.verification_actors, []);
});

Deno.test("12. the table name is stated once", () => {
  assertEquals(HEADCOUNT_SNAPSHOT_TABLE, "company_headcount_snapshots");
});
