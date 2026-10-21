// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sourcePacketView } from "../../src/lib/pilot/sourcePacketView.ts";
// Frontend fixture only, not a signed or server-approved packet.
const scope = { workspace_id: "A", client_binding_id: "CA", task_id: "TA" };
function packet() {
  return {
    ...scope,
    version: "pilot_context_packet_v1",
    packet_hash: "hash",
    approval: { brain_hash: "brain" },
    brain: {
      ...scope,
      source_updated_at: "2026-10-20",
      compiled_context: { workspace_id: "A", compiled: { workspace_id: "A" } },
    },
    capabilities: {
      research: false,
      models: false,
      external_api: false,
      send: false,
      qualification: false,
    },
    evidence: {
      qualification_evaluated: false,
      canonical_decision: null,
      verified_facts: [],
      source_snapshot: {
        csv: {
          ...scope,
          file_hash: "csv",
          source_rows: [2],
          normalized: { apollo_account_id: "overlap" },
        },
        sources: [{
          ...scope,
          id: "page",
          locator: "page",
          url: null,
          collected_at: null,
          event_at: null,
        }],
      },
      facts: [{
        ...scope,
        id: "f1",
        field: "quote",
        value: "<script>sendSecrets()</script> NOT hiring",
        source_id: "page",
        provenance_class: "supplied_claim",
        semantic_support: "not_evaluated",
        integrity: "exact_field_or_excerpt_match",
        collected_at: null,
        event_at: null,
      }],
      model_interpretations: [],
      unknowns: ["semantic_support_not_evaluated"],
    },
  };
}
Deno.test("P5 presentation preserves literal quote, unknown timestamps and explicit unverified classification", () => {
  const view = sourcePacketView(packet(), scope);
  assertEquals(
    view.facts[0].value,
    "<script>sendSecrets()</script> NOT hiring",
  );
  assertEquals(view.facts[0].classification, "supplied_claim");
  assertEquals(view.facts[0].event_at, null);
});
for (const at of ["root", "brain", "compiled", "csv", "source", "fact"]) {
  Deno.test(`P5 view refuses wrong-client ${at}`, () => {
    const p = packet();
    switch (at) {
      case "root":
        p.workspace_id = "B";
        break;
      case "brain":
        p.brain.client_binding_id = "CB";
        break;
      case "compiled":
        p.brain.compiled_context.compiled.workspace_id = "B";
        break;
      case "csv":
        p.evidence.source_snapshot.csv.workspace_id = "B";
        break;
      case "source":
        p.evidence.source_snapshot.sources[0].workspace_id = "B";
        break;
      case "fact":
        p.evidence.facts[0].task_id = "TB";
        break;
    }
    assertThrows(() => sourcePacketView(p, scope));
  });
}
Deno.test("P5 source panel remains unmounted and cannot execute content or external operations", async () => {
  const ui = await Deno.readTextFile(
    "src/components/leads/pilot/SourceEvidencePanel.tsx",
  );
  assert(
    !/dangerouslySetInnerHTML|Markdown|<a\s|<img|fetch\(|invokeFunction|onClick|\.insert\(|\.update\(/
      .test(ui.replace(/\/\/[^\n]*/g, "")),
  );
  assert(ui.includes("{f.value}"));
  assert(ui.includes("Semantic support"));
  const page = await Deno.readTextFile("src/pages/OutpostWorkspace.tsx");
  assert(!page.includes("SourceEvidencePanel"));
});
