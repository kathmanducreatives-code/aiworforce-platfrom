// The `provider-discovery` edge function's logic, with every dependency
// injected so it runs offline in tests.
//
//   plan  {workspace_id, message_id, selection}
//         Reads the compiled mission from the approval card the mission
//         compiler already wrote (messages.metadata.lead_mission), and returns
//         the provider plan: which providers, which requirements each filters,
//         post-verifies or cannot satisfy, the bounded estimate, and whether
//         approval is needed. No provider is called.
//   run   {workspace_id, message_id, selection, approval: {plan_hash, max_credits}}
//         Owner/admin only. Re-plans, requires the approval to name exactly
//         that plan, runs it, and writes the qualified and needs-verification
//         leads into the Leads tables. Never enriches.
//
// Off unless PROVIDER_DISCOVERY_ENABLED and the workspace is allowlisted.

import type { DiscoveryAdapter } from "./adapter.ts";
import type { apifyAdapter } from "./adapters/apify.ts";
import type { DiscoveryApproval, UsageLedger } from "./budget.ts";
import type { ConnectionStore } from "./connections.ts";
import { workspaceAllowed, type DiscoveryFlags } from "./flags.ts";
import { projectLead, type ProjectedLead } from "./leadProjection.ts";
import { runDiscovery, type DiscoveryRun } from "./orchestrator.ts";
import { requirementsFromMission } from "./requirements.ts";
import { planDiscovery, type ProviderConnectionState, type Selection } from "./routing.ts";
import { PROVIDER_IDS, type ProviderId } from "./types.ts";

export interface DiscoveryRequest {
  action: "plan" | "run";
  workspaceId: string;
  messageId: string;
  selection: Selection;
  approval?: { planHash: string; maxCredits: Partial<Record<ProviderId, number>> } | null;
}

export interface DiscoveryDeps {
  userId: string | null;
  flags: DiscoveryFlags;
  store: ConnectionStore;
  /** The compiled mission on that message, only if the message belongs to the workspace. */
  loadMission(workspaceId: string, messageId: string): Promise<Record<string, unknown> | null>;
  adapterFor(provider: ProviderId, apiKey: string): DiscoveryAdapter;
  /** The existing Apify invoker, when this deployment wires one; null keeps Apify off. */
  verifier: ReturnType<typeof apifyAdapter> | null;
  ledger: UsageLedger;
  persist(rows: ProjectedLead[]): Promise<void>;
  now?: () => Date;
}

const ADMIN = new Set(["owner", "admin"]);

function parseSelection(s: unknown): Selection | null {
  if (s === "auto" || s === undefined || s === null) return "auto";
  if (Array.isArray(s) && s.length && s.every((x) => PROVIDER_IDS.includes(x as ProviderId))) return s as ProviderId[];
  return null;
}

export function parseDiscoveryRequest(body: Record<string, unknown>): DiscoveryRequest | null {
  const selection = parseSelection(body.selection);
  if (body.action !== "plan" && body.action !== "run") return null;
  if (typeof body.workspace_id !== "string" || typeof body.message_id !== "string" || !selection) return null;
  const a = body.approval as { plan_hash?: unknown; max_credits?: unknown } | null | undefined;
  return {
    action: body.action, workspaceId: body.workspace_id, messageId: body.message_id, selection,
    approval: a && typeof a.plan_hash === "string" && a.max_credits && typeof a.max_credits === "object"
      ? { planHash: a.plan_hash, maxCredits: a.max_credits as Partial<Record<ProviderId, number>> } : null,
  };
}

export async function handleDiscovery(req: DiscoveryRequest, d: DiscoveryDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = d.now ?? (() => new Date());
  if (!d.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!d.userId) return { status: 401, body: { error: "sign in required" } };
  if (!workspaceAllowed(d.flags, req.workspaceId)) return { status: 403, body: { error: "provider discovery is not enabled for this workspace" } };
  const role = await d.store.memberRole(d.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };
  if (req.action === "run" && !ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can approve a paid search" } };

  const mission = await d.loadMission(req.workspaceId, req.messageId);
  if (!mission) return { status: 404, body: { error: "no compiled mission on that message" } };
  const requirements = requirementsFromMission(mission);

  const rows = await d.store.list(req.workspaceId);
  const connections: ProviderConnectionState[] = PROVIDER_IDS.map((p) => {
    const r = rows.find((x) => x.provider === p);
    return {
      provider: p,
      // Apify runs through the platform's invoker; without one wired it is not connected.
      connected: p === "apify" ? !!d.verifier : r?.status === "connected",
      enabled: d.flags.provider[p], commercialTermsConfirmed: d.flags.commercialTerms[p],
      remainingCredits: r?.usage?.remaining ?? null,
      recentFailures: r && r.status !== "connected" ? 1 : 0,
    };
  });
  const plan = planDiscovery({ requirements, connections, selection: req.selection });
  if (req.action === "plan") return { status: 200, body: { plan, requirements } };

  const approval: DiscoveryApproval | null = req.approval
    ? { kind: "discovery", workspaceId: req.workspaceId, missionId: req.messageId, planHash: req.approval.planHash, maxCredits: req.approval.maxCredits, approvedBy: d.userId, approvedAt: now().toISOString() }
    : null;
  const adapters: Partial<Record<ProviderId, DiscoveryAdapter>> = {};
  for (const s of plan.steps) {
    if (s.provider === "apify") continue;
    const key = await d.store.secret(req.workspaceId, s.provider);
    if (key) adapters[s.provider] = d.adapterFor(s.provider, key);
  }
  const run: DiscoveryRun = await runDiscovery({
    workspaceId: req.workspaceId, missionId: req.messageId, requirements, plan, approval,
    adapters, verifier: d.verifier, ledger: d.ledger, now,
  });
  if (run.status === "blocked") return { status: 409, body: { error: run.reason, plan } };
  for (const s of run.steps) {
    if (s.errorKind === "auth_failed") {
      await d.store.mark(req.workspaceId, s.provider, { status: "invalid", lastError: "The provider rejected the stored key." });
    } else if (s.errorKind === "forbidden_scope" || s.errorKind === "plan_restricted") {
      // The key still works: record the limit, keep the connection.
      await d.store.mark(req.workspaceId, s.provider, { lastError: s.errorKind === "plan_restricted" ? "The provider's plan does not include this search." : "The stored key lacks the scope this search needs." });
    }
  }
  const projected = run.leads.map((l) => projectLead(l, { workspaceId: req.workspaceId, missionId: req.messageId, run, roles: requirements.roles })).filter((x): x is ProjectedLead => !!x);
  await d.persist(projected);
  return {
    status: 200,
    body: {
      run: { status: run.status, reason: run.reason, counts: run.counts, steps: run.steps, credits: run.credits, verification: run.verification, merge: run.merge, planHash: run.planHash },
      written: projected.length,
    },
  };
}
