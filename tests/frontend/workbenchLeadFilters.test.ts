// FILTERS AND EXPORT, FORWARD-PORTED INTO THE CURRENT WORKBENCH.
//
// ── WHAT THESE PROTECT ─────────────────────────────────────────────────────
//
// Export lived in the Workbench's always-rendered action bar until `2ba36cfc`
// folded that bar into a selection-gated one. The button was never deleted and
// its handler never broke — it simply became unreachable without ticking a
// checkbox, and no test noticed because no test asked whether it was on screen.
// So these tests assert REACHABILITY, not just behaviour.
//
// The filter model is ported from the Lead Library's toolbar (`10be6305`) onto
// the Workbench's own row type. The two axes the Workbench already had —
// `Has website` and the Fit chips — must come through unchanged; a port that
// quietly changes what an existing control does is a regression wearing a
// feature's clothes.
//
// ZERO network, ZERO React.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  EMPTY_WORKBENCH_FILTERS, applyWorkbenchFilters, filterOptionsFrom,
  activeFilterCount, hasActiveFilters, filterChips, clearFilterKey,
  locationBucket, hasHiringSignal, effectiveFit, SIZE_BANDS,
  type WorkbenchFilters, type FilterableLead,
} from "../../src/lib/workbench/leadFilters.ts";
import {
  workbenchRowsToCsv, workbenchCsvHeader, csvEscape, rowsForScope,
  exportFilename, qualificationOf, WORKBENCH_EXPORT_COLUMNS, CSV_BOM,
  type ExportableLead, type ExportScope,
} from "../../src/lib/workbench/leadExport.ts";
import { partitionLeads } from "../../src/lib/workbench/leadTabs.ts";
import { qualificationFromRow } from "../../src/lib/qualifiedLead/rowQualification.ts";

const f = (o: Partial<WorkbenchFilters> = {}): WorkbenchFilters =>
  ({ ...EMPTY_WORKBENCH_FILTERS, ...o });

// deno-lint-ignore no-explicit-any
const lead = (o: Record<string, unknown>): any => o;

// ═══ 1. THE TWO EXISTING AXES SURVIVE THE PORT ═════════════════════════════

Deno.test("1. Has website and Fit N+ behave exactly as they did before", () => {
  const rows: FilterableLead[] = [
    lead({ company_name: "A", website: "a.com", fit_score: 91 }),
    lead({ company_name: "B", website: null, fit_score: 95 }),
    lead({ company_name: "C", website: "c.com", fit_score: 40 }),
  ];
  assertEquals(applyWorkbenchFilters(rows, f({ hasWebsite: true })).map((r) => r.company_name), ["A", "C"]);
  assertEquals(applyWorkbenchFilters(rows, f({ minFit: 90 })).map((r) => r.company_name), ["A", "B"]);
  // The old predicate was `(r.fit_score ?? 0) < minFit`. Same answers.
  assertEquals(applyWorkbenchFilters(rows, f({ minFit: 60 })).map((r) => r.company_name), ["A", "B"]);
});

Deno.test("1b. the gate's final score outranks the analyst's, and a missing score is zero", () => {
  const rows: FilterableLead[] = [
    lead({ company_name: "downgraded", fit_score: 95, final_overall_fit: 30 }),
    lead({ company_name: "unscored" }),
  ];
  assertEquals(effectiveFit(rows[0]), 30);
  assertEquals(effectiveFit(rows[1]), 0);
  assertEquals(applyWorkbenchFilters(rows, f({ minFit: 60 })).length, 0);
});

// ═══ 2. THE NEW AXES, AND THE ONE THAT IS NOT WHAT IT SOUNDS LIKE ══════════

Deno.test("2. location matches the whole free-text string, not just the tail", () => {
  assertEquals(locationBucket("London, England, United Kingdom"), "United Kingdom");
  assertEquals(locationBucket("Remote"), "Remote");
  assertEquals(locationBucket(null), "");
  const rows: FilterableLead[] = [
    lead({ company_name: "UK1", company_location: "London, England, United Kingdom" }),
    lead({ company_name: "UK2", company_location: "Manchester, United Kingdom" }),
    lead({ company_name: "US1", company_location: "Austin, Texas, United States" }),
  ];
  assertEquals(
    applyWorkbenchFilters(rows, f({ location: "United Kingdom" })).map((r) => r.company_name),
    ["UK1", "UK2"],
  );
});

