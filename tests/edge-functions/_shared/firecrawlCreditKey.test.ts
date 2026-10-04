// DIFFERENT FIRECRAWL CALLS GET DIFFERENT CREDIT KEYS (canary 4, 382de52c).
//
// `logical_call_key` is the idempotency key of the credit reservation. Firecrawl
// `/map` calls were sent without `compiled_input_hash`, so every map in the
// lineage keyed to `<lineage>:web_evidence_verification:no-hash`: crewai.com was
// charged, and simera.me, talentify.us.com and every later map were REPLAYED.
// The lineage made 44 paid calls and was charged 34 credits.
//
//
// The unspecced callers had the same defect: the V1 page scrape and Company
// Brain setup now key per call (one credit per distinct Firecrawl call), and the
// Workbench research unlock keys per COMPANY — its quoted unit — so one click on
// N companies is N credits, not one (old) and not one per page (per-URL).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { paidCallInputHash, researchUnlockHash } from "../../../supabase/functions/_shared/paidCallInputHash.ts";
import { logicalCallKey } from "../../../supabase/functions/_shared/executionLedger.ts";
import { runTool, type ToolContext } from "../../../supabase/functions/_shared/toolRegistry.ts";
import { compileWebEvidenceSpec } from "../../../supabase/functions/_shared/webEvidenceSpec.ts";
import { newSpendLedger, resolveCeilings } from "../../../supabase/functions/_shared/budgetPolicy.ts";

globalThis.fetch = () => { throw new Error("credit-key tests must not reach the network"); };

const LINEAGE = "382de52c-423e-45e8-b94c-ce8abe9fcf19";
const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";

/** A map spec exactly as `specGovernedMapper` compiles it. */
const mapSpec = (domain: string) => compileWebEvidenceSpec({
  url: `https://${domain}`, company_key: domain, request_id: `map:${domain}`,
  scope: { workspace_id: WS, lineage_id: LINEAGE }, mission_hash: "m", plan: { plan_id: null, version: null },
  ledger: newSpendLedger(resolveCeilings(null)), usd_per_credit: 0.00525, kind: "map", map_max_urls: 120,
});
/** The tool input run-agent's map `send` builds (after this fix). */
const mapSend = (domain: string, withHash = true) => {
  const spec = mapSpec(domain);
  return {
    ...spec.serialized_input, capability_key: "web_evidence_verification", provider_call_spec: spec,
    ...(withHash ? { compiled_input_hash: spec.idempotency_key } : {}),
    audit_stage: "company_enrichment", audit_reason: "discover_pages_for_claim", actor_id: "firecrawl_map",
  } as Record<string, unknown>;
};
const keyOf = (tool: string, input: Record<string, unknown>, hash: string | null) => logicalCallKey({
  lineage_root: LINEAGE, task_id: LINEAGE, capability: input.capability_key as string ?? null,
  stage: "company_enrichment", input_hash: hash,
});

// ── THE RULE ────────────────────────────────────────────────────────────────

Deno.test("CANARY 4, OLD: the three maps of slice 1 shared ONE key — two of the three were credit replays", () => {
  const keys = ["crewai.com", "simera.me", "talentify.us.com"].map((d) => {
    const i = mapSend(d, false);
    return keyOf("scrape_url", i, (i.compiled_input_hash as string | undefined) ?? null);
  });
  assertEquals(new Set(keys).size, 1);
  assertEquals(keys[0], `${LINEAGE}:web_evidence_verification:no-hash`);
});

Deno.test("CANARY 4, FIXED: three maps, three keys — each one is charged", () => {
  for (const withHash of [true, false]) {
    // `withHash: false` is the fallback: a caller that forgets the hash still
    // gets the spec's key, never "no-hash".
    const keys = ["crewai.com", "simera.me", "talentify.us.com"].map((d) => {
      const i = mapSend(d, withHash);
      return keyOf("scrape_url", i, paidCallInputHash("scrape_url", i));
    });
    assertEquals(new Set(keys).size, 3, `withHash=${withHash}`);
    for (const k of keys) assert(!k.endsWith(":no-hash"), k);
  }
  // The explicit hash and the fallback agree, so the two paths key one call identically.
  assertEquals(paidCallInputHash("scrape_url", mapSend("crewai.com", true)),
    paidCallInputHash("scrape_url", mapSend("crewai.com", false)));
});

