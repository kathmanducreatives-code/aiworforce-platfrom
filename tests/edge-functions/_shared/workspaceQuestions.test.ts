// PILOT WORKSPACE QUESTIONS — ANSWERED FROM CANONICAL STATE (2026-10-01).
//
// Thirteen questions from the local evaluation. Before this, every one of them
// reached the generic read surface (or a sourcing route): "show me my latest
// qualified leads" listed every saved lead, "which leads are missing company
// research?" and "leads where funding verification failed" got the same
// unfiltered list, and "today" was not a filter at all.
//
// Fixtures mirror production shapes (`tasks.result.workbench_mission_view`,
// `lead_candidates.raw.canonical_decision`, task_plans.completed_at):
//
//   SALVO     qualified (low priority) — size and funding PASS with provenance
//   MINTMCP   ruled out — the required funding recency FAILED
//   WORDWARE  pending — the required funding claim is unresolved
//   NORTHWIND qualified (legacy quota_eligible), researched, has a draft
//   ACME      saved lead with NO decision and no research — never "qualified"
//
// Every case is pure: `fetch` throws for the whole file.

import { assert, assertEquals, assertFalse, assertMatch, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  answerWorkspaceQuestion, classifyWorkspaceQuestion, loadWorkspaceSnapshot, sourcesFor,
  startOfToday, safeTimeZone, publicAgentOf, PUBLIC_AGENT_SLUGS,
  type WorkspaceQuestion, type WorkspaceSnapshot,
} from "../../../supabase/functions/_shared/workspaceQuestions.ts";

globalThis.fetch = () => { throw new Error("a workspace question must not reach the network"); };

const WS = "ws-1";
const NOW = new Date("2026-10-01T12:00:00Z");

// ── fixtures ─────────────────────────────────────────────────────────────────

const check = (dimension: string, result: string, reason: string, actor: string | null = null, url: string | null = null) =>
  ({ dimension, result, reason, criterion_id: `${dimension}:x`, provenance: actor ? { actor, url, status: "proven" } : null });

const SALVO_LEAD = {
  label: "low_priority", bucket: "low_priority",
  company: { key: "https://www.linkedin.com/company/salvosoftware", name: "Salvo Software", domain: "salvosoftware.com", linkedin_url: "https://www.linkedin.com/company/salvosoftware" },
  hard_checks: { company_size: "pass", funding: "pass" },
  hard_check_details: [
    check("company_size", "pass", "declared size band 11-50 is within 1-150", "apify_linkedin_company_details"),
    check("funding", "pass", "a verified funding event (Debt Financing) was announced 2024-06-06, 846 day(s) ago, inside the 1095-day window", "apify_funding_pvalyou", "https://pitchbook.com/profiles/company/570009-52"),
  ],
  missing_evidence: [], why_surfaced: [{ text: "Salvo Software has a recorded $150,000 debt financing round announced on 2024-06-06." }],
};
const MINT_LEAD = {
  label: null, bucket: "ineligible",
  company: { key: "https://www.linkedin.com/company/mintmcp", name: "MintMCP", domain: null, linkedin_url: "https://www.linkedin.com/company/mintmcp" },
  hard_checks: { company_size: "pass", funding: "fail" },
  hard_check_details: [
    check("company_size", "pass", "declared size band 11-50 is within 1-150", "apify_linkedin_company_details"),
    check("funding", "fail", "the latest verified funding event was announced 2023-01-10, 994 day(s) ago, outside the 730-day window", "apify_funding_atomus"),
  ],
  missing_evidence: [], why_surfaced: [],
};
const WORD_LEAD = {
  label: null, bucket: "pending",
  company: { key: "https://www.linkedin.com/company/wordware", name: "Wordware", domain: null, linkedin_url: "https://www.linkedin.com/company/wordware" },
  hard_checks: { funding: "unknown" },
  hard_check_details: [check("funding", "unknown", "no dated funding round is held for this company yet")],
  missing_evidence: ["Funding: a Seed round in the last 2 years — no dated round is held yet"], why_surfaced: [],
};
const view = (leads: unknown[]) => ({ version: "workbench-mission-view-v1", stage: "complete", counts: {}, leads });

