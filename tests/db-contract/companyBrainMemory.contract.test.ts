// Company Brain V1 memory — the adversarial database contract.
//
// Real Postgres + PostgREST. Every claim is judged by what actually landed
// (direct SQL), not by an HTTP status. Fictional data only.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import postgres from "npm:postgres@3.4.5";
import {
  as, competitorProposal, join, key, memoryWrite, opts, person, propose, review, sizePref, sql, team, uuid,
} from "./lib/brainMemory.ts";
import { seedWorkspace } from "./lib/harness.ts";

const TABLES = [
  "company_brain_memory", "company_brain_memory_history", "company_brain_memory_proposals",
  "company_brain_revisions", "company_brain_memory_requests",
];

const items = async (ws: string) =>
  await sql`select * from public.company_brain_memory where workspace_id = ${ws} order by created_at`;
const history = async (memoryId: string) =>
  await sql`select * from public.company_brain_memory_history where memory_id = ${memoryId} order by created_at`;

// ── 1. versioned preferences: the required example ────────────────────────────
Deno.test("an ICP preference change keeps the earlier value, when it changed and who changed it", opts, async () => {
  const t = await team();
  const first = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50, { reason: "initial ICP" }));
  assertEquals(first.outcome, "ok"); assertEquals(first.version, 1);

  const second = await memoryWrite(t.ws, t.editor, "set", sizePref(50, 200, { expected_version: 1, reason: "moving upmarket" }));
  assertEquals(second.outcome, "ok"); assertEquals(second.version, 2);
  assertEquals(second.memory_id, first.memory_id, "one item, a new version — not a second item");

  const [row] = await items(t.ws);
  assertEquals(row.value, { min: 50, max: 200 }, "the active value is the latest");
  assertEquals(row.version, 2);
  assertEquals(row.source_type, "user_provided"); assertEquals(row.verification_status, "user_confirmed");
  assertEquals(row.updated_by, t.editor.id);

  const h = await history(String(first.memory_id));
  assertEquals(h.map((r) => r.change_kind), ["created", "updated"]);
  assertEquals(h[1].previous.value, { min: 10, max: 50 }, "the earlier preference is preserved");
  assertEquals(h[1].current.value, { min: 50, max: 200 });
  assertEquals(h[1].actor_id, t.editor.id, "who changed it");
  assertEquals(h[0].actor_id, t.owner.id);
  assert(h[1].created_at instanceof Date, "when it changed");
  assertEquals(h[1].reason, "moving upmarket");
});

Deno.test("a stale version is refused and changes nothing (no lost update)", opts, async () => {
  const t = await team();
  await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  await memoryWrite(t.ws, t.owner, "set", sizePref(20, 80, { expected_version: 1 }));
  const r = await memoryWrite(t.ws, t.editor, "set", sizePref(1, 5, { expected_version: 1 }));
  assertEquals(r.outcome, "stale"); assertEquals(r.version, 2);
  assertEquals((await items(t.ws))[0].value, { min: 20, max: 80 });
  const missing = await memoryWrite(t.ws, t.editor, "set", sizePref(1, 5));
  assertEquals(missing.outcome, "stale", "updating an existing item without a version is refused");
});

Deno.test("an identical rewrite is 'unchanged' and adds no version", opts, async () => {
  const t = await team();
  await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  const r = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50, { expected_version: 1 }));
  assertEquals(r.outcome, "unchanged");
  const [row] = await items(t.ws);
  assertEquals(row.version, 1); assertEquals((await history(row.id)).length, 1);
});

// ── 2. idempotency ────────────────────────────────────────────────────────────
Deno.test("a retried request (same idempotency key) replays the first outcome and writes nothing new", opts, async () => {
  const t = await team();
  const idem = key();
  const a = await memoryWrite(t.ws, t.owner, "decide", {
    category: "lead_rejected", scope: "lead", scope_ref: "lead-1", value: { outcome: "rejected", note: "not B2B" },
  }, idem);
  const b = await memoryWrite(t.ws, t.owner, "decide", {
    category: "lead_rejected", scope: "lead", scope_ref: "lead-1", value: { outcome: "rejected", note: "not B2B" },
  }, idem);
  assertEquals(a.outcome, "ok"); assertEquals(b.replayed, true); assertEquals(b.memory_id, a.memory_id);
  assertEquals((await items(t.ws)).length, 1);
  assertEquals((await history(String(a.memory_id))).length, 1);

  const reused = await memoryWrite(t.ws, t.owner, "set", sizePref(1, 2), idem);
  assertEquals(reused.outcome, "idempotency_conflict", "a key cannot be reused for a different request");
});