Deno.test("a RETRY of the same map keeps its key — a genuine replay still charges once", () => {
  assertEquals(paidCallInputHash("scrape_url", mapSend("crewai.com")), paidCallInputHash("scrape_url", mapSend("crewai.com")));
});

Deno.test("V1 scrape / Company Brain (no hash, no spec): one key per distinct call; a retry repeats; audit fields do not matter", () => {
  const v1 = (url: string, extra: Record<string, unknown> = {}) =>
    paidCallInputHash("scrape_url", { url, extraction_goal: "find pricing", max_pages: 1, ...extra });
  assert(v1("https://a.com/pricing") !== v1("https://b.com/pricing"));
  assertEquals(v1("https://a.com/pricing"), v1("https://a.com/pricing", { audit_reason: "x", execution_owner: "y" }));
  assert(v1("https://a.com") !== paidCallInputHash("scrape_url", { url: "https://a.com", mode: "map", max_pages: 120 }),
    "a map and a page of the same URL are different calls");
  // Company Brain setup sends only { url }.
  assert(paidCallInputHash("scrape_url", { url: "https://a.com" }) !== paidCallInputHash("scrape_url", { url: "https://b.com" }));
});

Deno.test("research unlock: the key is the LEAD, so every page of one company shares it and two companies differ", () => {
  assertEquals(researchUnlockHash("lead-a"), researchUnlockHash("lead-a"));
  assert(researchUnlockHash("lead-a") !== researchUnlockHash("lead-b"));
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/leadActionExecutor.ts", import.meta.url));
  assert(src.includes("compiled_input_hash: researchUnlockHash(String(lead.lead_candidate_id))"),
    "the research unlock must name its billing unit");
});

Deno.test("run-agent's map send passes the spec's key as its hash, as page fetches do", () => {
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  const send = src.slice(src.indexOf("mapSite: p2Specs ? specGovernedMapper("), src.indexOf("log: (event, meta) => verifierLog(`map:"));
  assert(send.includes("compiled_input_hash: spec.idempotency_key"), "the map send must carry its hash");
});

Deno.test("unchanged: a caller's compiled_input_hash always wins, and Apify keys are not touched", () => {
  assertEquals(paidCallInputHash("scrape_url", { url: "https://a.com", compiled_input_hash: "abc" }), "abc");
  assertEquals(paidCallInputHash("source_with_apify", { compiled_input_hash: "v2:123" }), "v2:123");
  assertEquals(paidCallInputHash("source_with_apify", { provider_call_spec: { idempotency_key: "k" }, url: "x" }), null);
  assertEquals(paidCallInputHash("source_with_apify", {}), null);
  assertEquals(paidCallInputHash("scrape_url", {}), null, "nothing to key on: unchanged");
});

// ── THROUGH THE REAL TOOL PATH ──────────────────────────────────────────────

/** A Supabase stand-in: every query chain resolves empty; `rpc` is recorded. */
function fakeAdmin() {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const charged = new Set<string>();
  const chain = (): unknown => new Proxy(function () {}, {
    get: (_t, p) => p === "then"
      ? (res: (v: unknown) => void) => res({ data: null, error: null })
      : () => chain(),
    apply: () => chain(),
  });
  const admin = {
    from: () => chain(),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "credits_reserve") {
        const key = String(args.p_idempotency_key);
        const replayed = charged.has(key);
        charged.add(key);
        return Promise.resolve({ data: { ok: true, replayed, transaction_id: `t-${key}`, balance_after: 100 }, error: null });
      }
      return Promise.resolve({ data: { ok: true, settled: true, charged: 1 }, error: null });
    },
  };
  return { admin, rpcs, charged };
}

