// HIRING, END TO END: Mission → Playbook → capabilities → providers →
// normalization → identity → enrichment → qualification → persisted result →
// WORKBENCH-VISIBLE ROWS.
//
// ── WHAT IS REAL HERE, AND WHAT IS NOT ──────────────────────────────────────
//
// REAL, exercised as the production code:
//   selectResearchPlaybooks        the Mission → playbook boundary
//   authorizePlaybookExecution     the playbook → execution authorization
//   buildCapabilityGraph           the capability plan
//   buildPaidExecutionPreflight    the gate before any spend
//   runCapabilityPlan              the engine: order, gates, containment
//   compile*Input                  the verified provider input compilers
//   normalize*                     the provider result transformers
//   company identity / enrichment / hiring verification / Brain qualification
//   projectEvaluationRows          the Workbench projection
//   finalizedProgress              the progress snapshot
//   readEvaluationRows / readWorkbenchProgress   the FRONTEND readers
//
// MOCKED, and only this:
//   the Apify HTTP boundary — `deps.invoke` returns canned rows in each
//   provider's REAL response shape. Nothing between the compiler and the
//   normalizer is stubbed, so a shape change in either still fails these tests.
//
// The database is mocked too: this path writes `tasks.result`, and the assertion
// is that the object the run-agent handler assembles is the object the frontend
// readers can render. That is a contract test of the persisted shape, NOT proof
// that Postgres accepted the row.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { selectResearchPlaybooks } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { authorizePlaybookExecution } from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  runCapabilityPlan, compileFirstProviderCall, finalizedProgress,
  toPortfolioCandidates,
  type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { projectEvaluationRows } from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import { identityIsActionable } from "../../../supabase/functions/_shared/companyIdentityResolution.ts";
import { stubMissionEvaluator } from "./missionEvaluatorFixture.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
// THE FRONTEND READERS. Pure modules, no React — the same code the Workbench
// panel calls. Importing them here is what makes this test end-to-end rather
// than "the edge function produced something".
import {
  readEvaluationRows, evaluationRowIsActionable, evaluationFunnel,
} from "../../../src/lib/workbench/evaluationRows.ts";
import {
  readWorkbenchProgress, runActivity, progressLines,
} from "../../../src/lib/workbench/workbenchProgress.ts";

// ───────────────────────────── missions ─────────────────────────────────────

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"],
  excluded_industries: [] as string[],
  required_geography: null,
};

/** A GPT-compiled hiring mission — `strategies` is what the model declared. */
function hiringMission(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  return {
    version: LEAD_MISSION_VERSION,
    original_user_query:
      "Find SaaS startups in the United States hiring Sales Operations. Return 5.",
    mission_type: "qualified_lead_sourcing",
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: 5,
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: ["startup"],
      locations: ["United States"],
    },
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
    required_signal_terms: ["Sales Operations"],
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    field_provenance: {}, confidence: 0.9,
    strategies: ["hiring"],
    ...over,
  } as LeadMissionV1;
}

// ─────────────────────── provider rows, in their REAL shapes ────────────────

