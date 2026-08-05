// A RESUME MUST NOT RE-BUY WHAT IT ALREADY PAID FOR.
//
// `shouldSkipProviderCall` and the per-company resume records were persisted and
// tested from the day the checkpoint landed, and NO CALL SITE CONSULTED THEM. A
// continuation therefore adopted the discovery run — which the continuation
// guard did enforce — and then bought a fresh LinkedIn company search for every
// company the parent run had already resolved.
//
// These tests drive the real engine twice: once to produce a checkpoint, once
// resuming from it. The second run must not repeat the first run's paid identity
// work, and must still reach the SAME verdicts — a cheaper run that answers a
// different question is not a saving.
//
// Every Actor is a mock. ZERO network, ZERO Actor runs, ZERO model calls,
// ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLeadMissionDeterministic, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  identityIsActionable,
} from "../../../supabase/functions/_shared/companyIdentityResolution.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import {
  CHECKPOINT_RESULT_KEY, LINEAGE_ROOT_RESULT_KEY, RESUME_STATE_VERSION,
  buildCheckpoint, lineageRootTaskId, newCompanyRecord, readCheckpointCompanies,
  type CompanyResumeRecord,
} from "../../../supabase/functions/_shared/leadResumeState.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const CANONICAL =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

const mission = (): LeadMissionV1 => parseLeadMissionDeterministic(CANONICAL);

const BRAIN = {
  employee_min: 10,
  employee_max: 150,
  positive_industries: ["b2b saas"],
  excluded_industries: [] as string[],
  required_geography: null,
};

const WORKSPACE = "ws-resume-guard";
const ROOT_TASK = "task-root-0001";

function ycRow(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} is a B2B SaaS platform.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
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

function enrichRow(name: string, slug: string) {
  return {
    id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}`,
    website: `https://${slug}.com`, employeeCount: 42,
    description: `${name} is a B2B SaaS platform sold on subscription.`,
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  };
}

const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly")],
  apify_linkedin_company_search: [searchRow("Sortly", "sortly")],
  apify_linkedin_company_details: [enrichRow("Sortly", "sortly")],
  apify_linkedin_company_employees: [{
    id: "p1", firstName: "Ada", lastName: "Founder",
    headline: "Co-Founder & CEO",
    linkedinUrl: "https://www.linkedin.com/in/ACwAAA",
    currentPositions: [{
      companyName: "Sortly", companyLinkedinUrl: "https://www.linkedin.com/company/sortly",
      isCurrent: true, title: "Co-Founder",
    }],
  }],
};

interface Recorder { calls: string[] }

function mockDeps(rec: Recorder): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      return Promise.resolve(ROWS[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
}

const IDENTITY_PROVIDER = "apify_linkedin_company_search";

/**
 * The first, full-price run. Its checkpoint is what a resume reads.
 *
 * It carries the operation SCOPE with no records — which is how run-agent calls
 * it on a first run. Nothing is skipped; the ledger is written.
 */
async function firstRun() {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    resume: { workspace_id: WORKSPACE, lineage_root_task_id: ROOT_TASK, records: [] },
  });
  return { run, rec };
}

/** The same run with the option omitted entirely — the pre-change behaviour. */
async function unscopedRun() {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  return { run, rec };
}

// ═════════════════════════════ 1. the ledger is written at all ══

Deno.test("1. a completed provider call is recorded against its company", async () => {
  const { run, rec } = await firstRun();
  assert(rec.calls.includes(IDENTITY_PROVIDER),
    "the first run must genuinely buy identity resolution");

  const sortly = run.resume_records.find((r) => r.company_name === "Sortly");
  assert(sortly, "Sortly must appear in the resume records");
  // BEFORE THIS CHANGE THIS ARRAY WAS ALWAYS EMPTY. Nothing wrote it, so
  // `shouldSkipProviderCall` could never return `already_completed` however
  // many times a continuation ran.
  assert(sortly!.completed_operations.length > 0,
    "the identity call must be recorded as completed work");
  assertEquals(sortly!.identity, "resolved");
  assert(sortly!.linkedin_company_url, "the resolved URL is the payload a resume reuses");
});

