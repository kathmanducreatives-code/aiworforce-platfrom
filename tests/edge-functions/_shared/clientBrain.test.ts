// The client Brain server helper (Phase 3c, held): scope resolution never
// falls back, an early refusal sends no request at all, a task must carry its
// pins, the writer is reached only after the read-only check, and an outcome
// the helper does not know is an error — never treated as success. The real
// database behaviour is proven in tests/db-contract/clientCompanyBrain.contract.test.ts.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clientBrainContextForScope, clientBrainRefusal, clientBrainsEnabled, pinClientBrain, readClientBrain,
  resolveBrainScope, writeClientBrain, type ClientBrainRefusal,
} from "../../../supabase/functions/_shared/clientBrain.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const PINS = { grantId: "55555555-5555-4555-8555-555555555555", generation: 2, permissionRevision: "17" };

type Call = { fn: string; args: Record<string, unknown>; get: boolean };
function fakeAdmin(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) {
      calls.push({ fn, args, get: opts?.get === true });
      const a = answers[fn];
      if (a instanceof Error) return Promise.resolve({ data: null, error: { message: a.message } });
      return Promise.resolve({ data: a, error: null });
    },
  };
}
const actor = (over: Record<string, unknown> = {}) => ({ workspaceId: WS, clientId: A, actorId: ACTOR, sessionId: SESSION, ...over });

Deno.test("scope: only an explicit client asks for a client Brain; nothing defaults to one", () => {
  assertEquals(resolveBrainScope({}), { ok: true, scope: { kind: "agency" } });
  assertEquals(resolveBrainScope(null), { ok: true, scope: { kind: "agency" } });
  assertEquals(resolveBrainScope({ scope: "agency" }), { ok: true, scope: { kind: "agency" } });
  assertEquals(resolveBrainScope({ client_id: A }), { ok: true, scope: { kind: "client", clientId: A } });
  assertEquals(resolveBrainScope({ scope: "client", client_id: A }), { ok: true, scope: { kind: "client", clientId: A } });
  for (const missing of [{ scope: "client" }, { scope: "client", client_id: null }, { scope: "client", client_id: "" }]) {
    assertEquals(resolveBrainScope(missing), { ok: false, outcome: "client_context_required" }, JSON.stringify(missing));
  }
  for (const bad of [{ client_id: "first" }, { client_id: 7 }, { scope: "agency", client_id: A }, { scope: "latest" }]) {
    assertEquals(resolveBrainScope(bad as never), { ok: false, outcome: "invalid_scope" }, JSON.stringify(bad));
  }
});

Deno.test("switched off unless COMPANY_BRAIN_CLIENTS_ENABLED is exactly 'true'", () => {
  assertEquals(clientBrainsEnabled(() => undefined), false);
  for (const v of ["1", "TRUE", "yes", ""]) assertEquals(clientBrainsEnabled(() => v), false, v);
  assertEquals(clientBrainsEnabled((k) => k === "COMPANY_BRAIN_CLIENTS_ENABLED" ? "true" : undefined), true);
});

Deno.test("an early refusal sends no request: no client, no session", async () => {
  const admin = fakeAdmin({});
  assertEquals((await readClientBrain(admin, actor({ clientId: null }))).outcome, "client_context_required");
  assertEquals((await writeClientBrain(admin, { ...actor({ sessionId: null }), permission: "edit", mode: "insert", profile: {} })).outcome, "session_invalid");
  assertEquals((await pinClientBrain(admin, actor({ clientId: null }), "edit")).outcome, "client_context_required");
  assertEquals(admin.calls.length, 0);
});

Deno.test("write: the read-only check (GET) first; a refusal there never reaches the writer", async () => {
  const admin = fakeAdmin({ client_brain_authorization: "no_grant" });
  const r = await writeClientBrain(admin, { ...actor(), permission: "edit", mode: "cas", expectedVersion: 3, profile: { a: 1 } });
  assertEquals(r, { outcome: "no_grant", version: null });
  assertEquals(admin.calls.map((c) => [c.fn, c.get]), [["client_brain_authorization", true]]);
  assertEquals(admin.calls[0].args.p_permission, "edit");
  assertEquals(admin.calls[0].args.p_intent, "interactive");
  assert(!("p_pin_grant_id" in admin.calls[0].args), "a GET omits absent pins instead of sending 'null'");
});

