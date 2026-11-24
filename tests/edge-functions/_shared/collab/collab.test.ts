// Phase 5 collaboration — pure-module tests over fictional fixtures. No network, no database.
import { assert, assertEquals, assertFalse, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainFrom, loadFixture, replay } from "../lisa/lisaFixtures.ts";
import { toAgentSignal, type AgentSignal, type StoredSignalRow } from "../../../../supabase/functions/_shared/lisa/weekly.ts";
import type { LisaSignal } from "../../../../supabase/functions/_shared/lisa/types.ts";
import {
  canTransition, COLLAB_CONTRACT_VERSION, HANDOFF_STATUSES, handoffError, idempotencyKeyFor, TRANSITIONS, type Handoff,
} from "../../../../supabase/functions/_shared/collab/contract.ts";
import { assessForOrion } from "../../../../supabase/functions/_shared/collab/lisaToOrion.ts";
import { atlasPreflight, buildAtlasResearchHandoff } from "../../../../supabase/functions/_shared/collab/orionToAtlas.ts";
import { atlasResultFromMission, handoffStatusFor, normalizeAtlasResult, orionReads } from "../../../../supabase/functions/_shared/collab/atlasToOrion.ts";
import { buildLyraBrief, draftFromBrief } from "../../../../supabase/functions/_shared/collab/lisaToLyra.ts";
import { atlasFitProposal } from "../../../../supabase/functions/_shared/collab/brainFeedback.ts";
import { buildCollaborationBoard, type HandoffRow } from "../../../../supabase/functions/_shared/collab/board.ts";
import { atlasView, lyraView } from "../../../../supabase/functions/_shared/companyBrainAgentViews.ts";
import { pathTo } from "../../../../supabase/functions/agent-collaboration/handler.ts";
import { compileCompanyBrainContext } from "../../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { effectiveIndustryExclusions } from "../../../../supabase/functions/_shared/brainIndustryExclusions.ts";
import { buildRadarScanPlan } from "../../../../supabase/functions/_shared/radarScanPlanner.ts";
import { loadMissionContext, loadMissionContextWithMemory } from "../../../../supabase/functions/_shared/intelligence/missionContext.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const SIG = "bbbbbbbb-0000-4000-8000-000000000002";
const EVEREST = brainFrom({ industries: ["Manufacturing"], geography: ["United States"], competitors: [], excludeCompanies: ["Granite Works"] });

function asRow(s: LisaSignal, id: string, over: Partial<StoredSignalRow> = {}): StoredSignalRow {
  return { id, workspace_id: WS, signal_type: s.signal_type, lifecycle_status: s.lifecycle_status, verification_status: s.verification.column_status,
    confidence: s.verification.confidence, occurred_at: s.event_date, observed_at: s.discovered_at, source_url: s.source_url,
    subject_type: s.subject_type, subject_key: s.subject_key,
    normalized_value: { lisa: { category: s.category, company: { name: s.company_name, domain: s.company_domain }, title: s.title,
      description: s.description, event_date: s.event_date, discovered_at: s.discovered_at, event_instance: s.event_instance,
      source_type: s.source_type, watch_origin: s.watch_origin, verification: s.verification, relevance: s.relevance } }, ...over };
}
async function signal(fixture = "northstar_expansion", brain = EVEREST, over: Partial<StoredSignalRow> = {}, tracked = false): Promise<AgentSignal> {
  const f = loadFixture(fixture);
  if (tracked) f.subject = { kind: "tracked_company", domain: "northstar.example", name: "Northstar Manufacturing", origin: "watchlist", categories: ["expansion"], cadence_minutes: 10080 };
  const r = await replay(f, { brain });
  const [s] = [...(r.store as unknown as { events: Map<string, LisaSignal> }).events.values()];
  return toAgentSignal(asRow(s, SIG, over), brain, NOW, s.evidence.map((e) => ({ url: e.url, domain: e.domain })))!;
}

