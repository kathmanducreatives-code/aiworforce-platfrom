// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  A,
  ACCOUNT_A,
  ACCOUNT_B,
  B,
  bind,
  CA,
  call,
  CB,
  CONTACT_A,
  CONTACT_B,
  CRED_A,
  CRED_B,
  DEST_A,
  DEST_B,
  DRAFT_A,
  fixture,
  id,
  LEAD_A,
  MEMORY_A,
  MEMORY_B,
  noPaid,
  RESEARCH_A,
  RESEARCH_B,
  ROOTS,
  task,
  TASK_A,
  TASK_B,
  UA,
  UB,
} from "./_helpers/pilotScopeFixture.ts";
import { createPilotScopeStore } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import {
  canonical,
  PilotAccess,
} from "../../supabase/functions/_shared/pilot/pilotScope.ts";
import {
  loadPilotEnrollment,
  PILOT_SIGNING_ENV,
} from "../../supabase/functions/_shared/pilot/pilotPolicy.ts";
Deno.env.set("PILOT_SCOPE_IMPORT_ONLY", "1");
const { handlePilotScope } = await import(
  "../../supabase/functions/pilot-scope/index.ts"
);

Deno.test("P1 default disabled and missing server enrollment fail closed", async () => {
  const f = fixture();
  f.settings.OUTPOST_PILOT_SCOPE_ENABLED = "false";
  assertEquals((await call(f, "inspect")).status, 503);
  delete f.settings.OUTPOST_PILOT_SCOPE_ENABLED;
  assertEquals((await call(f, "inspect")).status, 503);
  f.settings.OUTPOST_PILOT_SCOPE_ENABLED = "true";
  f.setPolicy("");
  assertEquals((await call(f, "inspect")).status, 503);
  assert(!f.n.log.some((l) => l.includes("rest/v1")));
  noPaid(f.n);
});
Deno.test("P1 real user authentication rejects absent/anon/service impersonation before reads", async () => {
  for (const token of ["", "bad-jwt", "anon-public-key"]) {
    const f = fixture();
    const r = await call(f, "inspect", {}, token);
    assertEquals(r.status, 401);
    assert(!f.n.log.some((l) => l.includes("rest/v1")));
    noPaid(f.n);
  }
});
Deno.test("P1 explicit client identity required; body cannot claim authorization or actor", async () => {
  for (
    const extra of [
      { workspace_id: "" },
      { client_binding_id: "" },
      { client_binding_id: CB },
      { trusted: true },
      { user_id: UA },
      { mode: "send" },
    ]
  ) {
    const f = fixture();
    assert((await call(f, "inspect", extra)).status >= 400);
    assert(!f.n.log.some((l) => l.includes("rest/v1")));
  }
});
for (
  const mutate of [
    "duplicate_workspace",
    "duplicate_client",
    "wrong_mode",
    "remote_destination",
    "unknown_provider",
    "extra_field",
    "invalid_domain",
  ]
) {
  Deno.test(`P1 rejects ambiguous/unsupported enrollment: ${mutate}`, async () => {
    const f = fixture();
    const p = f.policy.workspaces;
    if (mutate === "duplicate_workspace") p[1].workspace_id = A;
    if (mutate === "duplicate_client") p[1].client_binding_id = CA;
    if (mutate === "wrong_mode") p[0].mode = "send";
    if (mutate === "remote_destination") p[0].destinations[0].kind = "webhook";
    if (mutate === "unknown_provider") p[0].credentials[0].provider = "gemini";
    if (mutate === "extra_field") {
      f.setPolicy(JSON.stringify({ ...f.policy, trusted: true }));
    }
    if (mutate === "invalid_domain") {
      p[0].seller_domain = "https://client-a.example";
    }
    assertEquals((await call(f, "inspect")).status, 503);
    assert(!f.n.log.some((l) => l.includes("rest/v1")));
    noPaid(f.n);
  });
}
Deno.test("P1 missing signing material refuses even a configured scope", async () => {
  const f = fixture();
  f.settings[PILOT_SIGNING_ENV] = "short";
  assertEquals((await call(f, "inspect")).status, 503);
  assert(!f.n.log.some((l) => l.includes("rest/v1")));
});
Deno.test("P1 owner/admin allowed; member/viewer/nonmember cannot enter pilot", async () => {
  const f = fixture();
  assertEquals((await call(f, "inspect")).status, 200);
  assertEquals((await call(f, "inspect", {}, "jwt-both")).status, 200);
  for (const role of ["member", "viewer", "unknown"]) {
    f.n.tables.workspace_members.find((r) => r.user_id === UA)!.role = role;
    assertEquals((await call(f, "inspect")).status, 403);
  }
  assertEquals((await call(f, "inspect", {}, "jwt-B")).status, 403);
  noPaid(f.n);
});
Deno.test("P1 membership read failure never acts as membership", async () => {
  const f = fixture();
  const r = await handlePilotScope(
    new Request("https://audit.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-A" },
      body: JSON.stringify({
        action: "inspect",
        workspace_id: A,
        client_binding_id: CA,
      }),
    }),
    {
      env: f.env,
      fetch: async (i, n) =>
        String(i).includes("workspace_members")
          ? new Response("{}", { status: 400 })
          : await f.fetch(i, n),
    },
  );
  assertEquals(r.status, 503);
  noPaid(f.n);
});
Deno.test("P1 two client Brains stay distinct; no global/default fallback", async () => {
  const f = fixture();
  const a = await call(f, "read_brain"),
    b = await call(f, "read_brain", {}, "jwt-B", B, CB);
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  assert(JSON.stringify(a.body).includes("PRIVATE_A_VOICE"));
  assert(!JSON.stringify(a.body).includes("PRIVATE_B_VOICE"));
  assert(JSON.stringify(b.body).includes("PRIVATE_B_VOICE"));
  assertEquals((await call(f, "read_brain", {}, "jwt-A", B, CB)).status, 403);
  noPaid(f.n);
});
Deno.test("P1 inactive/missing/wrong-client Brain blocks context and binding", async () => {
  for (const variant of ["inactive", "missing", "wrong"]) {
    const f = fixture();
    if (variant === "inactive") {
      f.n.tables.company_brain[0].onboarding_completed = false;
    }
    if (variant === "missing") f.n.tables.company_brain = [];
    if (variant === "wrong") {
      f.n.tables.company_brain[0].profile = {
        company: { name: "B", website_url: "https://client-b.example" },
      };
    }
    assertEquals((await call(f, "read_brain")).status, 409);
    assertEquals((await bind(f)).status, 409);
    assert(
      !task(f).payload ||
        !(task(f).payload as Record<string, unknown>).pilot_scope,
    );
    noPaid(f.n);
  }
});
Deno.test("P1 overlapping external IDs/domains/emails never determine workspace ownership", async () => {
  const f = fixture();
  const a = await call(f, "read_records", {
    resources: [{ kind: "account", id: ACCOUNT_A }, {
      kind: "contact",
      id: CONTACT_A,
    }],
  });
  const b = await call(
    f,
    "read_records",
    {
      resources: [{ kind: "account", id: ACCOUNT_B }, {
        kind: "contact",
        id: CONTACT_B,
      }],
    },
    "jwt-B",
    B,
    CB,
  );
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  assert(JSON.stringify(a.body).includes("Contact A"));
  assert(!JSON.stringify(a.body).includes("Contact B"));
  assert(JSON.stringify(b.body).includes("Contact B"));
  assertEquals(
    (await call(f, "read_records", {
      resources: [{ kind: "account", id: "same-company-id" }],
    })).status,
    400,
  );
  noPaid(f.n);
});
for (
  const [kind, foreign] of [
    ["account", ACCOUNT_B],
    ["contact", CONTACT_B],
    ["memory", MEMORY_B],
    ["research", RESEARCH_B],
    ["task", TASK_B],
  ] as const
) {
  Deno.test(`P1 user authorized for both clients cannot mix ${kind} records`, async () => {
    const f = fixture();
    const r = await call(f, "read_records", {
      resources: [{ kind: "account", id: ACCOUNT_A }, { kind, id: foreign }],
    }, "jwt-both");
    assertEquals(r.status, 404);
    assert(!("records" in r.body));
    assert(!JSON.stringify(r.body).includes("PRIVATE_B"));
    noPaid(f.n);
  });
}
Deno.test("P1 no memory listing or future import/research execution fallback", async () => {
  const f = fixture();
  for (
    const [action, extra] of [
      ["read_records", { resources: [] }],
      ["read_records", {
        resources: [{ kind: "import_record", id: id(1000) }],
      }],
      ["import", {}],
      ["research", {}],
      ["send", {}],
      ["export", {}],
    ] as const
  ) {
    const r = await call(f, action, extra);
    assertEquals(r.status, 400);
  }
  assert(!f.n.log.some((l) => l.includes("rest/v1")));
  noPaid(f.n);
});
for (
  const [kind, record, column, foreign] of [
    ["contact", CONTACT_A, "account_id", ACCOUNT_B],
    ["lead", LEAD_A, "contact_id", CONTACT_B],
    ["memory", MEMORY_A, "task_id", TASK_B],
    ["research", RESEARCH_A, "task_id", TASK_B],
    ["draft", DRAFT_A, "contact_id", CONTACT_B],
  ] as const
) {
  Deno.test(`P1 own ${kind} row cannot smuggle a foreign ${column}`, async () => {
    const f = fixture();
    const tables = {
      contact: "contacts",
      lead: "lead_candidates",
      memory: "saved_outputs",
      research: "tool_calls",
      draft: "outreach_drafts",
    };
    f.n.tables[tables[kind]].find((r) => r.id === record)![column] = foreign;
    assertEquals(
      (await call(f, "read_records", { resources: [{ kind, id: record }] }))
        .status,
      404,
    );
    noPaid(f.n);
  });
}
Deno.test("P1 credential/destination binding cannot borrow another client or global key", async () => {
  const f = fixture();
  const e = loadPilotEnrollment(f.env, A, CA);
  const access = await PilotAccess.forUser(
    createPilotScopeStore(f.deps),
    e,
    UA,
  );
  assertEquals(await access.credential(CRED_A, "openai", "call_brief"), {
    id: CRED_A,
    provider: "openai",
    purpose: "call_brief",
  });
  assertEquals(await access.destination(DEST_A), {
    id: DEST_A,
    kind: "manual_csv",
  });
  for (
    const [cid, provider, purpose] of [[CRED_B, "openai", "call_brief"], [
      CRED_A,
      "anthropic",
      "call_brief",
    ], [CRED_A, "openai", "send"]]
  ) await assertRejects(() => access.credential(cid, provider, purpose));
  await assertRejects(() => access.destination(DEST_B));
  assert(
    !JSON.stringify((await call(f, "inspect")).body).includes(
      "CLIENT_A_OPENAI",
    ),
  );
  noPaid(f.n);
});
Deno.test("P1 binding is persisted, idempotent and changes only task payload", async () => {
  const f = fixture();
  const before = structuredClone(task(f));
  assertEquals((await bind(f)).status, 200);
  const bound = structuredClone(task(f));
  assertEquals((await bind(f)).status, 200);
  assertEquals(task(f), bound);
  assertEquals({ ...task(f), payload: before.payload }, before);
  assert(!JSON.stringify((await bind(f)).body).includes("mac"));
  noPaid(f.n);
});
Deno.test("P1 user and service retries resume only original signed task scope", async () => {
  const f = fixture();
  await bind(f);
  for (const token of ["jwt-A", "service-role-secret"]) {
    const r = await call(f, "resume_task", {
      task_id: TASK_A,
      resources: ROOTS,
    }, token);
    assertEquals(r.status, 200);
    assert(JSON.stringify(r.body).includes("PRIVATE_A_OUTPUT"));
    assert(!JSON.stringify(r.body).includes("PRIVATE_B"));
    assert(!JSON.stringify(r.body).includes("CLIENT_A_OPENAI"));
  }
  assertEquals(
    (await call(
      f,
      "resume_task",
      { task_id: TASK_A },
      "service-role-secret",
      B,
      CB,
    )).status,
    404,
  );
  noPaid(f.n);
});
Deno.test("P1 bare service cannot bind or read arbitrary scope; existing legacy service guard unchanged", async () => {
  const f = fixture();
  for (const action of ["inspect", "read_brain", "read_records", "bind_task"]) {
    assertEquals(
      (await call(f, action, {
        ...(["bind_task"].includes(action) ? { task_id: TASK_A } : {}),
        ...(["read_records", "bind_task"].includes(action)
          ? { resources: ROOTS }
          : {}),
      }, "service-role-secret")).status,
      403,
    );
  }
  assertEquals(
    (await call(f, "resume_task", { task_id: TASK_A }, "service-role-secret"))
      .status,
    409,
  );
  noPaid(f.n);
});
Deno.test("P1 unrelated same-client resources cannot be added on service resume", async () => {
  const f = fixture();
  await bind(f);
  const r = await call(f, "resume_task", {
    task_id: TASK_A,
    resources: [{ kind: "draft", id: DRAFT_A }],
  }, "service-role-secret");
  assertEquals(r.status, 403);
  noPaid(f.n);
});
Deno.test("P1 cannot rebind accepted task to a changed resource set", async () => {
  const f = fixture();
  await bind(f);
  assertEquals(
    (await call(f, "bind_task", { task_id: TASK_A, resources: [] })).status,
    409,
  );
  noPaid(f.n);
});
Deno.test("P1 cross-workspace task dependencies refuse binding", async () => {
  const f = fixture();
  task(f).depends_on = [TASK_B];
  assertEquals((await bind(f)).status, 404);
  noPaid(f.n);
});
Deno.test("P1 arbitrary legacy task cannot be bound or resumed", async () => {
  const f = fixture();
  task(f).payload = { instruction: "Existing legitimate legacy task" };
  assertEquals((await bind(f)).status, 409);
  assertEquals(
    (await call(f, "resume_task", { task_id: TASK_A }, "service-role-secret"))
      .status,
    409,
  );
  noPaid(f.n);
});
Deno.test("P1 task owner is derived from validated actor, never supplied body", async () => {
  const f = fixture();
  task(f).user_id = UB;
  assertEquals((await bind(f)).status, 403);
  noPaid(f.n);
});
Deno.test("P1 revoked original membership blocks user and service resume", async () => {
  const f = fixture();
  await bind(f);
  f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
    r.user_id !== UA
  );
  for (const token of ["jwt-A", "service-role-secret"]) {
    assertEquals(
      (await call(f, "resume_task", { task_id: TASK_A }, token)).status,
      403,
    );
  }
  noPaid(f.n);
});
Deno.test("P1 admin belonging to both clients cannot impersonate task initiator", async () => {
  const f = fixture();
  await bind(f);
  assertEquals(
    (await call(f, "resume_task", { task_id: TASK_A }, "jwt-both")).status,
    409,
  );
  noPaid(f.n);
});
for (
  const variant of [
    "payload",
    "signature",
    "task_copy",
    "move_workspace",
    "policy_version",
    "policy_content",
    "key_rotation",
    "unsigned",
  ]
) {
  Deno.test(`P1 resume fails closed after ${variant}`, async () => {
    const f = fixture();
    await bind(f);
    const p = task(f).payload as Record<string, unknown>;
    if (variant === "payload") p.instruction = "Research another company";
    if (variant === "signature") {
      (p.pilot_scope as { mac: string }).mac = "0".repeat(64);
    }
    if (variant === "task_copy") {
      task(f, TASK_B).payload = structuredClone(p);
      task(f, TASK_B).user_id = UA;
    }
    if (variant === "move_workspace") task(f).workspace_id = B;
    if (variant === "policy_version") f.policy.workspaces[0].version++;
    if (variant === "policy_content") {
      f.policy.workspaces[0].credentials[0].reference = "ANOTHER_ACCOUNT";
    }
    if (variant === "key_rotation") {
      f.settings[PILOT_SIGNING_ENV] =
        "rotated-synthetic-only-key-abcdefghijklmnop";
    }
    if (variant === "unsigned") delete p.pilot_scope;
    const r = variant === "task_copy"
      ? await call(
        f,
        "resume_task",
        { task_id: TASK_B },
        "service-role-secret",
        B,
        CB,
      )
      : await call(
        f,
        "resume_task",
        { task_id: TASK_A },
        "service-role-secret",
      );
    assert(r.status >= 400);
    assert(!("records" in r.body));
    noPaid(f.n);
  });
}
Deno.test("P1 moved nested resources cannot be read through an old task binding", async () => {
  const f = fixture();
  await bind(f);
  f.n.tables.contacts[0].account_id = ACCOUNT_B;
  assertEquals(
    (await call(f, "resume_task", { task_id: TASK_A }, "service-role-secret"))
      .status,
    404,
  );
  noPaid(f.n);
});
Deno.test("P1 concurrent payload edit makes compare-and-set refuse instead of overwrite", async () => {
  const f = fixture();
  f.setRace();
  assertEquals((await bind(f)).status, 409);
  assertEquals(
    (task(f).payload as Record<string, unknown>).concurrent_edit,
    true,
  );
  assertEquals(
    (task(f).payload as Record<string, unknown>).pilot_scope,
    undefined,
  );
  noPaid(f.n);
});
Deno.test("P1 failed persistence never reports a bound task", async () => {
  const f = fixture();
  f.setWriteError(true);
  assertEquals((await bind(f)).status, 503);
  assertEquals(
    (task(f).payload as Record<string, unknown>).pilot_scope,
    undefined,
  );
  noPaid(f.n);
});
Deno.test("P1 simultaneous duplicate binds have one stored immutable binding", async () => {
  const f = fixture();
  const r = await Promise.all([bind(f), bind(f)]);
  assert(r.every((v) => v.status === 200 || v.status === 409));
  assert(r.some((v) => v.status === 200));
  const payload = canonical(task(f).payload);
  assertEquals((await bind(f)).status, 200);
  assertEquals(canonical(task(f).payload), payload);
  noPaid(f.n);
});
Deno.test("P1 public preflight/method/body limits have no DB/provider effects", async () => {
  const f = fixture();
  const options = await handlePilotScope(
    new Request("https://audit.invalid", { method: "OPTIONS" }),
    f.deps,
  );
  assertEquals(options.status, 204);
  assertEquals(
    (await handlePilotScope(new Request("https://audit.invalid"), f.deps))
      .status,
    405,
  );
  const large = await handlePilotScope(
    new Request("https://audit.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-A" },
      body: "x".repeat(17000),
    }),
    f.deps,
  );
  assertEquals(large.status, 413);
  assert(!f.n.log.some((l) => l.includes("rest/v1")));
  noPaid(f.n);
});

