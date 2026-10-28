// Workspace provider connections: connect, verify, list, usage, disconnect.
//
// The rules, all enforced here (the edge function is a thin wrapper):
//   * Off unless PROVIDER_DISCOVERY_ENABLED and the workspace is allowlisted.
//   * Any member may LIST status; only owner/admin may connect, re-verify,
//     refresh usage or disconnect.
//   * A provider must be enabled, and Apollo / LeadOcean need their commercial
//     terms flag, before a key is accepted.
//   * A key is stored only after a FREE call proves it (LeadOcean /v1/usage,
//     Apollo People API Search with one row, Apify /v2/users/me).
//   * The key goes into Vault through the store and never comes back out of
//     this module: responses carry status, capabilities, usage and a short
//     fingerprint only.
//
// The store is injected: production uses the held migration's service-only
// functions; tests use `memoryConnectionStore`.

import type { DiscoveryAdapter, UsageInfo } from "./adapter.ts";
import { workspaceAllowed, type DiscoveryFlags } from "./flags.ts";
import { PROVIDERS } from "./providers.ts";
import { PROVIDER_IDS, ProviderError, type ProviderCapability, type ProviderId } from "./types.ts";

export type ConnectionStatus = "not_connected" | "connected" | "invalid" | "error";

export interface ConnectionRow {
  workspaceId: string;
  provider: ProviderId;
  status: ConnectionStatus;
  keyFingerprint: string | null;
  usage: UsageInfo | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  connectedBy: string | null;
}

export interface ConnectionStore {
  memberRole(userId: string, workspaceId: string): Promise<string | null>;
  list(workspaceId: string): Promise<ConnectionRow[]>;
  /** Writes the key to Vault and the row; replaces an existing key. */
  store(row: ConnectionRow, secret: string): Promise<void>;
  secret(workspaceId: string, provider: ProviderId): Promise<string | null>;
  mark(workspaceId: string, provider: ProviderId, patch: Partial<Pick<ConnectionRow, "status" | "usage" | "lastVerifiedAt" | "lastError">>): Promise<void>;
  remove(workspaceId: string, provider: ProviderId): Promise<void>;
}