// ── contract ──
Deno.test("contract: transitions mirror the SQL; terminal states never move; idempotency keys ignore time and order", () => {
  const sql = Deno.readTextFileSync(new URL("../../../../supabase/migrations-held/20261112120000_agent_collaboration.sql", import.meta.url));
  for (const s of HANDOFF_STATUSES) assert(sql.includes(`'${s}'`), s);
  for (const s of ["completed", "partially_completed", "cancelled", "rejected", "blocked"] as const) assertEquals(TRANSITIONS[s], [], s);
  assert(canTransition("awaiting_review", "approved"));
  assertFalse(canTransition("rejected", "approved"));
  assertFalse(canTransition("cancelled", "queued"));
  assertFalse(canTransition("awaiting_review", "running"), "approval cannot be skipped");
  const c = { name: "Northstar Manufacturing", domain: "northstar.example", account_id: null };
  assertEquals(idempotencyKeyFor("atlas_research", c, [SIG, WS]), idempotencyKeyFor("atlas_research", c, [WS, SIG, SIG]));
  const h = { contract_version: COLLAB_CONTRACT_VERSION, workspace_id: WS, source_agent: "orion", target_agent: "atlas", kind: "atlas_research",
    company: c, signal_ids: [SIG], lead_ids: [], brain_fingerprint: null, reason: "x", evidence: [], verification: { level: "corroborated", confidence: "high", confirmed: [], inferred: [] },
    requires_approval: false, idempotency_key: "k:1", payload: {} } as Handoff;
  assertEquals(handoffError(h), "research and content handoffs require approval");
  assertEquals(handoffError({ ...h, requires_approval: true, target_agent: "orion" }), "an agent cannot hand off to itself");
  assertEquals(handoffError({ ...h, requires_approval: true }), null);
});

// ── LISA → ORION ──
Deno.test("LISA→ORION: a corroborated, relevant expansion becomes a trusted, executive recommendation; confirmed ≠ inferred", async () => {
  const o = assessForOrion(await signal(), EVEREST, NOW);
  assert(o.trusted); assertEquals(o.attention, "executive");
  assertEquals(o.company.domain, "northstar.example", "verified from the company's own site in the evidence");
  assert(o.confirmed_event.includes("confirmed by 2 independent sources"));
  assert(o.inferred_opportunity!.includes("may be worth researching because its expansion aligns with your target manufacturing market"));
  assertEquals(o.verification.confirmed, [o.confirmed_event]);
  assertEquals(o.verification.inferred, [o.inferred_opportunity]);
  assertEquals(o.recommended.map((r) => r.kind), ["atlas_research", "lyra_content"]);
  assert(o.recommended.every((r) => r.requires_approval));
});

Deno.test("LISA→ORION: single-source, dismissed, retracted, expired and excluded signals are never trusted", async () => {
  assertEquals(assessForOrion(await signal("northstar_rumour"), EVEREST, NOW).blocked, "unverified");
  for (const life of ["dismissed", "retracted", "contradicted", "expired"]) {
    const o = assessForOrion(await signal("northstar_expansion", EVEREST, { lifecycle_status: life }), EVEREST, NOW);
    assertEquals(o.blocked, "not_current", life); assertEquals(o.recommended, []);
  }
  const excl = brainFrom({ industries: ["Manufacturing"], geography: ["United States"], competitors: [], excludeCompanies: ["Northstar Manufacturing"] });
  assertEquals(assessForOrion(await signal(), excl, NOW).blocked, "excluded_by_brain");
  assertEquals(assessForOrion(await signal("northstar_expansion", EVEREST, { source_url: null }), EVEREST, NOW).trusted, false);
});

Deno.test("LISA→ORION: competitor news → advice + optional content, never customer research; no Brain → honest fallback", async () => {
  const comp = assessForOrion(await signal("funding", brainFrom()), brainFrom(), NOW);
  assert(comp.trusted);
  assertFalse(comp.recommended.some((r) => r.kind === "atlas_research"), "a competitor is not a prospect");
  const missing = brainFrom({ status: "missing" });
  const nb = assessForOrion(await signal("northstar_expansion", missing, {}, true), missing, NOW);
  assertEquals(nb.inferred_opportunity, null);
  assertEquals(nb.recommended.map((r) => r.kind), ["orion_review"]);
});

