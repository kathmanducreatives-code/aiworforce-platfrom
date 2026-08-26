// THE CARD MAY NOT PROMISE WHAT NO GRAPH BACKS.
//
// `generateWorkflowConfirmation` had two branches. One compiled a mission,
// built a graph and ran a preflight. The other asked a helper model to pick a
// "workflow" from a seven-item menu written into its own prompt — every option
// carrying a hardcoded `Estimated Credits: 5` — and on model failure returned
// `find_hiring_signal_accounts`, a Lead workflow, whatever had been asked.
//
// Nothing behind that branch compiled anything, so the card stated a plan and a
// price that no executable object could be checked against. This file pins that
// it is gone and cannot come back by editing a prompt string.
//
// Pure. Reads source; no network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  buildPaidExecutionPreflight,
  preflightDryRun,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";

const PILOT = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
);

// ── the fabricated card is gone ────────────────────────────────────────────

Deno.test("no hardcoded credit price survives in the confirmation path", () => {
  assertEquals(
    /Estimated Credits:\s*\d/.test(PILOT), false,
    "a priced menu option in a prompt is a price no plan computed",
  );
});

Deno.test("the workflow menu prompt is gone", () => {
  for (const id of [
    '"find_hiring_signal_accounts"',
    '"linkedin_post_from_signals"',
    '"competitor_snapshot"',
    '"website_audit"',
  ]) {
    assertEquals(
      PILOT.includes(`ID: ${id}`), false,
      `${id} was a menu option a model chose between; it must not return`,
    );
  }
});

Deno.test("a non-Lead request cannot fall back to a Lead workflow", () => {
  // The old failure mode: the model call throws, and every category — content
  // included — got `find_hiring_signal_accounts`.
  assertEquals(
    PILOT.includes("workflow_id: \"find_hiring_signal_accounts\""), false,
    "no category may default into a Lead workflow",
  );
});

Deno.test("only categories with a real graph produce a priced card", () => {
  // `LEAD_CONFIRMATION_CATEGORIES` is the set that compiles a mission. Anything
  // outside it must be flagged `planned_workflow: false` with no estimate.
  assert(PILOT.includes("planned_workflow: false"),
    "the unplanned branch must say so explicitly");
  assert(PILOT.includes("estimated_credits: null"),
    "an unplanned request may not carry a credit estimate");
});

// ── the priced card is derived from the gating record ──────────────────────

Deno.test("the dry run carries what the run proves, not just what it runs", () => {
  const m = parseLeadMissionDeterministic(
    "Find companies matching my ICP that are actively hiring sales roles.", {});
  const plan = buildCapabilityGraph(m);
  const dry = preflightDryRun(buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: plan.steps[0].providers[0] ?? null,
    firstProviderInput: {}, firstProviderCompileOk: true, firstProviderErrors: [],
  }));

  // The capability list alone said nothing about proof — that is exactly how a
  // four-step card for this sentence proved no hiring.
  assert(dry.capability_order.includes("hiring_verification"));
  assert(
    dry.proves.some((p) => p.by_capability === "hiring_verification"),
    `the card must name what establishes hiring: ${JSON.stringify(dry.proves)}`,
  );
  assertEquals(dry.will_not_establish, []);
});

Deno.test("a gap the run cannot close is disclosed on the card", () => {
  const base = parseLeadMissionDeterministic("Find companies hiring sales roles.", {});
  const m = {
    ...base,
    required_signals: [...base.required_signals, { type: "headcount_change" } as never],
  };
  const plan = buildCapabilityGraph(m);
  const dry = preflightDryRun(buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: plan.steps[0].providers[0] ?? null,
    firstProviderInput: {}, firstProviderCompileOk: true, firstProviderErrors: [],
  }));
  assert(
    dry.will_not_establish.some((g) => g.requirement === "headcount_change"),
    `the card must disclose the gap before payment: ${JSON.stringify(dry.will_not_establish)}`,
  );
});

