// Company Brain V1 memory: model, fold, loader and agent views. Offline —
// fictional data, an in-memory fake of the PostgREST builder, no network.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LIFECYCLE_STATUSES, MEMORY_SCOPES, PROPOSAL_AGENTS, SOURCE_TYPES, VERIFICATION_STATUSES, WORKSPACE_WIDE_DECISIONS,
  MEMORY_COLUMNS, canonicalDomain, decidedAgainst, decisionScopeError, deriveExclusions, effectiveStatus, isServable, matchExclusion,
  provenanceLabel, provenanceViolation, proposalError, valueMatchesType, type MemoryItem,
} from "../../../supabase/functions/_shared/brainMemoryModel.ts";
import { foldMemoryIntoProfile, loadCompanyBrainContext, type LoaderDb } from "../../../supabase/functions/_shared/companyBrainContextLoader.ts";
import { atlasView, lisaView, lyraView, orionView, renderBrainMemoryBlock } from "../../../supabase/functions/_shared/companyBrainAgentViews.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const USER = "11111111-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-10T12:00:00.000Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let seq = 0;
function item(over: Partial<MemoryItem> = {}): MemoryItem {
  seq++;
  return {
    id: `m-${seq}`, workspace_id: A, kind: "preference", category: "icp", fact_key: `k.${seq}`, scope: "workspace", scope_ref: null,
    value_type: "text", value: "x", version: 1, source_type: "user_provided", source_ref: null, source_url: null,
    verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active", persistence: "persistent",
    approval_status: "not_required", created_by_kind: "user", created_by_agent: null, approved_by: null, proposal_id: null,
    observed_at: ago(1), review_at: null, expires_at: null, updated_at: ago(1), redacted_at: null, ...over,
  };
}

type Row = Record<string, unknown>;
// A table may hold loose rows or MemoryItems (an interface has no index signature).
type Table = Array<Row | MemoryItem>;
function fakeDb(tables: Record<string, Table>, failing: string[] = []): LoaderDb & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      let rows = [...(tables[table] ?? [])] as Row[];
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select() { return q; },
        eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
        order(c: string, o: { ascending: boolean }) {
          rows.sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : 1) * (o.ascending ? 1 : -1)); return q;
        },
        limit(n: number) { rows = rows.slice(0, n); return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          const out = failing.includes(table) ? { data: null, error: { message: "relation does not exist" } } : { data: rows, error: null };
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
  };
}

const brainRow = (ws: string, profile: Row, updated = ago(30)) => ({ workspace_id: ws, profile, updated_at: updated, onboarding_completed: true });
const PROFILE = {
  schema_version: 2,
  company: { name: "Northwind Robotics", description: "Warehouse picking robots" },
  target_customer: { industries: ["Manufacturing"], company_size: { min: 10, max: 50 }, geography: ["Nordics"] },
  competitors: ["Rivalco"],
  goals: { gtm: "Win 10 manufacturing customers this quarter" },
  brand_voice: { tone: "plain, technical", avoid: ["hype"] },
};

