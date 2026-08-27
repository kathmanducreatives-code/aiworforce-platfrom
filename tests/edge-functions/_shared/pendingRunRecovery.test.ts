// A HARD-KILLED SLICE MUST NOT COST THE RUN ITS PAID WORK.
//
// Run fafd9912, 2026-08-26, verbatim from production:
//
//   tasks.updated_at                          16:11:17   (slice 1's state)
//   lead_execution_calls ub2qunSMAKTNf5AKv    16:12:14   status "started"
//   capability_execution_state.pending_runs   []
//
// Slice 2 enriched eleven companies, POSTed a three-company job search, and was
// killed mid-poll. `pending_runs` is written only when a poll gives up
// GRACEFULLY, and a hard kill runs no catch block — so the ledger knew about a
// run Apify was still executing and the checkpoint did not. A resumed slice
// would have POSTed the same three companies again and paid twice.
//
// Pure. No network, no database, no clock.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergePendingRuns, recoverPendingRuns, redactionIsIdentityFor,
} from "../../../supabase/functions/_shared/pendingRunRecovery.ts";
import { inputFingerprint } from "../../../supabase/functions/_shared/leadResumeState.ts";
import { HIRING_JOB_TITLES } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

/** The exact input run ub2qunSMAKTNf5AKv was started with. */
const LIVE_INPUT = {
  company: [
    "https://www.linkedin.com/company/crossinghurdles",
    "https://www.linkedin.com/company/confidentialcareers",
    "https://www.linkedin.com/company/stealth-startup-community",
  ],
  maxItems: 30,
  jobTitles: HIRING_JOB_TITLES,
};

/** The row the ledger actually held while the checkpoint held nothing. */
const LIVE_ROW = {
  capability: "apify_linkedin_job_search",
  provider_id: "apify",
  provider_run_id: "ub2qunSMAKTNf5AKv",
  dataset_id: "TqElXPkmo7E5Fnu43",
  status: "started",
  request_input: { input: LIVE_INPUT },
  started_at: "2026-08-26T16:12:14.351Z",
  created_at: "2026-08-26T16:12:14.351Z",
};

Deno.test("the live orphaned run is recovered from the ledger alone", () => {
  const [r] = recoverPendingRuns([LIVE_ROW]);
  assert(r, "the run the checkpoint lost must come back");
  assertEquals(r.run_id, "ub2qunSMAKTNf5AKv");
  assertEquals(r.dataset_id, "TqElXPkmo7E5Fnu43");
  assertEquals(r.provider, "apify_linkedin_job_search");
  assertEquals(r.capability, null, "the ledger stores the actor key, not the CapabilityId");
  assertEquals(r.recovered_from_ledger, true);
  assertEquals(r.input_fingerprint, inputFingerprint(LIVE_INPUT));
});

Deno.test("the recomputed fingerprint matches one a checkpoint really persisted", () => {
  // THE PROPERTY THE WHOLE RECOVERY RESTS ON, checked against production.
  // Run Zs5bYFGlnua1hJWYg (task 783fa163) DID checkpoint, and its
  // `pending_runs` entry recorded `input_fingerprint: "80666f95"`. Recomputing
  // from that row's `request_input.input` must reproduce it exactly, or a
  // recovered run would fail to match its own call and be re-POSTed.
  const stored = {
    company: [
      "https://www.linkedin.com/company/adobe",
      "https://www.linkedin.com/company/uber-com",
      "https://www.linkedin.com/company/bloomberg-news",
      "https://www.linkedin.com/company/lhhworldwide",
      "https://www.linkedin.com/company/salesforce",
      "https://www.linkedin.com/company/cisco",
      "https://www.linkedin.com/company/amazon",
      "https://www.linkedin.com/company/linkedin",
      "https://www.linkedin.com/company/robert-half-international",
      "https://www.linkedin.com/company/microsoft",
    ],
    maxItems: 100,
    jobTitles: HIRING_JOB_TITLES,
  };
  const [r] = recoverPendingRuns([{
    ...LIVE_ROW, provider_run_id: "Zs5bYFGlnua1hJWYg",
    request_input: { input: stored },
  }]);
  assertEquals(r.input_fingerprint, "80666f95",
    "the fingerprint the live checkpoint persisted for this exact run");
});

Deno.test("a JSONB round trip cannot change the fingerprint", () => {
  // Postgres reorders object keys. `inputFingerprint` sorts them, so this holds
  // — but it is the reason recovery may read the ledger at all, so it is pinned.
  const reordered = JSON.parse(JSON.stringify({
    jobTitles: LIVE_INPUT.jobTitles, company: LIVE_INPUT.company, maxItems: 30,
  }));
  assertEquals(inputFingerprint(reordered), inputFingerprint(LIVE_INPUT));
});

