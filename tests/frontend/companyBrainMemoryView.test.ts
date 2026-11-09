// Company Brain memory page — the pure view model (src/lib/companyBrain/memoryView.ts).
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildAddPayload, buildEditPayload, buildSections, buildTimeline, formatValue, proposalSummary, toCard,
} from "../../src/lib/companyBrain/memoryView.ts";
import type { MemoryItem } from "../../supabase/functions/_shared/brainMemoryModel.ts";
import type { MemorySnapshot } from "../../src/lib/companyBrain/memoryApi.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let n = 0;
const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: `m${++n}`, workspace_id: "w", kind: "preference", category: "icp", fact_key: "icp.company_size", scope: "workspace", scope_ref: null,
  value_type: "number_range", value: { min: 50, max: 200 }, version: 2, source_type: "user_provided", source_ref: null, source_url: null,
  verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active", persistence: "persistent", approval_status: "not_required",
  created_by_kind: "user", created_by_agent: null, observed_at: ago(1), review_at: null, expires_at: null, updated_at: ago(1), redacted_at: null, ...over,
});

Deno.test("values read like a person wrote them", () => {
  assertEquals(formatValue("number_range", { min: 50, max: 200 }), "50–200 employees");
  assertEquals(formatValue("object", { type: "industry", value: "Gambling" }), "Gambling");
  assertEquals(formatValue("object", { name: "FleetBot", domain: "fleetbot.io" }), "FleetBot (fleetbot.io)");
  assertEquals(formatValue("object", { outcome: "rejected", subject: { label: "Acme" }, note: "not B2B" }), "Rejected — Acme (“not B2B”)");
  assertEquals(formatValue("redacted", null), "[redacted]");
});

Deno.test("cards: titles, provenance, scope and state", () => {
  const c = toCard(item(), NOW);
  assertEquals(c.title, "Target company size"); assertEquals(c.provenance, "You entered this"); assert(c.actionable);
  const d = toCard(item({ kind: "decision", category: "lead_rejected", fact_key: "lead_rejected", scope: "lead", scope_ref: "l1", value_type: "object", value: { outcome: "rejected" } }), NOW);
  assertEquals(d.title, "Lead rejected"); assertEquals(d.scopeLabel, "Applies to this lead only");
  const stale = toCard(item({ category: "competitors", fact_key: "competitor:x.io", kind: "fact", value_type: "object", value: { name: "X" }, observed_at: ago(400) }), NOW);
  assertEquals(stale.status, "stale"); assertStringIncludes(stale.statusLabel!, "Needs review");
  const gone = toCard(item({ lifecycle_status: "retracted" }), NOW);
  assertFalse(gone.actionable); assertEquals(gone.statusLabel, "Retracted");
  assertEquals(toCard(item({ fact_key: "exclusion.industry:gambling", category: "exclusions", value_type: "object", value: { type: "industry", value: "Gambling" } }), NOW).title, "Exclude industry");
});

const snapshot = (): MemorySnapshot => ({
  items: [
    item({ id: "pref" }),
    item({ id: "dec", kind: "decision", category: "signal_dismissed", fact_key: "signal_dismissed", scope: "signal", scope_ref: "s1", value_type: "object", value: { outcome: "dismissed" } }),
    item({ id: "fact", kind: "fact", category: "products", fact_key: "product.pickbot", value_type: "text", value: "PickBot 3" }),
    item({ id: "old", kind: "fact", category: "products", fact_key: "product.old", value_type: "text", value: "Old line", lifecycle_status: "retracted" }),
    item({ id: "doubt", kind: "fact", category: "company", fact_key: "company.hq", value_type: "text", value: "Oslo", lifecycle_status: "disputed" }),
  ],
  proposals: [
    { id: "p1", proposed_by_agent: "lisa", kind: "fact", category: "competitors", fact_key: "competitor:fleetbot.io", value_type: "object",
      value: { name: "FleetBot", domain: "fleetbot.io" }, rationale: "monitored", evidence: [{ source_ref: "monitoring_subject:fleetbot.io" }],
      source_type: "agent_suggestion", confidence: "medium", status: "pending", contradicts_memory_id: null, created_at: ago(1), updated_at: ago(1) },
    { id: "p2", proposed_by_agent: "lyra", kind: "preference", category: "content", fact_key: "content.proven_angle:x", value_type: "text",
      value: "x", rationale: "r", evidence: [], source_type: "agent_suggestion", confidence: "low", status: "rejected", contradicts_memory_id: null, created_at: ago(2), updated_at: ago(2) },
  ],
  history: [
    { id: "h1", memory_id: "pref", proposal_id: null, change_kind: "updated", from_version: 1, to_version: 2,
      previous: { value_type: "number_range", value: { min: 10, max: 50 } }, current: { value_type: "number_range", value: { min: 50, max: 200 } },
      actor_kind: "user", actor_id: "me", actor_agent: null, reason: "moving upmarket", created_at: ago(1) },
    { id: "h2", memory_id: null, proposal_id: "p2", change_kind: "proposal_rejected", from_version: null, to_version: null,
      previous: { value: "x" }, current: null, actor_kind: "user", actor_id: "other", actor_agent: null, reason: null, created_at: ago(2) },
  ],
  revisions: [
    { id: "r2", revision: 2, changed_sections: ["target_customer"], actor_kind: "user", actor_id: "other", written_at: ago(3), redacted_at: null },
    { id: "r1", revision: 1, changed_sections: ["company"], actor_kind: "backfill", actor_id: null, written_at: ago(30), redacted_at: null },
  ],
});