Deno.test("concurrent duplicates: two requests with one key → one write, one replay", opts, async () => {
  const t = await team();
  const idem = key();
  const payload = { category: "signal_dismissed", scope: "signal", scope_ref: "sig-9", value: { outcome: "dismissed" } };
  const [a, b] = await Promise.all([
    memoryWrite(t.ws, t.owner, "decide", payload, idem), memoryWrite(t.ws, t.owner, "decide", payload, idem),
  ]);
  assertEquals([a.outcome, b.outcome].sort(), ["ok", "ok"]);
  assertEquals([a.replayed, b.replayed].filter(Boolean).length, 1);
  assertEquals((await items(t.ws)).length, 1);
});

Deno.test("concurrent edits of one item with the same version: exactly one wins", opts, async () => {
  const t = await team();
  await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  const [a, b] = await Promise.all([
    memoryWrite(t.ws, t.owner, "set", sizePref(60, 70, { expected_version: 1 })),
    memoryWrite(t.ws, t.editor, "set", sizePref(80, 90, { expected_version: 1 })),
  ]);
  assertEquals([a.outcome, b.outcome].sort(), ["ok", "stale"]);
  const [row] = await items(t.ws);
  assertEquals(row.version, 2);
  assertEquals((await history(row.id)).length, 2);
});

// ── 3. decisions keep their scope ────────────────────────────────────────────
Deno.test("a lead rejection cannot be recorded as a workspace-wide rule, and never creates an exclusion", opts, async () => {
  const t = await team();
  const wide = await memoryWrite(t.ws, t.owner, "decide", { category: "lead_rejected", value: { outcome: "rejected" } });
  assertEquals(wide.outcome, "invalid");
  const scoped = await memoryWrite(t.ws, t.owner, "decide", {
    category: "lead_rejected", scope: "lead", scope_ref: "lead-42",
    value: { outcome: "rejected", subject: { type: "lead", ref: "lead-42", label: "Acme Gambling Ltd" } },
  });
  assertEquals(scoped.outcome, "ok");
  const rows = await items(t.ws);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].kind, "decision"); assertEquals(rows[0].scope, "lead");
  assertEquals(rows.filter((r) => r.kind === "preference").length, 0, "no exclusion was generalised from one decision");
});

Deno.test("the same decision twice is recorded once; a changed outcome is a new version", opts, async () => {
  const t = await team();
  const d = { category: "recommendation_decided", scope: "recommendation", scope_ref: "rec-1" };
  const a = await memoryWrite(t.ws, t.owner, "decide", { ...d, value: { outcome: "approved" } });
  const b = await memoryWrite(t.ws, t.editor, "decide", { ...d, value: { outcome: "approved" } });
  assertEquals(b.outcome, "already_recorded"); assertEquals(b.memory_id, a.memory_id);
  const c = await memoryWrite(t.ws, t.editor, "decide", { ...d, value: { outcome: "rejected" } });
  assertEquals(c.outcome, "ok"); assertEquals(c.version, 2);
  assertEquals((await items(t.ws)).length, 1);
});

Deno.test("a temporary preference must say when it expires", opts, async () => {
  const t = await team();
  const r = await memoryWrite(t.ws, t.owner, "set", {
    kind: "preference", category: "sales_priority", fact_key: "priority.q1_focus", value_type: "text",
    value: "Focus on Nordic logistics", persistence: "temporary",
  });
  assertEquals(r.outcome, "invalid");
  const ok = await memoryWrite(t.ws, t.owner, "set", {
    kind: "preference", category: "sales_priority", fact_key: "priority.q1_focus", value_type: "text",
    value: "Focus on Nordic logistics", persistence: "temporary", expires_at: "2027-03-31T00:00:00Z",
  });
  assertEquals(ok.outcome, "ok");
});

