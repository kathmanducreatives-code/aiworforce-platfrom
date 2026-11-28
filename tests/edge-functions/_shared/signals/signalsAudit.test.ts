// SIGNALS AUDIT PROBES (2026-11-28) — the owner's Signals acceptance prompts and the audit's
// structural findings, run against the real code. No network, no provider, no model:
// only `fetch` is faked (pilot-chat) or a PostgREST-shaped fake is passed (loaders).
// Every signal below is a TEST FIXTURE ("[TEST FIXTURE]" in its title / example.test domains);
// nothing here is market evidence and nothing touches a hosted project.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandRequest } from "../../../../supabase/functions/_shared/chatBrain.ts";
import { routeRequest } from "../../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../../supabase/functions/_shared/chatBrainBinding.ts";
import { orionRoute } from "../../../../supabase/functions/_shared/orionIntelligence.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { lisaRadarPreferences } from "../../../../supabase/functions/_shared/companyBrainAgentViews.ts";
import { compileCompanyBrainContext } from "../../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan } from "../../../../supabase/functions/_shared/radarScanPlanner.ts";
import { retrieveEvidence } from "../../../../supabase/functions/_shared/evidence/retrieve.ts";
import { installFakeNetwork, type ModelReply, type Row } from "../../_helpers/fakeNetwork.ts";
import { CONVERSATION, modelRequest, sendTurn, SUPABASE_URL, WORKSPACE } from "../../_helpers/pilotTurn.ts";

Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "observe");
Deno.env.set("MODEL_SPEND_ENFORCEMENT", "observe");

const ISSUE_A = "Based on our Company Brain, which three buying signals should we prioritize and why?";
const ISSUE_B = "Create a monitoring plan to identify US manufacturing and distribution companies that are expanding or hiring Account Executives. Do not execute it yet.";
const NAMED_PLAN = "Create a plan to watch acme-fixture.example for hiring and expansion. Do not execute it yet.";
const NAMED_WATCH = "Watch acme-fixture.example for hiring signals";
const HISTORY = "Summarize the signals we recorded in the last 7 days";
const CANT_WATCH = "I couldn't work out exactly what to watch";

// ── Northwind as the owner describes it (fictional) ────────────────────────────────────────
const NORTHWIND = {
  schema_version: 2,
  company: { name: "Northwind Field Services (fictional)", description: "Scheduling software for field-service teams" },
  target_customer: {
    industries: ["Manufacturing", "Distribution", "Contracting", "Field services"], geography: ["United States"],
    company_size: { min: 10, max: 200, label: "10-200" }, business_models: ["B2B"],
  },
  buyer_personas: ["Operations Manager", "Owner"],
  triggers: ["Hiring growth", "Market expansion", "Technology adoption", "Leadership changes"],
  goals: { gtm: "10 qualified meetings a month", outreach: "50 replies a month", content: "", competitor_tracking: "", hiring: "" },
};
const memBase = { scope: "workspace", scope_ref: null, version: 1, source_type: "agent_suggestion", source_ref: null, source_url: null,
  verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active", persistence: "persistent",
  observed_at: "2026-11-27T10:00:00Z", review_at: null, expires_at: null, updated_at: "2026-11-27T10:00:00Z", redacted_at: null, reason: null,
  created_by_kind: "agent", created_by_agent: "orion", approval_status: "approved", approved_by: "user-1", proposal_id: "p-1" };
const CRYPTO = { ...memBase, id: "mem-crypto", workspace_id: WORKSPACE, kind: "preference", category: "exclusions",
  fact_key: "exclusion.industry:crypto", value_type: "object", value: { type: "industry", value: "Crypto" } };

