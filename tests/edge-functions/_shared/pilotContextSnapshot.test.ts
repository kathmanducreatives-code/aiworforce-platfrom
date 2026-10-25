// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  freezePilotContext,
  reviewBrainSnapshot,
} from "../../../supabase/functions/_shared/pilot/pilotContextSnapshot.ts";
import { canonical } from "../../../supabase/functions/_shared/pilot/pilotScope.ts";
import {
  B,
  BOTH,
  CB,
  noPaid,
  task,
  TASK_B,
  UA,
  UB,
} from "../_helpers/pilotScopeFixture.ts";
import { scope, snapshotFixture } from "../_helpers/pilotSnapshotFixture.ts";
Deno.test("P5 freezes approved full instructions, source identity and explicit disabled capabilities", async () => {
  const x = await snapshotFixture(),
    p = await freezePilotContext(scope, x.deps);
  assertEquals(p.brain, x.brain);
  const raw = JSON.stringify(p);
  for (
    const expected of [
      "PRIVATE_A_STYLE",
      "A mandatory region",
      "Recent growth",
      "Consumer-only",
      "Private A offer",
      "Drafts only",
      "Do not target competitors",
      "Preserve custom client requirements",
    ]
  ) assert(raw.includes(expected));
  for (
    const forbidden of [
      "PRIVATE_B",
      "PRIVATE_A_MEMORY",
      "PRIVATE_A_OUTPUT",
      "DO_NOT_COPY_OTHER_CLIENT",
    ]
  ) assert(!raw.includes(forbidden));
  assertEquals(p.capabilities, {
    research: false,
    models: false,
    external_api: false,
    send: false,
    qualification: false,
  });
  assertEquals(p.evidence.canonical_decision, null);
  assertEquals(p.evidence.verified_facts, []);
  assertEquals(x.snapshots.writes, 1);
  assertThrows(() => {
    p.brain.approved_profile.company = "overwrite";
  }, TypeError);
  noPaid(x.f.n);
});
Deno.test("P5 retry/resume reuses original raw AND compiled Brain and original source packet", async () => {
  const x = await snapshotFixture(),
    p = await freezePilotContext(scope, x.deps);
  (x.row.profile as Record<string, unknown>).business_context = {
    instructions: "new content must not replace snapshot",
  };
  x.row.updated_at = "2026-10-21T00:00:00Z";
  x.deps.loadApprovedInputs = () => {
    throw new Error("must never reload sources on resume");
  };
  for (let i = 0; i < 3; i++) {
    assertEquals(await freezePilotContext(scope, x.deps), p);
  }
  assertEquals(x.loads(), 1);
  assertEquals(x.snapshots.writes, 1);
  noPaid(x.f.n);
});
Deno.test("P5 first capture rejects changed Brain or reviewed input instead of accepting stale approval", async () => {
  for (const type of ["brain", "inputs"]) {
    const x = await snapshotFixture();
    if (type === "brain") {
      (x.row.profile as Record<string, unknown>).exclusions = [
        "Changed exclusion",
      ];
    } else {
      const v = await x.deps.loadApprovedInputs(scope) as {
        interpretations: unknown[];
      };
      v.interpretations = [];
      x.deps.loadApprovedInputs = () => Promise.resolve(v);
    }
    await assertRejects(() => freezePilotContext(scope, x.deps));
    assertEquals(x.snapshots.writes, 0);
    noPaid(x.f.n);
  }
});
for (
  const change of [
    "workspace",
    "client",
    "task-owner",
    "shared-user",
    "membership",
    "seller",
    "payload",
    "status",
    "resource",
  ]
) {
  Deno.test(`P5 resume reauthorizes original task: ${change}`, async () => {
    const x = await snapshotFixture();
    await freezePilotContext(scope, x.deps);
    const s = { ...scope };
    switch (change) {
      case "workspace":
        s.workspace_id = B;
        break;
      case "client":
        s.client_binding_id = CB;
        break;
      case "task-owner":
        task(x.f).user_id = BOTH;
        break;
      case "shared-user":
        x.deps.user_id = BOTH;
        break;
      case "membership":
        x.f.n.tables.workspace_members = x.f.n.tables.workspace_members.filter(
          (r) => r.user_id !== UA,
        );
        break;
      case "seller":
        (x.row.profile as Record<string, unknown>).company = {
          name: "Client B",
          website_url: "https://client-b.example",
        };
        break;
      case "payload":
        (task(x.f).payload as Record<string, unknown>).instruction = "changed";
        break;
      case "status":
        task(x.f).status = "cancelled";
        break;
      case "resource":
        x.f.n.tables.saved_outputs[0].workspace_id = B;
        break;
    }
    await assertRejects(() => freezePilotContext(s, x.deps));
    assertEquals(x.snapshots.writes, 1);
    noPaid(x.f.n);
  });
}
for (
  const field of [
    "workspace_id",
    "client_binding_id",
    "task_id",
    "actor_id",
    "packet_hash",
    "brain",
    "facts",
    "approval",
  ]
) {
  Deno.test(`P5 refuses corrupt persisted snapshot ${field}`, async () => {
    const x = await snapshotFixture();
    await freezePilotContext(scope, x.deps);
    const p = x.snapshots.packets.get(x.snapshots.key(scope))!;
    if (field === "brain") p.brain.approved_profile.exclusions = ["forged"];
    else if (field === "facts") p.evidence.facts[0].workspace_id = B;
    else if (field === "approval") p.approval.as_of = "2027-01-01T00:00:00Z";
    else (p as unknown as Record<string, unknown>)[field] = B;
    await assertRejects(() => freezePilotContext(scope, x.deps));
    assertEquals(x.snapshots.writes, 1);
    noPaid(x.f.n);
  });
}
Deno.test("P5 identical concurrent retries produce one immutable packet in atomic fixture store", async () => {
  const x = await snapshotFixture();
  const packets = await Promise.all(
    Array.from({ length: 4 }, () => freezePilotContext(scope, x.deps)),
  );
  packets.forEach((p) => assertEquals(p, packets[0]));
  assertEquals(x.snapshots.writes, 1);
  noPaid(x.f.n);
});
Deno.test("P5 lost commit acknowledgement resumes saved original without reload or overwrite", async () => {
  const x = await snapshotFixture();
  x.snapshots.failAfter = true;
  await assertRejects(() => freezePilotContext(scope, x.deps));
  assertEquals(x.snapshots.writes, 1);
  x.snapshots.failAfter = false;
  x.deps.loadApprovedInputs = () => {
    throw new Error("unexpected reload");
  };
  const p = await freezePilotContext(scope, x.deps);
  assertEquals(canonical(p), canonical(await x.snapshots.read(scope)));
  assertEquals(x.snapshots.writes, 1);
  noPaid(x.f.n);
});
Deno.test("P5 store read/write failures and mid-commit cancellation fail closed", async () => {
  for (const type of ["read", "write", "cancel"]) {
    const x = await snapshotFixture();
    if (type === "read") x.snapshots.failRead = true;
    if (type === "write") x.snapshots.failBefore = true;
    if (type === "cancel") {
      x.snapshots.beforeInsert = () => {
        task(x.f).status = "cancelled";
      };
    }
    await assertRejects(() => freezePilotContext(scope, x.deps));
    noPaid(x.f.n);
  }
});
Deno.test("P5 live mode, absent task binding and changed enrollment cannot capture", async () => {
  for (const type of ["live", "unsigned", "enrollment"]) {
    const x = await snapshotFixture();
    if (type === "live") Object.assign(x.deps, { mode: "live" });
    if (type === "unsigned") {
      delete (task(x.f).payload as Record<string, unknown>).pilot_scope;
    }
    if (type === "enrollment") x.f.policy.workspaces[0].version++;
    await assertRejects(() => freezePilotContext(scope, x.deps));
    assertEquals(x.snapshots.writes, 0);
    noPaid(x.f.n);
  }
});
Deno.test("P5 Brain review cannot omit mandatory instructions or include credential/ownership subfields", async () => {
  const x = await snapshotFixture();
  assertThrows(() =>
    reviewBrainSnapshot(
      scope,
      x.row,
      x.brain.approved_sections.filter((k) => k !== "exclusions"),
    )
  );
  for (
    const key of [
      "workspace_id",
      "client_binding_id",
      "api_key",
      "credentials",
      "access_token",
      "destination-id",
    ]
  ) {
    const row = structuredClone(x.row);
    (row.profile as Record<string, unknown>).business_context = {
      [key]: "forbidden",
    };
    assertThrows(() =>
      reviewBrainSnapshot(scope, row, x.brain.approved_sections)
    );
  }
  const row = structuredClone(x.row);
  (row.profile as Record<string, unknown>).unreviewed_private = "DO_NOT_COPY";
  const review = reviewBrainSnapshot(scope, row, x.brain.approved_sections);
  assertEquals(review.omitted_fields, ["unreviewed_private"]);
  assert(!JSON.stringify(review).includes("DO_NOT_COPY"));
});

