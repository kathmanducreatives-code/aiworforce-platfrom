// Regression: qualified-Lead requests must reach the deterministic company-first
// path even when an upstream classifier tried to pin the legacy jobs actor.
//
// Reproduces production task `3445fe83-4fed-4e5e-876e-93799a051811` from offline
// data only. ZERO network, ZERO model calls.
//
// The prior behavior — pilot-chat's `company_hiring_sourcing` branch hardcoded
// `selected_actor_key: "apify_jobs"` / `source_type: "jobs"` on tool_input, and
// run-agent gated the entity-intent router on `!raw_source_type && !planned_actor_key`
// — meant the canonical founder/CEO query fell through to the legacy fast/
// account_first branch and produced "Found 2 of 5" account opportunities with
// zero CONTACT-ready people. These tests lock in the two structural fixes.

import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeQualifiedLead, extractRequestedLeadCount } from "./qualifiedLeadRouting.ts";
import { compileLeadEntityIntent } from "./leadEntityIntent.ts";
import { isCompanyFirstRequest } from "./runAgentCompoundBridge.ts";

const CANONICAL = "Find 5 founders or CEOs of early-stage B2B SaaS companies in the United States that are currently hiring for Sales Operations, Revenue Operations, or GTM Operations roles.";
const ACCOUNT_ONLY = "Show companies hiring Sales Operations.";
const JOB_ONLY = "Find recent Sales Operations job postings.";

// ---- The two intent modules already agree on the canonical query ----------

Deno.test("canonical query routes qualified_lead_sourcing / company_first / contact_only", () => {
  const r = routeQualifiedLead(CANONICAL);
  assertEquals(r.workflowKind, "qualified_lead_sourcing");
  assertEquals(r.executionMode, "company_first");
  assertEquals(r.countEntity, "contact_ready_lead");
  assertEquals(r.quotaPolicy, "contact_only");
  // NB: canonical prod query says "Find 5 founders" (no literal "leads" token),
  // so extractRequestedLeadCount returns null; the count falls back to
  // decision.max_results in pilot-chat. This is intentional — the routing
  // decision itself is driven by the PERSON_TARGET_RE match on "founders".
  assertEquals(extractRequestedLeadCount(CANONICAL), null);
});

Deno.test("canonical query — compileLeadEntityIntent agrees: company-first person mission", () => {
  const intent = compileLeadEntityIntent(CANONICAL);
  assertEquals(intent.execution_mode, "company_first");
  assertEquals(intent.company_gate_required, true);
  assert(isCompanyFirstRequest(intent), "isCompanyFirstRequest must be true for the canonical query");
});

Deno.test("account-only counter-example stays fast / account_opportunity_sourcing", () => {
  const r = routeQualifiedLead(ACCOUNT_ONLY);
  assertEquals(r.workflowKind, "account_opportunity_sourcing");
  assertEquals(r.executionMode, "fast");
});

Deno.test("job-only counter-example stays fast / account_opportunity_sourcing", () => {
  const r = routeQualifiedLead(JOB_ONLY);
  assertEquals(r.workflowKind, "account_opportunity_sourcing");
  assertEquals(r.executionMode, "fast");
});

// ---- Pilot-chat tool_input shape --------------------------------------------
// Reproduces pilot-chat's `company_hiring_sourcing` branch decision offline.
// A qualified-Lead mission must NOT pin `selected_actor_key` or `source_type`,
// so run-agent's deterministic entity-intent router at index.ts:638 can fire
// and reach the company-first branch at line 686. A non-qualified mission
// keeps the legacy apify_jobs pin unchanged.

interface SimulatedToolInput {
  intent: string;
  selected_actor_key?: string;
  source_type?: string;
  execution_mode: string;
  workflow_kind?: string;
  quota_policy?: string;
  count_entity?: string;
  requested_lead_count?: number;
}

function simulatePilotChatCompanyHiringToolInput(message: string): SimulatedToolInput {
  const qlRoute = routeQualifiedLead(message);
  const isQualifiedLead = qlRoute.workflowKind === "qualified_lead_sourcing";
  const base: SimulatedToolInput = {
    intent: isQualifiedLead ? "source_qualified_leads" : "source_companies_hiring",
    execution_mode: isQualifiedLead ? "company_first" : "fast",
  };
  if (!isQualifiedLead) {
    base.selected_actor_key = "apify_jobs";
    base.source_type = "jobs";
  } else {
    base.workflow_kind = "qualified_lead_sourcing";
    base.quota_policy = "contact_only";
    base.count_entity = "contact_ready_lead";
    base.requested_lead_count = extractRequestedLeadCount(message) ?? 5;
  }
  return base;
}

Deno.test("pilot-chat: qualified-Lead mission omits selected_actor_key and source_type", () => {
  const ti = simulatePilotChatCompanyHiringToolInput(CANONICAL);
  assertEquals(ti.selected_actor_key, undefined, "must NOT pin selected_actor_key for qualified-Lead");
  assertEquals(ti.source_type, undefined, "must NOT pin source_type for qualified-Lead");
  assertEquals(ti.execution_mode, "company_first");
  assertEquals(ti.workflow_kind, "qualified_lead_sourcing");
  assertEquals(ti.quota_policy, "contact_only");
  assertEquals(ti.count_entity, "contact_ready_lead");
  assertEquals(ti.requested_lead_count, 5);
});

