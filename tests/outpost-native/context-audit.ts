// Actual pilotContext + real GoTrue + native P1 store. URL routing only replaces
// the absent local Supabase gateway; it does not fabricate provider/DB/Auth results.
// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  closeHarness,
  mintJwt,
  REST_URL,
  sql,
} from "../db-contract/lib/harness.ts";
import { handlePilotContext } from "../../supabase/functions/_shared/pilot/pilotContext.ts";
import { signing } from "./fixture.ts";
import { auth, authUrl, login, password } from "./lib/auth.ts";
try {
  const { x, session } = await login();
  const anon = await mintJwt("anon");
  const config: Record<string, string> = {
    SUPABASE_URL: REST_URL,
    SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: x.service,
    OUTPOST_PILOT_SCOPE_ENABLED: "true",
    OUTPOST_PILOT_CONTEXT_ENABLED: "true",
    OUTPOST_PILOT_SCOPE_SIGNING_KEY: signing,
    OUTPOST_PILOT_SCOPE_POLICY: JSON.stringify({
      version: 1,
      workspaces: x.enrollments,
    }),
  };
  const deps = {
    env: (k: string) => config[k],
    store: () => x.store,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      const prefix = REST_URL + "/auth/v1";
      if (u.startsWith(REST_URL + "/rest/v1/rpc/outpost_pilot_access")) {
        return fetch(u.replace(REST_URL + "/rest/v1", REST_URL), init);
      }
      if (!u.startsWith(prefix)) {
        throw new Error("context audit forbids non-Auth HTTP");
      }
      return fetch(authUrl + u.slice(prefix.length), init);
    }) as typeof fetch,
  };
  const invoke = async (token: string, action: string, w = x.a, c = x.ca) => {
    const response = await handlePilotContext(
      new Request("http://127.0.0.1/pilot-context", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          workspace_id: w,
          client_binding_id: c,
          resources: [],
          ...(action === "resume_task" ? { task_id: x.ta } : {}),
        }),
      }),
      deps,
    );
    await response.text();
    return response.status;
  };
  const original = await invoke(session.access_token, "resume_task");
  assertEquals(
    original,
    200,
    "actual original actor and signed native task positive control",
  );
  const serviceOriginal = await invoke(x.service, "resume_task");
  assertEquals(
    serviceOriginal,
    200,
    "service retains validated original task authority",
  );
  const refresh = await auth("/token?grant_type=refresh_token", {
    refresh_token: session.refresh_token,
  });
  assertEquals(refresh.status, 200);
  const refreshed = JSON.parse(refresh.body);
  const refreshedResume = await invoke(refreshed.access_token, "resume_task");
  assertEquals(refreshedResume, 200, "same-session refresh remains valid");
  await sql`update public.workspace_members set role='viewer' where workspace_id=${x.a} and user_id=${x.ua}`;
  const demoted = await invoke(refreshed.access_token, "resume_task");
  const serviceDemoted = await invoke(x.service, "resume_task");
  assertEquals(demoted, 403);
  assertEquals(serviceDemoted, 403);
  await sql`update public.workspace_members set role='owner' where workspace_id=${x.a} and user_id=${x.ua}`;
  const foreign = await invoke(session.access_token, "read_context", x.b, x.cb);
  assertEquals(foreign, 403, "native foreign workspace must be denied");
  const signin = await auth("/token?grant_type=password", {
    email: session.user.email,
    password,
  });
  assertEquals(signin.status, 200);
  const replacement = JSON.parse(signin.body);
  const differentSession = await invoke(
    replacement.access_token,
    "resume_task",
  );
  const signout = await auth(
    "/logout?scope=global",
    undefined,
    session.access_token,
  );
  assertEquals(signout.status, 204);
  const revoked = await invoke(session.access_token, "resume_task");
  const serviceRevoked = await invoke(x.service, "resume_task");
  assertEquals(serviceRevoked, 403);
  const secure = differentSession === 403 && [401, 403].includes(revoked);
  console.log(
    JSON.stringify(
      {
        version: "phase1_context_session_audit_v1",
        actual_handler: "handlePilotContext",
        auth: "actual GoTrue v2.197.0",
        native_store: true,
        original_resume: original,
        same_session_refresh_resume: refreshedResume,
        service_original_resume: serviceOriginal,
        demoted_actor_resume: demoted,
        service_demoted_actor_resume: serviceDemoted,
        service_revoked_session_resume: serviceRevoked,
        foreign_workspace: foreign,
        new_session_same_actor_resume: differentSession,
        revoked_original_session_resume: revoked,
        verdict: secure ? "PASS" : "FAIL",
        customer_pilot_ready: false,
      },
      null,
      2,
    ),
  );
  if (!secure) Deno.exitCode = 1;
} finally {
  await closeHarness();
}
