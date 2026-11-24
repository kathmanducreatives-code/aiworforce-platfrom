// ORION EVIDENCE RETRIEVAL against real Postgres + PostgREST (the queries ORION
// actually sends, through supabase-js, with the lead → account embed), on top of
// the held Company Brain memory schema. FICTIONAL data only.
//
// Proves: the queries are valid against the real schema; approved Brain
// exclusions mark evidence; stale / contradicted signals are labelled; a
// non-member gets nothing; another workspace's records never appear; and the
// pilot-scoped flag gates the digest. Records retrieval time (local DB).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, join, memoryWrite, opts, person, sql, team, uuid } from "./lib/brainMemory.ts";
import { retrieveEvidence, type EvidenceDb } from "../../supabase/functions/_shared/evidence/retrieve.ts";
import { orionEvidenceForTurn } from "../../supabase/functions/_shared/orionEvidenceContext.ts";

const PROFILE = { schema_version: 2, company: { name: "Everest Industrial (fictional)" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"], company_size: { min: 20, max: 200 } } };

async function account(ws: string, name: string, domain: string): Promise<string> {
  const [a] = await sql`insert into public.accounts (workspace_id, name, domain) values (${ws}, ${name}, ${domain}) returning id`;
  return a.id as string;
}
async function signal(ws: string, name: string, domain: string, title: string, level: string, occurred: string, lifecycle = "active") {
  const key = domain.replace(/\..*$/, "").replace(/[^a-z0-9]+/g, "-");
  await sql`insert into public.signal_events (workspace_id, signal_type, signal_category, occurred_at, occurred_at_basis, observed_at,
      dedupe_key, origin, subject_type, subject_key, lifecycle_status, verification_status, confidence, source_url, normalized_value)
    values (${ws}, 'geographic_expansion', 'growth', ${occurred}, 'source_reported', now(), ${`pilot:${uuid()}`}, 'manual_scan',
      'company', ${key}, ${lifecycle}, ${level === "corroborated" ? "provider_verified" : "unverified"}, 'medium',
      ${`https://news.example/${key}`},
      ${sql.json({ lisa: { company: { name, domain }, title, event_date: occurred.slice(0, 10), verification: { level } } } as never)})`;
}

async function pilot() {
  const t = await team(PROFILE);
  await memoryWrite(t.ws, t.owner, "set", { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:software",
    value_type: "object", value: { type: "industry", value: "Software" } });
  const recent = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  await signal(t.ws, "Kestrel Fabrication", "kestrel-fab.example", "opens a second plant in Dayton", "corroborated", recent(6));
  await signal(t.ws, "Harbor Valve Works", "harborvalve.example", "hiring 12 machinists", "single_source", recent(9));
  await signal(t.ws, "Cloudnova Software", "cloudnova.example", "opens a new software office", "corroborated", recent(7));
  await signal(t.ws, "Pinecrest Tooling", "pinecrest.example", "adds a CNC line (forum post)", "single_source", recent(130));
  await signal(t.ws, "Ridgeway Castings", "ridgeway.example", "expansion denied by the company", "contradicted", recent(8), "contradicted");
  const acct = await account(t.ws, "Cloudnova Software", "cloudnova.example");
  await sql`insert into public.lead_candidates (workspace_id, account_id, status, fit_score, reason)
    values (${t.ws}, ${acct}, 'rejected', 20, 'Software company — outside the manufacturing ICP')`;
  // Another workspace with its own records: they must never reach the pilot.
  const other = await team({ schema_version: 2, company: { name: "Other Co (fictional)" } });
  await signal(other.ws, "Zephyr Industries", "zephyr.example", "opens a plant", "corroborated", recent(3));
  return { t, other };
}

Deno.test({ name: "ORION evidence (real DB): queries run, Brain exclusions apply, freshness and verification are labelled", ...opts, fn: async () => {
  const { t } = await pilot();
  const db = (await as("service_role")) as unknown as EvidenceDb;
  const t0 = Date.now();
  const r = await retrieveEvidence(db, { workspaceId: t.ws, userId: t.owner.id, limit: 40 });
  const ms = Date.now() - t0;
  assert(r.ok, "member retrieval succeeds");
  assertEquals(r.sources.lisa_signal, "ok");
  assertEquals(r.sources.lead, "ok", "the lead → account embed is valid against the real schema");
  const by = (n: string) => r.items.find((x) => x.subject.name === n);
  assertEquals(by("Kestrel Fabrication")?.verification, "verified");
  assertEquals(by("Harbor Valve Works")?.verification, "single_source");
  assertEquals(by("Pinecrest Tooling")?.verification, "stale");
  assertEquals(by("Ridgeway Castings")?.verification, "contradicted");
  assert(r.items.some((x) => x.source_type === "lead" && x.subject.name === "Cloudnova Software"));
  assertFalse(r.items.some((x) => x.subject.name === "Zephyr Industries"), "another workspace's signal never appears");
  assert(r.brain?.exclusions.industries.includes("Software"), "approved exclusion loaded from company_brain_memory");
  console.log(`retrieval_ms (local PostgREST) = ${ms}`);
  assert(ms < 2000, `retrieval took ${ms} ms`);
}});

Deno.test({ name: "ORION evidence (real DB): non-member refused with nothing read; viewer may read", ...opts, fn: async () => {
  const { t } = await pilot();
  const db = (await as("service_role")) as unknown as EvidenceDb;
  const stranger = await person();
  const refused = await retrieveEvidence(db, { workspaceId: t.ws, userId: stranger.id });
  assertFalse(refused.ok);
  assertEquals(refused.items.length, 0);
  assert((await retrieveEvidence(db, { workspaceId: t.ws, userId: t.viewer.id })).ok);
  // A member of ANOTHER workspace asking about this one is a stranger here.
  const outsider = await person();
  const { other } = await pilot();
  await join(other.ws, outsider, "owner");
  assertFalse((await retrieveEvidence(db, { workspaceId: t.ws, userId: outsider.id })).ok);
}});

Deno.test({ name: "ORION evidence (real DB): the pilot flag and workspace scope gate the digest; excluded company marked", ...opts, fn: async () => {
  const { t, other } = await pilot();
  const db = (await as("service_role")) as unknown as EvidenceDb;
  const args = { task: "complex_company_qa", workspaceId: t.ws, userId: t.owner.id, message: "Which opportunities best match our ICP?" };
  assertEquals(await orionEvidenceForTurn(db, args, () => undefined), null, "flag off → no evidence");
  const scoped = (k: string) => k === "AGENTORY_ORION_EVIDENCE_CONTEXT" ? "true" : k === "AGENTORY_ORION_EVIDENCE_WORKSPACES" ? t.ws : undefined;
  const d = await orionEvidenceForTurn(db, args, scoped);
  assert(d && d.cited_ids.length > 0);
  const text = d!.facts.map((f) => f.text).join("\n");
  assertStringIncludes(text, "Kestrel Fabrication");
  assertStringIncludes(text, "EXCLUDED by the Company Brain (industry Software)");
  assertFalse(text.includes("Zephyr"));
  assert(typeof d!.retrieval_ms === "number");
  // Out of pilot scope → nothing, even for a real member of that workspace.
  assertEquals(await orionEvidenceForTurn(db, { ...args, workspaceId: other.ws, userId: other.owner.id }, scoped), null);
}});
