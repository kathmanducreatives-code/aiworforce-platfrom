// ORION V1 — the synthesis: priorities, evidence, dedupe, empty/partial data,
// Company Brain use, and the model-wording guard. Pure; fictional fixtures.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyModelWording, type BrainSnapshot, type ExecItem, type ExecutiveContext, MAX_PRIORITIES,
  modelFacts, renderExecutiveBriefMarkdown, synthesizeExecutiveBrief,
} from "../../../supabase/functions/_shared/executiveBrief.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-07T08:00:00.000Z";

const BRAIN: BrainSnapshot = {
  usable: true, company: "Northwind Robotics", description: "Warehouse robots", icp: "Logistics companies, 50–500 employees",
  industries: ["logistics"], competitors: ["Acme Bots"], goal: "Book 10 demos", missing: [],
};

function item(p: Partial<ExecItem> & Pick<ExecItem, "kind" | "table" | "id">): ExecItem {
  return {
    title: p.id, occurred_at: "2026-11-06T10:00:00.000Z", route: "/dashboard", detail: null,
    account_id: null, account_name: null, score: 50, reasons: [], source_confidence: null, category: null, ...p,
  };
}

function ctx(p: Partial<ExecutiveContext> = {}): ExecutiveContext {
  return {
    workspace_id: WS, generated_at: NOW, window_days: 7, brain: BRAIN,
    signals: [], leads: [], content: [], approvals: [], plans_in_flight: [], failed_work: [], unavailable_sources: [], ...p,
  };
}

const sig = (id: string, account: string | null, score: number, conf: "high" | "medium" | "low" = "medium") =>
  item({ kind: "signal", table: "signal_events", id, title: `Funding announced (${id})`, route: "/signals", account_id: account, account_name: account ? `Co ${account}` : null, score, source_confidence: conf, reasons: ["happened this week"] });
const lead = (id: string, account: string, score: number) =>
  item({ kind: "lead", table: "lead_candidates", id, title: `Co ${account}`, route: `/leads?lead=${account}`, account_id: account, account_name: `Co ${account}`, score, reasons: [`fit ${score}/100`], detail: "Next: Email the VP Ops" });
const approval = (id: string, score = 30) =>
  item({ kind: "approval", table: "approvals", id, title: `Send outreach ${id}`, route: "/awaiting-you", score, occurred_at: "2026-11-04T08:00:00.000Z" });
const draft = (id: string) => item({ kind: "content", table: "content_item", id, title: `Post ${id}`, route: `/content?item=${id}`, score: 45 });

Deno.test("EMPTY workspace: no priorities, honest summary, low confidence, nothing invented", () => {
  const b = synthesizeExecutiveBrief(ctx());
  assertEquals(b.priorities, []);
  assertEquals(b.recommended_actions, []);
  assertEquals(b.sources, []);
  assert(b.summary.startsWith("Nothing new in the last 7 days"), b.summary);
  assertEquals(b.confidence.overall, "low");
  assert(b.confidence.notes.some((n) => n.includes("No recent workspace activity")));
  assertEquals(b.version, "orion-brief-v1");
  assertEquals(b.agent, "orion");
});

Deno.test("EMPTY workspace with an unfinished Brain: the one priority is the Brain, with the Brain row as evidence", () => {
  const b = synthesizeExecutiveBrief(ctx({ brain: { ...BRAIN, usable: false, missing: ["ICP / target buyers"] } }));
  assertEquals(b.priorities.length, 1);
  assertEquals(b.priorities[0].category, "setup");
  assertEquals(b.priorities[0].evidence[0], {
    kind: "brain", table: "company_brain", id: WS, title: "Northwind Robotics Company Brain", occurred_at: null, route: "/company-brain",
  });
  assert(b.priorities[0].why.includes("ICP / target buyers"));
  assertFalse(b.brain.used);
});

