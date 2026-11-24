// PHASE 5 — multi-agent collaboration against a REAL database.
//
// Real Postgres + PostgREST + supabase-js + the REAL agent-collaboration
// handler, the real Company Brain loader / memory / proposal RPCs and the real
// LISA V2 signal writer. Mocked: the search provider (recorded fictional hits)
// and ATLAS's research OUTCOME (a synthetic, recorded result posted to the
// service-key hook — no discovery runs). Fictional companies only.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, memoryWrite, opts, person, review, sql, team, uuid, type Person } from "./lib/brainMemory.ts";
import { seedWorkspace } from "./lib/harness.ts";
import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { rpcSignalStore } from "../../supabase/functions/_shared/lisa/persistence.ts";
import { handleCollab, type AdminClient } from "../../supabase/functions/agent-collaboration/handler.ts";
import { loadFixture, replay } from "../edge-functions/_shared/lisa/lisaFixtures.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const EVEREST = {
  schema_version: 2,
  company: { name: "Everest Industrial Automation", description: "Industrial automation for mid-sized plants" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"], company_size: { min: 50, max: 500 } },
  brand_voice: { tone: "Professional" },
  goals: { primary: "Win US manufacturers expanding production capacity" },
};

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;
const svc = async (): Promise<Svc> => await as("service_role");
async function brainOf(ws: string): Promise<SharedBrainContext> {
  const r = await loadCompanyBrainContext((await svc()) as unknown as LoaderDb, ws, { skipMembershipCheck: true, now: NOW });
  if (!r.ok) throw new Error(r.error);
  return r.context;
}

// Tokens: a fake JWT whose payload carries the REAL session id; userIdFor maps it to the person.
const tokens = new Map<string, string>();
const tokenFor = (p: Person) => { const t = `h.${btoa(JSON.stringify({ session_id: p.session })).replace(/=+$/, "")}.s`; tokens.set(t, p.id); return t; };
const ENV: Record<string, string> = { AGENT_COLLAB_ENABLED: "true", LISA_V2_ENABLED: "true", SUPABASE_SERVICE_ROLE_KEY: "svc-test-key" };
async function call(body: Record<string, unknown>, token: string, env = ENV) {
  const res = await handleCollab(new Request("http://local/agent-collaboration", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
    { env: (k) => env[k], admin: (await svc()) as AdminClient, userIdFor: (t) => Promise.resolve(tokens.get(t) ?? null), now: () => NOW });
  return { status: res.status, body: await res.json() };
}

/** Everest's workspace with an owner/editor/viewer, an existing-customer exclusion, and LISA's Northstar signal stored. */
async function everest(fixture = "northstar_expansion") {
  const t = await team(EVEREST);
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.company:granite-works",
    value_type: "object", value: { type: "company", value: "Granite Works" }, reason: "existing customer" });
  const r = await replay(loadFixture(fixture), { brain: await brainOf(t.ws), store: rpcSignalStore(await svc()), workspace_id: t.ws });
  assertEquals(r.counts.persist_failed, 0);
  const [sig] = await sql`select id from public.signal_events where workspace_id = ${t.ws} order by observed_at desc limit 1`;
  return { ...t, signal: sig.id as string, ed: tokenFor(t.editor), ow: tokenFor(t.owner), vw: tokenFor(t.viewer) };
}
const handoffs = async (ws: string) => await sql`select * from public.agent_handoffs where workspace_id = ${ws} order by created_at`;
const events = async (id: string) => await sql`select from_status, to_status, actor from public.agent_handoff_events where handoff_id = ${id} order by id`;
const board = async (ws: string, token: string) => (await call({ action: "board", workspace_id: ws }, token)).body.board;
async function proposeAll(e: Awaited<ReturnType<typeof everest>>) {
  const r = await call({ action: "propose", workspace_id: e.ws, signal_id: e.signal }, e.ed);
  const atlas = r.body.results.find((x: { kind: string }) => x.kind === "atlas_research");
  const lyra = r.body.results.find((x: { kind: string }) => x.kind === "lyra_content");
  return { r, atlas, lyra };
}
const report = async (ws: string, id: string, stage: string, result?: Record<string, unknown>) =>
  await call({ action: "atlas_report", workspace_id: ws, handoff_id: id, stage, ...(result ? { result } : {}) }, "svc-test-key");

