// COMPANY BRAIN V2 · B2.3 — ORION tells a lasting preference from a temporary
// request, and only offers what it can remember exactly. Fictional data.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectMemoryOffer, profileConflictForItem } from "../../../supabase/functions/_shared/orionMemoryOffer.ts";
import { exclusionItem } from "../../../supabase/functions/_shared/brainMemoryPayloads.ts";
import { buildAddPayload } from "../../../src/lib/companyBrain/memoryView.ts";

type Case = [message: string, expect: null | "temporary" | { key: string; value: unknown; summary?: string }];
const CASES: Case[] = [
  // ── lasting → an exact item ────────────────────────────────────────────────
  ["From now on, never target gambling companies.", { key: "exclusion.industry:gambling", value: { type: "industry", value: "Gambling" }, summary: "Never target the Gambling industry" }],
  ["Never target companies in the crypto industry", { key: "exclusion.industry:crypto", value: { type: "industry", value: "Crypto" } }],
  ["Stop contacting companies in Russia", { key: "exclusion.geography:russia", value: { type: "geography", value: "Russia" }, summary: "Never target companies in Russia" }],
  ["Going forward, don't reach out to rivalco.com again", { key: "exclusion.company:rivalco.com", value: { type: "company", value: "rivalco.com" } }],
  ["Going forward only target companies with 10-50 employees", { key: "icp.company_size", value: { min: 10, max: 50 }, summary: "Target companies with 10–50 employees" }],
  ["From now on we only want 200+ employee companies", null], // "200+ employee" without a verb pattern it can read exactly → no guess
  ["Never mention pricing in posts", { key: "content.restrictions:never-mention-pricing-in-posts", value: ["Never mention pricing in posts"] }],
  ["Our tone should always be plain and technical", { key: "content.tone", value: "plain and technical", summary: "Content tone: plain and technical" }],
  ["We've decided to focus on dental clinics in Portugal.", { key: "decision.focus-on-dental-clinics-in-portugal", value: { outcome: "Focus on dental clinics in Portugal" } }],
  ["We're now focusing on mid-market logistics", { key: "decision.focus-on-mid-market-logistics", value: { outcome: "Focus on mid-market logistics" } }],
  // A strong cue wins over a time word.
  ["From now on, for every search, skip gambling — never target gambling", { key: "exclusion.industry:gambling", value: { type: "industry", value: "Gambling" } }],
  // ── temporary → nothing stored ─────────────────────────────────────────────
  ["For this search, skip gambling companies", "temporary"],
  ["Just this week, only show UK leads", "temporary"],
  ["Exclude fintech for now", "temporary"],
  ["Today only, avoid Germany", "temporary"],
  // ── neither → silence ──────────────────────────────────────────────────────
  ["Should we never target gambling?", null],
  ["What if we always focused on dentists", null],
  ["Find me 20 SaaS founders in Berlin", null],
  ["Never mind, show me the last report", null],
  ["Never target them", null],
  ["I always forget the login", null],
];

for (const [message, expect] of CASES) {
  Deno.test(`B2.3 offer: ${JSON.stringify(message)}`, () => {
    const o = detectMemoryOffer(message);
    if (expect === null) return assertEquals(o, null);
    if (expect === "temporary") {
      assertEquals(o?.kind, "temporary");
      assertStringIncludes((o as { summary: string }).summary, "this request only");
      return;
    }
    assert(o && o.kind === "lasting", `expected an offer, got ${JSON.stringify(o)}`);
    assertEquals(o.item.fact_key, expect.key);
    assertEquals(o.item.value, expect.value);
    if (expect.summary) assertEquals(o.summary, expect.summary);
  });
}

Deno.test("B2.3: an offer and a hand-added preference for the same thing are the same item (one key, one memory)", () => {
  const offer = detectMemoryOffer("From now on, never target gambling companies")!;
  const added = buildAddPayload("exclude_industry", "Gambling");
  assert(offer.kind === "lasting" && added.ok);
  assertEquals(offer.item.fact_key, (added as { payload: Record<string, unknown> }).payload.fact_key);
  assertEquals(offer.item.value, (added as { payload: Record<string, unknown> }).payload.value);
});

Deno.test("B2.3: decisions are workspace-wide only in the categories the database allows", () => {
  const o = detectMemoryOffer("We have decided that we will sell only annual plans")!;
  assert(o.kind === "lasting");
  assertEquals([o.item.kind, o.item.category, o.item.value], ["decision", "strategy_selected", { outcome: "Sell only annual plans" }]);
});

