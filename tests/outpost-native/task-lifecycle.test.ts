// Real SQL/PostgREST/P1 code; synthetic signed JWTs and external Auth responses.
// Actual Auth also runs separately in registration-auth.test.ts.
// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { api, fixture, jwt, opts } from "./fixture.ts";
import {
  closeHarness,
  serviceClient,
  sql,
  uuid,
} from "../db-contract/lib/harness.ts";
import { begin, invoke, registrationDeps } from "./lib/taskRegistration.ts";
import { fencedTaskUpdate } from "../../supabase/functions/_shared/fencedTaskWrite.ts";
import { claimContinuationViaRpc } from "../../supabase/functions/_shared/continuationClaim.ts";
import { createPilotTaskTransaction } from "../../supabase/functions/_shared/pilot/pilotTaskNativeStore.ts";
const altered = Deno.env.get("OUTPOST_NATIVE_OMIT_LIFECYCLE_GUARD") === "1";
async function setup() {
  const x = await fixture(), auth = await jwt(x.ua, x.sa);
  const known = new Map([[auth.token, x.ua]]);
  let authCalls = 0;
  const deps = await registrationDeps(x, (input, init) => {
    authCalls++;
    const u = String(input),
      token = new Headers(init?.headers).get("Authorization")?.replace(
        "Bearer ",
        "",
      );
    assert(
      u.endsWith("/auth/v1/user"),
      "no providers/models/other HTTP is allowed",
    );
    const user = known.get(token ?? "");
    return Promise.resolve(
      new Response(
        JSON.stringify(
          user
            ? { id: user, aud: "authenticated" }
            : { message: "unauthorized" },
        ),
        { status: user ? 200 : 401 },
      ),
    );
  });
  const make = () => x.makeTask(x.enrollments[0], x.ua, x.sa);
  const call = (
    task: string,
    action = "register",
    token = auth.token,
    extra = {},
  ) => invoke(deps, token, action, x.a, x.ca, task, extra);
  return { x, auth, known, deps, make, call, authCalls: () => authCalls };
}
Deno.test({
  ...opts,
  ignore: altered,
  name: "registration: empty rollback preserves prior security and reapplies",
  fn: async () => {
    const c = await sql.reserve();
    try {
      const down = await Deno.readTextFile(
        new URL(
          "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/native-task-rollback.sql",
          import.meta.url,
        ),
      );
      await c.unsafe(down);
      assertEquals(
        (await c`select to_regprocedure('public.outpost_pilot_access(uuid,uuid,integer,uuid)') is not null ok`)[
          0
        ].ok,
        true,
      );
      const up = await Deno.readTextFile(
        new URL(
          "../../supabase/migrations-held/20261023101216_outpost_pilot_task_registration_lifecycle.sql",
          import.meta.url,
        ),
      );
      await c.unsafe(`begin;\n${up}\ncommit;`);
    } finally {
      await c`rollback`;
      c.release();
    }
  },
});
Deno.test({
  ...opts,
  name: "registration: disabled before Auth or transaction; no live endpoint",
  fn: async () => {
    const f = await setup();
    let transactions = 0;
    f.deps.env = () => undefined;
    f.deps.transaction = () => {
      transactions++;
      throw new Error("must not connect");
    };
    const r = await f.call(f.x.ta);
    assertEquals(r.status, 503);
    await r.text();
    assertEquals(f.authCalls(), 0);
    assertEquals(transactions, 0);
  },
});
Deno.test({
  ...opts,
  name:
    "registration: exact P1 task registers once and replays with original session",
  fn: async () => {
    const f = await setup(), t = await f.make();
    const r = await f.call(t);
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "registered");
    const again = await f.call(t);
    assertEquals(again.status, 200);
    assertEquals((await again.json()).result, "replayed");
    const rows =
      await sql`select actor_id,session_id,task_snapshot from outpost_private.task_bindings where task_id=${t}`;
    assertEquals(rows.length, 1);
    assertEquals(rows[0].actor_id, f.x.ua);
    assertEquals(rows[0].session_id, f.x.sa);
    assertEquals(
      rows[0].task_snapshot,
      (await sql`select to_jsonb(t) row from public.tasks t where id=${t}`)[0]
        .row,
    );
    assertEquals(
      (await api(f.auth.token, `tasks?id=eq.${t}`, "GET", undefined, "public"))
        .body.length,
      1,
    );
  },
});
for (
  const defect of [
    "mac",
    "unsigned",
    "payload",
    "foreign-resource",
    "wrong-client",
    "missing-origin",
  ]
) {
  Deno.test({
    ...opts,
    name: `registration: forged ${defect} never captures a binding`,
    fn: async () => {
      const f = await setup();
      const t = defect === "missing-origin"
        ? await f.x.makeTask(f.x.enrollments[0], f.x.ua)
        : await f.make();
      if (
        defect === "mac"
      ) {
        await sql`update public.tasks set payload=jsonb_set(payload,'{pilot_scope,mac}',to_jsonb(repeat('0',64))) where id=${t}`;
      }
      if (
        defect === "unsigned"
      ) {
        await sql`update public.tasks set payload=payload-'pilot_scope' where id=${t}`;
      }
      if (
        defect === "payload"
      ) {
        await sql`update public.tasks set payload=payload||'{"pilot_model":"forged"}'::jsonb where id=${t}`;
      }
      if (
        defect === "foreign-resource"
      ) {
        await sql`update public.tasks set payload=jsonb_set(payload,'{pilot_scope,claims,resources}',${
          sql.json([{ kind: "task", id: f.x.tb }])
        }) where id=${t}`;
      }
      if (
        defect === "wrong-client"
      ) {
        await sql`update public.tasks set payload=jsonb_set(payload,'{pilot_scope,claims,client_binding_id}',to_jsonb(${f.x.cb}::text)) where id=${t}`;
      }
      const r = await f.call(t);
      assert([403, 409].includes(r.status), `${defect}: ${r.status}`);
      await r.text();
      assertEquals(
        (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
          .length,
        0,
      );
    },
  });
}
for (const role of ["admin", "editor", "viewer", "revoked"]) {
  Deno.test({
    ...opts,
    name: `registration: original ${role} native role controls are enforced`,
    fn: async () => {
      const f = await setup(), t = await f.make();
      if (
        role === "revoked"
      ) {
        await sql`delete from public.workspace_members where workspace_id=${f.x.a} and user_id=${f.x.ua}`;
      } else {
        await sql`update public.workspace_members set role=${role} where workspace_id=${f.x.a} and user_id=${f.x.ua}`;
      }
      const r = await f.call(t);
      assertEquals(r.status, role === "admin" ? 200 : 403);
      await r.text();
      assertEquals(
        (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
          .length,
        role === "admin" ? 1 : 0,
      );
    },
  });
}
Deno.test({
  ...opts,
  name:
    "registration: caller cannot supply trusted actor/session/expected authorization fields",
  fn: async () => {
    const f = await setup(), t = await f.make();
    for (
      const extra of [
        { actor_id: f.x.ua },
        { session_id: f.x.sa },
        { verified: true },
        { expected: {} },
        { resources: [] },
        { action: ["register"] },
        { action: { value: "register" } },
      ]
    ) {
      const r = await f.call(t, "register", f.auth.token, extra);
      assertEquals(r.status, 400);
      await r.text();
    }
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "registration: shared admin cannot bind another actor's task",
  fn: async () => {
    const f = await setup(),
      t = await f.make(),
      other = await jwt(f.x.shared, f.x.ss);
    f.known.set(other.token, f.x.shared);
    const r = await f.call(t, "register", other.token);
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: second login cannot capture a pending task or resume a registered one",
  fn: async () => {
    const f = await setup(), t = await f.make(), sid = uuid();
    await sql`insert into auth.sessions(id,user_id) values (${sid},${f.x.ua})`;
    const next = await jwt(f.x.ua, sid);
    f.known.set(next.token, f.x.ua);
    for (const id of [t, f.x.ta]) {
      const r = await f.call(id, "register", next.token);
      assertEquals(r.status, 403);
      await r.text();
    }
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "registration: revoked original session cannot register or cancel",
  fn: async () => {
    const f = await setup(), t = await f.make();
    await sql`delete from auth.sessions where id=${f.x.sa}`;
    for (const [id, action] of [[t, "register"], [f.x.ta, "cancel"]]) {
      const r = await f.call(id, action);
      assertEquals(r.status, 403);
      await r.text();
    }
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
    assertEquals(
      (await sql`select status from public.tasks where id=${f.x.ta}`)[0].status,
      "ready",
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: payload mutation and restoration cannot revive native authorization",
  fn: async () => {
    const f = await setup();
    await assertRejects(
      () =>
        sql`update public.tasks set payload=payload||'{"injected":true}'::jsonb where id=${f.x.ta}`,
      Error,
      "immutable",
    );
    assertEquals(
      (await api(f.auth.token, `task_bindings?task_id=eq.${f.x.ta}`)).body
        .length,
      1,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: service legacy claim and fenced output writes cannot mutate a pilot task",
  fn: async () => {
    const f = await setup(), db = await serviceClient();
    const task = await f.x.makeTask(f.x.enrollments[0], f.x.ua, f.x.sa, {
      terminal_status: "continuation_required",
      company_first_state: { round: 1 },
    });
    const registered = await f.call(task);
    assertEquals(registered.status, 200);
    await registered.text();
    const before =
      (await sql`select to_jsonb(t) row from public.tasks t where id=${task}`)[
        0
      ].row;
    const claim = await claimContinuationViaRpc({
      db: db as never,
      taskId: task,
      workspaceId: f.x.a,
      claimId: uuid(),
    });
    assert(claim.available);
    assertEquals(claim.claimed, false);
    assert(!claim.claimed);
    assertEquals(claim.reason, "not_permitted");
    assertEquals(claim.code, "42501");
    const write = await fencedTaskUpdate(
      db as never,
      task,
      { generation: null },
      { requireOpen: false },
      { result: { forged: true } },
    );
    assertEquals(write.written, false);
    assert(write.error !== null);
    assertEquals(
      (await sql`select to_jsonb(t) row from public.tasks t where id=${task}`)[
        0
      ].row,
      before,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: unregistered pilot cannot enter legacy execution or lose its marker",
  fn: async () => {
    const f = await setup(), t = await f.make();
    for (
      const patch of [{ status: "running" }, { payload: {} }, {
        status: "completed",
        result: { forged: true },
      }]
    ) {
      const r = await api(
        f.x.service,
        `tasks?id=eq.${t}`,
        "PATCH",
        patch,
        "public",
      );
      assertEquals(r.status, 403);
    }
    const id = uuid(),
      r = await api(f.x.service, "tasks", "POST", {
        id,
        workspace_id: f.x.a,
        user_id: f.x.ua,
        status: "running",
        payload: { execution_mode: "pilot_draft_only" },
      }, "public");
    assertEquals(r.status, 403);
    assertEquals(
      (await sql`select id from public.tasks where id=${id}`).length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: owner cancellation is terminal, replay-safe and invalidates all read authority",
  fn: async () => {
    const f = await setup();
    for (const expected of ["cancelled", "replayed"]) {
      const r = await f.call(f.x.ta, "cancel");
      assertEquals(r.status, 200);
      assertEquals((await r.json()).result, expected);
    }
    assertEquals(
      (await api(
        f.auth.token,
        `tasks?id=eq.${f.x.ta}`,
        "GET",
        undefined,
        "public",
      )).body,
      [],
    );
    await assertRejects(
      () => sql`update public.tasks set status='ready' where id=${f.x.ta}`,
      Error,
      "immutable",
    );
    const r = await f.call(f.x.ta);
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select status from public.tasks where id=${f.x.ta}`)[0].status,
      "cancelled",
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: lost commit response retries replay once without a second binding",
  fn: async () => {
    const f = await setup(), t = await f.make(), real = f.deps.transaction;
    let lost = true;
    f.deps.transaction = async (...args) => {
      const result = await real(...args);
      if (lost) {
        lost = false;
        throw new Error("lost database response after commit");
      }
      return result;
    };
    let r = await f.call(t);
    assertEquals(r.status, 503);
    await r.text();
    r = await f.call(t);
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "replayed");
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      1,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: concurrent identical requests serialize to one original binding",
  fn: async () => {
    const f = await setup(), t = await f.make();
    const responses = await Promise.all([f.call(t), f.call(t)]);
    assertEquals(responses.map((r) => r.status), [200, 200]);
    const results = await Promise.all(responses.map((r) => r.json()));
    assertEquals(results.map((r) => r.result).sort(), [
      "registered",
      "replayed",
    ]);
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      1,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: expiry between P1 verification and native write rolls back",
  fn: async () => {
    const f = await setup(), t = await f.make();
    f.deps.transaction = createPilotTaskTransaction(async (fn) =>
      await begin(async (db) =>
        await fn({
          query: async (text, values) => {
            if (text.includes("register_verified_task")) {
              await db.query(
                "update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1::uuid",
                [f.x.sa],
              );
            }
            return await db.query(text, values);
          },
        })
      )
    );

    const r = await f.call(t);
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "registration: app roles cannot call private transaction functions",
  fn: async () => {
    const f = await setup();
    for (const token of [null, f.auth.token, f.x.service]) {
      for (
        const name of [
          "lock_task_security",
          "register_verified_task",
          "cancel_verified_task",
          "bind_prepared_task",
        ]
      ) {
        const r = await api(token, `rpc/${name}`, "POST", {
          p_workspace: f.x.a,
          p_client: f.x.ca,
          p_version: 1,
          p_task: f.x.ta,
          ...(name === "lock_task_security" ? {} : { p_expected: {} }),
          ...(name === "bind_prepared_task" ? { p_payload: {} } : {}),
        });
        assert([401, 403, 404].includes(r.status), `${name}: ${r.status}`);
      }
    }
  },
});
Deno.test({
  ...opts,
  name: "lifecycle: populated rollback preserves guards and original identity",
  fn: async () => {
    const f = await setup(), c = await sql.reserve();
    try {
      await assertRejects(
        () =>
          c.unsafe(
            Deno.readTextFileSync(
              new URL(
                "../../docs/audits/agentory-outbound-outpost-readiness/production-readiness/phase-1/native-task-rollback.sql",
                import.meta.url,
              ),
            ),
          ),
        Error,
        "nonempty pilot",
      );
    } finally {
      await c`rollback`;
      c.release();
    }
    assertEquals(
      (await api(f.auth.token, `task_bindings?task_id=eq.${f.x.ta}`)).body
        .length,
      1,
    );
    await assertRejects(
      () => sql.unsafe("truncate public.tasks cascade"),
      Error,
      "prevents truncate",
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: legitimate nonpilot continuation claim and fenced output still land",
  fn: async () => {
    const f = await setup(), id = uuid(), db = await serviceClient();
    const checkpoint = {
      terminal_status: "continuation_required",
      company_first_state: { round: 1 },
    };
    await sql`insert into public.tasks(id,workspace_id,user_id,status,payload,result) values (${id},${f.x.a},${f.x.ua},'ready','{}',${
      sql.json(checkpoint)
    })`;
    const claim = await claimContinuationViaRpc({
      db: db as never,
      taskId: id,
      workspaceId: f.x.a,
      claimId: uuid(),
    });
    assert(claim.available && claim.claimed);
    assertEquals(claim.checkpointVersion, 1);
    const write = await fencedTaskUpdate(
      db as never,
      id,
      { generation: claim.checkpointVersion },
      { requireOpen: false },
      { result: { ...checkpoint, legitimate: true } },
    );
    assertEquals(write.written, true);
    assertEquals(
      (await sql`select status,result from public.tasks where id=${id}`)[0],
      { status: "running", result: { ...checkpoint, legitimate: true } },
    );
  },
});
for (const target of ["task", "member", "session"]) {
  Deno.test({
    ...opts,
    name:
      `registration: ${target} locks serialize a concurrent change through commit`,
    fn: async () => {
      const f = await setup(), t = await f.make(), real = f.deps.transaction;
      f.deps.transaction = (claims, scope, fn) =>
        real(claims, scope, (tx) =>
          fn({
            ...tx,
            register: async (s, row) => {
              const c = await sql.reserve();
              try {
                await c`begin`;
                await c`set local lock_timeout='80ms'`;
                if (target === "task") {
                  await assertRejects(
                    () =>
                      c`update public.tasks set description='racing mutation' where id=${t}`,
                    Error,
                    "lock timeout",
                  );
                }
                if (target === "member") {
                  await assertRejects(
                    () =>
                      c`delete from public.workspace_members where workspace_id=${f.x.a} and user_id=${f.x.ua}`,
                    Error,
                    "lock timeout",
                  );
                }
                if (target === "session") {
                  await assertRejects(
                    () => c`delete from auth.sessions where id=${f.x.sa}`,
                    Error,
                    "lock timeout",
                  );
                }
              } finally {
                await c`rollback`;
                c.release();
              }
              return await tx.register(s, row);
            },
          }));
      const r = await f.call(t);
      assertEquals(r.status, 200);
      await r.text();
      assertEquals(
        (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
          .length,
        1,
      );
      // Revocation after the protected commit takes effect immediately on reads.
      await sql`delete from auth.sessions where id=${f.x.sa}`;
      assertEquals(
        (await api(
          f.auth.token,
          `tasks?id=eq.${t}`,
          "GET",
          undefined,
          "public",
        )).body,
        [],
      );
    },
  });
}
Deno.test({
  ...opts,
  name:
    "registration: stale expected image cannot be committed after verification",
  fn: async () => {
    const f = await setup(), t = await f.make(), real = f.deps.transaction;
    f.deps.transaction = (claims, scope, fn) =>
      real(claims, scope, (tx) =>
        fn({
          ...tx,
          register: (s, row) =>
            tx.register(s, { ...row, description: "forged stale image" }),
        }));
    const r = await f.call(t);
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: cancelled request rolls back the native write before commit",
  fn: async () => {
    const f = await setup(),
      t = await f.make(),
      real = f.deps.transaction,
      abort = new AbortController();
    f.deps.transaction = (claims, scope, fn) =>
      real(claims, scope, (tx) =>
        fn({
          ...tx,
          register: async (s, row) => {
            const r = await tx.register(s, row);
            abort.abort();
            return r;
          },
        }));
    const r = await invoke(
      f.deps,
      f.auth.token,
      "register",
      f.x.a,
      f.x.ca,
      t,
      {},
      abort.signal,
    );
    assertEquals(r.status, 409);
    assertEquals((await r.json()).error, "pilot_task_request_cancelled");
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: deadlock refusal makes one attempt and never repairs automatically",
  fn: async () => {
    const f = await setup(), t = await f.make();
    let attempts = 0;
    f.deps.transaction = () => {
      attempts++;
      throw Object.assign(new Error("synthetic DB transport/deadlock"), {
        code: "40P01",
      });
    };
    const r = await f.call(t);
    assertEquals(r.status, 503);
    await r.text();
    assertEquals(attempts, 1);
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "registration: repeatable-read authorization snapshot refuses writes",
  fn: async () => {
    const f = await setup(), t = await f.make();
    f.deps.transaction = createPilotTaskTransaction(async (fn) => {
      const c = await sql.reserve();
      try {
        await c`begin isolation level repeatable read`;
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
    });
    const r = await f.call(t);
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: cancellation commit lost-response retry never reopens the task",
  fn: async () => {
    const f = await setup(), real = f.deps.transaction;
    let lost = true;
    f.deps.transaction = async (...args) => {
      const result = await real(...args);
      if (lost) {
        lost = false;
        throw new Error("lost committed cancel response");
      }
      return result;
    };
    let r = await f.call(f.x.ta, "cancel");
    assertEquals(r.status, 503);
    await r.text();
    r = await f.call(f.x.ta, "cancel");
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "replayed");
    assertEquals(
      (await sql`select status from public.tasks where id=${f.x.ta}`)[0].status,
      "cancelled",
    );
  },
});
Deno.test({
  ...opts,
  name:
    "registration: concurrent clients with overlapping external IDs never exchange native scope",
  fn: async () => {
    const f = await setup(),
      ta = await f.make(),
      tb = await f.x.makeTask(f.x.enrollments[1], f.x.ub, f.x.sb),
      b = await jwt(f.x.ub, f.x.sb);
    f.known.set(b.token, f.x.ub);
    const responses = await Promise.all([
      f.call(ta),
      invoke(f.deps, b.token, "register", f.x.b, f.x.cb, tb),
    ]);
    assertEquals(responses.map((r) => r.status), [200, 200]);
    await Promise.all(responses.map((r) => r.text()));
    for (
      const [task, workspace, client, actor, session] of [[
        ta,
        f.x.a,
        f.x.ca,
        f.x.ua,
        f.x.sa,
      ], [tb, f.x.b, f.x.cb, f.x.ub, f.x.sb]]
    ) {
      assertEquals(
        (await sql`select workspace_id,client_binding_id,actor_id,session_id from outpost_private.task_bindings where task_id=${task}`)[
          0
        ],
        {
          workspace_id: workspace,
          client_binding_id: client,
          actor_id: actor,
          session_id: session,
        },
      );
    }
    const wrong = await invoke(f.deps, b.token, "register", f.x.a, f.x.ca, ta);
    assertEquals(wrong.status, 403);
    await wrong.text();
  },
});
Deno.test({
  ...opts,
  name:
    "registration: pooled connections discard original JWT and local timeouts after commit",
  fn: async () => {
    const f = await setup(), t = await f.make(), r = await f.call(t);
    assertEquals(r.status, 200);
    await r.text();
    const a = await sql.reserve(), b = await sql.reserve();
    try {
      for (const c of [a, b]) {
        const row =
          (await c`select auth.uid() as actor, current_setting('lock_timeout') as timeout`)[
            0
          ];
        assertEquals(row, { actor: null, timeout: "0" });
      }
    } finally {
      a.release();
      b.release();
    }
  },
});
Deno.test({
  ...opts,
  name:
    "registration: private native functions keep fixed search path and no app execution grants",
  fn: async () => {
    const names = [
      "lock_task_security",
      "register_verified_task",
      "cancel_verified_task",
      "bind_prepared_task",
    ];
    const rows = await sql`select p.proname,p.prosecdef,p.proconfig,
   has_function_privilege('anon',p.oid,'EXECUTE') as anon,
   has_function_privilege('authenticated',p.oid,'EXECUTE') as browser,
   has_function_privilege('service_role',p.oid,'EXECUTE') as service
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='outpost_private' and p.proname in ${
      sql(names)
    }`;
    assertEquals(rows.length, 4);
    for (const row of rows) {
      assertEquals(row.prosecdef, true);
      assertEquals(row.proconfig, ['search_path=""']);
      assertEquals([row.anon, row.browser, row.service], [false, false, false]);
    }
  },
});
async function unsignedTask(
  f: Awaited<ReturnType<typeof setup>>,
  extra: Record<string, unknown> = {},
) {
  const t = uuid();
  await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${t},${f.x.a},${f.x.ua},'ready',${
    sql.json({
      execution_mode: "pilot_draft_only",
      approved_input: "synthetic approved existing lead",
      ...extra,
    })
  })`;
  return t;
}
Deno.test({
  ...opts,
  name:
    "preparation: original P1 signer and native registration commit atomically on an existing task",
  fn: async () => {
    const f = await setup(),
      selection = {
        provider: "openai",
        model: "gpt-4.1-mini",
        credential_id: uuid(),
        policy_version: 1,
        task_kind: "call_brief",
        schema: "call_brief_v1",
      },
      t = await unsignedTask(f, { pilot_model: selection });
    const before =
      (await sql`select payload from public.tasks where id=${t}`)[0].payload;
    let r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "registered");
    const task =
      (await sql`select payload,status from public.tasks where id=${t}`)[0];
    assertEquals(task.status, "ready");
    assertEquals(task.payload.pilot_origin_session_id, f.x.sa);
    assertEquals(task.payload.pilot_model, selection);
    const copy = { ...task.payload };
    delete copy.pilot_scope;
    delete copy.pilot_origin_session_id;
    assertEquals(copy, before);
    assertEquals(task.payload.pilot_scope.claims.task_id, t);
    assertEquals(task.payload.pilot_scope.claims.principal_user_id, f.x.ua);
    assertEquals(
      (await sql`select session_id from outpost_private.task_bindings where task_id=${t}`)[
        0
      ].session_id,
      f.x.sa,
    );
    const first = task.payload;
    r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "replayed");
    assertEquals(
      (await sql`select payload from public.tasks where id=${t}`)[0].payload,
      first,
    );
    r = await f.call(t);
    assertEquals(r.status, 200);
    await r.text(); // ORIGINAL P1 verifier accepts its own envelope.
  },
});
Deno.test({
  ...opts,
  name:
    "preparation: failed registration rolls back signature and origin stamp too",
  fn: async () => {
    const f = await setup(),
      t = await unsignedTask(f),
      real = f.deps.transaction,
      before =
        (await sql`select payload from public.tasks where id=${t}`)[0].payload;
    f.deps.transaction = (claims, scope, fn) =>
      real(claims, scope, (tx) =>
        fn({
          ...tx,
          register: () => {
            throw Object.assign(new Error("native refusal after bind"), {
              code: "42501",
            });
          },
        }));
    const r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select payload from public.tasks where id=${t}`)[0].payload,
      before,
    );
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name: "preparation: signed invalid scope is never silently repaired",
  fn: async () => {
    const f = await setup(), t = await f.make();
    await sql`update public.tasks set payload=jsonb_set(payload,'{pilot_scope,mac}',to_jsonb(repeat('0',64))) where id=${t}`;
    const before =
      (await sql`select payload from public.tasks where id=${t}`)[0].payload;
    const r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 409);
    await r.text();
    assertEquals(
      (await sql`select payload from public.tasks where id=${t}`)[0].payload,
      before,
    );
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "preparation: existing pending origin and foreign resources cannot be overwritten",
  fn: async () => {
    const f = await setup(),
      old = await unsignedTask(f, { pilot_origin_session_id: f.x.sb }),
      foreign = await unsignedTask(f);
    let r = await f.call(old, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 409);
    await r.text();
    r = await f.call(foreign, "prepare", f.auth.token, {
      resources: [{ kind: "task", id: f.x.tb }],
    });
    assertEquals(r.status, 404);
    await r.text();
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id in (${old},${foreign})`)
        .length,
      0,
    );
    assertEquals(
      (await sql`select payload->>'pilot_origin_session_id' as sid from public.tasks where id=${old}`)[
        0
      ].sid,
      f.x.sb,
    );
  },
});
Deno.test({
  ...opts,
  name: "preparation: native binder refuses changing business/model inputs",
  fn: async () => {
    const f = await setup(),
      t = await unsignedTask(f, {
        pilot_model: { provider: "openai", model: "gpt-4.1-mini" },
      }),
      real = f.deps.transaction;
    const before =
      (await sql`select payload from public.tasks where id=${t}`)[0].payload;
    f.deps.transaction = (claims, scope, fn) =>
      real(claims, scope, (tx) =>
        fn({
          ...tx,
          store: {
            ...tx.store,
            bind: (task, payload) =>
              tx.store.bind(task, {
                ...payload,
                pilot_model: { provider: "anthropic", model: "unsupported" },
              }),
          },
        }));
    const r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 403);
    await r.text();
    assertEquals(
      (await sql`select payload from public.tasks where id=${t}`)[0].payload,
      before,
    );
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      0,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "preparation: committed response loss replays exact signature and never resets state",
  fn: async () => {
    const f = await setup(),
      t = await unsignedTask(f),
      real = f.deps.transaction;
    let lost = true;
    f.deps.transaction = async (...args) => {
      const result = await real(...args);
      if (lost) {
        lost = false;
        throw new Error("lost prepare commit response");
      }
      return result;
    };
    let r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 503);
    await r.text();
    const first =
      (await sql`select to_jsonb(t) as row from public.tasks t where id=${t}`)[
        0
      ].row;
    r = await f.call(t, "prepare", f.auth.token, { resources: [] });
    assertEquals(r.status, 200);
    assertEquals((await r.json()).result, "replayed");
    assertEquals(
      (await sql`select to_jsonb(t) as row from public.tasks t where id=${t}`)[
        0
      ].row,
      first,
    );
    assertEquals(
      (await sql`select task_id from outpost_private.task_bindings where task_id=${t}`)
        .length,
      1,
    );
  },
});
Deno.test({
  ...opts,
  name:
    "lifecycle: adding a pilot marker and claiming an ordinary task cannot bypass quarantine",
  fn: async () => {
    const f = await setup();
    for (const status of ["ready", "running"]) {
      const id = uuid();
      await sql`insert into public.tasks(id,workspace_id,user_id,status,payload) values (${id},${f.x.a},${f.x.ua},${status},'{}')`;
      const r = await api(f.x.service, `tasks?id=eq.${id}`, "PATCH", {
        payload: { execution_mode: "pilot_draft_only" },
        status: "running",
      }, "public");
      assertEquals(r.status, 403);
      assertEquals(
        (await sql`select status,payload from public.tasks where id=${id}`)[0],
        { status, payload: {} },
      );
    }
  },
});
Deno.test({ ...opts, name: "lifecycle: close SQL pool", fn: closeHarness });