const TASKS = [
  { id: "t-salvo", workspace_id: WS, agent_slug: "scout", status: "complete", plan_id: "p-salvo",
    created_at: "2026-09-30T15:29:26Z", updated_at: "2026-09-30T15:29:26Z", completed_at: null, finished_at: null,
    query: "Qualify https://www.linkedin.com/company/salvosoftware. It must have raised funding within the last 3 years.",
    mission_view: view([SALVO_LEAD]) },
  { id: "t-word", workspace_id: WS, agent_slug: "scout", status: "complete", plan_id: "p-word",
    created_at: "2026-09-30T14:38:03Z", updated_at: "2026-09-30T14:44:59Z", completed_at: null, finished_at: null,
    query: "Qualify https://www.linkedin.com/company/wordware — it must have raised Seed funding in the last 2 years.",
    mission_view: view([WORD_LEAD]) },
  { id: "t-mint", workspace_id: WS, agent_slug: "scout", status: "complete", plan_id: "p-mint",
    created_at: "2026-09-29T09:00:00Z", updated_at: "2026-09-29T09:05:00Z", completed_at: null, finished_at: null,
    query: "Qualify MintMCP — it must have raised funding in the last 2 years.", mission_view: view([MINT_LEAD]) },
];
const PLANS = [
  { id: "p-salvo", workspace_id: WS, status: "complete", goal: "Qualify https://www.linkedin.com/company/salvosoftware. It must have raised funding within the last 3 years.", created_at: "2026-09-30T15:29:23Z", completed_at: "2026-09-30T15:32:55Z" },
  { id: "p-word", workspace_id: WS, status: "partial", goal: "Qualify https://www.linkedin.com/company/wordware", created_at: "2026-09-30T14:37:59Z", completed_at: null },
  { id: "p-mint", workspace_id: WS, status: "complete", goal: "Qualify MintMCP", created_at: "2026-09-29T08:59:00Z", completed_at: "2026-09-29T09:05:00Z" },
];
const LEADS = [
  { id: "l-salvo", workspace_id: WS, account_id: "a-salvo", status: "new", created_at: "2026-09-26T14:07:26Z", updated_at: "2026-09-30T15:32:39Z",
    canonical_decision: { label: "low_priority", bucket: "low_priority", qualified: true, hard_checks: { funding: "pass", company_size: "pass" } },
    quota_eligible: true, verdict: "QUALIFIED", accounts: { name: "Salvo Software", domain: "salvosoftware.com", linkedin_url: "https://www.linkedin.com/company/salvosoftware" } },
  { id: "l-north", workspace_id: WS, account_id: "a-north", status: "new", created_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-20T10:00:00Z",
    canonical_decision: null, quota_eligible: true, verdict: "QUALIFIED", accounts: { name: "Northwind Labs", domain: "northwind.io", linkedin_url: null } },
  { id: "l-acme", workspace_id: WS, account_id: "a-acme", status: "new", created_at: "2026-09-15T10:00:00Z", updated_at: "2026-09-15T10:00:00Z",
    canonical_decision: null, quota_eligible: null, verdict: null, accounts: { name: "Acme Robotics", domain: "acme-robotics.com", linkedin_url: null } },
];
const ENRICHMENTS = [
  { workspace_id: WS, lead_candidate_id: "l-salvo", account_id: "a-salvo", created_at: "2026-09-30T15:40:00Z" },
  { workspace_id: WS, lead_candidate_id: "l-north", account_id: "a-north", created_at: "2026-09-21T10:00:00Z" },
];
const DRAFTS = [
  { workspace_id: WS, lead_candidate_id: "l-north", account_id: "a-north", status: "draft", created_at: "2026-09-21T11:00:00Z" },
];

type Tables = Record<string, Array<Record<string, unknown>>>;
const BASE: Tables = {
  tasks: TASKS, task_plans: PLANS, lead_candidates: LEADS, lead_enrichments: ENRICHMENTS,
  outreach_drafts: DRAFTS, approvals: [],
};

/** A PostgREST-shaped stub: `eq` filters on fields the rows carry; it records what was read. */
function db(tables: Tables, failing: string[] = []) {
  const asked: string[] = [];
  const from = (table: string) => {
    asked.push(table);
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const chain = () => q;
    q.select = chain; q.order = chain; q.in = chain; q.gte = chain;
    q.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => !(col in r) || r[col] === val);
      return q;
    };
    q.limit = () => Promise.resolve(failing.includes(table)
      ? { data: null, error: { message: "boom" } }
      : { data: rows, error: null });
    q.then = (res: (v: unknown) => unknown) => (q.limit as () => Promise<unknown>)().then(res);
    return q;
  };
  return { client: { from }, asked };
}

