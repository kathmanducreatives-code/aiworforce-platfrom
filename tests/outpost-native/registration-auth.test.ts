// Actual handler + original P1 verifier + actual GoTrue + native transaction.
// No external responses mocked. Gateway URL routing is the only replacement.
// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  closeHarness,
  REST_URL,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
import { auth, authUrl, login, password } from "./lib/auth.ts";
import { invoke, registrationDeps } from "./lib/taskRegistration.ts";
import { jwt, opts } from "./fixture.ts";
async function setup() {
  const { x, session } = await login();
  let authCalls = 0;
  const deps = await registrationDeps(x, (input, init) => {
    authCalls++;
    const u = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    assert(
      u.startsWith(REST_URL + "/auth/v1/"),
      "registration must never call a model/provider/send",
    );
    return fetch(u.replace(REST_URL + "/auth/v1", authUrl), init);
  });
  const t = await x.makeTask(x.enrollments[0], x.ua, x.sa);
  const call = (id = t, action = "register", token = session.access_token) =>
    invoke(deps, token, action, x.a, x.ca, id);
  return { x, session, deps, t, call, authCalls: () => authCalls };
}
Deno.test({
  ...opts,
  name:
    "GoTrue registration: original sign-in registers once; cancellation is terminal and replay safe",
  fn: async () => {
    const f = await setup();
    for (
      const [action, result] of [
        ["register", "registered"],
        ["register", "replayed"],
        ["cancel", "cancelled"],
        ["cancel", "replayed"],
      ]
    ) {
      const r = await f.call(f.t, action);
      assertEquals(r.status, 200);
      assertEquals((await r.json()).result, result);
    }
    const binding =
      await sql`select actor_id,session_id from outpost_private.task_bindings where task_id=${f.t}`;
    assertEquals(binding.length, 1);
    assertEquals(binding[0], { actor_id: f.x.ua, session_id: f.x.sa });
    assertEquals(
      (await sql`select status from public.tasks where id=${f.t}`)[0].status,
      "cancelled",
    );
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue registration: second sign-in cannot capture pending task; same-session refresh can",
  fn: async () => {
    const f = await setup();
    const signin = await auth("/token?grant_type=password", {
      email: f.session.user.email,
      password,
    });
    assertEquals(signin.status, 200);
    const next = JSON.parse(signin.body);
    let r = await f.call(f.t, "register", next.access_token);
    assertEquals(r.status, 403);
    await r.text();
    r = await f.call(f.x.ta, "register", next.access_token);
    assertEquals(r.status, 403);
    await r.text();
    const refresh = await auth("/token?grant_type=refresh_token", {
      refresh_token: f.session.refresh_token,
    });
    assertEquals(refresh.status, 200);
    r = await f.call(f.t, "register", JSON.parse(refresh.body).access_token);
    assertEquals(r.status, 200);
    await r.text();
    assertEquals(
      (await sql`select session_id from outpost_private.task_bindings where task_id=${f.t}`)[
        0
      ].session_id,
      f.x.sa,
    );
  },
});
Deno.test({
  ...opts,
  name: "GoTrue registration: logout denies before opening a transaction",
  fn: async () => {
    const f = await setup();
    let started = 0;
    f.deps.transaction = () => {
      started++;
      throw new Error("must not open");
    };
    assertEquals(
      (await auth("/logout?scope=global", undefined, f.session.access_token))
        .status,
      204,
    );
    const r = await f.call();
    assertEquals(r.status, 401);
    await r.text();
    assertEquals(started, 0);
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${f.t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue registration: forged nonexistent session fails even when JWT signature is valid",
  fn: async () => {
    const f = await setup(), forged = await jwt(f.x.ua, uuid());
    const r = await f.call(f.t, "register", forged.token);
    assert([401, 403].includes(r.status));
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${f.t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "GoTrue registration: service credential cannot register or cancel",
  fn: async () => {
    const f = await setup();
    for (const action of ["register", "cancel"]) {
      const r = await f.call(f.t, action, f.x.service);
      assertEquals(r.status, 401);
      await r.text();
    }
    assertEquals(f.authCalls(), 0);
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue registration: current session with revoked workspace role is refused natively",
  fn: async () => {
    const f = await setup();
    await sql`delete from public.workspace_members where workspace_id=${f.x.a} and user_id=${f.x.ua}`;
    const r = await f.call();
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${f.t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue preparation: actual Auth session stamps and signs an existing unsigned task atomically",
  fn: async () => {
    const f = await setup(), t = uuid();
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${t},${f.x.a},${f.x.ua},'ready','{"execution_mode":"pilot_draft_only","approved_input":"synthetic"}')`;
    const r = await invoke(
      f.deps,
      f.session.access_token,
      "prepare",
      f.x.a,
      f.x.ca,
      t,
      { resources: [] },
    );
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "registered");
    assertEquals(
      (await sql`select session_id from outpost_private.task_bindings where task_id=${t}`)[
        0
      ].session_id,
      f.x.sa,
    );
    assertEquals(
      (await sql`select payload->>'pilot_origin_session_id' as origin from public.tasks where id=${t}`)[
        0
      ].origin,
      f.x.sa,
    );
    const replay = await invoke(
      f.deps,
      f.session.access_token,
      "register",
      f.x.a,
      f.x.ca,
      t,
    );
    assertEquals(replay.status, 200);
    assertEquals((await replay.json()).result, "replayed");
  },
});
Deno.test({
  ...opts,
  name: "GoTrue registration: close actual Auth SQL pool",
  fn: closeHarness,
});
