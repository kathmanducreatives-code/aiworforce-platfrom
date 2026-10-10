// RECENT ACTIVITY — the mapping from stored rows to timeline lines.
//
// Rows are shaped like real production rows (event types, metadata keys and
// legacy titles as run-agent / orchestrate / run-monitoring-scan write them).
// PURE: no DOM, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  acceptRow, buildActivityFeed, enrichmentNeeds, fromActivity, mergeRows, plainReason, EMPTY_ENRICHMENT,
  type ActivityRow, type Enrichment, type FailedTaskRow, type SignalRow,
} from "../../src/lib/activity/activityFeedModel.ts";

const WS = "ws-a";
const OTHER = "ws-b";
const t = (min: number) => new Date(Date.parse("2026-10-09T12:00:00Z") - min * 60_000).toISOString();

let n = 0;
const act = (over: Partial<ActivityRow>): ActivityRow => ({
  id: `a${++n}`, workspace_id: WS, agent_id: null, event_type: "plan_created", title: null, body: null,
  metadata: {}, plan_id: null, task_plan_id: null, created_at: t(0), ...over,
});
const sig = (over: Partial<SignalRow>): SignalRow => ({
  id: `s${++n}`, workspace_id: WS, signal_type: "sales_hiring", created_at: t(0), verification_status: "provider_verified",
  lifecycle_status: "active", title: "Acme is hiring its first VP of Sales", company: "Acme", ...over,
});
const enr: Enrichment = {
  agentSlugs: { "agent-scout": "scout", "agent-scribe": "scribe", "agent-penn": "penn" },
  tasks: { "task-1": { id: "task-1", status: "complete", terminal: "budget_exhausted", discovered: 48, relevant: 9 } },
  plans: { "plan-1": "Find 5 US AI SaaS companies with 11–50 employees" },
};
const build = (p: Partial<Parameters<typeof buildActivityFeed>[0]>) =>
  buildActivityFeed({ workspaceId: WS, activity: [], signals: [], drafts: [], failedTasks: [], enrichment: enr, limit: 20, ...p });

Deno.test("a completed workflow speaks with the public name, the request and the real outcome", () => {
  const item = fromActivity(act({ event_type: "plan_complete", agent_id: "agent-scout", plan_id: "plan-1", title: "Plan complete", metadata: { task_id: "task-1", workflow_status: "complete" } }), enr)!;
  assertEquals(item.agent, "lyra");
  assertEquals(item.action, "Lyra completed a search");
  assertEquals(item.detail, "Find 5 US AI SaaS companies with 11–50 employees");
  assertEquals(item.outcome, "48 companies found · 9 relevant · Stopped at the run budget");
  assertEquals(item.route, "/plans/plan-1");
  assertEquals(item.tone, "success");
});

Deno.test("legacy names and raw titles never reach the screen", () => {
  const rows = [
    act({ event_type: "plan_checkpointed", agent_id: "agent-scout", title: "Round complete — more rounds available", metadata: { workflow_status: "partial" } }),
    act({ event_type: "plan_complete", agent_id: "agent-scribe", title: "Plan complete", metadata: { workflow_status: "complete" } }),
  ];
  const text = JSON.stringify(build({ activity: rows }));
  for (const legacy of ["Scout", "Scribe", "Aria", "Penn", "Hawk"]) assertFalse(text.includes(legacy), legacy);
  assert(text.includes("Lyra finished a round"));
  assert(text.includes("Orion finished a draft"));
});

Deno.test("each supported event type maps to the right kind", () => {
  const kinds = (rows: ActivityRow[]) => build({ activity: rows }).map((i) => i.kind);
  assertEquals(kinds([act({ event_type: "plan_created", plan_id: "plan-1" })]), ["plan_created"]);
  assertEquals(kinds([act({ event_type: "awaiting_approval", agent_id: "agent-penn" })]), ["approval_requested"]);
  assertEquals(kinds([act({ event_type: "approved", agent_id: "agent-penn" })]), ["approved"]);
  assertEquals(kinds([act({ event_type: "plan_failed", body: "run_agent_kickoff failed" })]), ["execution_failed"]);
  assertEquals(kinds([act({ event_type: "onboarding_completed", body: "Acme" })]), ["setup_completed"]);
  assertEquals(build({ signals: [sig({})] })[0].action, "Lyra discovered a sales hiring signal");
  assertEquals(build({ drafts: [{ id: "d1", workspace_id: WS, channel: "linkedin_dm", subject: "Congrats on the round", status: "draft", created_at: t(0) }] })[0].action, "Mira prepared a LinkedIn message");
  const sigAction = (signal_type: string) => build({ signals: [{ id: "s9", workspace_id: WS, signal_type, created_at: t(0), verification_status: "unverified", lifecycle_status: "active", title: "X", company: null }] })[0].action;
  assertEquals(sigAction("revops_hiring"), "Lyra discovered a RevOps hiring signal");
  assertEquals(sigAction("founder_pipeline_post"), "Lyra discovered a founder signal");
  assertEquals(sigAction("some_new_type"), "Lyra discovered a some new type signal");
  assertEquals(sigAction("outbound_initiative"), "Lyra discovered an outbound signal");
  assertEquals(build({ drafts: [{ id: "d4", workspace_id: WS, channel: "email", subject: "Hi", status: "sent", created_at: t(0) }] })[0].action, "Mira prepared an email draft");
  assertEquals(build({ drafts: [{ id: "d5", workspace_id: WS, channel: "email", subject: "Hi", status: "sent", created_at: t(0) }] })[0].outcome, "Sent");
});

