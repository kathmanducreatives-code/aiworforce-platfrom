// THE PERSISTED PLAN CONTRACT IS THE MISSION'S.
//
// `planQualifiedLeadBeforePersistence` is the one lead-planning call site, and
// the contract it persists is the record run-agent executes and the plan row
// shows. Every semantic field in it came from `compileLeadEntityIntent(
// userInstruction)` — a SECOND reading of the sentence, made in orchestrate,
// after pilot-chat had compiled a Mission from the same words and threaded it
// into this very function. The count, the persona, the vertical, the stage and
// the employer requirement could all differ from what the Mission recorded, and
// the plan would then be planned, persisted and executed against the difference.
//
// The gate had the same shape: `routeQualifiedLead(userInstruction)` re-decided
// whether this was a qualified-lead mission at all.
//
// Offline. Both model seams are stubs; no gateway, no provider, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planQualifiedLeadBeforePersistence,
} from "../../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts";
import {
  LEAD_MISSION_VERSION, type LeadMissionV1,
} from "../../../supabase/functions/_shared/leadMission.ts";

const WORKSPACE = "00000000-0000-0000-0000-000000000001";

/** A sentence whose every semantic differs from the Mission threaded beside it. */
const CONTRADICTING_INSTRUCTION =
  "Find 30 founders at seed-stage fintech companies in London currently hiring SDRs";

const admin = { from() { throw new Error("no database in this test"); } } as never;

function mission(over: Partial<LeadMissionV1> = {}): LeadMissionV1 {
  return {
    version: LEAD_MISSION_VERSION,
    original_user_query: CONTRADICTING_INSTRUCTION,
    mission_type: "qualified_lead_sourcing",
    target_entity: "person",
    requested_output: "contact_ready_leads",
    requested_count: 7,
    company_profile: {
      business_models: [], verticals: ["b2b saas"], stages: ["growth_stage"],
      locations: ["United States"],
    },
    required_signals: [{ type: "hiring", role_families: ["rev_ops"] }],
    required_signal_terms: ["RevOps"],
    decision_makers: { roles: ["Head of Talent"], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    field_provenance: {}, confidence: 0.9,
    ...over,
  } as LeadMissionV1;
}

/** Run the call site with the GPT adapter enabled and its model stubbed out. */
async function plan(leadMission: LeadMissionV1 | null) {
  const env: Record<string, string> = {
    SUPABASE_PROJECT_ID: "zbwsbnqqpkvdhqwavjke",
    GPT_LEAD_STRATEGY: "true",
    GPT_LEAD_STRATEGY_WORKSPACES: WORKSPACE,
  };
  return await planQualifiedLeadBeforePersistence({
    admin,
    workspaceId: WORKSPACE,
    userInstruction: CONTRADICTING_INSTRUCTION,
    leadMission,
    readEnv: (k) => env[k],
    // A rejected proposal keeps the deterministic contract, which is exactly the
    // object under test: the planner may not restate it either way.
    callModel: () =>
      Promise.resolve({ ok: false, errorCode: "stubbed", provider: "test", latencyMs: 1 } as never),
    generate: () =>
      Promise.resolve({ ok: false, error: "stubbed", provider: "test", latencyMs: 1 } as never),
  });
}

Deno.test("the plan contract follows the Mission, not the sentence beside it", async () => {
  const outcome = await plan(mission());
  assert(outcome, "a qualified-lead mission must still be planned");
  const c = outcome.artifact.contract;

  assertEquals(c.requestedCount, 7, "the sentence says 30; the Mission says 7");
  assertEquals(c.decisionMakerRoles, ["Head of Talent"], "the sentence says founders");
  assertEquals(c.companyStage, "growth_stage", "the sentence says seed-stage");
  assertEquals(c.geography, "United States", "the sentence says London");
  assertEquals(c.currentEmployerRequired, false, "the Mission said the employer need not be current");
  assertEquals(c.companyVertical, "b2b_saas", "the sentence says fintech");
});

Deno.test("a null count on the Mission lands on the one default, not on the sentence's number", async () => {
  const outcome = await plan(mission({ requested_count: null }));
  assert(outcome);
  assertEquals(
    outcome.artifact.contract.requestedCount, 5,
    "'Find 30 founders' must not become the quota through this path",
  );
});

Deno.test("the Mission decides whether this is a qualified-lead mission at all", async () => {
  // The sentence is full of qualified-lead phrasing ("Find 30 founders …"), and
  // `routeQualifiedLead` classifies it as one. The Mission says the user asked
  // for job listings, so no lead plan is produced.
  const declined = await plan(mission({
    target_entity: "job", requested_output: "job_listings",
    mission_type: "job_research",
  }));
  assertEquals(declined, null, "the phrase table may not overrule the Mission's own answer");
});

Deno.test("with no Mission the phrase-table router still answers — the legacy path is intact", async () => {
  const outcome = await plan(null);
  assert(outcome, "a missionless deterministic workspace still plans as before");
  assertEquals(
    outcome.artifact.contract.requestedCount, 30,
    "and there the compiled intent's reading of the sentence is the only answer there is",
  );
});

// ───────────────────────── structural: one reader ────────────────────────────

const SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("every semantic contract field names the Mission as its source", () => {
  const i = SRC.indexOf("const contract: QualifiedLeadPlanContract = {");
  assert(i > 0, "the contract must still be built here");
  const block = SRC.slice(i, SRC.indexOf("};", i));
  for (const field of ["requestedCount", "companyVertical", "companyStage", "currentEmployerRequired"]) {
    const line = block.split("\n").find((l) => l.trim().startsWith(`${field}:`));
    assert(line, `${field} must still be on the contract`);
  }
  assert(
    block.includes("effectiveRequestedCount(mission)"),
    "the count must come from the Mission through the one runtime default",
  );
  assert(
    !/requestedCount:\s*intent\.requested_count\s*\?\?\s*5/.test(block),
    "the compiled intent's regex count may not be the primary source",
  );
});

Deno.test("orchestrate's kickoff route is projected from the Mission too", () => {
  const ORCH = Deno.readTextFileSync(
    new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert(
    /qlRoute = missionForRouting\s*\n?\s*\?\s*qualifiedLeadRouteFromMission\(missionForRouting\)/.test(ORCH),
    "the kickoff's workflow_kind / count_entity / quota_policy must follow the Mission",
  );
});