// ════════════════════ the complete workflow (section 11) ═════════════════════
Deno.test("WORKFLOW: LISA signal → Brain → ORION proposal → approval → ATLAS plan → ATLAS result → LYRA draft → Brain proposal → board", opts, async () => {
  const e = await everest();
  // 1. LISA stored a sourced, corroborated expansion signal and explained it.
  const [row] = await sql`select * from public.signal_events where id = ${e.signal}`;
  assertEquals(row.normalized_value.lisa.verification.level, "corroborated");
  assertEquals((await sql`select count(*)::int n from public.signal_event_evidence where signal_event_id = ${e.signal}`)[0].n, 3);
  // 2-3. ORION reads it with the Brain and proposes ATLAS research + LYRA content.
  const b0 = await board(e.ws, e.vw);
  const item = b0.items.find((i: { signal_id: string }) => i.signal_id === e.signal);
  assert(item.trusted); assertEquals(item.attention, "executive"); assertEquals(item.discovered_by, "lisa");
  assert(item.what_happened.includes("confirmed by 2 independent sources"));
  assert(/may be worth researching because its expansion aligns with your target manufacturing market/.test(item.inferred_opportunity));
  assert(item.inferred_opportunity.includes("inference, not a confirmed buying intent"));
  assertEquals(item.actions.map((a: { kind: string; status: string }) => `${a.kind}:${a.status}`), ["atlas_research:not_proposed", "lyra_content:not_proposed"]);
  const { atlas, lyra } = await proposeAll(e);
  assertEquals(atlas.outcome, "created"); assertEquals(lyra.outcome, "created");
  const [h] = (await handoffs(e.ws)).filter((x) => x.kind === "atlas_research");
  assertEquals(h.status, "awaiting_review");
  assertEquals(h.payload.company, { name: "Northstar Manufacturing", domain: "northstar.example", domain_verified: true });
  assertEquals(h.payload.icp.industries, ["Manufacturing"]);
  assertEquals(h.payload.icp.company_size, { min: 50, max: 500 });
  assert(h.payload.exclusions.companies.includes("Granite Works"));
  assertEquals(h.payload.guardrails.contact_enrichment, false); assertEquals(h.payload.guardrails.outreach, false);
  assertEquals(h.brain_fingerprint, (await brainOf(e.ws)).fingerprint);
  // Not approved → no plan.
  assertEquals((await call({ action: "atlas_plan", workspace_id: e.ws, handoff_id: h.id }, e.vw)).status, 409);
  // 4. A person approves.
  const ap = await call({ action: "decide", workspace_id: e.ws, handoff_id: h.id, decision: "approve" }, e.ed);
  assertEquals(ap.body.outcome, "ok");
  // 5. ATLAS receives a scoped, prefilled plan (it still launches as an approved mission in Leads).
  const plan = await call({ action: "atlas_plan", workspace_id: e.ws, handoff_id: h.id }, e.vw);
  assertEquals(plan.status, 200);
  assert(plan.body.plan.query.startsWith("Research Northstar Manufacturing (northstar.example)"));
  assertEquals(plan.body.plan.requested_count, 1);
  // 6. ATLAS reports (recorded, synthetic result) → ORION reads it.
  const [lead] = await sql`insert into public.lead_candidates (workspace_id, status, reason) values (${e.ws}, 'new', 'fictional') returning id`;
  assertEquals((await report(e.ws, h.id, "queued")).body.ok, true);
  assertEquals((await report(e.ws, h.id, "running")).body.ok, true);
  const res = await report(e.ws, h.id, "result", { qualification: "qualified", persisted: true, lead_candidate_id: lead.id,
    reasons: ["US manufacturer, ~300 employees", "new Texas production capacity"], confidence: "medium",
    execution: { status: "completed", stages_completed: ["company_research", "icp_qualification"], error: null },
    budget: { credits_reserved: 2, credits_charged: 2, status: "within_budget" }, contacts: { count: 2, independently_verified: true } });
  assertEquals(res.body.status, "completed");
  assert(res.body.summary.startsWith("ATLAS qualified Northstar Manufacturing"));
  assert(res.body.summary.includes("not independently verified"), "provider contacts are never presented as verified");
  const [done] = await sql`select * from public.agent_handoffs where id = ${h.id}`;
  assertEquals(done.result.contacts.independently_verified, false);
  assertEquals(done.lead_ids, [lead.id]);
  // 8. ATLAS's feedback → a PENDING Brain proposal.
  assertEquals(res.body.proposals[0].outcome, "created");
  assertEquals((await sql`select status from public.company_brain_memory_proposals where workspace_id = ${e.ws} and proposed_by_agent = 'atlas'`)[0].status, "pending");
  // 7. LYRA: approve → one unpublished draft carrying LISA's sources.
  assertEquals((await call({ action: "decide", workspace_id: e.ws, handoff_id: lyra.id, decision: "approve" }, e.ow)).body.outcome, "ok");
  const d = await call({ action: "lyra_draft", workspace_id: e.ws, handoff_id: lyra.id }, e.ed);
  assertEquals(d.body.outcome, "created"); assertEquals(d.body.published, false);
  const [ci] = await sql`select * from public.content_item where id = ${d.body.content_item_id}`;
  assertEquals(ci.status, "draft"); assertEquals(ci.agent_slug, "lyra"); assertEquals(ci.source_signal_id, e.signal);
  for (const u of ["https://texas-industry-news.example/northstar-plant", "https://plantfloor-weekly.example/2026/11/northstar-texas"]) assert(ci.body.includes(u));
  // 9. The board shows the whole lifecycle, linked to the evidence.
  const b1 = await board(e.ws, e.vw);
  const it = b1.items.find((i: { signal_id: string }) => i.signal_id === e.signal);
  assertEquals(it.actions.map((a: { kind: string; status: string }) => `${a.kind}:${a.status}`), ["atlas_research:completed", "lyra_content:completed"]);
  assert(it.evidence.some((x: { url: string }) => x.url === "https://northstar.example/news/texas-facility"));
  assertEquals(b1.completed, 2);
  assertEquals((await events(h.id)).map((x) => x.to_status), ["awaiting_review", "approved", "queued", "running", "completed"]);
});

