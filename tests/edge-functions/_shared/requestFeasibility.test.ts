// THE GRAPH MUST BE ABLE TO PROVE WHAT THE REQUEST PROMISES.
//
// Stage 0's pinned matrix. Valid requests execute, unsupported ones refuse, and
// no requirement disappears silently between the sentence and the plan.
//
// The two cases that motivated this file:
//
//   "Find companies with headcount growth."      -> planned 4 paid stages,
//     preflight ok, zero advisories, nothing able to prove headcount_change.
//
//   "Find decision makers at companies matching my ICP." -> promised
//     contact_ready_leads from a graph with no person stage at all.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  assessRequestFeasibility,
  outputVocabularyIsCovered,
  missionCohortOf,
} from "../../../supabase/functions/_shared/requestFeasibility.ts";

const assess = (q: string) => {
  const m = parseLeadMissionDeterministic(q, {});
  const plan = buildCapabilityGraph(m);
  return { m, plan, report: assessRequestFeasibility(m, plan) };
};
const statusOf = (q: string, needle: string) => {
  const { report } = assess(q);
  const all = [...report.requirements, ...report.outputs];
  return all.find((r) => r.requirement.toLowerCase().includes(needle))?.status;
};

// ── requests that must remain executable ───────────────────────────────────

Deno.test("ICP-only request is feasible", () => {
  const { report } = assess("Find companies matching my ICP.");
  assertEquals(report.refusals, []);
  assert(report.ok);
});

Deno.test("hiring request is feasible now that verification is scheduled", () => {
  const { plan, report } = assess(
    "Find companies matching my ICP that are actively hiring sales roles.");
  assert(plan.steps.some((s) => s.capability === "hiring_verification"));
  assertEquals(report.refusals, []);
  assertEquals(report.requirements.find((r) => r.requirement.includes("hiring"))?.by_capability,
    "hiring_verification");
});

Deno.test("funding request is feasible", () => {
  const { report } = assess("Find SaaS companies that raised funding in the last 90 days.");
  assertEquals(report.refusals, []);
  assertEquals(statusOf("Find SaaS companies that raised funding in the last 90 days.", "fund"),
    "satisfied");
});

Deno.test("expansion + hiring — both requirements are proven", () => {
  const { report } = assess("Find companies expanding into Europe and hiring salespeople.");
  assertEquals(report.refusals, []);
  for (const r of report.requirements) {
    assertEquals(r.status, "satisfied", `${r.requirement} was not proven: ${r.message}`);
  }
});

// ── a partly-provable request proceeds, and DECLARES the gap ───────────────

Deno.test("an unprovable SECONDARY signal is a declared gap, not a refusal", () => {
  // Hiring is served by `hiring_verification`; `headcount_change` appears
  // nowhere in ACTOR_EVIDENCE and no capability can establish it. The run must
  // still proceed — the user gets the hiring companies they can have — but the
  // gap is now named instead of being invisible, which is what stops execution
  // reporting headcount as checked.
  const m = parseLeadMissionDeterministic("Find companies hiring sales roles.", {});
  const withGap = {
    ...m,
    required_signals: [...m.required_signals, { type: "headcount_change" } as never],
  };
  const plan = buildCapabilityGraph(withGap);
  const report = assessRequestFeasibility(withGap, plan);

  assertEquals(report.refusals, [], "a served primary requirement must still run");
  assert(report.ok);
  assertEquals(
    report.requirements.find((r) => r.requirement === "headcount_change")?.status,
    "unsupported",
  );
  assert(
    report.declared_gaps.some((g) => g.startsWith("headcount_change")),
    `the gap must be declared, got ${JSON.stringify(report.declared_gaps)}`,
  );
});

// ── requests that must refuse BEFORE spend ─────────────────────────────────

Deno.test("headcount growth refuses — no stated requirement is provable", () => {
  const { report } = assess("Find companies with headcount growth.");
  assertEquals(report.refusals.map((r) => r.code), ["no_requirement_provable"]);
  assertEquals(report.ok, false);
  assertEquals(statusOf("Find companies with headcount growth.", "headcount"), "unsupported");
});

// ── the person boundary is staged, not broken ──────────────────────────────

Deno.test("decision makers is requires_unlock, NOT a refusal", () => {
  // People stages are stripped from every automatic plan on purpose. Refusing
  // here would block the core Lead flow; the honest answer is that the run
  // produces the company stage and the contact stage needs an explicit unlock.
  const { m, plan, report } = assess("Find decision makers at companies matching my ICP.");
  assertEquals(m.requested_output, "contact_ready_leads");
  assertEquals(
    plan.steps.some((s) =>
      ["founder_discovery", "contact_enrichment"].includes(s.capability)), false,
    "precondition: people stages are stripped from an automatic plan");
  assertEquals(report.refusals, [], "must not block the lead flow");
  assertEquals(report.outputs[0].status, "requires_unlock");
  assert(report.declared_gaps.some((g) => g.includes("contact_ready_leads")));
});

