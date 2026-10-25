// Native containment supplements P1's existing HMAC and relational checks.
// No caller-supplied authorization, SQL role, session ID or policy override.
import type { AuthDeps } from "../requestAuth.ts";
import { type PilotEnrollment, PilotRefusal } from "./pilotPolicy.ts";
import type { PilotScopeStore } from "./pilotScopeStore.ts";
export function guardPilotStore(
  store: PilotScopeStore,
  deps: AuthDeps,
  token: string,
  enrollment: PilotEnrollment,
  task: string | null,
): PilotScopeStore {
  const check = async (taskId = task) => {
    const url = deps.env("SUPABASE_URL"), key = deps.env("SUPABASE_ANON_KEY");
    if (!url || !key || !token) {
      throw new PilotRefusal("pilot_native_access_unavailable", 503);
    }
    let response: Response;
    try {
      response = await deps.fetch(`${url}/rest/v1/rpc/outpost_pilot_access`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_workspace: enrollment.workspace_id,
          p_client: enrollment.client_binding_id,
          p_version: enrollment.version,
          p_task: taskId,
        }),
      });
    } catch {
      throw new PilotRefusal("pilot_native_access_unavailable", 503);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PilotRefusal(
        "pilot_native_access_unavailable",
        [401, 403].includes(response.status) ? 403 : 503,
      );
    }
    let allowed: unknown;
    try {
      allowed = await response.json();
    } catch {
      throw new PilotRefusal("pilot_native_access_unavailable", 503);
    }
    if (allowed !== true) {
      throw new PilotRefusal("pilot_native_access_refused", 403);
    }
  };
  const workspace = (w: string) => {
    if (w !== enrollment.workspace_id) {
      throw new PilotRefusal("pilot_native_access_refused", 403);
    }
  };
  return {
    async member(w, u) {
      workspace(w);
      await check();
      const r = await store.member(w, u);
      await check();
      return r;
    },
    async brain(w) {
      workspace(w);
      await check();
      const r = await store.brain(w);
      await check();
      return r;
    },
    async records(w, k, ids) {
      workspace(w);
      await check();
      if (k === "task") { for (const id of ids) await check(id); }
      const rows = await store.records(w, k, ids);
      await check();
      return rows;
    },
    async bind(row, payload) {
      workspace(String(row.workspace_id));
      await check(String(row.id));
      const r = await store.bind(row, payload);
      await check(String(row.id));
      return r;
    },
  };
}