// ════════════════════════════ the 24 scenarios ════════════════════════════════
Deno.test("S01 verified LISA signal becomes a trusted ORION recommendation (with confirmed vs inferred kept apart)", opts, async () => {
  const e = await everest();
  const it = (await board(e.ws, e.vw)).items[0];
  assert(it.trusted); assertEquals(it.verification, "corroborated");
  assertNotEquals(it.what_happened, it.inferred_opportunity);
});

Deno.test("S02 unsupported (single-source) signal is not trusted; neither ORION nor the database lets it back research", opts, async () => {
  const e = await everest("northstar_rumour");
  const it = (await board(e.ws, e.vw)).items[0];
  assertEquals(it.trusted, false); assertEquals(it.actions, []);
  const p = await call({ action: "propose", workspace_id: e.ws, signal_id: e.signal }, e.ed);
  assertEquals(p.status, 409); assertEquals(p.body.blocked, "unverified");
  // Even a direct service call is refused by the database.
  const { data } = await (await svc()).rpc("agent_handoff_propose", { p_workspace_id: e.ws, p_handoff: { contract_version: "agent-collab-v1",
    workspace_id: e.ws, source_agent: "orion", target_agent: "atlas", kind: "atlas_research", company: { name: "Northstar Manufacturing" },
    signal_ids: [e.signal], reason: "forced", requires_approval: true, idempotency_key: "forced:1" } });
  assertEquals(data.outcome, "signal_unverified");
  assertEquals((await handoffs(e.ws)).length, 0);
});

