// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  csvCell,
  prepareReviewCsv,
  REVIEW_CSV_HEADERS,
} from "../../../supabase/functions/_shared/pilot/pilotExport.ts";
import { reviewBrief } from "../../../supabase/functions/_shared/pilot/pilotReview.ts";
import { reviewFixture } from "../_helpers/pilotReviewFixture.ts";
import { CB, DEST_B, id, noPaid, task } from "../_helpers/pilotScopeFixture.ts";
Deno.test("P7 approved export is a CSV preparation with all uncertainty and provenance preserved", async () => {
  const x = await reviewFixture();
  await x.approve();
  const out = await x.exportOne();
  assertEquals(out.manifest.status, "prepared_for_manual_download");
  assertEquals(out.manifest.dispatch_allowed, false);
  assertEquals(out.manifest.remote_update_performed, false);
  assertEquals(out.manifest.rows[0].packet_hash, x.packet.packet_hash);
  assert(out.csv.includes("SUPPLIED_UNVERIFIED"));
  assert(out.csv.includes("not looking"));
  assert(out.csv.includes("semantic_support"));
  assert(out.csv.includes("not_evaluated"));
  assert(out.csv.includes("do_not_claim_json"));
  assert(out.csv.includes(x.draft.model_receipt.attempt_id));
  assertEquals(
    out.manifest.byte_length,
    new TextEncoder().encode(out.csv).length,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(out.csv),
  );
  assertEquals(
    out.manifest.file_hash,
    [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0"))
      .join(""),
  );
  assert(out.csv.endsWith("\r\n"));
  assertEquals(x.events.commits, 2);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 unreviewed drafts cannot export even if caller supplies an approval-shaped value", async () => {
  const x = await reviewFixture();
  await assertRejects(() => x.exportOne());
  assertEquals(x.events.commits, 0);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 human notes remain explicitly unverified after edit, approval and export", async () => {
  const x = await reviewFixture(), s = await x.inspect();
  await reviewBrief(x.scope, {
    action: "edit",
    operation_id: x.operation(),
    expected_head: s.head_hash,
    expected_revision: s.revision.hash,
    choice: s.revision.choice,
    notes: [{
      text: "Human supplied: investigate potential funding; not verified.",
      fact_ids: [],
      classification: "human_supplied_unverified",
    }],
  }, x.reviewDeps);
  await x.approve();
  const out = await x.exportOne();
  assert(out.csv.includes("human_notes_unverified_json"));
  assert(out.csv.includes("human_supplied_unverified"));
  assert(out.csv.includes("not verified"));
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 repeated export and lost acknowledgement return identical bytes without duplicate events", async () => {
  const x = await reviewFixture();
  await x.approve();
  const s = await x.inspect(),
    r = {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: s.head_hash,
        revision_hash: s.revision.hash,
        approval_hash: s.approval!.event_hash,
      }],
    };
  x.events.failAfter = true;
  await assertRejects(() =>
    prepareReviewCsv(
      {
        workspace_id: x.scope.workspace_id,
        client_binding_id: x.scope.client_binding_id,
      },
      r,
      x.reviewDeps,
    )
  );
  x.events.failAfter = false;
  const one = await prepareReviewCsv(
      {
        workspace_id: x.scope.workspace_id,
        client_binding_id: x.scope.client_binding_id,
      },
      r,
      x.reviewDeps,
    ),
    two = await prepareReviewCsv(
      {
        workspace_id: x.scope.workspace_id,
        client_binding_id: x.scope.client_binding_id,
      },
      r,
      x.reviewDeps,
    );
  assertEquals(one, two);
  assertEquals(x.events.commits, 2);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 stale approvals reject export after any edit, including an edit restoring original choices", async () => {
  const x = await reviewFixture();
  await x.approve();
  const old = await x.inspect(),
    request = {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: old.head_hash,
        revision_hash: old.revision.hash,
        approval_hash: old.approval!.event_hash,
      }],
    };
  const { workspace_id, client_binding_id } = x.scope;
  await prepareReviewCsv(
    { workspace_id, client_binding_id },
    request,
    x.reviewDeps,
  );
  const current = await x.inspect();
  await reviewBrief(x.scope, {
    action: "edit",
    operation_id: x.operation(),
    expected_head: current.head_hash,
    expected_revision: current.revision.hash,
    choice: current.revision.choice,
    notes: [],
  }, x.reviewDeps);
  await assertRejects(() =>
    prepareReviewCsv({ workspace_id, client_binding_id }, request, x.reviewDeps)
  );
  x.assertNoExecution();
  noPaid(x.f.n);
});
for (
  const attack of [
    "mixed-client",
    "foreign-task",
    "duplicate-task",
    "local-approved",
    "remote-url",
    "foreign-destination",
    "disabled",
    "too-many",
    "wrong-hash",
  ]
) {
  Deno.test(`P7 export rejects ${attack} atomically`, async () => {
    const x = await reviewFixture();
    await x.approve();
    const s = await x.inspect(),
      root = {
        workspace_id: x.scope.workspace_id,
        client_binding_id: x.scope.client_binding_id,
      },
      r: Record<string, unknown> = {
        operation_id: x.operation(),
        items: [{
          task_id: x.scope.task_id,
          expected_head: s.head_hash,
          revision_hash: s.revision.hash,
          approval_hash: s.approval!.event_hash,
        }],
      };
    switch (attack) {
      case "mixed-client":
        Object.assign((r.items as object[])[0], { client_binding_id: CB });
        break;
      case "foreign-task":
        (r.items as { task_id: string }[])[0].task_id = id(302);
        break;
      case "duplicate-task":
        (r.items as object[]).push((r.items as object[])[0]);
        break;
      case "local-approved":
        r.approved = true;
        break;
      case "remote-url":
        r.destination_url = "https://attacker.invalid";
        break;
      case "foreign-destination":
        x.reviewPolicy.destination_id = DEST_B;
        break;
      case "disabled":
        x.reviewPolicy.export_enabled = false;
        break;
      case "too-many":
        r.items = Array.from(
          { length: 6 },
          (_, i) => ({
            task_id: id(900 + i),
            expected_head: null,
            revision_hash: "a".repeat(64),
            approval_hash: "b".repeat(64),
          }),
        );
        break;
      case "wrong-hash":
        (r.items as { approval_hash: string }[])[0].approval_hash = "b".repeat(
          64,
        );
        break;
    }
    await assertRejects(() => prepareReviewCsv(root, r as never, x.reviewDeps));
    assertEquals(x.events.commits, 1);
    x.assertNoExecution();
    noPaid(x.f.n);
  });
}
Deno.test("P7 same-client batch of two approved signed tasks exports once with no model call", async () => {
  const x = await reviewFixture(), second = await x.addTask();
  await x.approve();
  await x.approve(second);
  const a = await x.inspect(),
    b = await x.inspect(second),
    before = x.calls.length;
  const out = await prepareReviewCsv({
    workspace_id: x.scope.workspace_id,
    client_binding_id: x.scope.client_binding_id,
  }, {
    operation_id: x.operation(),
    items: [{
      task_id: x.scope.task_id,
      expected_head: a.head_hash,
      revision_hash: a.revision.hash,
      approval_hash: a.approval!.event_hash,
    }, {
      task_id: second.task_id,
      expected_head: b.head_hash,
      revision_hash: b.revision.hash,
      approval_hash: b.approval!.event_hash,
    }],
  }, x.reviewDeps);
  assertEquals(out.manifest.rows.length, 2);
  assertEquals(x.calls.length, before);
  assertEquals(x.accounting.runtimeAttempts, 2);
  assertEquals(x.events.commits, 3);
  noPaid(x.f.n);
});
Deno.test("P7 one unapproved batch member prevents every export event", async () => {
  const x = await reviewFixture(), second = await x.addTask();
  await x.approve();
  const a = await x.inspect(), b = await x.inspect(second);
  await assertRejects(() =>
    prepareReviewCsv({
      workspace_id: x.scope.workspace_id,
      client_binding_id: x.scope.client_binding_id,
    }, {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: a.head_hash,
        revision_hash: a.revision.hash,
        approval_hash: a.approval!.event_hash,
      }, {
        task_id: second.task_id,
        expected_head: b.head_hash,
        revision_hash: b.revision.hash,
        approval_hash: "f".repeat(64),
      }],
    }, x.reviewDeps)
  );
  assertEquals(x.events.commits, 1);
  assertEquals(x.calls.length, 2);
  noPaid(x.f.n);
});
Deno.test("P7 output withheld when cancellation occurs during atomic export commit", async () => {
  const x = await reviewFixture();
  await x.approve();
  x.events.beforeCommit = () => {
    task(x.f, x.scope.task_id).status = "cancelled";
  };
  await assertRejects(() => x.exportOne());
  assertEquals(x.events.commits, 1);
  x.assertNoExecution();
  noPaid(x.f.n);
});
for (
  const value of [
    "=SUM(1,2)",
    "+1",
    "-1",
    "@SUM(A1)",
    " \t=cmd()",
    "\r\n+cmd()",
    "\u200b=cmd()",
    "＝SUM(1,2)",
    "＋42",
    "＠cmd",
  ]
) {
  Deno.test(`P7 formula cells become explicit text ${JSON.stringify(value)}`, () => {
    const cell = csvCell(value);
    assertEquals(cell.escaped, true);
    assert(cell.encoded.startsWith("\"'"));
  });
}
Deno.test("P7 CSV quoting preserves commas, embedded quotes, newlines and Nepali text", () => {
  assertEquals(csvCell('नेपाल, "hello"\nline 2'), {
    encoded: '"नेपाल, ""hello""\nline 2"',
    escaped: false,
  });
  assertEquals(new Set(REVIEW_CSV_HEADERS).size, REVIEW_CSV_HEADERS.length);
});
for (
  const value of [
    "x\u0000y",
    "x\u0001y",
    "x\u007fy",
    "x\u202ey",
    "x\u2066y",
    "x\ud800y",
  ]
) {
  Deno.test(
    "P7 unsafe control/Unicode cell is refused rather than silently rewritten " +
      value.length,
    () => {
      assertThrows(() => csvCell(value));
    },
  );
}
Deno.test("P7 canonical structured CSV cells survive event JSONB key reordering on retry", async () => {
  const { canonical } = await import(
    "../../../supabase/functions/_shared/pilot/pilotScope.ts"
  );
  const x = await reviewFixture(), s = await x.inspect();
  await reviewBrief(x.scope, {
    action: "edit",
    operation_id: x.operation(),
    expected_head: s.head_hash,
    expected_revision: s.revision.hash,
    choice: s.revision.choice,
    notes: [{
      text: "Source-backed question, still unverified",
      fact_ids: [x.packet.evidence.facts[0].id],
      classification: "human_supplied_unverified",
    }],
  }, x.reviewDeps);
  await x.approve();
  const a = await x.inspect(),
    r = {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: a.head_hash,
        revision_hash: a.revision.hash,
        approval_hash: a.approval!.event_hash,
      }],
    },
    scope = {
      workspace_id: x.scope.workspace_id,
      client_binding_id: x.scope.client_binding_id,
    },
    one = await prepareReviewCsv(scope, r, x.reviewDeps);
  x.events.streams.set(
    x.events.key(x.scope),
    JSON.parse(canonical(await x.events.history(x.scope))),
  );
  assertEquals(await prepareReviewCsv(scope, r, x.reviewDeps), one);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 identical concurrent exports return one durable manifest and byte stream", async () => {
  const x = await reviewFixture();
  await x.approve();
  const s = await x.inspect();
  let ticks = 0;
  x.reviewDeps.now = () =>
    new Date(Date.parse("2026-10-22T00:00:00Z") + ticks++).toISOString();
  const scope = {
      workspace_id: x.scope.workspace_id,
      client_binding_id: x.scope.client_binding_id,
    },
    r = {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: s.head_hash,
        revision_hash: s.revision.hash,
        approval_hash: s.approval!.event_hash,
      }],
    };
  const [a, b] = await Promise.all([
    prepareReviewCsv(scope, r, x.reviewDeps),
    prepareReviewCsv(scope, r, x.reviewDeps),
  ]);
  assertEquals(a, b);
  assertEquals(x.events.commits, 2);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 stale second head refuses a whole batch before any first-row export append", async () => {
  const { reviewContext, loadReview, makeReviewEvent } = await import(
    "../../../supabase/functions/_shared/pilot/pilotReview.ts"
  );
  const x = await reviewFixture(), second = await x.addTask();
  await x.approve();
  await x.approve(second);
  const a = await x.inspect(),
    b = await x.inspect(second),
    ctx = await reviewContext(second, x.reviewDeps),
    state = await loadReview(ctx, x.reviewDeps),
    concurrent = await makeReviewEvent(
      ctx,
      state,
      x.operation(),
      "f".repeat(64),
      "2026-10-22T00:00:00.000Z",
      { kind: "reject", reason: "Concurrent review rejected" },
    );
  x.events.beforeCommit = () => {
    x.events.streams.get(x.events.key(second))!.push(concurrent);
  };
  await assertRejects(() =>
    prepareReviewCsv({
      workspace_id: x.scope.workspace_id,
      client_binding_id: x.scope.client_binding_id,
    }, {
      operation_id: x.operation(),
      items: [{
        task_id: x.scope.task_id,
        expected_head: a.head_hash,
        revision_hash: a.revision.hash,
        approval_hash: a.approval!.event_hash,
      }, {
        task_id: second.task_id,
        expected_head: b.head_hash,
        revision_hash: b.revision.hash,
        approval_hash: b.approval!.event_hash,
      }],
    }, x.reviewDeps)
  );
  assertEquals(x.events.commits, 2);
  assert(
    !x.events.streams.get(x.events.key(x.scope))!.some((e) =>
      e.data.kind === "export_prepared"
    ),
  );
  assertEquals(x.calls.length, 2);
  noPaid(x.f.n);
});