Deno.test("2b. an unknown headcount is not a match for a headcount band", () => {
  const rows: FilterableLead[] = [
    lead({ company_name: "in", employee_count: 120 }),
    lead({ company_name: "edge_low", employee_count: 20 }),
    lead({ company_name: "edge_high", employee_count: 200 }),
    lead({ company_name: "out", employee_count: 900 }),
    lead({ company_name: "unknown", employee_count: null }),
  ];
  assertEquals(
    applyWorkbenchFilters(rows, f({ size: "smb" })).map((r) => r.company_name),
    ["in", "edge_low", "edge_high"],
  );
  // The band boundaries partition the whole range with no gap and no overlap.
  for (let i = 1; i < SIZE_BANDS.length; i++) {
    assertEquals(SIZE_BANDS[i].min, SIZE_BANDS[i - 1].max + 1);
  }
});

Deno.test("2c. the hiring filter reads job evidence on the row, never an engine stage", () => {
  // `HiringStage` (verified / evidence_unavailable) lives in the lineage
  // checkpoint and is NOT projected onto a persisted lead row. This filter
  // therefore answers a narrower, checkable question, and its label says so.
  const rows: FilterableLead[] = [
    lead({ company_name: "posted", job_title: "Head of Growth" }),
    lead({ company_name: "url_only", job_url: "https://x/jobs/1" }),
    lead({ company_name: "silent" }),
  ];
  assert(hasHiringSignal(rows[0]) && hasHiringSignal(rows[1]) && !hasHiringSignal(rows[2]));
  assertEquals(
    applyWorkbenchFilters(rows, f({ hiring: "has_signal" })).map((r) => r.company_name),
    ["posted", "url_only"],
  );
  assertEquals(
    applyWorkbenchFilters(rows, f({ hiring: "no_signal" })).map((r) => r.company_name),
    ["silent"],
  );
});

Deno.test("2d. options are derived from the rows on screen, never a fixed vocabulary", () => {
  const rows: FilterableLead[] = [
    lead({ company_location: "Leeds, United Kingdom", industries: ["SaaS", "HR Tech"], signal_type: "hiring" }),
    lead({ company_location: "Austin, United States", industries: ["SaaS"], found_via: "linkedin_jobs" }),
  ];
  const o = filterOptionsFrom(rows);
  assertEquals(o.locations, ["United Kingdom", "United States"]);
  assertEquals(o.industries, ["HR Tech", "SaaS"]);
  assertEquals(o.sources, ["hiring", "linkedin_jobs"]);
  // Nothing invented: a run with no UK rows must not offer a UK filter.
  assertEquals(filterOptionsFrom([]).locations, []);
});

// ═══ 3. COMPOSITION ════════════════════════════════════════════════════════

Deno.test("3. multiple filters compose as AND across axes", () => {
  const rows: FilterableLead[] = [
    lead({ company_name: "match", company_location: "London, United Kingdom", employee_count: 50, job_title: "SDR", website: "m.com" }),
    lead({ company_name: "wrong_country", company_location: "Austin, United States", employee_count: 50, job_title: "SDR", website: "w.com" }),
    lead({ company_name: "too_big", company_location: "London, United Kingdom", employee_count: 5000, job_title: "SDR", website: "t.com" }),
    lead({ company_name: "no_signal", company_location: "London, United Kingdom", employee_count: 50, website: "n.com" }),
  ];
  const applied = f({ location: "United Kingdom", size: "smb", hiring: "has_signal" });
  assertEquals(applyWorkbenchFilters(rows, applied).map((r) => r.company_name), ["match"]);
  assertEquals(activeFilterCount(applied), 3);
});

