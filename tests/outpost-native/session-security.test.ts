// deno-lint-ignore-file no-import-prefix
// Actual disposable GoTrue HTTP sessions + real PostgREST/RLS. No minted user token.
// Other principals in fixture() remain synthetic controls; this owner's session is real.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { closeHarness, sql } from "../db-contract/lib/harness.ts";
import { api, opts } from "./fixture.ts";
import { auth, login, password } from "./lib/auth.ts";
Deno.test({
  ...opts,
  name:
    "GoTrue: actual issued JWT reads original native binding; logout invalidates stale JWT",
  fn: async () => {
    const { x, session } = await login();
    const before = await api(
      session.access_token,
      `task_bindings?task_id=eq.${x.ta}`,
    );
    assertEquals(before.status, 200, JSON.stringify(before.body));
    assertEquals(before.body.length, 1);
    const signout = await auth(
      "/logout?scope=global",
      undefined,
      session.access_token,
    );
    assertEquals(signout.status, 204);
    assertEquals(
      (await sql`select count(*)::int n from auth.sessions where id=${x.sa}`)[0]
        .n,
      0,
    );
    const after = await api(
      session.access_token,
      `task_bindings?task_id=eq.${x.ta}`,
    );
    assertEquals(after.status, 200);
    assertEquals(after.body, []);
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue: refresh keeps original session binding; demotion denies still-valid JWT",
  fn: async () => {
    const { x, session } = await login();
    const refresh = await auth("/token?grant_type=refresh_token", {
      refresh_token: session.refresh_token,
    });
    assertEquals(refresh.status, 200);
    const next = JSON.parse(refresh.body);
    assertEquals(
      (await api(next.access_token, `task_bindings?task_id=eq.${x.ta}`)).body
        .length,
      1,
    );
    await sql`update public.workspace_members set role='viewer' where workspace_id=${x.a} and user_id=${x.ua}`;
    assertEquals(
      (await api(next.access_token, `task_bindings?task_id=eq.${x.ta}`)).body,
      [],
    );
    assertEquals(
      (await api(session.access_token, `task_bindings?task_id=eq.${x.ta}`))
        .body,
      [],
    );
  },
});
Deno.test({
  ...opts,
  name: "GoTrue: new sign-in cannot resume another original session's task",
  fn: async () => {
    const { x, session } = await login();
    const signin = await auth("/token?grant_type=password", {
      email: session.user.email,
      password,
    });
    assertEquals(signin.status, 200);
    const other = JSON.parse(signin.body);
    assertEquals(
      (await api(session.access_token, `task_bindings?task_id=eq.${x.ta}`)).body
        .length,
      1,
    );
    assertEquals(
      (await api(other.access_token, `task_bindings?task_id=eq.${x.ta}`)).body,
      [],
    );
  },
});
Deno.test({
  ...opts,
  name:
    "GoTrue: session timeout denies native reads without waiting for JWT expiry",
  fn: async () => {
    const { x, session } = await login();
    assertEquals(
      (await api(session.access_token, `task_bindings?task_id=eq.${x.ta}`)).body
        .length,
      1,
    );
    await sql`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${x.sa}`;
    assertEquals(
      (await api(session.access_token, `task_bindings?task_id=eq.${x.ta}`))
        .body,
      [],
    );
  },
});
Deno.test({
  ...opts,
  name: "close actual Auth native harness",
  fn: closeHarness,
});