// ── ORION → ATLAS ──
Deno.test("ORION→ATLAS: the research request carries ATLAS's own Brain contract and hard guardrails; preflight refuses exclusions", async () => {
  const o = assessForOrion(await signal(), EVEREST, NOW);
  const contract = atlasView(EVEREST, NOW);
  assertEquals(atlasPreflight(o, contract), { ok: true });
  const h = buildAtlasResearchHandoff(WS, o, contract);
  assertEquals(handoffError(h), null);
  assertEquals(h.payload.icp.industries, ["Manufacturing"]);
  assertEquals(h.payload.exclusions.companies, ["Granite Works"]);
  assertEquals(h.payload.guardrails.contact_enrichment, false);
  assertEquals(h.payload.guardrails.outreach, false);
  assertEquals(h.payload.prefilled_mission.requested_count, 1);
  assertEquals(h.brain_fingerprint, contract.fingerprint);
  assertEquals(atlasPreflight(o, { ...contract, exclusions: { ...contract.exclusions, companies: ["northstar.example"] } }).ok, false);
  assertEquals(atlasPreflight(o, null).ok, false);
  assertEquals(atlasPreflight(o, contract, "acc-1").ok, true);
  assertEquals(atlasPreflight(o, { ...contract, rejected_account_refs: ["acc-1"] }, "acc-1").ok, false);
});

// ── ATLAS → ORION ──
Deno.test("ATLAS→ORION: every ending maps honestly; unsaved is never completed; contacts are never 'verified'", () => {
  const base = { handoff_id: "h1", company: { name: "Northstar Manufacturing", domain: "northstar.example" } };
  const q = normalizeAtlasResult({ ...base, qualification: "qualified", persisted: true, lead_candidate_id: "l1",
    execution: { status: "completed", stages_completed: [], error: null }, contacts: { count: 3, independently_verified: true as unknown as false } });
  assertEquals(handoffStatusFor(q), "completed");
  assertEquals(q.contacts.independently_verified, false);
  assert(orionReads(q).includes("not independently verified"));
  const unsaved = normalizeAtlasResult({ ...base, qualification: "qualified", persisted: false, lead_candidate_id: "l1" });
  assertEquals(unsaved.qualification, "failed"); assertEquals(handoffStatusFor(unsaved), "failed");
  assert(orionReads(unsaved).includes("treat it as not done"));
  const noLead = normalizeAtlasResult({ ...base, qualification: "qualified", persisted: true, lead_candidate_id: null,
    execution: { status: "completed", stages_completed: [], error: null } });
  assertEquals(noLead.qualification, "missing_evidence");
  assertEquals(handoffStatusFor(normalizeAtlasResult({ ...base, qualification: "blocked_budget", persisted: true })), "blocked");
  const partial = atlasResultFromMission({ ...base, signal_id: null, verdict: "fail", lead_candidate_id: null, error: "timeout", persisted: true });
  assertEquals(handoffStatusFor(partial), "partially_completed");
  assertEquals(atlasResultFromMission({ ...base, signal_id: null, verdict: "duplicate", lead_candidate_id: null, persisted: true }).qualification, "already_known");
  assertEquals(atlasResultFromMission({ ...base, signal_id: null, verdict: null, lead_candidate_id: null, budget_refused: true, persisted: true }).qualification, "blocked_budget");
});

Deno.test("endpoint path: results arriving at any stage walk only allowed transitions", () => {
  assertEquals(pathTo("approved", "completed"), ["queued", "running", "completed"]);
  assertEquals(pathTo("approved", "failed"), ["queued", "failed"]);
  assertEquals(pathTo("running", "blocked"), ["blocked"]);
  assertEquals(pathTo("rejected", "completed"), null);
  assertEquals(pathTo("cancelled", "failed"), null);
  for (const [from, to] of [["approved", "completed"], ["queued", "partially_completed"], ["approved", "failed"]] as const) {
    let cur: string = from;
    for (const step of pathTo(from, to)!) { assert(canTransition(cur as never, step), `${cur}→${step}`); cur = step; }
  }
});

