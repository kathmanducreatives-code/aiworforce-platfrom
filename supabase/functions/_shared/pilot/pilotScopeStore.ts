// deno-lint-ignore no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AuthDeps } from "../requestAuth.ts";
import { PilotRefusal } from "./pilotPolicy.ts";
export type Row = Record<string, unknown>;
export const RESOURCES = {
  account: "accounts",
  contact: "contacts",
  lead: "lead_candidates",
  memory: "saved_outputs",
  draft: "outreach_drafts",
  research: "tool_calls",
  task: "tasks",
  plan: "task_plans",
  conversation: "conversations",
  signal: "signals",
  approval: "approvals",
  agent: "agents",
} as const;
export type ResourceKind = keyof typeof RESOURCES;
export interface ResourceRef {
  kind: ResourceKind;
  id: string;
}
export interface PilotScopeStore {
  member(workspace: string, user: string): Promise<Row | null>;
  brain(workspace: string): Promise<Row | null>;
  records(
    workspace: string,
    kind: ResourceKind,
    ids: readonly string[],
  ): Promise<Row[]>;
  bind(task: Row, payload: Row): Promise<Row | null>;
}
// No listing, joins, external identifiers, user-supplied table names, or global cache.
export function createPilotScopeStore(deps: AuthDeps): PilotScopeStore {
  const url = deps.env("SUPABASE_URL"),
    key = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new PilotRefusal("server_misconfigured", 503);
  const db = createClient(url, key, {
    global: { fetch: deps.fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async member(workspace, user) {
      const { data, error } = await db.from("workspace_members").select(
        "workspace_id,user_id,role",
      ).eq("workspace_id", workspace).eq("user_id", user).maybeSingle();
      if (error) throw new PilotRefusal("pilot_store_unavailable", 503);
      return data;
    },
    async brain(workspace) {
      const { data, error } = await db.from("company_brain").select(
        "workspace_id,profile,onboarding_completed,updated_at",
      ).eq("workspace_id", workspace).maybeSingle();
      if (error) throw new PilotRefusal("pilot_store_unavailable", 503);
      return data;
    },
    async records(workspace, kind, ids) {
      const { data, error } = await db.from(RESOURCES[kind]).select("*").eq(
        "workspace_id",
        workspace,
      ).in("id", [...ids]);
      if (error) throw new PilotRefusal("pilot_store_unavailable", 503);
      return (data ?? []) as Row[];
    },
    async bind(task, payload) {
      // Compare the complete old payload; never overwrite a concurrent update or
      // another binding. No status/result/continuation/qualification field changes.
      let q = db.from("tasks").update({ payload }).eq("id", String(task.id)).eq(
        "workspace_id",
        String(task.workspace_id),
      );
      q = q.eq("user_id", String(task.user_id));
      q = task.payload == null
        ? q.is("payload", null)
        : q.eq("payload", JSON.stringify(task.payload));
      const { data, error } = await q.select("*").maybeSingle();
      if (error) throw new PilotRefusal("pilot_store_unavailable", 503);
      return data as Row | null;
    },
  };
}
