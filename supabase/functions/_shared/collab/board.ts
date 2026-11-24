// ORION AS THE COORDINATION LAYER — one view of signals, proposed work and results.
//
// For every action it answers: what happened, why it matters, what evidence
// supports it, which agent should act, what is recommended, what approval is
// needed, and what has already been done. It EXECUTES NOTHING: it reads LISA's
// signals (via assessForOrion), the handoff ledger and the Company Brain.
//
// STALE CONTEXT. A handoff records the Brain fingerprint it was proposed
// under. If the Brain has changed since and the handoff is still awaiting
// review, the item says so and the opportunity is re-assessed against the
// CURRENT Brain; if the current Brain would no longer recommend it, the action
// is shown as `no_longer_recommended` and the endpoint refuses to approve it.
//
// PURE.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import type { HandoffKind, HandoffStatus } from "./contract.ts";
import type { OrionOpportunity } from "./lisaToOrion.ts";

export interface HandoffRow {
  id: string;
  kind: HandoffKind;
  source_agent: string;
  target_agent: string;
  status: HandoffStatus;
  signal_ids: string[];
  company: { name: string; domain: string | null } | null;
  brain_fingerprint: string | null;
  reason: string;
  requires_approval: boolean;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

export interface BoardAction {
  kind: HandoffKind;
  agent: "atlas" | "lyra" | "orion";
  action: string;
  approval: string;
  handoff_id: string | null;
  status: HandoffStatus | "not_proposed";
  status_label: string;
  done: string | null;
  error: string | null;
  stale_context: boolean;
  no_longer_recommended: boolean;
}

export interface BoardItem {
  signal_id: string;
  discovered_by: "lisa";
  company: string;
  what_happened: string;
  why_it_matters: string;
  inferred_opportunity: string | null;
  evidence: Array<{ ref: string; url?: string | null }>;
  verification: string;
  trusted: boolean;
  attention: OrionOpportunity["attention"];
  blocked: string | null;
  actions: BoardAction[];
}

export interface CollaborationBoard {
  brain: { status: string; fingerprint: string | null; goals: string[]; exclusions: number; pending_proposals: number };
  items: BoardItem[];
  awaiting_you: number;
  in_progress: number;
  completed: number;
  problems: number;
}

const LABEL: Record<BoardAction["status"], string> = {
  not_proposed: "Not proposed yet", proposed: "Proposed", awaiting_review: "Awaiting your approval", approved: "Approved",
  rejected: "Rejected", queued: "Queued", running: "Running", completed: "Completed", partially_completed: "Partially completed",
  failed: "Failed", cancelled: "Cancelled", blocked: "Blocked",
};

function doneText(h: HandoffRow): string | null {
  const r = h.result ?? {};
  if (h.status === "completed" || h.status === "partially_completed") return String(r.summary ?? "Done.");
  if (h.status === "failed" || h.status === "blocked") return String(r.summary ?? h.error ?? "Did not complete.");
  return null;
}

export function buildCollaborationBoard(opps: OrionOpportunity[], handoffs: HandoffRow[], brain: SharedBrainContext | null): CollaborationBoard {
  const bySignal = new Map<string, HandoffRow[]>();
  for (const h of handoffs) for (const s of h.signal_ids) bySignal.set(s, [...(bySignal.get(s) ?? []), h]);
  const fp = brain?.fingerprint ?? null;
  const items: BoardItem[] = opps.map((o) => {
    const hs = bySignal.get(o.signal_id) ?? [];
    const actions: BoardAction[] = [];
    const recKinds = new Set(o.recommended.map((r) => r.kind));
    for (const r of o.recommended) {
      const h = hs.filter((x) => x.kind === r.kind).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
      actions.push({
        kind: r.kind, agent: r.agent, action: r.action, approval: r.requires_approval ? r.approval_note : "No approval needed — advice only.",
        handoff_id: h?.id ?? null, status: h?.status ?? "not_proposed", status_label: LABEL[h?.status ?? "not_proposed"],
        done: h ? doneText(h) : null, error: h?.error ?? null,
        stale_context: !!(h && fp && h.brain_fingerprint && h.brain_fingerprint !== fp && h.status === "awaiting_review"),
        no_longer_recommended: false,
      });
    }
    // Handoffs the CURRENT assessment would no longer make (Brain changed, signal retracted…).
    for (const h of hs) {
      if (recKinds.has(h.kind) || h.kind === "orion_review") continue;
      actions.push({
        kind: h.kind, agent: h.target_agent as BoardAction["agent"], action: h.reason, approval: "Re-check before approving.",
        handoff_id: h.id, status: h.status, status_label: LABEL[h.status], done: doneText(h), error: h.error,
        stale_context: !!(fp && h.brain_fingerprint && h.brain_fingerprint !== fp),
        no_longer_recommended: true,
      });
    }
    return {
      signal_id: o.signal_id, discovered_by: "lisa", company: o.company.name, what_happened: o.confirmed_event,
      why_it_matters: o.why_it_matters, inferred_opportunity: o.inferred_opportunity, evidence: o.evidence,
      verification: o.verification.level, trusted: o.trusted, attention: o.attention, blocked: o.blocked_detail, actions,
    };
  });
  const all = items.flatMap((i) => i.actions);
  return {
    brain: { status: brain?.status ?? "missing", fingerprint: fp, goals: (brain?.goals ?? []).map((g) => g.text),
      exclusions: brain ? brain.exclusions.companies.length + brain.exclusions.industries.length + brain.exclusions.geographies.length + brain.exclusions.keywords.length : 0,
      pending_proposals: brain?.pending_proposals ?? 0 },
    items: items.sort((a, b) => (a.trusted === b.trusted ? 0 : a.trusted ? -1 : 1)),
    awaiting_you: all.filter((a) => a.status === "awaiting_review").length,
    in_progress: all.filter((a) => a.status === "approved" || a.status === "queued" || a.status === "running").length,
    completed: all.filter((a) => a.status === "completed" || a.status === "partially_completed").length,
    problems: all.filter((a) => a.status === "failed" || a.status === "blocked").length,
  };
}
