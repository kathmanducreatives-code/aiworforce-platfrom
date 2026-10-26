// effectFence.ts, pure: what the live-principal fence lets through, what it
// re-checks, and how it refuses. The database is a scripted membership read.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindEffectPrincipal, createEffectFence, effectScope, type EffectPrincipalDb, installEffectFence,
} from "../../../supabase/functions/_shared/effectFence.ts";

const OWN = new URL("https://proj.supabase.co");
function membership(answers: Array<"member" | "absent" | "error">) {
  const reads: number[] = [];
  const db: EffectPrincipalDb = {
    from: (t) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => {
              assertEquals(t, "workspace_members");
              reads.push(1);
              const a = answers.shift() ?? "absent";
              return Promise.resolve(a === "error" ? { data: null, error: { message: "down" } }
                : { data: a === "member" ? { user_id: "u" } : null, error: null });
            },
          }),
        }),
      }),
    }),
  };
  return { db, reads };
}
function transport() {
  const sent: string[] = [];
  const base: typeof fetch = (input, init) => {
    sent.push(`${(init?.method ?? "GET").toUpperCase()} ${String(input)}`);
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  return { base, sent };
}
async function inRun<T>(db: EffectPrincipalDb | null, fn: () => Promise<T>): Promise<T> {
  return await effectScope.run({ principal: null }, async () => {
    if (db) bindEffectPrincipal({ db, workspaceId: "ws", userId: "u" });
    return await fn();
  });
}
const quiet = () => {};
const model = (f: typeof fetch) => f("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" });
const apifyStart = (f: typeof fetch) => f("https://api.apify.com/v2/acts/harvestapi~linkedin-company/runs", { method: "POST", body: "{}" });

Deno.test("fence: outside a run, or before the guard binds a principal, nothing is checked", async () => {
  const t = transport(), m = membership([]);
  const f = createEffectFence(t.base, OWN, quiet);
  await model(f);
  await effectScope.run({ principal: null }, () => model(f));
  assertEquals([t.sent.length, m.reads.length], [2, 0]);
});

Deno.test("fence: a removed principal starts no model call and no purchase; the refusal is the admission shape", async () => {
  const t = transport(), m = membership(["absent", "absent"]);
  const f = createEffectFence(t.base, OWN, quiet);
  const [mr, pr] = await inRun(m.db, async () => [await model(f), await apifyStart(f)]);
  assertEquals(t.sent, [], "nothing was sent");
  assertEquals(mr.status, 409, "a model refusal is a definite non-start");
  assertEquals((await mr.json()).error, { type: "mission_admission_refused", decision: "principal_not_member",
    detail: { host: "api.openai.com", path: "/v1/chat/completions" }, purchase_may_exist: false,
    message: "mission admission refused: principal_not_member" });
  assertEquals(pr.status, 503, "a provider refusal never reads as a definite non-start (R1: no early refund)");
  assertEquals((await pr.json()).error.purchase_may_exist, true);
});

Deno.test("fence: settlement passes without a check — own REST, reads of an admitted run, its dataset, its abort", async () => {
  const t = transport(), m = membership([]);
  const f = createEffectFence(t.base, OWN, quiet);
  await inRun(m.db, async () => {
    await f("https://proj.supabase.co/rest/v1/tasks?id=eq.1", { method: "PATCH", body: "{}" });
    await f("https://api.apify.com/v2/actor-runs/run-1?waitForFinish=60");
    await f("https://api.apify.com/v2/datasets/ds-1/items?clean=true");
    await f("https://api.apify.com/v2/actor-runs/run-1/abort", { method: "POST" });
    await f("https://api.firecrawl.dev/v2/crawl/c-1");
  });
  assertEquals([t.sent.length, m.reads.length], [5, 0]);
});

Deno.test("fence: live, not cached — every new operation re-reads, and a removal between two calls stops the second", async () => {
  const t = transport(), m = membership(["member", "absent"]);
  const f = createEffectFence(t.base, OWN, quiet);
  const [a, b] = await inRun(m.db, async () => [await model(f), await model(f)]);
  assertEquals([a.status, b.status, m.reads.length, t.sent.length], [200, 409, 2, 1]);
});

Deno.test("fence: unknown hosts and the project's own functions are new operations too; a failed read refuses", async () => {
  const t = transport(), m = membership(["absent", "absent", "error"]);
  const f = createEffectFence(t.base, OWN, quiet);
  const rs = await inRun(m.db, async () => [
    await f("https://ai.gateway.lovable.dev/v1/chat/completions", { method: "POST" }),
    await f("https://proj.supabase.co/functions/v1/run-agent", { method: "POST" }),
    await model(f),
  ]);
  assertEquals(rs.map((r) => r.status), [409, 409, 409]);
  assertEquals((await rs[2].json()).error.decision, "effect_authorization_unavailable", "fails closed");
  assertEquals(t.sent, []);
});

