// LISA audit — the 12 scenarios against a REAL database.
//
//   PG_ADMIN_URL=… POSTGREST_BIN=… tests/db-contract/run.sh docs/audits/lisa-complete-audit-2026-11/lisaScenarios.contract.test.ts
//
// Real Postgres 17 + PostgREST + supabase-js, the real signal writer
// (signalsV2Writer), the real ORION collector, the real Company Brain loader and
// LISA proposal path (branch), and the ACTUAL run-monitoring-scan and
// run-monitoring-tick handlers captured from Deno.serve behind a gateway that
// refuses every non-loopback request. Fictional data. Nothing is bought.
//
// Each test asserts what happens TODAY. Tests named "DEFECT" pass while the
// defect is present; they document, they do not endorse.
/* eslint-disable @typescript-eslint/no-explicit-any -- probe code */
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "../../../tests/db-contract/lib/captureServe.ts";
import "../../../supabase/functions/run-monitoring-scan/index.ts";
import "../../../supabase/functions/run-monitoring-tick/index.ts";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "../../../tests/db-contract/lib/harness.ts";
import { as, memoryWrite, opts, person, propose, review, team } from "../../../tests/db-contract/lib/brainMemory.ts";
import { writeSignalEventV2 } from "../../../supabase/functions/_shared/signalsV2Writer.ts";
import { projectCanonicalEvents } from "../../../supabase/functions/_shared/canonicalSignalEvent.ts";
import { collectExecutiveContext, type BriefDb } from "../../../supabase/functions/_shared/executiveBriefContext.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { competitorProposalsFromMonitoring, submitProposals } from "../../../supabase/functions/_shared/lisaBrainProposals.ts";

const [scanHandler, tickHandler] = captured;
restoreServe();
assertEquals(captured.length, 2);

