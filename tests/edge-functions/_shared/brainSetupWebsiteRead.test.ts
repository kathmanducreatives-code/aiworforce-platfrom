// COMPANY BRAIN SETUP CAN READ THE WEBSITE AGAIN.
//
// Since b162f700 (2026-05-31) the setup handler called `scrape_url` as agent
// "system", which the tool allows nowhere, so every read was `tool_forbidden`
// and onboarding said "Reading your website: failed". These run the real
// `runTool` against a recording database stand-in (no network, no Firecrawl).

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  readSetupWebsites, SETUP_READ_AGENT, setupReadTargets, type SetupRunTool,
} from "../../../supabase/functions/_shared/brainSetupWebsiteRead.ts";
import { runTool, type ToolContext } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { CREDIT_REFUSED_ERROR } from "../../../supabase/functions/_shared/creditAuthorization.ts";

globalThis.fetch = () => { throw new Error("setup-read tests must not reach the network"); };

const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
const SOURCES = [
  { source_type: "website", url: "https://acme.com" },
  { source_type: "linkedin", url: "https://www.linkedin.com/company/acme" },
  { source_type: "website", url: "https://acme.com/pricing" },
  { source_type: "website", url: "https://acme.com" },          // duplicate
  { source_type: "other", url: "not a url" },
  { source_type: "website", url: "https://acme.com/about" },
  { source_type: "website", url: "https://acme.com/careers" }, // beyond three
];

/** The database stand-in: queries resolve empty, `rpc` is recorded, reserve answers per `creditsOk`. */
function fakeAdmin(creditsOk = true) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const charged = new Set<string>();
  const chain = (): unknown => new Proxy(function () {}, {
    get: (_t, p) => p === "then" ? (res: (v: unknown) => void) => res({ data: null, error: null }) : () => chain(),
    apply: () => chain(),
  });
  return {
    rpcs, charged,
    admin: {
      from: () => chain(),
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args });
        if (fn === "credits_reserve") {
          if (!creditsOk) return Promise.resolve({ data: { ok: false, error: "insufficient_credits", balance: 0, needed: 1 }, error: null });
          const key = String(args.p_idempotency_key);
          const replayed = charged.has(key);
          charged.add(key);
          return Promise.resolve({ data: { ok: true, replayed, transaction_id: `t-${key}`, balance_after: 9 }, error: null });
        }
        return Promise.resolve({ data: { ok: true, settled: true }, error: null });
      },
    },
  };
}

/**
 * No Firecrawl key (nothing can reach the network) and credit enforcement
 * pinned to `enforce` — other suites set `observe`, which lets a refused
 * reservation through, and the suite shares one process environment.
 */
async function withoutFirecrawlKey<T>(f: () => Promise<T>): Promise<T> {
  const prior = Deno.env.get("FIRECRAWL_API_KEY");
  const priorMode = Deno.env.get("LEAD_CREDIT_ENFORCEMENT");
  Deno.env.delete("FIRECRAWL_API_KEY");
  Deno.env.set("LEAD_CREDIT_ENFORCEMENT", "enforce");
  try { return await f(); } finally {
    if (prior !== undefined) Deno.env.set("FIRECRAWL_API_KEY", prior);
    if (priorMode !== undefined) Deno.env.set("LEAD_CREDIT_ENFORCEMENT", priorMode);
    else Deno.env.delete("LEAD_CREDIT_ENFORCEMENT");
  }
}

Deno.test("targets: website pages only — no LinkedIn, no junk, no duplicates, at most three", () => {
  assertEquals(setupReadTargets(SOURCES), ["https://acme.com", "https://acme.com/pricing", "https://acme.com/about"]);
  assertEquals(setupReadTargets([{ url: "https://linkedin.com/in/x" }, { url: "ftp://a.com" }]), []);
});

Deno.test("OLD: as agent 'system' the real tool path refuses every read before any credit", async () => {
  const f = fakeAdmin();
  const r = await withoutFirecrawlKey(() => runTool("scrape_url", { url: "https://acme.com" },
    { admin: f.admin, workspace_id: WS, agent_slug: "system", agent_id: null } as never));
  assertEquals(r.error, "tool_forbidden");
  assertEquals(f.rpcs.filter((x) => x.fn === "credits_reserve").length, 0);
});