async function lifecycle(e: Awaited<ReturnType<typeof everest>>, action: string) {
  const { data } = await (await svc()).rpc("lisa_signal_transition", { p_workspace_id: e.ws, p_actor_id: e.editor.id, p_session_id: e.editor.session,
    p_signal_event_id: e.signal, p_action: action, p_reason: "fictional" });
  assertEquals(data[0].outcome, "ok");
}

Deno.test("S03 a dismissed (rejected) signal is excluded from recommendations", opts, async () => {
  const e = await everest();
  await lifecycle(e, "dismiss");
  const it = (await board(e.ws, e.vw)).items[0];
  assertEquals(it.trusted, false);
  assertEquals((await call({ action: "propose", workspace_id: e.ws, signal_id: e.signal }, e.ed)).status, 409);
});

Deno.test("S04 a retracted signal is excluded — and one retracted while awaiting review blocks approval", opts, async () => {
  const e = await everest();
  const { atlas } = await proposeAll(e);
  await lifecycle(e, "retract");
  const it = (await board(e.ws, e.vw)).items[0];
  assertEquals(it.trusted, false);
  const ap = await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "approve" }, e.ed);
  assertEquals(ap.status, 409);
  assertNotEquals((await sql`select status from public.agent_handoffs where id = ${atlas.id}`)[0].status, "approved");
});

Deno.test("S05 a Company Brain exclusion (existing customer) blocks the recommendation", opts, async () => {
  const e = await everest();
  await memoryWrite(e.ws, e.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.company:northstar",
    value_type: "object", value: { type: "company", value: "Northstar Manufacturing" }, reason: "existing customer" });
  const it = (await board(e.ws, e.vw)).items[0];
  assertEquals(it.trusted, false);
  assert(String(it.blocked).includes("Northstar Manufacturing"));
});

Deno.test("S06 ORION proposes ATLAS research: awaiting review, scoped, nothing runs", opts, async () => {
  const e = await everest();
  const { atlas } = await proposeAll(e);
  assertEquals(atlas.status, "awaiting_review");
  const [h] = (await handoffs(e.ws)).filter((x) => x.kind === "atlas_research");
  assertEquals(h.requires_approval, true);
  assertEquals(h.payload.guardrails.paid_discovery, "requires_mission_approval");
  assertEquals((await sql`select count(*)::int n from public.credit_transactions where workspace_id = ${e.ws}`)[0].n, 0, "no credit reserved");
});

Deno.test("S07 a viewer cannot propose or approve — refused by the endpoint AND in the transaction", opts, async () => {
  const e = await everest();
  assertEquals((await call({ action: "propose", workspace_id: e.ws, signal_id: e.signal }, e.vw)).status, 403);
  const { atlas } = await proposeAll(e);
  assertEquals((await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "approve" }, e.vw)).status, 403);
  const { data } = await (await svc()).rpc("agent_handoff_decide", { p_workspace_id: e.ws, p_actor_id: e.viewer.id, p_session_id: e.viewer.session,
    p_handoff_id: atlas.id, p_decision: "approve", p_note: null });
  assertEquals(data[0].outcome, "forbidden_role");
  const bad = await (await svc()).rpc("agent_handoff_decide", { p_workspace_id: e.ws, p_actor_id: e.editor.id, p_session_id: uuid(),
    p_handoff_id: atlas.id, p_decision: "approve", p_note: null });
  assertEquals(bad.data[0].outcome, "session_invalid");
  assertEquals((await sql`select status from public.agent_handoffs where id = ${atlas.id}`)[0].status, "awaiting_review");
});

