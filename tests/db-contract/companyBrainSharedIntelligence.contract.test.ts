// Company Brain V2 · B2.4 — one Brain, every agent.
//
// Real Postgres + PostgREST, the real memory RPCs, and the SAME shared modules
// each consumer uses (pilot-chat → loadChatBrain; daily-brief / run-agent content
// / run-radar-scan / run-monitoring-scan / lisa relevance → loadCompanyBrainContext
// + their views). An approved business preference must reach every agent it is
// meant for, identically, from one context id; unservable knowledge reaches none;
// ATLAS's request authority (the stored profile) is untouched. No model, no
// provider, no monitoring is run. Fictional data.
import { assert, assertEquals, assertFalse, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, memoryWrite, opts, review, sql, team, uuid } from "./lib/brainMemory.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { loadChatBrain } from "../../supabase/functions/_shared/chatBrainContext.ts";
import {
  agentBrainStamp, lisaRadarPreferences, lisaView, renderBrainMemoryBlock,
} from "../../supabase/functions/_shared/companyBrainAgentViews.ts";
import { compileCompanyBrainContext } from "../../supabase/functions/_shared/companyBrainCompiler.ts";
import { renderContentBrain } from "../../supabase/functions/_shared/contentBrainContext.ts";
import { evaluateRelevance } from "../../supabase/functions/_shared/lisa/relevance.ts";
import { compilerBrainContext, contractBrainInput } from "../../supabase/functions/_shared/leadPipeline/brainContext.ts";
import { offerMemoryFromTurn } from "../../supabase/functions/_shared/orionMemoryOfferRuntime.ts";
import type { LisaSignal } from "../../supabase/functions/_shared/lisa/types.ts";

const PROFILE = {
  schema_version: 2,
  company: { name: "Northwind Clinics", description: "Scheduling software for physiotherapy clinics" },
  target_customer: { industries: ["Healthcare"], geography: ["Portugal"], company_size: { min: 5, max: 50, label: "5-50" }, disqualifiers: {} },
  competitors: ["Rivalco"],
  brand_voice: { tone: "warm" },
  signal_preferences: { default_mix: { hiring: 3, linkedin_intent: 3, competitors: 2, workflows: 2, people: 0 } },
};
const radarBase = { competitors: ["Rivalco"], disqualifiers: [] as string[], industries: ["Healthcare"], geographies: ["Portugal"], default_mix: {} };
const signal = (company: string, industryText: string): LisaSignal => ({
  workspace_id: "w", category: "expansion", signal_type: "expansion", signal_category: "expansion", subject_type: "company",
  subject_key: company.toLowerCase(), company_name: company, company_domain: null,
  title: `${company} opens a new office`, description: `${company}, a ${industryText} company, expands.`, event_date: "2026-11-20",
  discovered_at: "2026-11-21T00:00:00Z", source_url: "https://news.example/x", source_type: "news", evidence: [],
  verification: { level: "single_source" }, relevance: null, dedupe_key: "k", event_instance: "e", lifecycle_status: "active",
  collection_method: "lisa_v2_on_demand", provider: "fixture", processing_status: "new", watch_origin: "icp",
} as unknown as LisaSignal);

/** What each consumer builds, each from its OWN load — as the functions do. */
async function everyAgent(ws: string, userId: string, now = new Date()) {
  const svc = await as("service_role");
  const db = svc as unknown as LoaderDb;
  const chat = await loadChatBrain(svc as never, ws, userId, now);                                   // pilot-chat (ORION)
  const brief = (await loadCompanyBrainContext(db, ws, { skipMembershipCheck: true, now })).context!; // daily-brief (ORION)
  const lyra = (await loadCompanyBrainContext(db, ws, { skipMembershipCheck: true, now })).context!;  // run-agent content (LYRA)
  const radar = (await loadCompanyBrainContext(db, ws, { skipMembershipCheck: true, now })).context!; // run-radar-scan (LISA)
  const mon = (await loadCompanyBrainContext(db, ws, { skipMembershipCheck: true, now })).context!;   // run-monitoring-scan (LISA)
  return {
    ids: [chat.shared!.context_id, brief.context_id, lyra.context_id, radar.context_id, mon.context_id],
    orionChat: chat.memoryBlock,
    orionBrief: renderBrainMemoryBlock(brief, "orion"),
    lyraBlock: renderBrainMemoryBlock(lyra, "lyra"),
    lyraContent: renderContentBrain(lyra.effective_profile, { onboardingCompleted: true, useCompanyBrain: true }),
    lyraTone: (lyra.effective_profile.brand_voice as { tone?: string } | undefined)?.tone,
    radarPrefs: lisaRadarPreferences(radar, radarBase),
    radarCompiled: compileCompanyBrainContext({ workspace_id: ws, profile: radar.effective_profile }),
    monitoring: lisaView(mon),
    monitoringCompiled: compileCompanyBrainContext({ workspace_id: ws, profile: mon.effective_profile }),
    relevanceGambling: evaluateRelevance(signal("LuckySpin", "gambling"), mon, { kind: "market", origin: "icp" }, now),
    relevanceCrypto: evaluateRelevance(signal("CoinCo", "crypto"), mon, { kind: "market", origin: "icp" }, now),
    stamp: agentBrainStamp(mon, "lisa"),
  };
}

