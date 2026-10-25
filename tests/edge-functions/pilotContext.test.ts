// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePilotContext } from "../../supabase/functions/_shared/pilot/pilotContext.ts";
import {
  A,
  ACCOUNT_A,
  ACCOUNT_B,
  B,
  BOTH,
  CA,
  CB,
  DRAFT_A,
  fixture,
  id,
  MEMORY_A,
  MEMORY_B,
  noPaid,
  ROOTS,
  task,
  TASK_A,
  TASK_B,
  UA,
  UB,
} from "./_helpers/pilotScopeFixture.ts";
import type { Row } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";

async function request(
  f: ReturnType<typeof fixture>,
  action: string,
  extra: Row = {},
  token = "jwt-A",
) {
  f.settings.OUTPOST_PILOT_CONTEXT_ENABLED ??= "true";
  const r = await handlePilotContext(
    new Request("https://audit.invalid/pilot-context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...extra }),
    }),
    f.deps,
  );
  const body = await r.json();
  noPaid(f.n);
  return { status: r.status, body };
}
const scope = (workspace_id = A, client_binding_id = CA) => ({
  workspace_id,
  client_binding_id,
  resources: [],
});

Deno.test("P2 defaults disabled even with P1 enabled; P1 disabled cannot be bypassed", async () => {
  const f = fixture();
  f.settings.OUTPOST_PILOT_CONTEXT_ENABLED = "false";
  assertEquals((await request(f, "list_workspaces")).status, 503);
  f.settings.OUTPOST_PILOT_CONTEXT_ENABLED = "true";
  f.settings.OUTPOST_PILOT_SCOPE_ENABLED = "false";
  assertEquals((await request(f, "list_workspaces")).status, 503);
});
for (
  const [token, expected] of [["jwt-A", [A]], ["jwt-B", [B]], ["jwt-both", [
    A,
    B,
  ]]] as const
) {
  Deno.test(`P2 server lists only authorized enrolled clients: ${token}`, async () => {
    const f = fixture();
    const r = await request(f, "list_workspaces", {}, token);
    assertEquals(r.status, 200);
    assertEquals(r.body.choices.map((c: Row) => c.workspace_id), expected);
    assert(!JSON.stringify(r.body).includes("PRIVATE_"));
    assert(!JSON.stringify(r.body).includes("OPENAI"));
  });
}
for (
  const [token, ws, client, marker] of [["jwt-A", A, CA, "PRIVATE_A_VOICE"], [
    "jwt-B",
    B,
    CB,
    "PRIVATE_B_VOICE",
  ]] as const
) {
  Deno.test(`P2 fresh Company Brain identity: ${ws}`, async () => {
    const f = fixture();
    const r = await request(f, "read_context", scope(ws, client), token);
    assertEquals(r.status, 200);
    assert(JSON.stringify(r.body).includes(marker));
    assert(
      !JSON.stringify(r.body).includes(
        marker.includes("_A_") ? "PRIVATE_B" : "PRIVATE_A",
      ),
    );
    assertEquals(r.body.records, []);
    assertEquals(r.body.task_id, null);
    assertEquals(r.body.capabilities.execution, false);
    assertEquals(r.body.capabilities.models, false);
  });
}
for (
  const [action, extra, token] of [
    ["read_context", scope(B, CB), "jwt-A"],
    ["read_context", {
      ...scope(),
      resources: [{ kind: "memory", id: MEMORY_B }],
    }, "jwt-both"],
    ["read_context", {
      ...scope(),
      resources: [{ kind: "account", id: ACCOUNT_A }, {
        kind: "account",
        id: ACCOUNT_B,
      }],
    }, "jwt-both"],
    ["read_context", {
      ...scope(),
      resources: [{ kind: "message", id: id(999) }],
    }, "jwt-A"],
    ["read_context", { workspace_id: A, resources: [] }, "jwt-A"],
    ["read_context", { ...scope(), client_binding_id: CB }, "jwt-both"],
    ["read_context", { ...scope(), brain: { injected: "wrong" } }, "jwt-A"],
    ["list_workspaces", {}, "bad-token"],
    ["models", scope(), "jwt-A"],
  ] as const
) {
  Deno.test(`P2 unauthorized/mixed/unsupported scope fails closed: ${action} ${JSON.stringify(extra)}`, async () => {
    const f = fixture();
    const r = await request(f, action, extra, token);
    assert(r.status >= 400);
    assert(!JSON.stringify(r.body).includes("PRIVATE_"));
  });
}
Deno.test("P2 explicit memory/research/draft set is scoped; no implicit conversation history", async () => {
  const f = fixture();
  const r = await request(f, "read_context", {
    ...scope(),
    resources: [...ROOTS, { kind: "draft", id: DRAFT_A }],
  });
  assertEquals(r.status, 200);
  assert(JSON.stringify(r.body).includes("PRIVATE_A_MEMORY"));
  assert(JSON.stringify(r.body).includes("PRIVATE_A_RESEARCH"));
  assert(!JSON.stringify(r.body).includes("PRIVATE_B"));
});
Deno.test("P2 prepare uses persisted P1 signature; same-client retry/resume does not rewrite or dispatch", async () => {
  const f = fixture();
  const fields = { ...scope(), task_id: TASK_A, resources: ROOTS };
  const first = await request(f, "prepare_task", fields);
  assertEquals(first.status, 200);
  assertEquals(first.body.task_id, TASK_A);
  const stored = JSON.stringify(task(f).payload);
  for (const action of ["prepare_task", "resume_task"]) {
    assertEquals((await request(f, action, fields)).status, 200);
    assertEquals(JSON.stringify(task(f).payload), stored);
  }
  assertEquals(task(f).status, "ready");
  assertEquals(
    (await request(
      f,
      "resume_task",
      fields,
      f.n.env("SUPABASE_SERVICE_ROLE_KEY"),
    )).status,
    200,
  );
});
for (
  const mutation of [
    "workspace",
    "client",
    "creator",
    "payload",
    "forged",
    "revoked",
    "policy",
    "resources",
  ] as const
) {
  Deno.test(`P2 bound task cannot change identity/resources on retry: ${mutation}`, async () => {
    const f = fixture();
    const fields: Row = { ...scope(), task_id: TASK_A, resources: ROOTS };
    assertEquals((await request(f, "prepare_task", fields)).status, 200);
    if (mutation === "workspace") Object.assign(fields, scope(B, CB));
    if (mutation === "client") fields.client_binding_id = CB;
    if (mutation === "creator") task(f).user_id = UB;
    if (mutation === "payload") {
      (task(f).payload as Row).instruction = "different";
    }
    if (mutation === "forged") {
      ((task(f).payload as Row).pilot_scope as Row).mac = "0".repeat(64);
    }
    if (mutation === "revoked") {
      f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
        r.user_id !== UA
      );
    }
    if (mutation === "policy") f.policy.workspaces[0].version++;
    if (mutation === "resources") {
      fields.resources = [...ROOTS, { kind: "draft", id: DRAFT_A }];
    }
    const r = await request(f, "resume_task", fields);
    assert(r.status >= 400);
    assert(!JSON.stringify(r.body).includes("PRIVATE_"));
  });
}
Deno.test("P2 service cannot select/bind/unbound-resume or substitute the initiator", async () => {
  const f = fixture();
  const service = f.n.env("SUPABASE_SERVICE_ROLE_KEY");
  for (
    const action of [
      "list_workspaces",
      "read_context",
      "prepare_task",
      "resume_task",
    ]
  ) {
    const r = await request(
      f,
      action,
      action === "list_workspaces"
        ? {}
        : { ...scope(), task_id: TASK_A, resources: ROOTS },
      service,
    );
    assert(r.status >= 400);
  }
  assertEquals(
    (await request(f, "prepare_task", {
      ...scope(),
      task_id: TASK_A,
      resources: ROOTS,
    })).status,
    200,
  );
  assertEquals(
    (await request(f, "resume_task", {
      ...scope(),
      task_id: TASK_A,
      resources: ROOTS,
    }, "jwt-both")).status,
    409,
  );
});
Deno.test("P2 rechecks identity; invalid Brain never falls back to another workspace", async () => {
  const f = fixture();
  (f.n.tables.company_brain[0].profile as Row).company = {
    name: "B",
    website_url: "https://client-b.example",
  };
  const r = await request(f, "read_context", scope());
  assertEquals(r.status, 409);
  assertEquals((await request(f, "list_workspaces")).body.choices, []);
});
Deno.test("P2 limits request bytes and resource counts and persists no context cache", async () => {
  const f = fixture();
  const r = await request(f, "read_context", {
    ...scope(),
    resources: Array.from(
      { length: 26 },
      (_, n) => ({ kind: "memory", id: id(n + 1000) }),
    ),
  });
  assertEquals(r.status, 400);
  const large = await request(f, "read_context", {
    ...scope(),
    extra: "x".repeat(17000),
  });
  assertEquals(large.status, 413);
  assertEquals(f.n.log.filter((s) => s.startsWith("CAS ")).length, 0);
});