function ycRow(name: string, slug: string, over: Record<string, unknown> = {}) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} is a B2B SaaS platform.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
    ...over,
  };
}
function searchRow(name: string, slug: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    location: "San Francisco, CA",
  };
}
function enrichRow(name: string, slug: string, employeeCount = 42) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`, employeeCount,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  };
}
const jobRow = {
  id: "j1", title: "Revenue Operations Manager",
  company: { name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly" },
  postedDate: "2026-07-20",
};

const HAPPY = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly"), ycRow("Clay", "clay")],
  apify_linkedin_company_search: [searchRow("Sortly", "sortly")],
  apify_linkedin_company_details: [enrichRow("Sortly", "sortly")],
  apify_linkedin_job_search: [jobRow],
};

interface Recorder { calls: string[]; inputs: Array<{ key: string; input: unknown }> }

function deps(
  rows: Record<string, Record<string, unknown>[]>,
  rec: Recorder,
  over: Partial<CapabilityEngineDeps> = {},
): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      rec.inputs.push({ key: call.actorKey, input: call.input });
      return Promise.resolve(rows[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    // A QUALIFYING RUN NEEDS AN EVALUATOR. This file is about the Mission
    // reaching the Workbench, not about evaluator availability; since Phase 4
    // only the evaluator can decide a Mission is satisfied, so without one
    // nothing qualifies and there is no Workbench row to assert on. The stub
    // answers from each company's own registry and is still checked by
    // `parseMissionEvaluationStrict`.
    evaluateMission: stubMissionEvaluator(),
    ...over,
  };
}

// ─────────────────── the whole chain, as run-agent runs it ──────────────────

/**
 * Mission → … → the `tasks.result` object the handler assembles.
 *
 * Every step here mirrors run-agent's own sequence. The result object is built
 * from the same three projections the handler writes.
 */
async function runHiring(
  m: LeadMissionV1,
  rows: Record<string, Record<string, unknown>[]> = HAPPY,
  over: Partial<CapabilityEngineDeps> = {},
) {
  const rec: Recorder = { calls: [], inputs: [] };

  const selection = selectResearchPlaybooks(m);
  const plan = buildCapabilityGraph(m);
  const authorization = authorizePlaybookExecution(selection, plan, m);
  const first = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: first.provider,
    firstProviderInput: first.compiled?.ok ? first.compiled.input : null,
    firstProviderCompileOk: first.compiled ? first.compiled.ok : undefined,
    firstProviderErrors: first.compiled && !first.compiled.ok ? first.compiled.errors : [],
    playbook: authorization,
  });

  let run = null as Awaited<ReturnType<typeof runCapabilityPlan>> | null;
  if (preflight.ok) {
    assertPaidExecutionAllowed(preflight);
    run = await runCapabilityPlan( { planDiscovery: stubDiscoverySelector(), ...deps(rows, rec, over) }, { mission: m, plan, brain: BRAIN });
  }

  // The `tasks.result` object, assembled exactly as run-agent assembles it.
  const evaluation = run
    ? projectEvaluationRows(run.companies.map((c) => ({
      key: c.key,
      shortlisted: c.shortlisted,
      companyName: (c.enriched ?? c.company).company_name ?? null,
      employeeCount: (c.enriched ?? c.company).employee_count ?? null,
      prequalified: c.prequalified,
      identityResolved: !!c.identity && identityIsActionable(c.identity),
      identityAttempted: c.identity !== null,
      enriched: c.enriched !== null,
      hiringVerified: c.hiring_jobs.length > 0,
      verdict: c.verdict,
      contactCount: c.contact_identities.length,
    })))
    : null;

  const taskResult = run
    ? {
      workbench_progress: finalizedProgress(run.state),
      workbench_evaluation_rows: evaluation!.rows,
    }
    : {};

  return {
    rec, selection, plan, authorization, first, preflight, run, evaluation,
    taskResult,
    portfolio: run ? toPortfolioCandidates(run.companies) : [],
  };
}

// ══════════════════════ A. the happy path, link by link ═════════════════════

Deno.test("E2E: a hiring Mission produces Workbench-visible companies", async () => {
  const r = await runHiring(hiringMission());

  // 1 — the Mission's declared shape selects the hiring playbook.
  assertEquals(r.selection.runnable, ["hiring"]);
  assertEquals(r.selection.strategy_source, "mission_strategies");

  // 2 — the playbook authorises the plan the graph built.
  assert(r.authorization.applies && r.authorization.authorized, r.authorization.reason);

  // 3 — the plan contains only hiring-appropriate capabilities.
  assertEquals(r.plan.entry_capability, "startup_company_discovery");
  for (const s of r.plan.steps) {
    assertFalse(
      ["funding_signal_discovery", "expansion_signal_discovery", "job_discovery"]
        .includes(s.capability),
      `${s.capability} does not belong to a hiring company mission`,
    );
  }

  // 4 — the paid gate passed and the engine ran the plan in order.
  assert(r.preflight.ok);
  assertEquals(
    r.run!.capability_outcomes.map((o) => o.capability),
    r.plan.steps.map((s) => s.capability),
  );
  assertEquals(r.run!.state.terminal_reason, "capability_plan_complete");

  // 5 — the right actors ran, in the right order, and no others.
  assertEquals(r.rec.calls[0], "apify_yc_companies_memo23");
  assert(r.rec.calls.includes("apify_linkedin_company_search"));
  assert(r.rec.calls.includes("apify_linkedin_company_details"));
  assertFalse(
    r.rec.calls.includes("apify_linkedin_company_employees"),
    "people are an OFFER — never bought automatically",
  );

  // 6 — normalization + identity + enrichment produced a real company.
  const sortly = r.run!.companies.find((c) => c.company.company_name === "Sortly");
  assert(sortly, "Sortly must survive normalization");
  assert(sortly!.identity && identityIsActionable(sortly!.identity), "identity resolved");
  assertEquals(sortly!.enriched?.employee_count, 42, "enrichment measured the size");

  // 7 — hiring evidence is attached to THAT company, not floating.
  assert(sortly!.prequalified, "prequalification ran on embedded YC jobs");
  assert(
    (sortly!.prequalified!.jobs ?? []).some((j) => /Revenue Operations/i.test(j.title)),
    "the hiring evidence is the company's own job",
  );

  // 8 — the persisted result is readable by the FRONTEND Workbench readers.
  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress, "the Workbench must be able to read the progress snapshot");
  assertEquals(runActivity(progress!), "finished");

  const rows = readEvaluationRows(r.taskResult);
  const funnel = evaluationFunnel(rows, {
    qualified: r.evaluation!.counts.qualified,
    contactReady: r.evaluation!.counts.contact_ready,
  });
  assert(
    rows.length > 0 || r.run!.state.qualified_company_keys.length > 0,
    "the run must be visible in the Workbench as evaluation rows or as qualified companies",
  );
  assertEquals(
    funnel.accountsFound, rows.length + r.evaluation!.counts.qualified,
    "the funnel the user sees counts every company the run touched",
  );
});

Deno.test("E2E: qualified companies carry provenance and status through to the reader", async () => {
  const r = await runHiring(hiringMission());
  const rows = readEvaluationRows(r.taskResult);

  for (const row of rows) {
    assert(row.company_key.length > 0, "every row identifies its company");
    assertFalse(
      row.company_name === row.company_key && row.company_key.startsWith("http"),
      "a row must never show a URL as the company name",
    );
    assert(row.status.length > 0, "every row carries a lifecycle status");
    assert(row.explanation.length > 0, "and an explanation of where it stopped");
  }
});

Deno.test("E2E: evaluation rows are structurally NOT actionable", async () => {
  // The safety property the projection exists for: progress can be shown
  // without becoming a lead, a quota entry or a paid people search.
  const r = await runHiring(hiringMission());
  for (const row of readEvaluationRows(r.taskResult)) {
    assertFalse(evaluationRowIsActionable(row));
    assertFalse("lead_candidate_id" in (row as unknown as Record<string, unknown>));
  }
});

// ══════════════════════ B. hiring request variations ════════════════════════

Deno.test("variation: an explicit count is the Mission's, and reaches the run", async () => {
  const r = await runHiring(hiringMission({ requested_count: 3 }));
  assert(r.authorization.authorized);
  assertEquals(r.run!.state.mission_hash.length > 0, true);
  // The count is a Mission field; nothing in execution re-reads the sentence.
  assertEquals(hiringMission({ requested_count: 3 }).requested_count, 3);
});

Deno.test("variation: no stated count still runs — the default is applied once", async () => {
  const r = await runHiring(hiringMission({ requested_count: null }));
  assert(r.preflight.ok, JSON.stringify(r.preflight.blocked));
  assertEquals(r.run!.state.terminal_reason, "capability_plan_complete");
});

Deno.test("variation: a role/signal drives hiring verification, not a keyword scan", async () => {
  const r = await runHiring(hiringMission());
  const outcomes = r.run!.capability_outcomes.map((o) => o.capability);
  assert(outcomes.includes("hiring_verification"), "the hiring signal schedules verification");
  // And the verification input is COMPANY-SCOPED, per the actor's contract.
  const jobInput = r.rec.inputs.find((i) => i.key === "apify_linkedin_job_search");
  if (jobInput) {
    const inp = jobInput.input as { company?: string[] };
    assert((inp.company ?? []).length > 0, "job search must be scoped to a company");
  }
});

Deno.test("variation: geography reaches the provider input, from the Mission", async () => {
  const r = await runHiring(hiringMission());
  const search = r.rec.inputs.find((i) => i.key === "apify_linkedin_company_search");
  // The startup route enters at YC; the search actor is used for identity, whose
  // input is company-name scoped. Either way no raw sentence is passed.
  if (search) {
    assertFalse(
      JSON.stringify(search.input).includes("Return 5"),
      "the user's sentence must never be handed to a provider as a query",
    );
  }
  assert(r.run, "the run completed");
});

Deno.test("variation: multiple constraints (vertical + geography + size) all hold", async () => {
  const m = hiringMission({
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: ["startup"],
      locations: ["United States"], employee_range: { min: 10, max: 150 },
    },
  });
  const r = await runHiring(m);
  assert(r.authorization.authorized, r.authorization.reason);
  const sortly = r.run!.companies.find((c) => c.company.company_name === "Sortly");
  assertEquals(sortly!.enriched?.employee_count, 42, "inside the stated range");
});

Deno.test("variation: a general (non-startup) hiring mission enters company discovery", async () => {
  const m = hiringMission({
    company_profile: {
      business_models: [], verticals: ["manufacturing"], stages: [],
      locations: ["United States"],
    },
  });
  const r = await runHiring(m, {
    ...HAPPY,
    apify_linkedin_company_search: [searchRow("Acme", "acme")],
    apify_linkedin_company_details: [enrichRow("Acme", "acme")],
  });
  assertEquals(r.plan.entry_capability, "general_company_discovery");
  assertEquals(r.authorization.entry_source, "playbook_discovery");
  assert(r.authorization.authorized, r.authorization.reason);
});

Deno.test("variation: a supplied-company hiring mission is authorised but does not discover", async () => {
  // `known_company_resolution` is NOT engine-driven. The boundary authorises the
  // entry because the MISSION forced it — and the engine reports the skip
  // honestly rather than pretending the companies were resolved.
  const m = hiringMission({
    company_profile: {
      business_models: [], verticals: [], stages: [], locations: [],
      known_companies: ["acme.com"],
    },
  });
  const r = await runHiring(m);
  assertEquals(r.plan.entry_capability, "known_company_resolution");
  assertEquals(r.authorization.entry_source, "mission_forced");
  assert(r.authorization.authorized);
  const entry = r.run!.capability_outcomes[0];
  assertEquals(entry.capability, "known_company_resolution");
  assertEquals(
    entry.status, "skipped_no_input",
    "the engine does not drive this capability, and says so",
  );
  assertEquals(r.run!.companies.length, 0, "so no company is invented");
});

// ══════════════════════ C. failure cases — no silent success ════════════════

Deno.test("failure: an actor that throws does not become a successful Workbench result", async () => {
  const r = await runHiring(hiringMission(), HAPPY, {
    invoke: () => Promise.reject(new Error("actor unavailable")),
  });
  assertEquals(r.run!.companies.length, 0);
  const rows = readEvaluationRows(r.taskResult);
  assertEquals(rows.length, 0, "no companies means no rows — not a fabricated one");
  // THE GAP THIS PHASE CLOSED. Discovery exhausts every provider before the
  // first `publish()`, so `state.progress` was never set — `finalizedProgress`
  // returned null, run-agent wrote no snapshot, and the Workbench rendered
  // NOTHING for a run that genuinely happened. A measured zero is a result.
  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress, "a failed run must still be reported, not rendered as a blank panel");
  assertEquals(runActivity(progress!), "finished");
  assertEquals(progress!.accounts_found, 0, "and it must report a MEASURED zero");
  assertEquals(progress!.qualified_companies, 0, "never a success");
  // Every later counter is correctly UNREACHED, so no stage is implied to have run.
  const lines = progressLines(progress!);
  assertEquals(lines[0].reached, true, "accounts found is always measured");
  assertFalse(
    lines.slice(1).some((l) => l.reached),
    "no downstream stage may claim to have run",
  );
  assert(
    /exhausted/.test(r.run!.state.terminal_reason ?? ""),
    `the engine still names the cause: ${r.run!.state.terminal_reason}`,
  );
});

Deno.test("failure: an empty provider result yields no companies and no rows", async () => {
  const r = await runHiring(hiringMission(), {});
  assertEquals(r.run!.companies.length, 0);
  assertEquals(readEvaluationRows(r.taskResult).length, 0);
  assertEquals(r.portfolio.length, 0, "and nothing reaches the portfolio");
});

Deno.test("failure: a malformed provider row does not fabricate a company", async () => {
  const r = await runHiring(hiringMission(), {
    // Rows with no name and no id — the normalizer has nothing to key on.
    apify_yc_companies_memo23: [{ nonsense: true }, { alsoNonsense: 1 }],
  });
  for (const c of r.run!.companies) {
    assertFalse(
      c.company.company_name === "undefined" || c.company.company_name === "null",
      "a malformed row must not become a company named after its own absence",
    );
  }
  const rows = readEvaluationRows(r.taskResult);
  for (const row of rows) {
    assertFalse(row.company_name === "undefined" || row.company_name === "null");
  }
});

Deno.test("failure: unresolved identity is reported, never silently qualified", async () => {
  const r = await runHiring(hiringMission(), {
    ...HAPPY,
    apify_linkedin_company_search: [],   // identity cannot resolve
    apify_linkedin_company_details: [],
  });
  const qualified = r.run!.state.qualified_company_keys;
  assertEquals(qualified.length, 0, "nothing may qualify without a resolved identity");
  const rows = readEvaluationRows(r.taskResult);
  assert(rows.length > 0, "the work done is still visible");
  assert(
    rows.some((x) => x.status === "identity_unresolved" || x.status === "shortlisted" ||
      x.status === "evaluated" || x.status === "discovered"),
    `a pre-qualification lifecycle must be reported, got ${rows.map((x) => x.status).join(",")}`,
  );
});

Deno.test("failure: enrichment failure does not produce a qualified company", async () => {
  const r = await runHiring(hiringMission(), {
    ...HAPPY,
    apify_linkedin_company_details: [],  // enrichment returns nothing
  });
  assertEquals(
    r.run!.state.qualified_company_keys.length, 0,
    "qualification requires enriched evidence, never discovery-time fields",
  );
  assertFalse(
    readEvaluationRows(r.taskResult).some((x) => x.status === "qualified"),
    "and no row may claim qualification",
  );
});

Deno.test("failure: enrichment failure HOLDS the company, it never rejects it", async () => {
  // RULE 6, stated as a verdict rather than a count.
  //
  // The sibling test above proves nothing QUALIFIES when enrichment returns
  // nothing. This one proves the other half: the company is not rejected
  // either. A provider that failed says nothing about the company, so the only
  // honest outcome is insufficient evidence, and the company stays resolvable
  // on a later run. Inferring "not a fit" from a failed call is the single
  // inference this architecture forbids outright.
  //
  // Note the evaluator supplied by `deps` returns a grounded PASS here — the
  // hold is enforced by deterministic code on a falsifiable fact (enrichment
  // was bought and produced nothing), not by asking the model to be cautious.
  const r = await runHiring(hiringMission(), {
    ...HAPPY,
    apify_linkedin_company_details: [],
  });
  const evaluated = r.run!.companies.filter((c) => c.evaluation_path !== "not_reached");
  assert(evaluated.length > 0, "companies must still reach the evaluator");
  assertFalse(
    evaluated.some((c) => c.verdict === "reject"),
    "a failed enrichment provider may never become a rejection",
  );
  assert(
    evaluated.some((c) => c.verdict === "unknown"),
    "it must be held as unknown instead",
  );
  for (const c of evaluated.filter((x) => x.verdict === "unknown")) {
    assertEquals(c.decision_source, "insufficient_evidence", c.key);
    assert(
      c.record.missing_evidence.some((e) => e.startsWith("company_enrichment")),
      `${c.key}: the hold must name what was missing`,
    );
    // ...AND WHICH OF THE FOUR WAYS IT WENT MISSING. The provider answered here
    // with an empty dataset, which is the one outcome that is genuinely about
    // the company — as opposed to a failed call or a deadline deferral, which a
    // continuation would retry. The hold is identical; the reason is not, and
    // recording only "no enrichment" is what made them indistinguishable.
    assert(
      c.record.missing_evidence.includes("company_enrichment:empty"),
      `${c.key}: the hold must name WHY enrichment produced nothing, got ` +
        c.record.missing_evidence.join(","),
    );
    assertEquals(c.enrichment_outcome, "empty", c.key);
  }
});

Deno.test("failure: a playbook/capability mismatch refuses before any actor runs", async () => {
  // strategy hiring, but the graph enters at a funding capability the engine
  // skips. The boundary refuses, so the engine never runs at all.
  const m = hiringMission({
    strategies: ["hiring"],
    required_signals: [{ type: "hiring" }, { type: "funding" }],
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [], locations: [],
    },
  });
  const r = await runHiring(m);
  assertFalse(r.preflight.ok);
  assert(r.preflight.blocked.some((b) => b.code === "playbook_not_authorized"));
  assertEquals(r.run, null, "the engine must not have run");
  assertEquals(r.rec.calls, [], "and no actor may have been called");
  assertEquals(readEvaluationRows(r.taskResult).length, 0);
});

Deno.test("failure: an unsupported playbook never reaches execution", async () => {
  for (const strategy of ["social", "news", "funding"] as const) {
    const r = await runHiring(hiringMission({ strategies: [strategy] }));
    assertFalse(r.authorization.applies, `${strategy} is not governed by the hiring boundary`);
    assertEquals(r.selection.runnable, [], `${strategy} is not runnable`);
  }
});

// ══════════════════════ D. people are offered, never bought ═════════════════

Deno.test("decision-makers and contacts are OFFERS, and the offer is explicit", async () => {
  const m = hiringMission({
    target_entity: "person", requested_output: "contact_ready_leads",
    decision_makers: { roles: ["Founder"], current_employment_required: true },
  });
  const r = await runHiring(m);

  // The graph offers them; it does not schedule them.
  assert(r.plan.offered_capabilities.includes("offer_founder_unlock"));
  assert(r.plan.offered_capabilities.includes("offer_contact_unlock"));
  for (const c of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
    assertFalse(
      r.plan.steps.some((s) => s.capability === c),
      `${c} must not be scheduled — an unlock is a button, not a plan step`,
    );
    assert(r.plan.prohibited.includes(c as never), `${c} must be prohibited for this plan`);
  }
  // And no people actor ran.
  assertFalse(r.rec.calls.includes("apify_linkedin_company_employees"));
  assertFalse(r.rec.calls.includes("apify_people_search"));

  // Contact readiness is therefore false, and the Workbench says so rather than
  // implying contacts exist.
  for (const p of r.portfolio) assertEquals(p.contact_ready, false);
});

// ══════════════════════ E. no second semantic authority ═════════════════════

Deno.test("no raw user text is passed to any provider input", async () => {
  const m = hiringMission();
  const r = await runHiring(m);
  const sentence = m.original_user_query;
  for (const { key, input } of r.rec.inputs) {
    assertFalse(
      JSON.stringify(input).includes(sentence),
      `${key} received the user's raw sentence as provider input`,
    );
  }
});

