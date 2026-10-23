// Auth and database transport failures mocked; no application success fabricated.
// Native successful paths run against real PG/GoTrue in tests/outpost-native/.
// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handlePilotTaskRegistration,
  type PilotRegistrationDeps,
} from "../../supabase/functions/_shared/pilot/pilotTaskRegistration.ts";
import {
  A,
  CA,
  fixture,
  id,
  TASK_A,
  UA,
  UB,
} from "./_helpers/pilotScopeFixture.ts";
const claims = () => ({
  sub: UA,
  role: "authenticated",
  session_id: id(1200),
  exp: Math.floor(Date.now() / 1000) + 3600,
  is_anonymous: false,
});
const token = (c: Record<string, unknown>) =>
  `${btoa('{"alg":"RS256","typ":"JWT"}')}.${
    btoa(JSON.stringify(c))
  }.synthetic-auth-provider-verified`;
function setup(
  c: Record<string, unknown> = claims(),
  authUser: string | null = UA,
) {
  const f = fixture(), tok = token(c);
  let authCalls = 0, attempts = 0;
  f.settings.OUTPOST_PILOT_REGISTRATION_ENABLED = "true";
  const deps: PilotRegistrationDeps = {
    env: f.env,
    fetch: (_input, init) => {
      authCalls++;
      assertEquals(
        new Headers(init?.headers).get("Authorization"),
        `Bearer ${tok}`,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify(
            authUser
              ? { id: authUser, aud: "authenticated" }
              : { message: "bad JWT" },
          ),
          { status: authUser ? 200 : 401 },
        ),
      );
    },
    transaction: () => {
      attempts++;
      throw new Error("database unavailable");
    },
  };
  const call = (extra = {}, signal?: AbortSignal) =>
    handlePilotTaskRegistration(
      new Request("https://offline.invalid/task-security", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${tok}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "register",
          workspace_id: A,
          client_binding_id: CA,
          task_id: TASK_A,
          ...extra,
        }),
      }),
      deps,
    );
  return { f, deps, call, counts: () => ({ authCalls, attempts }) };
}
Deno.test("task registration defaults disabled before Auth/DB", async () => {
  const x = setup();
  delete x.f.settings.OUTPOST_PILOT_REGISTRATION_ENABLED;
  const r = await x.call();
  assertEquals(r.status, 503);
  await r.text();
  assertEquals(x.counts(), { authCalls: 0, attempts: 0 });
});
Deno.test("task registration Auth rejection precedes decoded session or DB authority", async () => {
  const x = setup(claims(), null), r = await x.call();
  assertEquals(r.status, 401);
  await r.text();
  assertEquals(x.counts().attempts, 0);
});
for (
  const change of [
    "subject",
    "role",
    "session",
    "expiration",
    "anonymous",
    "metadata-role",
  ]
) {
  Deno.test(`task registration refuses Auth-verified but invalid ${change} context`, async () => {
    const c: Record<string, unknown> = claims();
    if (change === "subject") c.sub = UB;
    if (change === "role") c.role = "service_role";
    if (change === "session") delete c.session_id;
    if (change === "expiration") c.exp = 1;
    if (change === "anonymous") c.is_anonymous = true;
    if (change === "metadata-role") {
      c.role = "viewer";
      c.user_metadata = { role: "owner" };
    }
    const x = setup(c), r = await x.call();
    assertEquals(r.status, 401);
    await r.text();
    assertEquals(x.counts().attempts, 0);
  });
}
for (
  const extra of [
    { verified: true },
    { actor_id: UA },
    { session_id: id(9) },
    { expected: {} },
    { action: ["cancel"] },
    { action: { value: "register" } },
    { task_id: "not-uuid" },
  ]
) {
  Deno.test(`task registration refuses unsafe request ${JSON.stringify(extra)}`, async () => {
    const x = setup(), r = await x.call(extra);
    assertEquals(r.status, 400);
    await r.text();
    assertEquals(x.counts().attempts, 0);
  });
}
Deno.test("task registration cannot bypass disabled P1", async () => {
  const x = setup();
  x.f.settings.OUTPOST_PILOT_SCOPE_ENABLED = "false";
  const r = await x.call();
  assertEquals(r.status, 503);
  await r.text();
  assertEquals(x.counts().attempts, 0);
});
for (const code of ["42501", "40001", "40P01", "08006"]) {
  Deno.test(`task registration ${code} refuses once without repair/fallback`, async () => {
    const x = setup();
    let attempts = 0;
    x.deps.transaction = () => {
      attempts++;
      throw Object.assign(new Error("synthetic DB failure"), { code });
    };
    const r = await x.call();
    assertEquals(r.status, code === "42501" ? 403 : 503);
    await r.text();
    assertEquals(attempts, 1);
  });
}
Deno.test("task registration abort before Auth does not open a transaction", async () => {
  const x = setup(), abort = new AbortController();
  abort.abort();
  const r = await x.call({}, abort.signal);
  assertEquals(r.status, 409);
  await r.text();
  assertEquals(x.counts(), { authCalls: 0, attempts: 0 });
});

Deno.test("task preparation requires explicit valid resources before DB", async () => {
  for (
    const extra of [{ action: "prepare" }, {
      action: "prepare",
      resources: [{ kind: "unknown", id: TASK_A }],
    }, { action: "prepare", resources: [], pilot_origin_session_id: id(9) }]
  ) {
    const x = setup(), r = await x.call(extra);
    assertEquals(r.status, 400);
    await r.text();
    assertEquals(x.counts().attempts, 0);
  }
});
Deno.test("task preparation uses one bounded database transaction after Auth", async () => {
  const x = setup(), r = await x.call({ action: "prepare", resources: [] });
  assertEquals(r.status, 503);
  await r.text();
  assertEquals(x.counts(), { authCalls: 1, attempts: 1 });
});
