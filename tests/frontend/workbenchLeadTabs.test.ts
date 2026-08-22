// THREE BUCKETS A USER ACTS ON DIFFERENTLY, AND NOTHING ELSE.
//
// Every result used to land in one table: a company that qualified, one still
// waiting on a decision-maker, and one the run never reached rendered as
// adjacent rows of equal weight. "10 qualified" and "74 never looked at" read
// as one list of 84 things.
//
// ZERO network, ZERO React.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LEAD_TAB_EMPTY, LEAD_TAB_LABEL, notReachedCompanies, partitionLeads,
  ruledOutCompanies, tabsFor,
} from "../../src/lib/workbench/leadTabs.ts";

// deno-lint-ignore no-explicit-any
const row = (o: Record<string, unknown>): any => o;
// deno-lint-ignore no-explicit-any
const company = (o: Record<string, unknown>): any =>
  ({ resumable: false, evaluated: true, status: "evaluated", ...o });

// ═══ 1. QUALIFIED READS AN EXPLICIT VERDICT ════════════════════════════════

Deno.test("1. only an explicit pass counts as qualified", () => {
  // `quota_eligible: true` alone is NOT a pass: the decision-maker gate runs
  // first, and a row with no `decision_maker_status` is `needs_decision_maker`
  // however eligible the quota says it is. The first version of this fixture
  // omitted it and the code was right to refuse — the gates are ordered so an
  // explicit eligibility flag cannot skip a verification that never happened.
  const p = partitionLeads([
    row({ quota_eligible: true, decision_maker_status: "verified", contact_status: "verified" }),
    row({ quota_eligible: false, decision_maker_status: "verified" }),
    row({}),
  ]);
  assertEquals(p.qualified.length, 1, "one row was actually accepted");
  assertEquals(p.inReview.length, 1, "the ineligible-but-evaluated row is in review");
});

Deno.test("2. ABSENCE OF A REJECTION IS NOT A PASS", () => {
  // `level !== 'not_qualified'` once reported 20 qualified companies for a run
  // that qualified none. A row nothing has looked at must land in NEITHER
  // bucket — calling it "in review" would claim a review that never happened.
  const p = partitionLeads([row({}), row({}), row({})]);
  assertEquals(p.qualified.length, 0);
  assertEquals(p.inReview.length, 0, "unevaluated is not pending");
});

Deno.test("3. a decided rejection is in neither actionable bucket", () => {
  const p = partitionLeads([row({ disposition: "reject", gate_decision: "fail" })]);
  assertEquals(p.qualified.length, 0);
  assertEquals(p.inReview.length, 0, "there is no action to take on a ruled-out company");
});

// ═══ 2. NOT REACHED IS THE ENGINE'S OWN ANSWER ═════════════════════════════

Deno.test("4. `not reached` reads `resumable`, never a status guess", () => {
  // A status-based inference would disagree with the resume path about what
  // resuming actually does, and the tab would promise work that never happens.
  const rows = [
    company({ resumable: true, status: "not_investigated" }),
    company({ resumable: true, status: "discovered" }),
    company({ resumable: false, status: "not_qualified" }),
  ];
  assertEquals(notReachedCompanies(rows).length, 2);
  assertEquals(ruledOutCompanies(rows).length, 1);
});

Deno.test("5. and the two sets never overlap", () => {
  const rows = [
    company({ resumable: true }), company({ resumable: false }),
    company({ resumable: true }), company({ resumable: false, evaluated: false }),
  ];
  const reached = new Set(notReachedCompanies(rows));
  assert(ruledOutCompanies(rows).every((r) => !reached.has(r)),
    "a company cannot be both waiting to be checked and already ruled out");
});

// ═══ 3. THE TAB ROW ════════════════════════════════════════════════════════

Deno.test("6. Qualified is always first, and always present at zero", () => {
  // A tab that disappears when empty makes "no qualified leads" and "this run
  // does not do that" the same picture, and shifts every other tab under the
  // reader's cursor between runs.
  const t = tabsFor({ qualified: 0, inReview: 0, notReached: 0, hasInsights: false });
  assertEquals(t[0].id, "qualified");
  assertEquals(t[0].count, 0);
});

Deno.test("7. `Not reached` appears only when there is something to resume", () => {
  const finished = tabsFor({ qualified: 10, inReview: 2, notReached: 0, hasInsights: false });
  assert(!finished.some((t) => t.id === "not_reached"),
    "a tab that always reads zero says nothing");

  const stopped = tabsFor({ qualified: 10, inReview: 2, notReached: 74, hasInsights: false });
  const tab = stopped.find((t) => t.id === "not_reached");
  assertEquals(tab?.count, 74);
});

Deno.test("8. Activity is last; Insights only when there is any", () => {
  const none = tabsFor({ qualified: 1, inReview: 0, notReached: 0, hasInsights: false });
  assertEquals(none[none.length - 1].id, "activity");
  assert(!none.some((t) => t.id === "insights"));

  const some = tabsFor({ qualified: 1, inReview: 0, notReached: 0, hasInsights: true });
  assertEquals(some.map((t) => t.id), ["qualified", "in_review", "insights", "activity"]);
});

Deno.test("9. count-less tabs carry null, not zero", () => {
  const t = tabsFor({ qualified: 3, inReview: 0, notReached: 0, hasInsights: true });
  assertEquals(t.find((x) => x.id === "insights")?.count, null,
    "`Insights 0` would read as a count of something that is not counted");
  assertEquals(t.find((x) => x.id === "activity")?.count, null);
});

// ═══ 4. THE WORDS ══════════════════════════════════════════════════════════

Deno.test("10. no internal vocabulary on the tabs", () => {
  const labels = Object.values(LEAD_TAB_LABEL).join(" ");
  for (const jargon of ["pending", "unfinished", "contact-ready", "resumable", "lifecycle"]) {
    assert(!labels.toLowerCase().includes(jargon),
      `"${jargon}" is an internal name for a process, not a description of what ` +
      "the reader is looking at");
  }
});

Deno.test("11. the three result tabs are distinguishable at a glance", () => {
  // "Checking" and "Not checked" — the first attempt — differ by one word and
  // read as the same thing in peripheral vision.
  const [a, b, c] = ["qualified", "in_review", "not_reached"]
    .map((k) => LEAD_TAB_LABEL[k as keyof typeof LEAD_TAB_LABEL].toLowerCase());
  assert(new Set([a, b, c]).size === 3);
  assert(!b.includes(c) && !c.includes(b),
    `"${b}" and "${c}" must not contain one another`);
});

Deno.test("12. an empty tab says what the bucket MEANS, not that it is empty", () => {
  // Only the RESULT tabs. Insights and Activity are records of what happened;
  // "no activity recorded yet" is the whole truth and padding it would be
  // words for their own sake. The first version of this test applied one
  // length rule to all five and failed on the honest short one.
  for (const id of ["qualified", "in_review", "not_reached"] as const) {
    const text = LEAD_TAB_EMPTY[id];
    assert(text.length > 30, `${id} needs a real sentence, not "nothing here"`);
    assert(/because|once|when|still|every/i.test(text),
      `${id} must explain what would put something in this bucket`);
  }
  assert(LEAD_TAB_EMPTY.not_reached.includes("Every company was checked"),
    "an empty `Not reached` is GOOD NEWS and must read like it");
});
