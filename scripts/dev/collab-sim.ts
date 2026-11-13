// COLLABORATION SIMULATOR (npm run dev:collab) — the Phase 5 Everest / Northstar
// journey through the REAL pure modules (LISA pipeline, ORION assessment,
// ATLAS request/result contracts, LYRA brief/draft, ORION board), offline.
//
//   npm run dev:collab            # print each step's board summary
//   npm run dev:collab -- --write # also regenerate src/components/collaboration/everestPreview.json
//
// The ledger is SIMULATED in memory (the real one is the held agent_handoffs
// table, exercised by tests/db-contract/agentCollaboration.contract.test.ts).
// The ATLAS outcome is a recorded, synthetic result. Every company is fictional.
// NO network: fetch is disabled.
import { brainFrom, loadFixture, replay } from "../../tests/edge-functions/_shared/lisa/lisaFixtures.ts";
import { toAgentSignal, type StoredSignalRow } from "../../supabase/functions/_shared/lisa/weekly.ts";
import type { LisaSignal } from "../../supabase/functions/_shared/lisa/types.ts";
import { assessForOrion } from "../../supabase/functions/_shared/collab/lisaToOrion.ts";
import { buildAtlasResearchHandoff } from "../../supabase/functions/_shared/collab/orionToAtlas.ts";
import { buildLyraHandoff, draftFromBrief } from "../../supabase/functions/_shared/collab/lisaToLyra.ts";
import { handoffStatusFor, normalizeAtlasResult } from "../../supabase/functions/_shared/collab/atlasToOrion.ts";
import { atlasFitProposal } from "../../supabase/functions/_shared/collab/brainFeedback.ts";
import { buildCollaborationBoard, type HandoffRow } from "../../supabase/functions/_shared/collab/board.ts";
import { atlasView, lyraView } from "../../supabase/functions/_shared/companyBrainAgentViews.ts";
import type { Handoff, HandoffStatus } from "../../supabase/functions/_shared/collab/contract.ts";

globalThis.fetch = (() => { throw new Error("network disabled in the collaboration simulator"); }) as typeof fetch;

const NOW = new Date("2026-11-10T12:00:00Z");
const WS = "00000000-0000-4000-8000-00000000e7e5";
const SIG = "00000000-0000-4000-8000-0000000051a1";
const brain = brainFrom({ industries: ["Manufacturing"], geography: ["United States"], competitors: [], excludeCompanies: ["Granite Works"],
  goals: ["Win US manufacturers expanding production capacity"], fingerprint: "fp-everest-v1" });

const f = loadFixture("northstar_expansion");
const r = await replay(f, { brain });
const [s] = [...(r.store as unknown as { events: Map<string, LisaSignal> }).events.values()];
const row: StoredSignalRow = { id: SIG, workspace_id: WS, signal_type: s.signal_type, lifecycle_status: s.lifecycle_status,
  verification_status: s.verification.column_status, confidence: s.verification.confidence, occurred_at: s.event_date, observed_at: s.discovered_at,
  source_url: s.source_url, subject_type: s.subject_type, subject_key: s.subject_key,
  normalized_value: { lisa: { category: s.category, company: { name: s.company_name, domain: s.company_domain }, title: s.title, description: s.description,
    event_date: s.event_date, discovered_at: s.discovered_at, event_instance: s.event_instance, source_type: s.source_type, watch_origin: s.watch_origin,
    verification: s.verification, relevance: s.relevance } } };
const signal = toAgentSignal(row, brain, NOW, s.evidence.map((e) => ({ url: e.url, domain: e.domain })))!;
const opp = assessForOrion(signal, brain, NOW);

const atlasH = buildAtlasResearchHandoff(WS, opp, atlasView(brain, NOW));
const lyraH = buildLyraHandoff(WS, signal, opp, lyraView(brain));
const rowOf = (id: string, h: Handoff<unknown>, status: HandoffStatus, extra: Partial<HandoffRow> = {}): HandoffRow => ({
  id, kind: h.kind, source_agent: h.source_agent, target_agent: h.target_agent, status, signal_ids: h.signal_ids,
  company: h.company ? { name: h.company.name, domain: h.company.domain } : null, brain_fingerprint: h.brain_fingerprint, reason: h.reason,
  requires_approval: h.requires_approval, result: null, error: null, attempts: 0, parent_id: null,
  created_at: "2026-11-10T12:01:00Z", updated_at: "2026-11-10T12:01:00Z", decided_at: null, ...extra });

