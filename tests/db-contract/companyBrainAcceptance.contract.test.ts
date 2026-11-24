// Company Brain V1 — END-TO-END ACCEPTANCE SCENARIOS A–G.
//
// Real Postgres + PostgREST + the real supabase-js client, driving the REAL
// modules every agent uses: the shared loader, the four agent views, ORION's
// collectExecutiveContext + synthesizeExecutiveBrief, LISA's proposal builder
// and submitter, and the ATLAS opt-in contract. Writes go through the same
// SECURITY DEFINER functions the company-brain-memory edge function calls.
// Fictional companies only; no provider, no model, no network beyond localhost.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  as, competitorProposal, key, memoryWrite, opts, propose, review, sizePref, sql, team,
} from "./lib/brainMemory.ts";
import { seedWorkspace } from "./lib/harness.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { atlasView, lisaView, lyraView, orionView, renderBrainMemoryBlock } from "../../supabase/functions/_shared/companyBrainAgentViews.ts";
import { collectExecutiveContext, type BriefDb } from "../../supabase/functions/_shared/executiveBriefContext.ts";
import { synthesizeExecutiveBrief } from "../../supabase/functions/_shared/executiveBrief.ts";
import { competitorProposalsFromMonitoring, submitProposals } from "../../supabase/functions/_shared/lisaBrainProposals.ts";
import { getCompiledCompanyBrainWithMemory } from "../../supabase/functions/_shared/atlasBrainContract.ts";

const NORTHWIND = {
  schema_version: 2,
  company: { name: "Northwind Robotics", description: "Shelf-picking robots for mid-size warehouses" },
  target_customer: { industries: ["Manufacturing", "Logistics"], company_size: { min: 10, max: 50 }, geography: ["Nordics"] },
  competitors: ["Rivalco"],
  goals: { gtm: "Win 10 manufacturing customers this quarter" },
  brand_voice: { tone: "plain, technical", avoid: ["hype"] },
  positioning: { promise: "Double pick rates without new headcount" },
};

async function load(ws: string) {
  const svc = await as("service_role");
  const r = await loadCompanyBrainContext(svc as unknown as LoaderDb, ws, { skipMembershipCheck: true });
  assert(r.ok);
  return r.context;
}
async function brief(ws: string) {
  const svc = await as("service_role");
  const ctx = await collectExecutiveContext(svc as unknown as BriefDb, ws);
  return { ctx, brief: synthesizeExecutiveBrief(ctx) };
}
async function seedLead(ws: string, name: string, industry: string, reason: string) {
  const [acc] = await sql`insert into public.accounts (workspace_id, name, domain, industry)
    values (${ws}, ${name}, ${name.toLowerCase().replace(/[^a-z]+/g, "") + ".example"}, ${industry}) returning id`;
  const [lead] = await sql`insert into public.lead_candidates (workspace_id, account_id, status, fit_score, priority, reason)
    values (${ws}, ${acc.id}, 'new', 0.8, 'high', ${reason}) returning id`;
  return { account: String(acc.id), lead: String(lead.id) };
}

// ── A ─────────────────────────────────────────────────────────────────────────
Deno.test("A — new customer: all four agents read the right workspace's Brain", opts, async () => {
  const t = await team(NORTHWIND);
  const other = await team({ schema_version: 2, company: { name: "Casino Vista" }, target_customer: { industries: ["Gambling"] } });
  const c = await load(t.ws);
  assertEquals(c.status === "missing", false);
  assertEquals(c.canonical.target_customer.industries, ["Manufacturing", "Logistics"]);
  assertEquals(atlasView(c).company_size, { min: 10, max: 50 });
  assertEquals(lisaView(c).competitors.map((x) => x.name), ["Rivalco"]);
  assertEquals(lyraView(c).brand_voice.tone, "plain, technical");
  const { brief: b } = await brief(t.ws);
  assertEquals(b.brain.company, "Northwind Robotics");
  assertEquals(b.brain.goals, ["Win 10 manufacturing customers this quarter"]);
  for (const agent of ["orion", "atlas", "lyra", "lisa"] as const) {
    assertFalse(renderBrainMemoryBlock(c, agent).includes("Casino"), `${agent} sees nothing of the other workspace`);
  }
  assertFalse(JSON.stringify(c).includes("Gambling"));
  void other;
});

