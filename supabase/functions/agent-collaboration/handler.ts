// agent-collaboration — the multi-agent handoff endpoint. DISABLED BY DEFAULT.
//
// Answers 409 unless AGENT_COLLAB_ENABLED=true AND LISA_V2_ENABLED=true (it
// reads LISA V2 signals, which stay off until the signal-table security
// remediation). Nothing here calls a paid provider, enriches a contact,
// publishes content or contacts anyone.
//
//   board        member (read)        ORION's coordination view: signals, proposed work, results
//   propose      editor/admin/owner   ORION proposes ATLAS research / LYRA content for one signal
//   decide       editor/admin/owner   approve / reject / cancel (agent_handoff_decide, role re-checked in-transaction)
//   atlas_plan   member (read)        the PREFILLED ATLAS mission for an approved research handoff
//   lyra_draft   editor/admin/owner   approved content handoff → one unpublished content_item draft (atomic)
//   atlas_report service key only     ATLAS reports progress / its result (the ATLAS track's completion hook)
//
// Approving re-assesses the signal against the CURRENT Company Brain: if the
// Brain changed and would no longer recommend the work, approval is refused.

import { canBrain, normalizeWorkspaceRole, type BrainPermission } from "../_shared/brainRole.ts";
import { sessionIdFromBearer } from "../_shared/brainWriter.ts";
import { atlasView, lyraView } from "../_shared/companyBrainAgentViews.ts";
import type { SharedBrainContext } from "../_shared/companyBrainContextLoader.ts";
import { loadBrain, storedLisaRows } from "../_shared/lisa/reads.ts";
import { toAgentSignal, type AgentSignal } from "../_shared/lisa/weekly.ts";
import { assessForOrion } from "../_shared/collab/lisaToOrion.ts";
import { atlasPreflight, buildAtlasResearchHandoff } from "../_shared/collab/orionToAtlas.ts";
import { buildLyraHandoff, draftFromBrief, type LyraContentBrief } from "../_shared/collab/lisaToLyra.ts";
import { handoffStatusFor, normalizeAtlasResult, type AtlasResearchResult } from "../_shared/collab/atlasToOrion.ts";
import { atlasFitProposal, submitProposals } from "../_shared/collab/brainFeedback.ts";
import { buildCollaborationBoard, type HandoffRow } from "../_shared/collab/board.ts";
import { advanceHandoff, decideHandoff, lyraDraft, proposeHandoff, type Rpc } from "../_shared/collab/store.ts";
import type { HandoffStatus } from "../_shared/collab/contract.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = Rpc & { from(table: string): any };

export interface CollabDeps {
  env(key: string): string | undefined;
  admin: AdminClient;
  userIdFor(token: string): Promise<string | null>;
  now?: () => Date;
}

export type CollabRequest =
  | { action: "board"; workspace_id: string }
  | { action: "propose"; workspace_id: string; signal_id: string; kinds: Array<"atlas_research" | "lyra_content"> }
  | { action: "decide"; workspace_id: string; handoff_id: string; decision: "approve" | "reject" | "cancel"; note?: string }
  | { action: "atlas_plan" | "lyra_draft"; workspace_id: string; handoff_id: string }
  | { action: "atlas_report"; workspace_id: string; handoff_id: string; stage: "queued" | "running" | "result"; result?: Partial<AtlasResearchResult> };