Deno.test("write: allowed → the locked writer (POST) with the version it must replace", async () => {
  const admin = fakeAdmin({ client_brain_authorization: "ok", client_brain_authorized_write: [{ outcome: "ok", version: 4 }] });
  const r = await writeClientBrain(admin, { ...actor(), permission: "activate", mode: "cas", expectedVersion: 3, profile: { a: 1 }, activate: true });
  assertEquals(r, { outcome: "ok", version: 4 });
  assertEquals(admin.calls.map((c) => [c.fn, c.get]), [["client_brain_authorization", true], ["client_brain_authorized_write", false]]);
  const w = admin.calls[1].args;
  assertEquals([w.p_permission, w.p_mode, w.p_expected_version, w.p_activate, w.p_client_id], ["activate", "cas", 3, true, A]);
});

Deno.test("write: a refusal at the locked writer (a revocation in between) is returned, not retried", async () => {
  for (const outcome of ["no_grant", "client_archived", "forbidden_role", "not_member", "session_invalid", "grant_changed", "permission_changed", "stale"]) {
    const admin = fakeAdmin({ client_brain_authorization: "ok", client_brain_authorized_write: [{ outcome, version: null }] });
    const r = await writeClientBrain(admin, { ...actor(), permission: "edit", mode: "insert", profile: {} });
    assertEquals(r.outcome, outcome);
    assertEquals(admin.calls.length, 2, "exactly one write attempt");
  }
});

Deno.test("an unknown or missing outcome is an error, never success", async () => {
  await assertRejects(() => writeClientBrain(fakeAdmin({ client_brain_authorization: "maybe" }), { ...actor(), permission: "edit", mode: "insert", profile: {} }));
  await assertRejects(() => writeClientBrain(fakeAdmin({ client_brain_authorization: "ok", client_brain_authorized_write: [{}] }), { ...actor(), permission: "edit", mode: "insert", profile: {} }));
  await assertRejects(() => readClientBrain(fakeAdmin({ client_brain_read: [{ outcome: "fallback", profile: {} }] }), actor()));
  await assertRejects(() => readClientBrain(fakeAdmin({ client_brain_read: new Error("boom") }), actor()));
});

Deno.test("tasks must pin grant, generation and revision; interactive calls must not", async () => {
  const admin = fakeAdmin({ client_brain_read: [{ outcome: "grant_changed" }] });
  await assertRejects(() => readClientBrain(admin, actor({ intent: "task" })), Error, "pins");
  await assertRejects(() => readClientBrain(admin, actor({ pins: PINS })), Error, "pins belong to tasks");
  assertEquals(admin.calls.length, 0);
  assertEquals((await readClientBrain(admin, actor({ intent: "task", pins: PINS }))).outcome, "grant_changed");
  const a = admin.calls[0].args;
  assertEquals([a.p_intent, a.p_pin_grant_id, a.p_pin_generation, a.p_pin_revision], ["task", PINS.grantId, 2, "17"]);
  assert(admin.calls[0].get, "reads are GETs");
});

Deno.test("read: an authorized client with no Brain yet is empty — never another scope's profile", async () => {
  const admin = fakeAdmin({ client_brain_read: [{ outcome: "ok", profile: null, version: null, onboarding_completed: null, updated_at: null }] });
  const r = await readClientBrain(admin, actor());
  assert(r.outcome === "ok");
  assertEquals(r.brain, { profile: null, version: null, onboarding_completed: false, updated_at: null });
  const ctx = await clientBrainContextForScope(admin, { kind: "client", clientId: A }, { workspaceId: WS, actorId: ACTOR, sessionId: SESSION });
  assert(ctx.outcome === "ok"); assertEquals(ctx.profile, {}); assertEquals(ctx.clientId, A);
  const agency = await clientBrainContextForScope(fakeAdmin({}), { kind: "agency" }, { workspaceId: WS, actorId: ACTOR, sessionId: SESSION });
  assertEquals(agency.outcome, "agency_scope");
});

