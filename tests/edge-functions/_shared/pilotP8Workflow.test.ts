// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { p8Workflow } from "../_helpers/pilotP8Workflow.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import { runCallBrief } from "../../../supabase/functions/_shared/pilot/callBriefRunner.ts";
import { BOTH, noPaid, task } from "../_helpers/pilotScopeFixture.ts";
import { CSV } from "../_helpers/pilotSnapshotFixture.ts";

Deno.test("P8 real preview -> signed V2 packet -> mocked model -> source review -> exact approved CSV", async () => {
  const x = await p8Workflow();
  assertEquals(
    x.preview.file_hash,
    x.packet.evidence.source_snapshot.csv.file_hash,
  );
  assertEquals(x.preview.capabilities, {
    preview_only: true,
    persist: false,
    task_creation: false,
    research: false,
    model: false,
    apollo_api: false,
    export: false,
    dispatch: false,
  });
  assertEquals((x.preview.rows as unknown[]).length, 1); // Duplicate source rows collapsed.
  await x.controller.inspect();
  await assertRejects(() => x.controller.exportCsv());
  const v = x.controller.view!;
  await x.controller.edit(v.revision.choice, [{
    text: "Ask whether priorities have changed.",
    fact_ids: [],
    classification: "human_supplied_unverified",
  }]);
  await x.controller.approve(true);
  const first = await x.controller.exportCsv();
  const retry = await x.controller.exportCsv();
  assertEquals(first, retry);
  const csv = new TextDecoder().decode(first.bytes);
  assert(csv.includes("SUPPLIED_UNVERIFIED"));
  assert(csv.includes("human_supplied_unverified"));
  assert(csv.includes(x.packet.packet_hash));
  assert(csv.includes("We are not looking for new tools."));
  assert(!csv.includes("PRIVATE_B"));
  assertEquals(x.events.commits, 3);
  x.assertNoExecution();
  noPaid(x.f.n);
});
Deno.test("P8 parallel clients sharing external IDs cannot mix drafts, approvals or output", async () => {
  const [a, b] = await Promise.all([p8Workflow("A"), p8Workflow("B")]);
  assertEquals(
    a.packet.evidence.source_snapshot.csv.normalized,
    b.packet.evidence.source_snapshot.csv.normalized,
  );
  await Promise.all([a.controller.inspect(), b.controller.inspect()]);
  await Promise.all([a.controller.approve(true), b.controller.approve(true)]);
  const files = await Promise.all([
    a.controller.exportCsv(),
    b.controller.exportCsv(),
  ]);
  for (const [x, other, out] of [[a, b, files[0]], [b, a, files[1]]] as const) {
    const text = new TextDecoder().decode(out.bytes);
    assert(text.includes(x.packet.packet_hash));
    assert(!text.includes(other.packet.packet_hash));
    await assertRejects(() => x.service.inspect(other.scope));
    // Membership in both workspaces still does not delegate the original actor's signed task.
    x.reviewDeps.user_id = BOTH;
    await assertRejects(() => x.service.inspect(x.scope));
    noPaid(x.f.n);
  }
});
for (const attack of ["membership", "cancel", "policy", "source", "expiry"]) {
  Deno.test(`P8 approved export retry refuses ${attack} without further model attempts`, async () => {
    const x = await p8Workflow();
    await x.controller.inspect();
    await x.controller.approve(true);
    await x.controller.exportCsv();
    switch (attack) {
      case "membership":
        x.f.n.tables.workspace_members = [];
        break;
      case "cancel":
        task(x.f, x.scope.task_id).status = "cancelled";
        break;
      case "policy":
        x.reviewPolicy.version++;
        break;
      case "source": {
        const p = x.snapshots.packets.get(x.snapshots.key(x.scope))!;
        p.evidence.source_snapshot.sources[0].body += "tampered";
        break;
      }
      case "expiry":
        x.setNow("2026-10-23T00:00:00Z");
        break;
    }
    await assertRejects(() => x.controller.exportCsv());
    x.assertNoExecution();
    noPaid(x.f.n);
  });
}
Deno.test("P8 V2 brief resume after object-order storage roundtrip preserves model and approval", async () => {
  const x = await p8Workflow();
  await x.controller.inspect();
  await x.controller.approve(true);
  const before = await x.controller.exportCsv();
  x.snapshots.packets.set(
    x.snapshots.key(x.scope),
    JSON.parse(canonical(x.packet)),
  );
  x.row.profile = {
    company: { name: "Client A", website_url: "https://client-a.example" },
    business_context: "CHANGED_LIVE",
  };
  assertEquals(await runCallBrief(x.scope, x.deps), x.draft);
  assertEquals(await x.controller.exportCsv(), before);
  x.assertNoExecution();
});
for (
  const csv of [
    "Company,Domain\nwrong,another.example",
    CSV.replace("Company,Domain", "workspace_id,Domain"),
    '"unterminated',
  ]
) {
  Deno.test(`P8 invalid/mismatched import cannot reach draft stage: ${csv.slice(0, 28)}`, async () => {
    await assertRejects(() => p8Workflow("A", csv));
  });
}
