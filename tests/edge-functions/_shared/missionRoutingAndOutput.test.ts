// THE SEVEN MISSIONS, ROUTED — AND WHAT EACH ACTUALLY RETURNS.
//
// ── THREE DEFECTS THIS PINS ─────────────────────────────────────────────────
//
// 1. "POSTING" WAS READ AS "JOB POSTINGS". The output-mode test matched a bare
//    `\bpostings?\b`, so the present participle in "companies POSTING about AI"
//    compiled to `requested_output: job_listings` — and because the OUTPUT picks
//    the plan, the whole run became job_discovery → job_deduplication. The
//    signal was read correctly as post/company and then never used. The flagship
//    benchmark was safe only because it says "posted".
//
// 2. THREE VERIFICATIONS WERE DECLARED AND NEVER SCHEDULED.
//    `technology_verification`, `company_post_verification` and
//    `product_launch_verification` had capability ids, registry entries,
//    approved providers and `evidence_required` — and no branch pushed a step.
//    So `resolveSignalSupport` truthfully said technology was SUPPORTED while a
//    technology mission could never reach a technology actor.
//
// 3. A PERSON REQUEST SILENTLY RETURNED COMPANIES. Person work is unlock-gated
//    and never scheduled, which is correct; handing back accounts with no
//    statement that a substitution happened is not.
//
// PURE. No network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  resolveMissionOutput, outputContractViolations,
} from "../../../supabase/functions/_shared/missionOutputContract.ts";

const plan = (q: string) => {
  const m = parseLeadMissionDeterministic(q);
  return { m, g: buildCapabilityGraph(m), steps: buildCapabilityGraph(m).steps.map((s) => s.capability) };
};

// ═══════════════ 1-2. "POSTING" IS NOT "JOB POSTINGS" ══════════════════════

Deno.test("1. social posting language never routes to the jobs plan", () => {
  for (const q of [
    "Find companies posting on LinkedIn about AI.",
    "Find companies posting about AI adoption.",
    "Find companies whose leadership is posting about US expansion.",
    "Find founders posting about outbound problems.",
    "Find founders whose comments show they may need help with outbound.",
    // The two halves of the veto, exercised separately so removing EITHER is
    // caught: social phrasing with a job noun present, and a bare participle.
    "Find companies posting about open roles in AI.",
    "Find companies commenting on AI regulation.",
  ]) {
    const { m, steps } = plan(q);
    assertFalse(m.requested_output === "job_listings", `${q} → job_listings`);
    assertFalse(steps.includes("job_discovery"), `${q} → job_discovery`);
  }
});

Deno.test("2. REAL job language still routes to the jobs plan", () => {
  // The fix must not become "never route to jobs". Each of these asks for
  // openings as the OUTPUT, not for companies that happen to be hiring.
  for (const q of [
    "Find 10 jobs at cybersecurity companies.",
    "Show me the job postings at these companies.",
    "Find companies with open roles in sales.",
    "List current vacancies at Series A startups.",
  ]) {
    const { m } = plan(q);
    assertEquals(m.requested_output, "job_listings", q);
  }
});

Deno.test("2b. a PERSON NOUN is a person request — unless it is a headcount", () => {
  // "Find 5 PEOPLE matching my ICP" compiled to `target_entity: company`,
  // because the person-noun list covered decision-makers, contacts and leads
  // but not the plainest word for the thing.
  for (const q of [
    "Find 5 people matching my ICP and showing strong intent.",
    "Find 5 decision makers at SaaS companies.",
    "Show me prospects who are hiring.",
    "Find founders posting about outbound problems.",
  ]) {
    assertEquals(parseLeadMissionDeterministic(q).target_entity, "person", q);
  }

  // ── THE HAZARD, AND WHY THE VETO EXISTS ──────────────────────────────────
  //
  // "people" is also the unit headcount is measured in. Reading these as person
  // requests would turn every size-bounded COMPANY search into a contact-ready
  // mission — and person work is unlock-gated, so the user would be told their
  // company search needs an authorisation it never needed.
  for (const q of [
    "Find companies with 500 people.",
    "Find SaaS companies with a team of 20 people.",
    "Find companies with 50-200 employees.",
    "Find B2B companies under 100 people.",
    "Find companies of about 30 people in Europe.",
  ]) {
    assertEquals(parseLeadMissionDeterministic(q).target_entity, "company", q);
  }
});

