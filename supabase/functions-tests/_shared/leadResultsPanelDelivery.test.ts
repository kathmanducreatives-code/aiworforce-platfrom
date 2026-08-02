// THE WORKBENCH OPENS FROM A PERSISTED MESSAGE, NOT AN HTTP RESPONSE.
//
// The company-first branch built a correct `ui_panel` and returned it inside
// `return json(...)`. orchestrate calls run-agent fire-and-forget, so nothing
// read that body and no message carrying the panel was ever written. Two
// user-visible failures followed from the one omission:
//
//   * ChatView auto-opens the Workbench off a MESSAGE whose
//     `metadata.ui_panel.kind === "lead_results"` — so it never opened.
//   * WorkbenchPanel.renderTable() renders <LeadResultsView> (the qualified-lead
//     table) only when that panel is present; otherwise it falls through to
//     <AgentOutputViewer>, which is why production showed raw Indeed job cards
//     with Save Lead / Enrich / Draft Outreach.
//
// Production plan 43fb7313-138e-4496-83de-92c3e0b7392f: three messages, none
// with a `ui_panel`.
//
// These tests pin the CONTRACT the delivery must satisfy. They are deliberately
// storage-shaped rather than importing run-agent, which is a Deno.serve entry
// point that cannot be imported in a unit test.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";

/** The auto-open contract ChatView keys on. */
const PANEL_KIND = "lead_results";

interface StoredMessage {
  conversation_id: string;
  role: string;
  content: string;
  agent_slug?: string;
  metadata: Record<string, unknown>;
}

/**
 * The minimum a delivery must do, mirroring `persistLeadResultsPanel`:
 * find the conversation, refuse to write a second panel, otherwise insert one.
 */
function deliverPanel(
  store: StoredMessage[],
  planId: string | null,
  uiPanel: Record<string, unknown>,
  summary: { eligible: number; requested: number; rawJobs: number; terminalStatus: string },
): void {
  if (!planId) return;
  const planMsg = store.find((m) => m.metadata.plan_id === planId);
  if (!planMsg) return;
  const already = store.some(
    (m) => m.metadata.plan_id === planId
      && (m.metadata.ui_panel as { kind?: string } | undefined)?.kind === PANEL_KIND,
  );
  if (already) return;

  const delivered = `${summary.eligible} of ${summary.requested} CONTACT-ready ${summary.requested === 1 ? "lead" : "leads"}`;
  store.push({
    conversation_id: planMsg.conversation_id,
    role: "assistant",
    agent_slug: "pilot",
    content: summary.eligible > 0
      ? `I opened the results in Workbench — ${delivered}. Reviewed ${summary.rawJobs} raw jobs to get there. Nothing was sent.`
      : `I opened the results in Workbench — ${delivered}. I reviewed ${summary.rawJobs} raw jobs and none produced a contact-ready lead yet. Nothing was sent.`,
    metadata: {
      ui_panel: uiPanel, plan_id: planId, agent_id: "pilot",
      workflow_kind: "qualified_lead_sourcing", terminal_status: summary.terminalStatus,
      raw_jobs_reviewed: summary.rawJobs,
      contact_ready_leads: summary.eligible,
      requested_leads: summary.requested,
    },
  });
}

const PLAN = "43fb7313-138e-4496-83de-92c3e0b7392f";

function panel(eligible: number, requested = 5) {
  return {
    kind: PANEL_KIND, title: "Qualified lead sourcing",
    subtitle: `${eligible} of ${requested} CONTACT-ready leads`,
    source_type: "hiring_signal", plan_id: PLAN,
    lead_count: eligible, enrichable_count: 0, lead_candidate_ids: [], actions: [],
  };
}

/** A conversation that already carries the execution-plan message. */
function conversation(): StoredMessage[] {
  return [{
    conversation_id: "conv-1", role: "assistant", content: "I created a 4-step plan…",
    metadata: { type: "execution_plan", plan_id: PLAN },
  }];
}