async function ask(message: string, opts: { tables?: Tables; tz?: string; now?: Date; failing?: string[] } = {}) {
  const q = classifyWorkspaceQuestion(message);
  assert(q, `not recognised as a workspace question: ${message}`);
  const { client, asked } = db(opts.tables ?? BASE, opts.failing);
  const snap = await loadWorkspaceSnapshot(client, WS, sourcesFor(q));
  const a = answerWorkspaceQuestion(q, snap, opts.now ?? NOW, opts.tz ?? "UTC");
  return { q, snap, a, asked };
}

// ══ 1. THE THIRTEEN QUESTIONS ARE RECOGNISED — AND NOTHING ELSE IS ═════════

const THIRTEEN: Array<[string, WorkspaceQuestion["kind"]]> = [
  ["What's pending for me right now?", "pending_for_me"],
  ["What has Lyra been working on today?", "agent_activity_today"],
  ["Show me my latest qualified leads.", "qualified_leads"],
  ["How many leads are currently in review?", "in_review_count"],
  ["What was the last completed workflow?", "last_completed_workflow"],
  ["Summarize what my AI workforce has done today.", "workforce_today"],
  ["Show me companies we researched but haven't qualified yet.", "researched_not_qualified"],
  ["Which leads are missing company research?", "missing_research"],
  ["Which qualified leads still have no outreach draft?", "qualified_without_draft"],
  ["Show me leads where funding verification failed.", "claim_failed"],
  ["What evidence made Salvo Software qualify?", "why_company"],
  ["Why was MintMCP rejected?", "why_company"],
  ["Why is Wordware still pending?", "why_company"],
];

Deno.test("RECOGNISED: each of the thirteen questions maps to its canonical read", () => {
  for (const [m, kind] of THIRTEEN) assertEquals(classifyWorkspaceQuestion(m)?.kind, kind, m);
  assertEquals(classifyWorkspaceQuestion("What has Lyra been working on today?"), { kind: "agent_activity_today", agent: "lyra" });
  assertEquals(classifyWorkspaceQuestion("Show me leads where funding verification failed."), { kind: "claim_failed", dimension: "funding" });
  assertEquals(classifyWorkspaceQuestion("What evidence made Salvo Software qualify?"), { kind: "why_company", company: "salvo software", asked: "qualified" });
  assertEquals(classifyWorkspaceQuestion("Why was MintMCP rejected?"), { kind: "why_company", company: "mintmcp", asked: "rejected" });
  assertEquals(classifyWorkspaceQuestion("Why is Wordware still pending?"), { kind: "why_company", company: "wordware", asked: "pending" });
});

Deno.test("NOT TAKEN: a request to DO something, or a question this module cannot answer, still reaches Chat Brain", () => {
  for (const m of [
    "Find AI SaaS companies in the US that are hiring.",
    "Find companies we haven't qualified yet.",
    "Research Wordware.",
    "Draft outreach for my qualified leads.",
    "Qualify https://www.linkedin.com/company/salvosoftware",
    "How many leads do I have?",
    "Brief me on today.",
    "What is my ICP?",
    "hello",
    // A filter this path cannot apply is never dropped: these go to Chat Brain.
    "Show me qualified leads in fintech.",
    "Show me my latest qualified leads from Germany.",
    "Which leads in the US are missing company research?",
    "How many fintech leads are in review?",
  ]) assertEquals(classifyWorkspaceQuestion(m), null, m);
  // Paraphrases of the supported filters are still taken.
  for (const [m, kind] of [
    ["List my qualified companies", "qualified_leads"],
    ["What are my qualified leads?", "qualified_leads"],
    ["Which of my leads don't have company research yet?", "missing_research"],
    ["How many companies are pending review right now?", "in_review_count"],
    ["Which companies failed the funding check?", null],
    ["Show me companies whose funding check failed", "claim_failed"],
    ["Which qualified leads don't have an outreach draft yet?", "qualified_without_draft"],
  ] as const) assertEquals(classifyWorkspaceQuestion(m)?.kind ?? null, kind, m);
});

// ══ 2. EACH ANSWER IS FILTERED BY CANONICAL STATE ══════════════════════════

