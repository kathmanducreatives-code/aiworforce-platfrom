import { guardPilotStore } from "./pilotNativeAccess.ts";
// P2 preparation only. Every read/binding goes through P1; no business executor.
import {
  type AuthDeps,
  authenticateUser,
  bearerOf,
  defaultAuthDeps,
} from "../requestAuth.ts";
import {
  loadPilotEnrollment,
  loadPilotEnrollments,
  PilotRefusal,
  pilotSigningKey,
  validId,
} from "./pilotPolicy.ts";
import { digest, PilotAccess, resourceRefs } from "./pilotScope.ts";
import {
  createPilotScopeStore,
  type PilotScopeStore,
} from "./pilotScopeStore.ts";
import { bodyOf, CORS, json } from "./pilotHttp.ts";

export interface PilotContextDeps extends AuthDeps {
  store?: () => PilotScopeStore;
}
export async function handlePilotContext(
  req: Request,
  deps: PilotContextDeps = defaultAuthDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    if (deps.env("OUTPOST_PILOT_CONTEXT_ENABLED") !== "true") {
      throw new PilotRefusal("pilot_context_disabled", 503);
    }
    const token = bearerOf(req),
      service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
    const isService = !!service && service !== deps.env("SUPABASE_ANON_KEY") &&
      token === service;
    let user: string | null = null;
    if (!isService) {
      const auth = await authenticateUser(req, deps);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      user = auth.userId;
    }
    const body = await bodyOf(req);
    const action = body.action;
    const fields: Record<string, string[]> = {
      list_workspaces: [],
      read_context: ["workspace_id", "client_binding_id", "resources"],
      prepare_task: [
        "workspace_id",
        "client_binding_id",
        "resources",
        "task_id",
      ],
      resume_task: [
        "workspace_id",
        "client_binding_id",
        "resources",
        "task_id",
      ],
    };
    if (
      typeof action !== "string" || !Object.hasOwn(fields, action) ||
      Object.keys(body).some((k) => !["action", ...fields[action]].includes(k))
    ) {
      throw new PilotRefusal("invalid_request", 400);
    }
    if (isService && action !== "resume_task") {
      throw new PilotRefusal("bound_task_required", 403);
    }
    const key = pilotSigningKey(deps.env);
    const baseStore = deps.store?.() ?? createPilotScopeStore(deps);
    if (action === "list_workspaces") {
      const choices = [];
      for (const enrollment of loadPilotEnrollments(deps.env)) {
        try {
          const store = guardPilotStore(
            baseStore,
            deps,
            token,
            enrollment,
            null,
          );
          const access = await PilotAccess.forUser(store, enrollment, user!);
          // Only disclose minimal choices after current membership and Brain checks.
          choices.push({
            ...access.summary(),
            label: enrollment.seller_domain,
          });
        } catch (e) {
          if (!(e instanceof PilotRefusal) || ![403, 409].includes(e.status)) {
            throw e;
          }
        }
      }
      return json({ choices });
    }
    if (!validId(body.workspace_id) || !validId(body.client_binding_id)) {
      throw new PilotRefusal("explicit_client_scope_required", 400);
    }
    const enrollment = loadPilotEnrollment(
      deps.env,
      body.workspace_id,
      body.client_binding_id,
    );
    const store = guardPilotStore(
      baseStore,
      deps,
      token,
      enrollment,
      typeof body.task_id === "string" ? body.task_id : null,
    );
    const refs = resourceRefs(body.resources);
    if (action !== "read_context" && !validId(body.task_id)) {
      throw new PilotRefusal("invalid_task_id", 400);
    }
    let access: PilotAccess;
    if (action === "read_context") {
      access = await PilotAccess.forUser(store, enrollment, user!);
    } else {
      if (action === "prepare_task") {
        access = await PilotAccess.forUser(store, enrollment, user!);
        await access.bindTask(body.task_id as string, refs, key);
      }
      // Both initial preparation and every retry/resume use the persisted P1 binding.
      access = await PilotAccess.forTask(
        store,
        enrollment,
        body.task_id as string,
        key,
        user,
      );
    }
    const brain = await access.brain();
    const records = await access.records(refs);
    await access.recheck();
    const context = {
      scope: access.summary(),
      brain,
      records,
      task_id: body.task_id ?? null,
    };
    const serialized = JSON.stringify(context);
    // Fail rather than silently truncate client instructions or selected memory.
    if (new TextEncoder().encode(serialized).length > 65536) {
      throw new PilotRefusal("pilot_context_too_large", 413);
    }
    // A content fingerprint, NOT an authorization token or frozen generation snapshot.
    return json({
      ...context,
      context_key: await digest(JSON.parse(serialized)),
      capabilities: {
        draft_only: true,
        execution: false,
        imports: false,
        models: false,
        export: false,
        dispatch: false,
      },
    });
  } catch (e) {
    return e instanceof PilotRefusal
      ? json({ error: e.code }, e.status)
      : json({ error: "pilot_context_unavailable" }, 503);
  }
}