Deno.test("install: once per process, and the transport's marks (the smoke gate's) stay visible on globalThis.fetch", () => {
  const original = globalThis.fetch;
  const MARK = Symbol.for("agentory.smokeAdmissionGate");
  const gate = ((..._a: unknown[]) => Promise.resolve(new Response("{}"))) as unknown as typeof fetch;
  Object.defineProperty(gate, MARK, { value: true });
  try {
    globalThis.fetch = gate;
    installEffectFence("https://proj.supabase.co");
    const once = globalThis.fetch;
    installEffectFence("https://proj.supabase.co");
    assert(once !== gate, "wrapped");
    assertEquals(globalThis.fetch, once, "idempotent");
    assertEquals((globalThis.fetch as unknown as Record<symbol, unknown>)[MARK], true);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("wiring: each guarded entry installs the fence, opens a scope per request and binds its principal after the guard", () => {
  for (const f of ["run-agent", "orchestrate", "run-lead-action"]) {
    const src = Deno.readTextFileSync(new URL(`../../../supabase/functions/${f}/index.ts`, import.meta.url));
    const guard = src.indexOf("legacyExecutionGuard({"), bind = src.indexOf("bindEffectPrincipal({");
    assert(src.includes("installEffectFence();"), `${f}: installs the fence`);
    assert(src.includes("withEffectScope(req,") || src.includes("effectScope.run({ principal: null }"), `${f}: one scope per request`);
    assert(guard > 0 && bind > guard, `${f}: binds the principal after its guard`);
  }
});

Deno.test("scope: each request gets a fresh scope; a re-entry for the same request reuses it, another request never sees its principal", async () => {
  const { withEffectScope } = await import("../../../supabase/functions/_shared/effectFence.ts");
  const m = membership([]);
  const a = {}, b = {};
  const seen: Array<string | null> = [];
  const handler = (req: object, label: string): Promise<void> => {
    const scoped = withEffectScope(req, () => handler(req, label));
    if (scoped) return scoped;
    if (label === "bind") bindEffectPrincipal({ db: m.db, workspaceId: "ws", userId: "u" });
    seen.push(effectScope.getStore()?.principal?.userId ?? null);
    return Promise.resolve();
  };
  await handler(a, "bind");
  await handler(b, "read");
  assertEquals(seen, ["u", null]);
  assertEquals(effectScope.getStore(), undefined, "nothing leaks outside the request");
});

Deno.test("pins (§9.2): a pinned client run also needs the task authorization for exactly its pins, per operation", async () => {
  const seen: unknown[] = [];
  const answers = ["ok", "grant_changed"];
  const m = membership(["member", "member", "member"]);
  const t = transport();
  const f = createEffectFence(t.base, OWN, quiet);
  const pins = { clientId: "c", grantId: "g", generation: 3, permissionRevision: 41, originSessionId: "s" };
  const [a, b] = await effectScope.run({ principal: null }, async () => {
    bindEffectPrincipal({ db: m.db, workspaceId: "ws", userId: "u", pins,
      authorizeTask: (p) => { seen.push(p); return Promise.resolve(answers.shift() ?? "ok"); } });
    return [await model(f), await model(f)];
  });
  assertEquals([a.status, b.status, t.sent.length], [200, 409, 1], "the second operation is refused once the grant changed");
  assertEquals((await b.json()).error.decision, "client_grant_changed");
  assertEquals(seen, [pins, pins], "asked for exactly the pinned authorization, every operation (never re-pinned)");
});

Deno.test("pins: a pinned run fails closed without an authorizer, or when it throws", async () => {
  const m = membership(["member", "member"]);
  const t = transport();
  const f = createEffectFence(t.base, OWN, quiet);
  const pins = { clientId: "c", grantId: "g", generation: 1, permissionRevision: 1, originSessionId: "s" };
  const none = await effectScope.run({ principal: null }, async () => {
    bindEffectPrincipal({ db: m.db, workspaceId: "ws", userId: "u", pins });
    return await model(f);
  });
  const thrown = await effectScope.run({ principal: null }, async () => {
    bindEffectPrincipal({ db: m.db, workspaceId: "ws", userId: "u", pins, authorizeTask: () => Promise.reject(new Error("down")) });
    return await model(f);
  });
  assertEquals([none.status, thrown.status, t.sent.length], [409, 409, 0]);
  assertEquals((await thrown.json()).error.decision, "effect_authorization_unavailable");
});
