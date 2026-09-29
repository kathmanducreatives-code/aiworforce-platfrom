// WHAT THE BETA ACCESS CARD SAYS, FROM THE WORKSPACE'S LATEST REQUEST.
//
// Spend fails closed and credits are granted to approved beta workspaces. When
// Pilot answers a paid Start with "no credits yet", the card under that reply
// files the request (`beta_access_requests`) and then reports where it stands.
// An operator decides it (scripts/beta/review-requests.ts). PURE.

export interface BetaRequestRow {
  id: string;
  status: string;
  credits_granted: number | null;
  created_at: string;
  decided_at: string | null;
}

export type BetaAccessState = "none" | "pending" | "approved" | "declined";

export interface BetaAccessView {
  state: BetaAccessState;
  title: string;
  body: string;
  /** Show the request form. True with no request, and after a decline. */
  canRequest: boolean;
}

/** The latest request decides the card. Null means none was ever filed. */
export function betaAccessView(latest: BetaRequestRow | null): BetaAccessView {
  if (!latest) {
    return {
      state: "none", canRequest: true, title: "Private beta",
      body: "Searches that buy provider data run for approved workspaces. Request access and we'll add credits.",
    };
  }
  if (latest.status === "pending") {
    return {
      state: "pending", canRequest: false, title: "Request received",
      body: `Requested ${latest.created_at.slice(0, 10)}. We'll add credits to this workspace when it's approved — nothing to do until then.`,
    };
  }
  if (latest.status === "approved") {
    const n = latest.credits_granted ?? 0;
    return {
      state: "approved", canRequest: false, title: "Beta access approved",
      body: `${n} ${n === 1 ? "credit was" : "credits were"} added to this workspace. Start the search again to run it.`,
    };
  }
  return {
    state: "declined", canRequest: true, title: "Not approved yet",
    body: "This request wasn't approved. You can send another with a note about what you want to run.",
  };
}

/** Postgres unique_violation: a request is already open for this workspace. */
export const isAlreadyRequested = (e: { code?: string } | null | undefined) => e?.code === "23505";

export const MAX_NOTE = 1000;
