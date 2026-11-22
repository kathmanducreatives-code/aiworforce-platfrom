// Company Brain V2 · B2.3 — memory activation, the adversarial database contract.
//
// Real Postgres + PostgREST, the real modules pilot-chat and the Brain page use
// (offerMemoryFromTurn, the review RPC, the shared loader through loadChatBrain).
// The ORION model is not called: the offer is deterministic and the loader is what
// a new conversation reads. Every claim is judged by the rows that landed.
// Fictional data only.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, join, key, memoryWrite, opts, person, review, sql, team, uuid } from "./lib/brainMemory.ts";
import { offerMemoryFromTurn } from "../../supabase/functions/_shared/orionMemoryOfferRuntime.ts";
import { loadChatBrain } from "../../supabase/functions/_shared/chatBrainContext.ts";
import { compilerBrainContext, contractBrainInput } from "../../supabase/functions/_shared/leadPipeline/brainContext.ts";

const PROFILE = {
  schema_version: 2,
  company: { name: "Northwind Clinics", description: "Scheduling software for physiotherapy clinics" },
  target_customer: { industries: ["Healthcare"], geography: ["Portugal"], company_size: { min: 5, max: 50, label: "5-50" }, disqualifiers: {} },
};
const proposals = async (ws: string) =>
  await sql`select id, kind, category, fact_key, value, status, proposed_by_agent, evidence from public.company_brain_memory_proposals where workspace_id = ${ws} order by created_at`;
const items = async (ws: string) =>
  await sql`select * from public.company_brain_memory where workspace_id = ${ws} order by created_at`;

async function say(ws: string, message: string, conversationId = uuid()) {
  const svc = await as("service_role");
  return await offerMemoryFromTurn(svc as never, { workspaceId: ws, conversationId, messageId: uuid(), message, profile: PROFILE });
}

Deno.test("B2.3: conversation → offer → approval → a NEW conversation reads it through the canonical loader", opts, async () => {
  const t = await team(PROFILE);
  // Conversation 1: a lasting preference and a business decision.
  const ex = await say(t.ws, "From now on, never target gambling companies.");
  assertEquals(ex?.status, "pending");
  const dec = await say(t.ws, "We've decided to focus on dental clinics in Portugal.");
  assertEquals([dec?.status, dec?.kind], ["pending", "decision"]);
  // Nothing is memory yet: proposals only.
  assertEquals((await items(t.ws)).length, 0);
  const svc = await as("service_role");
  const before = await loadChatBrain(svc as never, t.ws, t.owner.id);
  assertFalse(before.memoryBlock.includes("Gambling"), "a pending proposal never reaches ORION");

  // A person approves both (the chat card / review queue call this RPC through company-brain-memory).
  assertEquals((await review(t.ws, t.editor, ex!.proposal_id!, "approve")).outcome, "ok");
  assertEquals((await review(t.ws, t.editor, dec!.proposal_id!, "approve")).outcome, "ok");
  const rows = await items(t.ws);
  assertEquals(rows.map((r) => [r.kind, r.created_by_kind, r.created_by_agent, r.verification_status, r.approved_by]).sort(),
    [["decision", "agent", "orion", "user_confirmed", t.editor.id], ["preference", "agent", "orion", "user_confirmed", t.editor.id]].sort());

  // Conversation 2 (a new conversation, a fresh load): ORION's memory view has both.
  const after = await loadChatBrain(svc as never, t.ws, t.owner.id);
  assertEquals(after.source, "shared_loader");
  assertStringIncludes(after.memoryBlock, "Never target or recommend");
  assertStringIncludes(after.memoryBlock, "Gambling");
  assertStringIncludes(after.memoryBlock, "Business decision (strategy selected): Focus on dental clinics in Portugal");
  const disq = ((after.row!.profile!.target_customer as Record<string, unknown>).disqualifiers as Record<string, string[]>).industries;
  assert(disq.includes("Gambling"), "the exclusion is folded into the effective profile ORION reasons over");

  // ATLAS's request authority is untouched: it reads the stored profile, not memory.
  const [stored] = await sql`select profile from public.company_brain where workspace_id = ${t.ws}`;
  assertEquals(compilerBrainContext(stored.profile as never), compilerBrainContext(PROFILE as never));
  assertEquals(contractBrainInput(stored.profile as never), contractBrainInput(PROFILE as never));
});

