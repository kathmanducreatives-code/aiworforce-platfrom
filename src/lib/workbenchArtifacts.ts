// Frontend-only "Workbench artifact" model.
//
// Every meaningful AI result in a chat is mapped to a stable artifact so:
//  - the result can be reopened from the assistant message ("View results")
//  - multiple results in one conversation coexist without overwriting
//  - the Workbench always shows the artifact that the user requested
//
// Backward compatible with the existing ui_panel.kind = 'lead_results'
// metadata shape. If a message has no artifact_id we derive a stable id
// from plan_id || message id.

import type { ChatMessageRow } from '@/lib/pilotChat';
import type { LeadResultsPanelMeta } from '@/contexts/ChatWorkspaceContext';

export type WorkbenchArtifactKind =
  | 'lead_results'
  | 'competitor_analysis'
  | 'content_draft'
  | 'outreach_drafts'
  | 'website_audit'
  | 'qa_report'
  | 'coding_prompt'
  | 'csv_export'
  | 'report'
  | 'generic';

export type WorkbenchArtifactStatus =
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'blocked';

export interface WorkbenchArtifact {
  id: string;
  conversation_id: string;
  source_message_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
  plan_id?: string;
  run_id?: string;
  kind: WorkbenchArtifactKind;
  title: string;
  subtitle?: string;
  created_at: string;
  status: WorkbenchArtifactStatus;
  panel: LeadResultsPanelMeta | Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

const KIND_FALLBACK_TITLE: Record<WorkbenchArtifactKind, string> = {
  lead_results: 'Lead results',
  competitor_analysis: 'Competitor analysis',
  content_draft: 'Content draft',
  outreach_drafts: 'Outreach drafts',
  website_audit: 'Website audit',
  qa_report: 'QA report',
  coding_prompt: 'Coding prompt',
  csv_export: 'CSV export',
  report: 'Report',
  generic: 'Result',
};

function truncate(s: string, n = 120): string {
  const t = (s ?? '').trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function inferKind(panel: any): WorkbenchArtifactKind {
  const raw = (panel?.kind ?? '').toString();
  if (raw === 'lead_results') return 'lead_results';
  if (raw === 'competitor_analysis') return 'competitor_analysis';
  if (raw === 'content_draft') return 'content_draft';
  if (raw === 'outreach_drafts') return 'outreach_drafts';
  if (raw === 'website_audit') return 'website_audit';
  if (raw === 'qa_report') return 'qa_report';
  if (raw === 'coding_prompt') return 'coding_prompt';
  if (raw === 'csv_export') return 'csv_export';
  if (raw === 'report') return 'report';
  return 'generic';
}

function inferStatus(panel: any, meta: any): WorkbenchArtifactStatus {
  const raw = (panel?.status ?? meta?.workflow_status ?? '').toString().toLowerCase();
  if (raw === 'running' || raw === 'in_progress' || raw === 'queued') return 'running';
  if (raw === 'failed' || raw === 'unavailable' || raw === 'error') return 'failed';
  if (raw === 'partial') return 'partial';
  if (raw === 'blocked' || raw === 'awaiting_approval') return 'blocked';
  if (raw === 'complete' || raw === 'succeeded' || raw === 'done') return 'complete';
  // Default for lead_results: if we have a lead_count, treat as complete.
  if (panel?.kind === 'lead_results' && typeof panel?.lead_count === 'number') {
    return panel.lead_count === 0 ? 'partial' : 'complete';
  }
  return 'complete';
}

function inferTitle(panel: any, kind: WorkbenchArtifactKind): string {
  if (panel?.title && typeof panel.title === 'string') return panel.title;
  if (kind === 'lead_results' && typeof panel?.lead_count === 'number') {
    const n = panel.lead_count;
    return `${n} ${n === 1 ? 'opportunity' : 'opportunities'} found`;
  }
  return KIND_FALLBACK_TITLE[kind];
}

/**
 * Build an artifact for a single assistant message if it carries a Workbench
 * panel hint. Returns null if the message has no panel.
 */
export function buildArtifactFromMessage(
  msg: ChatMessageRow,
  prevUserMsg?: ChatMessageRow | null,
): WorkbenchArtifact | null {
  const meta = (msg.metadata ?? null) as Record<string, any> | null;
  const panel = meta?.ui_panel as Record<string, any> | undefined;
  if (!panel || !panel.kind) return null;

  const kind = inferKind(panel);
  const planId: string | undefined = panel.plan_id ?? meta?.plan_id;
  const id: string =
    panel.artifact_id ??
    (planId ? `plan:${planId}` : null) ??
    `msg:${msg.id}`;

  const subtitle =
    (typeof panel.subtitle === 'string' && panel.subtitle) ||
    (prevUserMsg?.content ? truncate(prevUserMsg.content) : undefined);

  return {
    id,
    conversation_id: msg.conversation_id,
    source_message_id: msg.id,
    user_message_id: prevUserMsg?.id,
    assistant_message_id: msg.id,
    plan_id: planId,
    run_id: panel.run_id,
    kind,
    title: inferTitle(panel, kind),
    subtitle,
    created_at: msg.created_at,
    status: inferStatus(panel, meta),
    panel: panel as LeadResultsPanelMeta | Record<string, unknown>,
    metadata: meta ?? undefined,
  };
}

/**
 * Iterate messages in order and build the full list of artifacts for a
 * conversation. The "previous user message" used for the subtitle is the
 * most recent user message before the assistant message that produced the
 * artifact.
 */
export function buildArtifactsFromMessages(messages: ChatMessageRow[]): WorkbenchArtifact[] {
  const out: WorkbenchArtifact[] = [];
  let lastUser: ChatMessageRow | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      lastUser = m;
      continue;
    }
    const a = buildArtifactFromMessage(m, lastUser);
    if (a) out.push(a);
  }
  return out;
}