Deno.test("sections: what needs review, what agents use, what is history", () => {
  const s = buildSections(snapshot(), NOW);
  assertEquals(s.pendingProposals.map((p) => p.id), ["p1"], "a rejected proposal is not pending");
  assertEquals(s.needsReview.map((c) => c.id), ["doubt"]);
  assertEquals(s.preferences.map((c) => c.id), ["pref"]);
  assertEquals(s.decisions.map((c) => c.id), ["dec"]);
  assertEquals(s.facts.map((c) => c.id), ["fact"]);
  assertEquals(s.archived.map((c) => c.id), ["old"]);
  assertEquals(s.servedCount, 3, "pref + decision + fact; never the retracted or disputed one");
});

Deno.test("proposals are labelled as untrusted suggestions", () => {
  const p = proposalSummary(snapshot().proposals[0]);
  assertEquals(p.title, "Competitor"); assertEquals(p.value, "FleetBot (fleetbot.io)");
  assertStringIncludes(p.provenance, "Lisa"); assertStringIncludes(p.provenance, "not yet trusted");
});

Deno.test("timeline: before → after, who, why, and profile edits", () => {
  const t = buildTimeline(snapshot(), "me");
  assertEquals(t[0].who, "You");
  assertEquals(t[0].text, "changed Target company size");
  assertEquals(t[0].detail, "10–50 employees → 50–200 employees — moving upmarket");
  assert(t.some((e) => e.text.startsWith("rejected a suggestion") && e.who === "A teammate"));
  assert(t.some((e) => e.text === "edited the profile: target customer"));
  assertEquals(t.at(-1)!.text, "history starts here (existing profile saved)");
});

Deno.test("add forms build exactly the payload the server expects", () => {
  const ex = buildAddPayload("exclude_company", "https://www.Rivalco.com");
  assert(ex.ok); assertEquals(ex.payload.fact_key, "exclusion.company:rivalco.com"); assertEquals(ex.payload.value, { type: "company", value: "rivalco.com" });
  assertFalse(buildAddPayload("exclude_company", "Rivalco").ok, "a company needs a domain");
  const size = buildAddPayload("company_size", "50 - 200");
  assert(size.ok); assertEquals(size.payload.value, { min: 50, max: 200 });
  assertFalse(buildAddPayload("company_size", "200-50").ok);
  assertFalse(buildAddPayload("company_size", "big").ok);
  const tmp = buildAddPayload("sales_priority", "Nordic manufacturers", { temporaryUntil: "2027-03-31T23:59:59.000Z" });
  assert(tmp.ok); assertEquals(tmp.payload.persistence, "temporary"); assertEquals(tmp.payload.expires_at, "2027-03-31T23:59:59.000Z");
  const r1 = buildAddPayload("content_restriction", "Never mention pricing");
  const r2 = buildAddPayload("content_restriction", "No competitor names");
  assert(r1.ok && r2.ok); assert(r1.payload.fact_key !== r2.payload.fact_key, "two restrictions do not collide");
  assertFalse(buildAddPayload("goal", "   ").ok);
  for (const k of ["exclude_industry", "exclude_geography", "exclude_keyword", "content_tone", "goal", "product"] as const) {
    const r = buildAddPayload(k, "Something");
    assert(r.ok, k);
    assertFalse("verification_status" in r.payload || "source_type" in r.payload, "provenance is the server's to set");
  }
});

Deno.test("edit forms carry the version they were made against", () => {
  const c = toCard(item({ version: 4 }), NOW);
  const e = buildEditPayload(c, "100-500");
  assert(e.ok); assertEquals(e.payload.expected_version, 4); assertEquals(e.payload.value, { min: 100, max: 500 });
  assertFalse(buildEditPayload(c, "lots").ok);
  const t = buildEditPayload(toCard(item({ kind: "fact", category: "company", fact_key: "company.hq", value_type: "text", value: "Oslo" }), NOW), "Bergen");
  assert(t.ok); assertEquals(t.payload.value, "Bergen");
});