// ── 4. authorization ─────────────────────────────────────────────────────────
Deno.test("viewers, outsiders and bad sessions are refused before anything is written", opts, async () => {
  const t = await team();
  assertEquals((await memoryWrite(t.ws, t.viewer, "set", sizePref(1, 2))).outcome, "forbidden_role");
  const outsider = await person();
  assertEquals((await memoryWrite(t.ws, outsider, "set", sizePref(1, 2))).outcome, "not_member");
  assertEquals((await memoryWrite(t.ws, { id: t.owner.id, session: uuid() }, "set", sizePref(1, 2))).outcome, "session_invalid");
  await sql`update auth.sessions set not_after = now() - interval '1 minute' where id = ${t.editor.session}`;
  assertEquals((await memoryWrite(t.ws, t.editor, "set", sizePref(1, 2))).outcome, "session_invalid");
  assertEquals((await items(t.ws)).length, 0);
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory_requests where workspace_id = ${t.ws}`)[0].n, 0,
    "a refused caller leaves no idempotency row either");
});

Deno.test("user A cannot read or modify workspace B's memory", opts, async () => {
  const a = await team(); const b = await team();
  const bItem = await memoryWrite(b.ws, b.owner, "set", sizePref(500, 1000));
  // A's owner targets B's item through A's workspace: not found (rows are workspace-scoped).
  const viaA = await memoryWrite(a.ws, a.owner, "retract", { memory_id: bItem.memory_id, expected_version: 1 });
  assertEquals(viaA.outcome, "not_found");
  // …and through B's workspace: not a member.
  const viaB = await memoryWrite(b.ws, a.owner, "retract", { memory_id: bItem.memory_id, expected_version: 1 });
  assertEquals(viaB.outcome, "not_member");
  assertEquals((await items(b.ws))[0].lifecycle_status, "active");

  // Reads through RLS: A sees nothing of B, on every table.
  const browserA = await as("authenticated", a.owner.id);
  for (const table of TABLES.slice(0, 4)) {
    const { data, error } = await browserA.from(table).select("*").eq("workspace_id", b.ws);
    if (!error) assertEquals(data, [], `${table}: A reads none of B's rows`);
  }
  const { data: own } = await browserA.from("company_brain_memory").select("id").eq("workspace_id", a.ws);
  assertEquals(own, []);
  const browserB = await as("authenticated", b.viewer.id);
  const { data: bRows } = await browserB.from("company_brain_memory").select("id, value").eq("workspace_id", b.ws);
  assertEquals(bRows?.length, 1, "a viewer of B reads B's memory");
  const anon = await as("anon");
  const { data: anonRows } = await anon.from("company_brain_memory").select("id");
  assertEquals(anonRows ?? [], []);
});

Deno.test("no browser role — and not even the service role — writes memory tables directly", opts, async () => {
  const t = await team();
  const target = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  const clients = [
    ["owner", await as("authenticated", t.owner.id)], ["anon", await as("anon")], ["service_role", await as("service_role")],
  ] as const;
  for (const [who, c] of clients) {
    for (const table of TABLES) {
      const ins = await c.from(table).insert({ workspace_id: t.ws });
      assert(ins.error, `${who} cannot INSERT into ${table}`);
    }
    const upd = await c.from("company_brain_memory").update({ value: { min: 1, max: 1 } }).eq("id", target.memory_id as string);
    assert(upd.error || (upd.count ?? 0) === 0, `${who} cannot UPDATE memory`);
    const del = await c.from("company_brain_memory_history").delete().eq("memory_id", target.memory_id as string);
    assert(del.error || (del.count ?? 0) === 0, `${who} cannot DELETE history`);
  }
  const [row] = await items(t.ws);
  assertEquals(row.value, { min: 10, max: 50 });
  assertEquals((await history(row.id)).length, 1);
});