export interface ConnectionView {
  provider: ProviderId;
  label: string;
  status: ConnectionStatus;
  enabled: boolean;
  commercialTermsConfirmed: boolean;
  capabilities: ProviderCapability[];
  keyFingerprint: string | null;
  usage: UsageInfo | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export type Verifier = (provider: ProviderId, apiKey: string) => Promise<UsageInfo>;

export type ConnectionRequest =
  | { action: "list"; workspaceId: string }
  | { action: "connect"; workspaceId: string; provider: ProviderId; apiKey: string }
  | { action: "verify" | "usage" | "disconnect"; workspaceId: string; provider: ProviderId };

export interface HandlerResult { status: number; body: Record<string, unknown> }

const ADMIN = new Set(["owner", "admin"]);

export async function fingerprint(secret: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function validKeyShape(k: unknown): k is string {
  return typeof k === "string" && k.length >= 8 && k.length <= 512 && !/\s/.test(k);
}

function view(p: ProviderId, row: ConnectionRow | undefined, flags: DiscoveryFlags): ConnectionView {
  return {
    provider: p, label: PROVIDERS[p].label,
    status: row?.status ?? "not_connected",
    enabled: flags.provider[p], commercialTermsConfirmed: flags.commercialTerms[p],
    capabilities: PROVIDERS[p].capabilities,
    keyFingerprint: row?.keyFingerprint ?? null, usage: row?.usage ?? null,
    lastVerifiedAt: row?.lastVerifiedAt ?? null, lastError: row?.lastError ?? null,
  };
}

function errorText(e: unknown): { status: ConnectionStatus; message: string } {
  if (e instanceof ProviderError) {
    if (e.kind === "auth_failed" || e.kind === "forbidden_scope") return { status: "invalid", message: e.kind === "auth_failed" ? "The provider rejected this key." : "This key is missing a required scope." };
    return { status: "error", message: `Provider unavailable (${e.kind}).` };
  }
  return { status: "error", message: "Verification failed." };
}

export async function handleConnections(req: ConnectionRequest, ctx: { userId: string | null; flags: DiscoveryFlags; store: ConnectionStore; verify: Verifier; now?: () => Date }): Promise<HandlerResult> {
  const now = ctx.now ?? (() => new Date());
  if (!ctx.flags.enabled) return { status: 404, body: { error: "disabled" } };
  if (!ctx.userId) return { status: 401, body: { error: "sign in required" } };
  if (!workspaceAllowed(ctx.flags, req.workspaceId)) return { status: 403, body: { error: "provider discovery is not enabled for this workspace" } };
  const role = await ctx.store.memberRole(ctx.userId, req.workspaceId);
  if (!role) return { status: 403, body: { error: "not a member of this workspace" } };

  if (req.action === "list") {
    const rows = await ctx.store.list(req.workspaceId);
    return { status: 200, body: { connections: PROVIDER_IDS.map((p) => view(p, rows.find((r) => r.provider === p && r.workspaceId === req.workspaceId), ctx.flags)) } };
  }
  if (!ADMIN.has(role)) return { status: 403, body: { error: "only a workspace owner or admin can manage connections" } };
  if (!PROVIDER_IDS.includes(req.provider)) return { status: 400, body: { error: "unknown provider" } };
  const p = req.provider;

  if (req.action === "disconnect") {
    await ctx.store.remove(req.workspaceId, p);
    return { status: 200, body: { connection: view(p, undefined, ctx.flags) } };
  }
  if (!ctx.flags.provider[p]) return { status: 403, body: { error: `${PROVIDERS[p].label} is not enabled` } };
  if (PROVIDERS[p].requiresCommercialTermsFlag && !ctx.flags.commercialTerms[p]) {
    return { status: 403, body: { error: `${PROVIDERS[p].label} commercial terms have not been confirmed for customer use` } };
  }

  if (req.action === "connect") {
    if (!validKeyShape(req.apiKey)) return { status: 400, body: { error: "that does not look like an API key" } };
    let usage: UsageInfo;
    try {
      usage = await ctx.verify(p, req.apiKey);
    } catch (e) {
      const t = errorText(e);
      // Nothing is stored for a key that did not verify.
      return { status: t.status === "invalid" ? 400 : 502, body: { error: t.message } };
    }
    const row: ConnectionRow = {
      workspaceId: req.workspaceId, provider: p, status: "connected", keyFingerprint: await fingerprint(req.apiKey),
      usage, lastVerifiedAt: now().toISOString(), lastError: null, connectedBy: ctx.userId,
    };
    await ctx.store.store(row, req.apiKey);
    return { status: 200, body: { connection: view(p, row, ctx.flags) } };
  }

  // verify / usage: re-check the stored key with a free call.
  const secret = await ctx.store.secret(req.workspaceId, p);
  if (!secret) return { status: 404, body: { error: "not connected" } };
  try {
    const usage = await ctx.verify(p, secret);
    await ctx.store.mark(req.workspaceId, p, { status: "connected", usage, lastVerifiedAt: now().toISOString(), lastError: null });
  } catch (e) {
    const t = errorText(e);
    await ctx.store.mark(req.workspaceId, p, { status: t.status, lastError: t.message, lastVerifiedAt: now().toISOString() });
  }
  const rows = await ctx.store.list(req.workspaceId);
  return { status: 200, body: { connection: view(p, rows.find((r) => r.provider === p), ctx.flags) } };
}

/** The free verification call for each provider, given an adapter factory. */
export function verifierFrom(make: (p: ProviderId, apiKey: string) => Pick<DiscoveryAdapter, "verifyKey">): Verifier {
  return (p, key) => make(p, key).verifyKey();
}

export function memoryConnectionStore(members: Record<string, Record<string, string>>): ConnectionStore & { secrets: Map<string, string>; rows: Map<string, ConnectionRow> } {
  const rows = new Map<string, ConnectionRow>();
  const secrets = new Map<string, string>();
  const id = (w: string, p: ProviderId) => `${w}:${p}`;
  return {
    rows, secrets,
    async memberRole(u, w) { return members[w]?.[u] ?? null; },
    async list(w) { return [...rows.values()].filter((r) => r.workspaceId === w).map((r) => ({ ...r })); },
    async store(row, secret) { rows.set(id(row.workspaceId, row.provider), { ...row }); secrets.set(id(row.workspaceId, row.provider), secret); },
    async secret(w, p) { return secrets.get(id(w, p)) ?? null; },
    async mark(w, p, patch) { const r = rows.get(id(w, p)); if (r) rows.set(id(w, p), { ...r, ...patch }); },
    async remove(w, p) { rows.delete(id(w, p)); secrets.delete(id(w, p)); },
  };
}
