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
    monitoring_subjects: [], monitoring_plans: [], signal_events: [], signals: [], request_understanding_log: [], tasks: [], approvals: [],
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

// ═══ ISSUE B · ICP-wide monitoring PLAN — saved as a DRAFT, nothing executed ══════════════════
const DRAFT = "Draft monitoring plan saved — nothing is running";
for (const [label, reading] of [
  ["monitor/company (no name)", modelRequest([{ objective: "monitor", entity: "company", shape: "records" }])],
  ["monitor/market", modelRequest([{ objective: "monitor", entity: "market", shape: "records" }])],
] as const) {
  for (const evidence of [true, false]) {
    Deno.test(`Issue B (${label}, evidence ${evidence ? "on" : "off"}): an ICP-wide DRAFT plan from the Brain; nothing enabled, nothing bought`, async () => {
      const { out, tables, net } = await turn(ISSUE_B, reading, { evidence });
      assertEquals(out.status, 200);
      assertFalse(out.content.includes(CANT_WATCH), out.content);
      assertStringIncludes(out.content, DRAFT);
      assertEquals(tables.monitoring_subjects.length, 0, "no monitoring subject");
      assertEquals(tables.monitoring_plans.length, 1);
      const plan = tables.monitoring_plans[0] as Record<string, unknown>;
      assertEquals([plan.kind, plan.status], ["icp", "draft"]);
      assertEquals(((plan.target as Record<string, unknown>).industries as string[]).slice(0, 2), ["Manufacturing", "Distribution"]);
      assert((plan.signal_categories as string[]).includes("expansion") && (plan.signal_categories as string[]).includes("hiring"));
      assertEquals((plan.constraints as Record<string, unknown>).provider_calls_before_approval, 0);
      assert(((plan.constraints as Record<string, unknown>).respects_exclusions as string[]).some((x) => /crypto/i.test(x)), "approved exclusion honoured");
      assertEquals(net.functionCalls.length, 0, "no scan or provider function called");
    });
  }
}

// ═══ NAMED-COMPANY monitoring ═════════════════════════════════════════════════════════════════
const namedMonitor = modelRequest([{ objective: "monitor", entity: "company", shape: "records",
  references: [{ kind: "named", value: "acme-fixture.example" }] }]);
