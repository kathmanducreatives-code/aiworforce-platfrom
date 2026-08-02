import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  estimateAction,
  estimatePostLeadActions,
  rankCredits,
  buildPostLeadActionsCard,
  DEFAULT_CREDIT_COSTS,
} from "../../../supabase/functions/_shared/creditEstimate.ts";

Deno.test("#2 5 leads, 5 websites: enrich=5, draft=10, enrich+draft=15", () => {
  assertEquals(estimateAction("enrich", 5, 5).credits, 5);
  assertEquals(estimateAction("draft_outreach", 5, 5).credits, 10);
  assertEquals(estimateAction("enrich_and_draft", 5, 5).credits, 15);
});

Deno.test("#3 5 leads, 2 websites: enrich=2, draft=10, enrich+draft=12 + partial note", () => {
  assertEquals(estimateAction("enrich", 5, 2).credits, 2);
  assertEquals(estimateAction("draft_outreach", 5, 2).credits, 10);
  const ed = estimateAction("enrich_and_draft", 5, 2);
  assertEquals(ed.credits, 12);
  assert(/Only 2 of 5/.test(ed.note ?? ""), "should note partial enrichment");
});

Deno.test("#4 rank cost rounds up by 10-lead blocks", () => {
  assertEquals(rankCredits(10), 1);
  assertEquals(rankCredits(11), 2);
  assertEquals(estimateAction("rank", 25, 0).credits, 3);
  assertEquals(rankCredits(0), 0);
});

Deno.test("#5 save_only + export are free with no tool runs", () => {
  const save = estimateAction("save_only", 5, 5);
  assertEquals(save.credits, 0);
  assert(/no tool/i.test(save.note ?? ""));
  assertEquals(estimateAction("export", 5, 5).credits, 0);
});

Deno.test("enrichable clamped to lead_count; never negative", () => {
  assertEquals(estimateAction("enrich", 5, 99).credits, 5); // clamp to lead_count
  assertEquals(estimateAction("enrich", 0, 0).credits, 0);
  assertEquals(estimateAction("draft_outreach", 10, 0).credits, 20);
});

Deno.test("configurable costs override defaults", () => {
  const cfg = { ...DEFAULT_CREDIT_COSTS, claude_outreach_draft_per_lead: 3, firecrawl_enrichment_per_website: 2 };
  assertEquals(estimateAction("draft_outreach", 5, 5, cfg).credits, 15);
  assertEquals(estimateAction("enrich", 5, 5, cfg).credits, 10);
});

Deno.test("#1/#9 card: 6 options, paid actions require confirm, free ones don't", () => {
  const card = buildPostLeadActionsCard(5, 3, ["a", "b", "c", "d", "e"]);
  assertEquals(card.kind, "post_lead_actions");
  assertEquals(card.lead_count, 5);
  assertEquals(card.enrichable_count, 3);
  assertEquals(card.options.length, 6);
  const byAction = Object.fromEntries(card.options.map((o) => [o.action, o]));
  assertEquals(byAction.save_only.requires_confirm, false);
  assertEquals(byAction.export.requires_confirm, false);
  assert(byAction.enrich.requires_confirm);
  assert(byAction.draft_outreach.requires_confirm);
  assertEquals(byAction.enrich.credits, 3);          // 3 websites
  assertEquals(byAction.draft_outreach.credits, 10); // 5 × 2
  assertEquals(byAction.enrich_and_draft.credits, 13); // 3 + 10
  // safety note on drafting actions
  assert(/sent/i.test(byAction.draft_outreach.safety_note ?? ""));
  // commands reuse the memory follow-up phrases
  assert(/draft outreach to the top 5/i.test(byAction.draft_outreach.command));
  assert(/enrich the top 5/i.test(byAction.enrich.command));
});

Deno.test("estimatePostLeadActions returns all six in canonical order", () => {
  const all = estimatePostLeadActions(5, 5).map((e) => e.action);
  assertEquals(all, ["save_only", "rank", "enrich", "draft_outreach", "enrich_and_draft", "export"]);
});