// ── gateway: loopback only; the tick's call to the scan is recorded, not run ─
const GATEWAY = "http://supabase-gateway.test";
let external: string[] = [];
let scanCalls: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith(GATEWAY + "/rest/v1/")) return realFetch(new Request(REST_URL + req.url.slice((GATEWAY + "/rest/v1").length), req));
  if (req.url.startsWith(GATEWAY + "/functions/v1/run-monitoring-scan")) {
    scanCalls.push(await req.json().catch(() => ({})));
    return Response.json({ ok: true, recorded: true });
  }
  if (req.url.startsWith(GATEWAY + "/auth/v1/user")) {
    const sub = JSON.parse(atob((req.headers.get("Authorization") ?? "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
    return Response.json({ id: sub, aud: "authenticated", role: "authenticated" });
  }
  if (req.url.startsWith(REST_URL)) return realFetch(req);
  external.push(req.url);
  throw new Error(`external request refused: ${req.url}`);
};
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY", "LEADOCEAN_API_KEY"]) Deno.env.delete(k);
const SERVICE = await mintJwt("service_role");
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", await mintJwt("anon"));
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
Deno.env.set("SIGNALS_V2", "true");

const userJwt = (id: string) => mintJwt("authenticated", id);
async function callScan(bearer: string, body: Record<string, unknown>) {
  const r = await scanHandler(new Request("http://edge.test/run-monitoring-scan", { method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as Record<string, any> };
}
async function callTick(body: Record<string, unknown>) {
  const r = await tickHandler(new Request("http://edge.test/run-monitoring-tick", { method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() as Record<string, any> };
}
const NORTHWIND = { schema_version: 2, company: { name: "Northwind Robotics", description: "Shelf-picking robots" },
  target_customer: { industries: ["Manufacturing"] }, competitors: ["Rivalco"], goals: { gtm: "Win manufacturing customers" } };
const svc = () => as("service_role");
const brief = async (ws: string) => collectExecutiveContext(await svc() as unknown as BriefDb, ws);
async function writeMonitorEvent(ws: string, signal: string, occurred: string, subject: any = { subject_type: "competitor", subject_key: "rivalco-com", subject_identifier: "rivalco.com" }) {
  const [input] = projectCanonicalEvents({ workspace_id: ws, origin: "scheduled_monitor", subject, company_name: "Rivalco",
    assessments: [{ signal, verdict: "verified", evidence_ids: ["ev"], occurred_at: occurred }] });
  return await writeSignalEventV2({ admin: await svc(), enabled: true } as any, input as any);
}
const events = async (ws: string) => await sql`select * from public.signal_events where workspace_id = ${ws} order by created_at`;

// ── 1 ────────────────────────────────────────────────────────────────────────
Deno.test("1 new competitor discovered (branch): a monitored competitor missing from the Brain becomes a PENDING proposal only", opts, async () => {
  const t = await team(NORTHWIND);
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals)
    values (${t.ws}, 'competitor', 'fleetbot.io', 'FleetBot', ${sql.json([{ event: "hiring", subject: "company" }] as never)})`;
  const loaded = await loadCompanyBrainContext(await svc() as unknown as LoaderDb, t.ws, { skipMembershipCheck: true });
  assert(loaded.ok);
  const subs = await sql`select subject_kind kind, identifier, label from public.monitoring_subjects where workspace_id = ${t.ws}`;
  const out = await submitProposals(await svc() as never, t.ws, "lisa", competitorProposalsFromMonitoring(subs as never, loaded.context.competitors, () => null));
  assertEquals(out, [{ fact_key: "competitor:fleetbot.io", outcome: "created" }]);
  const again = await loadCompanyBrainContext(await svc() as unknown as LoaderDb, t.ws, { skipMembershipCheck: true });
  assert(again.ok); assertEquals(again.context.competitors.map((c) => c.name), ["Rivalco"], "not trusted until reviewed");
  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${t.ws}`;
  assertEquals((await review(t.ws, t.editor, String(p.id), "approve")).outcome, "ok");
  const after = await loadCompanyBrainContext(await svc() as unknown as LoaderDb, t.ws, { skipMembershipCheck: true });
  assert(after.ok); assert(after.context.competitors.some((c) => c.domain === "fleetbot.io"));
});

// ── 2 ────────────────────────────────────────────────────────────────────────
Deno.test("2 DEFECT: a competitor's Series B (months after Series A) is silently deduplicated away by the real writer", opts, async () => {
  const ws = await seedWorkspace();
  const a = await writeMonitorEvent(ws, "funding/company", new Date(Date.now() - 300 * 86_400_000).toISOString());
  const b = await writeMonitorEvent(ws, "funding/company", new Date(Date.now() - 2 * 86_400_000).toISOString());
  assertEquals(a.written, true);
  assertEquals(b.written, false); assertEquals(b.deduplicated, true);
  const rows = await events(ws);
  assertEquals(rows.length, 1, "one row: the newer round is lost");
  assert(String(rows[0].occurred_at.toISOString()) < new Date(Date.now() - 200 * 86_400_000).toISOString(), "the surviving row is the OLD round");
});

// ── 3 ────────────────────────────────────────────────────────────────────────
Deno.test("3 pricing change: the schema has no signal type for it — even a direct insert is refused", opts, async () => {
  const ws = await seedWorkspace();
  let refused = false;
  try {
    await sql`insert into public.signal_events (workspace_id, signal_type, signal_category, dedupe_key, origin, subject_type, subject_key, occurred_at_basis)
      values (${ws}, 'pricing_change', 'market', 'k', 'scheduled_monitor', 'competitor', 'rivalco-com', 'unknown')`;
  } catch { refused = true; }
  assert(refused, "signal_events_type_valid has no pricing type");
});

// ── 4 ────────────────────────────────────────────────────────────────────────
Deno.test("4 duplicate announcement: the same fact twice is one event — and no evidence row is kept for either observation", opts, async () => {
  const ws = await seedWorkspace();
  const when = new Date(Date.now() - 3 * 86_400_000).toISOString();
  assertEquals((await writeMonitorEvent(ws, "product_launch/company", when)).written, true);
  assertEquals((await writeMonitorEvent(ws, "product_launch/company", when)).deduplicated, true);
  assertEquals((await events(ws)).length, 1);
  assertEquals((await events(ws))[0].source_url, null, "no source URL on a monitoring event");
  assertEquals((await sql`select count(*)::int n from public.signal_event_evidence where workspace_id = ${ws}`)[0].n, 0);
});

// ── 6 ────────────────────────────────────────────────────────────────────────
Deno.test("6 DEFECT: dismissing a canonical signal fails (review FK points at legacy signals); a teammate still sees it", opts, async () => {
  const t = await team(NORTHWIND);
  await writeMonitorEvent(t.ws, "product_launch/company", new Date(Date.now() - 86_400_000).toISOString());
  const [e] = await events(t.ws);
  const editor = await as("authenticated", t.editor.id);
  const { error } = await editor.from("signal_reviews").insert({ workspace_id: t.ws, signal_id: e.id, user_id: t.editor.id, status: "ignored" });
  assert(error, "the dismissal is refused");
  assert(/foreign key|violates/i.test(error!.message), error!.message);
  const owner = await as("authenticated", t.owner.id);
  const { data } = await owner.from("signal_events").select("id").eq("workspace_id", t.ws).eq("lifecycle_status", "active");
  assertEquals(data?.length, 1, "the signal is still active for everyone");
  // Company Brain V1 (branch): the dismissal recorded as a scoped decision does reach ORION.
  assertEquals((await brief(t.ws)).signals.length, 1);
  await memoryWrite(t.ws, t.editor, "decide", { category: "signal_dismissed", scope: "signal", scope_ref: e.id, value: { outcome: "dismissed" } });
  assertEquals((await brief(t.ws)).signals.length, 0, "branch only: ORION leaves it out once the decision exists");
});

// ── 7 ────────────────────────────────────────────────────────────────────────
Deno.test("7 P0 DEFECT: a VIEWER can retract any signal for the whole workspace, and forge a 'provider-verified' one that ORION boosts", opts, async () => {
  const t = await team(NORTHWIND);
  await writeMonitorEvent(t.ws, "product_launch/company", new Date(Date.now() - 86_400_000).toISOString());
  const [e] = await events(t.ws);
  const viewer = await as("authenticated", t.viewer.id);
  const upd = await viewer.from("signal_events").update({ lifecycle_status: "retracted" }).eq("id", e.id).select("id");
  assertEquals(upd.error, null); assertEquals(upd.data?.length, 1, "a viewer's PATCH lands");
  assertEquals((await brief(t.ws)).signals.length, 0, "…and every consumer stops seeing it");
  const forged = await viewer.from("signal_events").insert({
    workspace_id: t.ws, signal_type: "recent_funding", signal_category: "growth", origin: "manual_scan",
    subject_type: "competitor", subject_key: "rivalco-com", dedupe_key: `forged-${uuid()}`, occurred_at: new Date().toISOString(),
    occurred_at_basis: "source_reported", verification_status: "provider_verified", confidence: "high", lifecycle_status: "active",
    normalized_value: { title: "Rivalco raised $500M (forged)", company_name: "Rivalco" },
  }).select("id");
  assertEquals(forged.error, null, "a viewer can insert a signal");
  const sig = (await brief(t.ws)).signals.find((s: any) => s.id === forged.data![0].id)!;
  assert(sig.reasons.includes("verified by the data provider"), "ORION presents the forgery as provider-verified");
  assert(sig.reasons.includes("a competitor you track"));
});

// ── 8 ────────────────────────────────────────────────────────────────────────
Deno.test("8 ICP change: collection re-reads the Brain, but stored relevance verdicts are never invalidated", opts, async () => {
  const t = await team(NORTHWIND);
  await sql`insert into public.signal_cluster_relevance (workspace_id, cluster_key, relevance, why_it_matters, deterministic_priority, adjusted_priority, source, evidence_event_ids)
    values (${t.ws}, 'competitor|rivalco-com', 'high', 'Fits your manufacturing ICP', 80, 80, 'deterministic', '{}')`;
  await sql`update public.company_brain set profile = jsonb_set(profile, '{target_customer,industries}', '["Healthcare"]') where workspace_id = ${t.ws}`;
  const owner = await as("authenticated", t.owner.id);
  const { data } = await owner.from("signal_cluster_relevance").select("relevance, why_it_matters").eq("workspace_id", t.ws);
  assertEquals(data, [{ relevance: "high", why_it_matters: "Fits your manufacturing ICP" }], "the old verdict is still what the feed shows");
});

// ── 9 ────────────────────────────────────────────────────────────────────────
Deno.test("9 budget exhausted: the scheduler skips the workspace — but a person's scan has no budget check at all", opts, async () => {
  const t = await team(NORTHWIND);
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals)
    values (${t.ws}, 'competitor', 'rivalco.com', 'Rivalco', ${sql.json([{ event: "hiring", subject: "company" }] as never)})`;
  await sql`insert into public.monitoring_budgets (workspace_id, period_ceiling, period_days) values (${t.ws}, 0, 7)`;
  scanCalls = [];
  const tick = await callTick({ workspace_id: t.ws });
  assertEquals(tick.status, 200);
  const w = tick.body.workspaces.find((x: any) => x.workspace_id === t.ws);
  assertEquals(w.scanned, false); assertEquals(scanCalls.length, 0, "no scan was started");
  console.log("  tick refusal:", w.reason);
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/run-monitoring-scan/index.ts", import.meta.url));
  assertFalse(/monitoring_budgets|budgetAllows|monitoring_spend_in_period/.test(src), "DEFECT: the user path of run-monitoring-scan never reads the budget");
});

// ── 10 ───────────────────────────────────────────────────────────────────────
Deno.test("10 P0 DEFECT: a VIEWER can add watchlist entries (unattended spend) and can start a scan", opts, async () => {
  const t = await team(NORTHWIND);
  const viewer = await as("authenticated", t.viewer.id);
  const ins = await viewer.from("monitoring_subjects").insert({ workspace_id: t.ws, subject_kind: "competitor", identifier: "viewer-added.io",
    label: "Added by a viewer", signals: [{ event: "hiring", subject: "company" }], cadence_minutes: 15 }).select("id");
  assertEquals(ins.error, null, "a viewer's watchlist insert lands — including a 15-minute cadence");
  await sql`delete from public.monitoring_subjects where workspace_id = ${t.ws}`; // keep the scan below offline: no subjects, no engine
  external = [];
  const r = await callScan(await userJwt(t.viewer.id), { workspace_id: t.ws });
  assertEquals(r.status, 200, "not 403: the role is never checked");
  assertEquals(r.body.reason, "no_monitoring_subjects");
  const out = await callScan(await userJwt((await person()).id), { workspace_id: t.ws });
  assertEquals(out.status, 403, "a non-member is refused");
  assertEquals(external, []);
});

// ── 11 ───────────────────────────────────────────────────────────────────────
Deno.test("11 Company Brain missing: an ICP watch is refused by the real scan before any provider or model call", opts, async () => {
  const ws = await seedWorkspace();
  const owner = await person();
  await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${owner.id}, 'owner')`;
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, signals)
    values (${ws}, 'icp', null, ${sql.json([{ event: "funding", subject: "company" }] as never)})`;
  external = [];
  const r = await callScan(await userJwt(owner.id), { workspace_id: ws });
  assertEquals(r.status, 409, JSON.stringify(r.body).slice(0, 300));
  assertEquals(r.body.refusal, "no_usable_subjects");
  assertEquals(external, [], "nothing left loopback");
  assertEquals((await sql`select count(*)::int n from public.credit_transactions where workspace_id = ${ws}`)[0].n, 0);
});

// ── 12 ───────────────────────────────────────────────────────────────────────
Deno.test("12 exclusion (branch): an excluded industry reaches LISA's context and ORION demotes a matching signal", opts, async () => {
  const t = await team(NORTHWIND);
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:defense",
    value_type: "object", value: { type: "industry", value: "Defense" } });
  const [acc] = await sql`insert into public.accounts (workspace_id, name, industry) values (${t.ws}, 'Aegis Systems', 'Defense') returning id`;
  const [input] = projectCanonicalEvents({ workspace_id: t.ws, origin: "scheduled_monitor",
    subject: { subject_type: "company", subject_key: "aegis-example", subject_identifier: "aegis.example", account_id: acc.id }, company_name: "Aegis Systems",
    assessments: [{ signal: "expansion/company", verdict: "verified", evidence_ids: [], occurred_at: new Date(Date.now() - 86_400_000).toISOString() }] });
  await writeSignalEventV2({ admin: await svc(), enabled: true } as any, input as any);
  const loaded = await loadCompanyBrainContext(await svc() as unknown as LoaderDb, t.ws, { skipMembershipCheck: true });
  assert(loaded.ok); assertEquals(loaded.context.exclusions.industries, ["Defense"]);
  const s = (await brief(t.ws)).signals[0];
  assert(s.reasons.some((r: string) => r.startsWith("matches an exclusion you set")), "ORION ranks it lower and says why");
  assertEquals((await events(t.ws)).length, 1, "…but monitoring still collected and stored it: exclusions do not stop collection");
});

Deno.test("5 unsupported claim: a 'plausible' verdict is stored active and unverified (projection probe in lisaProbes.test.ts)", opts, () => {
  void propose; // proposals for claims are not made; see lisaProbes for the projection rule
});
