// WHAT AN UNLOCK COSTS. SERVER-SIDE, AND NEVER SUPPLIED BY A CALLER.
//
// `src/lib/pricing/workflowCosts.ts` carries the frontend catalogue and its own
// header asks for this mirror. The frontend copy is for DISPLAY — showing a
// price before the user commits. This copy is the one that charges. If they ever
// disagree, this one is right, because the browser's is editable by whoever is
// running the browser.
//
// PURE. No network, no database, no Deno.env.

/** Per-company unlock prices, in internal Agentory credits. */
export const UNLOCK_CREDIT_COSTS = {
  // Anchored to the existing catalogue's `decision_makers_5_accounts: 12`
  // (≈2.4 credits per company), rounded up.
  founder_unlock: 3,
  // Cheaper than the founder unlock: by the time this runs the person is
  // already resolved and verified, so it buys one further lookup, not a search.
  contact_unlock: 2,
} as const;

export type UnlockKind = keyof typeof UNLOCK_CREDIT_COSTS;

export function isUnlockKind(v: unknown): v is UnlockKind {
  return typeof v === "string" && v in UNLOCK_CREDIT_COSTS;
}

/** The price of one company's unlock. The caller cannot influence it. */
export function unlockPrice(kind: UnlockKind): number {
  return UNLOCK_CREDIT_COSTS[kind];
}

export type ChargeStatus = "charged" | "partial" | "not_charged";

export interface UnlockCharge {
  actual: number;
  status: ChargeStatus;
  reason: string;
}

/**
 * What to actually charge for one company's unlock.
 *
 * THIS DEPARTS DELIBERATELY FROM `computeActualCharge`.
 *
 * The frontend policy has a `minimum_charge` branch: a provider that ran but
 * produced nothing accepted still bills 20%. That rule was written for
 * multi-item workflows, where "ran and found little" is a normal partial
 * outcome across many rows.
 *
 * A single-company founder unlock is not that shape. The user pressed a button
 * against ONE named company and got nobody. Billing for that is a support
 * ticket rather than revenue, so a zero-result unlock is released in full — the
 * provider cost is ours, not theirs.
 *
 * The one thing this must never do is charge for work that did not happen: a
 * failure before the provider ran is always zero.
 */
export function computeUnlockCharge(i: {
  reserved: number;
  /** Did a provider actually execute and cost us money? */
  providerRan: boolean;
  /** People who survived verification. Zero is the case above. */
  verifiedCount: number;
}): UnlockCharge {
  if (!i.providerRan) {
    return {
      actual: 0, status: "not_charged",
      reason: "no provider ran; nothing was spent on the user's behalf",
    };
  }
  if (i.verifiedCount <= 0) {
    return {
      actual: 0, status: "not_charged",
      reason: "the provider ran but verified nobody at this company",
    };
  }
  return {
    actual: i.reserved, status: "charged",
    reason: `${i.verifiedCount} verified`,
  };
}

/**
 * The frontend charge policy, mirrored verbatim for any multi-item workflow
 * that later bills from the edge.
 *
 * Kept identical to `src/lib/pricing/workflowCosts.ts` ON PURPOSE, including
 * the `minimum_charge` branch that `computeUnlockCharge` above declines to use.
 * Two copies that drift silently are worse than one copy plus an explicit,
 * documented exception.
 */
export function computeActualCharge(opts: {
  estimated: number;
  requested: number;
  accepted: number;
  providerRan: boolean;
  failedBeforeProvider?: boolean;
}): { actual: number; status: "charged" | "partial" | "minimum_charge" | "not_charged" } {
  const { estimated, requested, accepted, providerRan, failedBeforeProvider } = opts;
  if (failedBeforeProvider || !providerRan) return { actual: 0, status: "not_charged" };
  if (requested <= 0 || estimated <= 0) return { actual: 0, status: "not_charged" };
  if (accepted >= requested) return { actual: estimated, status: "charged" };
  if (accepted <= 0) {
    const min = Math.max(1, Math.round(estimated * 0.2));
    return { actual: min, status: "minimum_charge" };
  }
  const proportional = Math.round((accepted / requested) * estimated);
  const min = Math.max(1, Math.round(estimated * 0.25));
  return { actual: Math.max(min, proportional), status: "partial" };
}