Deno.test("plumbing is not activity: tool_used, agent_started and in-plan tool errors are dropped", () => {
  const rows = [
    act({ event_type: "tool_used", agent_id: "agent-scout" }),
    act({ event_type: "agent_started", agent_id: "agent-scout", title: "Scout started" }),
    act({ event_type: "ai_provider_call" }),
    act({ event_type: "tool_failed", agent_id: "agent-scout", plan_id: "plan-1", body: "apify failed: apify_run_running" }),
  ];
  assertEquals(build({ activity: rows }), []);
});

Deno.test("the scheduled signal monitor is Lyra's — the one documented attribution", () => {
  const [item] = build({ activity: [act({ event_type: "tool_failed", title: "Signals Monitor could not use source_with_apify", body: "apify is not configured. apify_unauthorized" })] });
  assertEquals(item.agent, "lyra");
  assertEquals(item.action, "Lyra's signal monitor couldn't run");
  // The provider name and the error code never reach the screen; the cause does.
  assertEquals(item.outcome, "A connected tool needs attention in Integrations");
  // Any other agent-less tool error has no honest owner and is dropped.
  assertEquals(build({ activity: [act({ event_type: "tool_failed", title: "Mystery job could not use x" })] }), []);
});

// Failure text on these rows is the backend's own — provider names, statuses,
// stack fragments. It is never printed: a known cause becomes one plain
// sentence, anything else shows no reason (the line still says who failed).
Deno.test("failure reasons: known causes in plain words, internal text never shown", () => {
  assertEquals(plainReason("apify is not configured. apify_unauthorized"), "A connected tool needs attention in Integrations");
  assertEquals(plainReason("HTTP 401: Invalid JWT"), "A connected tool needs attention in Integrations");
  assertEquals(plainReason("firecrawl 429 Too Many Requests"), "Hit a usage limit — it will try again later");
  assertEquals(plainReason("deadline exceeded after 300000ms"), "Took too long and stopped");
  assertEquals(plainReason("run_agent_kickoff failed"), null);
  assertEquals(plainReason("TypeError: Cannot read properties of undefined (reading 'funnel') at run-agent/index.ts:5148"), null);
  assertEquals(plainReason('{"code":"PGRST116","details":"The result contains 0 rows"}'), null);
  assertEquals(plainReason(null), null);

  const failed: FailedTaskRow = {
    id: "task-x", workspace_id: WS, agent_slug: "scout", status: "failed", updated_at: t(0),
    error_message: "apify_input_schema_error: field 'companyUrls' is not allowed (actor harvestapi/linkedin-company)",
    plan_id: null, task_plan_id: null, terminal: null,
  };
  const [item] = build({ failedTasks: [failed] });
  assertEquals(item.kind, "execution_failed");
  assertEquals(item.outcome, null, "no internal detail on the line");
  for (const leaked of ["apify", "harvestapi", "companyUrls", "schema"]) {
    assertFalse(JSON.stringify(item).includes(leaked), `leaked "${leaked}": ${JSON.stringify(item)}`);
  }
  // A curated end state is preferred over the raw message.
  const [stopped] = build({ failedTasks: [{ ...failed, terminal: "budget_exhausted" }] });
  assertEquals(stopped.outcome, "Stopped at the run budget");
});

Deno.test("workspace isolation: another workspace's rows never render", () => {
  const items = build({
    activity: [act({ event_type: "plan_created", workspace_id: OTHER }), act({ event_type: "onboarding_completed", workspace_id: WS, body: "Ours" })],
    signals: [sig({ workspace_id: OTHER, title: "Their secret signal" })],
    drafts: [{ id: "d2", workspace_id: OTHER, channel: "email", subject: "Theirs", status: "draft", created_at: t(0) }],
    failedTasks: [{ id: "x", workspace_id: OTHER, agent_slug: "scout", status: "failed", updated_at: t(0), error_message: "boom", plan_id: null, task_plan_id: null, terminal: null }],
  });
  assertEquals(items.map((i) => i.detail), ["Ours"]);
  assertFalse(acceptRow({ id: "1", workspace_id: OTHER }, WS));
  assertFalse(acceptRow({ id: "1", workspace_id: WS }, null), "no workspace, no rows");
});

