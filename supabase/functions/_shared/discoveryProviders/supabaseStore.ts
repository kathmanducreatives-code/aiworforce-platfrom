// The hosted implementations of ConnectionStore and UsageLedger, over the HELD
// migration 20261027120000_provider_connections.sql. Every call uses the
// service client and the migration's service-only functions; the caller (the
// edge function) has already authenticated the user and `connections.ts` /
// `discoveryService.ts` have checked membership and role.
//
// Until that migration is applied, every call here fails (the functions do not
// exist) and the flags keep the edge functions off anyway.

import type { LedgerEntry, ReserveResult, UsageLedger } from "./budget.ts";
import type { ConnectionRow, ConnectionStore } from "./connections.ts";
import type { ProviderId } from "./types.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The service-role client (as the other shared stores type it). */
type Admin = SupabaseClient;

function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error(`provider store: ${(r.error as { message?: string })?.message ?? "error"}`);
  return r.data;
}

export function supabaseConnectionStore(admin: Admin): ConnectionStore {
  return {
    async memberRole(userId, workspaceId) {
      const r = await admin.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      return (must(r) as { role?: string } | null)?.role ?? null;
    },
    async list(workspaceId) {
      const r = await admin.from("workspace_provider_connections")
        .select("workspace_id, provider, status, key_fingerprint, usage, last_verified_at, last_error, connected_by")
        .eq("workspace_id", workspaceId);
      return (must(r) as Record<string, unknown>[]).map((x): ConnectionRow => ({
        workspaceId: x.workspace_id as string, provider: x.provider as ProviderId, status: x.status as ConnectionRow["status"],
        keyFingerprint: (x.key_fingerprint as string) ?? null, usage: (x.usage as ConnectionRow["usage"]) ?? null,
        lastVerifiedAt: (x.last_verified_at as string) ?? null, lastError: (x.last_error as string) ?? null,
        connectedBy: (x.connected_by as string) ?? null,
      }));
    },
    async store(row, secret) {
      must(await admin.rpc("provider_connection_store", {
        p_workspace: row.workspaceId, p_provider: row.provider, p_secret: secret,
        p_fingerprint: row.keyFingerprint, p_usage: row.usage, p_actor: row.connectedBy,
      }));
    },
    async secret(workspaceId, provider) {
      return (must(await admin.rpc("provider_connection_secret", { p_workspace: workspaceId, p_provider: provider })) as string | null) ?? null;
    },
    async mark(workspaceId, provider, patch) {
      must(await admin.rpc("provider_connection_mark", {
        p_workspace: workspaceId, p_provider: provider, p_status: patch.status ?? "connected",
        p_usage: patch.usage ?? null, p_error: patch.lastError ?? null,
      }));
    },
    async remove(workspaceId, provider) {
      must(await admin.rpc("provider_connection_remove", { p_workspace: workspaceId, p_provider: provider }));
    },
  };
}

export function supabaseLedger(admin: Admin, workspaceId: string): UsageLedger {
  const finish = async (key: string, state: LedgerEntry["state"], actual: number | null, result: unknown) => {
    must(await admin.rpc("provider_usage_finish", { p_workspace: workspaceId, p_key: key, p_state: state, p_actual: actual, p_result: result ?? null }));
  };
  return {
    async reserve(e) {
      if (e.workspaceId !== workspaceId) return { ok: false, reason: "mission_cap" };
      const cap = (n: number) => (Number.isFinite(n) ? n : 2_147_483_647);
      return must(await admin.rpc("provider_usage_reserve", {
        p_workspace: e.workspaceId, p_mission: e.missionId, p_provider: e.provider, p_key: e.key,
        p_credits: e.credits, p_provider_cap: cap(e.providerCap), p_mission_cap: cap(e.missionCap),
      })) as ReserveResult;
    },
    settle: (key, actual, result) => finish(key, "settled", actual, result),
    markUncertain: (key) => finish(key, "uncertain", null, null),
    release: (key) => finish(key, "released", null, null),
    async spent(ws, missionId, provider) {
      let q = admin.from("provider_usage_ledger").select("credits_reserved, credits_actual, state").eq("workspace_id", ws).eq("mission_id", missionId);
      if (provider) q = q.eq("provider", provider);
      const rows = must(await q) as { credits_reserved: number; credits_actual: number | null; state: string }[];
      return rows.reduce((n, r) => n + (r.state === "settled" ? r.credits_actual ?? r.credits_reserved : r.state === "released" ? 0 : r.credits_reserved), 0);
    },
  };
}