Deno.test("B2.4: an approved preference reaches every agent it is meant for, from ONE context id; unservable knowledge reaches none", opts, async () => {
  const t = await team(PROFILE);
  await sql`update public.company_brain set onboarding_completed = true where workspace_id = ${t.ws}`;
  const [{ profile: storedBefore }] = await sql`select profile from public.company_brain where workspace_id = ${t.ws}`;
  const atlasBefore = { a: compilerBrainContext(storedBefore as never), b: contractBrainInput(storedBefore as never) };

  // Approved knowledge: ORION's offer (approved), a tone the team set, LISA's competitor (approved).
  const svc = await as("service_role");
  const offer = await offerMemoryFromTurn(svc as never, { workspaceId: t.ws, conversationId: uuid(), messageId: null,
    message: "From now on, never target gambling companies.", profile: PROFILE });
  assertEquals((await review(t.ws, t.editor, offer!.proposal_id!, "approve")).outcome, "ok");
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "plain and technical" });
  const lisaProp = (await svc.rpc("company_brain_proposal_submit", { p_workspace_id: t.ws, p_agent: "lisa", p_payload: {
    kind: "fact", category: "competitors", fact_key: "competitor:fleetbot.example", value_type: "object", value: { name: "FleetBot", domain: "fleetbot.example" },
    rationale: "Monitored as a competitor, not in the Brain.", evidence: [{ source_ref: "monitoring_subject:fleetbot.example" }], source_type: "agent_suggestion",
  } })).data as { proposal_id: string };
  assertEquals((await review(t.ws, t.editor, lisaProp.proposal_id, "approve")).outcome, "ok");

  // NOT servable: an expired temporary exclusion, a disputed fact, a fact past its review date, a pending proposal.
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:crypto", value_type: "object",
    value: { type: "industry", value: "Crypto" }, persistence: "temporary", expires_at: "2026-01-01T00:00:00Z" });
  const disputed = await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.hq", value_type: "text", value: "Our HQ is in Lisbon" });
  await memoryWrite(t.ws, t.owner, "dispute", { memory_id: disputed.memory_id, expected_version: 1 });
  await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.team", value_type: "text", value: "We have 12 employees", review_at: "2026-01-01T00:00:00Z" });
  await offerMemoryFromTurn(svc as never, { workspaceId: t.ws, conversationId: uuid(), messageId: null, message: "Never mention pricing in posts", profile: PROFILE });

  const v = await everyAgent(t.ws, t.owner.id);

  // ONE Brain: every consumer, each from its own load, was given the same context.
  assertEquals(new Set(v.ids).size, 1, JSON.stringify(v.ids));
  assert(/^bctx1-[a-p]{16}$/.test(v.ids[0]));
  assertEquals(v.stamp, { agent: "lisa", brain_context_id: v.ids[0], brain_fingerprint: v.stamp.brain_fingerprint, brain_status: "incomplete" }); // the fixture is not a complete Brain

  // The exclusion ORION was told and a person approved: ORION, LYRA and LISA all honour it.
  for (const block of [v.orionChat, v.orionBrief, v.lyraBlock]) assert(block.includes("Gambling"), block);
  assert(v.radarPrefs.disqualifiers.includes("Gambling"), JSON.stringify(v.radarPrefs));
  assert(v.monitoring.exclusions.industries.includes("Gambling"));
  assert(JSON.stringify(v.radarCompiled).includes("Gambling") && JSON.stringify(v.monitoringCompiled).includes("Gambling"), "both LISA scans compile it");
  assertEquals(v.relevanceGambling.band, "excluded", "LISA's manual-signal relevance skips it");
  assertEquals(v.relevanceGambling.brain_context_id, v.ids[0], "and records which Brain decided it");

  // The tone is content-only: LYRA writes with it; ORION's and LISA's views do not carry it.
  assertEquals(v.lyraTone, "plain and technical");
  assert(v.lyraContent.includes("plain and technical") && v.lyraBlock.includes("plain and technical"));
  assertFalse(v.orionBrief.includes("plain and technical"));

  // LISA's approved competitor reaches ORION, LYRA and both LISA scans.
  for (const block of [v.orionChat, v.lyraBlock]) assert(block.includes("FleetBot"));
  assert(v.radarPrefs.competitors.includes("FleetBot") && v.radarPrefs.competitors.includes("Rivalco"));
  assert(v.monitoring.competitors.some((c) => c.name === "FleetBot"));

  // Unservable knowledge reaches nobody.
  for (const text of [v.orionChat, v.orionBrief, v.lyraBlock, v.lyraContent, JSON.stringify(v.radarPrefs), JSON.stringify(v.monitoring)]) {
    for (const hidden of ["Crypto", "Lisbon", "12 employees", "Never mention pricing"]) assertFalse(text.includes(hidden), `${hidden} leaked`);
  }
  assertNotEquals(v.relevanceCrypto.band, "excluded", "an expired exclusion no longer excludes");

  // ATLAS's request authority is the stored profile, untouched by memory.
  const [{ profile: storedAfter }] = await sql`select profile from public.company_brain where workspace_id = ${t.ws}`;
  assertEquals({ a: compilerBrainContext(storedAfter as never), b: contractBrainInput(storedAfter as never) }, atlasBefore);
});

