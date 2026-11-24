// Stage 3 (Option E): the signed approval token. The client is never trusted: anything it
// alters fails verification, before any provider call.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planSigner, PLAN_TOKEN_TTL_MS } from "../../../../supabase/functions/_shared/leadPipeline/planToken.ts";

const NOW = new Date("2026-11-02T12:00:00Z");
const P = {
  workspaceId: "ws-1", walkId: "walk-1", plannedBy: "u-member", planHash: "a".repeat(64), query: "Find 3 US companies hiring Account Executives.", requestedCount: 3,
  replay: { proposal: { geography_scope: "headquarters" }, brain: { status: "absent", fields: [], context: null }, advice: null },
};
const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)));

Deno.test("a token round-trips and binds workspace, hash and expiry", async () => {
  const s = await planSigner("server-secret-0123456789abcdef");
  const t = await s.sign(P, NOW);
  const v = await s.verify(t, { workspaceId: "ws-1", planHash: P.planHash, walkId: "walk-1" }, NOW);
  assert(v.ok);
  if (v.ok) {
    assertEquals(v.payload.replay, P.replay);
    assertEquals(v.payload.expiresAt - v.payload.issuedAt, PLAN_TOKEN_TTL_MS);
  }
});

Deno.test("tampering, another key, expiry, another workspace or hash: refused with a reason", async () => {
  const s = await planSigner("server-secret-0123456789abcdef");
  const t = await s.sign(P, NOW);
  const [body, sig] = t.split(".");
  const reason = async (token: string, expect = { workspaceId: "ws-1", planHash: P.planHash, walkId: "walk-1" }, now = NOW) => {
    const v = await s.verify(token, expect, now);
    assertFalse(v.ok, token.slice(0, 20));
    return v.ok ? "" : v.reason;
  };
  // The client rewrites the signed interpretation (headquarters → presence): the MAC fails.
  const forged = enc({ ...dec(body), replay: { ...P.replay, proposal: { geography_scope: "presence" } } });
  assert((await reason(`${forged}.${sig}`)).includes("signature"));
  assert((await reason(`${body}.${sig.slice(0, -2)}AA`)).includes("signature"));
  const other = await planSigner("a-different-server-secret-0123");
  assert((await reason(await other.sign(P, NOW))).includes("signature"), "signed with another key");
  assert((await reason(t, undefined, new Date(NOW.getTime() + PLAN_TOKEN_TTL_MS + 1))).includes("expired"));
  assert((await reason(t, { workspaceId: "ws-2", planHash: P.planHash, walkId: "walk-1" })).includes("another workspace"));
  assert((await reason(t, { workspaceId: "ws-1", planHash: "b".repeat(64), walkId: "walk-1" })).includes("different plan"));
  assert((await reason(t, { workspaceId: "ws-1", planHash: P.planHash, walkId: "walk-2" })).includes("another walk"), "one approval, one walk");
  for (const bad of ["", "x", "a.b.c", `${body}`]) assert((await reason(bad)).includes("malformed"), JSON.stringify(bad));
});

Deno.test("a signer needs a real server secret", async () => {
  let threw = false;
  try { await planSigner(""); } catch { threw = true; }
  assert(threw);
});
