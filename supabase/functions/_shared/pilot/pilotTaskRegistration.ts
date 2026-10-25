// Disabled security foundation, not an execution/import/persistence endpoint.
// No default database connection and no Deno.serve wiring. Native caller roles
// have no registration/cancellation RPC grant. Reuses the original P1 verifier.
import { type AuthDeps, authenticateUser } from "../requestAuth.ts";
import { bodyOf, CORS, json } from "./pilotHttp.ts";
import {
  loadPilotEnrollment,
  PilotRefusal,
  pilotSigningKey,
  validId,
} from "./pilotPolicy.ts";
import { PilotAccess, resourceRefs } from "./pilotScope.ts";
import type { PilotScopeStore, Row } from "./pilotScopeStore.ts";
export interface NativeTaskScope {
  workspace_id: string;
  client_binding_id: string;
  version: number;
  task_id: string;
}
export interface NativeTaskTransaction {
  store: PilotScopeStore;
  lock(scope: NativeTaskScope): Promise<Row>;
  register(scope: NativeTaskScope, expected: Row): Promise<string>;
  cancel(scope: NativeTaskScope, expected: Row): Promise<string>;
}
export interface PilotRegistrationDeps extends AuthDeps {
  transaction<T>(
    claims: Row,
    scope: NativeTaskScope,
    fn: (tx: NativeTaskTransaction) => Promise<T>,
  ): Promise<T>;
}
// Decode ONLY AFTER Auth verified the bearer. These claims supply the original
// session to the native guard, never an alternative JWT verifier or editable ACL.
function verifiedClaims(token: string, user: string): Row {
  try {
    if (token.length > 16384 || token.split(".").length !== 3) {
      throw new Error();
    }
    const segment = token.split(".")[1].replaceAll("-", "+").replaceAll(
      "_",
      "/",
    );
    const c = JSON.parse(atob(segment));
    if (
      !validId(c.sub) || c.sub !== user || c.role !== "authenticated" ||
      !validId(c.session_id) ||
      !Number.isSafeInteger(c.exp) || c.exp <= Date.now() / 1000 ||
      (c.is_anonymous !== undefined && c.is_anonymous !== false)
    ) throw new Error();
    return c;
  } catch {
    throw new PilotRefusal("original_session_required", 401);
  }
}
export async function handlePilotTaskRegistration(
  req: Request,
  deps: PilotRegistrationDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    if (deps.env("OUTPOST_PILOT_REGISTRATION_ENABLED") !== "true") {
      throw new PilotRefusal("pilot_registration_disabled", 503);
    }
    const checkpoint = () => {
      if (req.signal.aborted) {
        throw new PilotRefusal("pilot_task_request_cancelled", 409);
      }
    };
    checkpoint();
    const auth = await authenticateUser(req, deps);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    checkpoint();
    const claims = verifiedClaims(auth.token, auth.userId);
    const body = await bodyOf(req);
    if (
      typeof body.action !== "string" ||
      !["prepare", "register", "cancel"].includes(body.action) ||
      ![body.workspace_id, body.client_binding_id, body.task_id].every(validId)
    ) throw new PilotRefusal("invalid_request", 400);
    const fields = body.action === "prepare"
      ? "action,client_binding_id,resources,task_id,workspace_id"
      : "action,client_binding_id,task_id,workspace_id";
    if (Object.keys(body).sort().join(",") !== fields) {
      throw new PilotRefusal("invalid_request", 400);
    }
    const refs = body.action === "prepare" ? resourceRefs(body.resources) : [];
    const enrollment = loadPilotEnrollment(
      deps.env,
      String(body.workspace_id),
      String(body.client_binding_id),
    );
    const key = pilotSigningKey(deps.env);
    const scope: NativeTaskScope = {
      workspace_id: enrollment.workspace_id,
      client_binding_id: enrollment.client_binding_id,
      version: enrollment.version,
      task_id: String(body.task_id),
    };
    const result = await deps.transaction(claims, scope, async (tx) => {
      checkpoint();
      let expected = await tx.lock(scope);
      if (body.action === "prepare") {
        const access = await PilotAccess.forUser(
          tx.store,
          enrollment,
          auth.userId,
        );
        await access.bindTask(
          scope.task_id,
          refs,
          key,
          String(claims.session_id),
        );
        checkpoint();
        expected = await tx.lock(scope);
      }
      // Native locks protect this exact image through original P1 HMAC/resource/
      // Brain checks and the final write. No caller-supplied "verified" boolean.
      // MUTATION_P1_VERIFICATION_BEGIN
      await PilotAccess.forTask(
        tx.store,
        enrollment,
        scope.task_id,
        key,
        auth.userId,
      );
      // MUTATION_P1_VERIFICATION_END
      checkpoint();
      const outcome = body.action === "cancel"
        ? await tx.cancel(scope, expected)
        : await tx.register(scope, expected);
      checkpoint();
      return outcome;
    });
    return json({ ...scope, action: body.action, result, mode: "draft_only" });
  } catch (e) {
    if (e instanceof PilotRefusal) return json({ error: e.code }, e.status);
    if (e && typeof e === "object" && "code" in e && e.code === "42501") {
      return json({ error: "pilot_task_authorization_refused" }, 403);
    }
    // Conflicts/deadlocks/unavailable transactions fail; never retry implicitly.
    return json({ error: "pilot_task_transaction_refused" }, 503);
  }
}
