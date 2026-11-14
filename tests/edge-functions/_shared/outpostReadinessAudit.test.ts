// deno-lint-ignore-file no-explicit-any require-await no-import-prefix
// Offline audit only. External network and persistence are in-memory substitutes.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateText,
  plannedAttempts,
  TASK_MODELS,
} from "../../../supabase/functions/_shared/aiProvider.ts";
import { loadConversationMemory } from "../../../supabase/functions/_shared/memoryReader.ts";
import { getCompiledCompanyBrainForWorkspace } from "../../../supabase/functions/_shared/getCompiledCompanyBrainForWorkspace.ts";
import { installStrictNetwork } from "../_helpers/strictNetwork.ts";
Deno.env.set("SEND_SCHEDULED_EMAILS_IMPORT_ONLY", "1");
const { handleSendScheduledEmails } = await import(
  "../../../supabase/functions/send-scheduled-emails/index.ts"
);
const emit = (id: string, evidence: unknown) =>
  console.log(
    "OUTPOST_AUDIT " +
      JSON.stringify({
        id,
        evidence,
        scope: "offline-real-code/mock-external-boundaries",
      }),
  );
const strict = Deno.env.get("OUTPOST_ASSERT_EXPECTATIONS") === "1";
function env(overrides: Record<string, string | undefined>) {
  const old = Object.fromEntries(
    Object.keys(overrides).map((k) => [k, Deno.env.get(k)]),
  );
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  return () => {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };
}
Deno.test("outpost M01: requested provider does not control actual generic agent transport", async () => {
  const restore = env({
    ANTHROPIC_API_KEY: "synthetic-anthropic",
    OPENAI_API_KEY: "synthetic-openai",
  });
  const oldFetch = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(input), model: body.model });
    assertEquals(new URL(String(input)).host, "api.anthropic.com");
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: '{"brief":"synthetic"}' }],
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    for (const preferredProvider of ["openai", "anthropic"] as const) {
      const r = await generateText({
        taskType: "agent_execution",
        preferredProvider,
        messages: [{ role: "user", content: "Synthetic call brief" }],
        onModelCall: () => {},
      });
      assert(r.ok);
      emit("M01", {
        requested: preferredProvider,
        actual: r.provider,
        model: r.model,
      });
      assertEquals(r.provider, "anthropic");
      if (strict) {
        assertEquals(
          r.provider,
          preferredProvider,
          "explicit selected provider should reach transport",
        );
      }
    }
    assertEquals(calls.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    restore();
  }
});
Deno.test("outpost M02: absent required credential fails without paid fallback", async () => {
  const restore = env({
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: "synthetic",
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("no transport allowed");
  }) as typeof fetch;
  try {
    const r = await generateText({ taskType: "agent_execution", messages: [] });
    assertEquals(r.ok, false);
    assertEquals(r.errorCode, "no_provider_for_task");
    emit("M02", {
      errorCode: r.errorCode,
      attempts: plannedAttempts("agent_execution", (v) => v === "openai"),
    });
  } finally {
    globalThis.fetch = oldFetch;
    restore();
  }
});
Deno.test("outpost M03: declared helper fallback normalized with telemetry", async () => {
  const restore = env({
    ANTHROPIC_API_KEY: "synthetic",
    OPENAI_API_KEY: "synthetic",
  });
  const oldFetch = globalThis.fetch;
  const telemetry: any[] = [];
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const host = new URL(String(input)).host;
    calls.push(host);
    return host === "api.anthropic.com"
      ? new Response('{"error":"synthetic outage"}', { status: 503 })
      : new Response(
        JSON.stringify({
          choices: [{ message: { content: "synthetic helper" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 },
      );
  }) as typeof fetch;
  try {
    const r = await generateText({
      taskType: "helper",
      messages: [{ role: "user", content: "synthetic" }],
      onModelCall: (t, ok) => telemetry.push({ t, ok }),
    });
    assert(r.ok);
    assertEquals(r.provider, "openai");
    assertEquals(r.degraded, true);
    assertEquals(telemetry.length, 2);
    emit("M03", {
      calls,
      provider: r.provider,
      model: r.model,
      degraded: r.degraded,
      telemetry,
    });
  } finally {
    globalThis.fetch = oldFetch;
    restore();
  }
});
Deno.test("outpost M04: current task policy contains no Gemini transport", () => {
  assert(
    Object.values(TASK_MODELS).every((p) => p.vendor !== ("google" as any)),
  );
  emit("M04", TASK_MODELS);
});
Deno.test("outpost I01: canonical Brain loader rejects another workspace", async () => {
  const accesses: string[] = [];
  const db: any = {
    from: (_table: string) => ({
      select: () => ({
        eq: (_k: string, ws: string) => ({
          eq: (_k2: string, user: string) => ({
            maybeSingle: async () => ({
              data: user === `member-${ws}` ? { workspace_id: ws } : null,
            }),
          }),
          maybeSingle: async () => {
            accesses.push(ws);
            return {
              data: {
                profile: {
                  company: {
                    name: `Seller-${ws}`,
                    description: `Synthetic seller ${ws}`,
                  },
                  target_customer: { industries: [`industry-${ws}`] },
                },
              },
            };
          },
        }),
      }),
    }),
  };
  const forbidden = await getCompiledCompanyBrainForWorkspace(db, "B", {
    userId: "member-A",
  });
  assertEquals(forbidden.error, "forbidden");
  assertEquals(accesses, []);
  const a = await getCompiledCompanyBrainForWorkspace(db, "A", {
    userId: "member-A",
  });
  const b = await getCompiledCompanyBrainForWorkspace(db, "B", {
    userId: "member-B",
  });
  assert(a.ok && b.ok);
  assert(!JSON.stringify(a.brain).includes("Seller-B"));
  assert(!JSON.stringify(b.brain).includes("Seller-A"));
  emit("I01", {
    forbidden: forbidden.error,
    accesses,
    workspaceA: a.brain?.workspace_id,
    workspaceB: b.brain?.workspace_id,
  });
});
Deno.test("outpost I02: fresh conversation receives other client's workspace draft", async () => {
  const queries: any[] = [];
  const db: any = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        in: () => q,
        then: (resolve: any) => {
          queries.push({ table, filters });
          return Promise.resolve({
            data: table === "outreach_drafts"
              ? [{
                id: "draft-client-A",
                channel: "email",
                body: "CLIENT_A_PRIVATE_VOICE",
                status: "draft",
              }]
              : [],
          }).then(resolve);
        },
      };
      return q;
    },
  };
  const memory = await loadConversationMemory({
    admin: db,
    workspace_id: "agency",
    conversation_id: "client-B-conversation",
  });
  assertEquals(memory.has_any_memory, false);
  assertEquals(memory.outreach_drafts.length, 1);
  assert(JSON.stringify(memory).includes("CLIENT_A_PRIVATE_VOICE"));
  emit("I02", {
    queries,
    memory,
    meaning:
      "same-workspace cross-client context exposure, not cross-workspace RLS bypass",
  });
  if (strict) {
    assertEquals(
      memory.outreach_drafts.length,
      0,
      "different client draft must not enter context",
    );
  }
});
const email = (
  id = "11111111-1111-4111-8111-111111111111",
  user_id = "user-A",
) => ({
  id,
  user_id,
  status: "pending",
  send_time_utc: "2020-01-01T00:00:00Z",
  candidate_email: "synthetic@example.invalid",
  subject: "Synthetic",
  content: "Synthetic body",
});
const request = () =>
  new Request("https://agentory.invalid/send-scheduled-emails", {
    method: "POST",
    headers: { Authorization: "Bearer token-A" },
  });