Deno.test("browser roles cannot call any memory function", opts, async () => {
  const t = await team();
  const browser = await as("authenticated", t.owner.id);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["company_brain_memory_write", { p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_op: "set", p_payload: sizePref(1, 2), p_idempotency_key: key() }],
    ["company_brain_proposal_submit", { p_workspace_id: t.ws, p_agent: "lisa", p_payload: competitorProposal("rivalco.com") }],
    ["company_brain_proposal_review", { p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_proposal_id: uuid(), p_action: "approve", p_corrected_value: null, p_note: null, p_expected_memory_version: null, p_idempotency_key: key() }],
    ["company_brain_memory_redact", { p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_target: "memory", p_id: uuid(), p_reason: "x" }],
  ];
  for (const c of [browser, await as("anon")]) {
    for (const [fn, args] of calls) {
      const { error } = await c.rpc(fn, args);
      assert(error, `${fn} is refused to browser roles`);
    }
  }
  assertEquals((await items(t.ws)).length, 0);
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory_proposals where workspace_id = ${t.ws}`)[0].n, 0);
});

// Late authorization: a demotion committed while the write is in flight.
async function raceWith(revoke: (tx: postgres.TransactionSql, ws: string, p: { id: string; session: string }) => Promise<unknown>) {
  const t = await team();
  const blocker = postgres(Deno.env.get("DB_CONTRACT_PG_URL")!, { max: 1, onnotice: () => {} });
  let release!: () => void; const held = new Promise<void>((r) => release = r);
  let begun!: () => void; const started = new Promise<void>((r) => begun = r);
  const tx = blocker.begin(async (x) => { await revoke(x, t.ws, t.editor); begun(); await held; });
  await started;
  const writing = memoryWrite(t.ws, t.editor, "set", sizePref(10, 50));
  const settled = await Promise.race([writing.then(() => "finished"), new Promise((r) => setTimeout(() => r("waiting"), 700))]);
  release(); await tx; await blocker.end();
  return { settled, outcome: (await writing).outcome, count: (await items(t.ws)).length };
}

Deno.test("race: demoted to viewer while the write is in flight → it waits, then is refused", opts, async () => {
  const r = await raceWith((x, ws, p) => x`update public.workspace_members set role = 'viewer' where workspace_id = ${ws} and user_id = ${p.id}`);
  assertEquals(r.settled, "waiting"); assertEquals(r.outcome, "forbidden_role"); assertEquals(r.count, 0);
});

Deno.test("race: removed from the workspace while the write is in flight → refused", opts, async () => {
  const r = await raceWith((x, ws, p) => x`delete from public.workspace_members where workspace_id = ${ws} and user_id = ${p.id}`);
  assertEquals(r.settled, "waiting"); assertEquals(r.outcome, "not_member"); assertEquals(r.count, 0);
});

Deno.test("race: logged out while the write is in flight → refused", opts, async () => {
  const r = await raceWith((x, _ws, p) => x`delete from auth.sessions where id = ${p.session}`);
  assertEquals(r.settled, "waiting"); assertEquals(r.outcome, "session_invalid"); assertEquals(r.count, 0);
});

Deno.test("a failed transaction leaves nothing behind — no item, no history, no idempotency row", opts, async () => {
  const t = await team();
  const idem = key();
  let failed = false;
  try {
    // A malformed timestamp fails AFTER authorization and the idempotency insert.
    await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50, { review_at: "not-a-date" }), idem);
  } catch { failed = true; }
  assert(failed, "the write raised");
  assertEquals((await items(t.ws)).length, 0);
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory_history where workspace_id = ${t.ws}`)[0].n, 0);
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory_requests where workspace_id = ${t.ws}`)[0].n, 0);
  // …so the same key works for a corrected retry.
  assertEquals((await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50), idem)).outcome, "ok");
});

// ── 5. honesty constraints hold even against a direct (superuser) insert ─────
Deno.test("the schema refuses a model inference labelled as verified, and an agent item with no approver", opts, async () => {
  const t = await team();
  const base = { ws: t.ws, val: sql.json({ min: 1, max: 2 } as never) };
  const bad = [
    sql`insert into public.company_brain_memory (workspace_id, kind, category, fact_key, value_type, value, source_type, verification_status, created_by_kind)
        values (${base.ws}, 'fact', 'icp', 'k1', 'number_range', ${base.val}, 'model_inference', 'corroborated', 'system')`,
    sql`insert into public.company_brain_memory (workspace_id, kind, category, fact_key, value_type, value, source_type, verification_status, created_by_kind)
        values (${base.ws}, 'fact', 'icp', 'k2', 'number_range', ${base.val}, 'agent_suggestion', 'provider_reported', 'system')`,
    sql`insert into public.company_brain_memory (workspace_id, kind, category, fact_key, value_type, value, source_type, verification_status, created_by_kind)
        values (${base.ws}, 'fact', 'icp', 'k3', 'number_range', ${base.val}, 'agent_suggestion', 'unverified', 'agent')`,
    sql`insert into public.company_brain_memory (workspace_id, kind, category, fact_key, value_type, value, source_type, verification_status, created_by_kind)
        values (${base.ws}, 'fact', 'icp', 'k4', 'number_range', ${base.val}, 'corroborated', 'corroborated', 'system')`,
  ];
  for (const q of bad) {
    let refused = false;
    try { await q; } catch { refused = true; }
    assert(refused, "constraint refused the row");
  }
  assertEquals((await items(t.ws)).length, 0);
});

Deno.test("history is append-only, even for the database owner outside a redaction", opts, async () => {
  const t = await team();
  const r = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  for (const q of [
    sql`update public.company_brain_memory_history set reason = 'rewritten' where memory_id = ${r.memory_id as string}`,
    sql`delete from public.company_brain_memory_history where memory_id = ${r.memory_id as string}`,
    sql`update public.company_brain_revisions set profile = '{}' where workspace_id = ${t.ws}`,
  ]) {
    let refused = false;
    try { await q; } catch { refused = true; }
    assert(refused, "history mutation refused");
  }
  assertEquals((await history(String(r.memory_id))).length, 1);
});

// ── 6. lifecycle: retracted knowledge is not active ──────────────────────────
Deno.test("retract, dispute and reactivate are versioned; a retracted item cannot be reactivated", opts, async () => {
  const t = await team();
  const f = await memoryWrite(t.ws, t.owner, "set", {
    kind: "fact", category: "products", fact_key: "product.robot_x", value_type: "text", value: "RoboX warehouse picker",
  });
  const d = await memoryWrite(t.ws, t.editor, "dispute", { memory_id: f.memory_id, expected_version: 1, reason: "is it still sold?" });
  assertEquals(d.outcome, "ok");
  const re = await memoryWrite(t.ws, t.editor, "reactivate", { memory_id: f.memory_id, expected_version: 2 });
  assertEquals(re.outcome, "ok");
  const x = await memoryWrite(t.ws, t.owner, "retract", { memory_id: f.memory_id, expected_version: 3, reason: "discontinued" });
  assertEquals(x.outcome, "ok");
  assertEquals((await memoryWrite(t.ws, t.owner, "reactivate", { memory_id: f.memory_id, expected_version: 4 })).outcome, "invalid");
  const [row] = await items(t.ws);
  assertEquals(row.lifecycle_status, "retracted");
  assertEquals((await history(row.id)).map((h) => h.change_kind), ["created", "disputed", "reactivated", "retracted"]);
  // A new value for the same key after a retraction is a NEW active item, linked to the old one.
  const n = await memoryWrite(t.ws, t.owner, "correct", {
    kind: "fact", category: "products", fact_key: "product.robot_x", value_type: "text", value: "RoboX Mk2",
    supersedes_id: f.memory_id,
  });
  assertEquals(n.outcome, "ok"); assertNotEquals(n.memory_id, f.memory_id);
  const active = (await items(t.ws)).filter((r) => r.lifecycle_status === "active");
  assertEquals(active.length, 1); assertEquals(active[0].supersedes_id, f.memory_id);
});

// ── 7. agent proposals need a person ─────────────────────────────────────────
Deno.test("an agent proposal stays pending and untrusted until an editor reviews it", opts, async () => {
  const t = await team();
  const p = await propose(t.ws, "lisa", competitorProposal("rivalco.com"));
  assertEquals(p.outcome, "created");
  assertEquals((await items(t.ws)).length, 0, "a proposal is NOT memory");

  assertEquals((await review(t.ws, t.viewer, String(p.proposal_id), "approve")).outcome, "forbidden_role");
  assertEquals((await review(t.ws, await person(), String(p.proposal_id), "approve")).outcome, "not_member");
  assertEquals((await items(t.ws)).length, 0);

  const ok = await review(t.ws, t.editor, String(p.proposal_id), "approve", { note: "yes, a direct competitor" });
  assertEquals(ok.outcome, "ok"); assertEquals(ok.status, "approved");
  const [row] = await items(t.ws);
  assertEquals(row.source_type, "agent_suggestion", "it stays labelled as what it was");
  assertEquals(row.verification_status, "user_confirmed", "a person confirmed it — never 'corroborated'");
  assertEquals(row.approval_status, "approved"); assertEquals(row.approved_by, t.editor.id);
  assertEquals(row.created_by_kind, "agent"); assertEquals(row.created_by_agent, "lisa");
  assertEquals(row.source_ref, "monitoring_subject:rivalco.com");
  const [h] = await history(row.id);
  assertEquals(h.change_kind, "approved_from_proposal"); assertEquals(h.actor_id, t.editor.id); assertEquals(h.actor_agent, "lisa");

  assertEquals((await review(t.ws, t.owner, String(p.proposal_id), "approve")).outcome, "not_pending", "cannot be approved twice");
});

Deno.test("a rejected proposal never becomes memory and is not re-proposed", opts, async () => {
  const t = await team();
  const p = await propose(t.ws, "lisa", competitorProposal("notarival.com"));
  const r = await review(t.ws, t.owner, String(p.proposal_id), "reject", { note: "a partner, not a competitor" });
  assertEquals(r.outcome, "ok"); assertEquals(r.status, "rejected");
  assertEquals((await items(t.ws)).length, 0);
  const h = await sql`select change_kind, actor_id from public.company_brain_memory_history where proposal_id = ${p.proposal_id as string}`;
  assertEquals(h.length, 1); assertEquals(h[0].change_kind, "proposal_rejected");
  assertEquals((await propose(t.ws, "lisa", competitorProposal("notarival.com"))).outcome, "previously_rejected");
});

Deno.test("a repeated proposal is one proposal with merged evidence; a known fact is not re-proposed", opts, async () => {
  const t = await team();
  const a = await propose(t.ws, "lisa", competitorProposal("rivalco.com"));
  const b = await propose(t.ws, "lisa", competitorProposal("rivalco.com", {
    evidence: [{ source_url: "https://news.example.test/rivalco-raises", observed_at: "2026-11-02T00:00:00Z" }],
  }));
  assertEquals(b.outcome, "duplicate_pending"); assertEquals(b.proposal_id, a.proposal_id);
  const [row] = await sql`select evidence from public.company_brain_memory_proposals where id = ${a.proposal_id as string}`;
  assertEquals(row.evidence.length, 2);
  await review(t.ws, t.owner, String(a.proposal_id), "approve");
  assertEquals((await propose(t.ws, "lisa", competitorProposal("rivalco.com"))).outcome, "already_known");
});

Deno.test("an agent cannot claim verification, and a provider claim needs evidence", opts, async () => {
  const t = await team();
  for (const source_type of ["user_provided", "corroborated", "system_migration"]) {
    assertEquals((await propose(t.ws, "lisa", competitorProposal("x.com", { source_type }))).outcome, "invalid", source_type);
  }
  assertEquals((await propose(t.ws, "lisa", competitorProposal("y.com", { source_type: "provider_returned", evidence: [] }))).outcome, "invalid");
  assertEquals((await propose(t.ws, "hal9000", competitorProposal("z.com"))).outcome, "invalid", "unknown agent");
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory_proposals where workspace_id = ${t.ws}`)[0].n, 0);
});