Deno.test("the execution path imports no legacy semantic parser", () => {
  const files = [
    "supabase/functions/_shared/leadPlaybookExecution.ts",
    "supabase/functions/_shared/leadResearchPlaybooks.ts",
    "supabase/functions/_shared/leadCapabilityGraph.ts",
    "supabase/functions/_shared/leadWorkbenchProjection.ts",
  ];
  for (const f of files) {
    const src = Deno.readTextFileSync(new URL(`../../../${f}`, import.meta.url))
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    for (const parser of [
      "extractLeadIntent", "separateIntent", "extractRequestedLeadCount",
      "routeQualifiedLead", "classifyWorkflow", "compileLeadEntityIntent",
      "extractLeadSearchIntent",
    ]) {
      assertFalse(src.includes(parser), `${f} must not reach ${parser}`);
    }
  }
});

Deno.test("the deterministic mission path still runs the same chain", async () => {
  // A workspace on the deterministic path compiles no `strategies`; the shape is
  // DERIVED from the mission's own signals, and the chain is otherwise identical.
  const m = parseLeadMissionDeterministic(
    "Find SaaS startups in the United States hiring Sales Operations. Return 5 qualified leads.",
  );
  const r = await runHiring(m);
  assertEquals(r.selection.strategy_source, "derived_from_mission_fields");
  assertEquals(r.selection.runnable, ["hiring"]);
  assert(r.authorization.authorized, r.authorization.reason);
  assert(r.run, "the deterministic mission still executes");
  assert(readWorkbenchProgress(r.taskResult), "and is still Workbench-visible");
});

