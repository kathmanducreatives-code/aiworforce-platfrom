// WORKFORCE V2 · PHASE 1 ACCEPTANCE — one Company Brain, four departments.
//
// Brain: US manufacturing businesses, 20–200 employees; an APPROVED memory
// exclusion of software companies. Every department must read the same
// effective Brain and respect it. Real loader, views, relevance and ORION
// assessment code; in-memory tables; recorded fictional search hits.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadCompanyBrainContext } from "../../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { loadChatBrain } from "../../../../supabase/functions/_shared/chatBrainContext.ts";
import { loadMissionContextWithMemory } from "../../../../supabase/functions/_shared/intelligence/missionContext.ts";
import { lyraView } from "../../../../supabase/functions/_shared/companyBrainAgentViews.ts";
import { toAgentSignal, type StoredSignalRow } from "../../../../supabase/functions/_shared/lisa/weekly.ts";
import type { LisaSignal } from "../../../../supabase/functions/_shared/lisa/types.ts";
import { assessForOrion } from "../../../../supabase/functions/_shared/collab/lisaToOrion.ts";
import { buildLyraBrief } from "../../../../supabase/functions/_shared/collab/lisaToLyra.ts";
import { replay, type Fixture } from "../lisa/lisaFixtures.ts";

const WS = "aaaaaaaa-0000-4000-8000-00000000a7c1";
const USER = "11111111-0000-4000-8000-00000000a7c2";
const NOW = new Date("2026-11-10T12:00:00Z");
type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  const make = (t: string) => {
    let rows = [...(tables[t] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() { return q; }, order() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); },
    };
    return q;
  };
  return { from: make };
}
const TABLES = {
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [{ workspace_id: WS, onboarding_completed: true, updated_at: "2026-10-01T00:00:00Z",
    profile: { schema_version: 2, company: { name: "Everest Industrial Automation (fictional)" },
      target_customer: { industries: ["Manufacturing"], geography: ["United States"], company_size: { min: 20, max: 200 } } } }],
  company_brain_memory: [{ id: "m-ex", workspace_id: WS, kind: "preference", category: "exclusions", fact_key: "exclusion.industry:software",
    scope: "workspace", scope_ref: null, value_type: "object", value: { type: "industry", value: "Software" }, version: 1,
    source_type: "user_provided", verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
    persistence: "permanent", approval_status: "approved", created_by_kind: "user", updated_at: "2026-10-05T00:00:00Z" },
    // A PENDING agent idea must NOT influence anything (not approved → not in this table's servable set).
    { id: "m-prop", workspace_id: WS, kind: "preference", category: "exclusions", fact_key: "exclusion.industry:manufacturing",
      scope: "workspace", scope_ref: null, value_type: "object", value: { type: "industry", value: "Manufacturing" }, version: 1,
      source_type: "agent_suggestion", verification_status: "unverified", confidence: "low", lifecycle_status: "active",
      persistence: "permanent", approval_status: "pending", created_by_kind: "agent", updated_at: "2026-10-06T00:00:00Z" }],
};
const market = { kind: "market" as const, domain: null, name: "ICP: Manufacturing", origin: "icp" as const, categories: ["expansion" as const], cadence_minutes: 10080 };
const hit = (url: string, title: string, desc: string) => ({ url, title, description: desc, published_at: "2026-11-06" });
const FX: Fixture = { name: "consistency", note: "fictional", now: NOW.toISOString(), subject: market, expect: {},
  responses: { expansion: { hits: [
    hit("https://plant-news.example/kestrel", "Kestrel Fabrication opens new manufacturing plant in Columbus, Ohio", "Kestrel Fabrication, a metal parts manufacturer with 140 employees, opens a new manufacturing plant in Columbus, Ohio."),
    hit("https://fab-weekly.example/kestrel", "Kestrel Fabrication opens manufacturing plant in Columbus", "Kestrel Fabrication opens a new manufacturing plant in Columbus, Ohio."),
    hit("https://tech-wire.example/cloudnova", "Cloudnova Software opens new office in Austin, Texas", "Cloudnova Software, a SaaS software company, opens a new office in Austin, Texas."),
    hit("https://saas-daily.example/cloudnova", "Cloudnova Software opens office in Austin", "Cloudnova Software opens a new office in Austin, Texas."),
  ], error: null, credits: 1 } } };