Deno.test("a contradicting proposal is flagged; approving it needs the version the reviewer saw", opts, async () => {
  const t = await team();
  const fact = { kind: "fact", category: "company", fact_key: "company.hq", value_type: "text" };
  await memoryWrite(t.ws, t.owner, "set", { ...fact, value: "Oslo" });
  const p = await propose(t.ws, "atlas", {
    ...fact, value: "Bergen", rationale: "LinkedIn lists Bergen as HQ", source_type: "provider_returned",
    evidence: [{ source_url: "https://linkedin.example.test/company/northwind", observed_at: "2026-11-01T00:00:00Z" }],
  });
  assertEquals(p.outcome, "contradiction"); assert(p.contradicts_memory_id);
  assertEquals((await review(t.ws, t.owner, String(p.proposal_id), "approve")).outcome, "stale", "no version → refused");
  const ok = await review(t.ws, t.owner, String(p.proposal_id), "correct", { corrected: "Bergen (since 2026)", expectedVersion: 1 });
  assertEquals(ok.outcome, "ok"); assertEquals(ok.status, "corrected");
  const [row] = await items(t.ws);
  assertEquals(row.value, "Bergen (since 2026)"); assertEquals(row.version, 2);
  assertEquals(row.source_type, "user_provided", "a person's correction is user-provided");
  assertEquals(row.source_url, "https://linkedin.example.test/company/northwind");
  const h = await history(row.id);
  assertEquals(h[1].previous.value, "Oslo");
});