Deno.test("3b. Clear filters resets the view to every row on the tab", () => {
  const rows: FilterableLead[] = [
    lead({ company_name: "A", company_location: "London, United Kingdom", website: "a.com" }),
    lead({ company_name: "B", company_location: "Austin, United States" }),
  ];
  const narrowed = f({ location: "United Kingdom", hasWebsite: true, q: "a" });
  assertEquals(applyWorkbenchFilters(rows, narrowed).length, 1);
  assert(hasActiveFilters(narrowed));
  const cleared = { ...EMPTY_WORKBENCH_FILTERS };
  assertEquals(applyWorkbenchFilters(rows, cleared).length, 2);
  assertEquals(activeFilterCount(cleared), 0);
  assert(!hasActiveFilters(cleared));
});

Deno.test("3c. one chip clears one axis and leaves the rest standing", () => {
  const applied = f({ location: "United Kingdom", size: "smb", minFit: 75, hasWebsite: true });
  const chips = filterChips(applied);
  assertEquals(chips.map((c) => c.key), ["location", "size", "minFit", "hasWebsite"]);
  assertStringIncludes(chips[1].label, "20–200");
  const after = clearFilterKey(applied, "size");
  assertEquals(after.size, "any");
  assertEquals(after.location, "United Kingdom");
  assertEquals(activeFilterCount(after), 3);
});

Deno.test("3d. an empty filter set never removes a row", () => {
  const rows: FilterableLead[] = [lead({}), lead({ company_name: null }), lead({ employee_count: null })];
  assertEquals(applyWorkbenchFilters(rows, { ...EMPTY_WORKBENCH_FILTERS }).length, 3);
});

Deno.test("3e. filtering returns the SAME row objects — it never mutates or rebuilds them", () => {
  const a = lead({ company_name: "A", website: "a.com" });
  const before = JSON.stringify(a);
  const out = applyWorkbenchFilters([a], f({ hasWebsite: true }));
  assert(out[0] === a, "filtering must not copy or wrap the row");
  assertEquals(JSON.stringify(a), before, "filtering must not mutate the row");
});

// ═══ 4. CSV ESCAPING ═══════════════════════════════════════════════════════

Deno.test("4. commas, quotes, newlines and carriage returns are escaped", () => {
  assertEquals(csvEscape("plain"), "plain");
  assertEquals(csvEscape("a,b"), '"a,b"');
  assertEquals(csvEscape('say "hi"'), '"say ""hi"""');
  assertEquals(csvEscape("line1\nline2"), '"line1\nline2"');
  // A LONE CR still splits a row in Excel. The first version of this escaper
  // tested only for `\n` and would have let it through unquoted.
  assertEquals(csvEscape("line1\rline2"), '"line1\rline2"');
  assertEquals(csvEscape(null), "");
  assertEquals(csvEscape(undefined), "");
  assertEquals(csvEscape(0), "0");
});

Deno.test("4b. a cell holding every hostile character survives a round trip", () => {
  const nasty = 'Acme, "Inc"\nUK\rLtd — café 日本';
  const csv = workbenchRowsToCsv([lead({ company_name: nasty })]);
  assertStringIncludes(csv, '"Acme, ""Inc""\nUK\rLtd — café 日本"');
  // The BOM is the first thing in the file, or Excel reads it as the local codepage.
  assert(csv.startsWith(CSV_BOM));
  assertEquals(csv.charCodeAt(0), 0xfeff);
});

Deno.test("4c. an empty export is a header, not an empty file", () => {
  const csv = workbenchRowsToCsv([]);
  assertEquals(csv, CSV_BOM + workbenchCsvHeader() + "\r\n");
  assertStringIncludes(csv, "Company,Website");
});

// ═══ 5. WHAT THE EXPORT MAY AND MAY NOT CONTAIN ════════════════════════════

