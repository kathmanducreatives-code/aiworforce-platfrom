// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  closeHarness,
  seedWorkspace,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
import { PilotAccess } from "../../supabase/functions/_shared/pilot/pilotScope.ts";
import { api, denied, fixture, jwt, opts, signing } from "./fixture.ts";

Deno.test({
  ...opts,
  ignore: Deno.env.get("OUTPOST_NATIVE_OMIT_OWNER_GUARD") === "1" ||
    Deno.env.get("OUTPOST_NATIVE_OMIT_TASK_READ_GUARD") === "1",
  name:
    "native: empty rollback removes only pilot objects and reapplies atomically",
  fn: async () => {
    const c = await sql.reserve();
    try {
      const down = await Deno.readTextFile(
        new URL(
          "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/native-security-rollback.sql",
          import.meta.url,
        ),
      );
      const accessDown = await Deno.readTextFile(
        new URL(
          "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/native-access-rollback.sql",
          import.meta.url,
        ),
      );
      await c.unsafe(accessDown);
      await c.unsafe(down);
      assertEquals(
        (await c`select to_regnamespace('outpost_private')::text n`)[0].n,
        null,
      );
      assertEquals(
        (await c`select count(*)::int n from pg_trigger where tgname='outpost_bound_task_owner'`)[
          0
        ].n,
        0,
      );
      assertEquals(
        (await c`select to_regclass('public.tasks')::text n`)[0].n,
        "tasks",
      );
      const up = await Deno.readTextFile(
        new URL(
          "../../supabase/migrations-held/20261022140824_outpost_native_identity_security.sql",
          import.meta.url,
        ),
      );
      await c.unsafe(`begin;\n${up}\ncommit;`);
      const accessUp = await Deno.readTextFile(
        new URL(
          "../../supabase/migrations-held/20261023061143_outpost_pilot_api_authorization.sql",
          import.meta.url,
        ),
      );
      await c.unsafe(`begin;\n${accessUp}\ncommit;`);
    } finally {
      await c`rollback`;
      c.release();
    }
  },
});