function mailNet(rows: any[] = [email()]) {
  return installStrictNetwork({
    users: { "token-A": "user-A" },
    tables: { scheduled_emails: rows },
    env: { RESEND_API_KEY: "synthetic-only" },
    externals: {
      "api.resend.com": () => ({ body: { id: "synthetic-provider-id" } }),
    },
  });
}
Deno.test("outpost R01: parallel scheduled-email requests duplicate a send", async () => {
  const n = mailNet();
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((r) => release = r);
  const mockFetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = input instanceof Request
      ? input.method
      : init?.method ?? "GET";
    const result = await n.fetch(input, init);
    if (url.includes("/rest/v1/scheduled_emails") && method === "GET") {
      if (++reads === 2) release();
      await bothRead;
    }
    return result;
  }) as typeof fetch;
  const results = await Promise.all([
    handleSendScheduledEmails(request(), { env: n.env, fetch: mockFetch }),
    handleSendScheduledEmails(request(), { env: n.env, fetch: mockFetch }),
  ]);
  assertEquals(results.map((r) => r.status), [200, 200]);
  assertEquals(n.external.length, 2);
  emit("R01", {
    acceptedVendorCalls: n.external.length,
    finalRows: n.tables.scheduled_emails,
    log: n.log,
  });
  if (strict) {
    assertEquals(
      n.external.length,
      1,
      "one email must produce one vendor send",
    );
  }
});
Deno.test("outpost R02: accepted send plus failed DB update reports success and resends", async () => {
  const n = mailNet();
  const mockFetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = input instanceof Request
      ? input.method
      : init?.method ?? "GET";
    if (url.includes("/rest/v1/scheduled_emails") && method === "PATCH") {
      return new Response(
        '{"code":"synthetic-write-failed","message":"synthetic failure"}',
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    return n.fetch(input, init);
  }) as typeof fetch;
  const bodies = [];
  for (let i = 0; i < 2; i++) {
    const r = await handleSendScheduledEmails(request(), {
      env: n.env,
      fetch: mockFetch,
    });
    bodies.push(await r.json());
  }
  assertEquals(n.external.length, 2);
  assertEquals(n.tables.scheduled_emails[0].status, "pending");
  assertEquals(bodies[0].sent, 1);
  emit("R02", {
    responses: bodies,
    acceptedVendorCalls: n.external.length,
    storedStatus: n.tables.scheduled_emails[0].status,
  });
  if (strict) {
    assertEquals(
      n.external.length,
      1,
      "uncertain persistence must not repurchase a send",
    );
  }
});
Deno.test("outpost R03: scheduled sender only reads authenticated user's emails", async () => {
  const n = mailNet([
    email(),
    email("22222222-2222-4222-8222-222222222222", "user-B"),
  ]);
  const r = await handleSendScheduledEmails(request(), {
    env: n.env,
    fetch: n.fetch,
  });
  assertEquals(r.status, 200);
  assertEquals(n.external.length, 1);
  assertEquals(n.tables.scheduled_emails[1].status, "pending");
  emit("R03", {
    sends: n.external.length,
    otherUserStatus: n.tables.scheduled_emails[1].status,
  });
});
Deno.test("outpost R04: unauthenticated scheduled send invokes no provider", async () => {
  const n = mailNet();
  const r = await handleSendScheduledEmails(
    new Request("https://agentory.invalid/send"),
    { env: n.env, fetch: n.fetch },
  );
  assertEquals(r.status, 401);
  assertEquals(n.external.length, 0);
  assertEquals(n.tables.scheduled_emails[0].status, "pending");
  emit("R04", { status: r.status, providerCalls: 0 });
});