Deno.test("5. the export carries business columns and no engine internals", () => {
  const header = workbenchCsvHeader();
  for (const h of [
    "Company", "Website", "LinkedIn", "Location", "Employees", "Industry",
    "Hiring status", "Hiring evidence", "Source",
    "Qualification status", "Qualification score", "Qualification reason",
  ]) assertStringIncludes(header, h);

  // The ~110-column diagnostic export (leadTable/csv.ts) still owns all of this
  // and keeps its own menu entry. None of it belongs in a file someone shares.
  for (const banned of [
    "provider_job_id", "provider_ref_id", "tracking_id", "input_url",
    "scout_penalties", "relaxation_step_used", "quota_eligible",
    "planner", "prompt", "raw",
  ]) assert(!header.toLowerCase().includes(banned), `header must not carry ${banned}`);
});

Deno.test("5b. a score of zero exports blank, because nobody scored it zero", () => {
  const col = WORKBENCH_EXPORT_COLUMNS.find(([h]) => h === "Qualification score")!;
  assertEquals(col[2](lead({})), "");
  assertEquals(col[2](lead({ fit_score: 0 })), "");
  assertEquals(col[2](lead({ fit_score: 74 })), 74);
});

Deno.test("5c. the export's qualification column agrees with the tabs", () => {
  const status = WORKBENCH_EXPORT_COLUMNS.find(([h]) => h === "Qualification status")!;
  const passed = lead({ contact_status: "verified", raw: { quota_eligible: true, decision_maker_status: "verified" } });
  // NOT `quota_eligible: false` — that short-circuits at step 1 of the resolver
  // and means "not quota-eligible", which is In review. A stated REJECT
  // disposition is the thing that rules a company out.
  const ruled = lead({ contact_status: "needs_contact", raw: { disposition: "reject" } });
  assert(qualificationOf(passed).qualified);
  assert(!qualificationOf(ruled).qualified);
  assertStringIncludes(String(status[2](passed)), "Qualified");
  assertEquals(status[2](ruled), "Ruled out");
});

Deno.test("5d. filenames are safe and name their scope", () => {
  assertEquals(exportFilename("current_view", "c2ac9d7b-8e5c-4cd2"), "leads-current-view-c2ac9d7b.csv");
  assertEquals(exportFilename("qualified", "c2ac9d7b-8e5c"), "qualified-leads-c2ac9d7b.csv");
  assertEquals(exportFilename("qualified", null), "qualified-leads.csv");
  assert(!exportFilename("current_view", 'a"b,c\nd').includes('"'));
});

// ═══ 6. THE REALISTIC WORKBENCH FIXTURE ════════════════════════════════════
//
// Five qualified, five ruled out, mixed countries, mixed headcounts, mixed
// scores — shaped the way `useLeadResults` actually hands rows over, with the
// controlling verdict inside `raw` where `qualificationFromRow` reads it.

interface Spec {
  name: string; country: string; size: number | null; fit: number;
  qualified: boolean; job?: string | null; industry?: string;
}

const SPECS: Spec[] = [
  // ── qualified ──
  { name: "Storm4", country: "United Kingdom", size: 120, fit: 92, qualified: true, job: "Account Executive" },
  { name: "Talentoma", country: "United Kingdom", size: 45, fit: 88, qualified: true, job: "SDR" },
  { name: "EVONA", country: "United Kingdom", size: 900, fit: 81, qualified: true, job: "Recruiter" },
  { name: "Storm3", country: "United States", size: 60, fit: 77, qualified: true, job: "Head of Sales" },
  { name: "CareerXperts", country: "India", size: 12, fit: 64, qualified: true, job: null },
  // ── ruled out ──
  { name: "Bigcorp", country: "United Kingdom", size: 40000, fit: 30, qualified: false, job: "VP Sales" },
  { name: "Staffing Ltd", country: "United Kingdom", size: 80, fit: 22, qualified: false, job: "Consultant" },
  { name: "Nowhere Inc", country: "United States", size: null, fit: 10, qualified: false, job: null },
  { name: "Quiet Co", country: "Germany", size: 150, fit: 45, qualified: false, job: null },
  { name: "Tiny AG", country: "Germany", size: 4, fit: 51, qualified: false, job: "Founder" },
];

