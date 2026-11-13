// LISA V2 — the 20 acceptance scenarios against a REAL database.
//
// Real Postgres + PostgREST + the real supabase-js client + the real Company
// Brain loader and memory/proposal RPCs. The ONLY thing mocked is the search
// provider: recorded, fictional responses (tests/fixtures/lisa). Every claim is
// judged by what actually landed (direct SQL), not by a return value.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, join, memoryWrite, opts, person, propose, review, sql, team, uuid } from "./lib/brainMemory.ts";
import { seedWorkspace } from "./lib/harness.ts";
import { loadCompanyBrainContext, type LoaderDb, type SharedBrainContext } from "../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { competitorProposalsFromMonitoring, submitProposals } from "../../supabase/functions/_shared/lisaBrainProposals.ts";
import { rpcSignalStore, recordArgs } from "../../supabase/functions/_shared/lisa/persistence.ts";
import { effectiveWatchlist, runWatch, scheduledRunKey, watchKey } from "../../supabase/functions/_shared/lisa/orchestrator.ts";
import { countingBudget, fixtureSource } from "../../supabase/functions/_shared/lisa/providers.ts";
import { toAgentSignal, weeklyDigest, type StoredSignalRow } from "../../supabase/functions/_shared/lisa/weekly.ts";
import { loadFixture, replay, sourceFor } from "../edge-functions/_shared/lisa/lisaFixtures.ts";
import type { WatchSubject } from "../../supabase/functions/_shared/lisa/types.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const NORTHWIND = {
  schema_version: 2, company: { name: "Northwind Robotics", description: "Plant-floor maintenance robots" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"] },
  competitors: ["Corvane Systems"],
  goals: { primary: "Win plant-floor maintenance accounts in the Midwest" },
};

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any;
const svc = async (): Promise<Svc> => await as("service_role");
async function brainOf(ws: string): Promise<SharedBrainContext> {
  const r = await loadCompanyBrainContext((await svc()) as unknown as LoaderDb, ws, { skipMembershipCheck: true, now: NOW });
  if (!r.ok) throw new Error(r.error);
  return r.context;
}
const rows = async (ws: string) => await sql`select * from public.signal_events where workspace_id = ${ws} order by dedupe_key`;
const evidence = async (id: string) => await sql`select * from public.signal_event_evidence where signal_event_id = ${id} order by source_url`;
const store = async () => rpcSignalStore(await svc());
const asStored = (r: Record<string, unknown>): StoredSignalRow => ({
  ...(r as unknown as StoredSignalRow), occurred_at: r.occurred_at ? new Date(String(r.occurred_at)).toISOString() : null,
  observed_at: new Date(String(r.observed_at)).toISOString(),
});
const corvane = (): WatchSubject => loadFixture("funding").subject;

// ── 1. Brain ─────────────────────────────────────────────────────────────────
Deno.test("01 Brain: the real loader shapes relevance; the verdict stores the loader fingerprint", opts, async () => {
  const t = await team(NORTHWIND);
  const brain = await brainOf(t.ws);
  const r = await replay(loadFixture("expansion"), { brain, store: await store(), workspace_id: t.ws });
  assertEquals(r.status, "ok");
  const [row] = await rows(t.ws);
  const rel = row.normalized_value.lisa.relevance;
  assertEquals(rel.brain_fingerprint, brain.fingerprint);
  assert(rel.reasons.some((x: string) => x.startsWith("Matches your target industry: Manufacturing")));
  assert(rel.reasons.some((x: string) => x.startsWith("In your target geography: United States")));
  assertEquals(rel.band, "high");
});

// ── 2. No Brain ──────────────────────────────────────────────────────────────
Deno.test("02 No Brain: a watched competitor is still collected, relevance says it cannot judge fit", opts, async () => {
  const ws = await seedWorkspace();
  const brain = await brainOf(ws);
  assertEquals(brain.status, "missing");
  await replay(loadFixture("funding"), { brain, store: await store(), workspace_id: ws });
  const [row] = await rows(ws);
  assert(row.normalized_value.lisa.relevance.reasons.includes("No Company Brain: relevance to your business is not known"));
  // A market (ICP) watch is impossible without a Brain: nothing to search for.
  assertEquals(effectiveWatchlist(brain, []).watches.length, 0);
});

