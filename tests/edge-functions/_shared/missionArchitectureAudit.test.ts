// THE TARGET ARCHITECTURE, WALKED END TO END.
//
//   DISCOVERY → GPT MISSION INTELLIGENCE → SMART SHORTLIST → BUDGET →
//   IDENTITY → ENRICHMENT → COMPANY BRAIN → GPT MISSION EVALUATOR →
//   PERSISTENCE → WORKBENCH
//
// Every other test file in this suite guards one stage. This one asserts that
// the stages COMPOSE: that a company entering discovery reaches the Workbench
// carrying a state each stage actually set, that the authority runs in the
// stated direction, and that no stage silently overrides the one downstream of
// it.
//
// It runs the REAL engine with both GPT stages injected as deterministic stubs
// — the same seams production uses (`triageCompanies`, `evaluateMission`), so
// what is exercised here is the real wiring rather than a parallel model of it.
//
// ── THE ELEVEN STATES THAT MAY NOT COLLAPSE ─────────────────────────────────
//
//   relevant · uncertain · irrelevant · success · empty · provider_error ·
//   deferred · unresolved/mismatch · qualified · unknown · rejected
//
// Each is reachable, each is distinguishable at the Workbench, and none of them
// degrades into a generic failure.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  runCapabilityPlan, missionFunnelFor, toResumeRecord, restoreWorkingSet,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  funnelIsBalanced, unbalancedStages,
} from "../../../supabase/functions/_shared/leadMissionFunnel.ts";
import {
  projectEvaluationRows, notQualifiedRows, undecidedRows,
} from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import { nextStageFor } from "../../../supabase/functions/_shared/leadResumeState.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import type { CapabilityEngineDeps } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring software engineers in the United States. " +
  "Return 5 qualified leads.";

const mission = (): LeadMissionV1 => {
  const m = parseLeadMissionDeterministic(CANONICAL);
  return {
    ...m,
    company_profile: { ...m.company_profile, employee_range: { min: 10, max: 500 } },
  };
};

const BRAIN = {
  employee_min: 10, employee_max: 500,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/**
 * Four companies with DELIBERATELY different fates.
 *
 * `relevant0/1` are what the mission asked for. `irrelevant2` is a staffing
 * agency GPT will reject at triage. `uncertain3` has thin data.
 */
const YC_ROWS = [
  { name: "Relevant0", website: "https://relevant0.com", teamSize: 40, id: "relevant0",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS analytics platform.",
    openJobs: [{ title: "Founding Engineer" }] },
  { name: "Relevant1", website: "https://relevant1.com", teamSize: 60, id: "relevant1",
    batch: "W20", industries: ["B2B"], oneLiner: "B2B SaaS data infrastructure.",
    openJobs: [{ title: "Member of Technical Staff" }] },
  { name: "Irrelevant2", website: "https://irrelevant2.com", teamSize: 30, id: "irrelevant2",
    batch: "W20", industries: ["B2B"], oneLiner: "A recruiting agency.",
    openJobs: [{ title: "Recruiter" }] },
  { name: "Uncertain3", website: "https://uncertain3.com", teamSize: 25, id: "uncertain3",
    batch: "W20", industries: ["B2B"], oneLiner: "",
    openJobs: [{ title: "Platform Engineer" }] },
] as unknown as Record<string, unknown>[];

const KEYS = ["relevant0.com", "relevant1.com", "irrelevant2.com", "uncertain3.com"];

const identityRow = (slug: string) => ({
  companyName: slug.replace(/(\d)/, "$1"),
  linkedinUrl: `https://www.linkedin.com/company/${slug}`,
  website: `https://${slug}.com`,
  employeeCount: 42,
  description: `${slug} is a B2B SaaS platform sold on subscription.`,
});

/** GPT MISSION INTELLIGENCE, stubbed at the production seam. */
const triageStub = ({ company_keys }: { company_keys: string[] }) =>
  Promise.resolve({
    verdicts: company_keys.map((k) => ({
      company_key: k,
      relevance: k.startsWith("irrelevant") ? "irrelevant"
        : k.startsWith("uncertain") ? "uncertain" : "relevant",
      confidence: k.startsWith("uncertain") ? 0.2 : 0.9,
      signal_strength: k.startsWith("relevant") ? 90 : 30,
      reasons: [k.startsWith("irrelevant") ? "staffing agency" : "matches the mission"],
      matched_roles: k.startsWith("relevant") ? ["Engineer"] : [],
    })),
  });

/**
 * GPT MISSION EVALUATOR, stubbed at the production seam.
 *
 * Built on the SHARED fixture deliberately: it answers from the company's own
 * evidence registry and its output still goes through
 * `parseMissionEvaluationStrict`, so a claim citing evidence that does not
 * exist is downgraded exactly as a live model's would be. A hand-rolled stub
 * that returned a verdict object directly would bypass grounding — and would
 * therefore prove the pipeline works while silently disabling the rule that
 * keeps it honest.
 */
const evaluatorStub = (
  decide: (key: string) => "pass" | "review" | "fail",
): NonNullable<CapabilityEngineDeps["evaluateMission"]> =>
(args) => stubMissionEvaluator({ mission_fit: decide(args.company_key) })(args);

const runPipeline = async (o: {
  triage?: boolean;
  evaluate?: (key: string) => "pass" | "review" | "fail";
  onEnrich?: () => Record<string, unknown>[];
} = {}) => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  return await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) => {
      if (call.actorKey === "apify_yc_companies_memo23") {
        return Promise.resolve(YC_ROWS);
      }
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve(
          (o.onEnrich
            ? o.onEnrich()
            : KEYS.map((k) => identityRow(k.replace(".com", "")))) as Record<string, unknown>[],
        );
      }
      return Promise.resolve(
        KEYS.map((k) => identityRow(k.replace(".com", ""))) as Record<string, unknown>[],
      );
    },
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    ...(o.triage === false ? {} : { triageCompanies: triageStub }),
    ...(o.evaluate ? { evaluateMission: evaluatorStub(o.evaluate) } : {}),
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60, readEnv: () => undefined,
  } as never);
};