Deno.test("P2 real selection controller → endpoint → P1 binding: shared admin A/B and wrong-client resume", async () => {
  const { WorkspaceSelection, scopeIdentity } = await import(
    "../../src/lib/workspaceSelection.ts"
  );
  const f = fixture();
  task(f).user_id = BOTH;
  task(f, TASK_B).user_id = BOTH;
  const controller = new WorkspaceSelection(BOTH, async (body) => {
    const r = await request(
      f,
      String(body.action),
      Object.fromEntries(Object.entries(body).filter(([k]) => k !== "action")),
      "jwt-both",
    );
    if (r.status !== 200) throw Error(String(r.body.error));
    return r.body;
  }, () => {});
  await controller.loadChoices();
  assertEquals(controller.snapshot().choices.length, 2);
  const choiceA = controller.snapshot().choices.find((c) =>
    c.workspace_id === A
  )!;
  const choiceB = controller.snapshot().choices.find((c) =>
    c.workspace_id === B
  )!;
  await controller.select(scopeIdentity(choiceA));
  await controller.prepare(TASK_A, [{ kind: "memory", id: MEMORY_A }]);
  assert(
    JSON.stringify(controller.snapshot().context).includes("PRIVATE_A_MEMORY"),
  );
  await controller.select(scopeIdentity(choiceB));
  await controller.read([{ kind: "memory", id: MEMORY_B }]);
  assert(!JSON.stringify(controller.snapshot().context).includes("PRIVATE_A"));
  let refused = false;
  try {
    await controller.resume(TASK_A, [{ kind: "memory", id: MEMORY_A }]);
  } catch {
    refused = true;
  }
  assert(refused);
  assertEquals(controller.snapshot().context, null);
  await controller.select(scopeIdentity(choiceA));
  await controller.resume(TASK_A, [{ kind: "memory", id: MEMORY_A }]);
  assertEquals(controller.snapshot().context?.task_id, TASK_A);
  f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
    !(r.workspace_id === A && r.user_id === BOTH)
  );
  try {
    await controller.resume(TASK_A, [{ kind: "memory", id: MEMORY_A }]);
  } catch { /* refusal expected */ }
  assertEquals(controller.snapshot().context, null);
  assertEquals(controller.snapshot().selected, null);
  noPaid(f.n);
});
Deno.test("P2 record body update changes content fingerprint; same-client Brain changes are fresh, not a frozen generation snapshot", async () => {
  const f = fixture();
  const fields = { ...scope(), resources: [{ kind: "memory", id: MEMORY_A }] };
  const before = await request(f, "read_context", fields);
  assertEquals(before.status, 200);
  f.n.tables.saved_outputs.find((r) => r.id === MEMORY_A)!.body =
    "PRIVATE_A_UPDATED";
  const after = await request(f, "read_context", fields);
  assertEquals(after.status, 200);
  assert(before.body.context_key !== after.body.context_key);
  assert(JSON.stringify(after.body).includes("PRIVATE_A_UPDATED"));
});
Deno.test("P2 membership revoked while reading records is rechecked before context release", async () => {
  const f = fixture();
  const base = f.fetch;
  f.deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await base(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/rest/v1/saved_outputs") {
      f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
        r.user_id !== UA
      );
    }
    return res;
  }) as typeof fetch;
  const r = await request(f, "read_context", {
    ...scope(),
    resources: [{ kind: "memory", id: MEMORY_A }],
  });
  assertEquals(r.status, 403);
  assert(!JSON.stringify(r.body).includes("PRIVATE_"));
});

