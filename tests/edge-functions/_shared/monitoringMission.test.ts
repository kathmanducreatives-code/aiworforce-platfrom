// MONITORING IS ITS OWN INTENT, AND SHARES EVERYTHING ELSE.
//
// ── THE TWO FAILURES THESE PIN ──────────────────────────────────────────────
//
// A MONITORING RUN THAT BEHAVES LIKE SOURCING. Both ask the same engine the
// same question and use the same actors — deliberately, because Signals must
// not grow a second provider stack. Only the TERMINAL differs: a sourcing run
// turns qualified companies into leads, a monitoring run stops at evidence. A
// monitoring plan that reached `persistence` would turn a watchlist into a
// pipeline nobody asked for, and one that reached the people stages would spend
// unlock-gated credits without anybody pressing a button.
//
// SIGNALS AS A LEAD VIEWER. The reuse pre-flight exists so monitoring does not
// re-buy what a Lead mission already proved. Its mirror image is the danger:
// reuse so eager that Signals only ever reports what Leads found. Stale
// evidence must therefore never suppress a fresh look, and evidence with no
// date must never be treated as proof of recency.
//
// PURE. No network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileMonitoringMission, monitoringPlanViolations, monitoringObjectiveGuard,
  missionObjective, isMonitoringMission, LEAD_ONLY_CAPABILITIES,
  DEFAULT_MONITORING_TIMEFRAME_DAYS,
} from "../../../supabase/functions/_shared/monitoringMission.ts";
import {
  buildCapabilityGraph,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  preflight, summarisePreflight, evidenceAnswers,
  type ExistingEvidence,
} from "../../../supabase/functions/_shared/monitoringPreflight.ts";

const ICP = {
  verticals: ["cybersecurity"], business_models: ["b2b saas"], locations: ["Europe"],
};

const compile = (subjects: unknown[], icp: unknown = ICP) =>
  // deno-lint-ignore no-explicit-any
  compileMonitoringMission({ workspace_id: "w", icp, subjects } as any);

// ═══════════════ 1-3. THE TERMINAL IS THE ONLY DIFFERENCE ══════════════════

Deno.test("1. THE GATE: no monitoring plan may contain a lead-only stage", () => {
  // Exercised across every shape a monitoring mission can take, because the
  // stage that leaks would leak in one branch and not the others.
  const shapes: Array<[string, unknown[]]> = [
    ["ICP hiring", [{ kind: "icp", signals: [{ event: "hiring", subject: "company" }] }]],
    ["ICP funding", [{ kind: "icp", signals: [{ event: "funding", subject: "company" }] }]],
    ["competitor launches", [{ kind: "competitor", identifier: "outreach.io", signals: [{ event: "product_launch", subject: "company" }] }]],
    ["tracked company funding", [{ kind: "tracked_company", identifier: "acme.com", signals: [{ event: "funding", subject: "company" }] }]],
    ["ICP technology", [{ kind: "icp", signals: [{ event: "technology", subject: "company" }] }]],
    ["ICP company posts", [{ kind: "icp", signals: [{ event: "post", subject: "company" }] }]],
    ["multi-signal", [{ kind: "icp", signals: [
      { event: "hiring", subject: "company" }, { event: "funding", subject: "company" },
      { event: "expansion", subject: "company" }] }]],
    ["mixed subjects", [
      { kind: "icp", signals: [{ event: "hiring", subject: "company" }] },
      { kind: "competitor", identifier: "outreach.io", signals: [{ event: "product_launch", subject: "company" }] }]],
  ];

  for (const [name, subjects] of shapes) {
    const r = compile(subjects);
    assert(r.ok, `${name} must compile: ${r.reason}`);
    const plan = buildCapabilityGraph(r.mission!);
    assertEquals(monitoringPlanViolations(plan), [], name);
    for (const lead of LEAD_ONLY_CAPABILITIES) {
      assertFalse(plan.steps.some((s) => s.capability === lead),
        `${name} scheduled ${lead}`);
    }
    // …and it still ends somewhere meaningful rather than nowhere.
    assertEquals(plan.steps[plan.steps.length - 1].capability,
      "company_brain_qualification", name);
  }
});

Deno.test("2. a SOURCING mission is completely unchanged", () => {
  // The objective field is optional and defaults to sourcing, so every existing
  // mission keeps its terminal. If this breaks, Phase 3 broke Leads.
  const m = parseLeadMissionDeterministic(
    "Find 10 cybersecurity companies in Europe hiring enterprise sellers.");
  assertEquals(missionObjective(m), "sourcing");
  assertFalse(isMonitoringMission(m));
  const plan = buildCapabilityGraph(m);
  assertEquals(plan.steps[plan.steps.length - 1].capability, "persistence",
    "a sourcing run must still persist");
  assert(monitoringPlanViolations(plan).length > 0,
    "the guard must FIRE on a sourcing plan — otherwise it proves nothing");
});

