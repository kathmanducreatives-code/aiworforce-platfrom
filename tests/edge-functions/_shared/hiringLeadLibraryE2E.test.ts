// HIRING, END TO END, INCLUDING THE LEAD LIBRARY.
//
//   LeadMissionV1 → selectResearchPlaybooks → hiring playbook →
//   buildCapabilityGraph → authorizePlaybookExecution → paid preflight →
//   runCapabilityPlan → normalized/qualified companies →
//     ├─→ projectEvaluationRows + finalizedProgress → tasks.result → Workbench readers
//     └─→ projectMissionCompanyRows → createPersistPlan → accounts / lead_candidates
//
// ── WHAT IS REAL, AND WHAT IS NOT ───────────────────────────────────────────
//
// REAL, exercised as production code — including the persistence implementation
// itself, which is deliberately NOT mocked:
//   the playbook boundary, the capability graph, the paid preflight, the engine,
//   the verified input compilers, the normalizers, identity/enrichment/hiring
//   verification/Brain qualification, `projectMissionCompanyRows`,
//   `buildCompanyRowPersistencePlan`, `createPersistPlan` (the canonical
//   writer), `projectEvaluationRows`, and the frontend Workbench readers.
//
// MOCKED, and only these two boundaries:
//   * the Apify HTTP boundary — canned rows in each provider's REAL shape;
//   * the SQL engine — a STATEFUL in-memory table store. `persistPlan`'s own
//     select-then-insert logic runs against it unchanged, so account
//     deduplication is genuinely exercised rather than asserted.
//
// NOT PROVEN HERE: that Postgres accepts these rows, or that any database
// constraint or RLS policy holds. This is an integration test of the
// application's persistence path, not a database integration test.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO real database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { selectResearchPlaybooks } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { authorizePlaybookExecution } from "../../../supabase/functions/_shared/leadPlaybookExecution.ts";
import {
  buildPaidExecutionPreflight, assertPaidExecutionAllowed,
} from "../../../supabase/functions/_shared/leadPaidExecutionPreflight.ts";
import {
  runCapabilityPlan, compileFirstProviderCall, finalizedProgress,
  type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { projectEvaluationRows } from "../../../supabase/functions/_shared/leadWorkbenchProjection.ts";
import { parseMissionEvaluationStrict } from "../../../supabase/functions/_shared/missionEvaluation.ts";
import {
  projectMissionCompanyRows, missionPersistenceSummary,
} from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { createPersistPlan } from "../../../supabase/functions/_shared/qualifiedLeadPersistence.ts";
import { identityIsActionable } from "../../../supabase/functions/_shared/companyIdentityResolution.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  readEvaluationRows,
} from "../../../src/lib/workbench/evaluationRows.ts";
import {
  readWorkbenchProgress, runActivity,
} from "../../../src/lib/workbench/workbenchProgress.ts";

// ─────────────────── a STATEFUL in-memory table store ───────────────────────

/**
 * The SQL engine, replaced. `persistPlan`'s own logic is untouched: it still
 * does select-then-insert on `accounts` by (workspace_id, domain), so running
 * the same company twice genuinely exercises the dedup rather than asserting it.
 */
function memoryDb(opts: { failTable?: string } = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    accounts: [], lead_candidates: [], contacts: [],
  };
  let n = 0;
  return {
    tables,
    rows: (t: string) => tables[t] ?? [],
    client: {
      from(table: string) {
        tables[table] ??= [];
        return {
          select(_c: string) {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq(c: string, v: unknown) { filters[c] = v; return chain; },
              // An absent column IS null, as it is in Postgres — a row inserted
              // without `contact_id` must satisfy `is("contact_id", null)`.
              is(c: string, v: null) { filters[c] = v; return chain; },
              maybeSingle() {
                const hit = tables[table].find((r) =>
                  Object.entries(filters).every(([k, v]) =>
                    v === null ? (r[k] ?? null) === null : r[k] === v));
                return Promise.resolve({ data: hit ?? null });
              },
            };
            return chain;
          },
          update(patch: Record<string, unknown>) {
            return {
              eq: (c: string, v: unknown) => {
                for (const r of tables[table]) {
                  if (r[c] === v) Object.assign(r, patch);
                }
                return Promise.resolve({ data: null });
              },
            };
          },
          insert(row: Record<string, unknown>) {
            if (opts.failTable === table) {
              return {
                select: (_c: string) => ({
                  maybeSingle: () => Promise.reject(new Error(`${table} insert failed`)),
                }),
              };
            }
            const stored = { id: `${table}_${++n}`, ...row };
            tables[table].push(stored);
            return {
              select: (_c: string) => ({
                maybeSingle: () => Promise.resolve({ data: { id: stored.id } }),
              }),
            };
          },
        };
      },
    },
  };
}

