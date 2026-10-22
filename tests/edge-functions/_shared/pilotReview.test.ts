// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  inspectReview,
  reviewBrief,
} from "../../../supabase/functions/_shared/pilot/pilotReview.ts";
import { reviewFixture } from "../_helpers/pilotReviewFixture.ts";
import { B, BOTH, CB, noPaid, task } from "../_helpers/pilotScopeFixture.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
Deno.test("P7 inspect and approve use server history and exact source/model version, never UI truth", async () => {
  const x = await reviewFixture(), initial = await x.inspect();
  assertEquals(initial.status, "unreviewed");
  assertEquals(initial.approval, null);
  const approved = await x.approve();
  assertEquals(approved.status, "approved_for_manual_csv");
  assertEquals(approved.approval!.revision_hash, initial.revision.hash);
  assertEquals(approved.events[0].root_draft_hash, x.draft.draft_hash);
  assertEquals(approved.events[0].packet_hash, x.packet.packet_hash);
  assertEquals(approved.approval!.actor_id, x.deps.user_id);
  assertEquals(approved.approval!.at, "2026-10-22T00:00:00.000Z");
  assertThrows(() => {
    approved.revision.notes.push({
      text: "forged",
      fact_ids: [],
      classification: "human_supplied_unverified",
    });
  }, TypeError);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 human edit creates a new unreviewed revision and invalidates prior approval", async () => {
  const x = await reviewFixture(),
    old = await x.approve(),
    request = {
      action: "edit" as const,
      operation_id: x.operation(),
      expected_head: old.head_hash,
      expected_revision: old.revision.hash,
      choice: structuredClone(old.revision.choice),
      notes: [{
        text: "Ask about priorities; do not assume a sales problem.",
        fact_ids: [x.packet.evidence.facts[0].id],
        classification: "human_supplied_unverified" as const,
      }],
    };
  const edit = await reviewBrief(x.scope, request, x.reviewDeps);
  assertEquals(edit.status, "unreviewed");
  assertEquals(edit.approval, null);
  assertEquals(edit.revision.number, 1);
  assert(edit.revision.hash !== old.revision.hash);
  assertEquals(edit.revision.notes, request.notes);
  assertEquals(edit.root_draft.packet_hash, old.root_draft.packet_hash);
  assertEquals(edit.revision.content.verified_facts, []);
  await assertRejects(() => x.exportOne());
  const approved = await x.approve();
  assertEquals(approved.approval!.revision_hash, edit.revision.hash);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 reject forbids export and requires an explicit new edit before approval", async () => {
  const x = await reviewFixture(), s = await x.inspect();
  const r = await reviewBrief(x.scope, {
    action: "reject",
    operation_id: x.operation(),
    expected_head: s.head_hash,
    expected_revision: s.revision.hash,
    reason: "Needs clearer source context",
  }, x.reviewDeps);
  assertEquals(r.status, "rejected");
  await assertRejects(() => x.exportOne());
  await assertRejects(() => x.approve());
  const edit = await reviewBrief(x.scope, {
    action: "edit",
    operation_id: x.operation(),
    expected_head: r.head_hash,
    expected_revision: r.revision.hash,
    choice: r.revision.choice,
    notes: [],
  }, x.reviewDeps);
  assertEquals(edit.status, "unreviewed");
  assertEquals((await x.approve()).status, "approved_for_manual_csv");
  x.assertNoExecution();
  noPaid(x.f.n);
});
for (
  const attack of [
    "approved-flag",
    "forged-actor",
    "forged-time",
    "verified-note",
    "foreign-fact",
    "replaced-fact",
    "dispatch",
    "missing-ack",
    "wrong-version",
  ]
) {
  Deno.test(`P7 refuses ${attack} without producing trusted approval`, async () => {
    const x = await reviewFixture(), s = await x.inspect();
    const request: Record<string, unknown> = {
      action: "approve",
      operation_id: x.operation(),
      expected_head: s.head_hash,
      expected_revision: s.revision.hash,
      acknowledge_unverified: true,
    };
    switch (attack) {
      case "approved-flag":
        request.approved = true;
        break;
      case "forged-actor":
        request.actor_id = BOTH;
        break;
      case "forged-time":
        request.at = "2020-01-01T00:00:00Z";
        break;
      case "dispatch":
        request.send = true;
        break;
      case "missing-ack":
        request.acknowledge_unverified = false;
        break;
      case "wrong-version":
        request.expected_revision = "f".repeat(64);
        break;
      default:
        delete request.acknowledge_unverified;
        request.action = "edit";
        request.choice = s.revision.choice;
        request.notes = [{
          text: "Invented buyer problem",
          fact_ids: attack === "foreign-fact" ? ["other-client-fact"] : [],
          classification: attack === "verified-note"
            ? "verified_fact"
            : "human_supplied_unverified",
        }];
        if (attack === "replaced-fact") {
          request.choice = {
            ...s.revision.choice,
            company_overview: [{
              text: "Raised $20m",
              fact_ids: s.revision.choice.company_overview,
            }],
          };
        }
    }
    await assertRejects(() =>
      reviewBrief(x.scope, request as never, x.reviewDeps)
    );
    assertEquals(x.events.commits, 0);
    x.assertNoExecution();
    noPaid(x.f.n);
  });
}
for (
  const attack of [
    "wrong-workspace",
    "wrong-client",
    "shared-user",
    "revoked",
    "cancelled",
    "signed-payload",
    "model-policy",
    "review-policy",
    "disabled",
    "missing-draft",
    "missing-packet",
  ]
) {
  Deno.test(`P7 current authorization rejects ${attack}`, async () => {
    const x = await reviewFixture(), s = { ...x.scope };
    switch (attack) {
      case "wrong-workspace":
        s.workspace_id = B;
        break;
      case "wrong-client":
        s.client_binding_id = CB;
        break;
      case "shared-user":
        x.reviewDeps.user_id = BOTH;
        break;
      case "revoked":
        x.f.n.tables.workspace_members = [];
        break;
      case "cancelled":
        task(x.f, x.scope.task_id).status = "cancelled";
        break;
      case "signed-payload":
        (task(x.f).payload as Record<string, unknown>).instruction = "forged";
        break;
      case "model-policy":
        x.policy.version++;
        break;
      case "review-policy":
        x.reviewPolicy.client_binding_id = CB;
        break;
      case "disabled":
        Object.assign(x.reviewDeps, { mode: "live" });
        break;
      case "missing-draft":
        x.briefs.rows.clear();
        break;
      case "missing-packet":
        x.snapshots.packets.clear();
        break;
    }
    await assertRejects(() => inspectReview(s, x.reviewDeps));
    assertEquals(x.events.commits, 0);
    x.assertNoExecution();
    noPaid(x.f.n);
  });
}
Deno.test("P7 stale review heads and concurrent edits cannot reuse the same approval", async () => {
  const x = await reviewFixture(), s = await x.inspect();
  const make = () => ({
    action: "edit" as const,
    operation_id: x.operation(),
    expected_head: s.head_hash,
    expected_revision: s.revision.hash,
    choice: s.revision.choice,
    notes: [],
  });
  const results = await Promise.allSettled([
    reviewBrief(x.scope, make(), x.reviewDeps),
    reviewBrief(x.scope, make(), x.reviewDeps),
  ]);
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
  assertEquals(x.events.commits, 1);
  await assertRejects(() =>
    reviewBrief(x.scope, {
      action: "approve",
      operation_id: x.operation(),
      expected_head: s.head_hash,
      expected_revision: s.revision.hash,
      acknowledge_unverified: true,
    }, x.reviewDeps)
  );
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 lost edit/approval commit acknowledgement replays original event once", async () => {
  for (const action of ["edit", "approve"] as const) {
    const x = await reviewFixture(), s = await x.inspect();
    const r = action === "approve"
      ? {
        action,
        operation_id: x.operation(),
        expected_head: s.head_hash,
        expected_revision: s.revision.hash,
        acknowledge_unverified: true as const,
      }
      : {
        action,
        operation_id: x.operation(),
        expected_head: s.head_hash,
        expected_revision: s.revision.hash,
        choice: s.revision.choice,
        notes: [],
      };
    x.events.failAfter = true;
    await assertRejects(() => reviewBrief(x.scope, r, x.reviewDeps));
    x.events.failAfter = false;
    const first = await reviewBrief(x.scope, r, x.reviewDeps),
      second = await reviewBrief(x.scope, r, x.reviewDeps);
    assertEquals(first, second);
    assertEquals(x.events.commits, 1);
    x.assertNoExecution();
    noPaid(x.f.n);
  }
});
for (
  const attack of [
    "scope",
    "actor",
    "revision",
    "chain",
    "data",
    "time",
    "duplicate",
    "truncated",
  ]
) {
  Deno.test(`P7 corrupt review history ${attack} fails closed`, async () => {
    const x = await reviewFixture();
    await x.approve();
    const events = x.events.streams.get(x.events.key(x.scope))!;
    switch (attack) {
      case "scope":
        events[0].workspace_id = B;
        break;
      case "actor":
        events[0].actor_id = BOTH;
        break;
      case "revision":
        events[0].revision_hash = "e".repeat(64);
        break;
      case "chain":
        events[0].previous_hash = "f".repeat(64);
        break;
      case "data":
        events[0].data = {
          kind: "approve",
          acknowledge_unverified: false,
        } as never;
        break;
      case "time":
        events[0].at = "2026-10-23T00:00:00Z";
        break;
      case "duplicate":
        events.push(structuredClone(events[0]));
        break;
      case "truncated":
        events[0].sequence = 2;
        break;
    }
    await assertRejects(() => x.inspect());
    await assertRejects(() => x.exportOne());
    x.assertNoExecution();
    noPaid(x.f.n);
  });
}
Deno.test("P7 immutable frozen Brain edits do not silently recontextualize a review", async () => {
  const x = await reviewFixture(), approved = await x.approve();
  (x.row.profile as Record<string, unknown>).positioning = {
    offer: "A changed offer",
  };
  x.row.updated_at = "2026-10-22T00:00:00Z";
  const view = await x.inspect();
  assertEquals(view.root_draft, approved.root_draft);
  assertEquals(view.revision.hash, approved.revision.hash);
  assertEquals(
    (await x.exportOne()).manifest.status,
    "prepared_for_manual_download",
  );
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 expiry, server clock rollback and review-policy changes cannot silently reuse approvals", async () => {
  for (const attack of ["expiry", "clock", "policy"]) {
    const x = await reviewFixture();
    await x.approve();
    if (attack === "expiry") x.setNow("2026-10-22T01:00:00Z");
    if (attack === "clock") x.setNow("2026-10-21T23:59:59Z");
    if (attack === "policy") x.reviewPolicy.version++;
    await assertRejects(() => x.exportOne());
    if (attack === "expiry") {
      assertEquals((await x.inspect()).status, "approval_expired");
    }
    x.assertNoExecution();
    noPaid(x.f.n);
  }
});
Deno.test("P7 native-style commit fence refuses revocation after the last application check", async () => {
  const x = await reviewFixture(), s = await x.inspect();
  x.events.beforeCommit = () => {
    x.f.n.tables.workspace_members = [];
  };
  await assertRejects(() =>
    reviewBrief(x.scope, {
      action: "approve",
      operation_id: x.operation(),
      expected_head: s.head_hash,
      expected_revision: s.revision.hash,
      acknowledge_unverified: true,
    }, x.reviewDeps)
  );
  assertEquals(x.events.commits, 0);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 P5 JSONB ordering limitation stays disabled, with no repair or paid operation", async () => {
  const x = await reviewFixture();
  x.snapshots.packets.set(
    x.snapshots.key(x.scope),
    JSON.parse(canonical(x.packet)),
  );
  await assertRejects(
    () => x.inspect(),
    Error,
    "snapshot_stored_integrity_failure",
  );
  x.assertNoExecution();
  assertEquals(x.events.commits, 0);
  noPaid(x.f.n);
});
Deno.test("P7 UI-controller workflow uses real server decisions and exports no unapproved local state", async () => {
  const { BriefReviewController } = await import(
    "../../../src/lib/pilot/briefReviewController.ts"
  );
  const { prepareReviewCsv } = await import(
    "../../../supabase/functions/_shared/pilot/pilotExport.ts"
  );
  const x = await reviewFixture();
  const c = new BriefReviewController(x.scope, {
    inspect: (s) => inspectReview(s, x.reviewDeps),
    review: (s, r) => reviewBrief(s, r as never, x.reviewDeps),
    prepare: (s, r) => prepareReviewCsv(s, r as never, x.reviewDeps),
  });
  await c.inspect();
  await assertRejects(() => c.exportCsv());
  await c.edit(c.view!.revision.choice, [{
    text: "Human asks about current priorities; unverified",
    fact_ids: [],
    classification: "human_supplied_unverified",
  }]);
  await c.approve(true);
  const bytes = await c.exportCsv();
  assertEquals(await c.exportCsv(), bytes);
  assert(
    new TextDecoder().decode(bytes.bytes).includes("human_supplied_unverified"),
  );
  assertEquals(x.events.commits, 3);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 identical concurrent review requests retain the first server timestamp and one event", async () => {
  const x = await reviewFixture(), s = await x.inspect();
  let ticks = 0;
  x.reviewDeps.now = () =>
    new Date(Date.parse("2026-10-22T00:00:00Z") + ticks++).toISOString();
  const r = {
    action: "approve" as const,
    operation_id: x.operation(),
    expected_head: s.head_hash,
    expected_revision: s.revision.hash,
    acknowledge_unverified: true as const,
  };
  const [a, b] = await Promise.all([
    reviewBrief(x.scope, r, x.reviewDeps),
    reviewBrief(x.scope, r, x.reviewDeps),
  ]);
  assertEquals(a.approval, b.approval);
  assertEquals(x.events.commits, 1);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P7 separate clients retain distinct approvals and CSVs despite overlapping external IDs", async () => {
  const a = await reviewFixture(), b = await reviewFixture("B");
  await a.approve();
  await b.approve();
  const av = await a.inspect(), bv = await b.inspect();
  assert(av.revision.hash !== bv.revision.hash);
  const ac = await a.exportOne(), bc = await b.exportOne();
  assert(!ac.csv.includes("PRIVATE_B"));
  assert(!bc.csv.includes("PRIVATE_A"));
  a.events.history = () => Promise.resolve(bv.events);
  await assertRejects(() => a.inspect());
  a.assertNoExecution();
  b.assertNoExecution();
  noPaid(a.f.n);
  noPaid(b.f.n);
});
