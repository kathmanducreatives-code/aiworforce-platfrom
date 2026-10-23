// Disposable GoTrue-only helpers. Authentication is actual HTTP; no fabricated Auth user result.
// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sql } from "../../db-contract/lib/harness.ts";
import { fixture } from "../fixture.ts";
export const authUrl = Deno.env.get("OUTPOST_NATIVE_AUTH_URL")!;
if (!authUrl || new URL(authUrl).hostname !== "127.0.0.1") {
  throw new Error("actual GoTrue lane requires its own loopback Auth server");
}
export const password = "Synthetic-offline-only-72491!";
export async function auth(path: string, body?: unknown, token?: string) {
  const r = await fetch(authUrl + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.text() };
}
export async function login() {
  const signup = await auth("/signup", {
    email: `native-${crypto.randomUUID()}@synthetic.example`,
    password,
  });
  assertEquals(
    signup.status,
    200,
    "local auto-confirmed signup must succeed without sending mail",
  );
  const session = JSON.parse(signup.body);
  assert(typeof session.access_token === "string");
  const payload = session.access_token.split(".")[1].replaceAll("-", "+")
    .replaceAll("_", "/");
  const claims = JSON.parse(atob(payload));
  assert(typeof claims.session_id === "string");
  const x = await fixture({
    userId: session.user.id,
    sessionId: claims.session_id,
  });
  assertEquals(
    (await sql`select user_id::text u from auth.sessions where id=${x.sa}`)[0]
      .u,
    x.ua,
  );
  return { x, session };
}
