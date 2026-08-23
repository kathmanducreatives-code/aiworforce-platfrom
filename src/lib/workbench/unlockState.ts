// WHAT A CELL CAN SAY ABOUT ITSELF, DERIVED FROM THE STAGE THAT OWNS IT.
//
// ── ONE STATE SYSTEM, NOT A SECOND ──────────────────────────────────────────
//
// `WorkbenchAccountView` already models per-stage progress — `company_research`,
// `decision_makers`, `contact_enrichment`, `outreach` — each an `AccountStage`
// with a latest `attempt` and a `last_success`. `LeadResultsView` has been
// hydrating it on every load the whole time; when the spreadsheet was replaced
// with cards the renderer went and the state machine kept running, feeding
// nothing.
//
// This is a projection of that model onto what a CELL can display. It invents
// no stages and stores nothing: give it the stage and the provider readiness,
// and it says which of the six cell states applies.
//
// ── THE DISTINCTION THAT MATTERS ────────────────────────────────────────────
//
// "Nobody asked for this yet" and "this cannot run" look identical in a naive
// rendering and mean opposite things. The first is the ordinary resting state
// of every row when a run finishes — an offer. The second is a provider the
// user has to go and configure. A cell that shows one as the other either
// nags about work that cannot happen, or hides a setup problem behind a
// button that will never succeed.
//
// Pure — no React, no network.

import type { AccountStage } from '../workbenchAccountView.ts';

export const UNLOCK_STATE_VERSION = 'workbench-unlock-state-v1' as const;

export type UnlockState =
  | 'not_researched' | 'processing' | 'unlocked' | 'unavailable' | 'failed'
  /**
   * The provider RAN, SUCCEEDED, and there was nothing to find.
   *
   * ── THE STATE THAT WAS MISSING, AND WHAT IT WAS BEING SHOWN AS ───────────
   *
   * A succeeded attempt with no `last_success` fell through every branch below
   * and rendered as `not_researched` — an offer, identical to a row nobody had
   * ever touched. So a user who had already paid to search for a decision maker
   * at a company that has none was shown the same "Find contact · 2 credits"
   * button, and pressing it bought the same nothing again.
   *
   * DISTINCT FROM `failed`: nothing went wrong. The company genuinely has no
   * matching person, or the email lookup genuinely returned no address. That is
   * an ANSWER, and it is worth what was paid for it.
   *
   * DISTINCT FROM `unlocked`: there is no value to display.
   */
  | 'not_found'
  /**
   * The reserve declined. Nothing ran and nothing was charged.
   *
   * DISTINCT FROM `failed`, which means a provider was paid for and did not
   * deliver. "Try again" is wrong here — the balance has to change first — and
   * a user needs to know the attempt cost them nothing.
   */
  | 'insufficient_credits';

export interface UnlockInput<T> {
  stage: AccountStage<T> | undefined;
  /**
   * False when the provider this stage needs is not configured.
   *
   * Checked BEFORE the attempt, because a stage that cannot run should say so
   * even if an older attempt once succeeded — the button would fail now.
   */
  providerReady?: boolean;
}

/**
 * Which of the six states this cell is in.
 *
 * `last_success` outranks a later failed attempt: data we already hold does not
 * stop being held because a retry failed, and showing "Try again" over a value
 * the user can see would be a lie about what is on screen.
 */
export function unlockStateFor<T>(i: UnlockInput<T>): UnlockState {
  const { stage, providerReady = true } = i;
  const attempt = stage?.attempt ?? null;

  if (attempt?.status === 'running') return 'processing';
  // REFUSED BEFORE EXECUTION. Checked before `last_success` so a refusal on a
  // re-unlock is visible, and before `failed` so it is never mistaken for a
  // provider that ran and lost.
  if (attempt?.reason_code === 'credit_authorization_refused'
    && stage?.last_success == null) return 'insufficient_credits';
  // HELD DATA WINS. A failed retry does not un-hold what we already have.
  if (stage?.last_success != null) return 'unlocked';
  if (!providerReady) return 'unavailable';
  if (attempt && attempt.status !== 'succeeded') return 'failed';
  // RAN, SUCCEEDED, FOUND NOTHING.
  //
  // Ordered AFTER `unlocked` and `failed` and BEFORE `not_researched`: it is
  // only reachable when an attempt exists, completed, and produced no value.
  // Without this branch that row rendered as an untouched offer and the user
  // was invited to buy the same nothing again.
  if (attempt?.status === 'succeeded') return 'not_found';
  return 'not_researched';
}

/** The failure message a `failed` cell shows, if the attempt recorded one. */
export function unlockFailureReason<T>(stage: AccountStage<T> | undefined): string | null {
  const a = stage?.attempt;
  if (!a || a.status === 'succeeded' || a.status === 'running') return null;
  return a.failure_reason ?? a.message ?? a.reason_code ?? null;
}
