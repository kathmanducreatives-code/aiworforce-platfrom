// SIGNALS AUDIT · DATABASE PROBES (2026-11-28). Real Postgres + PostgREST + RLS (the contract lane).
// Every signal is a TEST FIXTURE replayed from tests/fixtures (LISA engine) in a throwaway
// workspace. Nothing touches Brain TEST or production.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, opts, sql, team } from "./lib/brainMemory.ts";
import { rpcSignalStore } from "../../supabase/functions/_shared/lisa/persistence.ts";
import { loadFixture, replay } from "../edge-functions/_shared/lisa/lisaFixtures.ts";
import { loadCompanyBrainContext, type LoaderDb } from "../../supabase/functions/_shared/companyBrainContextLoader.ts";

const PROFILE = { schema_version: 2, company: { name: "[TEST FIXTURE] Northwind" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"] } };

async function canonicalSignal(ws: string): Promise<string> {
  const svc = await as("service_role");
  const loaded = await loadCompanyBrainContext(svc as unknown as LoaderDb, ws, { skipMembershipCheck: true });
  await replay(loadFixture("expansion"), { brain: loaded.ok ? loaded.context : null, store: rpcSignalStore(svc), workspace_id: ws });
  const [row] = await sql`select id from public.signal_events where workspace_id = ${ws} limit 1`;
  assert(row?.id, "the fixture produced one canonical signal_events row");
  return row.id as string;
}

Deno.test("FINDING: a review of a CANONICAL signal is refused — signal_reviews.signal_id references legacy public.signals", opts, async () => {
  const t = await team(PROFILE);
  const id = await canonicalSignal(t.ws);
  const owner = await as("authenticated", t.owner.id);
  const { error } = await owner.from("signal_reviews").insert({ workspace_id: t.ws, signal_id: id, user_id: t.owner.id, status: "reviewed" });
  assert(error, "the review should fail");
  assertEquals(error!.code, "23503", `foreign-key violation expected, got ${JSON.stringify(error)}`);
});

Deno.test("A review of a LEGACY signal works for a member (per-user triage)", opts, async () => {
  const t = await team(PROFILE);
  const [sig] = await sql`insert into public.signals (workspace_id, title) values (${t.ws}, '[TEST FIXTURE] legacy radar row') returning id`;
  const owner = await as("authenticated", t.owner.id);
  const { error } = await owner.from("signal_reviews").insert({ workspace_id: t.ws, signal_id: sig.id, user_id: t.owner.id, status: "reviewed" });
  assertEquals(error, null);
});

Deno.test("Isolation: another workspace's member cannot read a canonical signal; its own owner can", opts, async () => {
  const a = await team(PROFILE);
  const b = await team(PROFILE);
  await canonicalSignal(a.ws);
  const outsider = await as("authenticated", b.owner.id);
  const seen = await outsider.from("signal_events").select("id").eq("workspace_id", a.ws);
  assertEquals(seen.error, null);
  assertEquals(seen.data?.length ?? 0, 0);
  const insider = await as("authenticated", a.owner.id);
  const own = await insider.from("signal_events").select("id").eq("workspace_id", a.ws);
  assert((own.data?.length ?? 0) > 0);
});

Deno.test("The DATABASE refuses a direct monitoring_subjects write from any member (only server paths write it)", opts, async () => {
  const t = await team(PROFILE);
  for (const p of [t.viewer, t.owner]) {
    const c = await as("authenticated", p.id);
    const { error } = await c.from("monitoring_subjects").insert({ workspace_id: t.ws, subject_kind: "company", identifier: "acme-fixture.example", label: "Acme", enabled: true });
    assert(error, "direct write refused");
  }
  const [{ n }] = await sql`select count(*)::int as n from public.monitoring_subjects where workspace_id = ${t.ws}`;
  assertEquals(n, 0);
});
