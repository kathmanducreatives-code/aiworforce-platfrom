// ORION V1 — the browser side: stored-brief parsing, history isolation, safe
// routes, current vs historical, data-access shape, dashboard + identity wiring.
import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  briefFreshness, fetchBriefHistory, parseBriefHistory, parseExecutiveBrief, requestExecutiveBrief, safeRoute,
} from "../../src/lib/orion/executiveBrief.ts";
import { synthesizeExecutiveBrief } from "../../supabase/functions/_shared/executiveBrief.ts";

const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const ROOT = new URL("../../", import.meta.url);
type Mutable = { priorities: Array<{ action: { route: string }; evidence: Array<{ route: string }> }> };
type Q = { select: () => Q; eq: (c: string, v: string) => Q; order: (c: string, o: { ascending: boolean }) => Q; limit: (n: number) => Promise<{ data: unknown; error: unknown }> };
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));

function sampleBrief(ws = WS, at = "2026-11-07T07:00:00.000Z") {
  return synthesizeExecutiveBrief({
    workspace_id: ws, generated_at: at, window_days: 7,
    brain: { usable: true, company: "Northwind", description: null, icp: null, industries: [], competitors: [], goal: null, missing: [] },
    signals: [], content: [], plans_in_flight: [], failed_work: [], unavailable_sources: [],
    leads: [{ kind: "lead", table: "lead_candidates", id: "l1", title: "Fictional Freight", occurred_at: at, route: "/leads?lead=a1", detail: null, account_id: "a1", account_name: "Fictional Freight", score: 80, reasons: ["fit 80/100"], source_confidence: null, category: "high" }],
    approvals: [{ kind: "approval", table: "approvals", id: "ap1", title: "Send outreach", occurred_at: at, route: "/awaiting-you", detail: null, account_id: null, account_name: null, score: 10, reasons: [], source_confidence: null, category: null }],
  });
}

Deno.test("a server-built brief survives the round trip through saved_outputs.raw", () => {
  const b = sampleBrief();
  const parsed = parseExecutiveBrief(JSON.parse(JSON.stringify(b)));
  assert(parsed);
  assertEquals(parsed!.priorities.map((p) => p.title), b.priorities.map((p) => p.title));
  assertEquals(parsed!.recommended_actions.length, b.recommended_actions.length);
  assertEquals(parsed!.brain.company, "Northwind");
});

Deno.test("malformed or foreign rows are dropped, never rendered", () => {
  assertEquals(parseExecutiveBrief(null), null);
  assertEquals(parseExecutiveBrief({ version: "other" }), null);
  assertEquals(parseExecutiveBrief({ ...sampleBrief(), generated_at: "yesterday" }), null);
  const rows = [
    { id: "r1", workspace_id: WS, type: "executive_brief", created_at: "2026-11-07T07:00:00Z", raw: sampleBrief() },
    { id: "r2", workspace_id: OTHER, type: "executive_brief", created_at: "2026-11-07T08:00:00Z", raw: sampleBrief(OTHER) },
    { id: "r3", workspace_id: WS, type: "workflow_summary", created_at: "2026-11-07T08:00:00Z", raw: sampleBrief() },
    { id: "r4", workspace_id: WS, type: "executive_brief", created_at: "2026-11-06T07:00:00Z", raw: { junk: true } },
    { id: "r5", workspace_id: WS, type: "executive_brief", created_at: "2026-11-05T07:00:00Z", raw: sampleBrief(WS, "2026-11-05T07:00:00.000Z") },
  ];
  const h = parseBriefHistory(rows, WS);
  assertEquals(h.map((x) => x.id), ["r1", "r5"], "own workspace, right type, readable, newest first");
});

Deno.test("evidence and action routes are in-app only", () => {
  assertEquals(safeRoute("/leads?lead=1"), "/leads?lead=1");
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "\\\\x", "", null, 42]) {
    assertEquals(safeRoute(bad), "/dashboard", String(bad));
  }
  const b = JSON.parse(JSON.stringify(sampleBrief())) as Mutable;
  b.priorities[0].action.route = "https://evil.example";
  b.priorities[0].evidence[0].route = "//evil.example/x";
  const p = parseExecutiveBrief(b)!;
  assertEquals(p.priorities[0].action.route, "/dashboard");
  assertEquals(p.priorities[0].evidence[0].route, "/dashboard");
});