// ═════════════════════════════ 2. the resume does not re-buy ══

Deno.test("2. a resume does not re-buy identity resolution", async () => {
  const first = await firstRun();
  const records = first.run.resume_records;

  const rec: Recorder = { calls: [] };
  const m = mission();
  const second = await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    resume: {
      workspace_id: WORKSPACE, lineage_root_task_id: ROOT_TASK, records,
    },
  });

  assertFalse(rec.calls.includes(IDENTITY_PROVIDER),
    "the company search must not be bought a second time");
  // AND THE ANSWER IS UNCHANGED. A skip that lost the identity would be a
  // corruption dressed up as a saving.
  const sortly = second.companies.find((c) => c.company.company_name === "Sortly");
  assert(sortly, "Sortly must still be in the working set");
  assert(sortly!.identity && identityIsActionable(sortly!.identity),
    "the restored identity must be as actionable as the one it replaces");
  assertEquals(
    sortly!.identity?.linkedin_company_url,
    "https://www.linkedin.com/company/sortly",
  );
  // It resolved from the URL the checkpoint carried, not from a fresh lookup.
  assert(sortly!.identity!.evidence.includes("source_supplied_canonical_linkedin_url"),
    "the identity came from the resume record, not a repeat purchase");
  assertEquals(second.state.qualified_company_keys,
    first.run.state.qualified_company_keys,
    "the resumed run reaches the same verdicts");
});

Deno.test("3. the resumed run costs strictly less", async () => {
  const first = await firstRun();
  const rec: Recorder = { calls: [] };
  const m = mission();
  const second = await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    resume: {
      workspace_id: WORKSPACE, lineage_root_task_id: ROOT_TASK,
      records: first.run.resume_records,
    },
  });
  assert(second.state.accumulated_cost_units < first.run.state.accumulated_cost_units,
    `resumed cost ${second.state.accumulated_cost_units} must be below ` +
    `${first.run.state.accumulated_cost_units}`);
  // WHERE THE SAVING COMES FROM, stated exactly.
  //
  // Not from a recorded skip: for a company whose identity the checkpoint
  // carries, the restore puts the URL back BEFORE the identity stage, and that
  // stage already declines to pay for a company it can name — so no call is
  // attempted and there is nothing to skip. The recorded skip is the other
  // path, for a company a previous run gave up on; test 4 owns that one.
  assertEquals(
    second.state.provider_attempts.filter((a) => a.provider === IDENTITY_PROVIDER).length,
    0,
    "the identity provider is not reached at all on a resume");
  assertEquals(
    second.state.provider_attempts.every((a) => a.outcome !== "error"), true,
    "and nothing was turned into a failure to get there");
});

// ═════════════════════════════ 4. a company already given up on ══

Deno.test("4. a terminal identity is never paid for again", async () => {
  const first = await firstRun();
  const sortlyKey = first.run.resume_records[0].company_key;

  // The parent run tried and failed to identify this company. Asking again at a
  // price is exactly what the caps exist to prevent.
  const abandoned: CompanyResumeRecord = {
    ...newCompanyRecord(sortlyKey, "Sortly"),
    identity: "unresolved",
  };

  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    resume: {
      workspace_id: WORKSPACE, lineage_root_task_id: ROOT_TASK,
      records: [abandoned],
    },
  });

  assertFalse(rec.calls.includes(IDENTITY_PROVIDER),
    "a company already given up on is not searched again");
  const skip = run.state.provider_attempts.find(
    (a) => a.outcome === "skipped_resume_reuse");
  assert(skip, "the refusal must be recorded");
  assertEquals(skip!.reason, "identity_terminal");
  assertEquals(skip!.cost_units, 0);
});

// ═════════════════════════════ 5. no resume input changes nothing ══