const FIXTURE: ExportableLead[] = SPECS.map((s) => lead({
  id: s.name,
  company_name: s.name,
  company_location: `Somewhere, ${s.country}`,
  website: `https://${s.name.toLowerCase().replace(/\W/g, "")}.com`,
  company_linkedin_url: `https://linkedin.com/company/${s.name.toLowerCase().replace(/\W/g, "")}`,
  employee_count: s.size,
  industries: [s.industry ?? "Staffing & Recruiting"],
  fit_score: s.fit,
  job_title: s.job ?? null,
  job_url: s.job ? `https://linkedin.com/jobs/${s.name}` : null,
  signal_type: "hiring",
  contact_status: s.qualified ? "verified" : "needs_contact",
  raw: s.qualified
    ? { quota_eligible: true, decision_maker_status: "verified" }
    // A REJECT disposition (step 2), not `quota_eligible: false` (step 1) —
    // the latter resolves to `needs_verification` and would land these five in
    // the In review tab, which is a different claim entirely.
    : { disposition: "reject" },
}));

/** Exactly what `LeadResultsView` does: partition first, then filter. */
function tabRows(tab: "qualified" | "in_review") {
  const p = partitionLeads(FIXTURE.map((r) => ({ ...r, ...qualificationFromRow(r) })) as never);
  return (tab === "qualified" ? p.qualified : p.inReview) as unknown as ExportableLead[];
}

Deno.test("6. the fixture partitions five and five, by the current resolver", () => {
  assertEquals(tabRows("qualified").map((r) => r.company_name),
    ["Storm4", "Talentoma", "EVONA", "Storm3", "CareerXperts"]);
  // Ruled-out rows are not "in review": a stated rejection is a decision.
  assertEquals(tabRows("in_review").length, 0);
});

Deno.test("6b. Qualified + UK yields the expected subset, and nothing from another tab", () => {
  const shown = applyWorkbenchFilters(tabRows("qualified"), f({ location: "United Kingdom" }));
  assertEquals(shown.map((r) => r.company_name), ["Storm4", "Talentoma", "EVONA"]);
  // The tab is not overridden: Bigcorp and Staffing Ltd are UK rows that the
  // filter would happily match, and they are ruled out, so they are not here.
  assert(!shown.some((r) => r.company_name === "Bigcorp"));
  assert(!shown.some((r) => r.company_name === "Staffing Ltd"));
});

Deno.test("6c. Qualified + UK + 20–200 + hiring signal narrows to two", () => {
  const shown = applyWorkbenchFilters(
    tabRows("qualified"),
    f({ location: "United Kingdom", size: "smb", hiring: "has_signal" }),
  );
  assertEquals(shown.map((r) => r.company_name), ["Storm4", "Talentoma"]);
});

Deno.test("6d. Export current view is EXACTLY the rows on screen", () => {
  const shown = applyWorkbenchFilters(tabRows("qualified"), f({ location: "United Kingdom" }));
  const rows = rowsForScope("current_view", { visible: shown, all: FIXTURE });
  assertEquals(rows.map((r) => r.company_name), shown.map((r) => r.company_name));

  const csv = workbenchRowsToCsv(rows);
  const lines = csv.replace(CSV_BOM, "").trimEnd().split("\r\n");
  assertEquals(lines.length, 4, "one header + three rows");
  for (const n of ["Storm4", "Talentoma", "EVONA"]) assertStringIncludes(csv, n);
  for (const n of ["Storm3", "CareerXperts", "Bigcorp", "Quiet Co"]) {
    assert(!csv.includes(n), `${n} is not on screen and must not be exported`);
  }
});

Deno.test("6e. Export qualified leads ignores the tab and the filters", () => {
  const shown = applyWorkbenchFilters(tabRows("qualified"), f({ location: "United Kingdom", size: "smb" }));
  assertEquals(shown.length, 2);
  const rows = rowsForScope("qualified", { visible: shown, all: FIXTURE });
  assertEquals(rows.map((r) => r.company_name),
    ["Storm4", "Talentoma", "EVONA", "Storm3", "CareerXperts"]);
  const csv = workbenchRowsToCsv(rows);
  for (const n of ["Bigcorp", "Staffing Ltd", "Nowhere Inc", "Quiet Co", "Tiny AG"]) {
    assert(!csv.includes(n), `${n} was ruled out and must never be in a qualified export`);
  }
});