Deno.test("a priority without evidence is not shown", () => {
  const b = JSON.parse(JSON.stringify(sampleBrief())) as Mutable;
  b.priorities[0].evidence = [];
  const p = parseExecutiveBrief(b)!;
  assertEquals(p.priorities.length, sampleBrief().priorities.length - 1);
});

Deno.test("current vs historical", () => {
  const now = new Date("2026-11-07T09:00:00.000Z");
  assert(briefFreshness("2026-11-07T08:30:00.000Z", now).current);
  assert(briefFreshness("2026-11-07T01:00:00.000Z", now).current);
  const old = briefFreshness("2026-11-05T08:00:00.000Z", now);
  assertFalse(old.current);
  assert(old.label.includes("may be out of date"));
});

Deno.test("history read is scoped, typed, ordered and bounded", async () => {
  const filters: string[] = [];
  let limit = 0;
  const q: Q = {
    select: () => q,
    eq: (c: string, v: string) => { filters.push(`${c}=${v}`); return q; },
    order: (c: string, o: { ascending: boolean }) => { filters.push(`order:${c}:${o.ascending}`); return q; },
    limit: (n: number) => { limit = n; return Promise.resolve({ data: [], error: null }); },
  };
  await fetchBriefHistory({ from: (t: string) => { filters.push(`table:${t}`); return q; } }, WS);
  assertEquals(filters, ["table:saved_outputs", `workspace_id=${WS}`, "type=executive_brief", "order:created_at:false"]);
  assertEquals(limit, 10);
});

Deno.test("requesting a brief calls daily-brief for the dashboard surface; errors surface", async () => {
  let sent: unknown = null;
  const ok = await requestExecutiveBrief(async (name, body) => { sent = { name, body }; return { data: { brief: sampleBrief() }, error: null }; }, WS);
  assertEquals(sent, { name: "daily-brief", body: { workspace_id: WS, surface: "dashboard" } });
  assert(ok.priorities.length > 0);
  await assertRejects(() => requestExecutiveBrief(async () => ({ data: null, error: { message: "Forbidden" } }), WS), Error, "Forbidden");
  await assertRejects(() => requestExecutiveBrief(async () => ({ data: { brief: { nope: 1 } }, error: null }), WS), Error, "unreadable");
});

Deno.test("the dashboard mounts Orion's brief panel with the workspace", () => {
  const dash = read("src/pages/Dashboard.tsx");
  assert(dash.includes("import OrionBriefPanel from '@/components/dashboard/OrionBriefPanel';"));
  assert(dash.includes("<OrionBriefPanel workspaceId={workspaceId} />"));
  const panel = read("src/components/dashboard/OrionBriefPanel.tsx");
  assert(panel.includes("['orion-briefs', workspaceId]"), "history is keyed per workspace");
  assert(/useEffect\(\(\) => \{ setSelectedId\(null\); setError\(null\); \}, \[workspaceId\]\)/.test(panel), "selection resets on workspace switch");
  assert(panel.includes("onNavigate={(route) => navigate(route)}"));
});

Deno.test("Orion is Executive Intelligence everywhere it is named; backend slugs unchanged", async () => {
  type Lookup = (s: string) => { id: string; title: string } | null;
  const { lookupPublicAgent } = await import("../../src/config/agentRegistry.ts")
    .catch(() => ({ lookupPublicAgent: null })) as { lookupPublicAgent: Lookup | null };
  const reg = read("src/config/agentRegistry.ts");
  assert(reg.includes("title: 'Executive Intelligence',"));
  // Workforce V2: Orion is the coordinator (legacy `pilot`); content (`scribe`) is Lyra's.
  assert(reg.includes("legacySlugs: ['pilot'],"), "the coordinator slug resolves to Orion");
  assert(read("src/components/workforce/agents.ts").includes("role: 'Executive Intelligence',"));
  assertFalse(read("src/data/dockAgents.ts").includes("Pipeline Operator"));
  if (lookupPublicAgent) {
    assertEquals(lookupPublicAgent("orion")?.title, "Executive Intelligence");
    assertEquals(lookupPublicAgent("pilot")?.id, "orion");
    assertEquals(lookupPublicAgent("scribe")?.id, "lyra");
  }
});