export function parseCollabRequest(b: unknown): { ok: true; req: CollabRequest } | { ok: false; error: string } {
  const o = (b ?? {}) as Record<string, unknown>;
  const ws = typeof o.workspace_id === "string" && UUID.test(o.workspace_id) ? o.workspace_id : null;
  if (!ws) return { ok: false, error: "workspace_id must be a uuid" };
  const hid = typeof o.handoff_id === "string" && UUID.test(o.handoff_id) ? o.handoff_id : null;
  switch (o.action) {
    case "board": return { ok: true, req: { action: "board", workspace_id: ws } };
    case "propose": {
      const sid = typeof o.signal_id === "string" && UUID.test(o.signal_id) ? o.signal_id : null;
      if (!sid) return { ok: false, error: "signal_id must be a uuid" };
      const kinds = (Array.isArray(o.kinds) ? o.kinds : ["atlas_research", "lyra_content"])
        .filter((k): k is "atlas_research" | "lyra_content" => k === "atlas_research" || k === "lyra_content");
      return { ok: true, req: { action: "propose", workspace_id: ws, signal_id: sid, kinds: [...new Set(kinds)] } };
    }
    case "decide": {
      if (!hid) return { ok: false, error: "handoff_id must be a uuid" };
      const d = o.decision;
      if (d !== "approve" && d !== "reject" && d !== "cancel") return { ok: false, error: "invalid decision" };
      return { ok: true, req: { action: "decide", workspace_id: ws, handoff_id: hid, decision: d, ...(typeof o.note === "string" ? { note: o.note.slice(0, 500) } : {}) } };
    }
    case "atlas_plan": case "lyra_draft":
      if (!hid) return { ok: false, error: "handoff_id must be a uuid" };
      return { ok: true, req: { action: o.action, workspace_id: ws, handoff_id: hid } };
    case "atlas_report": {
      if (!hid) return { ok: false, error: "handoff_id must be a uuid" };
      const st = o.stage;
      if (st !== "queued" && st !== "running" && st !== "result") return { ok: false, error: "invalid stage" };
      return { ok: true, req: { action: "atlas_report", workspace_id: ws, handoff_id: hid, stage: st,
        ...(o.result && typeof o.result === "object" ? { result: o.result as Partial<AtlasResearchResult> } : {}) } };
    }
  }
  return { ok: false, error: "unknown action" };
}

/** The allowed steps from `from` to a final ATLAS state, or null. Mirrors agent_handoff_advance. */
export function pathTo(from: HandoffStatus, to: HandoffStatus): HandoffStatus[] | null {
  if (to === "blocked") return ["approved", "queued", "running"].includes(from) ? ["blocked"] : null;
  if (to === "failed") return from === "approved" ? ["queued", "failed"] : from === "queued" || from === "running" ? ["failed"] : null;
  if (to === "completed" || to === "partially_completed") {
    return from === "approved" ? ["queued", "running", to] : from === "queued" ? ["running", to] : from === "running" ? [to] : null;
  }
  return null;
}