Deno.test("refusals map to 400/401/403; unknown and ungranted clients look the same", () => {
  const all: (ClientBrainRefusal | "invalid_scope")[] = ["session_invalid", "client_context_required", "invalid_scope", "not_member",
    "forbidden_role", "no_grant", "client_archived", "grant_changed", "permission_changed"];
  for (const o of all) {
    const { status } = clientBrainRefusal(o);
    assert([400, 401, 403].includes(status), o);
  }
  assertEquals(clientBrainRefusal("session_invalid").status, 401);
  assertEquals(clientBrainRefusal("client_context_required").status, 400);
  assert(!JSON.stringify(clientBrainRefusal("no_grant").body).includes("not_found"), "never says whether the client exists");
});

// ── Source pins: scopes never cross, and nothing deployed uses this yet ──────
const ROOT = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
function walk(dir: URL, files: string[] = []): string[] {
  for (const e of Deno.readDirSync(dir)) {
    const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) walk(u, files);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(u.pathname);
  }
  return files;
}

Deno.test("I2 (source): the client helper never names the agency Brain, and the agency writer never names a client table", () => {
  const client = read("supabase/functions/_shared/clientBrain.ts").replace(/^\s*\/\/.*$/gm, "");
  for (const s of ["\"company_brain\"", "company_brain_authorized_write", "company_brain_write_authorization", "brainWriter"]) {
    assert(!client.includes(s), `clientBrain.ts names ${s}`);
  }
  const agency = read("supabase/functions/_shared/brainWriter.ts");
  for (const s of ["client_company_brain", "client_brain_", "client_access_grants", "client_accounts"]) {
    assert(!agency.includes(s), `brainWriter.ts names ${s}`);
  }
});

const CLIENT_RPCS = [
  "client_brain_authorization", "client_brain_read", "client_brain_pin", "client_brain_authorized_write",
  "client_account_create", "client_account_archive", "client_access_grant", "client_access_revoke",
  "client_account_manage_list", "client_accounts_for_actor", "client_admin_authorization",
];
Deno.test("held (source): the client RPCs are called only from _shared/clientBrain.ts; only the Brain handlers use it, behind the switch", () => {
  const callers: string[] = [];
  const importers: string[] = [];
  for (const f of walk(new URL("supabase/functions/", ROOT))) {
    const src = Deno.readTextFileSync(f);
    const rel = f.slice(f.indexOf("supabase/functions/"));
    // A CALL of one of the held client functions (a field named client_account_id,
    // e.g. in Backend's pre-effect guard, is not one).
    if (CLIENT_RPCS.some((fn) => new RegExp(`\\.rpc\\(\\s*["']${fn}["']`).test(src))) callers.push(rel);
    if (/from\s+["'][^"']*clientBrain(\.ts)?["']/.test(src)) importers.push(rel);
    assert(!/\.from\(\s*["'](client_company_brain|client_access_grants|client_accounts)["']\s*\)[\s\S]{0,160}\.(insert|update|upsert|delete)\(/.test(src),
      `${rel} writes a client table directly`);
  }
  assertEquals(callers, ["supabase/functions/_shared/clientBrain.ts"]);
  assertEquals(importers.sort(), [
    "supabase/functions/_shared/clientBrainSave.ts",
    "supabase/functions/generate-company-brain-draft/index.ts",
    "supabase/functions/setup-company-brain/index.ts",
  ]);
  // generate-company-brain-draft: a client request is refused unless the switch
  // is on, and it is resolved before any provider/model dependency is built.
  const gen = read("supabase/functions/generate-company-brain-draft/index.ts");
  const at = (needle: string) => { const i = gen.indexOf(needle); assert(i > 0, needle); return i; };
  assert(at("const brainScope = resolveBrainScope(body);") > at("if (!canBrain(role, required))"), "after the role gate");
  assert(at('if (!clientBrainsEnabled((k) => Deno.env.get(k))) return json({ error: "client_brains_disabled" }, 409);') < at("handleClientBrainAction({"));
  assert(at("handleClientBrainAction({") < at("const { deps, apifyReady, firecrawlReady, llmReady, providerMode } = buildDeps();"), "before any provider dependency");
  // setup-company-brain: the wizard never serves a client scope.
  const setup = read("supabase/functions/setup-company-brain/index.ts");
  assert(/if \(brainScope\.scope\.kind === "client"\) return json\(\{ error: "client_scope_not_supported", action \}, 400\);/.test(setup));
  assert(!setup.includes("handleClientBrainAction"), "setup has no client path");
});