// ── the SQL is the enforcement; the TS mirror must not drift ─────────────────
Deno.test("TS vocabularies match the migration's CHECK constraints", async () => {
  const sqlText = await Deno.readTextFile(new URL("../../../supabase/migrations-held/20261110120000_company_brain_memory.sql", import.meta.url));
  const listIn = (constraint: string) => {
    const m = sqlText.match(new RegExp(`constraint ${constraint} check \\(\\s*\\w+ in\\s*\\(([^)]*)\\)`, "m"));
    assert(m, `found ${constraint}`);
    return m[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort();
  };
  assertEquals(listIn("cbm_source_type_valid"), [...SOURCE_TYPES].sort());
  assertEquals(listIn("cbm_verification_valid"), [...VERIFICATION_STATUSES].sort());
  assertEquals(listIn("cbm_lifecycle_valid"), [...LIFECYCLE_STATUSES].sort());
  assertEquals(listIn("cbm_scope_valid"), [...MEMORY_SCOPES].sort());
  assertEquals(listIn("cbmp_agent_valid"), [...PROPOSAL_AGENTS].sort());
  const wide = sqlText.match(/v_category in \(([^)]*)\)/);
  assertEquals(wide![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort(), [...WORKSPACE_WIDE_DECISIONS].sort());
});

// ── provenance ───────────────────────────────────────────────────────────────
Deno.test("provenance: a model inference is never 'verified', a person's approval is labelled as such", () => {
  assert(provenanceViolation(item({ source_type: "model_inference", verification_status: "corroborated" })));
  assert(provenanceViolation(item({ source_type: "agent_suggestion", verification_status: "provider_reported" })));
  assert(provenanceViolation(item({ source_type: "provider_returned", verification_status: "corroborated" })));
  assert(provenanceViolation(item({ source_type: "corroborated", verification_status: "corroborated" })), "needs a source");
  assertEquals(provenanceViolation(item({ source_type: "corroborated", verification_status: "corroborated", source_url: "https://x.test" })), null);
  assert(provenanceViolation(item({ created_by_kind: "agent", source_type: "agent_suggestion", verification_status: "user_confirmed" })), "agent item without approval");
  const approved = item({ created_by_kind: "agent", created_by_agent: "lisa", source_type: "agent_suggestion", verification_status: "user_confirmed",
    approval_status: "approved", approved_by: USER, proposal_id: "p1" });
  assertEquals(provenanceViolation(approved), null);
  assertEquals(provenanceLabel(approved), "Suggested by Lisa · confirmed by your team");
  assertEquals(provenanceLabel(item({ source_type: "provider_returned", verification_status: "provider_reported" })),
    "Reported by a data provider · not independently verified");
  assertEquals(provenanceLabel(item()), "You entered this");
});

Deno.test("values are checked against their declared type, like the SQL function", () => {
  assert(valueMatchesType("number_range", { min: 10, max: 50 }));
  assertFalse(valueMatchesType("number_range", { min: 50, max: 10 }));
  assertFalse(valueMatchesType("number_range", {}));
  assert(valueMatchesType("list", ["a"])); assertFalse(valueMatchesType("list", [])); assertFalse(valueMatchesType("list", ["a", 1]));
  assertFalse(valueMatchesType("text", "  ")); assert(valueMatchesType("redacted", null));
  assertFalse(valueMatchesType("object", {})); assertFalse(valueMatchesType("weird", "x"));
});

// ── lifecycle / staleness / expiry ───────────────────────────────────────────
Deno.test("only active, unexpired, non-redacted, person-backed items are servable", () => {
  assert(isServable(item(), NOW));
  for (const s of ["retracted", "superseded", "rejected", "disputed", "stale", "expired"] as const) {
    assertFalse(isServable(item({ lifecycle_status: s }), NOW), s);
  }
  assertFalse(isServable(item({ expires_at: ago(1), persistence: "temporary" }), NOW), "expired temporary preference");
  assert(isServable(item({ expires_at: ago(-5), persistence: "temporary" }), NOW), "still-valid temporary preference");
  assertFalse(isServable(item({ redacted_at: ago(1), value_type: "redacted", value: null }), NOW));
  assertEquals(effectiveStatus(item({ category: "competitors", observed_at: ago(200), updated_at: ago(200) }), NOW), "stale");
  assertEquals(effectiveStatus(item({ category: "competitors", observed_at: ago(100) }), NOW), "active");
  assertEquals(effectiveStatus(item({ review_at: ago(1) }), NOW), "stale", "a review date that passed");
  assertEquals(effectiveStatus(item({ kind: "decision", category: "lead_rejected", observed_at: ago(900) }), NOW), "active",
    "decisions do not go stale");
});

// ── decisions and exclusions ─────────────────────────────────────────────────
Deno.test("a rejected lead is a scoped decision, never an exclusion", () => {
  assert(decisionScopeError("lead_rejected", "workspace", null));
  assertEquals(decisionScopeError("lead_rejected", "lead", "lead-1"), null);
  assertEquals(decisionScopeError("icp_changed", "workspace", null), null);
  const rejected = item({ kind: "decision", category: "lead_rejected", fact_key: "lead_rejected", scope: "lead", scope_ref: "lead-1",
    value_type: "object", value: { outcome: "rejected", subject: { label: "Acme Casino" } } });
  const ex = deriveExclusions([rejected], NOW);
  assertEquals([ex.industries, ex.companies, ex.keywords], [[], [], []]);
  assertEquals([...decidedAgainst([rejected], "lead", NOW)], ["lead-1"]);
  assertEquals([...decidedAgainst([rejected], "account", NOW)], [], "does not spill into another scope");
});

Deno.test("explicit exclusions match by company domain, industry and keyword", () => {
  const ex = deriveExclusions([
    item({ category: "exclusions", fact_key: "exclusion.industry:gambling", value_type: "object", value: { type: "industry", value: "Gambling" } }),
    item({ category: "exclusions", fact_key: "exclusion.company:rivalco.com", value_type: "object", value: { type: "company", value: "rivalco.com" } }),
    item({ category: "exclusions", fact_key: "exclusion.keyword:crypto", value_type: "object", value: { type: "keyword", value: "crypto" }, lifecycle_status: "retracted" }),
  ], NOW);
  assertEquals(ex.industries, ["Gambling"]); assertEquals(ex.companies, ["rivalco.com"]); assertEquals(ex.keywords, [], "retracted exclusion ignored");
  assertEquals(matchExclusion(ex, { domain: "app.rivalco.com" }), "company rivalco.com");
  assertEquals(matchExclusion(ex, { industry: "Online Gambling & Casinos" }), "industry Gambling");
  assertEquals(matchExclusion(ex, { name: "Northwind", industry: "Logistics" }), null);
});

Deno.test("proposal validation mirrors the submit function", () => {
  const ok = { kind: "fact" as const, category: "competitors", fact_key: "competitor:rivalco.com", value_type: "object" as const,
    value: { name: "Rivalco", domain: "rivalco.com" }, rationale: "tracked as a competitor", evidence: [], source_type: "agent_suggestion" as const };
  assertEquals(proposalError(ok, "lisa"), null);
  assert(proposalError(ok, "hal"));
  assert(proposalError({ ...ok, source_type: "user_provided" as never }, "lisa"));
  assert(proposalError({ ...ok, source_type: "provider_returned" }, "lisa"), "provider claim without evidence");
  assert(proposalError({ ...ok, evidence: [{ source_url: "javascript:alert(1)" }] }, "lisa"));
  assertEquals(canonicalDomain("https://www.Rivalco.com/pricing"), "rivalco.com");
  assertEquals(canonicalDomain("Rivalco"), null);
});

// ── the fold: newest wins, exclusions narrow, retractions remove ─────────────
Deno.test("fold: a newer ICP preference replaces the profile's size; an older one does not", () => {
  const pref = (updated: string) => item({ fact_key: "icp.company_size", value_type: "number_range", value: { min: 50, max: 200 }, updated_at: updated });
  const newer = foldMemoryIntoProfile(PROFILE, [pref(ago(1))], () => Date.parse(ago(30)), NOW);
  assertEquals((newer.effective.target_customer as Row).company_size, { min: 50, max: 200, label: "50-200" });
  assertEquals(newer.applied[0].effect, "target company size");
  const older = foldMemoryIntoProfile(PROFILE, [pref(ago(60))], () => Date.parse(ago(30)), NOW);
  assertEquals((older.effective.target_customer as Row).company_size, { min: 10, max: 50 }, "the later profile edit wins");
  assertEquals(PROFILE.target_customer.company_size, { min: 10, max: 50 }, "the stored profile is never mutated");
});

Deno.test("fold: approved competitor added; retracted one removed; unapproved suggestion ignored", () => {
  const approved = item({ kind: "fact", category: "competitors", fact_key: "competitor:fleetbot.io", value_type: "object",
    value: { name: "FleetBot", domain: "fleetbot.io" }, created_by_kind: "agent", created_by_agent: "lisa", source_type: "agent_suggestion",
    approval_status: "approved", approved_by: USER, proposal_id: "p1" });
  const retracted = item({ kind: "fact", category: "competitors", fact_key: "competitor:rivalco", value_type: "object",
    value: { name: "Rivalco" }, lifecycle_status: "retracted", updated_at: ago(1) });
  const rogue = item({ kind: "fact", category: "competitors", fact_key: "competitor:evil.test", value_type: "object",
    value: { name: "Evil" }, created_by_kind: "agent", source_type: "agent_suggestion", verification_status: "unverified" });
  const r = foldMemoryIntoProfile(PROFILE, [approved, retracted, rogue], () => Date.parse(ago(30)), NOW);
  assertEquals(r.competitors.map((c) => c.name), ["FleetBot"]);
  assertEquals(r.effective.competitors_v2, ["FleetBot"]);
  assertEquals(r.competitors[0].source, "approved lisa agent suggestion");
});

Deno.test("fold: exclusions are unioned into disqualifiers and content restrictions into brand_voice.avoid", () => {
  const r = foldMemoryIntoProfile(PROFILE, [
    item({ category: "exclusions", fact_key: "exclusion.industry:defense", value_type: "object", value: { type: "industry", value: "Defense" } }),
    item({ category: "content", fact_key: "content.restrictions", value_type: "list", value: ["Never mention pricing"] }),
  ], () => Date.parse(ago(30)), NOW);
  const tc = r.effective.target_customer as Row;
  assertEquals((tc.disqualifiers as Row).industries, ["Defense"]);
  assertEquals(tc.industries, ["Manufacturing"], "the ICP itself is untouched");
  assertEquals((r.effective.brand_voice as Row).avoid, ["hype", "Never mention pricing"]);
});

// ── the loader ───────────────────────────────────────────────────────────────
function world(): Record<string, Table> {
  return {
    workspace_members: [{ workspace_id: A, user_id: USER }],
    company_brain: [brainRow(A, PROFILE), brainRow(B, { schema_version: 2, company: { name: "Tenant B" }, target_customer: { industries: ["Gambling"] } })],
    company_brain_memory: [
      item({ fact_key: "icp.company_size", value_type: "number_range", value: { min: 50, max: 200 } }),
      item({ kind: "decision", category: "lead_rejected", fact_key: "lead_rejected", scope: "lead", scope_ref: "lead-7", value_type: "object", value: { outcome: "rejected" } }),
      item({ kind: "fact", category: "goals", fact_key: "goal.q1", value: "Land two Nordic manufacturers" }),
      item({ kind: "fact", category: "products", fact_key: "product.picker", value: "PickBot 3 shelf-picking robot" }),
      item({ kind: "fact", category: "products", fact_key: "product.old", value: "Discontinued line", lifecycle_status: "disputed" }),
      item({ workspace_id: B, fact_key: "icp.company_size", value_type: "number_range", value: { min: 1, max: 5 } }),
    ],
    company_brain_revisions: [{ workspace_id: A, revision: 1, changed_sections: ["company", "target_customer"], written_at: ago(30), actor_kind: "backfill" }],
    company_brain_memory_proposals: [{ id: "p-1", workspace_id: A, status: "pending" }, { id: "p-2", workspace_id: B, status: "pending" }],
  };
}

Deno.test("loader: refuses a non-member before reading anything else", async () => {
  const db = fakeDb(world());
  const r = await loadCompanyBrainContext(db, A, { userId: "stranger", now: NOW });
  assertEquals(r.ok, false); assertEquals(db.calls, ["workspace_members"]);
  assertEquals((await loadCompanyBrainContext(fakeDb(world()), A, { now: NOW })).ok, false, "no user and no explicit skip → forbidden");
});

Deno.test("loader: one context with the folded ICP, scoped decisions, goals, and nothing from workspace B", async () => {
  const r = await loadCompanyBrainContext(fakeDb(world()), A, { userId: USER, now: NOW });
  assert(r.ok);
  const c = r.context;
  assertEquals(c.status, "incomplete", "a sparse fictional profile: present but not setup-complete");
  assertEquals(c.canonical.target_customer.company_size, { min: 50, max: 200 });
  assertEquals(c.decisions.length, 1); assertEquals(c.decisions[0].scope_ref, "lead-7");
  assertEquals(c.goals.map((g) => g.text), ["Win 10 manufacturing customers this quarter", "Land two Nordic manufacturers"]);
  assertEquals(c.facts.map((f) => f.fact_key).sort(), ["goal.q1", "product.picker"], "the disputed product is not served");
  assertEquals(c.needs_review.map((m) => m.fact_key), ["product.old"]);
  assertEquals(c.pending_proposals, 1);
  const dump = JSON.stringify(c);
  assertFalse(dump.includes("Tenant B")); assertFalse(dump.includes("Gambling"));
  assertFalse((c.canonical.disqualifiers.industries ?? []).some((d) => /gambling/i.test(d)), "B's ICP never leaks into A");
});

Deno.test("loader: no Brain → status missing, empty canonical, setup_required, and the block says so", async () => {
  const r = await loadCompanyBrainContext(fakeDb({ workspace_members: [{ workspace_id: A, user_id: USER }] }), A, { userId: USER, now: NOW });
  assert(r.ok);
  assertEquals(r.context.status, "missing");
  assertEquals(r.context.canonical.setup_required, true);
  assertEquals(r.context.canonical.target_customer.industries, []);
  assertEquals(r.context.competitors, []); assertEquals(r.context.goals, []);
  assertStringIncludes(renderBrainMemoryBlock(r.context, "orion"), "no Company Brain");
  assertEquals(atlasView(r.context, NOW).industries, []);
});

Deno.test("loader: memory tables absent (held migration not applied) → profile alone, warning, no throw", async () => {
  const r = await loadCompanyBrainContext(
    fakeDb(world(), ["company_brain_memory", "company_brain_revisions", "company_brain_memory_proposals"]), A, { skipMembershipCheck: true, now: NOW });
  assert(r.ok);
  assertEquals(r.context.warnings, ["memory_unavailable"]);
  assertEquals(r.context.canonical.target_customer.company_size, { min: 10, max: 50 }, "profile value, unchanged behaviour");
  assertEquals(r.context.preferences, []);
});

Deno.test("loader: a retracted fact disappears from every agent view on the next load", async () => {
  const w = world();
  const before = await loadCompanyBrainContext(fakeDb(w), A, { userId: USER, now: NOW });
  assert(before.ok); assertStringIncludes(renderBrainMemoryBlock(before.context, "lyra"), "PickBot 3");
  (w.company_brain_memory.find((m) => m.fact_key === "product.picker") as Row).lifecycle_status = "retracted";
  (w.company_brain_memory.find((m) => m.fact_key === "product.picker") as Row).updated_at = NOW.toISOString();
  const after = await loadCompanyBrainContext(fakeDb(w), A, { userId: USER, now: NOW });
  assert(after.ok);
  assertFalse(renderBrainMemoryBlock(after.context, "lyra").includes("PickBot 3"));
  assertEquals(lyraView(after.context).products, []);
  assert(before.context.fingerprint !== after.context.fingerprint, "the fingerprint changes, so no cache serves the old context");
});

// ── views ────────────────────────────────────────────────────────────────────
Deno.test("views: each agent gets its slice", async () => {
  const w = world();
  w.company_brain_memory.push(
    item({ category: "exclusions", fact_key: "exclusion.industry:defense", value_type: "object", value: { type: "industry", value: "Defense" } }),
    item({ category: "content", fact_key: "content.tone", value: "warm, plain English" }),
    item({ kind: "decision", category: "signal_dismissed", fact_key: "signal_dismissed", scope: "signal", scope_ref: "sig-3", value_type: "object", value: { outcome: "dismissed" } }),
  );
  const r = await loadCompanyBrainContext(fakeDb(w), A, { userId: USER, now: NOW });
  assert(r.ok);
  const atlas = atlasView(r.context, NOW);
  assertEquals(atlas.contract_version, "atlas-brain-v1");
  assertEquals(atlas.company_size, { min: 50, max: 200 });
  assertEquals(atlas.exclusions.industries, ["Defense"]);
  assertEquals(atlas.rejected_lead_refs, ["lead-7"]);
  const orion = orionView(r.context, NOW);
  assert(orion.dismissed_signal_refs.has("sig-3")); assert(orion.rejected_lead_refs.has("lead-7"));
  const lyra = lyraView(r.context);
  assertEquals(lyra.brand_voice.tone, "warm, plain English");
  assertEquals(lyra.products.map((p) => p.text), ["PickBot 3 shelf-picking robot"]);
  const lisa = lisaView(r.context, ["rivalco.com"], NOW);
  assertEquals(lisa.monitored_accounts, ["rivalco.com"]);
  assertEquals(lisa.dismissed_signal_refs, ["sig-3"]);
  assertEquals(lisa.industries, ["Manufacturing"]);
});

Deno.test("renderer: deterministic, bounded, exclusions survive trimming, decisions say they are scoped", async () => {
  const w = world();
  w.company_brain_memory.push(item({ category: "exclusions", fact_key: "exclusion.industry:defense", value_type: "object", value: { type: "industry", value: "Defense" } }));
  for (let i = 0; i < 40; i++) w.company_brain_memory.push(item({ kind: "fact", category: "products", fact_key: `product.p${i}`, value: `Product number ${i} with a long description` }));
  const r = await loadCompanyBrainContext(fakeDb(w), A, { userId: USER, now: NOW });
  assert(r.ok);
  const a = renderBrainMemoryBlock(r.context, "orion", 900);
  assertEquals(a, renderBrainMemoryBlock(r.context, "orion", 900), "same input, same text");
  assert(a.length <= 900 + 80, `bounded (${a.length})`);
  assertStringIncludes(a, "Never target or recommend");
  assertStringIncludes(a, "omitted to fit");
  const full = renderBrainMemoryBlock(r.context, "atlas", 4000);
  assertStringIncludes(full, "Decision lead_rejected on lead lead-7");
  assertStringIncludes(full, "applies to that lead only");
  assertFalse(full.includes("Product number"), "ATLAS is not handed product copy");
});

Deno.test("the loader's literal memory select is exactly MEMORY_COLUMNS (so the schema sweep checks it)", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyBrainContextLoader.ts", import.meta.url));
  assertStringIncludes(src, `.from("company_brain_memory").select("${MEMORY_COLUMNS}")`);
});
