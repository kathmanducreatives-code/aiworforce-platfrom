// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handlePilotImport } from "../../supabase/functions/_shared/pilot/pilotImport.ts";
import { createPilotScopeStore } from "../../supabase/functions/_shared/pilot/pilotScopeStore.ts";
import {
  A,
  B,
  CA,
  CB,
  type Fixture,
  fixture,
  noPaid,
  UA,
} from "./_helpers/pilotScopeFixture.ts";
const csv =
  "Company,Website,Name,Person\nSynthetic,synthetic-co.com,Ada,apollo-overlap";
const mapping = {
  Company: "company_name",
  Website: "company_domain",
  Name: "contact_name",
  Person: "apollo_contact_id",
};
async function request(
  f: Fixture,
  extra: Record<string, unknown> = {},
  token = "jwt-A",
) {
  f.settings.OUTPOST_PILOT_CONTEXT_ENABLED ??= "true";
  f.settings.OUTPOST_PILOT_CSV_PREVIEW_ENABLED ??= "true";
  const r = await handlePilotImport(
    new Request("https://audit.invalid/pilot-import", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: "preview",
        approved_existing_leads: true,
        workspace_id: A,
        client_binding_id: CA,
        csv,
        mapping,
        ...extra,
      }),
    }),
    f.deps,
  );
  noPaid(f.n);
  return {
    status: r.status,
    body: await r.json(),
    cache: r.headers.get("Cache-Control"),
  };
}
Deno.test("P3 authorized preview uses real P1 scope and never writes, binds, calls providers or leaks Brain", async () => {
  const f = fixture(), before = JSON.stringify(f.n.tables);
  const r = await request(f);
  assertEquals(r.status, 200);
  assertEquals(r.cache, "no-store");
  assertEquals(r.body.rows[0].workspace_id, A);
  assertEquals(r.body.rows[0].client_binding_id, CA);
  assertEquals(r.body.capabilities.persist, false);
  assertEquals(r.body.capabilities.model, false);
  assert(!JSON.stringify(r.body).includes("PRIVATE_"));
  assertEquals(JSON.stringify(f.n.tables), before);
});
for (
  const flag of [
    "OUTPOST_PILOT_SCOPE_ENABLED",
    "OUTPOST_PILOT_CONTEXT_ENABLED",
    "OUTPOST_PILOT_CSV_PREVIEW_ENABLED",
  ]
) {
  Deno.test(`P3 gate cannot bypass ${flag}`, async () => {
    const f = fixture();
    f.settings[flag] = "false";
    assertEquals((await request(f)).status, 503);
  });
}
for (
  const [name, extra, token] of [
    ["foreign workspace", { workspace_id: B, client_binding_id: CB }, "jwt-A"],
    ["mixed scope", { client_binding_id: CB }, "jwt-both"],
    ["missing scope", { workspace_id: null }, "jwt-A"],
    ["spoof actor", { user_id: UA }, "jwt-A"],
    ["attach task", { task_id: A }, "jwt-A"],
    ["persist", { action: "confirm" }, "jwt-A"],
    ["model request", { model: "gpt" }, "jwt-A"],
    ["unauthorized", {}, "bad-token"],
    ["anon", {}, "anon-public-key"],
    ["service", {}, "service-role-secret"],
    ["mixed client csv", {
      csv: "Company,Website,Client\nA,aaa.com,A\nB,bbb.com,B",
    }, "jwt-both"],
    [
      "mapping ownership",
      { mapping: { ...mapping, Person: "workspace_id" } },
      "jwt-A",
    ],
  ] as const
) {
  Deno.test(`P3 fail closed: ${name}`, async () => {
    const f = fixture(), before = JSON.stringify(f.n.tables);
    const r = await request(f, extra, token);
    assert(r.status >= 400);
    assert(!JSON.stringify(r.body).includes("PRIVATE_"));
    assertEquals(JSON.stringify(f.n.tables), before);
  });
}
Deno.test("P3 same export in two clients and shared user has separate scoped keys", async () => {
  const f = fixture();
  const a = await request(f, {}, "jwt-both"),
    b = await request(
      f,
      { workspace_id: B, client_binding_id: CB },
      "jwt-both",
    );
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  assertEquals(a.body.file_hash, b.body.file_hash);
  assert(a.body.preview_hash !== b.body.preview_hash);
  assert(a.body.rows[0].preview_row_key !== b.body.rows[0].preview_row_key);
  assertEquals(b.body.rows[0].workspace_id, B);
});
Deno.test("P3 repeat and concurrent previews deterministic; changed input/mapping/actor gives new fingerprint", async () => {
  const f = fixture(), before = JSON.stringify(f.n.tables);
  const [a, b] = await Promise.all([request(f), request(f)]);
  assertEquals(a.body, b.body);
  const changed = await request(f, { csv: csv.replace("Ada", "Grace") });
  assert(changed.body.preview_hash !== a.body.preview_hash);
  const actor = await request(f, {}, "jwt-both");
  assert(actor.body.preview_hash !== a.body.preview_hash);
  const map = await request(f, { mapping: { ...mapping, Person: null } });
  assert(map.body.preview_hash !== a.body.preview_hash);
  assertEquals(JSON.stringify(f.n.tables), before);
});
Deno.test("P3 retries reauthorize after revocation and policy changes; no stale receipt authorizes action", async () => {
  const f = fixture();
  assertEquals((await request(f)).status, 200);
  f.n.tables.workspace_members = f.n.tables.workspace_members.filter((r) =>
    r.user_id !== UA
  );
  assertEquals((await request(f)).status, 403);
  const g = fixture();
  const a = await request(g);
  g.policy.workspaces[0].version++;
  const b = await request(g);
  assertEquals(b.status, 200);
  assert(a.body.preview_hash !== b.body.preview_hash);
});
Deno.test("P3 final membership recheck withholds preview after concurrent revocation (mock, not native proof)", async () => {
  const f = fixture(), store = createPilotScopeStore(f.deps);
  let reads = 0;
  const deps = {
    ...f.deps,
    store: () => ({
      ...store,
      member: async (w: string, u: string) => {
        if (++reads === 2) return null;
        return await store.member(w, u);
      },
    }),
  };
  const r = await handlePilotImport(
    new Request("https://audit.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-A" },
      body: JSON.stringify({
        action: "preview",
        approved_existing_leads: true,
        workspace_id: A,
        client_binding_id: CA,
        csv,
        mapping,
      }),
    }),
    {
      ...deps,
      env: (k) =>
        k === "OUTPOST_PILOT_CSV_PREVIEW_ENABLED" ||
          k === "OUTPOST_PILOT_CONTEXT_ENABLED"
          ? "true"
          : f.env(k),
    },
  );
  assertEquals(r.status, 403);
  assertEquals((await r.json()).rows, undefined);
  noPaid(f.n);
});
Deno.test("P3 inspect returns only bounded headers/count; never rows or ignored values", async () => {
  const f = fixture();
  const r = await request(f, { action: "inspect", mapping: undefined });
  assertEquals(r.status, 200);
  assertEquals(r.body.headers, ["Company", "Website", "Name", "Person"]);
  assertEquals(r.body.rows, undefined);
  assert(!JSON.stringify(r.body).includes("Ada"));
});
Deno.test("P3 invalid UTF-8 JSON and oversized envelopes reject without persistence", async () => {
  const f = fixture();
  f.settings.OUTPOST_PILOT_CSV_PREVIEW_ENABLED = "true";
  f.settings.OUTPOST_PILOT_CONTEXT_ENABLED = "true";
  for (const body of [new Uint8Array([0xff]), "x".repeat(1_600_001)]) {
    const r = await handlePilotImport(
      new Request("https://audit.invalid", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-A" },
        body,
      }),
      f.deps,
    );
    assert(r.status >= 400);
  }
  noPaid(f.n);
});

Deno.test("P3 attestation required, exact bytes hashed, malformed JSON and array action refused", async () => {
  const f = fixture();
  assertEquals(
    (await request(f, { approved_existing_leads: false })).status,
    400,
  );
  assertEquals((await request(f, { action: ["preview"] })).status, 400);
  const a = await request(f), b = await request(f, { csv: "\uFEFF" + csv });
  assertEquals(a.status, 200);
  assertEquals(b.status, 200);
  assert(a.body.file_hash !== b.body.file_hash);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(csv),
  );
  assertEquals(
    a.body.file_hash,
    [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join(
      "",
    ),
  );
});