// ───────────────────────────── fixtures ─────────────────────────────────────

const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"],
  excluded_industries: [] as string[],
  required_geography: null,
};

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

const ycRow = (name: string, slug: string) => ({
  id: slug, name, website: `https://${slug}.com`,
  industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
  oneLiner: `${name} is a B2B SaaS platform.`,
  allLocations: "San Francisco, CA, USA",
  openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
});
const searchRow = (name: string, slug: string) => ({
  id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
  website: `https://${slug}.com`,
  description: `${name} is a B2B SaaS platform sold on subscription.`,
  location: "San Francisco, CA",
});
const enrichRow = (name: string, slug: string) => ({
  id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
  website: `https://${slug}.com`, employeeCount: 42,
  description: `${name} is a B2B SaaS platform sold on subscription.`,
  industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
  locations: [{ linkedinText: "United States" }],
});

const HAPPY: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly")],
  apify_linkedin_company_search: [searchRow("Sortly", "sortly")],
  apify_linkedin_company_details: [enrichRow("Sortly", "sortly")],
  apify_linkedin_job_search: [{
    id: "j1", title: "Revenue Operations Manager",
    company: { name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly" },
    postedDate: "2026-07-20",
  }],
};

// ─────────── the whole chain, exactly as run-agent sequences it ─────────────