async function brain() {
  const r = await loadCompanyBrainContext(db(TABLES) as never, WS, { userId: USER, now: NOW });
  assert(r.ok);
  return r.context;
}
const rowOf = (s: LisaSignal, id: string): StoredSignalRow => ({ id, workspace_id: WS, signal_type: s.signal_type, lifecycle_status: s.lifecycle_status,
  verification_status: s.verification.column_status, confidence: s.verification.confidence, occurred_at: s.event_date, observed_at: s.discovered_at,
  source_url: s.source_url, subject_type: s.subject_type, subject_key: s.subject_key,
  normalized_value: { lisa: { category: s.category, company: { name: s.company_name, domain: s.company_domain }, title: s.title, description: s.description,
    event_date: s.event_date, discovered_at: s.discovered_at, event_instance: s.event_instance, source_type: s.source_type, watch_origin: s.watch_origin,
    verification: s.verification, relevance: s.relevance } } });

Deno.test("Brain: the effective Brain carries the approved software exclusion and ignores the pending agent proposal", async () => {
  const b = await brain();
  assertEquals(b.exclusions.industries, ["Software"]);
  assertFalse(b.exclusions.industries.includes("Manufacturing"), "an unapproved proposal never influences agents");
  assertEquals(b.canonical.target_customer.industries, ["Manufacturing"]);
});

Deno.test("ORION (chat): the chat Brain block now carries the exclusion and ICP from the shared loader", async () => {
  const c = await loadChatBrain(db(TABLES), WS, USER, NOW);
  assertEquals(c.source, "shared_loader");
  assertStringIncludes(c.memoryBlock, "Software");
  assert(c.fingerprint);
  // Non-members get no Brain (authorization preserved).
  const stranger = await loadChatBrain(db(TABLES), WS, "22222222-0000-4000-8000-000000000000", NOW);
  assertEquals(stranger.row, null);
});

Deno.test("ATLAS: the planner context has the ICP (manufacturing, 20–200, US) and the software exclusion, with a fingerprint", async () => {
  const m = await loadMissionContextWithMemory(db(TABLES) as never, WS, { userId: USER });
  assert(m.ok && m.context && m.brain_contract);
  assertEquals(m.brain_contract.industries, ["Manufacturing"]);
  assertEquals(m.brain_contract.company_size, { min: 20, max: 200 });
  assertEquals(m.brain_contract.geography, ["United States"]);
  assertEquals(m.brain_contract.exclusions.industries, ["Software"]);
  assert(JSON.stringify(m.context.icp).toLowerCase().includes("software"), "the mission ICP excludes software");
});

Deno.test("LISA + ORION: the manufacturer is recommended; the software company is excluded before any recommendation", async () => {
  const b = await brain();
  const r = await replay(FX, { brain: b });
  const sigs = [...(r.store as unknown as { events: Map<string, LisaSignal> }).events.values()];
  const kestrel = sigs.find((s) => s.company_name.startsWith("Kestrel"));
  assert(kestrel, "the manufacturer is kept");
  assertFalse(sigs.some((s) => s.company_name.startsWith("Cloudnova")), "LISA drops the software company (exclusion runs first)");
  assertEquals(r.counts.dropped.excluded, 1);
  const opp = assessForOrion(toAgentSignal(rowOf(kestrel!, "s1"), b, NOW)!, b, NOW);
  assert(opp.trusted);
  assert(opp.recommended.some((x) => x.kind === "atlas_research"));
  // Even a software signal that reached ORION by another route is blocked by the same Brain.
  const sw = { ...kestrel!, company_name: "Cloudnova Software", title: "Cloudnova Software, a SaaS software company, opens office", description: "SaaS software company" };
  const o2 = assessForOrion(toAgentSignal(rowOf(sw, "s2"), b, NOW)!, b, NOW);
  assertEquals(o2.blocked, "excluded_by_brain");
});

Deno.test("LYRA: the content brief carries the exclusion as a restriction and the brand context from the same Brain", async () => {
  const b = await brain();
  const r = await replay(FX, { brain: b });
  const [k] = [...(r.store as unknown as { events: Map<string, LisaSignal> }).events.values()];
  const s = toAgentSignal(rowOf(k, "s1"), b, NOW)!;
  const brief = buildLyraBrief(s, assessForOrion(s, b, NOW), lyraView(b), b.exclusions.industries);
  assert(brief.restrictions.some((x) => x.includes("Software")));
});