const workbench = (run: Awaited<ReturnType<typeof runPipeline>>) =>
  projectEvaluationRows(run.companies.map((c) => ({
    key: c.key,
    shortlisted: c.shortlisted,
    prequalified: null,
    identityResolved: c.identity !== null,
    identityAttempted: c.identity !== null,
    enriched: c.enriched !== null,
    hiringVerified: c.hiring_jobs.length > 0,
    verdict: c.verdict,
    contactCount: c.contact_identities.length,
    decisionSource: c.decision_source,
    triage: c.triage
      ? {
        relevance: c.triage.relevance, confidence: c.triage.confidence,
        signal_strength: c.triage.signal_strength, reasons: c.triage.reasons,
      }
      : null,
    shortlistExclusion: c.shortlist_exclusion,
    enrichmentOutcome: c.enrichment_outcome,
    stageBlock: c.stage_block,
    missionEvaluation: c.mission_evaluation
      ? {
        decision: c.mission_evaluation.decision,
        match_score: c.mission_evaluation.match_score,
        confidence: c.mission_evaluation.confidence,
        reasoning: c.mission_evaluation.reasoning,
        rejection_reasons: c.mission_evaluation.rejection_reasons,
        failed_requirements: c.mission_evaluation.failed_requirements,
      }
      : null,
  })));

// ══════════════════ 1. the whole chain, one company at a time ══════════════

Deno.test("1. DISCOVERY → … → WORKBENCH: every stage leaves its mark", async () => {
  const run = await runPipeline({ evaluate: () => "pass" });
  const byKey = new Map(run.companies.map((c) => [c.key, c]));

  // DISCOVERY found all four.
  assertEquals(run.companies.length, 4);

  // GPT MISSION INTELLIGENCE judged all four, in its OWN vocabulary — which is
  // deliberately disjoint from the evaluator's so the two can never be confused.
  for (const k of KEYS) {
    const t = byKey.get(k)!.triage;
    assert(t, `${k} must carry a triage verdict`);
    assert(["relevant", "uncertain", "irrelevant"].includes(t!.relevance));
  }
  assertEquals(byKey.get("irrelevant2.com")!.triage!.relevance, "irrelevant");
  assertEquals(byKey.get("uncertain3.com")!.triage!.relevance, "uncertain");

  // SMART SHORTLIST + BUDGET: irrelevant is the only thing triage removes.
  assertFalse(byKey.get("irrelevant2.com")!.shortlisted);
  assertEquals(byKey.get("irrelevant2.com")!.shortlist_exclusion, "triage_irrelevant");
  assert(byKey.get("uncertain3.com")!.shortlisted,
    "UNCERTAIN IS NOT A REJECTION — it costs priority, never a place in the run");
  for (const k of ["relevant0.com", "relevant1.com"]) {
    assert(byKey.get(k)!.shortlisted, `${k} must be investigated`);
  }

  // IDENTITY → ENRICHMENT → BRAIN → EVALUATOR, for everything shortlisted.
  for (const c of run.companies.filter((x) => x.shortlisted)) {
    assert(c.identity !== null, `${c.key}: identity resolution ran`);
    assertEquals(c.enrichment_outcome, "success", c.key);
    assert(c.brain !== null, `${c.key}: reached the Company Brain`);
    assertEquals(c.decision_source, "gpt_evaluation", `${c.key}: GPT decided`);
    assertEquals(c.verdict, "pass", c.key);
  }

  // PERSISTENCE + WORKBENCH.
  assertEquals(run.state.qualified_company_keys.length, 3);
  const wb = workbench(run);
  assertEquals(wb.counts.qualified, 3);
  // A qualified company LEAVES the evaluation projection — it gets a real lead
  // row instead — so the only Workbench row here is the triaged-out one.
  assertEquals(wb.rows.length, 1);
  assertEquals(wb.rows[0].company_key, "irrelevant2.com");
  assertEquals(wb.rows[0].status, "not_investigated");
  assertFalse(wb.rows[0].decided, "triage is not a qualification decision");

  // THE FUNNEL BALANCES — nobody was lost silently anywhere in the chain.
  const f = missionFunnelFor(run.companies);
  assert(funnelIsBalanced(f), JSON.stringify(unbalancedStages(f)));
  assertEquals(f.summary.discovered, 4);
  assertEquals(f.summary.investigated, 3);
  assertEquals(f.summary.qualified, 3);
  assertEquals(f.summary.never_investigated, 1);
});