Deno.test("P1 unauthorized resume does not perform a privileged task read", async () => {
  const f = fixture();
  await bind(f);
  f.n.log.length = 0;
  assertEquals(
    (await call(f, "resume_task", { task_id: TASK_A }, "jwt-B")).status,
    403,
  );
  assert(!f.n.log.some((l) => l.includes("/tasks")));
  noPaid(f.n);
});
Deno.test("P1 client identity mismatch blocks every record read, not only Brain rendering", async () => {
  const f = fixture();
  f.n.tables.company_brain[0].profile = {
    company: { name: "Other client", website_url: "https://client-b.example" },
  };
  assertEquals(
    (await call(f, "read_records", {
      resources: [{ kind: "account", id: ACCOUNT_A }],
    })).status,
    409,
  );
  assert(!f.n.log.some((l) => l.includes("/accounts")));
});

Deno.test("P1 captured credential/destination context cannot survive membership revocation", async () => {
  const f = fixture();
  const access = await PilotAccess.forUser(
    createPilotScopeStore(f.deps),
    loadPilotEnrollment(f.env, A, CA),
    UA,
  );
  f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
    r.user_id !== UA
  );
  await assertRejects(() => access.credential(CRED_A, "openai", "call_brief"));
  await assertRejects(() => access.destination(DEST_A));
  noPaid(f.n);
});

Deno.test("P1 unbound task reads expose status without payload or output", async () => {
  const f = fixture();
  const r = await call(f, "read_records", {
    resources: [{ kind: "task", id: TASK_A }],
  });
  assertEquals(r.status, 200);
  assertEquals(r.body.records, [{
    id: TASK_A,
    workspace_id: A,
    status: "ready",
  }]);
  assert(!JSON.stringify(r.body).includes("PRIVATE_A_OUTPUT"));
  noPaid(f.n);
});

Deno.test("P1 concurrent task creator change refuses binding without overwriting it", async () => {
  const f = fixture();
  f.deps.fetch = (async (input, init) => {
    const req = input instanceof Request
      ? input
      : new Request(String(input), init);
    if (req.method === "PATCH") task(f).user_id = UB;
    return await f.fetch(req);
  }) as typeof fetch;
  assertEquals((await bind(f)).status, 409);
  assertEquals(task(f).user_id, UB);
  assertEquals(
    (task(f).payload as Record<string, unknown>).pilot_scope,
    undefined,
  );
  noPaid(f.n);
});