// ── B ─────────────────────────────────────────────────────────────────────────
Deno.test("B — ICP change: a new company-size preference reaches ATLAS, LISA and ORION; a later profile edit wins back", opts, async () => {
  const t = await team(NORTHWIND);
  const a = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50, { reason: "initial" }));
  await memoryWrite(t.ws, t.editor, "set", sizePref(50, 200, { expected_version: a.version, reason: "moving upmarket" }));
  let c = await load(t.ws);
  assertEquals(atlasView(c).company_size, { min: 50, max: 200 }, "ATLAS gets the new size");
  assertEquals(c.canonical.target_customer.company_size, { min: 50, max: 200 }, "every canonical reader does");
  assert(atlasView(c).icp_changed_at, "ATLAS can see when the ICP changed");
  const atlas = await getCompiledCompanyBrainWithMemory(await as("service_role") as unknown as LoaderDb, t.ws, { skipMembershipCheck: true });
  assert(atlas.ok); assertEquals(atlas.brain.target_customer.company_size, { min: 50, max: 200 });

  // Newest wins: the owner then edits the profile's ICP directly (through the authorized writer).
  const svc = await as("service_role");
  const [{ v }] = await sql`select updated_at::text v from public.company_brain where workspace_id = ${t.ws}`;
  const { error } = await svc.rpc("company_brain_authorized_write", {
    p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_permission: "edit", p_mode: "cas",
    p_profile: { ...NORTHWIND, target_customer: { ...NORTHWIND.target_customer, company_size: { min: 200, max: 1000 } } },
    p_expected_updated_at: v, p_activate: false,
  });
  assertEquals(error, null);
  c = await load(t.ws);
  assertEquals(atlasView(c).company_size, { min: 200, max: 1000 }, "the person's latest change wins, whichever surface they used");
});