// ── LISA → LYRA ──
Deno.test("LISA→LYRA: sources and verification reach the brief; uncertainty is preserved; no comparisons; draft only", async () => {
  const s = await signal();
  const o = assessForOrion(s, EVEREST, NOW);
  const brief = buildLyraBrief(s, o, lyraView(EVEREST));
  assertEquals(brief.sources.length, 3);
  assertEquals(brief.claims[0].status, "confirmed");
  assertEquals(brief.claims[1].status, "uncertain");
  const d = draftFromBrief(brief);
  assert(d.body.includes("https://texas-industry-news.example/northstar-plant"));
  assertFalse(d.body.includes(o.inferred_opportunity!), "the inference is not stated in the post as fact");
  assertEquals(d.metadata.needs_confirmation, [o.inferred_opportunity]);
  assertEquals(d.metadata.review_required, true);
  // A single-source claim is never written as fact.
  const rumour = await signal("northstar_rumour");
  const rb = buildLyraBrief(rumour, assessForOrion(rumour, EVEREST, NOW), null);
  assertEquals(rb.claims[0].status, "uncertain");
  assert(draftFromBrief(rb).body.startsWith("Reportedly:"));
});

// ── Agents → Brain ──
Deno.test("ATLAS feedback → Brain: a scoped, provenance-carrying proposal only for saved decisive results", () => {
  const base = { handoff_id: "h1", company: { name: "Northstar Manufacturing", domain: "northstar.example" } };
  const rej = normalizeAtlasResult({ ...base, qualification: "rejected", persisted: true, reasons: ["services firm"],
    execution: { status: "completed", stages_completed: [], error: null } });
  const p = atlasFitProposal(rej, NOW.toISOString())!;
  assertEquals(p.fact_key, "account_fit:northstar.example");
  assertEquals(p.source_type, "model_inference");
  assertEquals((p.value as { fit: string }).fit, "not_a_fit");
  assert(p.evidence.some((e) => e.source_ref === "agent_handoffs:h1"));
  for (const q of ["already_known", "failed", "blocked_budget", "insufficient_information"] as const) {
    assertEquals(atlasFitProposal(normalizeAtlasResult({ ...base, qualification: q, persisted: true }), NOW.toISOString()), null, q);
  }
  assertEquals(atlasFitProposal({ ...rej, persisted: false }, NOW.toISOString()), null);
});

// ── ORION board ──
Deno.test("board: answers what/why/evidence/agent/action/approval/done; stale Brain context is flagged", async () => {
  const o = assessForOrion(await signal(), EVEREST, NOW);
  const h: HandoffRow = { id: "h1", kind: "atlas_research", source_agent: "orion", target_agent: "atlas", status: "awaiting_review", signal_ids: [SIG],
    company: { name: "Northstar Manufacturing", domain: "northstar.example" }, brain_fingerprint: "old-fp", reason: "r", requires_approval: true,
    result: null, error: null, attempts: 0, parent_id: null, created_at: "2026-11-10T12:00:00Z", updated_at: "2026-11-10T12:00:00Z", decided_at: null };
  const b = buildCollaborationBoard([o], [h], EVEREST);
  const it = b.items[0];
  assert(it.what_happened && it.why_it_matters && it.evidence.length >= 3);
  const a = it.actions.find((x) => x.kind === "atlas_research")!;
  assertEquals(a.agent, "atlas"); assertEquals(a.status_label, "Awaiting your approval"); assert(a.approval.includes("mission approval"));
  assertEquals(a.stale_context, true);
  assertEquals(b.awaiting_you, 1);
  const done = buildCollaborationBoard([o], [{ ...h, brain_fingerprint: EVEREST.fingerprint, status: "completed", result: { persisted: true, summary: "ATLAS qualified Northstar." } }], EVEREST);
  assertEquals(done.items[0].actions[0].done, "ATLAS qualified Northstar.");
  assertEquals(done.completed, 1);
  assertEquals(buildCollaborationBoard([o], [h], EVEREST), b, "deterministic");
});