Deno.test("B2.3: a temporary request stores nothing", opts, async () => {
  const t = await team(PROFILE);
  const r = await say(t.ws, "For this search, skip gambling companies");
  assertEquals(r?.status, "temporary");
  assertEquals((await proposals(t.ws)).length, 0);
  assertEquals((await items(t.ws)).length, 0);
});

Deno.test("B2.3: saying it again never makes a second proposal; approving twice never makes a second memory", opts, async () => {
  const t = await team(PROFILE);
  const a = await say(t.ws, "From now on, never target gambling companies.");
  const b = await say(t.ws, "Going forward never target gambling companies", uuid());
  assertEquals(b?.proposal_id, a?.proposal_id, "the same statement joins the open proposal");
  assertEquals((await proposals(t.ws)).length, 1);
  assertEquals(((await proposals(t.ws))[0].evidence as unknown[]).length, 2, "both conversations are kept as evidence");

  const idem = key();
  const first = await review(t.ws, t.editor, a!.proposal_id!, "approve", { idem });
  const replay = await review(t.ws, t.editor, a!.proposal_id!, "approve", { idem });
  assertEquals([first.outcome, replay.replayed], ["ok", true]);
  const again = await review(t.ws, t.owner, a!.proposal_id!, "approve");
  assertEquals(again.outcome, "not_pending", "a second approval (another tab, another person) changes nothing");
  assertEquals((await items(t.ws)).length, 1);
  // ORION offering it after it is remembered: already known, no new proposal.
  assertEquals((await say(t.ws, "From now on, never target gambling companies."))?.status, "already_known");
  assertEquals((await proposals(t.ws)).length, 1);
});

Deno.test("B2.3: a rejected offer is never offered again; a viewer or an outsider cannot approve", opts, async () => {
  const t = await team(PROFILE);
  const a = await say(t.ws, "Never mention pricing in posts");
  assertEquals((await review(t.ws, t.viewer, a!.proposal_id!, "approve")).outcome, "forbidden_role");
  const outsider = await person();
  const other = await team(PROFILE);
  await join(other.ws, outsider, "owner");
  assertEquals((await review(t.ws, outsider, a!.proposal_id!, "approve")).outcome, "not_member");
  assertEquals((await review(other.ws, other.owner, a!.proposal_id!, "approve")).outcome, "not_found", "another workspace cannot reach it");
  assertEquals((await items(t.ws)).length, 0);
  assertEquals((await review(t.ws, t.editor, a!.proposal_id!, "reject")).outcome, "ok");
  assertEquals(await say(t.ws, "Never mention pricing in posts"), null, "ORION does not ask again after a person said no");
  assertEquals((await proposals(t.ws)).length, 1);
});

Deno.test("B2.3: decision proposals obey the same rules as a person's decision", opts, async () => {
  const t = await team(PROFILE);
  const svc = await as("service_role");
  const submit = async (payload: Record<string, unknown>) =>
    (await svc.rpc("company_brain_proposal_submit", { p_workspace_id: t.ws, p_agent: "orion", p_payload: payload })).data as Record<string, unknown>;
  const base = { kind: "decision", value_type: "object", rationale: "heard in chat", source_type: "agent_suggestion" };
  assertEquals((await submit({ ...base, category: "lead_rejected", fact_key: "decision.x", value: { outcome: "rejected" } })).outcome, "invalid",
    "a one-record decision cannot be proposed workspace-wide");
  assertEquals((await submit({ ...base, category: "strategy_selected", fact_key: "decision.y", value: { note: "no outcome" } })).outcome, "invalid");
  assertEquals((await submit({ ...base, category: "strategy_selected", fact_key: "decision.z", value: { outcome: "Sell annual plans only" } })).outcome, "created");
  // The browser still cannot submit or review anything.
  const browser = await as("authenticated", t.owner.id);
  assert((await browser.rpc("company_brain_proposal_submit", { p_workspace_id: t.ws, p_agent: "orion", p_payload: { ...base, category: "strategy_selected", fact_key: "decision.w", value: { outcome: "x" } } })).error);
  assert((await browser.from("company_brain_memory_proposals").update({ status: "approved" }).eq("workspace_id", t.ws).select()).data?.length !== 1);
});

