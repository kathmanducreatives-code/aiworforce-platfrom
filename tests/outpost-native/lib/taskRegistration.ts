// Actual database transaction driver. Only Auth may be mocked in synthetic lane.
import { mintJwt, REST_URL, sql } from "../../db-contract/lib/harness.ts";
import {
  createPilotTaskTransaction,
  type NativeBegin,
} from "../../../supabase/functions/_shared/pilot/pilotTaskNativeStore.ts";
import {
  handlePilotTaskRegistration,
  type PilotRegistrationDeps,
} from "../../../supabase/functions/_shared/pilot/pilotTaskRegistration.ts";
import type { fixture } from "../fixture.ts";
import { signing } from "../fixture.ts";
export const begin: NativeBegin = async (fn) => {
  const c = await sql.reserve();
  try {
    await c`begin isolation level read committed`;
    const result = await fn({
      query: async (text, values) =>
        Array.from(await c.unsafe(text, [...values])),
    });
    await c`commit`;
    return result;
  } catch (e) {
    await c`rollback`;
    throw e;
  } finally {
    c.release();
  }
};
export async function registrationDeps(
  x: Awaited<ReturnType<typeof fixture>>,
  authFetch: typeof fetch,
): Promise<PilotRegistrationDeps> {
  const anon = await mintJwt("anon");
  const settings: Record<string, string> = {
    SUPABASE_URL: REST_URL,
    SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: x.service,
    OUTPOST_PILOT_SCOPE_ENABLED: "true",
    OUTPOST_PILOT_REGISTRATION_ENABLED: "true",
    OUTPOST_PILOT_SCOPE_SIGNING_KEY: signing,
    OUTPOST_PILOT_SCOPE_POLICY: JSON.stringify({
      version: 1,
      workspaces: x.enrollments,
    }),
  };
  return {
    env: (k) => settings[k],
    fetch: authFetch,
    transaction: createPilotTaskTransaction(begin),
  };
}
export function invoke(
  deps: PilotRegistrationDeps,
  token: string,
  action: string,
  workspace: string,
  client: string,
  task: string,
  extra = {},
  signal?: AbortSignal,
) {
  return handlePilotTaskRegistration(
    new Request("http://127.0.0.1/offline-task-security", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        workspace_id: workspace,
        client_binding_id: client,
        task_id: task,
        ...extra,
      }),
    }),
    deps,
  );
}
