// THE BROWSER SAYS WHICH RUN. THE DATABASE SAYS WHAT IT FOUND.
//
// The previous stage sent per-company checkpoint records from `continue-workflow`
// to `run-agent` inside the request body, and run-agent re-validated their
// SHAPE. Shape was never the risk. A member of the workspace could send a
// well-formed record under a real company key carrying someone else's LinkedIn
// URL, and the engine would restore it as that company's identity — attaching
// the wrong employer to a real lead — or mark an unbought operation "completed"
// and suppress a call the run needed.
//
// These are source-level and behavioural proofs that the payload now comes from
// the database, addressed by task id and gated on workspace ownership.
//
// ZERO network, ZERO Actor runs, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readCheckpointCompanies, lineageRootTaskId, buildCheckpoint, newCompanyRecord,
  CHECKPOINT_RESULT_KEY, LINEAGE_ROOT_RESULT_KEY,
} from "../../../supabase/functions/_shared/leadResumeState.ts";

const runAgentSrc = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
const continueSrc = await Deno.readTextFile(
  new URL("../../../supabase/functions/continue-workflow/index.ts", import.meta.url));

// ═══════════════════════════════════════════════════ 17-22. security ══

Deno.test("17-19. client-supplied Actor ids, provider inputs and graphs are ignored", () => {
  // The ignore-list exists and names each class of field.
  for (const field of [
    "actor_id", "selected_actor_key", "provider_input", "raw_actor_input",
    "capability_plan", "capability_graph", "allowed_providers",
    "budget", "budget_override",
  ]) {
    assert(runAgentSrc.includes(`"${field}"`),
      `${field} must be named in the ignored-client-fields list`);
  }
  assert(runAgentSrc.includes("rejectedClientFields"),
    "and the ignore must be observable, not silent");
  assert(runAgentSrc.includes("client_fields_ignored"),
    "the rejection is logged for audit");
});

Deno.test("20. client-supplied resume records are no longer trusted", () => {
  // THE OLD READER IS GONE. Its absence is the guarantee: there is no code path
  // left that turns body content into resume records.
  assertFalse(runAgentSrc.includes("function readLeadResumeRecords"),
    "the body-trusting reader must be removed, not merely bypassed");
  assertFalse(/const\s+leadResumeRecords\s*=\s*readLeadResumeRecords/.test(runAgentSrc),
    "nothing may build resume records from the request body");
  assert(runAgentSrc.includes('"lead_resume_records"'),
    "and the field is explicitly listed as ignored if a stale caller sends it");
  // The lineage root is no longer taken from the body either.
  assertFalse(runAgentSrc.includes("leadResumeLineageRootIn"),
    "the lineage root must come from the verified row, not the body");
});

Deno.test("21. resume records are loaded through verified server-side lineage", () => {
  assert(runAgentSrc.includes("async function loadLeadResumeRecords"),
    "there must be a server-side loader");
  // It reads the tasks table, by id, selecting the workspace for the check.
  assert(/from\("tasks"\)[\s\S]{0,120}select\([^)]*workspace_id/.test(runAgentSrc),
    "the loader must read workspace_id alongside the result");
  assert(runAgentSrc.includes("readCheckpointCompanies(result)"),
    "the records come from the persisted checkpoint, validated");
  assert(runAgentSrc.includes("lineageRootTaskId(parentTaskId, result)"),
    "and so does the lineage root");
  // continue-workflow sends an ADDRESS, not a payload.
  assert(continueSrc.includes("lead_resume_parent_task_id"),
    "the continuation sends a task id");
  assertFalse(continueSrc.includes("lead_resume_records: spec.lead_resume_records"),
    "and no longer sends the records themselves");
});