export function permissionFor(a: CollabRequest["action"]): BrainPermission {
  return a === "board" || a === "atlas_plan" ? "read" : "edit";
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const HANDOFF_COLS = "id, kind, source_agent, target_agent, status, signal_ids, company, brain_fingerprint, reason, requires_approval, result, error, attempts, parent_id, created_at, updated_at, decided_at, payload";

async function handoffRow(admin: AdminClient, ws: string, id: string): Promise<(HandoffRow & { payload: Record<string, unknown> }) | null> {
  const { data } = await admin.from("agent_handoffs").select(HANDOFF_COLS).eq("workspace_id", ws).eq("id", id).maybeSingle();
  return (data ?? null) as (HandoffRow & { payload: Record<string, unknown> }) | null;
}

async function signalsFor(admin: AdminClient, ws: string, brain: SharedBrainContext | null, now: Date, ids?: string[]): Promise<AgentSignal[]> {
  const { rows, evidence } = await storedLisaRows(admin, ws, now, ids);
  return rows.map((r) => toAgentSignal(r, brain, now, evidence.get(r.id) ?? [])).filter((x): x is AgentSignal => !!x);
}

export async function handleCollab(req: Request, deps: CollabDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (deps.env("AGENT_COLLAB_ENABLED") !== "true" || deps.env("LISA_V2_ENABLED") !== "true") return json({ error: "agent_collaboration_disabled" }, 409);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7).trim();
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }
  const parsed = parseCollabRequest(body);
  if (!parsed.ok) return json({ error: "invalid_request", reason: parsed.error }, 400);
  const r = parsed.req;
  const now = deps.now?.() ?? new Date();
  const admin = deps.admin;

  // ── ATLAS's completion hook: service key only, never a browser ──
  if (r.action === "atlas_report") {
    const service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    if (!service || token !== service) return json({ error: "forbidden", reason: "service_key_required" }, 403);
    const h = await handoffRow(admin, r.workspace_id, r.handoff_id);
    if (!h || h.kind !== "atlas_research") return json({ error: "not_found" }, 404);
    if (r.stage !== "result") {
      const expected: HandoffStatus = r.stage === "queued" ? (h.status === "failed" ? "failed" : "approved") : "queued";
      const out = await advanceHandoff(admin, { workspace_id: r.workspace_id, handoff_id: h.id, agent: "atlas", expected, to: r.stage });
      return json({ ok: out.outcome === "ok", ...out }, out.outcome === "ok" ? 200 : 409);
    }
    const result = normalizeAtlasResult({ ...(r.result ?? {}), handoff_id: h.id, signal_id: h.signal_ids[0] ?? null,
      company: { name: h.company?.name ?? "", domain: h.company?.domain ?? null } });
    const to = handoffStatusFor(result);
    // A result may arrive at any stage ATLAS reached (a budget refusal before it
    // started, a crash while queued). Walk the ALLOWED path to the final state,
    // each step a compare-and-set; never skip the ledger's rules.
    const path = pathTo(h.status, to);
    if (!path) return json({ ok: false, outcome: "invalid_transition", status: h.status, summary: result.summary }, 409);
    let cur: HandoffStatus = h.status;
    let out = { outcome: "ok", status: cur as string | null };
    for (const step of path) {
      const final = step === to;
      out = await advanceHandoff(admin, { workspace_id: r.workspace_id, handoff_id: h.id, agent: "atlas", expected: cur, to: step,
        result: final ? result as unknown as Record<string, unknown> : null, error: final && to !== "completed" ? result.summary : null });
      if (out.outcome !== "ok") break;
      cur = step;
    }
    if (out.outcome !== "ok") return json({ ok: false, ...out, summary: result.summary }, 409);
    // Feedback → Company Brain: a PENDING proposal, only for saved, decisive results.
    const p = atlasFitProposal(result, now.toISOString());
    const proposals = p ? await submitProposals(admin as unknown as Parameters<typeof submitProposals>[0], r.workspace_id, "atlas", [p]) : [];
    return json({ ok: true, status: to, summary: result.summary, next_step: result.next_step, proposals });
  }

  // ── user paths: membership + role first ──
  const userId = await deps.userIdFor(token);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", r.workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden", reason: "not_member" }, 403);
  const role = normalizeWorkspaceRole((member as { role?: unknown }).role);
  const required = permissionFor(r.action);
  if (!canBrain(role, required)) return json({ error: "collab_role_forbidden", role, required }, 403);

  try {
    const brain = await loadBrain(admin, r.workspace_id, now);

    if (r.action === "board") {
      const signals = await signalsFor(admin, r.workspace_id, brain, now);
      const { data: hs } = await admin.from("agent_handoffs").select(HANDOFF_COLS).eq("workspace_id", r.workspace_id)
        .order("created_at", { ascending: false }).limit(200);
      return json({ ok: true, board: buildCollaborationBoard(signals.map((s) => assessForOrion(s, brain, now)), (hs ?? []) as HandoffRow[], brain) });
    }

    if (r.action === "propose") {
      const [s] = await signalsFor(admin, r.workspace_id, brain, now, [r.signal_id]);
      if (!s) return json({ error: "signal_not_found" }, 404);
      const opp = assessForOrion(s, brain, now);
      if (!opp.trusted) return json({ ok: false, error: "not_recommended", blocked: opp.blocked, detail: opp.blocked_detail }, 409);
      const results: Array<{ kind: string; outcome: string; id: string | null; status: string | null; detail?: string }> = [];
      for (const kind of r.kinds) {
        if (!opp.recommended.some((x) => x.kind === kind)) { results.push({ kind, outcome: "not_recommended", id: null, status: null }); continue; }
        if (kind === "atlas_research") {
          const contract = brain ? atlasView(brain, now) : null;
          const pre = atlasPreflight(opp, contract);
          if (!pre.ok) { results.push({ kind, outcome: pre.reason, id: null, status: null, detail: pre.detail }); continue; }
          results.push({ kind, ...(await proposeHandoff(admin, buildAtlasResearchHandoff(r.workspace_id, opp, contract!))) });
        } else {
          results.push({ kind, ...(await proposeHandoff(admin, buildLyraHandoff(r.workspace_id, s, opp, brain ? lyraView(brain) : null,
            brain ? [...brain.exclusions.industries, ...brain.exclusions.companies, ...brain.exclusions.geographies] : []))) });
        }
      }
      return json({ ok: results.some((x) => x.outcome === "created" || x.outcome === "duplicate"), opportunity: opp, results });
    }

    const h = await handoffRow(admin, r.workspace_id, r.handoff_id);
    if (!h) return json({ error: "not_found" }, 404);

    if (r.action === "atlas_plan") {
      if (h.kind !== "atlas_research") return json({ error: "not_found" }, 404);
      if (!["approved", "queued", "running", "completed", "partially_completed"].includes(h.status)) {
        return json({ ok: false, error: "not_approved", status: h.status }, 409);
      }
      return json({ ok: true, status: h.status, plan: (h.payload as { prefilled_mission?: unknown }).prefilled_mission ?? null,
        request: h.payload, note: "Launching this mission in Leads is a separate, approved and budgeted step." });
    }

    if (r.action === "lyra_draft") {
      if (h.kind !== "lyra_content") return json({ error: "not_found" }, 404);
      const brief = (h.payload as { brief?: LyraContentBrief }).brief;
      if (!brief) return json({ error: "invalid_handoff" }, 409);
      const out = await lyraDraft(admin, { workspace_id: r.workspace_id, handoff_id: h.id, draft: draftFromBrief(brief) as unknown as Record<string, unknown> });
      const ok = out.outcome === "created" || out.outcome === "duplicate";
      return json({ ok, ...out, published: false }, ok ? 200 : 409);
    }

    if (r.action !== "decide") return json({ error: "invalid_request" }, 400);
    if (r.decision === "approve" && h.signal_ids[0]) {
      const [s] = await signalsFor(admin, r.workspace_id, brain, now, [h.signal_ids[0]]);
      const opp = s ? assessForOrion(s, brain, now) : null;
      const still = !!opp && opp.trusted && opp.recommended.some((x) => x.kind === h.kind);
      if (!still && h.brain_fingerprint !== (brain?.fingerprint ?? null)) {
        return json({ ok: false, error: "brain_changed_not_recommended", detail: opp?.blocked_detail ?? "The current Company Brain no longer supports this action." }, 409);
      }
    }
    const sessionId = sessionIdFromBearer(authHeader);
    if (!sessionId) return json({ error: "Unauthorized", reason: "session_invalid" }, 401);
    const out = await decideHandoff(admin, { workspace_id: r.workspace_id, actor_id: userId, session_id: sessionId, handoff_id: h.id, decision: r.decision, note: r.note ?? null });
    const status = out.outcome === "ok" ? 200 : out.outcome === "session_invalid" ? 401 : out.outcome === "not_found" ? 404
      : out.outcome === "invalid_transition" || out.outcome === "blocked" ? 409 : out.outcome === "database_rejected" ? 500 : 403;
    return json({ ok: out.outcome === "ok", ...out }, status);
  } catch (e) {
    console.error("[agent-collaboration]", e instanceof Error ? e.message : String(e));
    return json({ error: "internal_error" }, 500);
  }
}
