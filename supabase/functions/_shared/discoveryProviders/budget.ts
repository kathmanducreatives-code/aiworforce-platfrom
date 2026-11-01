// Approvals and the usage ledger.
//
//   * A DiscoveryApproval names ONE plan (its hash), one workspace, one mission
//     and a credit ceiling per provider. A different plan is not approved.
//   * An EnrichmentAuthorization is a separate grant for named contacts; a
//     discovery approval never enriches (`enrich.ts`).
//   * Every billable request reserves its credits under an idempotency key
//     first. A key already settled replays its stored result instead of
//     calling the provider again; a key whose charge is uncertain blocks every
//     retry; a key in flight is refused.
//
// `memoryLedger` is the reference implementation (tests, offline demo). The
// held migration `20261027120000_provider_connections.sql` implements the same
// contract in `provider_usage_reserve` / `_settle` for the hosted database.

import type { DiscoveryPlan } from "./routing.ts";
import type { ProviderId } from "./types.ts";

export interface DiscoveryApproval {
  kind: "discovery";
  workspaceId: string;
  missionId: string;
  planHash: string;
  maxCredits: Partial<Record<ProviderId, number>>;
  approvedBy: string;
  approvedAt: string;
}

export interface EnrichmentAuthorization {
  kind: "enrichment";
  workspaceId: string;
  missionId: string;
  /** Canonical person keys (normalize.ts), exactly as shown to the approver. */
  personKeys: string[];
  revealEmail: boolean;
  phones: boolean;
  maxCredits: number;
  approvedBy: string;
  approvedAt: string;
}

export type ApprovalCheck = { ok: true } | { ok: false; reason: string };

/** Does this approval cover this plan for this workspace and mission? */
export function checkDiscoveryApproval(plan: DiscoveryPlan, approval: DiscoveryApproval | null, scope: { workspaceId: string; missionId: string }): ApprovalCheck {
  if (plan.status !== "ready") return { ok: false, reason: `plan is ${plan.status}: ${plan.blockedReason}` };
  if (!plan.requiresApproval) return { ok: true };
  if (!approval) return { ok: false, reason: "approval required before a paid search" };
  if (approval.kind !== "discovery") return { ok: false, reason: "not a discovery approval" };
  if (approval.workspaceId !== scope.workspaceId) return { ok: false, reason: "approval belongs to another workspace" };
  if (approval.missionId !== scope.missionId) return { ok: false, reason: "approval belongs to another mission" };
  if (approval.planHash !== plan.planHash) return { ok: false, reason: "plan changed since it was approved" };
  for (const [p, est] of Object.entries(plan.estimatedCredits)) {
    const cap = approval.maxCredits[p as ProviderId];
    if ((est ?? 0) > 0 && (cap === undefined || cap < (est ?? 0))) return { ok: false, reason: `approval does not cover ${p} (${est} credits)` };
  }
  return { ok: true };
}

export type ReserveResult =
  | { ok: true; replay: false }
  | { ok: true; replay: true; result: unknown }
  | { ok: false; reason: "charge_uncertain" | "in_flight" | "provider_cap" | "mission_cap" };

export interface LedgerEntry {
  workspaceId: string;
  missionId: string;
  provider: ProviderId;
  key: string;
  reserved: number;
  actual: number | null;
  state: "reserved" | "settled" | "uncertain" | "released";
  result?: unknown;
}

export interface UsageLedger {
  reserve(e: { workspaceId: string; missionId: string; provider: ProviderId; key: string; credits: number; providerCap: number; missionCap: number }): Promise<ReserveResult>;
  settle(key: string, actual: number, result?: unknown): Promise<void>;
  markUncertain(key: string): Promise<void>;
  release(key: string): Promise<void>;
  spent(workspaceId: string, missionId: string, provider?: ProviderId): Promise<number>;
}

export function memoryLedger(): UsageLedger & { entries: Map<string, LedgerEntry> } {
  const entries = new Map<string, LedgerEntry>();
  const committed = (e: LedgerEntry) => (e.state === "settled" ? e.actual ?? e.reserved : e.state === "released" ? 0 : e.reserved);
  const sum = (f: (e: LedgerEntry) => boolean) => [...entries.values()].filter(f).reduce((n, e) => n + committed(e), 0);
  return {
    entries,
    async reserve(e) {
      const id = `${e.workspaceId}:${e.key}`;
      const prior = entries.get(id);
      if (prior) {
        if (prior.state === "settled") return { ok: true, replay: true, result: prior.result };
        if (prior.state === "uncertain") return { ok: false, reason: "charge_uncertain" };
        if (prior.state === "reserved") return { ok: false, reason: "in_flight" };
      }
      const prov = sum((x) => x.workspaceId === e.workspaceId && x.missionId === e.missionId && x.provider === e.provider);
      if (prov + e.credits > e.providerCap) return { ok: false, reason: "provider_cap" };
      const mission = sum((x) => x.workspaceId === e.workspaceId && x.missionId === e.missionId);
      if (mission + e.credits > e.missionCap) return { ok: false, reason: "mission_cap" };
      entries.set(id, { workspaceId: e.workspaceId, missionId: e.missionId, provider: e.provider, key: e.key, reserved: e.credits, actual: null, state: "reserved" });
      return { ok: true, replay: false };
    },
    async settle(key, actual, result) {
      for (const e of entries.values()) if (e.key === key) { e.state = "settled"; e.actual = actual; e.result = result; }
    },
    async markUncertain(key) {
      for (const e of entries.values()) if (e.key === key) e.state = "uncertain";
    },
    async release(key) {
      for (const e of entries.values()) if (e.key === key && e.state === "reserved") e.state = "released";
    },
    async spent(workspaceId, missionId, provider) {
      return sum((x) => x.workspaceId === workspaceId && x.missionId === missionId && (!provider || x.provider === provider));
    },
  };
}