function seed(role = "owner"): Record<string, Row[]> {
  return {
    conversations: [{ id: CONVERSATION, workspace_id: WORKSPACE, user_id: "user-1", title: "New chat", created_at: "2026-11-28T09:00:00Z" }],
    messages: [],
    workspace_members: [{ id: "wm-1", workspace_id: WORKSPACE, user_id: "user-1", role }],
    company_brain: [{ id: "cb-1", workspace_id: WORKSPACE, onboarding_completed: true, updated_at: "2026-11-27T09:00:00Z", profile: NORTHWIND }],
    company_brain_memory: [CRYPTO], company_brain_revisions: [], company_brain_memory_proposals: [],
    lead_candidates: [], accounts: [], contacts: [], outreach_drafts: [], saved_outputs: [],
    monitoring_subjects: [], signal_events: [], signals: [], request_understanding_log: [], tasks: [], approvals: [],
  };
}
const isBrain = (system: string) => system.includes("REFERENCES");
async function turn(say: string, reading: unknown, o: { evidence: boolean; role?: string }) {
  if (o.evidence) Deno.env.set("AGENTORY_ORION_EVIDENCE_CONTEXT", "true"); else Deno.env.delete("AGENTORY_ORION_EVIDENCE_CONTEXT");
  const tables = seed(o.role);
  const replies: ModelReply[] = [
    { when: (_u, s) => isBrain(s), content: reading },
    { when: (_u, s) => !isBrain(s), content: "A grounded answer." },
  ];
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: replies });
  try {
    const out = await sendTurn(say, tables);
    return { out, tables, net, answer: net.modelCalls.find((c) => !isBrain(c.system)) ?? null };
  } finally {
    net.restore();
    Deno.env.delete("AGENTORY_ORION_EVIDENCE_CONTEXT");
  }
}

// ═══ ISSUE A · strategic signal recommendation with ZERO stored signals ══════════════════════
for (const evidence of [true, false]) {
  for (const [label, reading] of [
    ["read/conversation", modelRequest([{ objective: "read", entity: "conversation", shape: "answer" }])],
    ["read/signal", modelRequest([{ objective: "read", entity: "signal", shape: "answer" }])],
    ["converse", modelRequest([{ objective: "converse", entity: "conversation", shape: "answer" }])],
  ] as const) {
    Deno.test(`Issue A (${label}, evidence ${evidence ? "on" : "off"}): ORION recommends from the Brain, not the activity brief or a signal list`, async () => {
      const { out, answer } = await turn(ISSUE_A, reading, { evidence });
      assertEquals(out.status, 200);
      assertFalse(out.body.intent === "daily_brief", "not the historical brief");
      assert(answer, `ORION answered (reply: ${out.content.slice(0, 120)})`);
      assertStringIncludes(answer!.system, "STRATEGY AND PRIORITIES");
      assertStringIncludes(answer!.system, "Crypto", "approved exclusion reaches ORION");
    });
  }
}

// ═══ HISTORICAL · "what did we record" with zero signals: an honest empty read ═══════════════
Deno.test("Historical signal summary with zero signals: the read surface says nothing was recorded (no invention)", async () => {
  const { out } = await turn(HISTORY, modelRequest([{ objective: "read", entity: "signal", shape: "events",
    requirements: [{ event: "hiring", recency_days: 7 }] }]), { evidence: false });
  assertEquals(out.status, 200);
  assertStringIncludes(out.content, "I don't have any signals recorded");
});

// ═══ ISSUE B · ICP-wide monitoring PLAN, not executed ═════════════════════════════════════════
for (const [label, reading] of [
  ["monitor/company (no name)", modelRequest([{ objective: "monitor", entity: "company", shape: "records" }])],
  ["monitor/market", modelRequest([{ objective: "monitor", entity: "market", shape: "records" }])],
] as const) {
  Deno.test(`Issue B (${label}, evidence ON — deployed config): a planning answer; nothing created, nothing bought`, async () => {
    const { out, tables, answer } = await turn(ISSUE_B, reading, { evidence: true });
    assertEquals(out.status, 200);
    assertFalse(out.content.includes(CANT_WATCH), out.content);
    assertEquals(tables.monitoring_subjects.length, 0, "no monitoring subject created");
    assert(answer, "ORION wrote the plan as text");
  });
  Deno.test(`Issue B (${label}, evidence OFF — Brain TEST before 0defebd): REPRODUCES the reported failure`, async () => {
    const { out, tables } = await turn(ISSUE_B, reading, { evidence: false });
    assertStringIncludes(out.content, CANT_WATCH);
    assertEquals(tables.monitoring_subjects.length, 0);
  });
}

// ═══ NAMED-COMPANY monitoring ═════════════════════════════════════════════════════════════════
const namedMonitor = modelRequest([{ objective: "monitor", entity: "company", shape: "records",
  references: [{ kind: "named", value: "acme-fixture.example" }] }]);