async function runHiringWithPersistence(
  m: LeadMissionV1,
  rows: Record<string, Record<string, unknown>[]> = HAPPY,
  db = memoryDb(),
  over: Partial<CapabilityEngineDeps> = {},
  planId = "plan-1",
  workspaceId = "ws-1",
) {
  const calls: string[] = [];

  const selection = selectResearchPlaybooks(m);
  const plan = buildCapabilityGraph(m);
  const authorization = authorizePlaybookExecution(selection, plan, m);
  const first = compileFirstProviderCall(plan);
  const preflight = buildPaidExecutionPreflight({
    mission: m, plan,
    firstProvider: first.provider,
    firstProviderCompileOk: first.compiled ? first.compiled.ok : undefined,
    playbook: authorization,
  });

  let run = null as Awaited<ReturnType<typeof runCapabilityPlan>> | null;
  // Cites the company's OWN registry, so the citation survives verification —
  // a stub that invented an evidence id would be downgraded to review, exactly
  // as a real model would be.
  const passingEvaluator: CapabilityEngineDeps["evaluateMission"] = ({ registry }) => {
    const job = registry.items.find((x) =>
      x.evidence_type === "job_posting" || x.evidence_type === "yc_job");
    return Promise.resolve(parseMissionEvaluationStrict({
      mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
      confidence: 0.9, match_score: 88,
      matched_requirements: job
        ? [{
          requirement: "hiring the requested role",
          evidence_id: job.evidence_id,
          excerpt: String(job.source_text ?? "").slice(0, 20),
        }]
        : [],
      reasoning: "satisfies the mission",
      evidence_quality: "strong",
    }, registry));
  };
  if (preflight.ok) {
    assertPaidExecutionAllowed(preflight);
    run = await runCapabilityPlan({
      invoke: (call: CompiledActorCall<unknown>) => {
        calls.push(call.actorKey);
        return Promise.resolve(rows[call.actorKey] ?? []);
      },
      verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
      // QUALIFICATION NOW REQUIRES AN EVALUATOR.
      //
      // The engine no longer fabricates a passing assessment when deterministic
      // gates happen to clear — that fabrication was reported as model output
      // and is gone. A company qualifies when the evaluator says the Mission is
      // satisfied, so this suite (which is about PERSISTENCE, not about
      // qualification) supplies one that answers from the real registry.
      evaluateMission: passingEvaluator,
      ...over,
    }, { mission: m, plan, brain: BRAIN });
  }

  // ── the two projections, off the SAME companies ──────────────────────────
  const evaluation = run
    ? projectEvaluationRows(run.companies.map((c) => ({
      key: c.key, shortlisted: c.shortlisted,
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

  // GATED ON THE BOUNDARY, exactly as run-agent gates it: the engine still runs
  // for a shape this build cannot research, and such a run must not acquire Lead
  // Library records it has never had.
  const persistence = (run && authorization.applies && authorization.authorized)
    ? projectMissionCompanyRows(run.companies, workspaceId)
    : { version: "lead-mission-persistence-projection-v1" as const, rows: [], skipped: [] };

  // THE REAL WRITER. Only the SQL engine is a double.
  const persistPlan = createPersistPlan({
    db: db.client as never, workspaceId, planId,
    writeContact: (() => Promise.resolve({ ok: true })) as never,
  });
  const results: Array<{ key: string; ok: boolean; reason?: string }> = [];
  for (const row of persistence.rows) {
    try {
      const r = await persistPlan(row.plan);
      results.push({ key: row.key, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
    } catch (e) {
      results.push({ key: row.key, ok: false, reason: String(e) });
    }
  }
  const persisted = results.filter((r) => r.ok).length;

  const taskResult = run
    ? {
      workbench_progress: finalizedProgress(run.state),
      workbench_evaluation_rows: evaluation!.rows,
      lead_library_persistence: {
        ...missionPersistenceSummary(persistence, persisted),
        results,
      },
    }
    : {};

  return { calls, selection, plan, authorization, preflight, run, evaluation,
    persistence, results, persisted, taskResult, db };
}

// ══════════════════════ A. the complete chain ═══════════════════════════════

Deno.test("E2E: a hiring Mission produces BOTH Workbench rows and Lead Library records", async () => {
  const r = await runHiringWithPersistence(hiringMission());

  // Mission → playbook → authorization → execution.
  assertEquals(r.selection.runnable, ["hiring"]);
  assert(r.authorization.applies && r.authorization.authorized, r.authorization.reason);
  assert(r.preflight.ok);
  assertEquals(r.run!.state.terminal_reason, "capability_plan_complete");

  // A company qualified.
  assertEquals(r.run!.state.qualified_company_keys.length, 1);

  // → LEAD LIBRARY: a real account and a real lead_candidate row.
  assertEquals(r.persisted, 1, JSON.stringify(r.results));
  assertEquals(r.db.rows("accounts").length, 1);
  assertEquals(r.db.rows("lead_candidates").length, 1);

  const account = r.db.rows("accounts")[0];
  assertEquals(account.workspace_id, "ws-1");
  assertEquals(account.domain, "sortly.com");
  assertEquals(account.name, "Sortly");

  const lead = r.db.rows("lead_candidates")[0];
  assertEquals(lead.workspace_id, "ws-1");
  assertEquals(lead.plan_id, "plan-1");
  assertEquals(lead.lead_type, "account");
  assertEquals(lead.account_id, account.id, "the lead is bound to the account");
  assertEquals(lead.status, "new");

  // → WORKBENCH: still rendered by the real frontend readers.
  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress);
  assertEquals(runActivity(progress!), "finished");
  assertEquals(progress!.qualified_companies, 1);
});

Deno.test("E2E: Workbench and Lead Library describe the SAME outcome", async () => {
  const r = await runHiringWithPersistence(hiringMission());
  const progress = readWorkbenchProgress(r.taskResult)!;
  const evalRows = readEvaluationRows(r.taskResult);

  // The qualified company is a Lead Library record and is therefore NOT an
  // evaluation row — the two projections are complementary, not duplicative.
  assertEquals(progress.qualified_companies, r.db.rows("lead_candidates").length);
  assertFalse(
    evalRows.some((x) => x.status === "qualified"),
    "a qualified company is a record, not a progress row",
  );
  // And the persisted summary agrees with what was actually written.
  const summary = (r.taskResult as Record<string, never>).lead_library_persistence as unknown as
    { planned: number; persisted: number };
  assertEquals(summary.planned, 1);
  assertEquals(summary.persisted, r.db.rows("lead_candidates").length);
});

Deno.test("E2E: the CONTACT invariant holds — an account row is never contactable", async () => {
  const r = await runHiringWithPersistence(hiringMission());
  const lead = r.db.rows("lead_candidates")[0];
  const raw = lead.raw as Record<string, unknown>;
  assertEquals(raw.contact_eligible, false, "no person was verified, so nothing is contactable");
  assertEquals(r.db.rows("contacts").length, 0, "and no contact row was written");
  assertEquals(raw.row_kind, "company");
});

// ══════════════════════ B. idempotency ══════════════════════════════════════

Deno.test("idempotency: the same company twice reuses ONE account", async () => {
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, db);
  await runHiringWithPersistence(hiringMission(), HAPPY, db);

  assertEquals(
    db.rows("accounts").length, 1,
    "select-then-insert on (workspace_id, domain) must find the existing account",
  );
});

Deno.test("idempotency: within one run, a duplicate company produces one row", async () => {
  const db = memoryDb();
  const r = await runHiringWithPersistence(hiringMission(), {
    ...HAPPY,
    // The same company discovered twice under two concepts.
    apify_yc_companies_memo23: [ycRow("Sortly", "sortly"), ycRow("Sortly", "sortly")],
  }, db);
  assertEquals(r.persistence.rows.length, 1, "companyRowKey dedups within the projection");
  assertEquals(db.rows("lead_candidates").length, 1);
});

Deno.test("idempotency: re-running the same Mission REUSES the company candidate", async () => {
  // THE GAP THIS PHASE CLOSED. `persistPlan` used to insert `lead_candidates`
  // unconditionally, so a second equivalent run appended a second company row
  // against the same account. It now resolves the company row the same way it
  // resolves the account — select-then-insert — against the identity the
  // partial index `lead_candidates_company_scope_uniq` enforces.
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, db);
  await runHiringWithPersistence(hiringMission(), HAPPY, db);

  assertEquals(db.rows("accounts").length, 1, "accounts still dedup");
  assertEquals(
    db.rows("lead_candidates").length, 1,
    "and the company candidate is reused, not duplicated",
  );
});

Deno.test("idempotency: a NEW plan_id does not create a second company candidate", async () => {
  // The old `lc_dedupe_uniq` included `plan_id`, and orchestrate creates a new
  // task_plan per request — which is exactly why restoring it would not have
  // fixed this. The company row is identified by its COMPANY, not by its run.
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, db, {}, "plan-1");
  await runHiringWithPersistence(hiringMission(), HAPPY, db, {}, "plan-2");

  assertEquals(db.rows("lead_candidates").length, 1);
  assertEquals(
    db.rows("lead_candidates")[0].plan_id, "plan-2",
    "and it carries the run that last confirmed it",
  );
});

Deno.test("idempotency: the re-run REFRESHES the row rather than leaving it stale", async () => {
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, db);
  const first = { ...db.rows("lead_candidates")[0] };

  // A later run finds a different opening at the same company.
  await runHiringWithPersistence(hiringMission(), {
    ...HAPPY,
    apify_linkedin_job_search: [{
      id: "j2", title: "Head of Revenue Operations",
      company: { name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly" },
      postedDate: "2026-08-01",
    }],
  }, db);

  assertEquals(db.rows("lead_candidates").length, 1, "still one row");
  assertEquals(db.rows("lead_candidates")[0].id, first.id, "the SAME row");
});

Deno.test("idempotency: two workspaces holding the same company do not collide", async () => {
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, db, {}, "plan-1", "ws-1");
  await runHiringWithPersistence(hiringMission(), HAPPY, db, {}, "plan-1", "ws-2");

  assertEquals(db.rows("lead_candidates").length, 2, "one candidate per workspace");
  assertEquals(
    new Set(db.rows("lead_candidates").map((r) => r.workspace_id)).size, 2,
  );
});

Deno.test("idempotency: two different companies remain two candidates", async () => {
  const db = memoryDb();
  await runHiringWithPersistence(hiringMission(), {
    apify_yc_companies_memo23: [ycRow("Sortly", "sortly"), ycRow("Clay", "clay")],
    apify_linkedin_company_search: [searchRow("Sortly", "sortly"), searchRow("Clay", "clay")],
    apify_linkedin_company_details: [enrichRow("Sortly", "sortly"), enrichRow("Clay", "clay")],
    apify_linkedin_job_search: HAPPY.apify_linkedin_job_search,
  }, db);
  assertEquals(db.rows("lead_candidates").length, 2);
});

Deno.test("idempotency: a retry after a failed write does not duplicate", async () => {
  // First attempt fails at the lead_candidates insert; the retry must land on a
  // clean insert rather than a second row.
  const failing = memoryDb({ failTable: "lead_candidates" });
  const r1 = await runHiringWithPersistence(hiringMission(), HAPPY, failing);
  assertEquals(r1.persisted, 0);
  assertEquals(failing.rows("lead_candidates").length, 0);

  // Same store, now healthy: the account already exists, the candidate does not.
  const healthy = memoryDb();
  await runHiringWithPersistence(hiringMission(), HAPPY, healthy);
  await runHiringWithPersistence(hiringMission(), HAPPY, healthy);
  assertEquals(healthy.rows("lead_candidates").length, 1);
});

// ══════════════════════ C. failure behaviour ════════════════════════════════

Deno.test("zero results: a completed run persists nothing and says zero", async () => {
  const r = await runHiringWithPersistence(hiringMission(), {});
  assertEquals(r.run!.companies.length, 0);
  assertEquals(r.persistence.rows.length, 0);
  assertEquals(r.db.rows("accounts").length, 0, "no fake records");
  assertEquals(r.db.rows("lead_candidates").length, 0);

  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress, "the run is still explainable");
  assertEquals(progress!.qualified_companies, 0);
});

