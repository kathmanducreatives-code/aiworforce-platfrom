// The page's client Brain requests (Phase 3c, held): anything the server did
// not clearly answer is a refusal; an answer for another client is never shown;
// the agency edit body is today's body. The same functions drive the actual
// handler in tests/db-contract/brainAutosaveEndToEnd.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildBrainUpdateBody, listBrainClients, loadClientBrain, readBrainUpdateResponse } from "../../src/lib/clientBrainApi.ts";
import { AGENCY_SCOPE, clientScope } from "../../src/lib/brainScope.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const answering = (body: Record<string, unknown> | null) => () => Promise.resolve(body);

Deno.test("list: only well-formed, named clients; off, failed and thrown are not lists", async () => {
  const r = await listBrainClients(answering({ ok: true, clients: [{ client_id: A, name: " Acme " }, { client_id: "x", name: "bad" }, { client_id: B, name: "" }] }), WS);
  assertEquals(r, { kind: "ok", clients: [{ clientId: A, name: "Acme" }] });
  assertEquals((await listBrainClients(answering({ error: "client_brains_disabled" }), WS)).kind, "off");
  assertEquals((await listBrainClients(answering({ error: "forbidden" }), WS)).kind, "failed");
  assertEquals((await listBrainClients(() => Promise.reject(new Error("net")), WS)).kind, "failed");
});

Deno.test("load: the answer must be for the client asked for; refusals keep their reason; anything else is unknown", async () => {
  assertEquals((await loadClientBrain(answering({ ok: true, client_id: A, profile: { a: 1 }, version: 3, onboarding_completed: false }), WS, A)),
    { kind: "ok", row: { profile: { a: 1 }, version: 3, onboarding_completed: false } });
  assertEquals(await loadClientBrain(answering({ ok: true, client_id: B, profile: {} }), WS, A), { kind: "denied", reason: "unknown" });
  for (const reason of ["no_grant", "client_archived", "not_member", "session_invalid"]) {
    assertEquals(await loadClientBrain(answering({ error: "x", reason }), WS, A), { kind: "denied", reason });
  }
  assertEquals(await loadClientBrain(answering({ error: "client_brains_disabled" }), WS, A), { kind: "denied", reason: "disabled" });
  assertEquals(await loadClientBrain(answering(null), WS, A), { kind: "denied", reason: "unknown" });
});

Deno.test("edit body: agency unchanged; a client's first edit creates it; later edits name the integer version", () => {
  assertEquals(buildBrainUpdateBody({ workspaceId: WS, scope: AGENCY_SCOPE, patch: { p: 1 }, expectedVersion: "t1" }),
    { action: "update", workspace_id: WS, patch: { p: 1 }, expected_updated_at: "t1" });
  assertEquals(buildBrainUpdateBody({ workspaceId: WS, scope: clientScope(A)!, patch: { p: 1 }, expectedVersion: null }),
    { action: "save_draft", workspace_id: WS, scope: "client", client_id: A, patch: { p: 1 }, change_origin: "manual_edit", expected_version: null });
  assertEquals(buildBrainUpdateBody({ workspaceId: WS, scope: clientScope(A)!, patch: { p: 1 }, expectedVersion: "4" }),
    { action: "update", workspace_id: WS, patch: { p: 1 }, scope: "client", client_id: A, expected_version: 4 });
});

Deno.test("edit answer: success only with this Brain's version; stale is a conflict; a refusal says leave", () => {
  const a = clientScope(A)!;
  assertEquals(readBrainUpdateResponse(a, { ok: true, client_id: A, version: 5, profile: {} }).version, "5");
  assertEquals(readBrainUpdateResponse(a, { ok: true, client_id: B, version: 5, profile: {} }).ok, false, "another client's answer is not success");
  assertEquals(readBrainUpdateResponse(AGENCY_SCOPE, { ok: true, updated_at: "t2", profile: {} }).version, "t2");
  assertEquals(readBrainUpdateResponse(a, { ok: false, rejected_reason: "stale" }).conflict, true);
  assertEquals(readBrainUpdateResponse(a, { error: "client_forbidden", reason: "no_grant" }).denied, "no_grant");
  assertEquals(readBrainUpdateResponse(AGENCY_SCOPE, { error: "forbidden", reason: "not_member" }).denied, undefined, "agency refusals keep today's handling");
});