Deno.test("B2.3: a preference that disagrees with the profile says so before anyone approves it", () => {
  const profile = { schema_version: 2, target_customer: { industries: ["Gambling", "Retail"], geography: ["Portugal"], company_size: { min: 10, max: 50, label: "10-50" } }, brand_voice: { tone: "warm" } };
  assertStringIncludes(profileConflictForItem(profile, exclusionItem("industry", "Gambling"))!, "one of your target industries");
  assertStringIncludes(profileConflictForItem(profile, exclusionItem("geography", "portugal"))!, "target geography");
  assertStringIncludes(profileConflictForItem(profile, { fact_key: "icp.company_size", value: { min: 200, max: 500 } })!, "targets 10–50 employees");
  assertEquals(profileConflictForItem(profile, { fact_key: "icp.company_size", value: { min: 10, max: 50 } }), null);
  assertStringIncludes(profileConflictForItem(profile, { fact_key: "content.tone", value: "formal" })!, "“warm”");
  assertEquals(profileConflictForItem(profile, exclusionItem("industry", "Crypto")), null);
  assertEquals(profileConflictForItem(null, exclusionItem("industry", "Gambling")), null);
});

// ── the runtime: what reaches the database, and what the chat shows ─────────
import { memoryOfferMessage, offerMemoryFromTurn } from "../../../supabase/functions/_shared/orionMemoryOfferRuntime.ts";

const fakeAdmin = (reply: { data?: unknown; error?: { message: string } | null } | Error) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ data: reply.data ?? null, error: reply.error ?? null });
    },
  };
};
const turn = { workspaceId: "w", conversationId: "c1", messageId: "m1", profile: null };

Deno.test("B2.3 runtime: a lasting statement becomes a PENDING orion proposal with the conversation as evidence", async () => {
  const admin = fakeAdmin({ data: { outcome: "created", proposal_id: "11111111-2222-4333-8444-555555555555" } });
  const r = await offerMemoryFromTurn(admin, { ...turn, message: "From now on, never target gambling companies." });
  assertEquals([r?.status, r?.proposal_id, r?.kind], ["pending", "11111111-2222-4333-8444-555555555555", "preference"]);
  assertEquals(admin.calls.length, 1);
  const { fn, args } = admin.calls[0];
  assertEquals([fn, args.p_agent], ["company_brain_proposal_submit", "orion"]);
  const p = args.p_payload as Record<string, unknown>;
  assertEquals([p.source_type, p.fact_key], ["agent_suggestion", "exclusion.industry:gambling"]);
  assertEquals((p.evidence as Array<Record<string, unknown>>)[0].source_ref, "conversation:c1#message:m1");
});

Deno.test("B2.3 runtime: temporary → no database call; rejected or failing → no offer at all", async () => {
  const none = fakeAdmin({ data: {} });
  assertEquals((await offerMemoryFromTurn(none, { ...turn, message: "For this search, skip gambling" }))?.status, "temporary");
  assertEquals(none.calls.length, 0);
  assertEquals(await offerMemoryFromTurn(fakeAdmin({ data: { outcome: "previously_rejected" } }), { ...turn, message: "Never mention pricing" }), null);
  assertEquals(await offerMemoryFromTurn(fakeAdmin({ error: { message: "relation does not exist" } }), { ...turn, message: "Never mention pricing" }), null);
  assertEquals(await offerMemoryFromTurn(fakeAdmin(new Error("network")), { ...turn, message: "Never mention pricing" }), null);
  assertEquals(await offerMemoryFromTurn(fakeAdmin({ data: { outcome: "created", proposal_id: "p" } }), { ...turn, message: "Find 20 founders" }), null);
  assertEquals((await offerMemoryFromTurn(fakeAdmin({ data: { outcome: "already_known", memory_id: "m" } }), { ...turn, message: "Never mention pricing" }))?.status, "already_known");
});

Deno.test("B2.3 runtime: the chat message asks — it never claims something was remembered", () => {
  const pending = memoryOfferMessage({ status: "pending", summary: "Never target the Gambling industry", kind: "preference", proposal_id: "p", conflict: "Gambling is one of your target industries." });
  assertStringIncludes(pending.content, "Should I remember it for every agent?");
  assertStringIncludes(pending.content, "one of your target industries");
  assertEquals((pending.metadata.memory_offer as Record<string, unknown>).status, "pending");
  assertStringIncludes(memoryOfferMessage({ status: "temporary", summary: "Applied to this request only. It is not saved to your Company Brain." }).content, "Noted for this request only");
});

Deno.test("B2.3 pilot-chat seam: offers are read from typed messages only and posted after a successful answer", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assert(/if \(!actionSource && conversationId\) \{\s*fail\.memoryOffer = await offerMemoryFromTurn\(/.test(src), "card actions are never read as statements");
  assert(/const res = await handlePilotChat\(req, fail\);\s*if \(res\.status === 200 && fail\.memoryOffer\) await postMemoryOffer\(fail\);\s*return res;/.test(src),
    "the offer follows a successful answer, from the one exit every path passes through");
  // It is computed after the user's turn is recorded (so the evidence names a real message).
  assert(src.indexOf("fail.memoryOffer = await offerMemoryFromTurn(") > src.indexOf('error: "failed to record your message"'));
  // Nothing in the seam writes memory: only a proposal is submitted.
  assertFalse(/company_brain_memory_write|company_brain_proposal_review/.test(await Deno.readTextFile(new URL("../../../supabase/functions/_shared/orionMemoryOfferRuntime.ts", import.meta.url))));
});