Deno.env.set("APPROVE_AND_CONTINUE_IMPORT_ONLY", "1");
const { handleApproveAndContinue } = await import(
  "../../../supabase/functions/approve-and-continue/index.ts"
);
Deno.test("outpost A01: failed downstream dispatch is reported continuing and cannot retry approval", async () => {
  const approvalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const n = installStrictNetwork({
    users: { "token-A": "user-A" },
    tables: {
      approvals: [{
        id: approvalId,
        workspace_id: "agency",
        task_plan_id: "plan",
        agent_id: "agent",
        status: "pending",
        payload: {
          next_step: {
            step_index: 1,
            agent_id: "agent",
            agent_name: "Synthetic",
            instruction: "synthetic",
          },
        },
      }],
      workspace_members: [{
        workspace_id: "agency",
        user_id: "user-A",
        role: "owner",
      }],
      activity_feed: [],
      task_plans: [{
        id: "plan",
        workspace_id: "agency",
        status: "awaiting_approval",
      }],
    },
  });
  let dispatches = 0;
  const f = (async (input: any, init?: RequestInit) => {
    if (
      String(input instanceof Request ? input.url : input).includes(
        "/functions/v1/run-agent",
      )
    ) {
      dispatches++;
      return new Response('{"error":"synthetic downstream unavailable"}', {
        status: 503,
      });
    }
    return n.fetch(input, init);
  }) as typeof fetch;
  const req = () =>
    new Request("https://audit.invalid/approve", {
      method: "POST",
      headers: {
        Authorization: "Bearer token-A",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ approval_id: approvalId, action: "approve" }),
    });
  const a = await handleApproveAndContinue(req(), { env: n.env, fetch: f });
  const b = await handleApproveAndContinue(req(), { env: n.env, fetch: f });
  const bodies = [await a.json(), await b.json()];
  assertEquals(a.status, 200);
  assertEquals(bodies[0].status, "continuing");
  assertEquals(n.tables.approvals[0].status, "approved");
  assertEquals(bodies[1].already_settled, true);
  assertEquals(dispatches, 1);
  emit("A01", {
    responses: bodies,
    downstreamStatus: 503,
    dispatches,
    approvalState: n.tables.approvals[0].status,
    meaning:
      "approval survives but no durable dispatch/retry receipt is created by this handler",
  });
  if (strict) {
    assertEquals(
      bodies[0].status,
      "dispatch_pending",
      "failed transport must not report continuing",
    );
  }
});