Deno.test("P2 oversized memory is refused, never silently truncated or returned", async () => {
  const f = fixture();
  f.n.tables.saved_outputs.find((r) => r.id === MEMORY_A)!.body = "PRIVATE_A_"
    .repeat(8000);
  const r = await request(f, "read_context", {
    ...scope(),
    resources: [{ kind: "memory", id: MEMORY_A }],
  });
  assertEquals(r.status, 413);
  assert(!JSON.stringify(r.body).includes("PRIVATE_A_"));
});

Deno.test("P2 switching while preparation completes cannot retarget a bound task or render its old response", async () => {
  const { WorkspaceSelection, scopeIdentity, StaleClientSelection } =
    await import("../../src/lib/workspaceSelection.ts");
  const f = fixture();
  task(f).user_id = BOTH;
  let release!: () => void, ready!: () => void;
  const waiting = new Promise<void>((r) => {
    ready = r;
  });
  const controller = new WorkspaceSelection(BOTH, async (body) => {
    const r = await request(
      f,
      String(body.action),
      Object.fromEntries(Object.entries(body).filter(([k]) => k !== "action")),
      "jwt-both",
    );
    if (r.status !== 200) throw Error("refused");
    if (body.action === "prepare_task") {
      ready();
      await new Promise<void>((r) => {
        release = r;
      });
    }
    return r.body;
  }, () => {});
  await controller.loadChoices();
  const [a, b] = controller.snapshot().choices;
  await controller.select(scopeIdentity(a));
  const preparation = controller.prepare(TASK_A, [{
    kind: "memory",
    id: MEMORY_A,
  }]);
  const caught = preparation.catch((e) => e);
  await waiting;
  await controller.select(scopeIdentity(b));
  release();
  assert((await caught) instanceof StaleClientSelection);
  assertEquals(controller.snapshot().context?.scope.workspace_id, B);
  assert(!JSON.stringify(controller.snapshot().context).includes("PRIVATE_A"));
  const stored = (task(f).payload as Row).pilot_scope as Row;
  assertEquals((stored.claims as Row).workspace_id, A);
  assertEquals((stored.claims as Row).client_binding_id, CA);
});