// ── the generalisation: population coverage, for every signal ──────────────

Deno.test("cohort-scoped evidence does not satisfy an unrestricted population", () => {
  const m = parseLeadMissionDeterministic(
    "Find companies matching my ICP that are actively hiring sales roles.", {});
  const plan = buildCapabilityGraph(m);
  assertEquals(missionCohortOf(plan), null, "this mission is not YC-restricted");

  // Strip the paid verification and only cohort-scoped hiring evidence remains,
  // which must NOT count — the original hiring bug, generalised.
  const stripped = {
    ...plan,
    steps: plan.steps.filter((s) => s.capability !== "hiring_verification"),
  };
  const report = assessRequestFeasibility(m, stripped as typeof plan);
  const hiring = report.requirements.find((r) => r.requirement.includes("hiring"));
  assert(hiring && hiring.status !== "satisfied",
    `cohort-only evidence must not satisfy: ${JSON.stringify(hiring)}`);
  assertEquals(report.ok, false, "the sole requirement is unmet, so it must refuse");
});

Deno.test("a YC-scoped mission DOES accept the YC actor's embedded evidence", () => {
  const m = parseLeadMissionDeterministic(
    "Find YC startups that are actively hiring sales roles.", {});
  const plan = buildCapabilityGraph(m);
  if (plan.entry_capability !== "startup_company_discovery") return;
  assertEquals(missionCohortOf(plan), "y_combinator");
  const stripped = {
    ...plan,
    steps: plan.steps.filter((s) => s.capability !== "hiring_verification"),
  };
  const report = assessRequestFeasibility(m, stripped as typeof plan);
  assertEquals(report.refusals, [], "embedded YC evidence covers a YC population");
});

// ── structural guarantees ──────────────────────────────────────────────────

Deno.test("every requested_output in the vocabulary is validatable", () => {
  const { ok, missing } = outputVocabularyIsCovered();
  assert(ok, `outputs with no artifact stated (feasible by default): ${missing.join(", ")}`);
});

Deno.test("every gap carries a requirement, a reason and structured detail", () => {
  const { report } = assess("Find companies with headcount growth.");
  for (const r of [...report.requirements, ...report.outputs]) {
    if (r.status === "satisfied") continue;
    assert(r.requirement.trim().length > 0, "must name what failed");
    assert(r.message.trim().length > 10, "must be actionable");
    assert(Object.keys(r.detail).length > 0, "must carry structured detail");
  }
});

Deno.test("no mission or no plan is not reported as infeasible", () => {
  assertEquals(assessRequestFeasibility(null, null).ok, true);
});

// ── a stated constraint that reached no signal must be declared ────────────
//
// `required_signal_terms` records the material constraints the user named.
// `readSignalPhrases` folds each into the signal it qualifies; anything left
// unattached was understood, carried, and yet is verified by nothing. The card
// must say so rather than let it pass.

Deno.test("a folded term is NOT reported as a gap", () => {
  const base = parseLeadMissionDeterministic(
    "Find companies actively hiring sales roles.", {});
  const m = {
    ...base,
    required_signals: [{
      type: "hiring", event: "hiring", subject: "company",
      qualifier: { role_terms: ["sales roles"] }, phrase: "hiring sales roles",
    }],
    required_signal_terms: ["sales roles"],
  } as unknown as typeof base;
  const report = assessRequestFeasibility(m, buildCapabilityGraph(m));
  assertEquals(
    report.declared_gaps.filter((g) => g.startsWith("sales roles")), [],
    "the constraint reached the signal, so it is not a gap",
  );
});

Deno.test("an unattached term IS reported as a gap", () => {
  // The exact pre-fix shape from the authenticated card: the signal carried an
  // empty qualifier while the constraint sat in a parallel field.
  const base = parseLeadMissionDeterministic(
    "Find companies actively hiring sales roles.", {});
  const m = {
    ...base,
    required_signals: [{
      type: "hiring", event: "hiring", subject: "company", qualifier: {}, phrase: "hiring",
    }],
    required_signal_terms: ["sales roles"],
  } as unknown as typeof base;
  const report = assessRequestFeasibility(m, buildCapabilityGraph(m));
  assert(
    report.declared_gaps.some((g) => g.startsWith("sales roles")),
    `a stated constraint verified by nothing must be declared: ${JSON.stringify(report.declared_gaps)}`,
  );
});