Deno.test("S08 a rejected proposal cannot execute; a cancelled one cannot run later", opts, async () => {
  const e = await everest();
  const { atlas, lyra } = await proposeAll(e);
  assertEquals((await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "reject" }, e.ed)).body.outcome, "ok");
  assertEquals((await report(e.ws, atlas.id, "queued")).status, 409);
  assertEquals((await call({ action: "atlas_plan", workspace_id: e.ws, handoff_id: atlas.id }, e.vw)).status, 409);
  await call({ action: "decide", workspace_id: e.ws, handoff_id: lyra.id, decision: "approve" }, e.ed);
  assertEquals((await call({ action: "decide", workspace_id: e.ws, handoff_id: lyra.id, decision: "cancel" }, e.ed)).body.outcome, "ok");
  assertEquals((await call({ action: "lyra_draft", workspace_id: e.ws, handoff_id: lyra.id }, e.ed)).body.outcome, "not_approved");
  assertEquals((await sql`select count(*)::int n from public.content_item where workspace_id = ${e.ws}`)[0].n, 0);
});

Deno.test("S09 duplicate signals / repeated proposals do not create duplicate research tasks", opts, async () => {
  const e = await everest();
  await proposeAll(e);
  const again = await proposeAll(e);
  assertEquals(again.atlas.outcome, "duplicate");
  // The same signal stored again by a second LISA pass is still ONE event and ONE handoff.
  await replay(loadFixture("northstar_expansion"), { brain: await brainOf(e.ws), store: rpcSignalStore(await svc()), workspace_id: e.ws });
  assertEquals((await sql`select count(*)::int n from public.signal_events where workspace_id = ${e.ws}`)[0].n, 1);
  assertEquals((await handoffs(e.ws)).filter((h) => h.kind === "atlas_research").length, 1);
});

async function approvedResearch() {
  const e = await everest();
  const { atlas } = await proposeAll(e);
  await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "approve" }, e.ed);
  return { e, id: atlas.id as string };
}

Deno.test("S10 ATLAS rejects an unsuitable company: completed with reasons, a PENDING not-a-fit proposal", opts, async () => {
  const { e, id } = await approvedResearch();
  const r = await report(e.ws, id, "result", { qualification: "rejected", persisted: true, reasons: ["12 employees, below your 50-500 range"],
    execution: { status: "completed", stages_completed: ["icp_qualification"], error: null } });
  assertEquals(r.body.status, "completed");
  assert(r.body.summary.includes("does not fit your ICP"));
  const [p] = await sql`select status, value from public.company_brain_memory_proposals where workspace_id = ${e.ws} and proposed_by_agent = 'atlas'`;
  assertEquals(p.status, "pending");
});

Deno.test("S11 ATLAS returns a qualified company — only with a saved lead in the SAME workspace", opts, async () => {
  const { e, id } = await approvedResearch();
  const other = await seedWorkspace();
  const [foreign] = await sql`insert into public.lead_candidates (workspace_id, status) values (${other}, 'new') returning id`;
  const { data } = await (await svc()).rpc("agent_handoff_advance", { p_workspace_id: e.ws, p_handoff_id: id, p_agent: "atlas", p_expected: "approved", p_to: "queued" });
  assertEquals(data.outcome, "ok");
  await (await svc()).rpc("agent_handoff_advance", { p_workspace_id: e.ws, p_handoff_id: id, p_agent: "atlas", p_expected: "queued", p_to: "running" });
  const forged = await (await svc()).rpc("agent_handoff_advance", { p_workspace_id: e.ws, p_handoff_id: id, p_agent: "atlas", p_expected: "running",
    p_to: "completed", p_result: { persisted: true, qualification: "qualified", lead_candidate_id: foreign.id } });
  assertEquals(forged.data.outcome, "lead_not_in_workspace");
  const [lead] = await sql`insert into public.lead_candidates (workspace_id, status) values (${e.ws}, 'new') returning id`;
  const r = await report(e.ws, id, "result", { qualification: "qualified", persisted: true, lead_candidate_id: lead.id, confidence: "high",
    execution: { status: "completed", stages_completed: [], error: null } });
  assertEquals(r.body.status, "completed");
});

Deno.test("S12 ATLAS fails after partial processing → partially_completed, honestly described", opts, async () => {
  const { e, id } = await approvedResearch();
  const r = await report(e.ws, id, "result", { qualification: "rejected", persisted: true, reasons: ["size unknown"],
    execution: { status: "partial", stages_completed: ["company_research"], error: "qualification step timed out" } });
  assertEquals(r.body.status, "partially_completed");
  assert(r.body.summary.includes("Some research steps did not finish"));
  const [h] = await sql`select status, error from public.agent_handoffs where id = ${id}`;
  assertEquals(h.status, "partially_completed"); assert(h.error);
});

