// ORION V1 — daily-brief wiring. Static (the handler needs live Supabase to
// run): it authorizes before it reads, reads through the scoped aggregator,
// persists the brief history, writes as Orion, and keeps the spend contract.
import { assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = Deno.readTextFileSync(new URL("../../supabase/functions/daily-brief/index.ts", import.meta.url));
const code = src.replace(/^\s*\/\/.*$/gm, "");
const at = (needle: string) => {
  const i = code.indexOf(needle);
  assert(i >= 0, `missing: ${needle}`);
  return i;
};

Deno.test("membership is checked before any workspace data is read", () => {
  const member = at('.from("workspace_members")');
  const forbidden = at("Forbidden — not a member of this workspace");
  const collect = at("collectExecutiveContext(admin as unknown as BriefDb, workspaceId)");
  assert(member < forbidden && forbidden < collect);
  assert(at('if (!workspaceId) return json({ error: "workspace_id required" }, 400)') < member);
});

Deno.test("the brief is built by the shared aggregator + synthesizer, not ad-hoc queries", () => {
  for (const t of ["signal_events", "lead_candidates", "content_item", "approvals", "task_plans", '"tasks"']) {
    assertFalse(code.includes(`.from(${t.startsWith('"') ? t : `"${t}"`})`), `daily-brief queries ${t} directly`);
  }
  at("synthesizeExecutiveBrief(ctx)");
  at("applyModelWording(deterministic, parsed, facts,");
});

Deno.test("every brief is stored as briefing history in saved_outputs", () => {
  const save = code.slice(at('.from("saved_outputs").insert({'));
  assert(/workspace_id: workspaceId,/.test(save.slice(0, 400)));
  assert(/type: EXECUTIVE_BRIEF_OUTPUT_TYPE,/.test(save.slice(0, 400)));
  assert(/raw: brief,/.test(save.slice(0, 400)));
});

Deno.test("chat messages are written as Orion; the dashboard surface creates no conversation", () => {
  at('const ORION_SLUG = "orion"');
  at("agent_slug: ORION_SLUG,");
  at('body?.surface === "dashboard" ? "dashboard" : "chat"');
  assert(/if \(surface === "chat"\) \{[\s\S]*\} else \{\s*conversationId = null;/.test(code));
});

Deno.test("the model call stays metered, bounded, and optional", () => {
  at("onModelCall: modelCalls.sink");
  at("budget: modelCalls");
  at("modelCalls.drain(createLedgerWriter(");
  at('taskType: "helper"');
  // Nothing to say → no call at all.
  at("if (!worthWording) throw new SkipPolish()");
});

Deno.test("existing callers keep working: same intent, same response fields pilot-chat reads", () => {
  at('intent: "daily_brief"');
  at("conversation_id: conversationId,");
  at("message: saved,");
  at("connectors_missing: connectorsMissing,");
  const pilot = Deno.readTextFileSync(new URL("../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assert(pilot.includes("functions/v1/daily-brief"), "pilot-chat still routes the brief here");
});