Deno.test("cross-workspace review: a proposal from workspace B cannot be approved through workspace A", opts, async () => {
  const a = await team(); const b = await team();
  const p = await propose(b.ws, "lisa", competitorProposal("rivalco.com"));
  assertEquals((await review(a.ws, a.owner, String(p.proposal_id), "approve")).outcome, "not_found");
  assertEquals((await items(a.ws)).length + (await items(b.ws)).length, 0);
});

// ── 8. profile revisions ──────────────────────────────────────────────────────
async function brainWrite(ws: string, p: { id: string; session: string }, profile: Record<string, unknown>) {
  const svc = await as("service_role");
  const [{ v }] = await sql`select updated_at::text v from public.company_brain where workspace_id = ${ws}`;
  const { data, error } = await svc.rpc("company_brain_authorized_write", {
    p_workspace_id: ws, p_actor_id: p.id, p_session_id: p.session, p_permission: "edit",
    p_mode: "cas", p_profile: profile, p_expected_updated_at: v, p_activate: false,
  });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as { outcome: string };
}

Deno.test("every material Brain write is a revision with its actor and changed sections; a retry adds none", opts, async () => {
  const t = await team({ company: { name: "Northwind" }, icp: { company_size: "10-50" } });
  const revs = async () => await sql`select revision, actor_kind, actor_id, changed_sections, profile from public.company_brain_revisions where workspace_id = ${t.ws} order by revision`;
  assertEquals((await revs()).length, 1, "provisioning the row is revision 1");
  assertEquals((await revs())[0].actor_kind, "system");

  assertEquals((await brainWrite(t.ws, t.editor, { company: { name: "Northwind" }, icp: { company_size: "50-200" } })).outcome, "ok");
  const after = await revs();
  assertEquals(after.length, 2);
  assertEquals(after[1].actor_kind, "user"); assertEquals(after[1].actor_id, t.editor.id);
  assertEquals(after[1].changed_sections, ["icp"]);
  assertEquals(after[0].profile.icp.company_size, "10-50", "the earlier profile is preserved");

  assertEquals((await brainWrite(t.ws, t.editor, { company: { name: "Northwind" }, icp: { company_size: "50-200" } })).outcome, "ok");
  assertEquals((await revs()).length, 2, "an identical rewrite is not a new revision");

  // The actor setting is transaction-local: a later system write is not attributed to the editor.
  await sql`update public.company_brain set profile = profile || '{"x": 1}' where workspace_id = ${t.ws}`;
  const last = (await revs()).at(-1)!;
  assertEquals(last.actor_kind, "system"); assertEquals(last.actor_id, null);
});