// ── ATLAS ↔ Brain, and the default-disqualifier conflict ──
Deno.test("disqualifiers: a manufacturing ICP is no longer excluded by the generic default; stated exclusions still hold", () => {
  const brain = compileCompanyBrainContext({ workspace_id: WS, profile: { schema_version: 2, company: { name: "Everest" },
    target_customer: { industries: ["Manufacturing", "Logistics"], geography: ["United States"] } } } as never);
  assert(brain.disqualifiers.industries.map((x) => x.toLowerCase()).includes("manufacturing"), "the merged list is unchanged (compatibility)");
  const eff = effectiveIndustryExclusions(brain);
  assertFalse(eff.industries.map((x) => x.toLowerCase()).includes("manufacturing"));
  assertFalse(eff.industries.map((x) => x.toLowerCase()).includes("logistics"));
  assert(eff.industries.map((x) => x.toLowerCase()).includes("government"), "unrelated defaults stay");
  const plan = buildRadarScanPlan(brain) as unknown as { negative_terms?: string[] };
  assertFalse(JSON.stringify(plan).toLowerCase().includes("\"manufacturing\"") && (plan.negative_terms ?? []).includes("manufacturing"));
  const stated = compileCompanyBrainContext({ workspace_id: WS, profile: { schema_version: 2, company: { name: "X" },
    target_customer: { industries: ["Manufacturing"], disqualifiers: { industries: ["Manufacturing"] } } } } as never);
  assert(effectiveIndustryExclusions(stated).industries.map((x) => x.toLowerCase()).includes("manufacturing"), "a stated exclusion is kept");
});

type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() { return q; }, order() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); },
    };
    return q;
  };
  return { from: make };
}

Deno.test("ATLAS mission context with memory: identical without memory, carries the Brain contract, same membership rule", async () => {
  const USER = "11111111-0000-4000-8000-000000000001";
  const tables = {
    workspace_members: [{ workspace_id: WS, user_id: USER }],
    company_brain: [{ workspace_id: WS, profile: { schema_version: 2, company: { name: "Everest" }, target_customer: { industries: ["Manufacturing"], geography: ["United States"] } }, updated_at: "2026-10-01T00:00:00Z", onboarding_completed: true }],
  };
  const today = await loadMissionContext(db(tables) as never, WS, { userId: USER });
  const opted = await loadMissionContextWithMemory(db(tables) as never, WS, { userId: USER });
  assert(today.ok && opted.ok);
  assertEquals(opted.context, today.context);
  assertEquals(opted.brain_contract?.contract_version, "atlas-brain-v1");
  assertEquals((await loadMissionContextWithMemory(db({ ...tables, workspace_members: [] }) as never, WS, { userId: USER })).ok, false);
  // With an approved exclusion in memory, it reaches ATLAS's contract.
  const withMemory = { ...tables, company_brain_memory: [{ id: "m1", workspace_id: WS, kind: "preference", category: "exclusions",
    fact_key: "exclusion.company:granite", scope: "workspace", scope_ref: null, value_type: "object", value: { type: "company", value: "Granite Works" },
    version: 1, source_type: "user_provided", verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
    persistence: "permanent", approval_status: "approved", created_by_kind: "user", updated_at: "2026-10-02T00:00:00Z" }] };
  const m = await loadMissionContextWithMemory(db(withMemory) as never, WS, { userId: USER });
  assertEquals(m.brain_contract?.exclusions.companies, ["Granite Works"]);
  assertNotEquals(m.brain_contract?.fingerprint, opted.brain_contract?.fingerprint);
});