Deno.test("PARTIAL data (signals only): market priorities, no fabricated leads or approvals", () => {
  const b = synthesizeExecutiveBrief(ctx({ signals: [sig("s1", "a1", 70), sig("s2", "a2", 60)] }));
  assert(b.priorities.length >= 1);
  assert(b.priorities.every((p) => p.category === "market"));
  assertEquals(b.opportunities, []);
  assertEquals(b.pending_decisions, []);
  assertEquals(b.market_changes.length, 2);
});

Deno.test("AT MOST THREE priorities, ranked, every one with evidence that was in the context", () => {
  const c = ctx({
    signals: [sig("s1", "a9", 80, "high"), sig("s2", "a8", 75), sig("s3", "a7", 70)],
    leads: [lead("l1", "a1", 90), lead("l2", "a2", 60)],
    approvals: [approval("ap1", 40), approval("ap2", 10)],
    content: [draft("c1")],
    failed_work: [item({ kind: "plan", table: "task_plans", id: "p1", title: "Find logistics leads", route: "/plans/p1", detail: "Apify 403" })],
  });
  const b = synthesizeExecutiveBrief(c);
  assertEquals(b.priorities.length, MAX_PRIORITIES);
  assertEquals(b.priorities.map((p) => p.rank), [1, 2, 3]);
  const known = new Set([...c.signals, ...c.leads, ...c.approvals, ...c.content, ...c.failed_work].map((i) => `${i.table}:${i.id}`));
  for (const p of b.priorities) {
    assert(p.evidence.length > 0, p.title);
    for (const e of p.evidence) assert(known.has(`${e.table}:${e.id}`), `${p.title} cites unknown ${e.table}:${e.id}`);
    assert(p.action.route.startsWith("/"));
  }
  for (const r of b.recommended_actions) {
    assert(r.evidence.length > 0, `recommendation without evidence: ${r.action}`);
    for (const e of r.evidence) assert(known.has(`${e.table}:${e.id}`));
  }
  // A very strong lead may lead; waiting decisions still outrank market news.
  const cats = b.priorities.map((p) => p.category);
  assertEquals(cats[0], "opportunity");
  const decision = b.priorities.find((p) => p.category === "decision");
  assert(decision, "pending approvals are a top-three priority");
  assertEquals(decision!.evidence.map((e) => e.id).sort(), ["ap1", "ap2"]);
  const firstMarket = cats.indexOf("market");
  assert(firstMarket === -1 || cats.indexOf("decision") < firstMarket);
});

Deno.test("DUPLICATES: one account appears in one priority; repeated signals collapse; recommendations unique", () => {
  const c = ctx({
    signals: [sig("s1", "a1", 85, "high"), sig("s1b", "a1", 70), sig("s2", "a2", 60)],
    leads: [lead("l1", "a1", 80), lead("l1b", "a1", 40)],
  });
  const b = synthesizeExecutiveBrief(c);
  const subjects = b.priorities.flatMap((p) => p.evidence.filter((e) => e.kind !== "approval").map((e) => e.id));
  // a1 is covered once (the opportunity, backed by its best signal) — never again as market news.
  const a1Priorities = b.priorities.filter((p) => p.evidence.some((e) => ["s1", "s1b", "l1", "l1b"].includes(e.id)));
  assertEquals(a1Priorities.length, 1);
  assertEquals(a1Priorities[0].category, "opportunity");
  assert(a1Priorities[0].evidence.some((e) => e.id === "s1"), "the corroborating signal is cited");
  assertEquals(a1Priorities[0].confidence, "high", "a lead backed by a signal is high confidence");
  assertEquals(b.opportunities.length, 1, "one opportunity per account");
  assertEquals(b.market_changes.filter((m) => m.evidence[0].id.startsWith("s1")).length, 1);
  const keys = b.recommended_actions.map((r) => `${r.route}|${r.evidence.map((e) => e.id).sort().join(",")}`);
  assertEquals(new Set(keys).size, keys.length);
  assert(subjects.length > 0);
});