Deno.test("1. pending for me: 0 pending approvals, said directly — evidence-waiting companies are not 'on you'", async () => {
  const { a, asked } = await ask("What's pending for me right now?");
  assertStringIncludes(a.text, "0 pending approvals");
  assertStringIncludes(a.text, "1 company is in review waiting on evidence, not on you");
  assertEquals(a.counts.approvals, 0);
  assert(asked.includes("approvals") && asked.includes("tasks"), "legacy awaiting_approval tasks are checked too");
  const withOne = await ask("What's pending for me right now?", { tables: { ...BASE,
    approvals: [{ id: "ap1", workspace_id: WS, status: "pending", agent_slug: "penn", title: "Outreach to Salvo Software", created_at: "2026-10-01T09:00:00Z" }] } });
  assertStringIncludes(withOne.a.text, "1 item waiting for your approval");
  assertStringIncludes(withOne.a.text, "Mira: Outreach to Salvo Software");
});

Deno.test("2. Lyra today: real timestamps — nothing today is said directly, with the last real activity", async () => {
  const { a } = await ask("What has Lyra been working on today?");
  assertMatch(a.text, /^Lyra hasn't worked on anything today \(UTC\)\./);
  assertStringIncludes(a.text, "salvosoftware");
  assertStringIncludes(a.text, "on 30 Sept 2026");
  const busy = await ask("What has Lyra been working on today?", { tables: { ...BASE, tasks: [
    { id: "t-today", workspace_id: WS, agent_slug: "scout", status: "running", plan_id: "p-x", created_at: "2026-10-01T09:30:00Z",
      updated_at: "2026-10-01T09:31:00Z", completed_at: null, finished_at: null, query: "Find fintech companies hiring SDRs", mission_view: null },
    ...TASKS,
  ] } });
  assertStringIncludes(busy.a.text, "Lyra — 1 task today");
  assertStringIncludes(busy.a.text, "Find fintech companies hiring SDRs");
  assertFalse(busy.a.text.includes("salvosoftware"), "yesterday's work is not today's");
});

Deno.test("3. latest qualified leads: only explicit acceptances — never every saved lead", async () => {
  const { a } = await ask("Show me my latest qualified leads.");
  assertStringIncludes(a.text, "2 qualified leads");
  assertStringIncludes(a.text, "Salvo Software — low priority");
  assertStringIncludes(a.text, "Northwind Labs");
  for (const not of ["Acme Robotics", "MintMCP", "Wordware"]) assertFalse(a.text.includes(not), not);
  assertStringIncludes(a.text, "The rest of your 3 saved leads have not qualified.");
  assertEquals(a.companies.map((c) => c.name), ["Salvo Software", "Northwind Labs"], "newest first");
});

Deno.test("4. in-review count: the canonical pending bucket, with what each is waiting on", async () => {
  const { a } = await ask("How many leads are currently in review?");
  assertEquals(a.counts.in_review, 1);
  assertStringIncludes(a.text, "1 lead is in review");
  assertStringIncludes(a.text, "Wordware — waiting on funding");
});

Deno.test("5. last completed workflow: the plan that actually COMPLETED last, from completed_at", async () => {
  const { a } = await ask("What was the last completed workflow?");
  assertStringIncludes(a.text, "Qualify https://www.linkedin.com/company/salvosoftware");
  assertStringIncludes(a.text, "on 30 Sept 2026 at 15:32");
  assertStringIncludes(a.text, "Result: 1 qualified, 0 pending, 0 ruled out.");
  // A newer plan that did not complete is named as such, never substituted.
  const newer = await ask("What was the last completed workflow?", { tables: { ...BASE, task_plans: [
    { id: "p-new", workspace_id: WS, status: "partial", goal: "Qualify Fuse AI", created_at: "2026-10-01T08:00:00Z", completed_at: null },
    ...PLANS,
  ] } });
  assertStringIncludes(newer.a.text, "salvosoftware");
  assertStringIncludes(newer.a.text, "1 workflow has started but not completed (partial)");
});

Deno.test("6. workforce today: nothing today is said directly; activity today is grouped by agent", async () => {
  const quiet = await ask("Summarize what my AI workforce has done today.");
  assertMatch(quiet.a.text, /^Your AI workforce hasn't done anything today \(UTC\)\./);
  const busy = await ask("Summarize what my AI workforce has done today.", { tables: { ...BASE,
    tasks: [{ ...TASKS[0], id: "t-now", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:05:00Z" }, ...TASKS.slice(1)],
    task_plans: [{ ...PLANS[0], completed_at: "2026-10-01T10:05:00Z" }, ...PLANS.slice(1)] } });
  assertStringIncludes(busy.a.text, "Your AI workforce — 1 task today");
  assertStringIncludes(busy.a.text, "Lyra: 1 task");
  assertStringIncludes(busy.a.text, "1 qualified, 0 pending, 0 ruled out");
  assertStringIncludes(busy.a.text, "1 workflow completed");
});

Deno.test("7. researched but not qualified: investigated or researched, still open — rejections excluded and said so", async () => {
  const { a } = await ask("Show me companies we researched but haven't qualified yet.");
  assertStringIncludes(a.text, "1 researched company has not qualified yet");
  assertStringIncludes(a.text, "Wordware — pending");
  assertFalse(a.text.includes("Acme Robotics"), "never researched");
  assertFalse(a.text.includes("Salvo Software"), "qualified");
  assertStringIncludes(a.text, "1 other researched company was ruled out");
});

Deno.test("8. missing company research: saved leads with no lead_enrichments row — the Outreach 'researched' fact", async () => {
  const { a } = await ask("Which leads are missing company research?");
  assertStringIncludes(a.text, "1 saved lead has no company research yet");
  assertStringIncludes(a.text, "Acme Robotics — saved but not evaluated");
  assertFalse(a.text.includes("Salvo Software") || a.text.includes("Northwind"));
});

Deno.test("9. qualified with no outreach draft: qualified ∩ no live draft", async () => {
  const { a } = await ask("Which qualified leads still have no outreach draft?");
  assertStringIncludes(a.text, "1 qualified lead has no outreach draft yet");
  assertStringIncludes(a.text, "Salvo Software");
  assertFalse(a.text.includes("Northwind"), "Northwind has a draft");
  assertFalse(a.text.includes("Acme"), "Acme is not qualified");
});

Deno.test("10. funding verification failed: a FAIL on the funding claim — an unresolved one is pending, not failed", async () => {
  const { a } = await ask("Show me leads where funding verification failed.");
  assertStringIncludes(a.text, "1 company failed funding verification");
  assertStringIncludes(a.text, "MintMCP — the latest verified funding event was announced 2023-01-10, 994 day(s) ago, outside the 730-day window");
  assertFalse(a.text.includes("Salvo"));
  assertStringIncludes(a.text, "1 other company is still unverified on funding — pending, not failed.");
});

Deno.test("11. SALVO: the evidence that made it qualify — size and funding, with their sources", async () => {
  const { a } = await ask("What evidence made Salvo Software qualify?");
  assertStringIncludes(a.text, "Salvo Software qualified as low priority");
  assertStringIncludes(a.text, "company size: declared size band 11-50 is within 1-150 (source: apify_linkedin_company_details)");
  assertStringIncludes(a.text, "funding: a verified funding event (Debt Financing) was announced 2024-06-06");
  assertStringIncludes(a.text, "inside the 1095-day window (source: apify_funding_pvalyou, https://pitchbook.com/profiles/company/570009-52)");
});

Deno.test("12. MINTMCP: rejected because the required funding recency failed", async () => {
  const { a } = await ask("Why was MintMCP rejected?");
  assertStringIncludes(a.text, "MintMCP is ruled out");
  assertStringIncludes(a.text, "The required claim that failed:");
  assertStringIncludes(a.text, "funding: the latest verified funding event was announced 2023-01-10, 994 day(s) ago, outside the 730-day window (source: apify_funding_atomus)");
  assertFalse(a.text.includes("company size: declared"), "a passing claim is not a reason for rejection");
});

Deno.test("13. WORDWARE: pending because required evidence is unresolved — pending, not rejected", async () => {
  const { a } = await ask("Why is Wordware still pending?");
  assertStringIncludes(a.text, "Wordware is pending");
  assertStringIncludes(a.text, "Still unresolved:\n• funding: no dated funding round is held for this company yet");
  assertStringIncludes(a.text, "Missing evidence:\n• Funding: a Seed round in the last 2 years");
  assertStringIncludes(a.text, "It stays pending, not rejected");
});

// ══ 3. TRUTH OVER PREMISE, AND HONEST FAILURE ══════════════════════════════

Deno.test("PREMISE: a question that assumes the wrong state gets the real one", async () => {
  assertMatch((await ask("Why was Wordware rejected?")).a.text, /^Wordware wasn't rejected — it's pending/);
  assertMatch((await ask("What evidence made MintMCP qualify?")).a.text, /^MintMCP hasn't qualified — it's ruled out/);
  assertMatch((await ask("Why is Salvo Software still pending?")).a.text, /^Salvo Software isn't pending — it's qualified/);
  assertStringIncludes((await ask("Why was Globex rejected?")).a.text, `I don't have any record of "globex"`);
});

Deno.test("A FAILED READ IS NOT AN EMPTY WORKSPACE", async () => {
  const { a } = await ask("Show me my latest qualified leads.", { failing: ["lead_candidates", "tasks"] });
  assert(a.degraded);
  assertStringIncludes(a.text, "I couldn't read part of your saved data just now");
});

Deno.test("A LEGACY SAVED LEAD WITHOUT A DECISION is 'not evaluated', never qualified", async () => {
  const { snap } = await ask("Show me my latest qualified leads.");
  assertEquals(snap.companies.find((c) => c.name === "Acme Robotics")?.status, "not_evaluated");
  assertEquals(snap.companies.find((c) => c.name === "Salvo Software")?.saved, true, "the run's decision and the saved lead are one company");
  assertEquals(snap.companies.filter((c) => c.name === "Salvo Software").length, 1);
});

// ══ 4. "TODAY" IS THE USER'S DAY ═══════════════════════════════════════════

Deno.test("TODAY: midnight in the client's zone, from real timestamps; an unknown zone falls back to UTC and says so", async () => {
  // 03:00Z is 08:45 in Kathmandu (+05:45): local midnight was 18:15Z the day before.
  const now = new Date("2026-10-01T03:00:00Z");
  assertEquals(startOfToday(now, "Asia/Kathmandu").toISOString(), "2026-09-30T18:15:00.000Z");
  assertEquals(startOfToday(now, "UTC").toISOString(), "2026-10-01T00:00:00.000Z");
  assertEquals(safeTimeZone("Not/AZone"), "UTC");
  assertEquals(safeTimeZone(undefined), "UTC");
  const lateTask = { ...TASKS[0], id: "t-late", created_at: "2026-09-30T20:00:00Z", updated_at: "2026-09-30T20:00:00Z" };
  const tables = { ...BASE, tasks: [lateTask, ...TASKS.slice(1)] };
  const ktm = await ask("What has Lyra been working on today?", { tables, tz: "Asia/Kathmandu", now });
  assertStringIncludes(ktm.a.text, "Lyra — 1 task today:");
  const utc = await ask("What has Lyra been working on today?", { tables, tz: "UTC", now });
  assertMatch(utc.a.text, /^Lyra hasn't worked on anything today \(UTC\)/);
});

// ══ 5. THE GUARANTEES ══════════════════════════════════════════════════════

Deno.test("ZERO SPEND: the module imports nothing — no provider, registry, engine or credit path is reachable", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/workspaceQuestions.ts", import.meta.url));
  assertEquals([...src.matchAll(/^\s*import\s/gm)].length, 0);
});

Deno.test("PILOT-CHAT answers these BEFORE Chat Brain, as a reply — never a Start card", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const gate = src.indexOf("const workspaceQuestion =");
  const brain = src.indexOf("await understandRequest(");
  assert(gate > 0 && src.slice(gate, gate + 200).includes("classifyWorkspaceQuestion(message)"),
    "pilot-chat must consult the workspace-question recogniser");
  assert(brain > 0 && gate < brain, "the canonical read must run before Chat Brain can route the question elsewhere");
  const block = src.slice(gate, src.indexOf("// ══ CHAT BRAIN", gate));
  assertStringIncludes(block, `type: "reply"`);
  for (const forbidden of ["workflow_confirmation", "delegateToOrchestrate", "showWorkflowConfirmation", "buildMissionConfirmation"]) {
    assertFalse(block.includes(forbidden), `no ${forbidden} on the workspace-question path`);
  }
  assertStringIncludes(block, "!actionSource && !isPreConfirmed", "card actions keep their own path");
});

Deno.test("AGENT NAMES mirror the public registry (src/config/agentRegistry.ts)", () => {
  const src = Deno.readTextFileSync(new URL("../../../src/config/agentRegistry.ts", import.meta.url));
  for (const [id, slugs] of Object.entries(PUBLIC_AGENT_SLUGS)) {
    const block = src.slice(src.indexOf(`id: '${id}'`));
    const m = block.match(/legacySlugs:\s*\[([^\]]*)\]/);
    assert(m, id);
    assertEquals(m[1].match(/'([a-z]+)'/g)!.map((x) => x.replace(/'/g, "")), [...slugs], id);
  }
  assertEquals(publicAgentOf("scout"), "lyra");
  assertEquals(publicAgentOf("Lyra"), "lyra");
});
