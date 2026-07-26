// PART 4 — qualification precedence, including the LAHZO-shaped regression.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveQualification, countContactReady, type QualificationRecord } from "./qualification.ts";

// The exact contradictory record the manual run produced. Every legacy field
// disagrees with the runtime's own answer.
const LAHZO: QualificationRecord = {
  fit_score: 58,
  fit_tier: "rejected",
  analyst_verdict: "needs_verification",
  gate_decision: "accept",
  decision_maker_status: "missing",
  contact_status: "needs_contact",
  quota_eligible: false,
};

Deno.test("LAHZO regression: a contradictory record is NOT a qualified lead", () => {
  const q = resolveQualification(LAHZO);

  assertFalse(q.contactReady);
  assertEquals(q.quotaCredit, 0);
  assertEquals(q.level, "needs_decision_maker");
  // The explicit runtime answer wins over gate_decision: "accept".
  assertEquals(q.decidedBy, "quota_eligible");

  const shown = q.displayLines;
  assert(shown.includes("Needs verification"), shown.join(" | "));
  assert(shown.includes("Decision-maker missing"), shown.join(" | "));
  assert(shown.includes("Not CONTACT-ready"), shown.join(" | "));
  assert(shown.includes("0 quota credit"), shown.join(" | "));
});

Deno.test("LAHZO regression: the forbidden 'Qualified lead / 1 of 5' copy cannot render", () => {
  const rendered = [...resolveQualification(LAHZO).displayLines, ...resolveQualification(LAHZO).context]
    .join(" | ").toLowerCase();
  for (const bad of ["qualified lead", "1 of 5", "contact-ready"]) {
    // "Not CONTACT-ready" contains "contact-ready", so check the affirmative form.
    if (bad === "contact-ready") {
      assertFalse(/(^|[^t] )contact-ready/.test(rendered.replace("not contact-ready", "")), rendered);
      continue;
    }
    assertFalse(rendered.includes(bad), `leaked "${bad}"`);
  }
  assertEquals(countContactReady([LAHZO]), 0);
});

Deno.test("fit tier and score are context only — they never qualify or disqualify", () => {
  const q = resolveQualification(LAHZO);
  assertEquals(q.context, ["Fit score 58", "Fit tier: rejected"]);

  // A perfect legacy score cannot promote a record whose runtime answer is false.
  const perfectButIneligible = resolveQualification({ ...LAHZO, fit_score: 99, fit_tier: "hot" });
  assertFalse(perfectButIneligible.contactReady);

  // A terrible legacy score cannot demote a genuinely eligible one.
  const eligible = resolveQualification({
    quota_eligible: true, disposition: "CONTACT", decision_maker_status: "verified",
    employer_match_status: "verified", gate_decision: "accept", analyst_verdict: "qualified",
    contact_status: "profile_found", fit_score: 12, fit_tier: "rejected",
  });
  assert(eligible.contactReady);
  assertEquals(eligible.quotaCredit, 1);
});

Deno.test("each blocking condition independently withholds CONTACT-ready", () => {
  const base: QualificationRecord = {
    quota_eligible: true, disposition: "CONTACT", decision_maker_status: "verified",
    employer_match_status: "verified", gate_decision: "accept", analyst_verdict: "qualified",
    contact_status: "profile_found",
  };
  assert(resolveQualification(base).contactReady, "control must be CONTACT-ready");

  const blocked: Array<[string, QualificationRecord]> = [
    ["quota_eligible false", { ...base, quota_eligible: false }],
    ["disposition REJECT", { ...base, quota_eligible: null, disposition: "REJECT" }],
    ["disposition SKIP", { ...base, quota_eligible: null, disposition: "SKIP" }],
    ["decision-maker missing", { ...base, quota_eligible: null, decision_maker_status: "missing" }],
    ["employer failed", { ...base, quota_eligible: null, employer_match_status: "mismatch" }],
    ["gate reject", { ...base, quota_eligible: null, gate_decision: "reject" }],
  ];
  for (const [name, rec] of blocked) {
    const q = resolveQualification(rec);
    assertFalse(q.contactReady, `${name} should not be CONTACT-ready`);
    assertEquals(q.quotaCredit, 0, name);
    assert(q.displayLines.includes("0 quota credit"), name);
  }
});

Deno.test("precedence order is explicit: quota_eligible outranks disposition and gate", () => {
  // Everything downstream says yes; the runtime says no. The runtime wins.
  const q = resolveQualification({
    quota_eligible: false, disposition: "CONTACT", decision_maker_status: "verified",
    employer_match_status: "verified", gate_decision: "accept", analyst_verdict: "qualified",
  });
  assertEquals(q.decidedBy, "quota_eligible");
  assertFalse(q.contactReady);

  // With quota_eligible absent, disposition decides before the gate.
  const d = resolveQualification({ disposition: "REJECT", gate_decision: "accept", decision_maker_status: "verified" });
  assertEquals(d.decidedBy, "disposition");
});

Deno.test("a missing decision-maker status is treated as missing, not as passing", () => {
  const q = resolveQualification({ disposition: "CONTACT", gate_decision: "accept" });
  assertEquals(q.level, "needs_decision_maker");
  assertFalse(q.contactReady);
});

Deno.test("countContactReady counts credit, never records", () => {
  const eligible: QualificationRecord = {
    quota_eligible: true, decision_maker_status: "verified", employer_match_status: "verified",
    disposition: "CONTACT", contact_status: "profile_found",
  };
  assertEquals(countContactReady([LAHZO, LAHZO, eligible, LAHZO]), 1);
});