Deno.test("S13 a failed persistence never produces a completed status (endpoint and database)", opts, async () => {
  const { e, id } = await approvedResearch();
  const r = await report(e.ws, id, "result", { qualification: "qualified", persisted: false, execution: { status: "completed", stages_completed: [], error: "lead write failed" } });
  assertEquals(r.body.status, "failed");
  assert(r.body.summary.includes("did not save a result"));
  const { e: e2, id: id2 } = await approvedResearch();
  const db = await svc();
  await db.rpc("agent_handoff_advance", { p_workspace_id: e2.ws, p_handoff_id: id2, p_agent: "atlas", p_expected: "approved", p_to: "queued" });
  await db.rpc("agent_handoff_advance", { p_workspace_id: e2.ws, p_handoff_id: id2, p_agent: "atlas", p_expected: "queued", p_to: "running" });
  const { data } = await db.rpc("agent_handoff_advance", { p_workspace_id: e2.ws, p_handoff_id: id2, p_agent: "atlas", p_expected: "running", p_to: "completed", p_result: { qualification: "rejected" } });
  assertEquals(data.outcome, "not_persisted");
  // And the table refuses it even for a superuser write.
  let refused = false;
  try { await sql`update public.agent_handoffs set status = 'completed', result = '{}'::jsonb where id = ${id2}`; } catch { refused = true; }
  assert(refused, "agent_handoffs_completed_persisted CHECK");
});

Deno.test("S14/S15/S16 LISA evidence reaches LYRA; uncertainty is preserved; the draft stays unpublished and single", opts, async () => {
  const e = await everest();
  const { lyra } = await proposeAll(e);
  const [h] = await sql`select payload from public.agent_handoffs where id = ${lyra.id}`;
  const brief = h.payload.brief;
  assertEquals(brief.sources.length, 3);
  assertEquals(brief.brand.tone, "Professional");
  assertEquals(brief.claims[0].status, "confirmed");
  assert(brief.claims.some((c: { status: string }) => c.status === "uncertain"), "the inferred opportunity stays uncertain");
  assert(brief.restrictions.some((r: string) => r.includes("compare us with any competitor")));
  await call({ action: "decide", workspace_id: e.ws, handoff_id: lyra.id, decision: "approve" }, e.ed);
  const d1 = await call({ action: "lyra_draft", workspace_id: e.ws, handoff_id: lyra.id }, e.ed);
  const d2 = await call({ action: "lyra_draft", workspace_id: e.ws, handoff_id: lyra.id }, e.ed);
  assertEquals(d2.body.outcome, "duplicate"); assertEquals(d2.body.content_item_id, d1.body.content_item_id);
  const items = await sql`select status, metadata from public.content_item where workspace_id = ${e.ws}`;
  assertEquals(items.length, 1);
  assertEquals(items[0].status, "draft");
  assertEquals(items[0].metadata.review_required, true);
  assert(items[0].metadata.needs_confirmation.length >= 1);
});

Deno.test("S17/S18 agent knowledge stays pending; once approved, ORION stops recommending the not-a-fit company", opts, async () => {
  const { e, id } = await approvedResearch();
  await report(e.ws, id, "result", { qualification: "rejected", persisted: true, reasons: ["services firm, not a manufacturer"],
    execution: { status: "completed", stages_completed: [], error: null } });
  assert(!(await brainOf(e.ws)).facts.some((f) => f.category === "account_fit"), "pending is not knowledge");
  assertEquals((await board(e.ws, e.vw)).items[0].trusted, true);
  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${e.ws} and proposed_by_agent = 'atlas'`;
  assertEquals((await review(e.ws, e.owner, p.id, "approve")).outcome, "ok");
  assert((await brainOf(e.ws)).facts.some((f) => f.category === "account_fit"));
  const it = (await board(e.ws, e.vw)).items[0];
  assertEquals(it.trusted, false);
  assert(String(it.blocked).includes("not a fit"));
});

Deno.test("S18b a rejected knowledge proposal never influences agents", opts, async () => {
  const { e, id } = await approvedResearch();
  await report(e.ws, id, "result", { qualification: "rejected", persisted: true, reasons: ["x"], execution: { status: "completed", stages_completed: [], error: null } });
  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${e.ws} and proposed_by_agent = 'atlas'`;
  assertEquals((await review(e.ws, e.owner, p.id, "reject", { note: "they are a fit" })).outcome, "ok");
  assertEquals((await board(e.ws, e.vw)).items[0].trusted, true);
});

