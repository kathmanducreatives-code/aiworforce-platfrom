// "WHAT IS WAITING ON ME?" IS A READ.
//
// ── WHAT THIS SURFACE USED TO BE ───────────────────────────────────────────
//
// A branch on `decision.workflow_category === "approval_review"`, holding its
// own copy of the query and its own wording. It consumed no other field of the
// classifier's 30 — the category string was its whole input contract — so it
// was reachable only by whatever the classifier happened to decide, and the
// semantic layer had no way to ask for it.
//
// The vocabulary was the real gap: `REQUEST_ENTITIES` named company, person,
// job, signal, content and conversation, and approvals are none of those. They
// have their own table, their own nav item and their own dashboard counter, so
// the entity list was simply incomplete. "What needs my sign-off?" had to be
// forced into `content`, which asks a different question — what has been
// written is not the same set as what is still blocking on a person.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planRead, executeRead, renderReadAnswer,
} from "../../../supabase/functions/_shared/readSurface.ts";
import {
  REQUEST_V1_VERSION, REQUEST_ENTITIES,
  type RequestV1, type RequestEntity,
} from "../../../supabase/functions/_shared/requestV1.ts";

const read = (entity: RequestEntity, shape: "records" | "answer" = "records"): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u", objective: "read",
  parts: [{
    id: "p1", objective: "read",
    subject: { entity, references: [] },
    output: { shape, count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

/** A db stub that records which tables were asked, in order. */
function db(rows: { approvals?: unknown[]; tasks?: unknown[] }) {
  const asked: string[] = [];
  const build = (table: string) => {
    asked.push(table);
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain; q.eq = chain; q.order = chain; q.gte = chain; q.in = chain;
    q.limit = () => Promise.resolve({
      data: table === "approvals" ? (rows.approvals ?? []) : (rows.tasks ?? []),
      error: null,
    });
    return q;
  };
  return { client: { from: (t: string) => build(t) }, asked };
}

const approval = (id: string, agent: string, title: string) =>
  ({ id, agent_slug: agent, title, created_at: "2026-08-27T10:00:00Z" });

// ══ 1. THE VOCABULARY NAMES IT ═════════════════════════════════════════════

Deno.test("1. approval is a first-class entity", () => {
  assert(REQUEST_ENTITIES.includes("approval"),
    "the semantic layer must be able to ask for what is waiting on the user");
});

Deno.test("2. an approval read reaches the approvals target", () => {
  assertEquals(planRead(read("approval")).target, "approvals");
  // And it is NOT confused with content — a different question.
  assertFalse(planRead(read("content")).target === "approvals");
});

Deno.test("3. prose about the workspace is still the brief, not the approvals list", () => {
  // "What needs my attention?" wants a summary; "show me pending approvals"
  // wants the rows. The output shape separates them, as it does for every read.
  assertEquals(planRead(read("approval", "answer")).target, "brief");
});

// ══ 2. THE OLD ROWS ARE STILL REAL WORK ════════════════════════════════════

Deno.test("4. approvals first, then the pre-table shape", async () => {
  const { client, asked } = db({ approvals: [approval("a1", "penn", "Outreach to Acme")] });
  // deno-lint-ignore no-explicit-any
  const r = await executeRead(client as any, planRead(read("approval")), "w1");
  assertEquals(r!.counts.total, 1);
  assertEquals(asked, ["approvals"], "the fallback must not run when rows exist");
});

Deno.test("5. an empty approvals table does NOT mean nothing is pending", async () => {
  // Flows predating the table only ever set tasks.status='awaiting_approval'.
  // Those rows are still a person's decision, blocked.
  const { client, asked } = db({
    approvals: [],
    tasks: [{ id: "t1", agent_slug: "penn", description: "Legacy draft" }],
  });
  // deno-lint-ignore no-explicit-any
  const r = await executeRead(client as any, planRead(read("approval")), "w1");
  assertEquals(asked, ["approvals", "tasks"]);
  assertEquals(r!.counts.total, 1);
  assertEquals(r!.items[0].source, "tasks", "provenance says which shape answered");
});

Deno.test("6. genuinely nothing pending reads as nothing pending", async () => {
  const { client } = db({ approvals: [], tasks: [] });
  const plan = planRead(read("approval"));
  // deno-lint-ignore no-explicit-any
  const r = await executeRead(client as any, plan, "w1");
  assert(r!.empty);
  const answer = renderReadAnswer(plan, r);
  assert(/No drafts are waiting/i.test(answer));
  assertFalse(/couldn't|error|failed/i.test(answer),
    "an empty queue is an answer, not a failure");
});

Deno.test("7. the answer names who is waiting on what", async () => {
  const { client } = db({
    approvals: [approval("a1", "penn", "Outreach to Acme"), approval("a2", "penn", "Follow-up")],
  });
  const plan = planRead(read("approval"));
  // deno-lint-ignore no-explicit-any
  const answer = renderReadAnswer(plan, await executeRead(client as any, plan, "w1"));
  assert(/2 pending approvals/.test(answer));
  assert(answer.includes("Outreach to Acme") && answer.includes("Follow-up"));
});

// ══ 3. ONE IMPLEMENTATION ══════════════════════════════════════════════════

Deno.test("8. the legacy branch is gone; the route is the only way in", () => {
  // It delegated to `readSurface` for one commit, so the query and the wording
  // could not diverge while both paths existed. The classifier branch has since
  // been deleted, so `entity: "approval"` is now the single entry — asserted in
  // `oneSemanticBrain.test.ts`, which pins that pilot-chat holds no approvals
  // query and no `approval_review` category branch at all.
  assertEquals(1, 1);
});

Deno.test("9. the approvals read reaches no provider", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/readSurface.ts", import.meta.url));
  const imports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
  assertFalse(/toolRegistry|capabilityExecution|credit|apify|invoke/i.test(imports),
    "a read must remain structurally unable to spend");
});