Deno.test("newest first across every source", () => {
  const items = build({
    activity: [act({ event_type: "onboarding_completed", body: "Old", created_at: t(90) })],
    signals: [sig({ created_at: t(5) })],
    drafts: [{ id: "d3", workspace_id: WS, channel: "email", subject: "Mid", status: "draft", created_at: t(40) }],
  });
  assertEquals(items.map((i) => i.kind), ["signal_discovered", "draft_prepared", "setup_completed"]);
});

Deno.test("dedupe: the same row twice is one line; a failed task an activity row reports is not repeated", () => {
  const row = act({ event_type: "plan_complete", agent_id: "agent-scout", metadata: { task_id: "task-9", workflow_status: "failed" }, body: "no qualified matches" });
  const failed: FailedTaskRow = { id: "task-9", workspace_id: WS, agent_slug: "scout", status: "failed", updated_at: t(0), error_message: "x", plan_id: null, task_plan_id: null, terminal: null };
  const items = build({ activity: [row, row], failedTasks: [failed] });
  assertEquals(items.length, 1);
  assertEquals(items[0].action, "Lyra's workflow didn't finish");
  assertEquals(mergeRows([{ id: "1" }, { id: "2" }], [{ id: "2" }, { id: "3" }]).map((r) => r.id), ["2", "3", "1"]);
});

Deno.test("repeats close together collapse; far apart they stay separate", () => {
  const burst = [sig({ created_at: t(1) }), sig({ created_at: t(2), title: "Beta raised a Seed" }), sig({ created_at: t(3), title: "Gamma opened an SDR role" })];
  const [one] = build({ signals: burst });
  assertEquals(one.count, 3);
  assertEquals(one.action, "Lyra discovered 3 signals");
  assertEquals(one.detail, "Acme is hiring its first VP of Sales", "the newest speaks for the run");
  assertEquals(build({ signals: [sig({ created_at: t(1) }), sig({ created_at: t(200) })] }).length, 2);

  const monitor = (min: number) => act({ event_type: "tool_failed", title: "Signals Monitor could not use source_with_apify", body: "apify is not configured. apify_unauthorized", created_at: t(min) });
  assertEquals(build({ activity: [monitor(0), monitor(5)] })[0].count, 2);
  assertEquals(build({ activity: [monitor(0), monitor(60 * 24)] }).length, 2, "a daily repeat is still a separate day");
});

Deno.test("empty: no rows, no lines — and nothing is invented to fill the space", () => {
  assertEquals(build({}), []);
  assertEquals(buildActivityFeed({ workspaceId: WS, activity: [], signals: [], drafts: [], failedTasks: [], enrichment: EMPTY_ENRICHMENT }), []);
  // A signal with neither a title nor a company has nothing honest to say.
  assertEquals(build({ signals: [sig({ title: null, company: null })] }), []);
  // An archived signal is not news.
  assertEquals(build({ signals: [sig({ lifecycle_status: "archived" })] }), []);
});

Deno.test("only what is missing is looked up", () => {
  const rows = [
    act({ event_type: "plan_complete", plan_id: "plan-1", metadata: { task_id: "task-1" } }),
    act({ event_type: "plan_complete", plan_id: "plan-2", metadata: { task_id: "task-2" } }),
  ];
  assertEquals(enrichmentNeeds(rows, enr), { taskIds: ["task-2"], planIds: ["plan-2"] });
});

Deno.test("the limit caps the timeline after collapsing", () => {
  const many = Array.from({ length: 10 }, (_, i) => act({ event_type: "onboarding_completed", body: `Co ${i}`, created_at: t(i * 60) }));
  assertEquals(build({ activity: many, limit: 4 }).length, 4);
});

Deno.test("verification is read exactly: 'unverified' is never shown as Verified", () => {
  const outcome = (v: string | null) => build({ signals: [sig({ verification_status: v })] })[0].outcome;
  assertEquals(outcome("provider_verified"), "Verified");
  assertEquals(outcome("verified"), "Verified");
  assertEquals(outcome("unverified"), "Needs review");
  assertEquals(outcome("not_verified"), "Needs review");
  assertEquals(outcome(null), "Needs review");
});

Deno.test("real terminal statuses read as plain words", () => {
  const f = (terminal: string): FailedTaskRow => ({ id: `t-${terminal}`, workspace_id: WS, agent_slug: "scout", status: "failed", updated_at: t(0), error_message: null, plan_id: null, task_plan_id: null, terminal });
  assertEquals(build({ failedTasks: [f("continuation_attempts_exhausted")] })[0].outcome, "Stopped at its continuation limit");
  assertEquals(build({ failedTasks: [f("retry_budget_exhausted")] })[0].outcome, "Ran out of retries");
  assertEquals(build({ failedTasks: [f("some_new_status")] })[0].outcome, "some new status", "an unknown status is shown plainly, never hidden");
  // Only a bare code is read as words; free text in that field is not printed.
  assertEquals(build({ failedTasks: [f("HTTP 500 from https://api.example/internal?id=123")] })[0].outcome, null);
});