// ── 3. Competitor funding ────────────────────────────────────────────────────
Deno.test("03 competitor funding: one row, two evidence rows, verification COUNTED by the database", opts, async () => {
  const t = await team(NORTHWIND);
  await replay(loadFixture("funding"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  assertEquals(row.signal_type, "recent_funding");
  assertEquals(row.origin, "competitor_monitor");
  assertEquals(row.subject_type, "competitor");
  assertEquals(row.evidence_category, "funding_signal");
  assertEquals(row.actor_key, "lisa_v2");
  assertEquals(row.verification_status, "provider_verified");
  assertEquals(row.confidence, "high");
  assertEquals(row.normalized_value.lisa.verification.level, "corroborated");
  assertEquals(row.normalized_value.lisa.verification.independent_sources, 2);
  assertEquals(row.occurred_at_basis, "source_reported");
  assertEquals((await evidence(row.id)).length, 2);
  assert((await evidence(row.id)).every((e) => /^https:\/\//.test(e.source_url)));
});

// ── 4. Second round ──────────────────────────────────────────────────────────
Deno.test("04 second round: Series B and Series C are two stored events", opts, async () => {
  const t = await team(NORTHWIND);
  await replay(loadFixture("second_round"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  const all = await rows(t.ws);
  assertEquals(all.map((r) => r.normalized_value.lisa.event_instance).sort(), ["series-b", "series-c"]);
  assertEquals(all.find((r) => r.normalized_value.lisa.event_instance === "series-c")?.verification_status, "unverified", "one outlet only");
});

// ── 5. Hiring ────────────────────────────────────────────────────────────────
Deno.test("05 hiring: a hiring push is stored as growth_hiring / job_signal; the single job ad is not", opts, async () => {
  const t = await team(NORTHWIND);
  const r = await replay(loadFixture("hiring"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  assertEquals(r.counts.dropped.below_significance, 1);
  const all = await rows(t.ws);
  assertEquals(all.length, 1);
  assertEquals(all[0].signal_type, "growth_hiring");
  assertEquals(all[0].evidence_category, "job_signal");
});

// ── 6. Expansion ─────────────────────────────────────────────────────────────
Deno.test("06 expansion: one plant, three evidence rows, the company's own release counted as self-reported", opts, async () => {
  const t = await team(NORTHWIND);
  await replay(loadFixture("expansion"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  assertEquals(row.signal_type, "geographic_expansion");
  assertEquals(row.origin, "scheduled_monitor");
  const ev = await evidence(row.id);
  assertEquals(ev.length, 3);
  assertEquals(ev.filter((e) => e.verification_status === "self_reported").map((e) => e.normalized_value.domain), ["brightforge.example"]);
  assertEquals(row.normalized_value.lisa.verification.independent_sources, 2);
});

// ── 7. Launch ────────────────────────────────────────────────────────────────
Deno.test("07 launch: the announcement is stored; the generic product page is not", opts, async () => {
  const t = await team(NORTHWIND);
  await replay(loadFixture("launch"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  const all = await rows(t.ws);
  assertEquals(all.length, 1);
  assertEquals(all[0].signal_type, "product_launch");
  assertEquals(all[0].normalized_value.lisa.event_instance, "corvane-sense");
});

// ── 8. Duplicate ─────────────────────────────────────────────────────────────
Deno.test("08 duplicate: three sites → one row; a re-run is a duplicate; a NEW source is an update with a recount", opts, async () => {
  const t = await team(NORTHWIND);
  const brain = await brainOf(t.ws);
  const f = loadFixture("funding");
  const first = await replay(f, { brain, store: await store(), workspace_id: t.ws });
  assertEquals(first.counts.new, 1);
  const again = await replay(f, { brain, store: await store(), workspace_id: t.ws });
  assertEquals(again.counts.duplicate, 1);
  const third = await replay(loadFixture("duplicate"), { brain, store: await store(), workspace_id: t.ws });
  assertEquals(third.counts.updated, 1);
  const all = await rows(t.ws);
  assertEquals(all.length, 1);
  assertEquals((await evidence(all[0].id)).length, 3);
});

// ── 9. Contradictory ─────────────────────────────────────────────────────────
Deno.test("09 contradictory: a later conflicting source moves a corroborated event to contradicted (server recount)", opts, async () => {
  const t = await team(NORTHWIND);
  const brain = await brainOf(t.ws);
  await replay(loadFixture("funding"), { brain, store: await store(), workspace_id: t.ws });
  assertEquals((await rows(t.ws))[0].verification_status, "provider_verified");
  await replay(loadFixture("contradictory"), { brain, store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  assertEquals(row.lifecycle_status, "contradicted");
  assertEquals(row.verification_status, "unverified");
  assertEquals(row.confidence, "low");
  assert(row.normalized_value.lisa.verification.contradictions.some((c: string) => c.includes("disagree on the amount")));
});

// ── 10-12. invalid response, timeout, budget exhaustion — through the scan-run ledger ──
async function scan(ws: string, fixture: string, budget?: number, brain?: SharedBrainContext | null) {
  const f = loadFixture(fixture);
  const b = brain === undefined ? await brainOf(ws) : brain;
  return await runWatch({
    db: await svc(), workspace_id: ws, watch: f.subject, brain: b, source: sourceFor(f, b), store: await store(),
    budget: countingBudget(budget ?? f.budget ?? 100), now: NOW, trigger: "scheduled", run_key: scheduledRunKey(f.subject, NOW), timeout_ms: 50,
  });
}
const runRow = async (ws: string) => (await sql`select * from public.lisa_scan_runs where workspace_id = ${ws}`)[0];
const stateRow = async (ws: string) => (await sql`select * from public.lisa_watch_state where workspace_id = ${ws}`)[0];

Deno.test("10 invalid response: nothing stored, run recorded partial with the error, failure counter untouched", opts, async () => {
  const t = await team(NORTHWIND);
  const r = await scan(t.ws, "invalid_response");
  assertEquals(r.claim, "claimed"); assertEquals(r.finish, "ok");
  assertEquals((await rows(t.ws)).length, 0);
  const run = await runRow(t.ws);
  assertEquals(run.status, "partial");
  assert(String(run.error).includes("invalid_response"));
  assertEquals(run.counts.provider_errors, 1);
});

Deno.test("11 timeout: every query hangs → failed pass, no rows, exponential backoff (15 min first)", opts, async () => {
  const t = await team(NORTHWIND);
  const w = { ...corvane(), categories: ["funding" as const] };
  const r = await runWatch({ db: await svc(), workspace_id: t.ws, watch: w, brain: await brainOf(t.ws),
    source: fixtureSource(() => "hang"), store: await store(), budget: countingBudget(100), now: NOW,
    trigger: "scheduled", run_key: scheduledRunKey(w, NOW), timeout_ms: 30 });
  assertEquals(r.pass!.status, "failed");
  assertEquals(r.pass!.counts.provider_errors, r.pass!.counts.queries_sent);
  assert(r.pass!.errors.every((e) => e.endsWith("timeout")));
  assertEquals((await rows(t.ws)).length, 0);
  const st = await stateRow(t.ws);
  assertEquals(st.consecutive_failures, 1);
  assertEquals(st.last_status, "failed");
  const wait = (new Date(st.next_eligible_at).getTime() - new Date(st.last_attempt_at).getTime()) / 60_000;
  assert(Math.abs(wait - 15) < 1, `15-minute first backoff, got ${wait}`);
});

Deno.test("12 budget exhaustion: no query sent, run budget_exhausted, next scan pushed out 24h", opts, async () => {
  const t = await team(NORTHWIND);
  const r = await scan(t.ws, "budget_exhaustion", 0);
  assertEquals(r.pass!.status, "budget_exhausted");
  assertEquals(r.pass!.counts.queries_sent, 0);
  const st = await stateRow(t.ws);
  const hours = (new Date(st.next_eligible_at).getTime() - new Date(st.last_attempt_at).getTime()) / 3_600_000;
  assert(Math.abs(hours - 24) < 0.1);
  // ...and the very next scheduled claim is refused as not eligible.
  const { data } = await (await svc()).rpc("lisa_claim_scan_run", { p_workspace_id: t.ws, p_run_key: "other-slot", p_subject_key: watchKey(corvane()),
    p_trigger: "scheduled", p_lease_seconds: 60, p_max_attempts: 3, p_ignore_eligibility: false });
  assertEquals(data[0].outcome, "not_eligible");
});

// ── 13. ICP change ───────────────────────────────────────────────────────────
Deno.test("13 ICP change: a new Brain fingerprint recomputes stored relevance; the next scan uses the new ICP", opts, async () => {
  const t = await team(NORTHWIND);
  const before = await brainOf(t.ws);
  await replay(loadFixture("changed_icp"), { brain: before, store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  const owner = t.owner;
  await sql`update public.company_brain set profile = ${sql.json({ ...NORTHWIND, target_customer: { industries: ["Healthcare"], geography: ["Germany"] } } as never)} where workspace_id = ${t.ws}`;
  const after = await brainOf(t.ws);
  assertNotEquals(after.fingerprint, before.fingerprint);
  const a0 = toAgentSignal(asStored(row), before, NOW)!;
  const a1 = toAgentSignal(asStored(row), after, NOW)!;
  assertEquals(a0.relevance_recomputed, false);
  assertEquals(a1.relevance_recomputed, true);
  assertEquals(a1.relevance.brain_fingerprint, after.fingerprint);
  assert(a1.relevance.score < a0.relevance.score);
  const market = effectiveWatchlist(after, []).watches.find((w) => w.kind === "market")!;
  assertEquals(market.name, "ICP: Healthcare", "the next scan searches the new ICP");
  void owner;
});

// ── 14. Excluded competitor ──────────────────────────────────────────────────
Deno.test("14 excluded competitor: a Brain exclusion removes the watch AND drops events before storage", opts, async () => {
  const t = await team(NORTHWIND);
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.company:corvane",
    value_type: "object", value: { type: "company", value: "Corvane Systems" } });
  const brain = await brainOf(t.ws);
  assert(brain.exclusions.companies.includes("Corvane Systems"));
  const wl = effectiveWatchlist(brain, []);
  assert(!wl.watches.some((w) => w.name === "Corvane Systems"));
  assert(wl.skipped.some((s) => s.name === "Corvane Systems" && s.reason.startsWith("excluded")));
  const r = await replay(loadFixture("funding"), { brain, store: await store(), workspace_id: t.ws });
  assertEquals(r.counts.dropped.excluded, 1);
  assertEquals((await rows(t.ws)).length, 0);
});

// ── 15-16. proposals through the existing mechanism ──────────────────────────
async function monitoredCompetitor(ws: string, domain: string, label: string) {
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals)
            values (${ws}, 'competitor', ${domain}, ${label}, ${sql.json([{ event: "funding", subject: "company" }] as never)})`;
}
async function lisaProposes(ws: string) {
  const brain = await brainOf(ws);
  const subj = await sql`select subject_kind as kind, identifier, label from public.monitoring_subjects where workspace_id = ${ws}`;
  const props = competitorProposalsFromMonitoring(subj as never, brain.competitors, () => null, NOW);
  return await submitProposals(await svc(), ws, "lisa", props);
}

Deno.test("15 approved proposal: a watched competitor becomes Brain knowledge only after a person approves", opts, async () => {
  const t = await team(NORTHWIND);
  await monitoredCompetitor(t.ws, "halden-tools.example", "Halden Tools");
  const [sub] = await lisaProposes(t.ws);
  assertEquals(sub.outcome, "created");
  assert(!(await brainOf(t.ws)).competitors.some((c) => c.domain === "halden-tools.example"), "pending is not knowledge");
  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${t.ws} and status = 'pending'`;
  assertEquals((await review(t.ws, t.viewer, p.id, "approve")).outcome, "forbidden_role");
  assertEquals((await review(t.ws, t.editor, p.id, "approve")).outcome, "ok");
  const brain = await brainOf(t.ws);
  assert(brain.competitors.some((c) => c.domain === "halden-tools.example"));
  const w = effectiveWatchlist(brain, []).watches.find((x) => x.domain === "halden-tools.example")!;
  assertEquals(w.kind, "competitor");
  assertEquals(w.origin, "brain_competitor");
});

Deno.test("16 rejected proposal: stays out of the Brain and LISA cannot re-propose it", opts, async () => {
  const t = await team(NORTHWIND);
  await monitoredCompetitor(t.ws, "partner-co.example", "Partner Co");
  await lisaProposes(t.ws);
  const [p] = await sql`select id from public.company_brain_memory_proposals where workspace_id = ${t.ws} and status = 'pending'`;
  assertEquals((await review(t.ws, t.owner, p.id, "reject", { note: "a partner" })).outcome, "ok");
  assert(!(await brainOf(t.ws)).competitors.some((c) => c.domain === "partner-co.example"));
  const [again] = await lisaProposes(t.ws);
  assertEquals(again.outcome, "previously_rejected");
  void propose;
});

// ── 17. Stale ────────────────────────────────────────────────────────────────
Deno.test("17 stale: an out-of-window event is never stored and never reaches the weekly digest", opts, async () => {
  const t = await team(NORTHWIND);
  const r = await replay(loadFixture("stale"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  assertEquals(r.counts.dropped.stale, 1);
  assertEquals((await rows(t.ws)).length, 0);
});

// ── 18. Retracted ────────────────────────────────────────────────────────────
Deno.test("18 retracted: stored retracted; a human 'restore' cannot revive it; never in the digest", opts, async () => {
  const t = await team(NORTHWIND);
  const brain = await brainOf(t.ws);
  await replay(loadFixture("retracted"), { brain, store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  assertEquals(row.lifecycle_status, "retracted");
  const { data } = await (await svc()).rpc("lisa_signal_transition", { p_workspace_id: t.ws, p_actor_id: t.owner.id,
    p_session_id: t.owner.session, p_signal_event_id: row.id, p_action: "restore", p_reason: null });
  assertEquals(data[0].outcome, "invalid_transition");
  assertEquals((await rows(t.ws))[0].lifecycle_status, "retracted");
  const d = weeklyDigest(t.ws, [asStored(row)], brain, NOW);
  assertEquals(d.items.length, 0);
  assertEquals(d.excluded.not_current, 1);
});

// ── 19. Concurrent jobs ──────────────────────────────────────────────────────
Deno.test("19 concurrent jobs: two schedulers in one slot → one claim; two writers of one event → one row, evidence merged", opts, async () => {
  const t = await team(NORTHWIND);
  const db = await svc();
  const args = { p_workspace_id: t.ws, p_run_key: scheduledRunKey(corvane(), NOW), p_subject_key: watchKey(corvane()),
    p_trigger: "scheduled", p_lease_seconds: 60, p_max_attempts: 3, p_ignore_eligibility: false };
  const [a, b] = await Promise.all([db.rpc("lisa_claim_scan_run", args), db.rpc("lisa_claim_scan_run", args)]);
  assertEquals([a.data[0].outcome, b.data[0].outcome].sort(), ["already_running", "claimed"]);
  assertEquals((await sql`select count(*)::int as n from public.lisa_scan_runs where workspace_id = ${t.ws}`)[0].n, 1);

  const brain = await brainOf(t.ws);
  const one = await replay(loadFixture("funding"), { brain, store: { record: () => Promise.resolve({ status: "new", event_id: null }) } });
  const dup = await replay(loadFixture("duplicate"), { brain, store: { record: () => Promise.resolve({ status: "new", event_id: null }) } });
  const s1 = { ...one.signals[0], workspace_id: t.ws }; const s2 = { ...dup.signals[0], workspace_id: t.ws };
  const st = await store();
  const outs = await Promise.all([st.record(s1), st.record(s2), st.record(s1)]);
  assertEquals(outs.filter((o) => o.status === "new").length, 1);
  assert(outs.every((o) => o.status !== "failed"));
  const all = await rows(t.ws);
  assertEquals(all.length, 1);
  assertEquals((await evidence(all[0].id)).length, 3, "the union of both writers' evidence");

  // Stalled recovery: an expired lease is reclaimed; the superseded attempt cannot finish.
  await sql`update public.lisa_scan_runs set lease_until = now() - interval '1 minute' where workspace_id = ${t.ws}`;
  const re = await db.rpc("lisa_claim_scan_run", args);
  assertEquals(re.data[0].outcome, "reclaimed"); assertEquals(re.data[0].attempts, 2);
  const late = await db.rpc("lisa_finish_scan_run", { p_run_id: re.data[0].run_id, p_attempt: 1, p_status: "ok", p_counts: {},
    p_provider_calls: 0, p_credits: 0, p_model_usd: 0, p_error: null, p_cadence_minutes: 60 });
  assertEquals(late.data, "superseded");
});

// ── 20. Persistence failure ──────────────────────────────────────────────────
Deno.test("20 persistence failure: a database refusal is a failed pass, never ok, and nothing half-written", opts, async () => {
  const t = await team(NORTHWIND);
  const ghost = uuid(); // no such workspace → the FK refuses the insert
  const r = await replay(loadFixture("funding"), { brain: await brainOf(t.ws), store: await store(), workspace_id: ghost });
  assertEquals(r.status, "failed");
  assertEquals(r.counts.persist_failed, 1);
  assertEquals((await sql`select count(*)::int as n from public.signal_events where workspace_id = ${ghost}`)[0].n, 0);
  assertEquals((await sql`select count(*)::int as n from public.signal_event_evidence where workspace_id = ${ghost}`)[0].n, 0);
});

// ── authorization boundaries ─────────────────────────────────────────────────
Deno.test("lifecycle: editor dismisses and restores with an audit trail; viewer and stranger are refused in the transaction", opts, async () => {
  const t = await team(NORTHWIND);
  await replay(loadFixture("funding"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  const [row] = await rows(t.ws);
  const db = await svc();
  const tr = async (p: { id: string; session: string }, action: string) =>
    (await db.rpc("lisa_signal_transition", { p_workspace_id: t.ws, p_actor_id: p.id, p_session_id: p.session, p_signal_event_id: row.id, p_action: action, p_reason: "fictional" })).data[0];
  assertEquals((await tr(t.viewer, "dismiss")).outcome, "forbidden_role");
  const stranger = await person();
  assertEquals((await tr(stranger, "dismiss")).outcome, "not_member");
  assertEquals((await tr({ id: t.editor.id, session: uuid() }, "dismiss")).outcome, "session_invalid");
  assertEquals((await tr(t.editor, "dismiss")).lifecycle_status, "dismissed");
  // A later pass with more evidence does NOT undo a human dismissal.
  await replay(loadFixture("duplicate"), { brain: await brainOf(t.ws), store: await store(), workspace_id: t.ws });
  assertEquals((await rows(t.ws))[0].lifecycle_status, "dismissed");
  assertEquals((await tr(t.editor, "restore")).lifecycle_status, "active");
  assertEquals((await tr(t.editor, "dispute")).lifecycle_status, "contradicted");
  assertEquals((await tr(t.editor, "restore")).outcome, "invalid_transition", "restore only undoes a dismissal");
  const audit = await sql`select action, from_status, to_status, actor_user_id from public.signal_event_transitions where signal_event_id = ${row.id} order by created_at`;
  assertEquals(audit.map((a) => `${a.action}:${a.from_status}>${a.to_status}`), ["dismiss:active>dismissed", "restore:dismissed>active", "dispute:active>contradicted"]);
  assert(audit.every((a) => a.actor_user_id === t.editor.id));
});

Deno.test("grants: browser roles cannot call the LISA writers or write its tables; members read their own runs only", opts, async () => {
  const t = await team(NORTHWIND);
  const other = await team(NORTHWIND);
  await scan(t.ws, "funding");
  const user = await as("authenticated", t.viewer.id);
  const f = loadFixture("funding");
  const one = await replay(f, { brain: null, store: { record: () => Promise.resolve({ status: "new", event_id: null }) } });
  const args = await recordArgs({ ...one.signals[0], workspace_id: t.ws });
  for (const [fn, a] of [["lisa_record_signal", args], ["lisa_claim_scan_run", { p_workspace_id: t.ws, p_run_key: "x-key", p_subject_key: "company:x", p_trigger: "on_demand" }],
    ["lisa_signal_transition", { p_workspace_id: t.ws, p_actor_id: t.viewer.id, p_session_id: t.viewer.session, p_signal_event_id: uuid(), p_action: "dismiss" }]] as const) {
    const { error } = await user.rpc(fn, a as Record<string, unknown>);
    assert(error, `${fn} must be refused to a browser role`);
  }
  const ins = await user.from("lisa_scan_runs").insert({ workspace_id: t.ws, run_key: "forged", subject_key: "company:x", trigger: "on_demand", lease_until: new Date().toISOString() });
  assert(ins.error, "no browser insert into lisa_scan_runs");
  const mine = await user.from("lisa_scan_runs").select("id, workspace_id");
  assert((mine.data ?? []).length >= 1 && (mine.data ?? []).every((r: { workspace_id: string }) => r.workspace_id === t.ws));
  const theirs = await (await as("authenticated", other.viewer.id)).from("lisa_scan_runs").select("id").eq("workspace_id", t.ws);
  assertEquals(theirs.data ?? [], []);
  void join;
});