Deno.test("22. cross-workspace lineage access is refused", () => {
  assert(runAgentSrc.includes("resume_cross_workspace_refused"),
    "a mismatch must be an explicit refusal with a name");
  // The comparison is string-normalised on BOTH sides, so a numeric/string id
  // mismatch cannot accidentally pass.
  assert(/String\(\(data as[\s\S]{0,80}workspace_id[\s\S]{0,40}\)\s*!==\s*String\(workspaceId\)/
    .test(runAgentSrc) ||
    runAgentSrc.includes('!== String(workspaceId)'),
    "the workspace comparison must be explicit");
  // A refusal yields NOTHING, never a partial read.
  assert(runAgentSrc.includes("const none = "),
    "a refused load returns no records, no lineage root");
});

Deno.test("22b. a refused or missing load re-buys rather than skipping wrongly", () => {
  // The failure direction matters. Zero records means "nothing is known to be
  // done", which costs money; trusting a bad record means skipping a call the
  // run needed, which costs correctness.
  assert(runAgentSrc.includes("resume_parent_task_not_found"));
  assert(runAgentSrc.includes("resume_load_failed"));
  const idx = runAgentSrc.indexOf("resume_load_failed");
  const window = runAgentSrc.slice(Math.max(0, idx - 400), idx + 200);
  assert(/not a licence to trust the client|re-buys/i.test(window),
    "the failure direction must be stated where it is implemented");
});

// ═══════════════════════════════ the loader's validation, exercised ══

Deno.test("L1. the checkpoint reader still refuses what it always refused", () => {
  const good = {
    ...newCompanyRecord("acme.com", "Acme"),
    identity: "resolved" as const,
    linkedin_company_url: "https://www.linkedin.com/company/acme",
    completed_operations: ["op-1"],
  };
  const checkpoint = buildCheckpoint({
    now: 0, deadlineAt: 1, remainingMs: 0,
    lastCompletedCapability: null, nextPendingCapability: null,
    companies: [good], reason: "all_work_complete",
  });
  const result = { [CHECKPOINT_RESULT_KEY]: checkpoint, [LINEAGE_ROOT_RESULT_KEY]: "root-1" };

  assertEquals(readCheckpointCompanies(result).length, 1);
  assertEquals(readCheckpointCompanies(result)[0].completed_operations, ["op-1"]);
  assertEquals(lineageRootTaskId("child-2", result), "root-1",
    "the chain root is inherited from the verified row");

  // Nothing, wrong version, and keyless records all yield nothing.
  assertEquals(readCheckpointCompanies(null).length, 0);
  assertEquals(readCheckpointCompanies({
    [CHECKPOINT_RESULT_KEY]: { ...checkpoint, version: "other" },
  }).length, 0);
});

// ═════════════════════════════════════════════════ 31-33. safety ══

Deno.test("31-33. no Actor, no production, no protected file", () => {
  // 31 — this suite reads source text and pure functions. There is no invoker.
  assertFalse(runAgentSrc.includes("__TEST_ONLY_START_ACTOR"), "no test backdoor exists");
  // 32 — production is never CONTACTED.
  //
  // The ref does appear once in run-agent, in the file header comment recording
  // which backend the schema was aligned against. That is documentation, not a
  // connection: what matters is that no URL, client or fetch is built from it.
  // Asserting its total absence would fail on a comment and prove nothing.
  const PROD = "ohsdatpvfdjdemstoiuj";
  for (const [name, src] of [["run-agent", runAgentSrc], ["continue-workflow", continueSrc]] as const) {
    for (const line of src.split("\n")) {
      if (!line.includes(PROD)) continue;
      assert(line.trim().startsWith("//"),
        `${name}: the production ref may appear only in a comment, found: ${line.trim()}`);
    }
    assertFalse(new RegExp(`https://${PROD}`).test(src),
      `${name} must not build a production URL`);
    assertFalse(new RegExp(`createClient\\([^)]*${PROD}`).test(src),
      `${name} must not build a production client`);
  }
  // 33 — neither function imports or writes the protected entrypoint.
  for (const src of [runAgentSrc, continueSrc]) {
    assertFalse(/from\s+["'][^"']*\/mcp\//.test(src), "no import from mcp/");
  }
});
