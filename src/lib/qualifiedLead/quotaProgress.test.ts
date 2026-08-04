// PART 3 + PART 5 — the canonical quota adapter and the Workbench counts.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQuotaProgress, type QuotaCandidate } from "./quotaProgress.ts";
import { buildWorkbenchCounts, cardQuotaNote } from "./workbenchCounts.ts";
import { type QualificationRecord } from "./qualification.ts";

// The live shape: eleven job posts reviewed, one company qualified, no person.
const ONE_COMPANY_NO_PERSON = {
  requested_leads: 5,
  eligible_leads: 0,
  remaining_leads: 5,
  quota_policy: "contact_only",
  terminal_status: "continuation_required",
  task_status: "partial",
  rounds_completed: 1,
  counts: { rawJobs: 11, verifiedCompanies: 1, candidates: 1, contact: 0 },
};

const NO_PERSON_CANDIDATE: QuotaCandidate = {
  company: "LAHZO", person: null,
  quota_eligible: false, decision_maker_status: "missing",
  gate_decision: "accept", analyst_verdict: "needs_verification",
  fit_score: 58, fit_tier: "rejected", contact_status: "needs_contact",
};

Deno.test("PART 3: the example run renders exactly the required five lines", () => {
  const p = buildQuotaProgress(ONE_COMPANY_NO_PERSON, [NO_PERSON_CANDIDATE]);
  assertEquals(p.lines, [
    "11 hiring signals reviewed",
    "1 qualified company",
    "0 verified decision-makers",
    "0 of 5 CONTACT-ready leads",
    "5 remaining",
  ]);
});

Deno.test("PART 3: a qualified company with no person is 1 company and 0 leads", () => {
  const p = buildQuotaProgress(ONE_COMPANY_NO_PERSON, [NO_PERSON_CANDIDATE]);
  assertEquals(p.qualifiedCompanies, 1);
  assertEquals(p.eligible, 0);
  assertEquals(p.remaining, 5);
  assertEquals(p.verifiedDecisionMakers, 0);
});

Deno.test("PART 3: the five headline metrics are separate and separately labelled", () => {
  const p = buildQuotaProgress(ONE_COMPANY_NO_PERSON, [NO_PERSON_CANDIDATE]);
  assertEquals(p.metrics.map((m) => m.label), [
    "Hiring signals reviewed",
    "Qualified companies",
    "Verified decision-makers",
    "CONTACT-ready leads",
    "Remaining CONTACT quota",
  ]);
});

Deno.test("PART 3: eligible comes from the quota contract, never from cards or writes", () => {
  // Ten VISIBLE, PERSISTED, gate-accepted cards; the runtime says zero eligible.
  const cards: QuotaCandidate[] = Array.from({ length: 10 }, (_, i) => ({
    ...NO_PERSON_CANDIDATE, company: `Co ${i}`,
  }));
  const p = buildQuotaProgress(ONE_COMPANY_NO_PERSON, cards);
  assertEquals(p.eligible, 0, "ten visible cards must not become ten leads");
  assertEquals(p.eligibleSource, "backend_quota");
  assertEquals(p.headline, "0 of 5 CONTACT-ready leads");
});

Deno.test("PART 3: with no backend quota field, eligibility falls back to precedence", () => {
  const p = buildQuotaProgress(
    { requested_leads: 5, quota_policy: "contact_only" },
    [
      NO_PERSON_CANDIDATE,
      { company: "Real", person: "A Founder", quota_eligible: true, decision_maker_status: "verified", employer_match_status: "verified", disposition: "CONTACT", contact_status: "profile_found" },
    ],
  );
  assertEquals(p.eligible, 1);
  assertEquals(p.eligibleSource, "candidate_precedence");
  assertEquals(p.remaining, 4);
});

Deno.test("PART 3: raw jobs never leak into the lead count", () => {
  const p = buildQuotaProgress({ ...ONE_COMPANY_NO_PERSON, counts: { rawJobs: 25, verifiedCompanies: 3 } }, []);
  assertEquals(p.hiringSignalsReviewed, 25);
  assertEquals(p.eligible, 0);
  assertFalse(p.headline.includes("25"));
});

// ---- PART 5: Workbench counts ---------------------------------------------

Deno.test("PART 5: account counts and lead counts are separate groups", () => {
  const p = buildQuotaProgress(ONE_COMPANY_NO_PERSON, [NO_PERSON_CANDIDATE]);
  const counts = buildWorkbenchCounts({ rows: [NO_PERSON_CANDIDATE], progress: p });

  // EVALUATED sits between discovery and qualification. It was added because
  // "Accounts found: 20 / Qualified companies: 20" hid the fact that nothing had
  // been judged at all — the two counters were adjacent and looked like a funnel.
  assertEquals(counts.map((c) => c.label), [
    "ACCOUNTS FOUND", "EVALUATED", "QUALIFIED COMPANIES",
    "DECISION-MAKERS VERIFIED", "CONTACT-READY", "REMAINING",
  ]);
  const byKey = Object.fromEntries(counts.map((c) => [c.key, c]));
  assertEquals(byKey.accounts_found.group, "account");
  assertEquals(byKey.evaluated.group, "account");
  assertEquals(byKey.contact_ready.group, "lead");
  // One visible account row, zero CONTACT-ready leads. The old header said 1/1.
  assertEquals(byKey.accounts_found.value, 1);
  assertEquals(byKey.contact_ready.value, 0);
  assertEquals(byKey.remaining.value, 5);
});

Deno.test("PART 5: a visible non-qualifying card states it earns zero quota credit", () => {
  const note = cardQuotaNote(NO_PERSON_CANDIDATE);
  assertEquals(note.tone, "warning");
  assert(note.text.includes("0 CONTACT quota credit"), note.text);
  assertFalse(note.text.toLowerCase().includes("qualified lead"));
});

Deno.test("PART 5: a genuinely CONTACT-ready card says it counts", () => {
  const rec: QualificationRecord = {
    quota_eligible: true, decision_maker_status: "verified", employer_match_status: "verified",
    disposition: "CONTACT", contact_status: "profile_found",
  };
  assertEquals(cardQuotaNote(rec), { text: "Counts as 1 CONTACT-ready lead", tone: "positive" });
});