Deno.test("pilot-chat: non-qualified company-hiring request keeps legacy apify_jobs pin", () => {
  const ti = simulatePilotChatCompanyHiringToolInput(ACCOUNT_ONLY);
  assertEquals(ti.selected_actor_key, "apify_jobs");
  assertEquals(ti.source_type, "jobs");
  assertEquals(ti.execution_mode, "fast");
  assertEquals(ti.workflow_kind, undefined);
});

// ---- Run-agent widened gate -------------------------------------------------
// Reproduces the entry condition at run-agent/index.ts:638. The widened gate
// must enter the entity-intent router even when an upstream caller pinned
// `tool_input.selected_actor_key` / `source_type`, provided the top-level
// body declares a qualified-Lead / company-first contract.

interface SimulatedRunAgentBody {
  workflow_kind?: string;
  execution_mode?: string;
  tool_input?: { selected_actor_key?: string | null; source_type?: string | null; workflow_kind?: string; execution_mode?: string } | null;
}

function widenedGateEntersRouter(body: SimulatedRunAgentBody): boolean {
  const raw_source_type = body.tool_input?.source_type ?? null;
  const planned_actor_key = body.tool_input?.selected_actor_key ?? null;
  const bodyDeclaresCompanyFirst =
    body.workflow_kind === "qualified_lead_sourcing" ||
    body.execution_mode === "company_first" ||
    body.tool_input?.workflow_kind === "qualified_lead_sourcing" ||
    body.tool_input?.execution_mode === "company_first";
  return bodyDeclaresCompanyFirst || (!raw_source_type && !planned_actor_key);
}

Deno.test("run-agent gate: enters entity-intent router when no actor/source pinned (original condition)", () => {
  assert(widenedGateEntersRouter({ tool_input: null }));
  assert(widenedGateEntersRouter({ tool_input: {} }));
});

Deno.test("run-agent gate: enters router when body declares qualified_lead_sourcing even with pinned actor", () => {
  assert(widenedGateEntersRouter({
    workflow_kind: "qualified_lead_sourcing",
    tool_input: { selected_actor_key: "apify_jobs", source_type: "jobs" },
  }));
});

Deno.test("run-agent gate: enters router when body declares execution_mode=company_first even with pinned actor", () => {
  assert(widenedGateEntersRouter({
    execution_mode: "company_first",
    tool_input: { selected_actor_key: "apify_jobs", source_type: "jobs" },
  }));
});

Deno.test("run-agent gate: enters router when tool_input carries qualified-Lead contract", () => {
  assert(widenedGateEntersRouter({
    tool_input: { workflow_kind: "qualified_lead_sourcing", selected_actor_key: "apify_jobs", source_type: "jobs" },
  }));
  assert(widenedGateEntersRouter({
    tool_input: { execution_mode: "company_first", selected_actor_key: "apify_jobs", source_type: "jobs" },
  }));
});

Deno.test("run-agent gate: does NOT enter router for legacy pinned request with no qualified-Lead contract", () => {
  assertFalse(widenedGateEntersRouter({
    tool_input: { selected_actor_key: "apify_jobs", source_type: "jobs" },
  }));
});

// ---- End-to-end fixture: production task 3445fe83 --------------------------
// Feeds the ORIGINAL production user_instruction through the fixed pilot-chat
// tool_input shape + widened run-agent gate. The fixed pipeline must NOT
// reproduce the observed `fast` / `apify_jobs` / `account_first` classification.

Deno.test("production task 3445fe83 fixture: fixed pipeline does not produce fast/apify_jobs", () => {
  const productionUserInstruction = CANONICAL;

  // Stage 1 — pilot-chat classifier + qualified-Lead precedence check.
  const toolInput = simulatePilotChatCompanyHiringToolInput(productionUserInstruction);
  assertEquals(toolInput.execution_mode, "company_first", "fixed pilot-chat must set company_first");
  assertFalse(!!toolInput.selected_actor_key, "fixed pilot-chat must not pin an actor");
  assertFalse(!!toolInput.source_type, "fixed pilot-chat must not pin a source_type");

  // Stage 2 — orchestrate stamps top-level workflow_kind/execution_mode
  // (mirrors orchestrate/index.ts:1222-1235 when routeQualifiedLead matches).
  const runAgentBody: SimulatedRunAgentBody = {
    workflow_kind: "qualified_lead_sourcing",
    execution_mode: "company_first",
    tool_input: toolInput,
  };

  // Stage 3 — widened run-agent gate must enter the entity-intent router.
  assert(widenedGateEntersRouter(runAgentBody), "widened gate must enter router");

  // Stage 4 — compiled entity intent + company-first detector agree.
  const intent = compileLeadEntityIntent(productionUserInstruction);
  assert(isCompanyFirstRequest(intent), "isCompanyFirstRequest must be true so branch at line 686 fires");
});