Deno.test("redaction is identity for the inputs this pipeline sends", () => {
  // If `redactProviderInput` ever alters one of these, the recomputed
  // fingerprint stops matching and adoption silently becomes a second POST.
  // This fails loudly instead.
  assert(redactionIsIdentityFor(LIVE_INPUT), "job search");
  assert(redactionIsIdentityFor(
    { maxItems: 30, companySize: ["1-10", "11-50", "51-200"],
      industryIds: ["4", "6", "104", "137"], scraperMode: "full" }), "discovery");
  assert(redactionIsIdentityFor(
    { companies: ["https://www.linkedin.com/company/micro1"] }), "enrichment");
});

// ── WHAT MUST NEVER BE RECOVERED ──────────────────────────────────────────

Deno.test("a finished run is not pending", () => {
  for (const status of ["succeeded", "failed", "timed_out"]) {
    assertEquals(recoverPendingRuns([{ ...LIVE_ROW, status }]).length, 0, status);
  }
});

Deno.test("a call that never reached the provider is not recovered", () => {
  // No run id means nothing was started and nothing was billed.
  assertEquals(recoverPendingRuns([{ ...LIVE_ROW, provider_run_id: null }]).length, 0);
  assertEquals(recoverPendingRuns([{ ...LIVE_ROW, provider_run_id: "  " }]).length, 0);
});

Deno.test("a run with no recorded input is NOT adopted", () => {
  // Without a fingerprint the entry could attach to the wrong call — a batch of
  // one inheriting a batch of ten's run id, which is the exact defect the
  // fingerprint was introduced to prevent (run ede69c8c). One re-POST is the
  // cheaper mistake.
  assertEquals(recoverPendingRuns([{ ...LIVE_ROW, request_input: {} }]).length, 0);
  assertEquals(recoverPendingRuns([{ ...LIVE_ROW, request_input: null }]).length, 0);
});

Deno.test("the same run is never recovered twice", () => {
  assertEquals(recoverPendingRuns([LIVE_ROW, { ...LIVE_ROW }]).length, 1);
});

// ── MERGING WITH WHAT THE CHECKPOINT DID SAVE ─────────────────────────────

Deno.test("a checkpointed run keeps its precise capability", () => {
  // Recovery must only ADD. An entry the checkpoint saved carries the real
  // CapabilityId, which makes adoption strictly more precise than a recovered
  // one — overwriting it would lose information.
  const checkpointed = [{
    capability: "hiring_verification", provider: "apify_linkedin_job_search",
    run_id: "ub2qunSMAKTNf5AKv", dataset_id: "TqElXPkmo7E5Fnu43",
    actor_build_id: null, started_at: "x", input_fingerprint: "abc",
  }];
  const merged = mergePendingRuns(checkpointed, recoverPendingRuns([LIVE_ROW]));
  assertEquals(merged.length, 1, "not duplicated");
  assertEquals(merged[0].capability, "hiring_verification", "the checkpoint wins");
});

Deno.test("a lost run is added beside the ones that survived", () => {
  const checkpointed = [{
    capability: "general_company_discovery", provider: "apify_linkedin_company_search",
    run_id: "OTHER", dataset_id: null, actor_build_id: null,
    started_at: "x", input_fingerprint: "zzz",
  }];
  const merged = mergePendingRuns(checkpointed, recoverPendingRuns([LIVE_ROW]));
  assertEquals(merged.map((m) => m.run_id), ["OTHER", "ub2qunSMAKTNf5AKv"]);
});

Deno.test("no recovered runs leaves the checkpoint byte-identical", () => {
  const checkpointed = [{
    capability: "general_company_discovery", provider: "p", run_id: "A",
    dataset_id: null, actor_build_id: null, started_at: "x", input_fingerprint: "f",
  }];
  assertEquals(mergePendingRuns(checkpointed, []), checkpointed);
});

// ── THE CALL SITES ────────────────────────────────────────────────────────

Deno.test("adoption accepts a recovered entry's null capability", () => {
  const ENGINE = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url),
  );
  const i = ENGINE.indexOf("const inFlight = (opts.state?.pending_runs ?? []).find(");
  assert(i > 0);
  const block = ENGINE.slice(i, i + 320);
  assert(
    block.includes("r.capability === null"),
    "a recovered run must not be rejected for not knowing its CapabilityId",
  );
  assert(
    block.includes("r.input_fingerprint === thisFingerprint"),
    "and the fingerprint must still be REQUIRED and exact",
  );
});

Deno.test("run-agent rebuilds pending runs from the ledger on every resume", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(RUN.includes("recoverPendingRuns(startedRunRows)"));
  assert(RUN.includes("mergePendingRuns("), "and merges rather than replaces");
  // Scoped to the paying lineage, by the same ownership gate the resume
  // records use. A run may only be adopted by whoever bought it.
  const i = RUN.indexOf("const startedRunRows");
  const block = RUN.slice(i, i + 1400);
  assert(block.includes('.eq("workspace_id", workspace_id)'), "workspace gate");
  assert(block.includes('.eq("task_id", leadResumeParentTaskId)'), "lineage gate");
  assert(block.includes('.eq("status", "started")'), "only unfinished runs");
});