const opened = (s: StoredMessage[]) =>
  s.filter((m) => (m.metadata.ui_panel as { kind?: string } | undefined)?.kind === PANEL_KIND);

// ============================================ 6./7./8. the panel is persisted ==

Deno.test("6./13. a zero-lead partial still opens the Workbench", () => {
  // Production's exact outcome: 25 raw rows, nothing contact-ready.
  const store = conversation();
  deliverPanel(store, PLAN, panel(0), { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" });

  assertEquals(opened(store).length, 1);
  const m = opened(store)[0];
  assertEquals((m.metadata.ui_panel as Record<string, unknown>).kind, PANEL_KIND);
  assertEquals(m.metadata.contact_ready_leads, 0);
  assertEquals(m.metadata.requested_leads, 5);
  // Raw volume is recorded as EVIDENCE, never as the lead count.
  assertEquals(m.metadata.raw_jobs_reviewed, 25);
  assertFalse(m.content.includes("25 results"));
  assert(m.content.includes("0 of 5 CONTACT-ready leads"), m.content);
});

Deno.test("7. a partial/continuation result persists the panel", () => {
  const store = conversation();
  deliverPanel(store, PLAN, panel(2), { eligible: 2, requested: 5, rawJobs: 40, terminalStatus: "continuation_required" });
  const m = opened(store)[0];
  assertEquals(m.metadata.terminal_status, "continuation_required");
  assert(m.content.includes("2 of 5 CONTACT-ready leads"));
});

Deno.test("8./12. a completed result persists the panel too", () => {
  const store = conversation();
  deliverPanel(store, PLAN, panel(5), { eligible: 5, requested: 5, rawJobs: 60, terminalStatus: "completed" });
  assertEquals(opened(store).length, 1);
  assert(opened(store)[0].content.includes("5 of 5 CONTACT-ready leads"));
});

Deno.test("9./14. an idempotent retry does not insert a duplicate panel message", () => {
  const store = conversation();
  const s = { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" };
  deliverPanel(store, PLAN, panel(0), s);
  deliverPanel(store, PLAN, panel(0), s);   // retried invocation
  deliverPanel(store, PLAN, panel(0), s);   // continuation re-finalising the plan
  assertEquals(opened(store).length, 1, "one panel per plan, however many attempts");
});

Deno.test("a plan with no conversation writes nothing rather than guessing", () => {
  const orphan: StoredMessage[] = [];
  deliverPanel(orphan, PLAN, panel(0), { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" });
  assertEquals(orphan.length, 0);
  const noPlan = conversation();
  deliverPanel(noPlan, null, panel(0), { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" });
  assertEquals(opened(noPlan).length, 0);
});

// ------------------------------------------------ 15./17. counts stay apart ---

Deno.test("15./17. raw, requested and CONTACT-ready counts are separate fields", () => {
  const store = conversation();
  deliverPanel(store, PLAN, panel(0), { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" });
  const md = opened(store)[0].metadata;

  // Three distinct numbers, none standing in for another.
  assertEquals(md.raw_jobs_reviewed, 25);
  assertEquals(md.contact_ready_leads, 0);
  assertEquals(md.requested_leads, 5);
  // The panel's own count is the QUOTA count, not the row count.
  assertEquals((md.ui_panel as Record<string, unknown>).lead_count, 0);
  assertFalse((md.ui_panel as Record<string, unknown>).lead_count === 25);
});

Deno.test("the panel carries no provider payload, credential or raw row", () => {
  const store = conversation();
  deliverPanel(store, PLAN, panel(0), { eligible: 0, requested: 5, rawJobs: 25, terminalStatus: "search_exhausted" });
  const blob = JSON.stringify(opened(store)[0]).toLowerCase();
  for (const forbidden of ["apify_api_token", "bearer ", "job_description", "provider_payload", "input_url"]) {
    assertFalse(blob.includes(forbidden), `"${forbidden}" leaked into the panel message`);
  }
});
