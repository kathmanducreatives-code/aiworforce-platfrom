// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BriefReviewController,
  type ReviewService,
} from "../../src/lib/pilot/briefReviewController.ts";
import { reviewedBriefCsv } from "../../src/lib/pilot/reviewedBriefCsv.ts";
const H = "a".repeat(64),
  APP = "b".repeat(64),
  scope = { workspace_id: "A", client_binding_id: "CA", task_id: "TA" },
  actor = "actor-A";
function view(approved = false) {
  const fact = {
    ...scope,
    id: "f1",
    field: "company_name",
    value: "<script>do not run</script>",
    provenance_class: "supplied_claim",
    semantic_support: "not_evaluated",
    source_id: "csv",
    source: { url: null },
    location: { column: "Company", csv_rows: [2] },
    collected_at: null,
    event_at: null,
  };
  const content = {
    qualification_decision: null,
    qualification_evaluated: false,
    verified_facts: [],
    grounded_buying_signals: [],
    company_overview: [fact],
    relevant_business_context: [],
    reviewed_client_instructions: [],
    source_snapshots_for_review: [],
    signal_evidence_for_human_review: [],
    talking_points: [],
    discovery_questions: [],
    missing_information: [],
    do_not_claim: [],
  };
  const choice = {
    schema_version: "call_brief_v1",
    company_overview: ["F1"],
    business_context: [],
    signal_evidence: [],
    talking_points: [],
    discovery_questions: [],
    missing_information: [],
  };
  return {
    version: "pilot_review_view_v1",
    ...scope,
    root_draft: {
      ...scope,
      actor_id: actor,
      version: "pilot_call_brief_draft_v1",
      draft_hash: H,
      packet_hash: H,
      review_status: "unreviewed_draft",
      review_required: true,
      dispatch_allowed: false,
      model_receipt: {
        ...scope,
        status: "succeeded",
        finish_reason: "stop",
        actual_model: "gpt-4.1-mini",
        actual_provider: "openai",
      },
      source_lineage: {},
      content,
      choice,
    },
    revision: { hash: H, number: 0, choice, notes: [], content },
    head_hash: approved ? APP : null,
    status: approved ? "approved_for_manual_csv" : "unreviewed",
    approval: approved
      ? {
        event_hash: APP,
        revision_hash: H,
        actor_id: actor,
        at: "2026-10-22T00:00:00Z",
        expires_at: "2026-10-22T01:00:00Z",
      }
      : null,
  };
}
async function exported() {
  const csv = '"classification","value"\r\n"SUPPLIED_UNVERIFIED","company"\r\n',
    bytes = new TextEncoder().encode(csv),
    hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
  return {
    csv,
    manifest: {
      version: "pilot_manual_csv_v1",
      workspace_id: "A",
      client_binding_id: "CA",
      actor_id: actor,
      status: "prepared_for_manual_download",
      dispatch_allowed: false,
      remote_update_performed: false,
      mime_type: "text/csv;charset=utf-8",
      file_hash: hash,
      file_name: `outpost-reviewed-${hash.slice(0, 16)}.csv`,
      byte_length: bytes.length,
      rows: [{ task_id: "TA", revision_hash: H, approval_hash: APP }],
    },
  };
}
const expected = [{ task_id: "TA", revision_hash: H, approval_hash: APP }];
function service(): ReviewService {
  return {
    inspect: () => Promise.resolve(view()),
    review: () => Promise.resolve(view(true)),
    prepare: () => exported(),
  };
}
Deno.test("P7 browser approval changes only after a validated server response", async () => {
  const s = service();
  let release!: (v: unknown) => void;
  s.review = () => new Promise((resolve) => release = resolve);
  const c = new BriefReviewController(scope, s);
  await c.inspect();
  assertThrows(() => c.approve(false));
  const pending = c.approve(true);
  assertEquals(c.view!.status, "unreviewed");
  release(view(true));
  await pending;
  assertEquals(c.view!.status, "approved_for_manual_csv");
});
Deno.test("P7 locally forged approval still invokes server export and cannot bypass refusal", async () => {
  const s = service(), c = new BriefReviewController(scope, s);
  await c.inspect();
  c.view = view(true) as never;
  let attempts = 0;
  s.prepare = () => {
    attempts++;
    return Promise.reject(Error("server has no approval"));
  };
  await assertRejects(() => c.exportCsv());
  assertEquals(attempts, 1);
});
Deno.test("P7 controller retains exact uncertain review operation for explicit retry", async () => {
  const s = service(), requests: unknown[] = [];
  let first = true;
  s.review = (_scope, r) => {
    requests.push(structuredClone(r));
    if (first) {
      first = false;
      return Promise.reject(Error("lost acknowledgement"));
    }
    return Promise.resolve(view(true));
  };
  const c = new BriefReviewController(scope, s);
  await c.inspect();
  await assertRejects(() => c.approve(true));
  assert(c.pending);
  await c.retry();
  assertEquals(requests[0], requests[1]);
  assertEquals(c.pending, null);
});
Deno.test("P7 export retry uses same operation and expected approval, without local CSV generation", async () => {
  const s = service(), requests: unknown[] = [];
  s.inspect = () => Promise.resolve(view(true));
  let first = true;
  s.prepare = (_scope, r) => {
    requests.push(structuredClone(r));
    if (first) {
      first = false;
      return Promise.reject(Error("lost export acknowledgement"));
    }
    return exported();
  };
  const c = new BriefReviewController(scope, s);
  await c.inspect();
  await assertRejects(() => c.exportCsv());
  const out = await c.exportCsv();
  assertEquals(requests[0], requests[1]);
  assert(out.file_name.endsWith(".csv"));
});
Deno.test("P7 disposing a client controller clears view and ignores delayed responses", async () => {
  const s = service();
  let release!: (v: unknown) => void;
  s.inspect = () => new Promise((resolve) => release = resolve);
  const c = new BriefReviewController(scope, s), pending = c.inspect();
  c.dispose();
  release(view());
  await assertRejects(() => pending);
  assertEquals(c.view, null);
  assertEquals(c.pending, null);
});
Deno.test("P7 out-of-order responses cannot overwrite the latest server revision", async () => {
  const s = service(), resolvers: ((v: unknown) => void)[] = [];
  s.inspect = () => new Promise((resolve) => resolvers.push(resolve));
  const c = new BriefReviewController(scope, s),
    old = c.inspect(),
    fresh = c.inspect();
  resolvers[1](view(true));
  await fresh;
  resolvers[0](view());
  await assertRejects(() => old);
  assertEquals(c.view!.status, "approved_for_manual_csv");
});
for (const at of ["root", "draft", "fact", "approval"]) {
  Deno.test(`P7 controller refuses a foreign ${at}`, async () => {
    const s = service();
    s.inspect = () => {
      const v = view(true);
      switch (at) {
        case "root":
          v.workspace_id = "B";
          break;
        case "draft":
          v.root_draft.client_binding_id = "CB";
          break;
        case "fact":
          v.revision.content.company_overview[0].task_id = "TB";
          break;
        case "approval":
          v.approval!.revision_hash = "c".repeat(64);
          break;
      }
      return Promise.resolve(v);
    };
    const c = new BriefReviewController(scope, s);
    await assertRejects(() => c.inspect());
    assertEquals(c.view, null);
  });
}
Deno.test("P7 valid server CSV verifies exact bytes and version pins", async () => {
  const data = await exported(),
    out = await reviewedBriefCsv(data, { ...scope, actor_id: actor }, expected);
  assertEquals(new TextDecoder().decode(out.bytes), data.csv);
});
for (
  const attack of [
    "workspace",
    "actor",
    "task",
    "revision",
    "approval",
    "bytes",
    "size",
    "file-name",
    "sent",
    "duplicate",
  ]
) {
  Deno.test(`P7 refuses malformed/stale export response ${attack}`, async () => {
    const data = await exported();
    switch (attack) {
      case "workspace":
        data.manifest.workspace_id = "B";
        break;
      case "actor":
        data.manifest.actor_id = "other-actor";
        break;
      case "task":
        data.manifest.rows[0].task_id = "TB";
        break;
      case "revision":
        data.manifest.rows[0].revision_hash = "c".repeat(64);
        break;
      case "approval":
        data.manifest.rows[0].approval_hash = "c".repeat(64);
        break;
      case "bytes":
        data.csv += "tampered";
        break;
      case "size":
        data.manifest.byte_length++;
        break;
      case "file-name":
        data.manifest.file_name = "../../secret.csv";
        break;
      case "sent":
        data.manifest.remote_update_performed = true;
        break;
      case "duplicate":
        data.manifest.rows.push(data.manifest.rows[0]);
        break;
    }
    await assertRejects(() =>
      reviewedBriefCsv(data, { ...scope, actor_id: actor }, expected)
    );
  });
}
Deno.test("P7 UI is keyed by task/client controller, unmounted, disabled by default and has no external send path", async () => {
  const ui = await Deno.readTextFile(
      "src/components/leads/pilot/BriefReviewPanel.tsx",
    ),
    page = await Deno.readTextFile("src/pages/OutpostWorkspace.tsx");
  assert(ui.includes('mode = "disabled"'));
  assert(ui.includes("key={props.controller.instance_id}"));
  assert(ui.includes("controller.dispose()"));
  assert(ui.includes("controller.approve(ack)"));
  assert(ui.includes("controller.exportCsv()"));
  assert(ui.includes("URL.createObjectURL"));
  assert(!/fetch\(|invokeFunction|dangerouslySetInnerHTML|mailto:/.test(ui));
  assert(!page.includes("BriefReviewPanel"));
});
