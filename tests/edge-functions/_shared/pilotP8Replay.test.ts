// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { freezePilotContext } from "../../../supabase/functions/_shared/pilot/pilotContextSnapshot.ts";
import { buildBriefCatalog } from "../../../supabase/functions/_shared/pilot/callBriefPrompt.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import { sourcePacketView } from "../../../src/lib/pilot/sourcePacketView.ts";
import { noPaid, task, UA } from "../_helpers/pilotScopeFixture.ts";
import { scope, snapshotFixture } from "../_helpers/pilotSnapshotFixture.ts";

for (const reverse of [false, true]) {
  Deno.test(`P8 signed V2 survives storage object reordering (reverse=${reverse}) without fresh context`, async () => {
    const x = await snapshotFixture(scope, UA, "pilot_context_v2");
    const p = await freezePilotContext(scope, x.deps);
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder); // Array order remains authoritative.
      if (v && typeof v === "object") {
        const entries = Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1);
        if (reverse) entries.reverse();
        return Object.fromEntries(entries.map(([k, val]) => [k, reorder(val)]));
      }
      return v;
    };
    x.snapshots.packets.set(x.snapshots.key(scope), reorder(p) as typeof p);
    const loads = x.loads();
    x.row.profile = {
      company: { name: "Client A", website_url: "https://client-a.example" },
      target_customer: { industries: ["CHANGED_TODAY"] },
    };
    x.deps.loadApprovedInputs = () => {
      throw Error("must never load new input");
    };
    const replay = await freezePilotContext(scope, x.deps);
    assertEquals(canonical(replay), canonical(p));
    assertEquals(buildBriefCatalog(replay), buildBriefCatalog(p));
    assertEquals(sourcePacketView(replay, scope), sourcePacketView(p, scope));
    assertEquals(replay.version, "pilot_context_packet_v2");
    assertEquals(x.loads(), loads);
    assertEquals(x.snapshots.writes, 1);
    noPaid(x.f.n);
  });
}
Deno.test("P8 historical V1 packet is not silently migrated or reordered", async () => {
  const x = await snapshotFixture();
  const p = await freezePilotContext(scope, x.deps);
  assertEquals(p.version, "pilot_context_packet_v1");
  assertEquals(await freezePilotContext(scope, x.deps), p);
  x.snapshots.packets.set(x.snapshots.key(scope), JSON.parse(canonical(p)));
  await assertRejects(
    () => freezePilotContext(scope, x.deps),
    Error,
    "snapshot_stored_integrity_failure",
  );
  assertEquals(x.snapshots.writes, 1);
  noPaid(x.f.n);
});
for (
  const attack of [
    "source",
    "fact",
    "fact-order",
    "version",
    "approval",
    "binding",
    "unknown-version",
  ]
) {
  Deno.test(`P8 V2 storage replay refuses ${attack}`, async () => {
    const x = await snapshotFixture(scope, UA, "pilot_context_v2");
    const p = structuredClone(await freezePilotContext(scope, x.deps));
    switch (attack) {
      case "source":
        p.evidence.source_snapshot.sources[0].body += "fabricated";
        break;
      case "fact":
        p.evidence.facts[0].value = "fabricated";
        break;
      case "fact-order":
        p.evidence.facts.reverse();
        break;
      case "version":
        p.version = "pilot_context_packet_v1";
        break;
      case "approval":
        p.approval.version = "pilot_context_v1";
        break;
      case "binding":
        p.binding_hash = "f".repeat(64);
        break;
      case "unknown-version":
        (task(x.f).payload as Record<string, unknown>).pilot_context = {
          ...p.approval,
          version: "pilot_context_v3",
        };
        break;
    }
    x.snapshots.packets.set(x.snapshots.key(scope), p);
    await assertRejects(() => freezePilotContext(scope, x.deps));
    assertEquals(x.snapshots.writes, 1);
    noPaid(x.f.n);
  });
}
Deno.test("P8 V2 storage lost-ack retry reuses exactly one frozen packet", async () => {
  const x = await snapshotFixture(scope, UA, "pilot_context_v2");
  x.snapshots.failAfter = true;
  await assertRejects(() => freezePilotContext(scope, x.deps));
  x.snapshots.failAfter = false;
  const saved = x.snapshots.packets.get(x.snapshots.key(scope))!;
  x.snapshots.packets.set(x.snapshots.key(scope), JSON.parse(canonical(saved)));
  const p = await freezePilotContext(scope, x.deps);
  assertEquals(p.packet_hash, saved.packet_hash);
  assertEquals(x.snapshots.writes, 1);
  assert(Object.isFrozen(p));
  noPaid(x.f.n);
});
Deno.test("P8 V2 presentation rejects a mismatched approval version", async () => {
  const x = await snapshotFixture(scope, UA, "pilot_context_v2");
  const p = structuredClone(await freezePilotContext(scope, x.deps));
  p.approval.version = "pilot_context_v1";
  assertThrows(() => sourcePacketView(p, scope));
  assertThrows(() => buildBriefCatalog(p));
});
for (
  const version of [
    ["pilot_context_v1"],
    ["pilot_context_v2"],
    null,
    2,
    "pilot_context_v3",
  ]
) {
  Deno.test(`P8 approval version is not coerced: ${JSON.stringify(version)}`, async () => {
    const x = await snapshotFixture(scope, UA, version);
    await assertRejects(
      () => freezePilotContext(scope, x.deps),
      Error,
      "snapshot_approval_invalid",
    );
    assertEquals(x.snapshots.writes, 0);
    noPaid(x.f.n);
  });
}