// ═══════════════ 3-5. THE THREE NEWLY SCHEDULED VERIFICATIONS ══════════════

Deno.test("3. a TECHNOLOGY mission now reaches a technology actor", () => {
  const { steps } = plan("Find 10 companies using Snowflake.");
  assert(steps.includes("technology_verification"),
    `technology was SUPPORTED and unreachable; steps: ${steps.join(" → ")}`);
  // It stays verification-only: BuiltWith takes a domain list and has no query
  // field, so there is no discovery counterpart to schedule.
  assert(steps.indexOf("company_enrichment") < steps.indexOf("technology_verification"),
    "the domain must be resolved before the stack is read");
});

Deno.test("4. a COMPANY-POST mission now reads the company's posts", () => {
  const { steps } = plan("Find companies posting about AI adoption.");
  assert(steps.includes("company_post_verification"), steps.join(" → "));
  assert(steps.indexOf("company_identity_resolution") < steps.indexOf("company_post_verification"),
    "a company page read needs a resolved company URL");
});

Deno.test("5. a LEADERSHIP-post mission schedules NO company-page read", () => {
  // THE BOUNDARY. A post signal about a person is a claim about that person.
  // Answering it with their employer's marketing page would report the signal
  // as satisfied by evidence about somebody else.
  const { steps, g } = plan("Find companies whose leadership is posting about US expansion.");
  assertFalse(steps.includes("company_post_verification"), steps.join(" → "));
  // It surfaces as an authorisation instead.
  assert(g.offered_capabilities.includes("offer_founder_unlock"));
});

Deno.test("6. a PRODUCT-LAUNCH mission verifies as well as discovers", () => {
  const { steps } = plan("Find companies that recently launched a new product.");
  assertEquals(steps[0], "product_launch_discovery");
  assert(steps.includes("product_launch_verification"), steps.join(" → "));
});

// ═══════════════ 7. THE SEVEN TARGET MISSIONS ══════════════════════════════

Deno.test("7. every target mission routes to a plan that can answer it", () => {
  const cases: Array<[string, { entry: string; must: string[]; entity: string }]> = [
    ["Find 10 cybersecurity companies in Europe hiring enterprise sellers.",
      { entry: "general_company_discovery", must: ["hiring_verification"], entity: "company" }],
    ["Find 10 companies using Snowflake.",
      { entry: "general_company_discovery", must: ["technology_verification"], entity: "company" }],
    ["Find companies posting about AI adoption.",
      { entry: "general_company_discovery", must: ["company_post_verification"], entity: "company" }],
    ["Find recently funded SaaS companies showing strong sales-growth signals.",
      { entry: "funding_signal_discovery", must: [], entity: "company" }],
    ["Find founders posting about outbound problems.",
      { entry: "general_company_discovery", must: [], entity: "person" }],
    ["Find founders whose comments show they may need help with outbound.",
      { entry: "general_company_discovery", must: [], entity: "person" }],
    ["Find 5 people matching my ICP and showing strong intent.",
      { entry: "general_company_discovery", must: [], entity: "person" }],
  ];

  for (const [q, want] of cases) {
    const { m, g, steps } = plan(q);
    assertEquals(steps[0], want.entry, `${q}\n  steps: ${steps.join(" → ")}`);
    for (const cap of want.must) {
      assert(steps.includes(cap), `${q} must schedule ${cap}; got ${steps.join(" → ")}`);
    }
    assertEquals(m.target_entity, want.entity, q);
    // EVERY plan ends the same way, and none of them schedules person work.
    assertEquals(steps[steps.length - 1], "persistence", q);
    for (const forbidden of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
      assertFalse(steps.includes(forbidden), `${q} scheduled ${forbidden} automatically`);
    }
    // A PERSON request must surface the authorisation rather than hide it.
    if (want.entity === "person") {
      assert(g.offered_capabilities.includes("offer_founder_unlock"), q);
    }
  }
});

