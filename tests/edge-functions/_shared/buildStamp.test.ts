// "WHAT COMMIT IS PRODUCTION RUNNING?" must have an answer on every critical surface.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BUILD_HEADER, buildHeaderValue, buildInfo, withBuildStamp } from "../../../supabase/functions/_shared/buildStamp.ts";
import { BUILD } from "../../../supabase/functions/_shared/buildStamp.generated.ts";
import { healthView, newStatus } from "../../../worker/health.ts";

Deno.test("the committed stamp is the unstamped default — a deploy stamp is never committed", () => {
  assertEquals(BUILD, { sha: "unstamped", built_at: "unknown" });
});

Deno.test("unstamped falls back to Railway's injected commit, else says 'unstamped' instead of guessing", () => {
  assertEquals(buildInfo(() => undefined), { sha: "unstamped", built_at: "unknown", source: "none" });
  assertEquals(buildInfo((k) => (k === "RAILWAY_GIT_COMMIT_SHA" ? "abc123" : undefined)).sha, "abc123");
});

Deno.test("every response carries the build header — including a refusal and a preflight — and CORS exposes it", async () => {
  const info = { sha: "deadbeef", built_at: "2026-09-28T00:00:00Z", source: "stamp" };
  const h = withBuildStamp((req) => new Response(req.method === "OPTIONS" ? "ok" : "no", { status: req.method === "OPTIONS" ? 200 : 401 }), info);
  for (const method of ["OPTIONS", "POST"]) {
    const r = await h(new Request("https://x/fn", { method }));
    assertEquals(r.headers.get(BUILD_HEADER), buildHeaderValue(info));
    assert((r.headers.get("Access-Control-Expose-Headers") ?? "").includes(BUILD_HEADER));
  }
});

Deno.test("an immutable response is copied, not dropped", async () => {
  const frozen = Response.redirect("https://example.com/", 302);
  const r = await withBuildStamp(() => frozen, { sha: "s", built_at: "t", source: "stamp" })(new Request("https://x"));
  assertEquals(r.headers.get(BUILD_HEADER), "s@t");
  assertEquals(r.status, 302);
});

Deno.test("the worker's /health reports its build", () => {
  const v = healthView({ status: newStatus(), workerId: "w", gated: true, idlePollMs: 1000, config: {},
    build: { sha: "abc", built_at: "unknown", source: "railway", deployment_id: "dep-1" } });
  assertEquals(v.build.sha, "abc");
  assertEquals(healthView({ status: newStatus(), workerId: "w", gated: true, idlePollMs: 1000, config: {} }).build.sha, "unstamped");
});

Deno.test("every critical edge function is served through the build stamp", async () => {
  for (const fn of ["pilot-chat", "orchestrate", "run-agent", "enqueue-lead-mission", "approve-and-continue",
    "firecrawl-scrape", "send-scheduled-emails", "continue-workflow", "resume-stalled-leads"]) {
    const src = await Deno.readTextFile(new URL(`../../../supabase/functions/${fn}/index.ts`, import.meta.url));
    assert(/Deno\.serve\(withBuildStamp\(/.test(src), `${fn} is not stamped`);
  }
});