const atlasResult = normalizeAtlasResult({ handoff_id: "h-atlas", signal_id: SIG, company: { name: "Northstar Manufacturing", domain: "northstar.example" },
  qualification: "qualified", persisted: true, lead_candidate_id: "00000000-0000-4000-8000-0000000001ea", confidence: "medium",
  reasons: ["US manufacturer with ~300 employees (inside your 50–500 range)", "New Texas production capacity"],
  execution: { status: "completed", stages_completed: ["company_research", "icp_qualification"], error: null },
  budget: { credits_reserved: 2, credits_charged: 2, status: "within_budget" }, contacts: { count: 0, independently_verified: false } });
const draft = draftFromBrief(lyraH.payload.brief);
const fit = atlasFitProposal(atlasResult, NOW.toISOString());

const steps = [
  { label: "1 · LISA stores a sourced signal", note: "Corroborated by two outlets plus Northstar's own release; nothing proposed yet.", handoffs: [] as HandoffRow[] },
  { label: "2 · ORION proposes work", note: "ATLAS research and a LYRA draft are proposed and wait for you. Nothing runs.",
    handoffs: [rowOf("h-atlas", atlasH, "awaiting_review"), rowOf("h-lyra", lyraH, "awaiting_review")] },
  { label: "3 · You approve", note: "Approval prepares a prefilled ATLAS plan; launching paid research is still a separate mission approval in Leads.",
    handoffs: [rowOf("h-atlas", atlasH, "approved", { decided_at: "2026-11-10T12:05:00Z" }), rowOf("h-lyra", lyraH, "approved", { decided_at: "2026-11-10T12:05:00Z" })] },
  { label: "4 · ATLAS researches (simulated result)", note: "A recorded, synthetic ATLAS outcome — no discovery provider was called.",
    handoffs: [rowOf("h-atlas", atlasH, "running", { attempts: 1 }), rowOf("h-lyra", lyraH, "approved")] },
  { label: "5 · Results return", note: "ATLAS qualified the company; LYRA prepared an unpublished draft; a Brain proposal waits for review.",
    handoffs: [rowOf("h-atlas", atlasH, handoffStatusFor(atlasResult), { result: atlasResult as unknown as Record<string, unknown>, attempts: 1 }),
      rowOf("h-lyra", lyraH, "completed", { result: { persisted: true, summary: "Draft ready for review (not published)", content_status: "draft" } })] },
].map((st) => ({ label: st.label, note: st.note, board: buildCollaborationBoard([opp], st.handoffs, brain) }));

const out = {
  simulated: true, fictional: true, generated_by: "npm run dev:collab", customer: "Everest Industrial Automation (fictional)",
  signal: { id: SIG, title: signal.what_happened, sources: signal.evidence.map((e) => e.url) },
  atlas_request: { query: atlasH.payload.prefilled_mission.query, guardrails: atlasH.payload.guardrails },
  lyra_draft: { title: draft.title, body: draft.body, needs_confirmation: draft.metadata.needs_confirmation, status: "draft (not published)" },
  brain_proposal: fit ? { fact_key: fit.fact_key, value: fit.value, status: "pending — awaiting your review" } : null,
  steps,
};

for (const st of steps) {
  const a = st.board.items[0].actions.map((x) => `${x.agent}:${x.status}`).join(", ");
  console.log(`${st.label.padEnd(42)} ${a}  (awaiting ${st.board.awaiting_you}, done ${st.board.completed})`);
}
console.log(`\nATLAS plan: ${out.atlas_request.query}\nLYRA draft:\n${out.lyra_draft.body}\nBrain proposal: ${JSON.stringify(out.brain_proposal)}`);
if (Deno.args.includes("--write")) {
  const file = new URL("../../src/components/collaboration/everestPreview.json", import.meta.url);
  await Deno.mkdir(new URL(".", file), { recursive: true });
  await Deno.writeTextFile(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${file.pathname}`);
}
