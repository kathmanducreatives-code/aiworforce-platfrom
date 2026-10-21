// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEvidencePacket,
  reviewCsvSnapshot,
  validateInputs,
} from "../../../supabase/functions/_shared/pilot/pilotEvidencePacket.ts";
import { previewCsv } from "../../../supabase/functions/_shared/pilot/pilotImportContract.ts";
import { AS_OF, inputs, scope } from "../_helpers/pilotSnapshotFixture.ts";
import { B, CB } from "../_helpers/pilotScopeFixture.ts";
Deno.test("P5 CSV preserves original mapped cells, file hash, duplicate row ordinals and Apollo lineage", async () => {
  const i = await inputs(),
    p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  assertEquals(i.csv.source_rows, [2, 3]);
  assertEquals(i.csv.normalized.apollo_account_id, "same-account");
  assertEquals(i.csv.imported_row_id, null);
  assert(!JSON.stringify(p).includes("DO_NOT_COPY_OTHER_CLIENT"));
  const fact = p.facts.find((f) => f.field === "contact_title")!;
  assertEquals(fact.location, {
    csv_rows: [2, 3],
    column: "Title",
    start: null,
    end: null,
  });
  assertEquals(fact.value, "CEO");
  assertEquals(fact.company_key, p.identity.dedupeKey);
  assertEquals(fact.workspace_id, scope.workspace_id);
  assertEquals(fact.task_id, scope.task_id);
  assert(
    p.facts.filter((f) => f.source_id === "csv").every((f) =>
      f.event_at === null
    ),
  );
  assert(p.unknowns.includes("source_updated_time_is_not_event_time:csv"));
});
Deno.test("P5 exact negative quotation stays supplied claim; interpretation cannot promote truth or eligibility", async () => {
  const i = await inputs();
  i.interpretations = [{
    text: "This proves they want new software",
    source_ids: ["website"],
  }];
  const p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example"),
    f = p.facts.find((f) => f.source_id === "website")!;
  assertEquals(f.value, i.sources[0].body.slice(0, 32));
  assert(f.value.includes("not"));
  assertEquals(f.integrity, "exact_field_or_excerpt_match");
  assertEquals(f.semantic_support, "not_evaluated");
  assertEquals(f.status, "plausible");
  assertEquals(p.verified_facts, []);
  assertEquals(p.canonical_decision, null);
  assertEquals(p.qualification_evaluated, false);
  assertEquals(
    p.model_interpretations[0].provenance_class,
    "model_interpretation",
  );
});
Deno.test("P5 old event, scrape time, missing dates and planned future event remain distinct", async () => {
  const i = await inputs();
  i.sources[0].valid_until = "2020-02-01T00:00:00Z";
  let p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  const f = p.facts.find((f) => f.source_id === "website")!;
  assertEquals(f.event_at, "2020-01-01T00:00:00Z");
  assertEquals(f.collected_at, "2026-10-20T00:00:00Z");
  assert(p.unknowns.includes("source_stale:website"));
  i.sources[0].collected_at = null;
  i.sources[0].event_at = null;
  p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  assert(p.unknowns.includes("collection_time_missing:website"));
  assert(p.unknowns.includes("event_time_missing:website"));
  i.sources[0].event_at = "2027-01-01T00:00:00Z";
  p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  assert(p.unknowns.includes("future_event_not_completed:website"));
});
Deno.test("P5 explicit conflicts retained without independent qualification or invented resolution", async () => {
  const i = await inputs();
  i.conflicts = [{
    reason: "Reviewer found conflicting employer statements",
    source_ids: ["csv", "website"],
  }];
  const p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  assert(p.facts.every((f) => f.provenance_class === "conflicting"));
  assertEquals(p.conflicts, i.conflicts);
  assertEquals(p.canonical_decision, null);
});
for (
  const type of [
    "csv-workspace",
    "csv-client",
    "source-workspace",
    "source-client",
    "normalized",
    "cells",
    "mapping",
    "hash",
    "import-id",
    "source-id",
    "missing-source",
    "duplicate-source",
    "extra-status",
    "seller",
    "foreign-employer",
    "apollo-conflict",
    "url-only",
    "future-collection",
  ]
) {
  Deno.test(`P5 rejects contaminated or fabricated evidence: ${type}`, async () => {
    const i = await inputs();
    switch (type) {
      case "csv-workspace":
        i.csv.workspace_id = B;
        break;
      case "csv-client":
        i.csv.client_binding_id = CB;
        break;
      case "source-workspace":
        i.sources[0].workspace_id = B;
        break;
      case "source-client":
        i.sources[0].client_binding_id = CB;
        break;
      case "normalized":
        i.csv.normalized.company_name = "invented";
        break;
      case "cells":
        i.csv.cells.Title = "CFO";
        break;
      case "mapping":
        i.csv.mapping.Title = "workspace_id";
        break;
      case "hash":
        i.csv.normalized_hash = "f".repeat(64);
        break;
      case "import-id":
        Object.assign(i.csv, { imported_row_id: "invented-id" });
        break;
      case "source-id":
        i.sources[0].id = "csv";
        break;
      case "missing-source":
        i.interpretations[0].source_ids = ["another-company-evidence"];
        break;
      case "duplicate-source":
        i.sources.push(structuredClone(i.sources[0]));
        break;
      case "extra-status":
        Object.assign(i.sources[0], {
          status: "proven",
          semantic_support: "supports",
        });
        break;
      case "seller":
        Object.assign(i.sources[0], { role: "seller" });
        break;
      case "foreign-employer":
        i.sources[0].subject.domain = "other-employer.com";
        break;
      case "apollo-conflict":
        i.sources[0].subject.apollo_account_id = "another-account";
        break;
      case "url-only":
        i.sources[0].body = "";
        i.sources[0].quotes = [];
        break;
      case "future-collection":
        i.sources[0].collected_at = "2027-01-01T00:00:00Z";
        break;
    }
    await assertRejects(() =>
      buildEvidencePacket(scope, i, AS_OF, "client-a.example")
    );
  });
}
Deno.test("P5 optional blank field remains unknown; no supplied page needed and no model or research implied", async () => {
  const csv = "Company,Domain,Title\nBuyer Demo,buyer-demo.com,",
    map = {
      Company: "company_name",
      Domain: "company_domain",
      Title: "contact_title",
    } as const;
  const preview = await previewCsv(csv, map), i = await inputs();
  i.csv = await reviewCsvSnapshot(
    scope,
    csv,
    map,
    preview.rows[0].normalized_hash,
    null,
  );
  i.sources = [];
  i.interpretations = [];
  const p = await buildEvidencePacket(scope, i, AS_OF, "client-a.example");
  assert(p.unknowns.includes("csv_field_missing:contact_title"));
  assertEquals(p.facts.length, 2);
});
Deno.test("P5 overlapping external IDs cannot cross scope; serialization and validation are stable", async () => {
  const a = await inputs(),
    bScope = { ...scope, workspace_id: B, client_binding_id: CB },
    b = await inputs(bScope);
  assertEquals(a.csv.normalized, b.csv.normalized);
  assertEquals(
    await validateInputs(JSON.parse(JSON.stringify(a)), scope, AS_OF),
    a,
  );
  await assertRejects(() =>
    buildEvidencePacket(scope, b, AS_OF, "client-a.example")
  );
  const pa = await buildEvidencePacket(scope, a, AS_OF, "client-a.example"),
    pb = await buildEvidencePacket(bScope, b, AS_OF, "client-b.example");
  assert(pa.facts[0].id !== pb.facts[0].id);
  assertEquals(pa.identity, pb.identity);
});