Deno.test("6f. exporting an empty view is safe and still says what the columns are", () => {
  const shown = applyWorkbenchFilters(tabRows("qualified"), f({ location: "Antarctica" }));
  assertEquals(shown.length, 0);
  const csv = workbenchRowsToCsv(rowsForScope("current_view", { visible: shown, all: FIXTURE }));
  assertEquals(csv, CSV_BOM + workbenchCsvHeader() + "\r\n");
});

Deno.test("6g. every scope is covered, so a new one cannot be added silently", () => {
  const scopes: ExportScope[] = ["current_view", "qualified"];
  for (const s of scopes) {
    assert(rowsForScope(s, { visible: [], all: FIXTURE }) !== undefined);
  }
});

// ═══ 7. THE CONTROLS ARE ON SCREEN ═════════════════════════════════════════
//
// The regression this file exists for was never a broken function — it was a
// working function with nothing rendering a way to call it. Source assertions
// are the only place that can be caught without a DOM.

const BAR = Deno.readTextFileSync(
  new URL("../../src/components/chat/workspace/workbench/LeadFilterBar.tsx", import.meta.url),
);
const VIEW = Deno.readTextFileSync(
  new URL("../../src/components/chat/workspace/workbench/LeadResultsView.tsx", import.meta.url),
);

Deno.test("7. every filter axis has a control", () => {
  for (const control of [
    "Search leads", "Any location", "Any size", "Any industry",
    "Hiring signal", "Contact", "Any source", "Has website", "Fit {v}+",
  ]) assertStringIncludes(BAR, control);
});

Deno.test("7b. Clear filters is rendered with its active count", () => {
  assertStringIncludes(BAR, "Clear filters");
  assertStringIncludes(BAR, "activeFilterCount(filters)");
  assertStringIncludes(BAR, "EMPTY_WORKBENCH_FILTERS");
});

Deno.test("7c. export is reachable WITHOUT a selection — the 2ba36cfc regression", () => {
  // The filter bar renders on the lead tabs unconditionally; it is not inside
  // any `selectedRows.length > 0` branch. If someone moves it back under one,
  // this fails.
  assertStringIncludes(VIEW, "<LeadFilterBar");
  const barTag = VIEW.slice(VIEW.indexOf("<LeadFilterBar"));
  assertStringIncludes(barTag.slice(0, 600), "onExport={runExport}");
  const guard = VIEW.slice(0, VIEW.indexOf("<LeadFilterBar"));
  const lastGate = guard.lastIndexOf("selectedRows.length > 0");
  const lastOpen = guard.lastIndexOf("{(tab === 'qualified' || tab === 'in_review') && (");
  assert(lastOpen > lastGate, "the filter/export bar must not sit inside a selection gate");
});

Deno.test("7d. both export scopes are offered, and the diagnostic export is kept and separate", () => {
  assertStringIncludes(BAR, "EXPORT_SCOPE_LABEL");
  assertStringIncludes(BAR, "onExportDiagnostic");
  assertStringIncludes(VIEW, "runDiagnosticExport");
  // The ~110-column export still exists and still uses its own builder.
  assertStringIncludes(VIEW, "rowsToCsv(filtered, meta.qualified_lead_run");
});

Deno.test("7e. the result contract the Workbench renders is untouched", () => {
  // Nothing in this port may reach the tabs, the run summary, the RunOutcome
  // headline or the continuation bar.
  for (const kept of [
    "partitionLeads", "partitionAllRows", "notReachedCompanies", "tabsFor",
    "LEAD_TAB_EMPTY", "buildRunSummary", "RunDetails",
  ]) assertStringIncludes(VIEW, kept);
  // And no filter may narrow a tab that has nothing to filter.
  assert(!VIEW.includes("tab === 'not_reached' && <LeadFilterBar"));
});