Deno.test("THROUGH runTool: slice 1's three maps reserve three DISTINCT credit keys, none replayed", async () => {
  const prior = Deno.env.get("FIRECRAWL_API_KEY");
  Deno.env.delete("FIRECRAWL_API_KEY"); // the tool returns "unavailable" before any fetch
  try {
    // With the hash run-agent now sends, AND without it (the central fallback).
    for (const withHash of [true, false]) {
      const f = fakeAdmin();
      const ctx = {
        admin: f.admin, workspace_id: WS, agent_slug: "scout", agent_id: null,
        task_id: LINEAGE, lineage_root: LINEAGE,
      } as unknown as ToolContext;
      for (const d of ["crewai.com", "simera.me", "talentify.us.com"]) await runTool("scrape_url", mapSend(d, withHash), ctx);
      const reserves = f.rpcs.filter((r) => r.fn === "credits_reserve");
      assertEquals(reserves.length, 3);
      const keys = reserves.map((r) => String(r.args.p_idempotency_key));
      assertEquals(new Set(keys).size, 3, `withHash=${withHash}: ${keys.join(" | ")}`);
      for (const k of keys) assert(k.startsWith(`${LINEAGE}:web_evidence_verification:`) && !k.endsWith(":no-hash"), k);
    }
  } finally {
    if (prior !== undefined) Deno.env.set("FIRECRAWL_API_KEY", prior);
  }
});

/** Drive `runTool` for a sequence of scrape inputs; returns reserve keys and how many were charged (not replayed). */
async function reserveKeys(inputs: Record<string, unknown>[], taskId = LINEAGE, agent = "scout") {
  const prior = Deno.env.get("FIRECRAWL_API_KEY");
  Deno.env.delete("FIRECRAWL_API_KEY");
  try {
    const f = fakeAdmin();
    const ctx = { admin: f.admin, workspace_id: WS, agent_slug: agent, agent_id: null, task_id: taskId, lineage_root: taskId } as unknown as ToolContext;
    const results = [];
    for (const i of inputs) results.push(await runTool("scrape_url", i, ctx));
    const reserves = f.rpcs.filter((r) => r.fn === "credits_reserve");
    return { keys: reserves.map((r) => String(r.args.p_idempotency_key)), amounts: reserves.map((r) => Number(r.args.p_amount)), charged: f.charged.size, results };
  } finally {
    if (prior !== undefined) Deno.env.set("FIRECRAWL_API_KEY", prior);
  }
}

Deno.test("THROUGH runTool: the V1 scrape's three URLs are three charges (old: one)", async () => {
  const r = await reserveKeys(["https://a.com", "https://b.com", "https://c.com"].map((url) =>
    ({ url, extraction_goal: "summarise", max_pages: 1 })));
  assertEquals(r.keys.length, 3);
  assertEquals(r.charged, 3);
});

Deno.test("THROUGH runTool: research unlock on 2 companies × 6 pages reserves exactly 2 credits — the quoted price per company", async () => {
  const TASK = "aaaaaaaa-0000-4000-8000-000000000001";
  const pages = (lead: string, company: string) => Array.from({ length: 6 }, (_, n) => ({
    url: `https://${company}.com/p${n}`, extraction_goal: `Company research for ${company}`, max_pages: 1,
    unlock_capability: "research_company", compiled_input_hash: researchUnlockHash(lead),
  }));
  const r = await reserveKeys([...pages("lead-a", "acme"), ...pages("lead-b", "globex")], TASK);
  assertEquals(r.keys.length, 12, "every page asks");
  assertEquals(r.charged, 2, "one credit per company");
  assertEquals(new Set(r.keys).size, 2);
  assert(r.amounts.every((a) => a === 1), "at the quoted research_company price");
  // A later action (a new task) researching the same company is a new charge.
  const again = await reserveKeys(pages("lead-a", "acme"), "aaaaaaaa-0000-4000-8000-000000000002");
  assert(!r.keys.includes(again.keys[0]));
});

Deno.test("Company Brain setup's scrape runs as agent 'system', which scrape_url does not allow: refused before any credit (unchanged, pre-existing)", async () => {
  const r = await reserveKeys([{ url: "https://a.com" }], LINEAGE, "system");
  assertEquals(r.keys.length, 0);
  assertEquals(r.results[0].error, "tool_forbidden");
});
