// ONE mapper from a persisted/returned outreach payload to the account-view
// shape the table and CSV read.
//
// WHY THIS EXISTS
//   The successful Harmonic Security opener (2026-07-20 08:05:56Z) was correct
//   in the backend AND correctly persisted to
//   `raw.agentory_workbench.outreach.last_success`, but the frontend stored only
//   `{ status }` during reconciliation and read a legacy full_draft field on
//   export. The message existed everywhere except where the UI looked.
//
//   Two call sites need the same mapping — the direct-action response and the
//   refresh hydration — so it lives here rather than being written twice with
//   slightly different key handling.
//
// Pure: no React, no network, no `@/` runtime imports.

import type { OutreachStageView } from './workbenchAccountView';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && !!x.trim())
    : [];
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Map one outreach payload — a run-agent `per_lead` row or a persisted
 * `last_success` — into the account-view stage shape.
 *
 * Returns null when there is nothing worth storing, so a caller can fall back
 * to a previous success rather than overwriting it with an empty object.
 */
export function toOutreachStageView(payload: unknown): OutreachStageView | null {
  if (!isObj(payload)) return null;

  const status = str(payload.status);
  if (!status) return null;

  const view: OutreachStageView = { status };

  const reason_code = str(payload.reason_code);
  if (reason_code) view.reason_code = reason_code;

  // The generated message. `opener` is canonical; `personalized_message` is the
  // legacy alias kept for older records only.
  const opener = strOrNull(payload.opener) ?? strOrNull(payload.personalized_message);
  if (opener) view.opener = opener;

  const alternative = strOrNull(payload.alternative_opener);
  if (alternative) view.alternative_opener = alternative;

  const depth = str(payload.personalization_depth);
  if (depth) view.personalization_depth = depth;

  const evidence = strArray(payload.used_evidence_ids);
  if (evidence.length > 0) view.used_evidence_ids = evidence;

  const approvalRequired = bool(payload.approval_required);
  if (approvalRequired !== undefined) view.approval_required = approvalRequired;

  const approvalStatus = str(payload.approval_status);
  if (approvalStatus) view.approval_status = approvalStatus;

  const generatedAt = str(payload.generated_at);
  if (generatedAt) view.generated_at = generatedAt;

  const persisted = bool(payload.persisted);
  if (persisted !== undefined) view.persisted = persisted;

  const retryable = bool(payload.retryable);
  if (retryable !== undefined) view.retryable = retryable;

  const outputMode = str(payload.output_mode);
  if (outputMode) view.output_mode = outputMode;

  // Never inferred. If the payload does not say it was sent, it was not.
  const sent = bool(payload.sent);
  view.sent = sent === true;

  const contactId = strOrNull(payload.selected_contact_id);
  if (contactId) view.selected_contact_id = contactId;

  const recipientName = strOrNull(payload.selected_recipient_name);
  if (recipientName) view.selected_recipient_name = recipientName;

  const recipientTitle = strOrNull(payload.selected_recipient_title);
  if (recipientTitle) view.selected_recipient_title = recipientTitle;

  const draftId = str(payload.draft_id);
  if (draftId) view.draft_id = draftId;

  return view;
}

/**
 * Read the persisted outreach stage out of a lead's `raw` jsonb.
 *
 * `last_success` is the durable valid opener; a later failed attempt writes
 * `status`/`reason_code` on the stage but never clears `last_success`, so a
 * failed retry must not make a previously generated opener disappear.
 */
export function hydrateOutreachStage(raw: unknown): {
  last_success: OutreachStageView | null;
  latest_status: string | null;
  latest_reason_code: string | null;
} {
  const empty = { last_success: null, latest_status: null, latest_reason_code: null };
  if (!isObj(raw)) return empty;

  const workbench = raw.agentory_workbench;
  if (!isObj(workbench)) return empty;

  const stage = workbench.outreach;
  if (!isObj(stage)) return empty;

  return {
    last_success: toOutreachStageView(stage.last_success),
    latest_status: str(stage.status) ?? null,
    latest_reason_code: str(stage.reason_code) ?? null,
  };
}

/** Human status for a persisted opener, used by the row and the CSV alike. */
export const OUTREACH_DRAFT_READY_COPY = 'Draft ready for approval';

/**
 * Shown when the backend reported success but the message itself is absent.
 * Neither "Draft ready for approval" (there is nothing to approve) nor
 * "Not generated" (it WAS generated) would be true.
 */
export const OUTREACH_MISSING_CONTENT_COPY = 'Draft succeeded, but the message could not be loaded.';
