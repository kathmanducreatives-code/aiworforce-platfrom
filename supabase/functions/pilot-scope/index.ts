import { guardPilotStore } from "../_shared/pilot/pilotNativeAccess.ts";
import { bodyOf, CORS, json } from "../_shared/pilot/pilotHttp.ts";
// P1 authorization front door only. No import/research/model/export executor.
import { withBuildStamp } from "../_shared/buildStamp.ts";
import {
  type AuthDeps,
  authenticateUser,
  bearerOf,
  defaultAuthDeps,
} from "../_shared/requestAuth.ts";
import {
  loadPilotEnrollment,
  PilotRefusal,
  pilotSigningKey,
  validId,
} from "../_shared/pilot/pilotPolicy.ts";
import { PilotAccess, resourceRefs } from "../_shared/pilot/pilotScope.ts";
import {
  createPilotScopeStore,
  type PilotScopeStore,
} from "../_shared/pilot/pilotScopeStore.ts";
export interface PilotScopeDeps extends AuthDeps {
  store?: () => PilotScopeStore;
}
export async function handlePilotScope(
  req: Request,
  deps: PilotScopeDeps = defaultAuthDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const token = bearerOf(req),
      service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    const isService = !!service && service !== deps.env("SUPABASE_ANON_KEY") &&
      token === service;
    let userId: string | null = null;
    if (!isService) {
      const auth = await authenticateUser(req, deps);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      userId = auth.userId;
    }
    const body = await bodyOf(req);
    const actions: Readonly<Record<string, readonly string[]>> = {
      inspect: [],
      read_brain: [],
      read_records: ["resources"],
      bind_task: ["task_id", "resources"],
      resume_task: ["task_id", "resources"],
    };
    if (
      typeof body.action !== "string" || !Object.hasOwn(actions, body.action)
    ) throw new PilotRefusal("invalid_action", 400);
    const action = body.action;
    if (
      Object.keys(body).some((k) =>
        !["action", "workspace_id", "client_binding_id", ...actions[action]]
          .includes(k)
      )
    ) throw new PilotRefusal("invalid_request", 400);
    if (!validId(body.workspace_id) || !validId(body.client_binding_id)) {
      throw new PilotRefusal("explicit_client_scope_required", 400);
    }
    if (isService && action !== "resume_task") {
      throw new PilotRefusal("bound_task_required", 403);
    }
    const enrollment = loadPilotEnrollment(
      deps.env,
      body.workspace_id,
      body.client_binding_id,
    );
    const key = pilotSigningKey(deps.env);
    const store = guardPilotStore(
      deps.store?.() ?? createPilotScopeStore(deps),
      deps,
      token,
      enrollment,
      typeof body.task_id === "string" ? body.task_id : null,
    );
    const refs = body.resources === undefined
      ? []
      : resourceRefs(body.resources);
    if (
      ["read_records", "bind_task"].includes(action) &&
      body.resources === undefined
    ) throw new PilotRefusal("invalid_resource_set", 400);
    if (
      ["bind_task", "resume_task"].includes(action) && !validId(body.task_id)
    ) throw new PilotRefusal("invalid_task_id", 400);
    if (action === "read_records" && refs.length === 0) {
      throw new PilotRefusal("invalid_resource_set", 400);
    }
    const access = action === "resume_task"
      ? await PilotAccess.forTask(
        store,
        enrollment,
        body.task_id as string,
        key,
        userId,
      )
      : await PilotAccess.forUser(store, enrollment, userId!);
    if (action === "inspect") {
      return json({
        scope: access.summary(),
        capabilities: {
          draft_only: true,
          imports: false,
          research: false,
          models: false,
          export: false,
          dispatch: false,
        },
      });
    }
    if (action === "read_brain") {
      return json({ scope: access.summary(), brain: await access.brain() });
    }
    if (action === "bind_task") {
      await access.bindTask(body.task_id as string, refs, key);
      return json({
        scope: access.summary(),
        task_id: body.task_id,
        bound: true,
      });
    }
    const records = await access.records(
      action === "resume_task"
        ? [
          { kind: "task", id: body.task_id as string },
          ...refs.filter((r) => r.kind !== "task" || r.id !== body.task_id),
        ]
        : refs,
    );
    return json({ scope: access.summary(), records });
  } catch (e) {
    // Never echo DB/provider errors, policies, bodies, MACs or secret references.
    if (e instanceof PilotRefusal) return json({ error: e.code }, e.status);
    return json({ error: "pilot_scope_unavailable" }, 503);
  }
}
if (!Deno.env.get("PILOT_SCOPE_IMPORT_ONLY")) {
  Deno.serve(withBuildStamp((req) => handlePilotScope(req)));
}