Deno.test("P5 full signed snapshots isolate two clients with identical Apollo company/contact IDs", async () => {
  const a = await snapshotFixture();
  const bScope = { workspace_id: B, client_binding_id: CB, task_id: TASK_B };
  const b = await snapshotFixture(bScope, UB);
  const pa = await freezePilotContext(scope, a.deps),
    pb = await freezePilotContext(bScope, b.deps);
  assertEquals(
    pa.evidence.source_snapshot.csv.normalized,
    pb.evidence.source_snapshot.csv.normalized,
  );
  assert(!JSON.stringify(pa).includes("PRIVATE_B"));
  assert(!JSON.stringify(pb).includes("PRIVATE_A"));
  assert(pa.packet_hash !== pb.packet_hash);
  // A shared local store must still reject a foreign packet, even with overlapping external identity.
  a.deps.snapshots.read = () => Promise.resolve(pb);
  await assertRejects(() => freezePilotContext(scope, a.deps));
  noPaid(a.f.n);
  noPaid(b.f.n);
});

Deno.test("P5 real packet presentation survives JSONB-style key ordering without broadening capabilities", async () => {
  const { sourcePacketView } = await import(
    "../../../src/lib/pilot/sourcePacketView.ts"
  );
  const x = await snapshotFixture(),
    p = await freezePilotContext(scope, x.deps);
  const reordered = JSON.parse(canonical(p));
  assertEquals(sourcePacketView(reordered, scope), sourcePacketView(p, scope));
  reordered.capabilities.models = true;
  assertThrows(() => sourcePacketView(reordered, scope));
  noPaid(x.f.n);
});