Deno.test("5. a first run spends exactly what an unscoped run spends", async () => {
  const scoped = await firstRun();
  const unscoped = await unscopedRun();
  // THE ONLY DIFFERENCE A FIRST RUN MAY SHOW IS THE LEDGER IT WRITES. Same
  // calls, same order, same cost — the guard is not allowed to change what a
  // run that has nothing to reuse actually does.
  assertEquals(scoped.rec.calls, unscoped.rec.calls, "the unresumed path is untouched");
  assertEquals(
    scoped.run.state.accumulated_cost_units,
    unscoped.run.state.accumulated_cost_units);
  assertEquals(
    scoped.run.state.provider_attempts.some((x) => x.outcome === "skipped_resume_reuse"),
    false,
    "a first run has nothing to skip");
  // And the unscoped run records no operation keys at all, so the option really
  // is inert when omitted.
  assertEquals(
    unscoped.run.resume_records.every((r) => r.completed_operations.length === 0),
    true);
});

Deno.test("6. records belonging to other companies never skip anything", async () => {
  const rec: Recorder = { calls: [] };
  const m = mission();
  await runCapabilityPlan(mockDeps(rec), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
    resume: {
      workspace_id: WORKSPACE, lineage_root_task_id: ROOT_TASK,
      // A record for a company this run never discovered.
      records: [{
        ...newCompanyRecord("someone-else.com", "Someone Else"),
        identity: "unresolved",
      }],
    },
  });
  assert(rec.calls.includes(IDENTITY_PROVIDER),
    "an unrelated record must not suppress a call this run has not made");
});

// ═════════════════════════════ 7. reading the checkpoint back ══

Deno.test("7. checkpoint records are validated, not trusted", () => {
  const good = {
    ...newCompanyRecord("sortly.com", "Sortly"),
    identity: "resolved" as const,
    linkedin_company_url: "https://www.linkedin.com/company/sortly",
    completed_operations: ["op-1", "op-2"],
  };
  const checkpoint = buildCheckpoint({
    now: 0, deadlineAt: 1, remainingMs: 0,
    lastCompletedCapability: null, nextPendingCapability: null,
    companies: [good], reason: "execution_deadline_checkpoint",
  });
  const read = readCheckpointCompanies({ [CHECKPOINT_RESULT_KEY]: checkpoint });
  assertEquals(read.length, 1);
  assertEquals(read[0].completed_operations, ["op-1", "op-2"]);
  assertEquals(read[0].linkedin_company_url, good.linkedin_company_url);

  // A checkpoint from another version is not read at all.
  assertEquals(
    readCheckpointCompanies({
      [CHECKPOINT_RESULT_KEY]: { ...checkpoint, version: "something-else" },
    }).length, 0);
  // Nothing at all is not an error.
  assertEquals(readCheckpointCompanies(null).length, 0);
  assertEquals(readCheckpointCompanies({}).length, 0);

  // A KEYLESS RECORD IS DROPPED, not defaulted. A record filed under the wrong
  // key would skip a paid call for a company it does not describe.
  assertEquals(
    readCheckpointCompanies({
      [CHECKPOINT_RESULT_KEY]: {
        version: RESUME_STATE_VERSION,
        companies: [{ company_name: "No Key", identity: "resolved" }],
      },
    }).length, 0);

  // An unrecognised stage falls back to "not started" — which can only cause
  // work to be REDONE, never wrongly skipped.
  const coerced = readCheckpointCompanies({
    [CHECKPOINT_RESULT_KEY]: {
      version: RESUME_STATE_VERSION,
      companies: [{
        company_key: "k", identity: "totally-made-up",
        completed_operations: ["ok", 7, null],
      }],
    },
  });
  assertEquals(coerced[0].identity, "not_started");
  assertEquals(coerced[0].completed_operations, ["ok"]);
});

Deno.test("8. the lineage root propagates instead of resetting each hop", () => {
  // A first run has no stored root and becomes the root itself.
  assertEquals(lineageRootTaskId("task-a", null), "task-a");
  assertEquals(lineageRootTaskId("task-a", {}), "task-a");
  // Every later hop INHERITS it. Taking the immediate parent instead would give
  // the third invocation different operation keys from the second, and it would
  // re-buy everything the second had already paid for.
  assertEquals(
    lineageRootTaskId("task-b", { [LINEAGE_ROOT_RESULT_KEY]: "task-a" }), "task-a");
  assertEquals(
    lineageRootTaskId("task-c", { [LINEAGE_ROOT_RESULT_KEY]: "task-a" }), "task-a");
});