Deno.test("S19 a Company Brain change invalidates stale context: approval re-checks against the CURRENT Brain", opts, async () => {
  const e = await everest();
  const { atlas } = await proposeAll(e);
  await memoryWrite(e.ws, e.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.company:northstar",
    value_type: "object", value: { type: "company", value: "Northstar Manufacturing" } });
  const b = await board(e.ws, e.vw);
  const stale = b.items[0].actions.find((a: { handoff_id: string }) => a.handoff_id === atlas.id);
  assertEquals(stale.no_longer_recommended, true);
  assertEquals(stale.stale_context, true);
  const ap = await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "approve" }, e.ed);
  assertEquals(ap.status, 409); assertEquals(ap.body.error, "brain_changed_not_recommended");
  assertEquals((await call({ action: "decide", workspace_id: e.ws, handoff_id: atlas.id, decision: "cancel" }, e.ed)).body.outcome, "ok");
});

Deno.test("S20 two workspaces stay isolated", opts, async () => {
  const a = await everest();
  const b = await everest();
  const { atlas } = await proposeAll(a);
  // B's member cannot see or act on A.
  assertEquals((await call({ action: "board", workspace_id: a.ws }, b.vw)).status, 403);
  assertEquals((await call({ action: "decide", workspace_id: b.ws, handoff_id: atlas.id, decision: "approve" }, b.ed)).status, 404);
  const { data } = await (await svc()).rpc("agent_handoff_decide", { p_workspace_id: b.ws, p_actor_id: b.editor.id, p_session_id: b.editor.session,
    p_handoff_id: atlas.id, p_decision: "approve", p_note: null });
  assertEquals(data[0].outcome, "not_found");
  // A's signal cannot back a handoff in B.
  assertEquals((await call({ action: "propose", workspace_id: b.ws, signal_id: a.signal }, b.ed)).status, 404);
  const forged = await (await svc()).rpc("agent_handoff_propose", { p_workspace_id: b.ws, p_handoff: { contract_version: "agent-collab-v1", workspace_id: b.ws,
    source_agent: "orion", target_agent: "lyra", kind: "lyra_content", signal_ids: [a.signal], reason: "x", requires_approval: true, idempotency_key: "x:y" } });
  assertEquals(forged.data.outcome, "signal_not_in_workspace");
  // Members read only their own ledger.
  const bRead = await (await as("authenticated", b.viewer.id)).from("agent_handoffs").select("id").eq("workspace_id", a.ws);
  assertEquals(bRead.data ?? [], []);
  const browser = await (await as("authenticated", a.editor.id)).from("agent_handoffs").update({ status: "approved" }).eq("id", atlas.id).select("id");
  assert(browser.error || (browser.data ?? []).length === 0, "no browser write to the ledger");
  assertEquals((await sql`select status from public.agent_handoffs where id = ${atlas.id}`)[0].status, "awaiting_review");
});

