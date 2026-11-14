// R1.1 · ORION WORKSPACE TOTALS AND NAMED-ACCOUNT LOOKUP against real Postgres
// + PostgREST (the exact queries pilot-chat sends, through supabase-js, on the
// real schema). FICTIONAL data shaped like the audited production workspace:
// accounts ≫ leads, no scores, no contacts, old hiring signals with no event
// date, one disabled monitoring subject, named companies that are accounts but
// not leads — and a second workspace whose rows must never appear.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, opts, person, sql, team, uuid } from "./lib/brainMemory.ts";
import { loadWorkspaceFacts } from "../../supabase/functions/_shared/orionWorkspaceFacts.ts";
import { loadOrionEvidenceDigest, digestFacts } from "../../supabase/functions/_shared/orionEvidenceContext.ts";
import type { EvidenceDb } from "../../supabase/functions/_shared/evidence/retrieve.ts";

const PROFILE = { schema_version: 2, company: { name: "Agentory-like (fictional)" },
  target_customer: { industries: ["B2B Software"], geography: ["United States"], company_size: { min: 2, max: 2, label: "5" } } };
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function seed() {
  const t = await team(PROFILE);
  const ids: string[] = [];
  for (let i = 0; i < 30; i++) {
    const name = ["Laminar", "Epsilon3", "Civilgrid", "Hyperbound"][i] ?? `Fictco ${i}`;
    const [a] = await sql`insert into public.accounts (workspace_id, name, domain, industry) values
      (${t.ws}, ${name}, ${`${name.toLowerCase().replace(/\s+/g, "")}.example`}, 'Software') returning id`;
    ids.push(a.id as string);
  }
  // 12 leads: Hyperbound (index 3) and 4..14. Laminar/Epsilon3/Civilgrid stay accounts only.
  for (const i of [3, ...Array.from({ length: 11 }, (_, k) => k + 4)]) {
    await sql`insert into public.lead_candidates (workspace_id, account_id, status, reason, created_at)
      values (${t.ws}, ${ids[i]}, 'new', 'Hiring signal: Business Development Representative', ${ago(31)})`;
  }
  for (let i = 0; i < 9; i++) {
    const hiring = i < 6;
    await sql`insert into public.signal_events (workspace_id, signal_type, signal_category, occurred_at, occurred_at_basis, observed_at,
        dedupe_key, origin, subject_type, subject_key, lifecycle_status, verification_status, confidence, source_url, normalized_value)
      values (${t.ws}, ${hiring ? "sales_hiring" : "recent_funding"}, 'growth', null, 'unknown', ${hiring ? ago(32) : ago(3)},
        ${`r11:${uuid()}`}, 'manual_scan', 'company', ${`fictco${i}`}, 'active', 'unverified', 'medium', ${`https://jobs.example/${i}`},
        ${sql.json({ lisa: { company: { name: `Fictco ${i}` }, title: hiring ? `Hiring: SDR ${i}` : `Funding ${i}`, verification: { level: "single_source" } } } as never)})`;
  }
  await sql`insert into public.monitoring_subjects (workspace_id, subject_kind, identifier, label, signals, enabled)
    values (${t.ws}, 'competitor', 'fictco0.example', 'Fictco watch', ${sql.json([{ event: "hiring", subject: "company" }] as never)}, false)`;
  // Another workspace: a QUALIFIED "Laminar" lead with a contact. Must never appear.
  const other = await team({ schema_version: 2, company: { name: "Other (fictional)" } });
  const [oa] = await sql`insert into public.accounts (workspace_id, name, domain, stage) values (${other.ws}, 'Laminar', 'laminar-other.example', 'qualified') returning id`;
  await sql`insert into public.lead_candidates (workspace_id, account_id, status, fit_score, reason) values (${other.ws}, ${oa.id}, 'qualified', 95, 'OTHER WORKSPACE')`;
  await sql`insert into public.contacts (workspace_id, account_id, full_name) values (${other.ws}, ${oa.id}, 'Other Person')`;
  return { t, other };
}

Deno.test({ name: "R1.1 totals (real DB): every count query is valid on the real schema and counts this workspace only", ...opts, fn: async () => {
  const { t } = await seed();
  const db = await as("service_role");
  const t0 = Date.now();
  const f = await loadWorkspaceFacts(db as never, { workspaceId: t.ws, message: "Compare Hyperbound, Laminar, Epsilon3, and Civilgrid" });
  const ms = Date.now() - t0;
  const ok = (c: { status: string; value?: number }) => (c.status === "ok" ? c.value : `FAILED`);
  assertEquals(ok(f.totals.accounts), 30);
  assertEquals(ok(f.totals.leads), 12);
  assertEquals(f.totals.lead_statuses, { new: 12 });
  assertEquals(ok(f.totals.leads_scored), 0);
  assertEquals(ok(f.totals.leads_qualified), 0, "the other workspace's qualified lead is not counted");
  assertEquals(ok(f.totals.contacts), 0, "the other workspace's contact is not counted");
  assertEquals(ok(f.totals.signals), 9);
  assertEquals(ok(f.totals.hiring_signals), 6);
  assertEquals(ok(f.totals.hiring_signals_older_than_30d), 6);
  assertEquals(ok(f.totals.signals_without_event_date), 9);
  assertEquals(ok(f.totals.monitoring_subjects), 1);
  assertEquals(ok(f.totals.monitoring_enabled), 0);
  const named = Object.fromEntries(f.named.map((n) => [n.name, n]));
  for (const n of ["Laminar", "Epsilon3", "Civilgrid"]) {
    assert(named[n], `${n} found in accounts`);
    assertFalse(named[n].is_lead, `${n} is not a lead`);
    assertEquals(named[n].contacts, 0);
  }
  assert(named.Hyperbound?.is_lead);
  assertFalse(f.named.some((n) => n.domain === "laminar-other.example"));
  console.log(`  totals + named lookup on the local real DB: ${ms} ms`);
} });

Deno.test({ name: "R1.1 digest (real DB): a member gets totals first, then dated [E#]; an outsider gets nothing", ...opts, fn: async () => {
  const { t, other } = await seed();
  const db = (await as("service_role")) as unknown as EvidenceDb;
  const d = await loadOrionEvidenceDigest(db, { workspaceId: t.ws, userId: t.owner.id,
    message: "Identify hiring signals older than 30 days among our stored company records." });
  assert(d);
  const text = digestFacts(d).map((x) => x.text).join("\n");
  assert(text.indexOf("WORKSPACE TOTALS") < text.indexOf("[E1]"), "totals precede evidence");
  assertStringIncludes(text, "Hiring signals: 6");
  assertStringIncludes(text, "(event date not recorded)");
  assertStringIncludes(text, "HISTORICAL hiring evidence");
  assertStringIncludes(text, "COMPANY BRAIN DATA CHECK");
  assertFalse(text.includes("OTHER WORKSPACE"));
  // A member of ANOTHER workspace asking about this one: refused before any read.
  assertEquals(await loadOrionEvidenceDigest(db, { workspaceId: t.ws, userId: other.owner.id, message: "how many leads?" }), null);
  // A user with no membership at all.
  const stranger = await person();
  assertEquals(await loadOrionEvidenceDigest(db, { workspaceId: t.ws, userId: stranger.id, message: "how many leads?" }), null);
} });