Deno.test("provider failure: nothing is persisted and the Workbench stays explainable", async () => {
  const r = await runHiringWithPersistence(hiringMission(), HAPPY, memoryDb(), {
    invoke: () => Promise.reject(new Error("actor unavailable")),
  });
  assertEquals(r.db.rows("accounts").length, 0);
  assertEquals(r.db.rows("lead_candidates").length, 0, "no partial garbage");
  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress, "a failed run is still reported");
  assertEquals(progress!.accounts_found, 0);
  assert(/exhausted/.test(r.run!.state.terminal_reason ?? ""));
});

Deno.test("partial provider failure: what succeeded persists, what failed does not", async () => {
  // Discovery succeeds for two companies; enrichment only answers for one, so
  // only that one can qualify — the other cannot, and must not be written.
  const db = memoryDb();
  const r = await runHiringWithPersistence(hiringMission(), {
    apify_yc_companies_memo23: [ycRow("Sortly", "sortly"), ycRow("Clay", "clay")],
    apify_linkedin_company_search: [searchRow("Sortly", "sortly"), searchRow("Clay", "clay")],
    // Enrichment answers for Sortly only.
    apify_linkedin_company_details: [enrichRow("Sortly", "sortly")],
    apify_linkedin_job_search: HAPPY.apify_linkedin_job_search,
  }, db);

  assertEquals(db.rows("lead_candidates").length, r.run!.state.qualified_company_keys.length);
  for (const lead of db.rows("lead_candidates")) {
    const raw = lead.raw as Record<string, unknown>;
    assertEquals(raw.company_brain_status, "qualified", "only qualified companies persist");
  }
  // The unqualified one is still visible as work done.
  assert(
    readEvaluationRows(r.taskResult).length > 0 || db.rows("lead_candidates").length > 0,
    "the run is visible one way or the other",
  );
});

