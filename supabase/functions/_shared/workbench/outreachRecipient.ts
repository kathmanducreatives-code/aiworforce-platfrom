// ONE canonical selected recipient for a generated opener.
//
// WHY THIS EXISTS
//   A QA export showed a message generated for one person while the row and CSV
//   displayed another (e.g. generated for Kenneth, displayed Amy). The cause was
//   structural, not a data glitch:
//
//     • the opener generates for `resolveVerifiedDecisionMakerForOutreach(...)`
//       — rank 1 of raw.decision_makers;
//     • `contact_name` in the row/CSV comes from the joined `contacts` table;
//     • the opener stage payload recorded NO recipient at all, so the CSV's
//       `selected_recipient_name` fell back to a THIRD re-derivation.
//
//   Three independent recipient sources, no persisted link between them. The fix
//   is to record, on the draft itself, exactly who the opener was written for —
//   so persistence, hydration, row, CSV and review all read one value instead of
//   each re-deriving their own.
//
// This module is pure: no network, no model, no database.

import type { OpenerDecisionMaker } from "./openerBackend.ts";
import type { ResolvedPerson } from "./decisionMakerResolver.ts";

/** The recipient a draft was generated for, persisted alongside the opener. */
export interface CanonicalRecipient {
  /** The persisted contact row id when one exists; null for profile-only people. */
  selected_contact_id: string | null;
  selected_recipient_name: string | null;
  selected_recipient_first_name: string | null;
  selected_recipient_title: string | null;
  selected_recipient_role_family: string | null;
}

const EMPTY_RECIPIENT: CanonicalRecipient = {
  selected_contact_id: null,
  selected_recipient_name: null,
  selected_recipient_first_name: null,
  selected_recipient_title: null,
  selected_recipient_role_family: null,
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The single recipient the opener was generated for.
 *
 * Takes BOTH the prompt-facing `decision_maker` (the exact identity that entered
 * the prompt) and the underlying `ResolvedPerson` (which carries the persisted
 * `contact_id`), so the recorded recipient is precisely who the model wrote to.
 */
export function canonicalRecipient(
  decisionMaker: OpenerDecisionMaker | null,
  resolved: ResolvedPerson | null | undefined,
): CanonicalRecipient {
  if (!decisionMaker) return { ...EMPTY_RECIPIENT };
  return {
    selected_contact_id: str(resolved?.contact_id),
    selected_recipient_name: str(decisionMaker.full_name),
    selected_recipient_first_name: str(decisionMaker.first_name),
    // The prompt uses current_title; role_family stands in when a title is absent.
    selected_recipient_title: str(decisionMaker.current_title) ?? str(decisionMaker.role_family),
    selected_recipient_role_family: str(decisionMaker.role_family),
  };
}

/**
 * Does the person a draft was generated for match a separately-displayed
 * contact? Used for a diagnostic, NOT to block — the two can legitimately differ
 * (an enriched `contacts` row vs a verified decision-maker), and the point is to
 * make the divergence visible and reconcilable rather than silent.
 *
 * Matches on contact_id when both are present; otherwise on a normalized name.
 */
export function recipientMatchesDisplayedContact(
  recipient: CanonicalRecipient,
  displayed: { contact_id?: string | null; full_name?: string | null } | null | undefined,
): boolean {
  if (!displayed) return true; // nothing displayed to contradict
  const dispId = str(displayed.contact_id);
  const recId = recipient.selected_contact_id;
  if (dispId && recId) return dispId === recId;

  const dispName = str(displayed.full_name)?.toLowerCase();
  const recName = recipient.selected_recipient_name?.toLowerCase();
  if (dispName && recName) return dispName === recName;

  // Not enough identity on one side to assert a mismatch.
  return true;
}