// ── C ─────────────────────────────────────────────────────────────────────────
Deno.test("C — user rejection: recorded once, scoped to that lead, and ORION stops recommending it", opts, async () => {
  const t = await team(NORTHWIND);
  const keep = await seedLead(t.ws, "Fjord Metals", "Manufacturing", "Hiring warehouse ops leads");
  const reject = await seedLead(t.ws, "Nordic Steelworks", "Manufacturing", "Expanding plant floor");
  const before = await brief(t.ws);
  assertEquals(before.ctx.leads.map((l) => l.id).sort(), [keep.lead, reject.lead].sort());

  const idem = key();
  const d = { category: "lead_rejected", scope: "lead", scope_ref: reject.lead,
    value: { outcome: "rejected", subject: { type: "lead", ref: reject.lead, label: "Nordic Steelworks" }, note: "already a customer of Rivalco" } };
  assertEquals((await memoryWrite(t.ws, t.owner, "decide", d, idem)).outcome, "ok");
  assertEquals((await memoryWrite(t.ws, t.owner, "decide", d, idem)).replayed, true, "a double-click is one decision");
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory where workspace_id = ${t.ws} and kind = 'decision'`)[0].n, 1);

  const c = await load(t.ws);
  assertEquals(atlasView(c).rejected_lead_refs, [reject.lead]);
  assertEquals(atlasView(c).exclusions.industries, [], "NOT generalised into a Manufacturing exclusion");
  assertEquals(c.canonical.target_customer.industries, ["Manufacturing", "Logistics"], "the ICP is unchanged");
  const after = await brief(t.ws);
  assertEquals(after.ctx.leads.map((l) => l.id), [keep.lead], "the rejected lead is left out; its industry peer is not");
  const inf = after.brief.brain.influences ?? [];
  assert(inf.some((i) => i.fact === "You rejected this lead" && i.items.includes(`lead_candidates:${reject.lead}`)));
  assert(after.brief.confidence.notes.some((n) => n.includes("Company Brain memory shaped this brief")));
});

// ── D ─────────────────────────────────────────────────────────────────────────
Deno.test("D — agent proposal: LISA's competitor stays untrusted until an editor approves it", opts, async () => {
  const t = await team(NORTHWIND);
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals)
    values (${t.ws}, 'competitor', 'fleetbot.io', 'FleetBot', ${sql.json([{ event: "funding", subject: "company" }] as never)})`;
  const subjects = await sql`select subject_kind kind, identifier, label from public.monitoring_subjects where workspace_id = ${t.ws}`;
  const before = await load(t.ws);
  const proposals = competitorProposalsFromMonitoring(subjects as never, before.competitors, () => null);
  const svc = await as("service_role");
  const submitted = await submitProposals(svc as never, t.ws, "lisa", proposals);
  assertEquals(submitted, [{ fact_key: "competitor:fleetbot.io", outcome: "created" }]);
  assertEquals((await submitProposals(svc as never, t.ws, "lisa", proposals))[0].outcome, "duplicate_pending", "the next pass does not duplicate it");

  let c = await load(t.ws);
  assertEquals(c.pending_proposals, 1);
  assertEquals(c.competitors.map((x) => x.name), ["Rivalco"], "pending knowledge reaches no agent");
  assertFalse(renderBrainMemoryBlock(c, "lisa").includes("FleetBot"));

  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${t.ws}`;
  assertEquals((await review(t.ws, t.viewer, String(p.id), "approve")).outcome, "forbidden_role");
  assertEquals((await review(t.ws, t.editor, String(p.id), "approve")).outcome, "ok");

  c = await load(t.ws);
  assertEquals(c.competitors.map((x) => x.name), ["Rivalco", "FleetBot"]);
  assertEquals(c.competitors[1].source, "approved lisa agent suggestion");
  assertStringIncludes(renderBrainMemoryBlock(c, "lisa"), "FleetBot (fleetbot.io)");
  const { brief: b } = await brief(t.ws);
  assertEquals(b.brain.company, "Northwind Robotics");
  const { ctx } = await brief(t.ws);
  assert(ctx.brain.competitors.includes("FleetBot"), "ORION now tracks it");
  assert(ctx.brain.competitor_domains?.includes("fleetbot.io"));
});

// ── E ─────────────────────────────────────────────────────────────────────────
Deno.test("E — incorrect information: a retracted fact and a retracted competitor stop reaching every agent", opts, async () => {
  const t = await team(NORTHWIND);
  const fact = await memoryWrite(t.ws, t.owner, "set", {
    kind: "fact", category: "products", fact_key: "product.pickbot", value_type: "text", value: "PickBot 3 doubles pick rates", source_url: "https://northwind.example/pickbot",
  });
  const p = await propose(t.ws, "lisa", competitorProposal("fleetbot.io"));
  await review(t.ws, t.owner, String(p.proposal_id), "approve");
  let c = await load(t.ws);
  assertStringIncludes(renderBrainMemoryBlock(c, "lyra"), "PickBot 3");
  assert(c.competitors.some((x) => x.name === "fleetbot"));

  assertEquals((await memoryWrite(t.ws, t.owner, "retract", { memory_id: fact.memory_id, expected_version: 1, reason: "claim not substantiated" })).outcome, "ok");
  const [comp] = await sql`select id, version from public.company_brain_memory where workspace_id = ${t.ws} and category = 'competitors'`;
  assertEquals((await memoryWrite(t.ws, t.owner, "retract", { memory_id: comp.id, expected_version: comp.version, reason: "a partner" })).outcome, "ok");

  c = await load(t.ws);
  for (const agent of ["orion", "atlas", "lyra", "lisa"] as const) {
    const block = renderBrainMemoryBlock(c, agent);
    assertFalse(block.includes("PickBot"), `${agent}: retracted product fact gone`);
    assertFalse(block.includes("fleetbot"), `${agent}: retracted competitor gone`);
  }
  assertEquals(lyraView(c).claimable_facts, []);
  assertFalse(c.competitors.some((x) => x.name === "fleetbot"));
  const { ctx } = await brief(t.ws);
  assertFalse(ctx.brain.competitors.includes("fleetbot"));
  // …and the history still says what was believed, and why it was withdrawn.
  const h = await sql`select change_kind, reason from public.company_brain_memory_history where memory_id = ${fact.memory_id as string} order by created_at`;
  assertEquals(h.map((x) => x.change_kind), ["created", "retracted"]);
  assertEquals(h[1].reason, "claim not substantiated");
});

// ── F ─────────────────────────────────────────────────────────────────────────
Deno.test("F — missing Brain: every agent is told plainly, nothing is invented", opts, async () => {
  const ws = await seedWorkspace();
  const c = await load(ws);
  assertEquals(c.status, "missing");
  assertEquals(c.canonical.setup_required, true);
  assertEquals(atlasView(c).industries, []); assertEquals(atlasView(c).exclusions.industries, []);
  assertEquals(lisaView(c).competitors, []); assertEquals(lyraView(c).claimable_facts, []);
  assertEquals(orionView(c).goals, []);
  for (const agent of ["orion", "atlas", "lyra", "lisa"] as const) {
    assertStringIncludes(renderBrainMemoryBlock(c, agent), "no Company Brain yet");
  }
  const { brief: b } = await brief(ws);
  assertEquals(b.brain.used, false);
  assert(b.confidence.notes.some((n) => n.includes("Company Brain is incomplete")));
});

// ── G ─────────────────────────────────────────────────────────────────────────
Deno.test("G — two workspaces with conflicting preferences: each agent gets only its own", opts, async () => {
  const a = await team(NORTHWIND);
  const b = await team({ schema_version: 2, company: { name: "Defense Dynamics" }, target_customer: { industries: ["Defense"] } });
  await memoryWrite(a.ws, a.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:defense",
    value_type: "object", value: { type: "industry", value: "Defense" } });
  await memoryWrite(b.ws, b.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:manufacturing",
    value_type: "object", value: { type: "industry", value: "Manufacturing" } });
  await memoryWrite(a.ws, a.owner, "set", { kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "warm and plain" });
  await memoryWrite(b.ws, b.owner, "set", { kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "formal and terse" });

  const [ca, cb] = [await load(a.ws), await load(b.ws)];
  assertEquals(atlasView(ca).exclusions.industries, ["Defense"]);
  assertEquals(atlasView(cb).exclusions.industries, ["Manufacturing"]);
  assertEquals(lyraView(ca).brand_voice.tone, "warm and plain");
  assertEquals(lyraView(cb).brand_voice.tone, "formal and terse");
  assertFalse(JSON.stringify(ca).includes("formal and terse")); assertFalse(JSON.stringify(cb).includes("warm and plain"));
  assert(ca.canonical.disqualifiers.industries.some((d) => /defense/i.test(d)));

  // ORION in A demotes a Defense account with a visible reason; B's brief is untouched by A's exclusions.
  const def = await seedLead(a.ws, "Aegis Systems", "Defense", "Big warehouse");
  const { ctx } = await brief(a.ws);
  const l = ctx.leads.find((x) => x.id === def.lead)!;
  assert(l.reasons.some((r) => r.startsWith("matches an exclusion you set")), "excluded, and ORION says why");
  const { brief: bb } = await brief(b.ws);
  assertEquals(bb.brain.influences, []);
});


// ── H ─────────────────────────────────────────────────────────────────────────
Deno.test("H — staleness and expiry, read from the real rows: an old fact needs review and reaches no agent; an expired temporary preference stops applying", opts, async () => {
  const t = await team(NORTHWIND);
  const old = await memoryWrite(t.ws, t.owner, "set", { kind: "fact", category: "competitors", fact_key: "competitor:oldrival.io",
    value_type: "object", value: { name: "OldRival", domain: "oldrival.io" } });
  const temp = await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.geography:germany",
    value_type: "object", value: { type: "geography", value: "Germany" }, persistence: "temporary", expires_at: "2099-01-01T00:00:00Z" });
  let c = await load(t.ws);
  assert(c.competitors.some((x) => x.name === "OldRival")); assertEquals(atlasView(c).exclusions.geographies, ["Germany"]);
  // Time passes (the rows say so; staleness and expiry are computed when read — no cron).
  await sql`update public.company_brain_memory set observed_at = now() - interval '400 days' where id = ${old.memory_id as string}`;
  await sql`update public.company_brain_memory set expires_at = now() - interval '1 minute' where id = ${temp.memory_id as string}`;
  c = await load(t.ws);
  assertFalse(c.competitors.some((x) => x.name === "OldRival"), "a stale fact is not served");
  assertEquals(c.needs_review.map((m) => m.fact_key), ["competitor:oldrival.io"], "…and is flagged for a person");
  assertEquals(atlasView(c).exclusions.geographies, [], "an expired temporary exclusion no longer applies");
  for (const agent of ["orion", "atlas", "lyra", "lisa"] as const) assertFalse(renderBrainMemoryBlock(c, agent).includes("OldRival"));
  // A person confirms it is still true ("Still true" in the UI = reactivate): a new, versioned observation.
  const re = await memoryWrite(t.ws, t.owner, "reactivate", { memory_id: old.memory_id, expected_version: 1, reason: "still competing" });
  assertEquals(re.outcome, "ok"); assertEquals(re.version, 2);
  c = await load(t.ws);
  assert(c.competitors.some((x) => x.name === "OldRival"), "served again after a person re-confirmed it");
  assertEquals(c.needs_review, []);
  const h = await sql`select change_kind, reason from public.company_brain_memory_history where memory_id = ${old.memory_id as string} order by created_at`;
  assertEquals(h.map((x) => x.change_kind), ["created", "reactivated"]);
});