// ══════════════════════ 2. GPT is the final semantic authority ══════════════

Deno.test("2. the evaluator's verdict is what decides — all three ways", async () => {
  const run = await runPipeline({
    evaluate: (k) => k.startsWith("relevant0") ? "pass"
      : k.startsWith("relevant1") ? "fail" : "review",
  });
  const byKey = new Map(run.companies.map((c) => [c.key, c]));

  assertEquals(byKey.get("relevant0.com")!.verdict, "pass");
  assertEquals(byKey.get("relevant1.com")!.verdict, "reject");
  assertEquals(byKey.get("uncertain3.com")!.verdict, "unknown");
  // AND EACH NAMES GPT AS ITS AUTHOR.
  for (const k of ["relevant0.com", "relevant1.com"]) {
    assertEquals(byKey.get(k)!.decision_source, "gpt_evaluation", k);
  }

  // THE WORKBENCH KEEPS THEM APART. Exactly one row is a rejection; the held
  // one is not, and neither is the triaged-out one.
  const wb = workbench(run);
  assertEquals(notQualifiedRows(wb.rows).map((r) => r.company_key), ["relevant1.com"]);
  assertEquals(undecidedRows(wb.rows).length, 2,
    "the held company and the never-investigated one");
  const held = wb.rows.find((r) => r.company_key === "uncertain3.com")!;
  assertEquals(held.status, "held_for_evidence");
  assertFalse(held.decided);
});

Deno.test("2b. with NO evaluator the run qualifies NOBODY and says so", async () => {
  // DISABLED IS NOT REJECTED. The pre-Phase-4 classifier used to decide on this
  // path; now the absence of the authority is reported as an absence.
  const run = await runPipeline({});
  assertEquals(run.state.qualified_company_keys.length, 0);
  for (const c of run.companies.filter((x) => x.shortlisted)) {
    assertEquals(c.verdict, "unknown", c.key);
    assertEquals(c.decision_source, "insufficient_evidence", c.key);
  }
  const wb = workbench(run);
  assertEquals(notQualifiedRows(wb.rows).length, 0,
    "a run with no evaluator may not produce a single rejection");
  assert(funnelIsBalanced(missionFunnelFor(run.companies)));
});

// ═══════════════════════ 3. every failure fails toward UNKNOWN ══════════════

Deno.test("3. a provider failure never becomes a rejection, anywhere", async () => {
  const run = await runPipeline({
    evaluate: () => "pass",
    onEnrich: () => { throw new Error("actor down"); },
  });

  for (const c of run.companies.filter((x) => x.shortlisted)) {
    assertEquals(c.enrichment_outcome, "provider_error", c.key);
    assertFalse(c.verdict === "reject",
      `${c.key}: a failed provider says nothing about the company`);
  }
  assertEquals(run.state.qualified_company_keys.length, 0,
    "and unenriched evidence may not qualify anyone either");

  const wb = workbench(run);
  assertEquals(wb.counts.not_qualified, 0);
  assert(wb.counts.deferred > 0 || wb.counts.held_for_evidence > 0,
    "the companies must be visible as unfinished work");

  const f = missionFunnelFor(run.companies);
  assert(funnelIsBalanced(f), JSON.stringify(unbalancedStages(f)));
  assertEquals(f.summary.rejected, 0);
  assert(f.summary.withheld > 0);
});

