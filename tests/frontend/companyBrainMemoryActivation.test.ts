// Company Brain V2 · B2.3 — the memory page's new forms and proposal edits (pure view model).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  agentsUsing, buildCorrectionPayload, buildDecisionPayload, buildAddPayload, correctedProposalValue, editableProposalText, formatValue, toCard,
} from "../../src/lib/companyBrain/memoryView.ts";
import type { MemoryItem } from "../../supabase/functions/_shared/brainMemoryModel.ts";

Deno.test("B2.3: a business decision, a fact and a correction build the payloads the server expects", () => {
  assertEquals(buildDecisionPayload("Focus on dental clinics in Portugal", "strategy_selected", "Board meeting"), {
    ok: true, payload: { category: "strategy_selected", fact_key: "decision.focus-on-dental-clinics-in-portugal", value: { outcome: "Focus on dental clinics in Portugal" }, reason: "Board meeting" },
  });
  assertEquals(buildDecisionPayload("  ", "strategy_selected").ok, false);
  assertEquals(buildAddPayload("fact", "We have 12 employees"), {
    ok: true, payload: { kind: "fact", category: "company_facts", fact_key: "fact.we-have-12-employees", value_type: "text", value: "We have 12 employees" },
  });
  assertEquals(buildCorrectionPayload("We sell to enterprises", "We sell to clinics with 5-50 staff"), {
    ok: true, payload: { kind: "fact", category: "corrections", fact_key: "correction.we-sell-to-enterprises", value_type: "object",
      value: { wrong: "We sell to enterprises", right: "We sell to clinics with 5-50 staff" }, reason: "Replaces: We sell to enterprises" },
  });
  assertEquals(buildCorrectionPayload("same", "Same").ok, false);
  assertEquals(formatValue("object", { wrong: "A", right: "B" }), "B — replaces “A”");
});

Deno.test("B2.3: editing a proposal keeps its shape (decision outcome, exclusion value, competitor name, range)", () => {
  assertEquals(correctedProposalValue({ value_type: "object", value: { outcome: "Focus on dentists" } }, "Focus on dental clinics"), { ok: true, value: { outcome: "Focus on dental clinics" } });
  assertEquals(correctedProposalValue({ value_type: "object", value: { type: "industry", value: "Gambling" } }, "Online gambling"), { ok: true, value: { type: "industry", value: "Online gambling" } });
  assertEquals(correctedProposalValue({ value_type: "object", value: { name: "Rival", domain: "rival.example" } }, "Rival Inc"), { ok: true, value: { name: "Rival Inc", domain: "rival.example" } });
  assertEquals(correctedProposalValue({ value_type: "number_range", value: { min: 10, max: 50 } }, "20-80"), { ok: true, value: { min: 20, max: 80 } });
  assertEquals(correctedProposalValue({ value_type: "number_range", value: { min: 10, max: 50 } }, "eighty").ok, false);
  assertEquals(correctedProposalValue({ value_type: "list", value: ["Never mention pricing"] }, "Never mention pricing, Never mention discounts"), { ok: true, value: ["Never mention pricing", "Never mention discounts"] });
  assertEquals(editableProposalText({ value_type: "object", value: { outcome: "Focus on dentists" } }), "Focus on dentists");
  assertEquals(editableProposalText({ value_type: "number_range", value: { min: 10, max: 50 } }), "10-50");
});

Deno.test("B2.3: each card says how fresh it is and which agents use it", () => {
  const base = {
    id: "m", workspace_id: "w", scope: "workspace", scope_ref: null, version: 1, source_type: "user_provided", source_ref: null, source_url: null,
    verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active", persistence: "persistent", approval_status: "not_required",
    created_by_kind: "user", created_by_agent: null, approved_by: null, proposal_id: null, observed_at: "2026-11-20T00:00:00Z",
    review_at: null, expires_at: null, updated_at: "2026-11-20T00:00:00Z", redacted_at: null, reason: null,
  };
  const ex = toCard({ ...base, kind: "preference", category: "exclusions", fact_key: "exclusion.industry:gambling", value_type: "object", value: { type: "industry", value: "Gambling" } } as MemoryItem, new Date("2026-11-21T00:00:00Z"));
  assertEquals([ex.freshness, ex.usedBy], ["Confirmed 20 Nov 2026", ["ORION", "ATLAS", "LYRA", "LISA"]]);
  const tone = toCard({ ...base, kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "plain", persistence: "temporary", expires_at: "2026-12-01T00:00:00Z" } as MemoryItem, new Date("2026-11-21T00:00:00Z"));
  assertEquals([tone.freshness, tone.usedBy], ["Temporary · until 1 Dec 2026", ["LYRA"]]);
  const disputed = toCard({ ...base, kind: "fact", category: "company_facts", fact_key: "fact.x", value_type: "text", value: "x", lifecycle_status: "disputed" } as MemoryItem);
  assertEquals(disputed.usedBy, [], "unservable knowledge is used by nobody");
  assertEquals(agentsUsing({ kind: "decision", category: "strategy_selected", fact_key: "decision.x", scope: "workspace" }), ["ORION"]);
  assertEquals(agentsUsing({ kind: "decision", category: "lead_rejected", fact_key: "lead_rejected", scope: "lead" }), ["ORION", "ATLAS"]);
});