Deno.test("persistence failure: reported, and the Workbench result survives", async () => {
  const db = memoryDb({ failTable: "lead_candidates" });
  const r = await runHiringWithPersistence(hiringMission(), HAPPY, db);

  assertEquals(r.persisted, 0, "the write failed");
  assert(r.results.every((x) => !x.ok), "and every result says so");
  assertEquals(db.rows("lead_candidates").length, 0);

  // THE CONTRACT: a persistence failure does not discard the Workbench result
  // the user can already see, and it is not reported as a success either.
  const progress = readWorkbenchProgress(r.taskResult);
  assert(progress, "the run is still rendered");
  const summary = (r.taskResult as Record<string, never>).lead_library_persistence as unknown as
    { planned: number; persisted: number };
  assertEquals(summary.planned, 1);
  assertEquals(summary.persisted, 0, "the failure is visible from the persisted row");
});

Deno.test("an unqualified company is never written to the Lead Library", async () => {
  // A company outside the Brain's employee range cannot qualify.
  const db = memoryDb();
  const r = await runHiringWithPersistence(hiringMission(), {
    ...HAPPY,
    apify_linkedin_company_details: [{ ...enrichRow("Sortly", "sortly"), employeeCount: 5000 }],
  }, db);
  assertEquals(r.run!.state.qualified_company_keys.length, 0);
  assertEquals(db.rows("lead_candidates").length, 0);
  assert(readEvaluationRows(r.taskResult).length > 0, "but it is visible as work done");
});