// ═══════════════ 8-11. COMPANIES VS PEOPLE, HONESTLY ═══════════════════════

const co = (k: string, qualified = true) =>
  ({ company_key: k, company_name: k, qualified });
const person = (k: string) =>
  ({ company_key: k, full_name: "Ada Kestrel", title: "Founder",
     linkedin_url: "https://x/in/ada" });

Deno.test("8. a COMPANY request returns companies, with nothing to explain", () => {
  const o = resolveMissionOutput({
    requested_entity: "company", companies: [co("a"), co("b")], people: [],
  });
  assertEquals(o.returned_entity, "company");
  assert(o.rows_are_the_answer);
  assertFalse(o.substitution.occurred);
  assertEquals(outputContractViolations(o), []);
});

Deno.test("9. a PERSON request with people returns PEOPLE", () => {
  const o = resolveMissionOutput({
    requested_entity: "person", companies: [co("a")], people: [person("a")],
  });
  assertEquals(o.returned_entity, "person");
  assert(o.rows_are_the_answer);
  assertFalse(o.substitution.occurred);
  assertEquals(outputContractViolations(o), []);
});

Deno.test("10. a PERSON request with none says so, and names the unlock", () => {
  // ── THE SILENT SUBSTITUTION THIS ENDS ────────────────────────────────────
  //
  // The run used to hand back accounts for "find founders", with nothing
  // recording that the question had not been answered. A renderer reading
  // `rows_are_the_answer` now cannot caption those accounts as founders.
  const o = resolveMissionOutput({
    requested_entity: "person",
    companies: [co("a"), co("b"), co("c", false)],
    people: [],
    people_unlock: { capability: "find_decision_makers", credits: 2 },
  });
  assertEquals(o.returned_entity, "company", "it must report what it RETURNS");
  assertFalse(o.rows_are_the_answer);
  assert(o.substitution.occurred);
  assertEquals(o.substitution.reason, "awaiting_people_unlock");
  assertEquals(o.substitution.accounts_pending, 2, "only QUALIFIED accounts wait");
  assertEquals(o.substitution.unlock_capability, "find_decision_makers");
  assertEquals(o.substitution.unlock_credits, 2);
  assert(/These are the accounts, not the people/.test(o.substitution.message ?? ""));
  assertEquals(outputContractViolations(o), []);
});

Deno.test("11. no qualified accounts is a DIFFERENT message from no unlock", () => {
  // Sending a user to buy a decision maker for zero qualified accounts would be
  // selling them a lookup against nothing.
  const o = resolveMissionOutput({
    requested_entity: "person", companies: [co("a", false)], people: [],
    people_unlock: { capability: "find_decision_makers", credits: 2 },
  });
  assertEquals(o.substitution.reason, "no_qualified_accounts");
  assertEquals(o.substitution.accounts_pending, 0);
  assert(/nobody to look up/.test(o.substitution.message ?? ""));
});

Deno.test("12. the contract guard catches every way of misrepresenting a result", () => {
  const good = resolveMissionOutput({
    requested_entity: "person", companies: [co("a")], people: [],
    people_unlock: { capability: "find_decision_makers", credits: 2 },
  });
  assertEquals(outputContractViolations(good), []);

  // Claiming people while carrying none.
  assert(outputContractViolations({ ...good, returned_entity: "person" })
    .some((v) => /carrying none/.test(v)));
  // Substituting silently.
  assert(outputContractViolations({
    ...good, substitution: { ...good.substitution, occurred: false },
  }).some((v) => /without recording a substitution/.test(v)));
  // A substitution with no message.
  assert(outputContractViolations({
    ...good, substitution: { ...good.substitution, message: null },
  }).some((v) => /silent substitution/.test(v)));
  // Substituted, and still claiming the rows are the answer.
  assert(outputContractViolations({ ...good, rows_are_the_answer: true })
    .some((v) => /must not claim its rows are the answer/.test(v)));
  // Awaiting an unlock that is never named.
  assert(outputContractViolations({
    ...good, substitution: { ...good.substitution, unlock_capability: null },
  }).some((v) => /naming no capability/.test(v)));
});
