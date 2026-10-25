// Test-tool conformance, not application authorization acceptance.
// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nativeEffectFence } from "../outpost-native/lib/nativeEffectFence.ts";
const origin = "http://127.0.0.1:12345";
Deno.test("effect fence: configuration cannot authorize a provider, tunnel hostname or implicit port", () => {
  for (
    const value of [
      "https://api.openai.com",
      "http://example.com:12345",
      "http://localhost",
      origin + "/path",
      origin + "/?token=secret",
    ]
  ) {
    assertThrows(() => nativeEffectFence([value], fetch), Error);
  }
  assertThrows(() => nativeEffectFence([], fetch), Error);
  const invalid = assertThrows(
    () => nativeEffectFence(["invalid-secret-config"], fetch),
    Error,
  );
  assertEquals(invalid.message.includes("secret"), false);
});
Deno.test("effect fence: permitted local request preserves body, headers and real response", async () => {
  const result = new Response("native response");
  const f = nativeEffectFence([origin], async (input) => {
    const r = input as Request;
    assertEquals(r.headers.get("authorization"), "Bearer synthetic");
    assertEquals(await r.text(), "synthetic payload");
    return result;
  });
  assertStrictEquals(
    await f.fetch(origin + "/rest/v1/contacts", {
      method: "POST",
      headers: { authorization: "Bearer synthetic" },
      body: "synthetic payload",
    }),
    result,
  );
  assertEquals(f.snapshot().map((e) => e.kind), ["local_request"]);
  f.close();
});
Deno.test("effect fence: external and unrelated local ports never reach delegate, even after caught errors", async () => {
  let delegated = 0;
  const f = nativeEffectFence([origin], () => {
    delegated++;
    return Promise.resolve(new Response());
  });
  for (
    const url of [
      "https://api.openai.com/v1/chat/completions",
      "https://unknown-provider.example/purchase",
      "http://127.0.0.1:12346/send",
    ]
  ) {
    try {
      await f.fetch(url);
    } catch { /* handler may swallow; evidence must persist */ }
  }
  assertEquals(delegated, 0);
  assertEquals(
    f.snapshot().map((e) => e.kind),
    Array(3).fill("external_attempt"),
  );
  f.close();
});
Deno.test("effect fence: redirects are errors, never implicit external fetches", async () => {
  const f = nativeEffectFence([origin], (input) => {
    assertEquals((input as Request).redirect, "error");
    return Promise.resolve(new Response());
  });
  await f.fetch(origin + "/auth/v1/user");
  f.close();
});
Deno.test("effect fence: already cancelled requests produce evidence without native work", async () => {
  let delegated = 0;
  const f = nativeEffectFence([origin], () => {
    delegated++;
    return Promise.resolve(new Response());
  });
  await assertRejects(
    () => f.fetch(origin, { signal: AbortSignal.abort() }),
    DOMException,
    "aborted",
  );
  assertEquals(delegated, 0);
  assertEquals(f.snapshot()[0].kind, "cancelled");
  f.close();
});
Deno.test("effect fence: closing aborts pending work and refuses detached late attempts", async () => {
  let began!: () => void;
  const started = new Promise<void>((resolve) => began = resolve);
  const f = nativeEffectFence(
    [origin],
    (input) =>
      new Promise((_resolve, reject) => {
        const r = input as Request;
        r.signal.addEventListener(
          "abort",
          () => reject(new DOMException("scope aborted", "AbortError")),
          { once: true },
        );
        began();
      }),
  );
  const pending = f.fetch(origin);
  await started;
  const cancelled = assertRejects(() => pending, DOMException, "aborted");
  f.close();
  await cancelled;
  await assertRejects(() => f.fetch(origin), Error, "scope closed");
  assertEquals(f.snapshot().map((e) => e.kind), [
    "local_request",
    "after_scope",
  ]);
});
Deno.test("effect fence: evidence is immutable and contains no URL paths, secrets or payloads", async () => {
  const f = nativeEffectFence([origin], () => Promise.resolve(new Response()));
  await f.fetch(origin + "/private-secret-path?token=secret-query", {
    method: "POST",
    headers: { authorization: "secret-header" },
    body: "secret-body",
  });
  const snapshot = f.snapshot();
  assertEquals(JSON.stringify(snapshot).includes("secret"), false);
  assertThrows(
    () => (snapshot as unknown as { kind: string }[])[0].kind = "hidden",
    TypeError,
  );
  assertEquals(f.snapshot()[0].kind, "local_request");
  f.close();
});
Deno.test("effect fence: invalid URLs cannot erase attempted-operation evidence", async () => {
  const f = nativeEffectFence([origin], fetch);
  await assertRejects(() => f.fetch("not-a-url"), Error, "invalid request");
  assertEquals(f.snapshot(), [{
    kind: "invalid_request",
    method: "UNKNOWN",
    origin: null,
  }]);
  f.close();
});
