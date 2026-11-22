// Company Brain V2 · B2.2 — "Where this came from" (src/lib/companyBrain/provenanceView.ts).
// States only what was recorded; never promotes a source to verified. Fictional data.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describeSectionProvenance, memorySection } from "../../src/lib/companyBrain/provenanceView.ts";
import type { MemoryItem } from "../../supabase/functions/_shared/brainMemoryModel.ts";

const RUN = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-11-21T12:00:00Z");
const rev = (over: Record<string, unknown>) => ({
  revision: 2, changed_sections: ["positioning"], actor_kind: "user", actor_id: "me", written_at: "2026-11-20T09:00:00Z", ...over,
});
const runs = [{ id: RUN, source_type: "company_website", status: "completed", created_at: "2026-11-01T10:00:00Z",
  output: { source_pages: ["https://fictional.example/", "https://fictional.example/about"] } }];
const mem = (over: Partial<MemoryItem>): MemoryItem => ({
  id: "m1", workspace_id: "w", kind: "preference", category: "exclusions", fact_key: "exclusion.industry:gambling", scope: "workspace", scope_ref: null,
  value_type: "text", value: "Gambling", version: 1, source_type: "user_provided", source_ref: null, source_url: null,
  verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active", persistence: "persistent", approval_status: "not_required",
  created_by_kind: "user", created_by_agent: null, approved_by: null, proposal_id: null, observed_at: "2026-11-20T00:00:00Z",
  review_at: null, expires_at: null, updated_at: "2026-11-20T00:00:00Z", redacted_at: null, reason: null, ...over,
} as MemoryItem);
const describe = (section: Parameters<typeof describeSectionProvenance>[0]["section"], revisions: unknown[], memory: MemoryItem[] = []) =>
  describeSectionProvenance({ section, revisions: revisions as never, runs, memory, currentUserId: "me", now: NOW });

Deno.test("B2.2 view: research names the run and links the page it read", () => {
  const p = describe("positioning", [rev({ source_kind: "research", source_ref: RUN, reason: "Accepted from your website research" })])!;
  assertEquals([p.headline, p.tone], ["Accepted from website research by you", "trusted"]);
  assertEquals(p.link, { href: "https://fictional.example/", text: "Research of 1 Nov 2026 · 2 pages read" });
  assertStringIncludes(p.trust, "confirmed by a person");
});

Deno.test("B2.2 view: AI drafts ask for review; unrecorded and back-filled revisions say so", () => {
  const ai = describe("positioning", [rev({ source_kind: "ai_inference" })])!;
  assertEquals([ai.headline, ai.tone], ["Drafted by AI", "review"]);
  assertEquals(describe("positioning", [rev({})])!.headline, "Saved before sources were recorded");
  assertEquals(describe("company", [rev({ actor_kind: "backfill", actor_id: null, changed_sections: ["company"] })])!.tone, "muted");
  assertEquals(describe("positioning", [rev({ source_kind: "founder", actor_id: "someone-else" })])!.headline, "Entered by a teammate");
});

Deno.test("B2.2 view: confirmed workspace memory shows on its section; unservable memory never does", () => {
  const p = describe("qualification", [], [mem({}), mem({ id: "m2", lifecycle_status: "disputed" }), mem({ id: "m3", scope: "lead", scope_ref: "x" })])!;
  assertEquals(p.memory.map((m) => m.id), ["m1"]);
  assertEquals(p.headline, "No recorded change to this section yet");
  assertEquals(describe("gtm", []), null);
  const agent = describe("competitors", [], [mem({ id: "c", fact_key: "competitor:rival.example", kind: "fact", value_type: "object", value: { name: "Rival" }, created_by_kind: "agent", created_by_agent: "lisa", approval_status: "approved", approved_by: "me", proposal_id: "p" })])!;
  assertEquals(agent.memory[0], { id: "c", title: "Rival", detail: "suggested by LISA, approved by your team" });
});

Deno.test("B2.2 view: memory keys map to the sections the loader folds them into", () => {
  assertEquals(memorySection({ fact_key: "icp.company_size", category: "icp", kind: "preference" }), "target_customer");
  assertEquals(memorySection({ fact_key: "content.tone", category: "content", kind: "preference" }), "brand_voice");
  assertEquals(memorySection({ fact_key: "goal.win-dental", category: "goals", kind: "preference" }), "goals");
  assert(memorySection({ fact_key: "lead_rejected", category: "lead_rejected", kind: "decision" }) === null);
});
