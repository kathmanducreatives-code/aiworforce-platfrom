// Company Brain V1: the edge request contract, LISA/LYRA proposals and the ATLAS
// compatibility promise. Offline, fictional data.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isMemorySchemaMissing, lyraInsightFromApprovedContent, parseMemoryRequest, permissionForMemoryAction, statusForOutcome,
} from "../../../supabase/functions/_shared/brainMemoryRequest.ts";
import { competitorProposalsFromMonitoring, submitProposals } from "../../../supabase/functions/_shared/lisaBrainProposals.ts";
import { getCompiledCompanyBrainWithMemory } from "../../../supabase/functions/_shared/atlasBrainContract.ts";
import { getCompiledCompanyBrainForWorkspace } from "../../../supabase/functions/_shared/getCompiledCompanyBrainForWorkspace.ts";
import { proposalError } from "../../../supabase/functions/_shared/brainMemoryModel.ts";

const WS = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "11111111-0000-4000-8000-000000000001";
const KEY = "idem-key-0001";

// ── the request contract ─────────────────────────────────────────────────────
Deno.test("request: a browser cannot set provenance, approval or verification fields", () => {
  for (const field of ["created_by_kind", "approval_status", "approved_by", "proposal_id", "verification_status", "created_by_agent"]) {
    const r = parseMemoryRequest({ workspace_id: WS, action: "write", op: "set", idempotency_key: KEY,
      payload: { kind: "fact", category: "company", fact_key: "company.hq", value_type: "text", value: "Oslo", [field]: "x" } });
    assertFalse(r.ok, field);
  }
  const fake = parseMemoryRequest({ workspace_id: WS, action: "write", op: "set", idempotency_key: KEY,
    payload: { kind: "fact", category: "company", fact_key: "company.hq", value_type: "text", value: "Oslo", source_type: "model_inference" } });
  assertFalse(fake.ok, "a user write cannot pretend to be a model inference either way");
});

Deno.test("request: decisions keep their scope; writes need an idempotency key; dates are dates", () => {
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "write", op: "decide", idempotency_key: KEY,
    payload: { category: "lead_rejected", value: { outcome: "rejected" } } }).ok, "workspace-wide lead rejection");
  assert(parseMemoryRequest({ workspace_id: WS, action: "write", op: "decide", idempotency_key: KEY,
    payload: { category: "lead_rejected", scope: "lead", scope_ref: "lead-1", value: { outcome: "rejected" } } }).ok);
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "write", op: "set",
    payload: { kind: "fact", category: "company", fact_key: "x", value_type: "text", value: "y" } }).ok, "no key");
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "write", op: "set", idempotency_key: KEY,
    payload: { kind: "preference", category: "icp", fact_key: "icp.company_size", value_type: "number_range", value: { min: 9, max: 1 } } }).ok);
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "write", op: "set", idempotency_key: KEY,
    payload: { kind: "fact", category: "company", fact_key: "x", value_type: "text", value: "y", expires_at: "tomorrow" } }).ok);
  assertFalse(parseMemoryRequest({ workspace_id: "not-a-uuid", action: "context" }).ok);
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "write", op: "retract", idempotency_key: KEY, payload: { memory_id: "x" } }).ok);
});

Deno.test("request: review and redact shapes; permissions per action", () => {
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "review_proposal", decision: "correct", proposal_id: WS, idempotency_key: KEY }).ok,
    "correct needs a corrected value");
  assert(parseMemoryRequest({ workspace_id: WS, action: "review_proposal", decision: "approve", proposal_id: WS, idempotency_key: KEY }).ok);
  assertFalse(parseMemoryRequest({ workspace_id: WS, action: "redact", target: "memory", id: WS }).ok, "a reason is required");
  assertEquals(permissionForMemoryAction("context"), "read");
  assertEquals(permissionForMemoryAction("write"), "edit");
  assertEquals(permissionForMemoryAction("review_proposal"), "edit");
  assertEquals(permissionForMemoryAction("redact"), "activate");
  assertEquals(permissionForMemoryAction("content_approved"), "edit");
});

Deno.test("outcome → HTTP status, and the held-migration-absent error is recognised", () => {
  assertEquals(statusForOutcome("ok"), 200); assertEquals(statusForOutcome("already_recorded"), 200);
  assertEquals(statusForOutcome("stale"), 409); assertEquals(statusForOutcome("idempotency_conflict"), 409);
  assertEquals(statusForOutcome("forbidden_role"), 403); assertEquals(statusForOutcome("session_invalid"), 401);
  assertEquals(statusForOutcome("invalid"), 400); assertEquals(statusForOutcome("not_found"), 404);
  assertEquals(statusForOutcome("surprise"), 500);
  assert(isMemorySchemaMissing("Could not find the function public.company_brain_memory_write(p_idempotency_key, ...) in the schema cache"));
  assert(isMemorySchemaMissing('relation "public.company_brain_memory" does not exist'));
  assertFalse(isMemorySchemaMissing("duplicate key value violates unique constraint"));
});