Deno.test("Named-company monitoring PLAN with 'do not execute' (evidence on): answered, no subject created", async () => {
  const { tables } = await turn(NAMED_PLAN, namedMonitor, { evidence: true });
  assertEquals(tables.monitoring_subjects.length, 0);
});
Deno.test("FINDING: 'watch <company>' creates an ENABLED monitoring subject immediately — no confirmation card", async () => {
  const { out, tables } = await turn(NAMED_WATCH, namedMonitor, { evidence: true });
  assertEquals(tables.monitoring_subjects.length, 1, out.content);
  assertEquals(tables.monitoring_subjects[0].enabled, true);
  assertStringIncludes(out.content, "I'm watching");
});
Deno.test("FINDING: a VIEWER can create an enabled monitoring subject through chat (pilot-chat has no role gate)", async () => {
  const { tables } = await turn(NAMED_WATCH, namedMonitor, { evidence: true, role: "viewer" });
  assertEquals(tables.monitoring_subjects.length, 1, "a viewer's chat message created a paid, scheduled watch");
});

// ═══ COMPANY BRAIN → RADAR ════════════════════════════════════════════════════════════════════
function fakeDb(tables: Record<string, Row[]>) {
  return { from(t: string) { let rows = [...(tables[t] ?? [])];
    // deno-lint-ignore no-explicit-any
    const q: any = { select() { return q; }, eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; }, order() { return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; }, gte() { return q; }, lte() { return q; }, gt() { return q; }, not() { return q; }, is() { return q; }, or() { return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res, rej); } };
    return q; } };
}
Deno.test("Brain → radar: geography and the approved crypto exclusion are used; FIXED: a software seller's ICP stays its own", async () => {
  const t = seed();
  const r = await loadCompanyBrainContext(fakeDb(t) as unknown as LoaderDb, WORKSPACE, { skipMembershipCheck: true });
  assert(r.ok);
  const profile = r.context.effective_profile as Record<string, unknown>;
  const prefs = lisaRadarPreferences(r.context, { keywords: [], competitors: [], hiring_roles: [], linkedin_topics: [], workflow_topics: [],
    geographies: [], industries: [], pain_points: [], disqualifiers: [] } as never) as unknown as Record<string, string[]>;
  assert(JSON.stringify(prefs).toLowerCase().includes("crypto"), `LISA radar prefs carry the exclusion: ${JSON.stringify(prefs)}`);
  const plan = buildRadarScanPlan(compileCompanyBrainContext({ workspace_id: WORKSPACE, profile, signal_preferences: (profile as { signal_preferences?: unknown }).signal_preferences as never }),
    { firecrawlReady: true });
  const text = JSON.stringify(plan).toLowerCase();
  assert(text.includes("united states"), "geography baked into queries");
  // FIXED (Signals recovery): the seller's own description no longer makes the target a SaaS market.
  const hiring = plan.source_plan.find((x) => x.source === "hiring") as { queries?: string[] } | undefined;
  assertFalse(text.includes("saas"), `no SaaS targeting: ${JSON.stringify(hiring?.queries?.slice(0, 3))}`);
  assert(text.includes("manufacturing"), "the saved target industries drive the queries");
  // (Generic default disqualifiers — construction, logistics, local services … — apply only when the Brain
  // supplies none; here the approved crypto exclusion supplies one, so they do not.)
  assert(text.includes("crypto"), "approved exclusion becomes a negative term");
  // FIXED: the plan's targeting carries the 10–200 employee range.
  assertEquals(plan.targeting.company_size, { min: 10, max: 200 });
});
Deno.test("Brain → radar with no provider: every Firecrawl source is setup_needed (no fake signals)", () => {
  const plan = buildRadarScanPlan(compileCompanyBrainContext({ workspace_id: WORKSPACE, profile: NORTHWIND as never }), { firecrawlReady: false, apifyReady: false });
  assert(plan.source_plan.every((s) => !(s as { enabled?: boolean }).enabled || (s as { status?: string }).status !== "ready"), JSON.stringify(plan.source_plan));
});

// ═══ ONE SIGNAL, TWO TABLES · what ORION can see ══════════════════════════════════════════════
const NOW = new Date("2026-11-28T12:00:00Z");
const legacyRadarRow = { id: "legacy-1", workspace_id: WORKSPACE, signal_type: "competitor", title: "[TEST FIXTURE] Rival launches dispatch app",
  description: "fixture", source_url: "https://rival.example.test/news", source: "firecrawl", created_at: "2026-11-27T09:00:00Z", raw: {} };
const canonicalRow = { id: "ev-1", workspace_id: WORKSPACE, signal_type: "expansion", lifecycle_status: "active", verification_status: "provider_verified",
  confidence: "medium", occurred_at: "2026-11-26", observed_at: "2026-11-27T09:00:00Z", source_url: "https://news.example.test/expansion",
  subject_key: "kestrel-fixture.example.test",
  normalized_value: { lisa: { company: { name: "[TEST FIXTURE] Kestrel Fabrication", domain: "kestrel-fixture.example.test" },
    title: "[TEST FIXTURE] opens a second plant", event_date: "2026-11-26", verification: { level: "corroborated" } } } };
