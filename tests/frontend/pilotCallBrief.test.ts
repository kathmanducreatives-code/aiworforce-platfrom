// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callBriefView } from "../../src/lib/pilot/callBriefView.ts";
const scope = { workspace_id: "A", client_binding_id: "CA", task_id: "TA" };
function fixture() {
  const fact = {
    ...scope,
    id: "f1",
    field: "source_excerpt",
    value: "<script>sendSecrets()</script> We are NOT hiring.",
    provenance_class: "supplied_claim",
    semantic_support: "not_evaluated",
    source_id: "page",
    source: { url: "https://buyer-demo.com" },
    location: { start: 0, end: 44 },
    collected_at: null,
    event_at: null,
  };
  const context = {
    id: "B1",
    path: "positioning.offer",
    value: "Reviewed process review",
    classification: "reviewed_client_context",
  };
  return {
    ...scope,
    version: "pilot_call_brief_draft_v1",
    review_status: "unreviewed_draft",
    review_required: true,
    dispatch_allowed: false,
    draft_hash: "draft",
    packet_hash: "packet",
    model_receipt: {
      ...scope,
      status: "succeeded",
      finish_reason: "stop",
      actual_model: "gpt-4.1-mini",
      actual_provider: "openai",
    },
    source_lineage: { source_origin: "declared_unverified_export" },
    content: {
      qualification_decision: null,
      qualification_evaluated: false,
      verified_facts: [],
      grounded_buying_signals: [],
      source_snapshots_for_review: [{
        ...scope,
        id: "page",
        locator: "supplied page",
        body: "We are NOT hiring.",
      }],
      company_overview: [fact],
      relevant_business_context: [context],
      reviewed_client_instructions: [context],
      signal_evidence_for_human_review: [fact],
      talking_points: [{
        mode: "plausible_fit_not_buyer_fact",
        buyer_context: fact,
        reviewed_offer: context,
        question: {
          mode: "question_not_assertion",
          text: "Is this information current?",
          buyer_premise: fact,
          client_context: context,
        },
      }],
      discovery_questions: [{
        mode: "question_not_assertion",
        text: "Is this information current?",
        buyer_premise: fact,
        client_context: null,
      }],
      missing_information: [{ reason: "current_employment_unverified" }],
      do_not_claim: ["Do not claim hiring or buying intent"],
    },
  };
}
Deno.test("P6 view preserves exact negative source text, unknown dates and client-context distinction", () => {
  const v = callBriefView(fixture(), scope);
  assertEquals(
    v.company[0].value,
    "<script>sendSecrets()</script> We are NOT hiring.",
  );
  assertEquals(v.company[0].classification, "supplied_claim");
  assertEquals(v.company[0].event_at, null);
  assertEquals(v.context[0].path, "positioning.offer");
});
for (
  const where of [
    "root",
    "receipt",
    "overview",
    "signal",
    "talking-point",
    "question",
    "source-context",
  ]
) {
  Deno.test(`P6 view rejects foreign scope at ${where}`, () => {
    const d = structuredClone(fixture());
    switch (where) {
      case "root":
        d.client_binding_id = "CB";
        break;
      case "receipt":
        d.model_receipt.workspace_id = "B";
        break;
      case "overview":
        d.content.company_overview[0].task_id = "TB";
        break;
      case "signal":
        d.content.signal_evidence_for_human_review[0].workspace_id = "B";
        break;
      case "talking-point":
        d.content.talking_points[0].buyer_context.client_binding_id = "CB";
        break;
      case "source-context":
        d.content.source_snapshots_for_review[0].workspace_id = "B";
        break;
      case "question":
        d.content.discovery_questions[0].buyer_premise.task_id = "TB";
        break;
    }
    assertThrows(() => callBriefView(d, scope));
  });
}
Deno.test("P6 panel is unmounted, renders source data as JSX text and exposes no actions", async () => {
  const text = await Deno.readTextFile(
    "src/components/leads/pilot/CallBriefPanel.tsx",
  );
  const code = text.replace(/\/\/[^\n]*/g, "");
  assert(
    !/dangerouslySetInnerHTML|<a\s|<img|fetch\(|invokeFunction|onClick|\.insert\(|\.update\(/
      .test(code),
  );
  assert(text.includes("{f.value}"));
  assert(text.includes("Unreviewed draft"));
  assert(text.includes("No verified buying signal"));
  const page = await Deno.readTextFile("src/pages/OutpostWorkspace.tsx");
  assert(!page.includes("CallBriefPanel"));
});