Deno.test("an unlock-staged output is shown as staged, not promised", () => {
  const m = parseLeadMissionDeterministic(
    "Find decision makers at companies matching my ICP.", {});
  const plan = buildCapabilityGraph(m);
  const dry = preflightDryRun(buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: plan.steps[0].providers[0] ?? null,
    firstProviderInput: {}, firstProviderCompileOk: true, firstProviderErrors: [],
  }));
  // NB: `dry.ok` is false here for an unrelated pre-existing reason — a bare
  // deterministic mission carries no qualification contract. What matters is
  // that FEASIBILITY did not refuse it: the person boundary is staged, not broken.
  assertEquals(
    dry.blocked_reasons.filter((r) => r.startsWith("request_not_feasible")), [],
    "the person boundary must not be a feasibility refusal");
  assert(
    dry.requires_unlock.some((u) => u.requirement.includes("contact_ready_leads")),
    `the card must say contacts need an unlock: ${JSON.stringify(dry.requires_unlock)}`,
  );
});

Deno.test("a refused request says so on the card, before credits", () => {
  const m = parseLeadMissionDeterministic("Find companies with headcount growth.", {});
  const plan = buildCapabilityGraph(m);
  const dry = preflightDryRun(buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: plan.steps[0].providers[0] ?? null,
    firstProviderInput: {}, firstProviderCompileOk: true, firstProviderErrors: [],
  }));
  assertEquals(dry.ok, false);
  assert(dry.blocked_reasons.some((r) => r.startsWith("request_not_feasible")),
    `expected a feasibility refusal: ${JSON.stringify(dry.blocked_reasons)}`);
});

// ── the card may not name an Actor execution will refuse ───────────────────
//
// Task eeb02852, from the real app: "Find 3 companies matching my ICP that are
// actively hiring sales roles". `stages: []`, no mention of YC. The card said
//
//     First paid Actor: apify_yc_companies_memo23
//
// because `general_company_discovery` listed both YC Actors ahead of the
// unrestricted one. At execution `leadExecutionPlan` blocked every YC step as
// `actor_outside_mission_cohort` until none survived, and the run failed with
// `no_valid_step` — 0 units, 0 provider attempts, so the spend boundary held,
// but the preview had promised a run execution would not accept.

import { cohortRefusalFor } from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";
import { hiringActorCard } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

Deno.test("no scheduled provider is one the mission's cohort forbids", () => {
  for (const q of [
    "Find 3 companies matching my ICP that are actively hiring sales roles.",
    "Find companies expanding into Europe and hiring salespeople.",
    "Find SaaS companies that raised funding in the last 90 days.",
  ]) {
    const m = parseLeadMissionDeterministic(q, {});
    const plan = buildCapabilityGraph(m);
    for (const step of plan.steps) {
      for (const key of step.providers) {
        const card = hiringActorCard(String(key));
        if (!card) continue;
        assertEquals(
          cohortRefusalFor(card, m), null,
          `${key} is scheduled for ${step.capability} but execution refuses it ` +
            `as outside this mission's cohort — the card would promise it anyway`,
        );
      }
    }
  }
});

Deno.test("a YC mission still keeps its YC actors", () => {
  // The filter is a correctness constraint, not a preference. It must not
  // strip the cohort actors from a mission that actually targets the cohort.
  const m = parseLeadMissionDeterministic("Find YC startups hiring sales roles.", {});
  const plan = buildCapabilityGraph(m);
  const all = plan.steps.flatMap((s) => s.providers.map(String));
  assert(
    all.some((k) => k.startsWith("apify_yc_companies")),
    `a YC mission must retain YC discovery: ${JSON.stringify(all)}`,
  );
});