Deno.test("FIXED, through the real runTool: reads run as Hawk and reserve one credit per page, keyed to this setup run", async () => {
  const f = fakeAdmin();
  const res = await withoutFirecrawlKey(() => readSetupWebsites({
    runTool: runTool as unknown as SetupRunTool, admin: f.admin, workspace_id: WS, user_id: "u1", run_id: "run-1", sources: SOURCES,
  }));
  const reserves = f.rpcs.filter((x) => x.fn === "credits_reserve");
  assertEquals(reserves.length, 3, "allowed: no tool_forbidden");
  const keys = reserves.map((x) => String(x.args.p_idempotency_key));
  assertEquals(new Set(keys).size, 3, "one key per page");
  assert(keys.every((k) => k.startsWith("brain-setup:run-1:")), keys.join(" | "));
  assertEquals(res.read.length, 3);
  // No Firecrawl key here, so the reads come back unavailable — failed, not forbidden.
  assertEquals(res.status, "failed");

  // A second setup run reads the same pages under NEW keys: charged again, not replayed.
  const g = fakeAdmin();
  await withoutFirecrawlKey(() => readSetupWebsites({
    runTool: runTool as unknown as SetupRunTool, admin: g.admin, workspace_id: WS, user_id: "u1", run_id: "run-2", sources: SOURCES,
  }));
  const keys2 = g.rpcs.filter((x) => x.fn === "credits_reserve").map((x) => String(x.args.p_idempotency_key));
  assertFalse(keys2.some((k) => keys.includes(k)));
});

Deno.test("FIXED: no credits — the read is refused, nothing is sent, and setup says why", async () => {
  const f = fakeAdmin(false);
  const res = await withoutFirecrawlKey(() => readSetupWebsites({
    runTool: runTool as unknown as SetupRunTool, admin: f.admin, workspace_id: WS, user_id: "u1", run_id: "run-3", sources: SOURCES,
  }));
  assertEquals(res.status, "failed");
  assertEquals(res.enrichments, []);
  assertEquals(res.warnings.length, 1);
  assert(res.warnings[0].includes("needs credits"));
});

Deno.test("a successful read becomes an enrichment excerpt the analysis prompt receives", async () => {
  const seen: Array<{ input: unknown; ctx: ToolContext }> = [];
  const fake: SetupRunTool = (_n, input, ctx) => {
    seen.push({ input, ctx });
    const url = (input as { url: string }).url;
    if (url.endsWith("/pricing")) return Promise.resolve({ ok: false, error: CREDIT_REFUSED_ERROR });
    return Promise.resolve({ ok: true, data: { markdown: `# ${url}`, source_url: url } });
  };
  const res = await readSetupWebsites({ runTool: fake, admin: {}, workspace_id: WS, user_id: null, run_id: "run-4", sources: SOURCES });
  assertEquals(res.status, "ok");
  assertEquals(res.enrichments.map((e) => e.url), ["https://acme.com", "https://acme.com/about"]);
  assert(res.enrichments[0].summary.includes("# https://acme.com"));
  assertEquals(res.warnings.length, 1, "a partial credit refusal is still explained");
  assertEquals(seen[0].ctx.agent_slug, SETUP_READ_AGENT);
  assertEquals(seen[0].ctx.lineage_root, "brain-setup:run-4");
});

Deno.test("no website sources: skipped, nothing called", async () => {
  let calls = 0;
  const res = await readSetupWebsites({
    runTool: () => { calls++; return Promise.resolve({ ok: true }); }, admin: {}, workspace_id: WS, user_id: null,
    run_id: "r", sources: [{ source_type: "linkedin", url: "https://www.linkedin.com/company/acme" }],
  });
  assertEquals([res.status, calls], ["skipped", 0]);
});

Deno.test("the setup handler uses the helper and no longer names agent 'system' for a tool call", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/setup-company-brain/index.ts", import.meta.url));
  assert(src.includes("await readSetupWebsites({"));
  assertFalse(/agent_slug:\s*"system"/.test(src));
});