Deno.test("3b. a THROWN triage call excludes nobody", async () => {
  const m = mission();
  const plan = buildCapabilityGraph(m);
  const run = await runCapabilityPlan({
      planDiscovery: stubDiscoverySelector(),
    invoke: (call: CompiledActorCall<unknown>) =>
      Promise.resolve((call.actorKey === "apify_yc_companies_memo23"
        ? YC_ROWS
        : KEYS.map((k) => identityRow(k.replace(".com", "")))) as Record<string, unknown>[]),
    verifyEmployer: () => ({ verified: true, outcome: "ok" }),
    triageCompanies: () => { throw new Error("gpt down"); },
  } as never, {
    mission: m, plan, brain: BRAIN, maxCandidates: 60, readEnv: () => undefined,
  } as never);

  // EVERY company degrades to `uncertain` — which costs priority, never a place.
  for (const c of run.companies) {
    assertEquals(c.triage?.relevance, "uncertain", c.key);
    assertEquals(c.shortlist_exclusion, null, `${c.key}: nobody is excluded`);
  }
  assertEquals(run.companies.filter((c) => c.shortlisted).length, 4);
});

// ═══════════════════════════ 4. resume: deferred work survives ══════════════

Deno.test("4. every stage's state round-trips through the checkpoint", async () => {
  const run = await runPipeline({ evaluate: () => "pass" });
  const records = run.companies.map(toResumeRecord);
  const restored = restoreWorkingSet(records);

  assertEquals(restored.length, run.companies.length, "the whole pool comes back");
  const byKey = new Map(restored.map((c) => [c.key, c]));
  for (const original of run.companies) {
    const back = byKey.get(original.key)!;
    assert(back, `${original.key} must survive`);
    // THE TRIAGE-EXCLUDED COMPANY COMES BACK EXCLUDED, not unknown — otherwise
    // the Workbench loses the reason it was never pursued.
    assertEquals(back.shortlisted, original.shortlisted, original.key);
    assertEquals(back.enrichment_outcome, original.enrichment_outcome, original.key);
  }
  // AND NOTHING FINISHED IS RE-BOUGHT.
  for (const r of records.filter((x) => x.enrichment === "completed")) {
    assertFalse(nextStageFor(r) === "enrichment",
      `${r.company_key}: enrichment was paid for and must not be bought again`);
  }
});

// ═════════════ 5. the eleven states are all reachable and distinguishable ═══

Deno.test("5. no state collapses into a generic failure", async () => {
  const run = await runPipeline({
    evaluate: (k) => k.startsWith("relevant0") ? "pass"
      : k.startsWith("relevant1") ? "fail" : "review",
  });
  const wb = workbench(run);
  const byKey = new Map(run.companies.map((c) => [c.key, c]));

  // TRIAGE VOCABULARY — three distinct values, none of them pass/fail.
  const triage = new Set(run.companies.map((c) => c.triage?.relevance));
  assertEquals([...triage].sort(), ["irrelevant", "relevant", "uncertain"]);

  // ENRICHMENT VOCABULARY.
  assertEquals(byKey.get("relevant0.com")!.enrichment_outcome, "success");
  assertEquals(byKey.get("irrelevant2.com")!.enrichment_outcome, "not_attempted");

  // VERDICT VOCABULARY — qualified / rejected / unknown, kept apart.
  assertEquals(byKey.get("relevant0.com")!.verdict, "pass");
  assertEquals(byKey.get("relevant1.com")!.verdict, "reject");
  assertEquals(byKey.get("uncertain3.com")!.verdict, "unknown");

  // AND THE WORKBENCH RENDERS THREE DIFFERENT THINGS, not one bucket.
  const statuses = new Set(wb.rows.map((r) => r.status));
  assert(statuses.has("not_qualified"), "the judged rejection");
  assert(statuses.has("held_for_evidence"), "the held company");
  assert(statuses.has("not_investigated"), "the one nothing was spent on");
  // EXACTLY ONE of them is a decision.
  assertEquals(wb.rows.filter((r) => r.decided).length, 1);
});

// ═══════════════════════════ 6. cost controls stay bounded and explicit ═════

Deno.test("6. the budget bounds spend and is recorded with its source", async () => {
  const run = await runPipeline({ evaluate: () => "pass" });
  const d = run.state.shortlist_decision!;
  assert(d.budget.budget > 0);
  assert(d.counts.selected <= d.budget.budget,
    "the shortlist may never exceed the authorised budget");
  assert(typeof d.budget.source === "string" && d.budget.source.length > 0,
    "and the budget names where it came from");
  assertEquals(d.untriaged_policy, "rank");
  // THE REQUESTED LEAD COUNT IS NOT THE BUDGET. Five leads were requested; the
  // budget is its own number with its own source.
  assertEquals(d.budget.requested_count, 5);
  assertFalse(d.budget.budget === d.budget.requested_count && d.budget.source === "default",
    "the two concepts must not be the same number by construction");
});