// ── LISA proposals ───────────────────────────────────────────────────────────
Deno.test("LISA proposes only competitors the team monitors that the Brain does not list, with evidence", () => {
  const proposals = competitorProposalsFromMonitoring(
    [
      { kind: "competitor", identifier: "https://www.fleetbot.io", label: "FleetBot" },
      { kind: "competitor", identifier: "rivalco.com", label: "Rivalco" },              // already known
      { kind: "tracked_company", identifier: "customer.example", label: "A prospect" },   // not a competitor subject
      { kind: "competitor", identifier: "fleetbot.io", label: "FleetBot again" },         // same domain
      { kind: "icp", identifier: null, label: null },
    ],
    [{ name: "Rivalco", domain: null }],
    (id) => id.includes("fleetbot") ? { event_ids: ["e1", "e2"], source_urls: ["https://news.example.test/fleetbot", "ftp://x"], observed_at: "2026-11-01T00:00:00Z" } : null,
    new Date("2026-11-10T00:00:00Z"),
  );
  assertEquals(proposals.length, 1);
  const p = proposals[0];
  assertEquals(p.fact_key, "competitor:fleetbot.io");
  assertEquals(p.source_type, "agent_suggestion", "an agent suggestion, never a verified fact");
  assertEquals(p.dedupe_key, "lisa:competitor:fleetbot.io");
  assertEquals(p.evidence.map((e) => e.source_ref ?? e.source_url),
    ["monitoring_subject:https://www.fleetbot.io", "signal_events:e1", "signal_events:e2", "https://news.example.test/fleetbot"]);
  assertEquals(proposalError(p, "lisa"), null);
});

Deno.test("LISA proposal submission reports failures instead of throwing", async () => {
  const calls: unknown[] = [];
  const admin = { rpc: (fn: string, args: Record<string, unknown>) => { calls.push([fn, args.p_agent]);
    return Promise.resolve(calls.length === 1 ? { data: { outcome: "created" }, error: null } : { data: null, error: { message: "function does not exist" } }); } };
  const p = competitorProposalsFromMonitoring([{ kind: "competitor", identifier: "a.io", label: "A" }, { kind: "competitor", identifier: "b.io", label: "B" }], [], () => null);
  const out = await submitProposals(admin, WS, "lisa", p);
  assertEquals(out.map((o) => o.outcome), ["created", "error: function does not exist"]);
  assertEquals(calls, [["company_brain_proposal_submit", "lisa"], ["company_brain_proposal_submit", "lisa"]]);
});

// ── LYRA insight from approved content ───────────────────────────────────────
Deno.test("LYRA: only APPROVED content with an angle yields a (low-confidence) proposal", () => {
  const approved = { id: "c1", status: "approved", title: "Why pick rates stall", metadata: { content_strategy: { angle: "Picking speed beats headcount" } } };
  const p = lyraInsightFromApprovedContent(approved)!;
  assertEquals(p.fact_key, "content.proven_angle:picking-speed-beats-headcount");
  assertEquals(p.source_type, "agent_suggestion"); assertEquals(p.confidence, "low");
  assertEquals(p.evidence, [{ source_ref: "content_item:c1" }]);
  assertEquals(lyraInsightFromApprovedContent({ ...approved, status: "draft" }), null);
  assertEquals(lyraInsightFromApprovedContent({ ...approved, metadata: {} }), null);
});

// ── ATLAS compatibility promise ──────────────────────────────────────────────
type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      order() { return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); },
    };
    return q;
  };
  return { from: make };
}
const PROFILES: Row[] = [
  { schema_version: 2, company: { name: "Northwind" }, target_customer: { industries: ["Manufacturing"], company_size: { min: 10, max: 50 }, geography: ["Nordics"] }, competitors: ["Rivalco"] },
  { company: { name: "Legacy Co" }, icp: { industries: ["SaaS"], company_size: "11-50", geography: "US", disqualifiers: ["agencies"] }, competitors: { known: ["Acme"] } },
  {},
];

Deno.test("ATLAS: with no memory, the opt-in loader returns exactly the brain ATLAS gets today", async () => {
  for (const profile of PROFILES) {
    const tables = {
      workspace_members: [{ workspace_id: WS, user_id: USER }],
      company_brain: [{ workspace_id: WS, profile, updated_at: "2026-10-01T00:00:00Z", onboarding_completed: true }],
    };
    const today = await getCompiledCompanyBrainForWorkspace(db(tables) as never, WS, { userId: USER });
    const opted = await getCompiledCompanyBrainWithMemory(db(tables) as never, WS, { userId: USER });
    assert(today.ok && opted.ok);
    assertEquals(opted.brain, today.brain, `identical for ${JSON.stringify(profile).slice(0, 40)}`);
    assertEquals(opted.contract.contract_version, "atlas-brain-v1");
  }
});

Deno.test("ATLAS: the opt-in loader refuses non-members like the existing one", async () => {
  const tables = { workspace_members: [], company_brain: [{ workspace_id: WS, profile: PROFILES[0] }] };
  const opted = await getCompiledCompanyBrainWithMemory(db(tables) as never, WS, { userId: USER });
  assertFalse(opted.ok);
});

// ── the edge handler's shape ─────────────────────────────────────────────────
Deno.test("company-brain-memory: role pre-check before any RPC; never writes a memory table directly", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/company-brain-memory/index.ts", import.meta.url));
  const gate = src.indexOf("if (!canBrain(role, required))");
  const firstRpc = src.indexOf("admin.rpc(");
  assert(gate > 0 && firstRpc > gate, "the role check precedes the first RPC");
  assert(src.indexOf("getUser(token)") < gate, "the JWT is verified first");
  assertFalse(/from\("company_brain_(memory|revisions)[a-z_]*"\)\.(insert|update|upsert|delete)/.test(src), "no direct table writes");
  assertFalse(/generateText|generateJson|firecrawl|apify/i.test(src), "no model or provider call");
  assert(src.includes("sessionIdFromBearer(authHeader)"), "the live session is passed for in-transaction re-authorization");
});