Deno.test("DETERMINISTIC: the same context gives the same brief", () => {
  const c = ctx({ signals: [sig("s1", "a1", 50), sig("s2", "a2", 50)], leads: [lead("l1", "a3", 50)], approvals: [approval("ap1")] });
  assertEquals(JSON.stringify(synthesizeExecutiveBrief(c)), JSON.stringify(synthesizeExecutiveBrief(c)));
});

Deno.test("COMPANY BRAIN: used flag, company name and ICP wording reach the brief", () => {
  const b = synthesizeExecutiveBrief(ctx({ leads: [lead("l1", "a1", 80)] }));
  assert(b.brain.used);
  assertEquals(b.brain.company, "Northwind Robotics");
  assert(b.priorities[0].why.includes("logistics"), b.priorities[0].why);
});

Deno.test("UNAVAILABLE sources are named and lower confidence", () => {
  const b = synthesizeExecutiveBrief(ctx({ leads: [lead("l1", "a1", 80)], unavailable_sources: ["signal_events"] }));
  assertEquals(b.confidence.overall, "low");
  assert(b.confidence.notes.some((n) => n.includes("signal_events")));
});

Deno.test("MODEL WORDING: grounded wording is applied, ranking and evidence untouched", () => {
  const det = synthesizeExecutiveBrief(ctx({ leads: [lead("l1", "a1", 80)], approvals: [approval("ap1")] }));
  const facts = modelFacts(det, "<company_brain>…</company_brain>");
  const out = applyModelWording(det, {
    summary: "One decision is waiting and Co a1 looks ready.",
    priorities: [{ id: "P1", why: "Work is paused until you decide." }],
  }, facts, "claude-haiku-4-5");
  assertEquals(out.synthesis, { mode: "model", model: "claude-haiku-4-5", rejected_reason: null });
  assertEquals(out.summary, "One decision is waiting and Co a1 looks ready.");
  assertEquals(out.priorities.map((p) => p.id), det.priorities.map((p) => p.id));
  assertEquals(out.priorities.map((p) => p.evidence), det.priorities.map((p) => p.evidence));
  assertEquals(out.priorities[0].why, "Work is paused until you decide.");
});

Deno.test("MODEL WORDING: invented numbers, unknown ids, malformed output → deterministic brief kept", () => {
  const det = synthesizeExecutiveBrief(ctx({ leads: [lead("l1", "a1", 80)] }));
  const facts = modelFacts(det, "");
  const cases: Array<[unknown, string]> = [
    [{ summary: "Revenue grew 47% this quarter." }, "summary_ungrounded_number"],
    [{ summary: "ok", priorities: [{ id: "P9", why: "x" }] }, "unknown_priority_id"],
    [{ summary: "ok", priorities: [{ id: "P1", why: "Raised $12000000 yesterday." }] }, "why_ungrounded_number"],
    [{ summary: "" }, "bad_summary"],
    ["not json", "not_an_object"],
    [null, "not_an_object"],
  ];
  for (const [m, reason] of cases) {
    const out = applyModelWording(det, m, facts, "x");
    assertEquals(out.synthesis.mode, "deterministic");
    assertEquals(out.synthesis.rejected_reason, reason);
    assertEquals(out.summary, det.summary);
    assertEquals(out.priorities, det.priorities);
  }
});

Deno.test("MARKDOWN: every priority line links to its evidence; empty sections say so", () => {
  const b = synthesizeExecutiveBrief(ctx({ leads: [lead("l1", "a1", 80)] }));
  const md = renderExecutiveBriefMarkdown(b);
  assert(md.startsWith("# Orion · Executive Brief"));
  assert(md.includes("(/leads?lead=a1)"));
  assert(md.includes("No new market signals in this window."));
  assert(md.includes("No approvals or drafts waiting."));
});