Deno.test("B2.4: a newer ICP preference moves every agent together; the context id changes once, for all", opts, async () => {
  const t = await team(PROFILE);
  await sql`update public.company_brain set onboarding_completed = true where workspace_id = ${t.ws}`;
  const before = await everyAgent(t.ws, t.owner.id);
  assertEquals(before.radarCompiled.icp.company_size_min, 5);
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "icp", fact_key: "icp.company_size", value_type: "number_range", value: { min: 200, max: 500 } });
  const after = await everyAgent(t.ws, t.owner.id);
  assertEquals(new Set(after.ids).size, 1);
  assertNotEquals(after.ids[0], before.ids[0], "a new served context, a new id");
  for (const c of [after.radarCompiled, after.monitoringCompiled]) assertEquals([c.icp.company_size_min, c.icp.company_size_max], [200, 500]);
  assert(after.orionBrief.includes("icp.company_size") && after.orionChat.includes("200"), "ORION is told the newer preference");
});

Deno.test("B2.4: freshness is part of the context — an item crossing its review date changes the id; a pending proposal does not", opts, async () => {
  const t = await team(PROFILE);
  await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "company_facts", fact_key: "fact.team", value_type: "text",
    value: "We have 12 employees", review_at: "2026-12-01T00:00:00Z" });
  const svc = await as("service_role");
  const load = async (now: Date) => (await loadCompanyBrainContext(svc as unknown as LoaderDb, t.ws, { skipMembershipCheck: true, now })).context!;
  const early = await load(new Date("2026-11-22T00:00:00Z"));
  const late = await load(new Date("2026-12-02T00:00:00Z"));
  assertEquals(early.fingerprint, late.fingerprint, "the old fingerprint cannot see it");
  assertNotEquals(early.context_id, late.context_id, "the context id does: the fact stopped being served");
  assert(renderBrainMemoryBlock(early, "orion").includes("12 employees"));
  assertFalse(renderBrainMemoryBlock(late, "orion").includes("12 employees"));
  await offerMemoryFromTurn(svc as never, { workspaceId: t.ws, conversationId: uuid(), messageId: null, message: "Never mention pricing in posts", profile: PROFILE });
  assertEquals((await load(new Date("2026-11-22T00:00:00Z"))).context_id, early.context_id, "a pending proposal serves nothing, so the id is unchanged");
});

Deno.test("B2.4: another workspace's agents get their own context; a non-member's chat gets none", opts, async () => {
  const a = await team(PROFILE); const b = await team(PROFILE);
  const svc = await as("service_role");
  const offer = await offerMemoryFromTurn(svc as never, { workspaceId: a.ws, conversationId: uuid(), messageId: null, message: "From now on, never target gambling companies.", profile: PROFILE });
  await review(a.ws, a.editor, offer!.proposal_id!, "approve");
  const va = await everyAgent(a.ws, a.owner.id); const vb = await everyAgent(b.ws, b.owner.id);
  assertNotEquals(va.ids[0], vb.ids[0]);
  assertFalse(vb.monitoring.exclusions.industries.includes("Gambling"));
  const outsider = await loadChatBrain(svc as never, a.ws, b.owner.id);
  assertEquals([outsider.shared, outsider.memoryBlock], [null, ""]);
});
