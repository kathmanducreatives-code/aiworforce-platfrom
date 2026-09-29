// A WORKSPACE WITHOUT CREDITS IS REFUSED BEFORE ANYTHING IS QUEUED.
//
// Credit enforcement fails closed (`resolveCreditEnforcement`), and credits are
// granted only to approved beta workspaces. Every paid provider call already
// reserves a credit and is refused without one — but that refusal lands
// mid-run, after a plan, a task and a queue row exist, and it reads as a
// failure. This gate answers the question at the door: a mission that will buy
// provider data starts only when the workspace holds at least one credit.
//
// It is the product's answer, not the enforcement. The per-call reservation
// stays the authority everywhere (continue-workflow, direct run-agent calls,
// Radar); this only keeps a no-credit workspace from starting a run it cannot
// pay for.
//
// PURE.

import type { CreditEnforcementMode } from "./creditAuthorization.ts";

/** orchestrate's error code for a refused start. pilot-chat reads it. */
export const CREDITS_REQUIRED = "credits_required" as const;

/** The least a paid mission needs to begin: one provider call. */
export const MIN_CREDITS_TO_START = 1;

/** What the user reads. Says what is wrong and what to do, and blames nothing. */
export const BETA_ACCESS_MESSAGE =
  "This workspace doesn't have credits yet. Agentory is in private beta, and searches that buy " +
  "provider data run for approved workspaces. Request beta access and we'll add credits to your " +
  "workspace — chat, Company Brain and drafting keep working in the meantime.";

export interface CreditStartDecision {
  allowed: boolean;
  reason: "enforcement_off" | "has_credits" | "no_credits" | "balance_unreadable";
  balance: number | null;
}

/**
 * May a paid mission start?
 *
 * `balance` is the workspace's `workspace_credit_balances.balance_credits`:
 * null when there is no row (a workspace nobody granted anything) or the read
 * failed. Under `enforce` both refuse — an unreadable balance is not a funded
 * one. `observe` never refuses, and says why.
 */
export function creditStartGate(i: {
  mode: CreditEnforcementMode;
  balance: number | null;
  readFailed?: boolean;
  minimum?: number;
}): CreditStartDecision {
  const balance = typeof i.balance === "number" && Number.isFinite(i.balance) ? i.balance : null;
  if (i.mode !== "enforce") return { allowed: true, reason: "enforcement_off", balance };
  if (i.readFailed) return { allowed: false, reason: "balance_unreadable", balance: null };
  const minimum = i.minimum ?? MIN_CREDITS_TO_START;
  if (balance === null || balance < minimum) return { allowed: false, reason: "no_credits", balance };
  return { allowed: true, reason: "has_credits", balance };
}

/**
 * Does this start request buy provider data?
 *
 * A compiled lead mission always does, and so does an explicit Apify sourcing
 * tool. Everything else orchestrate plans (content, research drafts) is
 * model-only here and stays governed by the model-spend ceiling — the gate must
 * not lock a no-credit workspace out of the parts of the product that are free.
 */
export function startBuysProviderData(body: Record<string, unknown>): boolean {
  const toolInput = (body.tool_input ?? null) as Record<string, unknown> | null;
  if (body.lead_mission != null || toolInput?.lead_mission != null) return true;
  const tool = String(toolInput?.tool_name ?? body.tool_needed ?? "");
  return tool === "source_with_apify";
}