for (const say of [NAMED_PLAN, NAMED_WATCH]) {
  Deno.test(`FIXED: "${say.slice(0, 40)}…" saves a DRAFT company plan — never an enabled watch`, async () => {
    const { out, tables } = await turn(say, namedMonitor, { evidence: true });
    assertEquals(tables.monitoring_subjects.length, 0, out.content);
    assertEquals(tables.monitoring_plans.length, 1);
    assertEquals((tables.monitoring_plans[0] as Record<string, unknown>).status, "draft");
    assertStringIncludes(out.content, DRAFT);
  });
}
Deno.test("FIXED: a VIEWER cannot create monitoring through chat — refused, nothing saved", async () => {
  const { out, tables } = await turn(NAMED_WATCH, namedMonitor, { evidence: true, role: "viewer" });
  assertEquals(tables.monitoring_subjects.length, 0);
  assertEquals(tables.monitoring_plans.length, 0);
  assertStringIncludes(out.content, "Only an owner, admin or editor");
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
Deno.test("FIXED: the Signals page is LISA's — name, status, copy and panel; the panel sends LISA's mode", () => {
  const page = read("src/pages/Signals.tsx");
  assertStringIncludes(page, "resolveAgent('lisa')");
  assertStringIncludes(page, "useDepartmentAgentStatus(workspaceId, 'lisa')");
  assertFalse(/Lyra|resolveAgent\('scout'\)/.test(page.replace(/\/\/.*$/gm, "")), "no Lyra / scout identity left on the page");
  const copilot = read("src/components/signals/workspace/LisaCopilot.tsx");
  assertStringIncludes(copilot, "action_source: 'signals_lisa'");
  assertStringIncludes(copilot, "metadata: { department: 'lisa', lisa_mode: mode }");
  assertFalse(copilot.includes("INSIGHTS"), "no invented market insights");
  const brief = read("src/components/signals/workspace/TodaysSignalBrief.tsx");
  assertFalse(/Lyra/.test(brief));
  assertStringIncludes(brief, "Monitoring is not active");
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

// ═══ LISA · the Signals specialist, through the real handler ═════════════════════════════════
const LISA_ACTION = (mode: string) => ({ action_source: "signals_lisa", metadata: { department: "lisa", lisa_mode: mode } });
async function lisaTurn(say: string, mode: string, extra: Partial<Record<string, Row[]>> = {}, reading: unknown = modelRequest([{ objective: "converse", entity: "conversation", shape: "answer" }])) {
  const tables = { ...seed(), ...extra } as Record<string, Row[]>;
  const net = installFakeNetwork({ supabaseUrl: SUPABASE_URL, tables, modelReplies: [
    { when: (_u, s) => isBrain(s), content: reading },
    { when: (_u, s) => !isBrain(s), content: "LISA's grounded answer." },
  ] });
  try {
    const out = await sendTurn(say, tables, LISA_ACTION(mode));
    return { out, tables, net, lisa: net.modelCalls.find((c) => c.system.includes("You are LISA")) ?? null };
  } finally { net.restore(); }
}
Deno.test("LISA Brief with zero signals: LISA answers from the Brain, says nothing is recorded or monitored", async () => {
  const { out, lisa, net } = await lisaTurn("Which buying signals should we prioritize, and why?", "brief");
  assertEquals(out.status, 200);
  assert(lisa, "LISA's prompt was used");
  assertStringIncludes(lisa!.system, "TASK (brief)");
  assertStringIncludes(lisa!.system, '<recorded_signals count="0">');
  assertStringIncludes(lisa!.system, "Market expansion", "the Brain's declared buying signals");
  assertStringIncludes(lisa!.system, "Crypto", "approved memory");
  assertStringIncludes(lisa!.system, "no monitoring plan is active");
  assertEquals((out.reply as Record<string, unknown>).agent_slug, "lisa");
  assertFalse(net.modelCalls.some((c) => isBrain(c.system)), "no understanding call for a LISA brief");
});
Deno.test("LISA Analyze with a canonical [TEST FIXTURE] signal: the row is cited as [S1] with its provenance", async () => {
  const { lisa } = await lisaTurn("Analyse the strongest recorded signal", "analyze", { signal_events: [canonicalRow] });
  assertStringIncludes(lisa!.system, "TASK (analyze)");
  assertStringIncludes(lisa!.system, "[S1] [TEST FIXTURE] Kestrel Fabrication: [TEST FIXTURE] opens a second plant");
  assertStringIncludes(lisa!.system, "verification corroborated");
  assertStringIncludes(lisa!.system, "source https://news.example.test/expansion");
});
Deno.test("LISA Watch: a monitoring DRAFT from the Brain — nothing enabled, LISA attributed", async () => {
  const { out, tables } = await lisaTurn("Watch for US manufacturers and distributors that are expanding", "watch", {},
    modelRequest([{ objective: "read", entity: "company", shape: "records" }]));
  assertEquals(tables.monitoring_subjects.length, 0);
  assertEquals(tables.monitoring_plans.length, 1);
  assertEquals((tables.monitoring_plans[0] as Record<string, unknown>).kind, "icp");
  assertStringIncludes(out.content, "Draft monitoring plan saved — nothing is running");
});

// ═══ PHASE 2 · the signals collectors write the canonical store by default ═══════════════════
import { isCanonicalSignalWriteEnabled, isSignalsV2Enabled } from "../../../../supabase/functions/_shared/signalsV2Flag.ts";
Deno.test("Canonical writes: on by default for the signals collectors; an explicit off still turns them off; the strict flag is unchanged", () => {
  assertEquals(isCanonicalSignalWriteEnabled(() => undefined), true);
  for (const off of ["false", "0", "off", "disabled", " FALSE "]) assertEquals(isCanonicalSignalWriteEnabled(() => off), false, off);
  assertEquals(isCanonicalSignalWriteEnabled(() => "true"), true);
  assertEquals(isSignalsV2Enabled(() => undefined), false, "ATLAS paths keep the strict default-off flag");
  for (const f of ["supabase/functions/run-radar-scan/index.ts", "supabase/functions/run-monitoring-scan/index.ts"]) {
    assertStringIncludes(read(f), "isCanonicalSignalWriteEnabled()");
  }
});