Deno.test("FINDING: a radar signal stored only in legacy `signals` is invisible to ORION's evidence; a canonical one is visible", async () => {
  const onlyLegacy = await retrieveEvidence(fakeDb({ ...seed(), signals: [legacyRadarRow] }) as never, { workspaceId: WORKSPACE, userId: "user-1", now: NOW, limit: 20 });
  assert(onlyLegacy.ok);
  assertFalse(JSON.stringify(onlyLegacy.items).includes("Rival launches"), "legacy radar row not retrieved");
  const canonical = await retrieveEvidence(fakeDb({ ...seed(), signal_events: [canonicalRow] }) as never, { workspaceId: WORKSPACE, userId: "user-1", now: NOW, limit: 20 });
  assert(canonical.ok);
  assert(JSON.stringify(canonical.items).includes("Kestrel"), "canonical signal retrieved");
});

// ═══ SIGNALS PAGE · rendering and controls (static: the page is React, not importable here) ══
const read = (p: string) => Deno.readTextFileSync(new URL(`../../../../${p}`, import.meta.url));
Deno.test("FINDING: LISA's signal types have no card on the Signals page, which passes no fallback (counted, never shown)", () => {
  const router = read("src/components/signals/SignalCardRouter.tsx");
  for (const t of ["expansion", "product_launch", "leadership_change", "technology", "partnership", "acquisition", "pricing"]) {
    assertFalse(router.includes(`"${t}"`), `${t} has a card`);
  }
  assertStringIncludes(router, "default: return <>{fallback ?? null}</>;");
  const list = read("src/components/signals/workspace/SignalsFeedList.tsx");
  assertFalse(list.includes("fallback="), "the page renders no fallback for unknown types");
});
Deno.test("FINDING: Signals page identity — copy says Lyra, card resolves legacy 'scout' (→ Atlas), status reads 'lyra'; registry owner is LISA", () => {
  const page = read("src/pages/Signals.tsx");
  assertStringIncludes(page, "monitored by Lyra");
  assertStringIncludes(page, "resolveAgent('scout')");
  assertStringIncludes(page, "useDepartmentAgentStatus(workspaceId, 'lyra')");
  const registry = read("src/config/agentRegistry.ts");
  assertStringIncludes(registry, "scout: 'atlas'");
  assertStringIncludes(registry, "Monitors competitors and markets");
  const copilot = read("src/components/signals/workspace/ScoutCopilot.tsx");
  assertStringIncludes(copilot, "sendAgentCommand(text");
  assertFalse(/mode[,:]\s*mode|metadata:\s*\{[^}]*mode/.test(copilot), "the selected mode is not sent");
});
Deno.test("FINDING: the review filter on the Signals page is wired to a no-op", () => {
  assertStringIncludes(read("src/pages/Signals.tsx"), "onReviewFilterChange={() => {}}");
});

// ── SIGNALS RECOVERY · the radar plan carries the full Brain targeting ───────────────────────
Deno.test("Radar plan targeting: industries, geography, size, business model, personas, buying signals, jobs, qualification, exclusions, evidence", async () => {
  const t = seed();
  const r = await loadCompanyBrainContext(fakeDb(t) as unknown as LoaderDb, WORKSPACE, { skipMembershipCheck: true });
  assert(r.ok);
  const profile = r.context.effective_profile as Record<string, unknown>;
  const plan = buildRadarScanPlan(compileCompanyBrainContext({ workspace_id: WORKSPACE, profile }), { firecrawlReady: true });
  const tg = plan.targeting;
  assertEquals(tg.industries, ["Manufacturing", "Distribution", "Contracting", "Field services"]);
  assertEquals(tg.locations, ["United States"]);
  assertEquals(tg.company_size, { min: 10, max: 200 });
  assertEquals(tg.business_models, ["B2B"]);
  assertEquals(tg.buyer_personas, ["Operations Manager", "Owner"]);
  assertEquals(tg.buying_signals, ["Hiring growth", "Market expansion", "Technology adoption", "Leadership changes"]);
  assert(tg.excluded_industries.map((x) => x.toLowerCase()).includes("crypto"), "approved memory exclusion");
  assert(tg.evidence_requirements.includes("source_url") && tg.evidence_requirements.includes("event_date"));
});