Deno.test("3. monitoring and sourcing share every stage except the terminal", () => {
  // The whole architectural claim in one assertion: same discovery, same
  // identity, same enrichment, same verification, same qualification.
  const sourcing = buildCapabilityGraph(parseLeadMissionDeterministic(
    "Find cybersecurity companies in Europe hiring enterprise sellers."));
  const monitoring = buildCapabilityGraph(
    compile([{ kind: "icp", signals: [{ event: "hiring", subject: "company" }] }]).mission!);

  const sSteps = sourcing.steps.map((s) => s.capability);
  const mSteps = monitoring.steps.map((s) => s.capability);
  assertEquals(mSteps, sSteps.filter((c) => c !== "persistence"));
});

// ═══════════════ 4-5. SUBJECTS DRIVE THE MISSION ═══════════════════════════

Deno.test("4. a named subject skips discovery entirely", () => {
  // A tracked company IS a supplied company, so it routes to identity
  // resolution — no cohort search, and no discovery spend for a company the
  // workspace already named.
  const r = compile([
    { kind: "competitor", identifier: "outreach.io", label: "Outreach",
      signals: [{ event: "product_launch", subject: "company" }] }]);
  assert(r.ok);
  assertEquals(r.mission!.company_profile.known_companies, ["outreach.io"]);
  const steps = buildCapabilityGraph(r.mission!).steps.map((s) => s.capability);
  assertEquals(steps[0], "known_company_resolution");
  assertFalse(steps.includes("general_company_discovery"));

  // The LABEL is never the identity — two companies share a name.
  assertFalse(JSON.stringify(r.mission!.company_profile.known_companies).includes("Outreach"));
});

Deno.test("5. unusable subjects are refused with a stated reason, never silently", () => {
  // A monitoring run that quietly watches nothing is worse than one that
  // refuses: the workspace believes it is covered.
  const cases: Array<[string, unknown[], unknown, string]> = [
    ["no subjects at all", [], ICP, "no_subjects"],
    ["empty ICP", [{ kind: "icp", signals: [{ event: "hiring" }] }], {}, "no_usable_subjects"],
    ["competitor with only a label", [{ kind: "competitor", label: "Outreach", signals: [{ event: "funding" }] }], ICP, "no_usable_subjects"],
    ["subject watching nothing", [{ kind: "icp", signals: [] }], ICP, "no_usable_subjects"],
    ["unknown kind", [{ kind: "vendor", identifier: "x.com", signals: [{ event: "funding" }] }], ICP, "no_usable_subjects"],
  ];
  for (const [name, subjects, icp, refusal] of cases) {
    const r = compile(subjects, icp);
    assertFalse(r.ok, name);
    assertEquals(r.refusal, refusal, name);
    assertEquals(r.mission, null, name);
    assert(r.reason.length > 0, `${name} must say why`);
  }

  // Watching an EMPTY ICP is refused for a specific reason worth keeping.
  const empty = compile([{ kind: "icp", signals: [{ event: "hiring" }] }], {});
  assert(/watch every company/.test(empty.dropped[0].reason), empty.dropped[0].reason);

  // A PARTIALLY usable set proceeds, and says what it dropped.
  const mixed = compile([
    { kind: "icp", signals: [{ event: "hiring", subject: "company" }] },
    { kind: "competitor", label: "No Identity", signals: [{ event: "funding" }] }]);
  assert(mixed.ok);
  assertEquals(mixed.accepted.length, 1);
  assertEquals(mixed.dropped.length, 1);
});

Deno.test("6. signals dedupe across subjects, and carry the window", () => {
  const r = compile([
    { kind: "competitor", identifier: "a.com", signals: [{ event: "funding", subject: "company" }] },
    { kind: "competitor", identifier: "b.com", signals: [{ event: "funding", subject: "company" }] }]);
  assert(r.ok);
  // Two competitors watched for funding is ONE funding investigation over two
  // identities, not two.
  assertEquals(r.mission!.required_signals.length, 1);
  assertEquals(
    (r.mission!.required_signals[0] as { timeframe_days?: number }).timeframe_days,
    DEFAULT_MONITORING_TIMEFRAME_DAYS);
  // A monitor has no quota: a signal suppressed for exceeding a count is a
  // signal the workspace never learns about.
  assertEquals(r.mission!.requested_count, null);
});

// ═══════════════ 7-11. REUSE ACROSS ORIGINS, WITHOUT BECOMING A VIEWER ═════

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ev = (over: Partial<ExistingEvidence> = {}): ExistingEvidence => ({
  signal_type: "recent_funding",
  occurred_at: "2026-08-24T10:00:00.000Z",
  occurred_at_basis: "source_reported",
  observed_at: "2026-08-24T10:05:00.000Z",
  origin: "lead_mission",
  account_id: "acct-1",
  lifecycle_status: "active",
  ...over,
});