Deno.test("a pre-existing Brain is back-filled as revision 1 (backward compatible)", opts, async () => {
  const [n] = await sql`select count(*)::int n from public.company_brain b
     where not exists (select 1 from public.company_brain_revisions r where r.workspace_id = b.workspace_id)`;
  assertEquals(n.n, 0, "every Brain has a revision history");
});

// ── 9. privacy redaction ─────────────────────────────────────────────────────
Deno.test("redaction blanks the value everywhere, keeps who/when, and needs owner or admin", opts, async () => {
  const t = await team();
  const f = await memoryWrite(t.ws, t.owner, "set", {
    kind: "fact", category: "customers", fact_key: "customer.jane_doe_co", value_type: "text", value: "Jane Doe's private notes",
  });
  await memoryWrite(t.ws, t.owner, "set", {
    kind: "fact", category: "customers", fact_key: "customer.jane_doe_co", value_type: "text", value: "Jane Doe v2", expected_version: 1,
  });
  const svc = await as("service_role");
  const call = async (p: { id: string; session: string }) => (await svc.rpc("company_brain_memory_redact", {
    p_workspace_id: t.ws, p_actor_id: p.id, p_session_id: p.session, p_target: "memory", p_id: f.memory_id, p_reason: "GDPR erasure request",
  })).data as Record<string, unknown>;
  assertEquals((await call(t.editor)).outcome, "forbidden_role");
  assertEquals((await call(t.owner)).outcome, "ok");
  const [row] = await items(t.ws);
  assertEquals(row.value, null); assertEquals(row.lifecycle_status, "retracted"); assert(row.redacted_at);
  const h = await history(row.id);
  assertEquals(h.map((x) => x.change_kind), ["created", "updated", "redacted"]);
  const dump = JSON.stringify(h);
  assert(!dump.includes("Jane Doe"), "no snapshot still holds the redacted value");
  assertEquals(h[1].actor_id, t.owner.id, "who changed it survives");
});

// Silence unused-import lint for helpers kept for symmetry with the other memory file.
void join; void seedWorkspace;