Deno.test("allowed_providers cannot drift from the scheduled steps", () => {
  const m = parseLeadMissionDeterministic(
    "Find 3 companies matching my ICP that are actively hiring sales roles.", {});
  const plan = buildCapabilityGraph(m);
  const scheduled = new Set(plan.steps.flatMap((s) => s.providers.map(String)));
  for (const p of plan.allowed_providers) {
    assert(scheduled.has(String(p)),
      `${p} is allowed but no scheduled step uses it`);
  }
});

// ── THE MODEL MUST BE TOLD THE SAME TRUTH THE VALIDATOR ENFORCES ──────────
//
// Runs 25b351dc and ba336520 failed as `no_valid_step` with a clean preflight
// and — once `blocked_by` was persisted — a LONE violation, no per-step
// refusals. That shape means the planner proposed NOTHING.
//
// The payload was why. It listed actors from CAPABILITY_REGISTRY rather than
// the plan's admitted set, so both YC sources were offered for a mission the
// cohort rule forbids them on; and it passed `not_for: "semantic/concept
// search"` verbatim with no mention that the same Actor takes structured
// filters. Given a concept ICP and an Actor that says it cannot do concept
// search, proposing nothing is the correct reading of what it was told.

import { buildExecutionPlannerPayload } from "../../../supabase/functions/_shared/leadExecutionPlan.ts";

Deno.test("the planner is offered only actors the plan admitted", () => {
  const m = parseLeadMissionDeterministic(
    "Find 3 companies matching my ICP that are actively hiring sales roles.", {});
  const withIcp = {
    ...m,
    company_profile: {
      ...m.company_profile,
      verticals: ["Recruiting / Talent Acquisition / Staffing Agencies"],
    },
  } as typeof m;
  const graph = buildCapabilityGraph(withIcp);
  const payload = buildExecutionPlannerPayload(withIcp, graph) as Record<string, unknown>;

  const caps = payload.authorised_capabilities as Array<
    { capability: string; actors: Array<{ actor_key: string }> }
  >;
  for (const cap of caps) {
    const step = graph.steps.find((s) => s.capability === cap.capability)!;
    assertEquals(
      cap.actors.map((a) => a.actor_key), step.providers.map(String),
      `${cap.capability}: the payload must offer exactly what the plan admitted`,
    );
  }
  // The concrete regression: no YC actor for a non-YC mission.
  const discovery = caps.find((c) => c.capability === "general_company_discovery")!;
  assertEquals(
    discovery.actors.some((a) => a.actor_key.startsWith("apify_yc_companies")), false,
    "a cohort-refused actor must not be offered to the planner",
  );
});

Deno.test("the planner is told HOW to discover a concept population", () => {
  const m = parseLeadMissionDeterministic("Find recruiting agencies matching my ICP.", {});
  const withIcp = {
    ...m,
    company_profile: {
      ...m.company_profile,
      verticals: ["Recruiting / Talent Acquisition / Staffing Agencies"],
    },
  } as typeof m;
  const payload = buildExecutionPlannerPayload(
    withIcp, buildCapabilityGraph(withIcp)) as Record<string, unknown>;

  const dc = payload.discovery_constraints as Record<string, unknown> | undefined;
  assert(dc, "an expressible ICP must reach the planner as filters");
  assert(
    (dc!.industryIds as string[]).includes("104"),
    `the derived filters must be supplied: ${JSON.stringify(dc)}`,
  );

  // And the actor must say the structured path exists, or `not_for` reads as
  // a flat refusal.
  const caps = payload.authorised_capabilities as Array<
    { capability: string; actors: Array<Record<string, unknown>> }
  >;
  const search = caps.flatMap((c) => c.actors)
    .find((a) => a.actor_key === "apify_linkedin_company_search");
  assert(search, "the search actor is in the plan");
  assert(
    String(search!.concept_discovery ?? "").includes("industryIds"),
    `the actor must state the structured path: ${JSON.stringify(search)}`,
  );
  // The name-index warning must survive — it is still true of searchQuery.
  assert(
    (search!.not_for as string[]).some((n) => /semantic|concept/i.test(n)),
    "the searchQuery limitation is still declared",
  );
});