Deno.test("B2.3: a conflicting preference must be resolved on purpose; the old value stays in history", opts, async () => {
  const t = await team(PROFILE);
  const first = await say(t.ws, "Going forward only target companies with 10-50 employees");
  await review(t.ws, t.editor, first!.proposal_id!, "approve");
  const second = await say(t.ws, "From now on only target companies with 200-500 employees");
  assertEquals(second?.status, "pending");
  assert(second?.replaces_memory_id, "flagged as replacing the remembered size");
  assertStringIncludes(second?.conflict ?? "", "targets 5–50 employees", "and as disagreeing with the profile");
  assertEquals((await review(t.ws, t.editor, second!.proposal_id!, "approve")).outcome, "stale", "approval must name the version it replaces");
  assertEquals((await review(t.ws, t.editor, second!.proposal_id!, "approve", { expectedVersion: 1 })).outcome, "ok");
  const [row] = await items(t.ws);
  assertEquals([row.value, row.version], [{ min: 200, max: 500 }, 2]);
  const [h] = await sql`select previous from public.company_brain_memory_history where memory_id = ${row.id} and change_kind = 'approved_from_proposal' and from_version = 1`;
  assertEquals((h.previous as Record<string, unknown>).value, { min: 10, max: 50 });
});

Deno.test("B2.3: a correction supersedes; disputed, stale and redacted knowledge never reaches ORION", opts, async () => {
  const t = await team(PROFILE);
  const svc = await as("service_role");
  const correction = { kind: "fact", category: "corrections", fact_key: "correction.we-sell-to-enterprises", value_type: "object" };
  const c1 = await memoryWrite(t.ws, t.owner, "correct", { ...correction, value: { wrong: "We sell to enterprises", right: "We sell to clinics" } });
  const c2 = await memoryWrite(t.ws, t.owner, "correct", { ...correction, value: { wrong: "We sell to enterprises", right: "We sell to clinics with 5-50 staff" }, expected_version: 1 });
  assertEquals([c1.outcome, c2.outcome, c2.memory_id], ["ok", "ok", c1.memory_id]);
  let block = (await loadChatBrain(svc as never, t.ws, t.owner.id)).memoryBlock;
  assertStringIncludes(block, `Correction (the team corrected this; it overrides anything else you saw): We sell to clinics with 5-50 staff — NOT "We sell to enterprises"`);
  assertFalse(block.includes("We sell to clinics ["), "the superseded version is not served");

  const fact = await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.hq-lisbon", value_type: "text", value: "Our HQ is in Lisbon" });
  await memoryWrite(t.ws, t.owner, "dispute", { memory_id: fact.memory_id, expected_version: 1 });
  block = (await loadChatBrain(svc as never, t.ws, t.owner.id)).memoryBlock;
  assertFalse(block.includes("Lisbon"), "a disputed fact is not served");
  assertStringIncludes(block, "stale or disputed and are NOT included");

  const stale = await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.team-size", value_type: "text", value: "We have 12 employees", review_at: "2026-01-01T00:00:00Z" });
  assertEquals(stale.outcome, "ok");
  assertFalse((await loadChatBrain(svc as never, t.ws, t.owner.id)).memoryBlock.includes("12 employees"), "past its review date: not served");

  const secret = await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.pricing", value_type: "text", value: "Fictional internal price list" });
  const red = await svc.rpc("company_brain_memory_redact", { p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_target: "memory", p_id: secret.memory_id, p_reason: "privacy" });
  assertEquals((red.data as Record<string, unknown>).outcome, "ok");
  assertFalse((await loadChatBrain(svc as never, t.ws, t.owner.id)).memoryBlock.includes("price list"));
  const [r] = await sql`select value, lifecycle_status from public.company_brain_memory where id = ${String(secret.memory_id)}`;
  assertEquals([r.value, r.lifecycle_status], [null, "retracted"]);
});

Deno.test("B2.3: memory is per workspace — another workspace's ORION never sees it", opts, async () => {
  const a = await team(PROFILE); const b = await team(PROFILE);
  const p = await say(a.ws, "From now on, never target gambling companies.");
  await review(a.ws, a.editor, p!.proposal_id!, "approve");
  const svc = await as("service_role");
  assertFalse((await loadChatBrain(svc as never, b.ws, b.owner.id)).memoryBlock.includes("Gambling"));
  const refused = await loadChatBrain(svc as never, a.ws, b.owner.id);
  assertEquals([refused.source, refused.memoryBlock], ["none", ""], "a non-member gets nothing, not a fallback read");
});
