// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { api, fixture, jwt, opts } from "./fixture.ts";
import {
  closeHarness,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";

const publicApi = (
  token: string | null,
  path: string,
  method = "GET",
  body?: unknown,
) => api(token, path, method, body, "public");
const rows = async (token: string | null, path: string) => {
  const r = await publicApi(token, path);
  return r.status === 200 && Array.isArray(r.body) ? r.body.length : 0;
};
async function attest(
  x: Awaited<ReturnType<typeof fixture>>,
  token: string | null,
  overrides = {},
) {
  return await publicApi(token, "rpc/outpost_pilot_access", "POST", {
    p_workspace: x.a,
    p_client: x.ca,
    p_version: 1,
    p_task: x.ta,
    ...overrides,
  });
}
for (
  const role of ["owner", "admin", "editor", "viewer", "revoked", "foreign"]
) {
  Deno.test({
    ...opts,
    name:
      `native API: ${role} task and Brain reads use original authorized principal`,
    fn: async () => {
      const x = await fixture();
      if (
        role === "revoked"
      ) {
        await sql`delete from public.workspace_members where workspace_id=${x.a} and user_id=${x.ua}`;
      } else if (
        role !== "foreign"
      ) {
        await sql`update public.workspace_members set role=${role} where workspace_id=${x.a} and user_id=${x.ua}`;
      }
      const token = (await jwt(
        role === "foreign" ? x.ub : x.ua,
        role === "foreign" ? x.sb : x.sa,
      )).token;
      const allowed = ["owner", "admin"].includes(role);
      assertEquals(
        await rows(token, `tasks?id=eq.${x.ta}&select=id`),
        allowed ? 1 : 0,
      );
      assertEquals(
        await rows(
          token,
          `company_brain?workspace_id=eq.${x.a}&select=workspace_id`,
        ),
        allowed ? 1 : 0,
      );
      assertEquals((await attest(x, token)).body, allowed);
    },
  });
}
for (const role of ["owner", "admin", "editor", "viewer", "foreign"]) {
  Deno.test({
    ...opts,
    name: `native API: ${role} cannot PATCH or DELETE a frozen pilot task`,
    fn: async () => {
      const x = await fixture();
      await sql`update public.workspace_members set role=${
        role === "foreign" ? "owner" : role
      } where workspace_id=${x.a} and user_id=${x.ua}`;
      const token = (await jwt(
        role === "foreign" ? x.ub : x.ua,
        role === "foreign" ? x.sb : x.sa,
      )).token;
      const before =
        (await sql`select to_jsonb(t) as row from public.tasks t where id=${x.ta}`)[
          0
        ].row;
      // Strip pilot markers, replace the payload, change status, or remove the row.
      for (
        const body of [{ payload: {} }, {
          payload: { execution_mode: "ordinary" },
        }, { status: "cancelled" }]
      ) {
        await publicApi(token, `tasks?id=eq.${x.ta}`, "PATCH", body);
        assertEquals(
          (await sql`select to_jsonb(t) as row from public.tasks t where id=${x.ta}`)[
            0
          ].row,
          before,
        );
      }
      await publicApi(token, `tasks?id=eq.${x.ta}`, "DELETE");
      assertEquals(
        (await sql`select to_jsonb(t) as row from public.tasks t where id=${x.ta}`)[
          0
        ].row,
        before,
      );
    },
  });
}
Deno.test({
  ...opts,
  name:
    "native API: unregistered pilot INSERT and ordinary-to-pilot PATCH are refused",
  fn: async () => {
    const x = await fixture(), token = (await jwt(x.ua, x.sa)).token;
    for (
      const payload of [{ execution_mode: "pilot_draft_only" }, {
        pilot_scope: { workspace_id: x.a },
      }]
    ) {
      const id = uuid();
      const r = await publicApi(token, "tasks", "POST", {
        id,
        workspace_id: x.a,
        user_id: x.ua,
        status: "ready",
        payload,
      });
      assertEquals(r.status, 403);
      assertEquals(
        (await sql`select id from public.tasks where id=${id}`).length,
        0,
      );
    }
    const id = uuid();
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${id},${x.a},${x.ua},'ready','{}')`;
    const r = await publicApi(token, `tasks?id=eq.${id}`, "PATCH", {
      payload: { pilot_scope: {} },
    });
    assertEquals(r.status, 403);
    assertEquals(
      (await sql`select payload from public.tasks where id=${id}`)[0].payload,
      {},
    );
  },
});
for (const kind of ["owner", "viewer", "service"]) {
  Deno.test({
    ...opts,
    name: `native API: ${kind} raw enrolled Brain writes are frozen`,
    fn: async () => {
      const x = await fixture();
      const token = kind === "service" ? x.service : (await jwt(
        kind === "viewer" ? x.viewer : x.ua,
        kind === "viewer" ? x.sv : x.sa,
      )).token;
      const before =
        (await sql`select profile from public.company_brain where workspace_id=${x.a}`)[
          0
        ].profile;
      await publicApi(token, `company_brain?workspace_id=eq.${x.a}`, "PATCH", {
        profile: { injected: true },
      });
      await publicApi(token, `company_brain?workspace_id=eq.${x.a}`, "DELETE");
      assertEquals(
        (await sql`select profile from public.company_brain where workspace_id=${x.a}`)[
          0
        ].profile,
        before,
      );
      const r = await publicApi(token, "company_brain", "POST", {
        workspace_id: x.a,
        profile: { injected: true },
      });
      assert([403, 409].includes(r.status));
    },
  });
}
Deno.test({
  ...opts,
  name:
    "native API: nonpilot task writes and approved Brain paths remain legitimate",
  fn: async () => {
    const x = await fixture(), w = await seedWorkspace(), id = uuid();
    await sql`insert into public.workspace_members(workspace_id,user_id,role) values (${w},${x.ua},'owner')`;
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${id},${w},${x.ua},'ready','{}')`;
    await sql`insert into public.company_brain(workspace_id,profile) values (${w},'{}')`;
    for (
      const [actor, token] of [["owner", (await jwt(x.ua, x.sa)).token], [
        "service",
        x.service,
      ]]
    ) {
      assertEquals(
        (await publicApi(token, `tasks?id=eq.${id}`, "PATCH", {
          payload: { legitimate: actor },
        })).status,
        204,
      );
      assertEquals(
        (await sql`select payload from public.tasks where id=${id}`)[0].payload,
        { legitimate: actor },
        "HTTP 204 alone cannot prove the task write landed",
      );
      assertEquals(
        (await publicApi(token, `company_brain?workspace_id=eq.${w}`, "PATCH", {
          profile: { legitimate: actor },
        })).status,
        Deno.env.get("OUTPOST_NATIVE_BRAIN_SQL") && actor === "owner"
          ? 403
          : 204,
      );
      assertEquals(
        (await sql`select profile from public.company_brain where workspace_id=${w}`)[
          0
        ].profile,
        Deno.env.get("OUTPOST_NATIVE_BRAIN_SQL") && actor === "owner"
          ? {}
          : { legitimate: actor },
      );
    }
  },
});
Deno.test({
  ...opts,
  name:
    "native API: service attestation retains original session, client, version and actor role",
  fn: async () => {
    const x = await fixture();
    assertEquals((await attest(x, x.service)).body, true);
    for (
      const override of [
        { p_client: x.cb },
        { p_workspace: x.b },
        { p_version: 2 },
        { p_task: null },
        { p_task: uuid() },
      ]
    ) {
      assertEquals((await attest(x, x.service, override)).body, false);
    }
    assertEquals((await attest(x, null)).status, 401);
    await sql`delete from auth.sessions where id=${x.sa}`;
    assertEquals((await attest(x, x.service)).body, false);
  },
});
Deno.test({
  ...opts,
  name:
    "native API: forged self-join cannot inherit pilot task or Brain authority",
  fn: async () => {
    const x = await fixture(), token = (await jwt(x.viewer, x.sv)).token;
    // Existing shared membership defect is intentionally NOT repaired here.
    const join = await publicApi(token, "workspace_members", "POST", {
      workspace_id: x.b,
      user_id: x.viewer,
      role: "owner",
    });
    assertEquals(
      join.status,
      Deno.env.get("OUTPOST_NATIVE_MEMBERSHIP_SQL") ? 403 : 201,
      "baseline reproduces shared defect; pinned owner dependency must close it",
    );
    assertEquals(
      (await sql`select user_id from public.workspace_members where workspace_id=${x.b} and user_id=${x.viewer}`)
        .length,
      Deno.env.get("OUTPOST_NATIVE_MEMBERSHIP_SQL") ? 0 : 1,
    );
    assertEquals(await rows(token, `tasks?id=eq.${x.tb}&select=id`), 0);
    assertEquals(
      await rows(
        token,
        `company_brain?workspace_id=eq.${x.b}&select=workspace_id`,
      ),
      0,
    );
    assertEquals(
      (await attest(x, token, {
        p_workspace: x.b,
        p_client: x.cb,
        p_task: x.tb,
      })).body,
      false,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "native API: Brain relocation cannot cross an enrolled boundary, even through service",
  fn: async () => {
    const x = await fixture(), w = await seedWorkspace();
    await sql`insert into public.company_brain(workspace_id,profile) values (${w},'{}')`;
    for (const [from, to] of [[w, x.a], [x.a, w]]) {
      assertEquals(
        (await publicApi(
          x.service,
          `company_brain?workspace_id=eq.${from}`,
          "PATCH",
          { workspace_id: to },
        )).status,
        403,
      );
      assertEquals(
        (await sql`select workspace_id from public.company_brain where workspace_id=${from}`)
          .length,
        1,
      );
    }
  },
});
Deno.test({
  ...opts,
  ignore: !Deno.env.get("OUTPOST_NATIVE_MEMBERSHIP_SQL"),
  name:
    "native integrated: owner hotfix preserves provisioning and closes membership/quota mutation",
  fn: async () => {
    const u = uuid(), sid = uuid();
    await sql`insert into auth.users(id) values (${u})`;
    await sql`insert into auth.sessions(id,user_id) values (${sid},${u})`;
    const token = (await jwt(u, sid)).token;
    const provision = await publicApi(
      token,
      "rpc/provision_workspace_for_user",
      "POST",
      { _user_id: u },
    );
    assertEquals(provision.status, 200);
    assertEquals(typeof provision.body, "string");
    const ws = provision.body;
    assertEquals(
      (await sql`select role from public.workspace_members where workspace_id=${ws} and user_id=${u}`)[
        0
      ].role,
      "owner",
    );
    assertEquals(await rows(token, `workspaces?id=eq.${ws}&select=id`), 1);
    assertEquals(
      (await publicApi(token, "rpc/provision_workspace_for_user", "POST", {
        _user_id: u,
      })).body,
      ws,
    );
    const before =
      (await sql`select to_jsonb(w) as row from public.workspaces w where id=${ws}`)[
        0
      ].row;
    for (const method of ["PATCH", "DELETE"]) {
      assertEquals(
        (await publicApi(
          token,
          `workspaces?id=eq.${ws}`,
          method,
          method === "PATCH" ? { daily_run_limit: 999999 } : undefined,
        )).status,
        403,
      );
    }
    assertEquals(
      (await sql`select to_jsonb(w) as row from public.workspaces w where id=${ws}`)[
        0
      ].row,
      before,
    );
    assertEquals(
      (await publicApi(
        token,
        `workspace_members?workspace_id=eq.${ws}`,
        "PATCH",
        { role: "admin" },
      )).status,
      403,
    );
    assertEquals(
      (await publicApi(
        token,
        `workspace_members?workspace_id=eq.${ws}`,
        "DELETE",
      )).status,
      403,
    );
    assertEquals(
      (await publicApi(null, "workspace_members", "POST", {
        workspace_id: ws,
        user_id: uuid(),
        role: "owner",
      })).status,
      401,
    );
    assertEquals(
      (await publicApi(token, `company_brain?workspace_id=eq.${ws}`, "PATCH", {
        profile: { legitimate: true },
      })).status,
      Deno.env.get("OUTPOST_NATIVE_BRAIN_SQL") ? 403 : 204,
    );
  },
});
Deno.test({
  ...opts,
  name: "native API: populated rollback preserves the access boundary",
  fn: async () => {
    const x = await fixture(), token = (await jwt(x.ua, x.sa)).token;
    const c = await sql.reserve();
    try {
      const down = await Deno.readTextFile(
        new URL(
          "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/native-access-rollback.sql",
          import.meta.url,
        ),
      );
      await assertRejects(() => c.unsafe(down), Error, "nonempty pilot");
    } finally {
      await c`rollback`;
      c.release();
    }
    assertEquals((await attest(x, token)).body, true);
    assertEquals(
      await rows(
        (await jwt(x.viewer, x.sv)).token,
        `tasks?id=eq.${x.ta}&select=id`,
      ),
      0,
    );
  },
});
Deno.test({ ...opts, name: "native API: close owned pool", fn: closeHarness });