Deno.test("S21 missing Company Brain: an honest fallback — no research recommended", opts, async () => {
  const ws = await seedWorkspace();
  const ed = await person(); await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${ed.id}, 'editor')`;
  // The signal comes from a watched company (no Brain → no ICP market watch).
  const f = loadFixture("northstar_expansion");
  f.subject = { kind: "tracked_company", domain: "northstar.example", name: "Northstar Manufacturing", origin: "watchlist", categories: ["expansion"], cadence_minutes: 10080 };
  await replay(f, { brain: null, store: rpcSignalStore(await svc()), workspace_id: ws });
  const tok = tokenFor(ed);
  const it = (await board(ws, tok)).items[0];
  assertEquals(it.inferred_opportunity, null);
  assertEquals(it.actions.map((a: { kind: string }) => a.kind), ["orion_review"]);
  const [sig] = await sql`select id from public.signal_events where workspace_id = ${ws}`;
  const p = await call({ action: "propose", workspace_id: ws, signal_id: sig.id, kinds: ["atlas_research"] }, tok);
  assertEquals(p.body.results[0].outcome, "not_recommended");
});

Deno.test("S22 provider budget exhaustion blocks execution — terminal, no proposal, nothing completes later", opts, async () => {
  const { e, id } = await approvedResearch();
  const r = await report(e.ws, id, "result", { qualification: "blocked_budget", persisted: true, budget: { credits_reserved: 0, credits_charged: 0, status: "exhausted" } });
  assertEquals(r.body.status, "blocked");
  assertEquals(r.body.proposals, []);
  assertEquals((await report(e.ws, id, "queued")).status, 409);
});

Deno.test("S23 concurrent requests do not duplicate work", opts, async () => {
  const e = await everest();
  const outs = await Promise.all([1, 2, 3].map(() => call({ action: "propose", workspace_id: e.ws, signal_id: e.signal, kinds: ["atlas_research"] }, e.ed)));
  const kinds = outs.map((o) => o.body.results[0].outcome).sort();
  assertEquals(kinds.filter((k) => k === "created").length, 1);
  assertEquals((await handoffs(e.ws)).length, 1);
  const id = outs.find((o) => o.body.results[0].outcome === "created")!.body.results[0].id;
  const two = await Promise.all([e.ed, e.ow].map((t) => call({ action: "decide", workspace_id: e.ws, handoff_id: id, decision: "approve" }, t)));
  assertEquals(two.map((x) => x.body.outcome).sort(), ["invalid_transition", "ok"]);
  const lyraTwice = await Promise.all([1, 2].map(() => report(e.ws, id, "queued")));
  assertEquals(lyraTwice.filter((x) => x.body.ok).length, 1);
});

Deno.test("S24 replay produces stable results: same board, same keys", opts, async () => {
  const e = await everest();
  await proposeAll(e);
  const a = await board(e.ws, e.vw);
  const b = await board(e.ws, e.vw);
  assertEquals(a, b);
  const [h] = await handoffs(e.ws);
  assertEquals(h.idempotency_key.startsWith("atlas_research:northstar-example:"), true);
});

Deno.test("disabled by default: 409 with nothing read or written", opts, async () => {
  const e = await everest();
  const r = await call({ action: "propose", workspace_id: e.ws, signal_id: e.signal }, e.ed, { SUPABASE_SERVICE_ROLE_KEY: "x" });
  assertEquals(r.status, 409);
  assertEquals((await handoffs(e.ws)).length, 0);
  const r2 = await call({ action: "board", workspace_id: e.ws }, e.vw, { AGENT_COLLAB_ENABLED: "true" });
  assertEquals(r2.status, 409, "needs LISA V2 too");
});

Deno.test("S07b ATLAS results are accepted only from the service key, never from a user (even an owner)", opts, async () => {
  const { e, id } = await approvedResearch();
  for (const tok of [e.ow, e.ed]) {
    const r = await call({ action: "atlas_report", workspace_id: e.ws, handoff_id: id, stage: "result", result: { qualification: "qualified", persisted: true } }, tok);
    assertEquals(r.status, 403);
  }
  // And the database refuses a browser call outright.
  const { error } = await (await as("authenticated", e.owner.id)).rpc("agent_handoff_advance", { p_workspace_id: e.ws, p_handoff_id: id, p_agent: "atlas", p_expected: "approved", p_to: "queued" });
  assert(error);
  assertEquals((await sql`select status from public.agent_handoffs where id = ${id}`)[0].status, "approved");
});