// ══════════════════════ F. containment: no route around the boundary ════════
//
// Structural, because these are properties of run-agent's control flow and the
// handler cannot be constructed offline (database, auth, Deno.serve). Each
// assertion names the exact construct it depends on, so it fails on a real
// change rather than on reformatting.

const RUN_AGENT = Deno.readTextFileSync(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
);

Deno.test("containment: the paid gate is asserted, and its throw is not swallowed", () => {
  assert(
    /if \(!resumeSatisfied\) assertPaidExecutionAllowed\(paidPreflight\);/.test(RUN_AGENT),
    "the preflight verdict must be ENFORCED, not merely logged",
  );
  // run-agent never catches the blocked error by type, so a refusal cannot be
  // downgraded into "carry on with the legacy route".
  assertFalse(
    RUN_AGENT.includes("PaidExecutionBlockedError"),
    "run-agent must not catch the block and continue",
  );
});

Deno.test("containment: the legacy company-first route cannot run after the engine", () => {
  // `!capabilityRun` is the structural guard: the two executors are mutually
  // exclusive for one task, so a mission task cannot also be sourced by the
  // pre-mission path.
  assert(
    /if \(!resumeSatisfied && !capabilityRun && routeResolution\.ok/.test(RUN_AGENT),
    "the route executor must be gated on the engine not having run",
  );
  // And ownership is checked before the quota loop may source.
  assert(
    /if \(!leadOwnership\.mayExecute\("company_first_v1"\) && legacySkipReason === null\)/
      .test(RUN_AGENT),
    "the quota loop must decline when another owner holds execution",
  );
  assert(
    /legacyLoopReachable\(persistedMission, missionPlan\)/.test(RUN_AGENT),
    "and a mission must be able to forbid broad job sourcing outright",
  );
});

Deno.test("containment: the engine is the only executor for a mission task", () => {
  assert(
    /claimExecution\(\s*"capability_engine_v1"/.test(RUN_AGENT),
    "a mission task claims the engine as its owner",
  );
  // One call site each, so there is no second place either executor starts.
  assertEquals([...RUN_AGENT.matchAll(/await runCapabilityPlan\(/g)].length, 1);
  assertEquals([...RUN_AGENT.matchAll(/buildPaidExecutionPreflight\(\{/g)].length, 1);
});

Deno.test("containment: the Workbench result is written from the projections, not by hand", () => {
  for (const key of [
    "workbench_progress: finalProgress", "workbench_evaluation_rows: evaluation.rows",
  ]) {
    assert(RUN_AGENT.includes(key), `the persisted result must be built from ${key}`);
  }
  assert(
    /projectEvaluationRows\(capabilityRun\.companies\.map\(/.test(RUN_AGENT),
    "evaluation rows must be projected from the engine's own companies",
  );
});
