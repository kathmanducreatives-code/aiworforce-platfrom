// The page side of client Brains (Phase 3c, held): the scope is explicit and
// never carried across workspaces or clients; the request names its Brain and
// its version; a save's answer never loses what the user typed. The same
// modules drive the real handler in tests/db-contract/brainAutosaveEndToEnd.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENCY_SCOPE, brainScopeBody, brainScopeKey, clientBrainsUiEnabled, clientScope, nextBrainScope, sameBrainScope } from "../../src/lib/brainScope.ts";
import { buildProgressSaveBody, readProgressSaveResponse } from "../../src/lib/brainProgressRequest.ts";
import { applyProgressSaveResult, type ProgressCopy } from "../../src/lib/onboardingAutosave.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";

Deno.test("scope: off unless VITE_CLIENT_BRAINS is exactly 'true'; only a well-formed id is a client", () => {
  assertEquals(clientBrainsUiEnabled({}), false);
  assertEquals(clientBrainsUiEnabled({ VITE_CLIENT_BRAINS: "1" }), false);
  assertEquals(clientBrainsUiEnabled({ VITE_CLIENT_BRAINS: "true" }), true);
  assertEquals(clientScope(A), { kind: "client", clientId: A });
  for (const bad of [null, "", "first", 7, "latest"]) assertEquals(clientScope(bad), null);
});

Deno.test("scope: switching", () => {
  const listed = [A, B];
  let s = { workspaceId: WS, scope: AGENCY_SCOPE };
  s = nextBrainScope(s, { pickClient: A, listed });
  assertEquals(s.scope, { kind: "client", clientId: A });
  assertEquals(nextBrainScope(s, { pickClient: "44444444-4444-4444-8444-444444444444", listed }), s, "an unlisted client changes nothing");
  assertEquals(nextBrainScope(s, { pickClient: null, listed }).scope, AGENCY_SCOPE, "back to the agency Brain");
  assertEquals(nextBrainScope(s, { workspaceId: WS }), s, "same workspace keeps the selection");
  const moved = nextBrainScope(s, { workspaceId: "55555555-5555-4555-8555-555555555555" });
  assertEquals(moved.scope, AGENCY_SCOPE, "a client never crosses workspaces");
  assert(sameBrainScope(clientScope(A)!, clientScope(A)!));
  assert(!sameBrainScope(clientScope(A)!, clientScope(B)!));
  assert(!sameBrainScope(clientScope(A)!, AGENCY_SCOPE));
  const keys = new Set([brainScopeKey(WS, AGENCY_SCOPE), brainScopeKey(WS, clientScope(A)!), brainScopeKey(WS, clientScope(B)!)]);
  assertEquals(keys.size, 3, "every Brain buffers its own unsaved text");
});

Deno.test("request: the agency body is today's body; a client body names the client and its integer version", () => {
  const answers = { company: { name: "X" } };
  const agency = buildProgressSaveBody({ workspaceId: WS, step: 2, answers, expectedUpdatedAt: "2026-10-24T10:00:00+00:00" });
  assertEquals(agency, { action: "save_draft", workspace_id: WS, patch: {}, change_origin: "onboarding_seller_confirmation",
    setup: { step: 2, answers }, expected_updated_at: "2026-10-24T10:00:00+00:00" });
  assertEquals(brainScopeBody(AGENCY_SCOPE), {});
  const client = buildProgressSaveBody({ workspaceId: WS, step: 2, answers, expectedUpdatedAt: "4", scope: clientScope(A)! });
  assertEquals(client.scope, "client"); assertEquals(client.client_id, A); assertEquals(client.expected_version, 4);
  assert(!("expected_updated_at" in client));
  assertEquals(buildProgressSaveBody({ workspaceId: WS, step: 0, answers: {}, expectedUpdatedAt: null, scope: clientScope(A)! }).expected_version, null);
});

Deno.test("response: either scope maps to saved / stale / failed with an opaque version", () => {
  assertEquals(readProgressSaveResponse({ ok: true, updated_at: "t2" }), { kind: "saved", updatedAt: "t2" });
  assertEquals(readProgressSaveResponse({ ok: true, version: 5 }), { kind: "saved", updatedAt: "5" });
  assertEquals(readProgressSaveResponse({ ok: false, rejected_reason: "stale", current_version: 6, profile: { a: 1 } }),
    { kind: "stale", serverProfile: { a: 1 }, currentUpdatedAt: "6" });
  assertEquals(readProgressSaveResponse({ error: "client_forbidden", reason: "no_grant" }).kind, "failed");
  assertEquals(readProgressSaveResponse(null, "network").kind, "failed");
});

Deno.test("save result: stale without the server's copy keeps every typed field (regression)", () => {
  const base: ProgressCopy = { step: 1, answers: { company: { name: "Old", description: "base" } }, updated_at: "" };
  const mine: ProgressCopy = { step: 1, answers: { company: { name: "Mine", description: "base" } }, updated_at: "" };
  const r = applyProgressSaveResult({ version: "t1", base }, mine, { kind: "stale", serverProfile: null, currentUpdatedAt: null });
  assertEquals(r.restore, null, "nothing restored over the user's answers");
  assertEquals(r.conflicts, []);
  assertEquals(r.base, base);
  assertEquals(r.version, null, "the next save fetches the current copy");
  const failed = applyProgressSaveResult({ version: "t1", base }, mine, { kind: "failed", message: "no_grant" });
  assertEquals([failed.version, failed.base, failed.restore, failed.status], ["t1", base, null, "offline"]);
  const saved = applyProgressSaveResult({ version: "t1", base }, mine, { kind: "saved", updatedAt: "t2" });
  assertEquals([saved.version, saved.base], ["t2", mine]);
  assertNotEquals(saved.base, base);
});