const planned = (over: Record<string, unknown> = {}) => ({
  account_id: "acct-1", event: "funding", subject: "company",
  timeframe_days: 30, ...over,
  // deno-lint-ignore no-explicit-any
}) as any;

Deno.test("7. FRESH LEAD-ORIGIN evidence is reused — Signals does not re-buy it", () => {
  // The scenario from the plan: a Lead mission found Acme's funding an hour
  // ago; monitoring asks the same question and must not pay again.
  const d = preflight(planned(), [ev()], NOW);
  assertEquals(d.verdict, "reuse");
  assert(d.spend_avoided);
  assertEquals(d.reused_from_origin, "lead_mission");
  assert(d.reused_age_days !== null && d.reused_age_days < 1);
  assert(/nothing was purchased again/.test(d.reason));
});

Deno.test("8. STALE evidence does NOT suppress a fresh look", () => {
  // The anti-viewer half. Reuse that ignored age would freeze the feed at
  // whatever was discovered first and call it monitoring.
  const old = ev({ occurred_at: "2026-01-01T00:00:00.000Z" });
  const d = preflight(planned({ timeframe_days: 30 }), [old], NOW);
  assertEquals(d.verdict, "investigate");
  assertFalse(d.spend_avoided);
  assertEquals(d.stale_hits, 1);
  assert(/outside the 30-day window/.test(d.reason));
  assert(/rather than reporting a stale fact as current/.test(d.reason));
});

Deno.test("9. UNDATED evidence can never prove recency", () => {
  // A row with `occurred_at_basis: unknown` shows something happened, not that
  // it happened recently — so it must not suppress a fresh look.
  const undated = ev({ occurred_at: null, occurred_at_basis: "unknown" });
  const d = preflight(planned(), [undated], NOW);
  assertEquals(d.verdict, "investigate");
  assertEquals(d.undated_hits, 1);
  assert(/carry no source date/.test(d.reason));
});

Deno.test("10. reuse never crosses identity or signal boundaries", () => {
  // A competitor's funding must not answer a prospect's, and market chatter
  // must not answer anything about a company.
  assertFalse(evidenceAnswers(ev({ account_id: "acct-OTHER" }), planned()));
  assertFalse(evidenceAnswers(ev({ signal_type: "sales_hiring" }), planned()));
  assertFalse(evidenceAnswers(ev({ signal_type: "market_problem_discussion" }), planned()));
  assertFalse(evidenceAnswers(ev({ lifecycle_status: "superseded" }), planned()));
  assert(evidenceAnswers(ev(), planned()));

  // A subject question is answered by subject evidence, not by account evidence.
  const subjectPlan = planned({ account_id: null, subject_type: "competitor", subject_key: "outreach" });
  assertFalse(evidenceAnswers(ev({ account_id: "acct-1" }), subjectPlan));
  assert(evidenceAnswers(
    ev({ account_id: null, subject_type: "competitor", subject_key: "outreach" }), subjectPlan));

  // A cohort question ("did anyone in my ICP raise?") names no identity and
  // cannot be answered from held evidence: one company raising says nothing
  // about whether another did.
  const cohort = planned({ account_id: null });
  assertFalse(evidenceAnswers(ev(), cohort));
  assertEquals(preflight(cohort, [ev()], NOW).verdict, "investigate");
});

Deno.test("11. the summary reports which origin the saving came from", () => {
  const decisions = [
    preflight(planned(), [ev()], NOW),
    preflight(planned({ account_id: "acct-2" }), [ev({ account_id: "acct-2", origin: "manual_scan" })], NOW),
    preflight(planned({ account_id: "acct-3" }), [], NOW),
  ];
  const s = summarisePreflight(decisions);
  assertEquals(s.planned, 3);
  assertEquals(s.reused, 2);
  assertEquals(s.investigating, 1);
  assertEquals(s.origins, { lead_mission: 1, manual_scan: 1 });
});

Deno.test("12. the objective guard catches a monitoring mission about to persist", () => {
  const r = compile([{ kind: "icp", signals: [{ event: "hiring", subject: "company" }] }]);
  assert(r.ok);
  // A plan hand-built with the lead terminal must be refused, so the rule does
  // not depend on the graph branch alone.
  const tampered = { steps: [{ capability: "persistence" }] };
  const v = monitoringPlanViolations(tampered);
  assertEquals(v.length, 1);
  assert(/lead-only stage/.test(v[0]));
  assertEquals(monitoringObjectiveGuard(r.mission!, buildCapabilityGraph(r.mission!)), []);
});