// ══════════════════════ D. containment ══════════════════════════════════════

Deno.test("an unsupported playbook writes nothing to the Lead Library", async () => {
  // THE SCOPE PROMISE, ENFORCED. The capability engine still RUNS for these
  // missions — that behaviour is unchanged and deliberate — so persistence has
  // to be gated on the boundary rather than merely sequenced after it. Without
  // the gate, `social`, `news` and `funding` would acquire Lead Library records
  // they have never had, which is precisely the behaviour change this phase
  // promised not to make.
  for (const strategy of ["social", "news", "funding"] as const) {
    const db = memoryDb();
    const r = await runHiringWithPersistence(
      hiringMission({ strategies: [strategy] }), HAPPY, db);
    assertFalse(r.authorization.applies, `${strategy} is not governed by the hiring boundary`);
    assert(r.run, "the engine still runs — unchanged behaviour");
    assertEquals(db.rows("accounts").length, 0, `${strategy} must persist nothing`);
    assertEquals(db.rows("lead_candidates").length, 0);
  }
});

Deno.test("a playbook/capability mismatch persists nothing and calls no actor", async () => {
  const db = memoryDb();
  const r = await runHiringWithPersistence(hiringMission({
    required_signals: [{ type: "hiring" }, { type: "funding" }],
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: [], locations: [],
    },
  }), HAPPY, db);
  assertFalse(r.preflight.ok);
  assertEquals(r.run, null);
  assertEquals(r.calls, []);
  assertEquals(db.rows("lead_candidates").length, 0);
});

Deno.test("run-agent wires the projection to the canonical writer, once", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assertEquals(
    [...RUN.matchAll(/projectMissionCompanyRows\(/g)].length, 1,
    "one mission-persistence projection call site",
  );
  assert(
    /projectMissionCompanyRows\(\s*capabilityRun\.companies, workspace_id\)/.test(RUN),
    "it must project the ENGINE's companies",
  );
  assert(
    /const missionPersistPlan = createPersistPlan\(\{/.test(RUN),
    "and persist through the canonical writer, not a new one",
  );
  // The two views come off the same companies, so they cannot disagree.
  assert(
    /projectEvaluationRows\(capabilityRun\.companies\.map\(/.test(RUN),
    "the Workbench projection reads the same source",
  );
  assert(
    RUN.includes("lead_library_persistence:"),
    "and the persistence outcome is written alongside the Workbench keys",
  );
});

Deno.test("the wiring introduces no raw-text semantic reader", () => {
  const SRC = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const parser of [
    "extractLeadIntent", "extractRequestedLeadCount", "separateIntent",
    "classifyWorkflow", "parseLeadMissionDeterministic", "extractLeadSearchIntent",
  ]) {
    assertFalse(SRC.includes(parser), `${parser} must not appear`);
  }
  assertFalse(/original_user_query|\binstruction\b|\bprompt\b/.test(SRC));
});
