// PART 9 — local development can never silently reach production.
// ZERO network, ZERO model calls, ZERO secrets in any assertion.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveEnvironmentGate, environmentBadge, containsSecret } from "./environmentGate.ts";

const TEST_URL = "https://zbwsbnqqpkvdhqwavjke.supabase.co";
const PROD_URL = "https://wqnigjhcwjxtmordrwno.supabase.co";
// Deliberately not a real key — only its SHAPE matters for the leak assertion.
const FAKE_KEY = "eyJhbGciOiJIUzI1NiJ9.ZmFrZQ.ZmFrZQ";

Deno.test("missing local env → blocking configuration screen", () => {
  const g = resolveEnvironmentGate({ DEV: true });
  assertEquals(g.status, "blocked");
  assertEquals(g.title, "Supabase is not configured for local development");
  assert(g.message!.includes("Refusing to start against PRODUCTION"));
  assert(g.instructions.some((i) => i.includes(".env.local")));
  assert(g.instructions.some((i) => i.includes("VITE_SUPABASE_URL")));
});

Deno.test("local development never silently defaults to the production project", () => {
  const g = resolveEnvironmentGate({ DEV: true });
  assertEquals(g.projectRef, null, "no production ref may be resolved implicitly");
  assertEquals(g.environment, "unknown");
  assertFalse(JSON.stringify(g).includes("wqnigjhcwjxtmordrwno"));
});

Deno.test("a URL without a key is also blocked", () => {
  const g = resolveEnvironmentGate({ DEV: true, VITE_SUPABASE_URL: TEST_URL });
  assertEquals(g.status, "blocked");
  assertEquals(g.title, "Supabase publishable key is missing");
});

Deno.test("TEST URL → TEST badge", () => {
  const g = resolveEnvironmentGate({ DEV: true, VITE_SUPABASE_URL: TEST_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY });
  assertEquals(g.status, "ok");
  assertEquals(g.environment, "test");
  assertEquals(g.badge, "TEST — zbwsbnqqpkvdhqwavjke");
});

Deno.test("an explicit local PRODUCTION target boots but is loudly labelled", () => {
  const g = resolveEnvironmentGate({ DEV: true, VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY });
  assertEquals(g.status, "ok");
  assertEquals(g.environment, "production");
  assert(g.badge!.startsWith("PRODUCTION"), g.badge!);
});

Deno.test("a production build behaves exactly as before and shows no badge", () => {
  const g = resolveEnvironmentGate({ DEV: false });
  assertEquals(g.status, "ok");
  assertEquals(g.environment, "production");
  assertEquals(g.badge, null, "the TEST badge must never appear in a production build");
});

Deno.test("an unknown non-production project is labelled, not silently trusted", () => {
  const g = resolveEnvironmentGate({ DEV: true, VITE_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY });
  assertEquals(g.environment, "unknown");
  assertEquals(g.badge, "NON-PRODUCTION — abcdefghijklmnop");
});

Deno.test("no secret can reach the rendered output", () => {
  for (const env of [
    { DEV: true },
    { DEV: true, VITE_SUPABASE_URL: TEST_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY },
    { DEV: false, VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: FAKE_KEY },
  ]) {
    const g = resolveEnvironmentGate(env);
    const rendered = [g.badge, g.title, g.message, ...g.instructions].filter(Boolean).join(" ");
    assertFalse(containsSecret(rendered), `rendered output leaked a secret-shaped value: ${rendered}`);
    assertFalse(rendered.includes(FAKE_KEY));
  }
  // The detector itself must actually detect.
  assert(containsSecret(FAKE_KEY));
});

Deno.test("environmentBadge is null only for production", () => {
  assertEquals(environmentBadge("production", "wqnigjhcwjxtmordrwno"), null);
  assert(environmentBadge("test", "zbwsbnqqpkvdhqwavjke") !== null);
  assert(environmentBadge("unknown", null) !== null);
});