Deno.test({
  ...opts,
  name:
    "native: owner positive controls and foreign rows use actual PostgREST RLS",
  fn: async () => {
    const x = await fixture(), auth = await jwt(x.ua, x.sa);
    const clients = await api(auth.token, "clients"),
      tasks = await api(auth.token, "task_bindings");
    assertEquals(clients.status, 200);
    assertEquals(tasks.status, 200);
    assertEquals(
      clients.body.map((r: { workspace_id: string }) => r.workspace_id),
      [x.a],
    );
    assertEquals(tasks.body.map((r: { task_id: string }) => r.task_id), [x.ta]);
    assertEquals(
      (await api(auth.token, `task_bindings?workspace_id=eq.${x.b}`)).body,
      [],
    );
    assertEquals(
      (await api(auth.token, `task_bindings?task_id=eq.${x.tb}`)).body,
      [],
    );
  },
});
for (const kind of ["anon", "service", "viewer", "shared"]) {
  Deno.test({
    ...opts,
    name: `native: ${kind} cannot inherit original task authority`,
    fn: async () => {
      const x = await fixture();
      const token = kind === "anon"
        ? null
        : kind === "service"
        ? x.service
        : kind === "viewer"
        ? (await jwt(x.viewer, x.sv)).token
        : (await jwt(x.shared, x.ss)).token;
      const r = await api(token, "task_bindings");
      if (kind === "anon" || kind === "service") denied(r);
      else assertEquals(r.body, []);
      if (kind === "shared") {
        const c = await api(token, "clients");
        assertEquals(c.body.length, 2); // Can select either owned workspace, cannot use another actor's task.
      }
    },
  });
}
for (const method of ["POST", "PATCH", "DELETE"]) {
  Deno.test({
    ...opts,
    name: `native: ${method} direct API cannot register/change client or task`,
    fn: async () => {
      const x = await fixture(), auth = await jwt(x.ua, x.sa);
      for (const table of ["clients", "task_bindings"]) {
        denied(
          await api(
            auth.token,
            table,
            method,
            method === "DELETE" ? undefined : { workspace_id: x.a },
          ),
        );
      }
      assertEquals((await api(auth.token, "task_bindings")).body.length, 1);
    },
  });
}
for (
  const attack of [
    "missing-session",
    "other-user-session",
    "different-same-user-session",
    "missing-exp",
    "malformed-session",
    "expired-token",
    "anonymous",
    "metadata-role",
  ]
) {
  Deno.test({
    ...opts,
    name: `native: signed JWT ${attack} fails closed`,
    fn: async () => {
      const x = await fixture();
      let sid: string | null = x.sa,
        u = x.ua,
        extra: Record<string, unknown> = {};
      if (attack === "missing-session") sid = null;
      if (attack === "other-user-session") sid = x.sb;
      if (attack === "malformed-session") sid = "not-a-uuid";
      if (attack === "different-same-user-session") {
        sid = uuid();
        await sql`insert into auth.sessions(id,user_id) values (${sid},${x.ua})`;
      }
      if (attack === "missing-exp") extra = { exp: null };
      if (attack === "expired-token") extra = { exp: 1 };
      if (attack === "anonymous") extra = { is_anonymous: true };
      if (attack === "metadata-role") {
        u = x.viewer;
        sid = x.sv;
        extra = {
          user_metadata: { role: "owner", workspace_id: x.a },
          app_metadata: { role: "owner" },
        };
      }
      const auth = await jwt(u, sid, extra),
        r = await api(auth.token, "task_bindings");
      if (r.status === 200) assertEquals(r.body, []);
      else denied(r);
    },
  });
}
for (
  const change of [
    "delete-session",
    "session-deadline",
    "demote",
    "remove-member",
    "cancel",
    "change-model-payload",
  ]
) {
  Deno.test({
    ...opts,
    name: `native: existing valid JWT loses task access after ${change}`,
    fn: async () => {
      const x = await fixture(), auth = await jwt(x.ua, x.sa);
      assertEquals((await api(auth.token, "task_bindings")).body.length, 1);
      if (
        change === "delete-session"
      ) await sql`delete from auth.sessions where id=${x.sa}`;
      if (
        change === "session-deadline"
      ) {
        await sql`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${x.sa}`;
      }
      if (
        change === "demote"
      ) {
        await sql`update public.workspace_members set role='viewer' where workspace_id=${x.a} and user_id=${x.ua}`;
      }
      if (
        change === "remove-member"
      ) {
        await sql`delete from public.workspace_members where workspace_id=${x.a} and user_id=${x.ua}`;
      }
      if (
        change === "cancel"
      ) {
        await sql`update public.tasks set status='cancelled' where id=${x.ta}`;
      }
      if (
        change === "change-model-payload"
      ) {
        await sql`update public.tasks set payload=payload || '{"pilot_model":{"model":"unsupported"}}'::jsonb where id=${x.ta}`;
      }
      assertEquals((await api(auth.token, "task_bindings")).body, []);
    },
  });
}
Deno.test({
  ...opts,
  name:
    "native: task mutation and restoration cannot revive the original captured image",
  fn: async () => {
    const x = await fixture(), auth = await jwt(x.ua, x.sa);
    await assertRejects(() =>
      sql`update public.tasks set workspace_id=${x.b} where id=${x.ta}`
    );
    await assertRejects(() =>
      sql`update public.tasks set user_id=${x.ub} where id=${x.ta}`
    );
    assertEquals((await api(auth.token, "task_bindings")).body.length, 1);
  },
});
Deno.test({
  ...opts,
  name:
    "native: one client per workspace rejects concurrent alternate enrollments",
  fn: async () => {
    const w = await seedWorkspace();
    const r = await Promise.allSettled(
      [uuid(), uuid()].map((c) =>
        sql`insert into outpost_private.clients(workspace_id,client_binding_id,seller_domain,configuration_version) values (${w},${c},'synthetic.example',1)`
      ),
    );
    assertEquals(
      r.filter((v) => v.status === "fulfilled").length,
      1,
    );
    assertEquals(r.filter((v) => v.status === "rejected").length, 1);
  },
});
for (const attack of ["workspace", "client", "actor", "session", "unsigned"]) {
  Deno.test({
    ...opts,
    name: `native: private registration refuses wrong ${attack}`,
    fn: async () => {
      const x = await fixture(), t = await x.makeTask(x.enrollments[0], x.ua);
      if (
        attack === "unsigned"
      ) {
        await sql`update public.tasks set payload='{"execution_mode":"pilot_draft_only"}'::jsonb where id=${t}`;
      }
      await assertRejects(() =>
        x.register(
          attack === "workspace" ? x.b : x.a,
          attack === "client" ? x.cb : x.ca,
          t,
          attack === "actor" ? x.ub : x.ua,
          attack === "session" ? x.sb : x.sa,
        )
      );
    },
  });
}
Deno.test({
  ...opts,
  name:
    "native: P1 HMAC verifier remains required and rejects tampered signed payload",
  fn: async () => {
    const x = await fixture();
    await sql`update public.tasks set payload=jsonb_set(payload,'{pilot_scope,mac}',to_jsonb(repeat('0',64))) where id=${x.ta}`;
    await assertRejects(() =>
      PilotAccess.forTask(x.store, x.enrollments[0], x.ta, signing, x.ua)
    );
    assertEquals(
      (await api((await jwt(x.ua, x.sa)).token, "task_bindings")).body,
      [],
    );
  },
});
Deno.test({
  ...opts,
  name:
    "native: immutable identity blocks UPDATE DELETE and TRUNCATE even for fixture owner",
  fn: async () => {
    const x = await fixture();
    await assertRejects(() =>
      sql`update outpost_private.clients set client_binding_id=${uuid()} where workspace_id=${x.a}`
    );
    await assertRejects(() =>
      sql`delete from outpost_private.task_bindings where task_id=${x.ta}`
    );
    await assertRejects(() =>
      sql.unsafe("truncate outpost_private.task_bindings")
    );
    await assertRejects(() =>
      sql.unsafe("truncate outpost_private.clients cascade")
    );
  },
});
Deno.test({
  ...opts,
  name:
    "native: Read Committed transaction sees session deletion from another connection",
  fn: async () => {
    const x = await fixture(),
      auth = await jwt(x.ua, x.sa),
      first = await sql.reserve(),
      second = await sql.reserve();
    try {
      await first`begin`;
      await first`set local role authenticated`;
      await first`select set_config('request.jwt.claims', ${
        JSON.stringify(auth.claims)
      }, true)`;
      assertEquals(
        (await first`select count(*)::int n from outpost_private.task_bindings`)[
          0
        ].n,
        1,
      );
      await second`delete from auth.sessions where id=${x.sa}`;
      assertEquals(
        (await first`select count(*)::int n from outpost_private.task_bindings`)[
          0
        ].n,
        0,
      );
      await first`rollback`;
    } finally {
      await first`rollback`;
      first.release();
      second.release();
    }
  },
});
Deno.test({
  ...opts,
  name: "native: Repeatable Read snapshots cannot retain stale pilot authority",
  fn: async () => {
    const x = await fixture(),
      auth = await jwt(x.ua, x.sa),
      c = await sql.reserve();
    try {
      await c`begin isolation level repeatable read`;
      await c`set local role authenticated`;
      await c`select set_config('request.jwt.claims', ${
        JSON.stringify(auth.claims)
      }, true)`;
      assertEquals(
        (await c`select count(*)::int n from outpost_private.task_bindings`)[0]
          .n,
        0,
      );
    } finally {
      await c`rollback`;
      c.release();
    }
  },
});
Deno.test({
  ...opts,
  name: "native: parent capture locks serialize concurrent ownership mutation",
  fn: async () => {
    const x = await fixture(),
      t = await x.makeTask(x.enrollments[0], x.ua),
      a = await sql.reserve(),
      b = await sql.reserve();
    try {
      await a`begin`;
      await a`insert into outpost_private.task_bindings(workspace_id,client_binding_id,task_id,actor_id,session_id) values (${x.a},${x.ca},${t},${x.ua},${x.sa})`;
      await b`begin`;
      await b`set local lock_timeout='100ms'`;
      await assertRejects(() =>
        b`update public.tasks set workspace_id=${x.b} where id=${t}`
      );
      await b`rollback`;
      await a`commit`;
      await assertRejects(() =>
        b`update public.tasks set workspace_id=${x.b} where id=${t}`
      );
    } finally {
      await a`rollback`;
      await b`rollback`;
      a.release();
      b.release();
    }
  },
});
Deno.test({
  ...opts,
  name:
    "native: grants and policies do not authorize model/export/customer enablement",
  fn: async () => {
    const x = await fixture(), auth = await jwt(x.ua, x.sa);
    for (
      const rpc of [
        "register_task",
        "run_model",
        "approve_brief",
        "export_csv",
        "capture_task_parent",
      ]
    ) denied(await api(auth.token, `rpc/${rpc}`, "POST", {}));
    assertEquals(
      (await sql`select bool_and(customer_enabled=false) n from outpost_private.clients`)[
        0
      ].n,
      true,
    );
    const grants =
      await sql`select has_table_privilege('authenticated','outpost_private.task_bindings','INSERT') ins,
    has_table_privilege('service_role','outpost_private.task_bindings','SELECT') svc,
    has_schema_privilege('anon','outpost_private','USAGE') anon,
    has_function_privilege('authenticated','outpost_private.capture_task_parent()','EXECUTE') writer`;
    assertEquals(grants[0], {
      ins: false,
      svc: false,
      anon: false,
      writer: false,
    });
  },
});
Deno.test({
  ...opts,
  name: "native: private future object defaults do not silently grant access",
  fn: async () => {
    await sql`create table outpost_private.default_grant_probe(id integer)`;
    try {
      assertEquals(
        (await sql`select has_table_privilege('authenticated','outpost_private.default_grant_probe','SELECT') n`)[
          0
        ].n,
        false,
      );
    } finally {
      await sql`drop table outpost_private.default_grant_probe`;
    }
  },
});
Deno.test({
  ...opts,
  name: "native: non-pilot task ownership updates keep working",
  fn: async () => {
    const x = await fixture(), id = uuid();
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${id},${x.a},${x.ua},'ready','{}'::jsonb)`;
    await sql`update public.tasks set workspace_id=${x.b},user_id=${x.ub} where id=${id}`;
    assertEquals(
      (await sql`select workspace_id,user_id from public.tasks where id=${id}`)[
        0
      ],
      { workspace_id: x.b, user_id: x.ub },
    );
    assertEquals(
      (await api(x.service, `tasks?id=eq.${id}`, "PATCH", {
        description: "legitimate service update",
      }, "public")).status,
      204,
    );
    // No-op ownership assignments and unrelated fields retain normal SQL behavior.
    await sql`update public.tasks set workspace_id=${x.a},user_id=${x.ua},description='same original owner' where id=${x.ta}`;
  },
});
Deno.test({
  ...opts,
  name:
    "native: composite client/workspace FK independently rejects inconsistent trusted enrollment",
  fn: async () => {
    const x = await fixture();
    const t = await x.makeTask(
      { ...x.enrollments[0], client_binding_id: x.cb },
      x.ua,
    );
    const error = await assertRejects(() =>
      x.register(x.a, x.cb, t, x.ua, x.sa)
    );
    assertEquals((error as Error & { code: string }).code, "23503");
  },
});
Deno.test({
  ...opts,
  name: "native: PostgREST rejects tampered JWT signature before row access",
  fn: async () => {
    const x = await fixture(), auth = await jwt(x.ua, x.sa);
    const parts = auth.token.split(".");
    parts[2] = "A".repeat(parts[2].length);
    assertEquals((await api(parts.join("."), "clients")).status, 401);
  },
});
Deno.test({
  ...opts,
  name:
    "native: rollback refuses nonempty identity and leaves owner guard intact",
  fn: async () => {
    const x = await fixture(), c = await sql.reserve();
    try {
      const down = await Deno.readTextFile(
        new URL(
          "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/native-security-rollback.sql",
          import.meta.url,
        ),
      );
      await assertRejects(() => c.unsafe(down));
    } finally {
      await c`rollback`;
      c.release();
    }
    assertEquals(
      (await api((await jwt(x.ua, x.sa)).token, "task_bindings")).body.length,
      1,
    );
  },
});
for (
  const [role, allowed] of [["admin", true], ["editor", false], [
    "member",
    false,
  ], ["OWNER", false]] as const
) {
  Deno.test({
    ...opts,
    name: `native: original actor role ${role} ${
      allowed ? "retains" : "does not gain"
    } private task authority`,
    fn: async () => {
      const x = await fixture(), auth = await jwt(x.ua, x.sa);
      await sql`update public.workspace_members set role=${role} where workspace_id=${x.a} and user_id=${x.ua}`;
      const r = await api(auth.token, `task_bindings?task_id=eq.${x.ta}`);
      assertEquals(r.status, 200);
      assertEquals(r.body.length, allowed ? 1 : 0);
    },
  });
}
Deno.test({ ...opts, name: "native: close owned SQL pool", fn: closeHarness });
