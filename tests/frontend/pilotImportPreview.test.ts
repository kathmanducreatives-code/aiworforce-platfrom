// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  csvText,
  IMPORT_FIELDS,
  ImportPreview,
  validatePreview,
} from "../../src/lib/pilot/importPreview.ts";
import { IMPORT_FIELDS as SERVER_FIELDS } from "../../supabase/functions/_shared/pilot/pilotImportContract.ts";
const A = {
  workspace_id: "workspace-A",
  client_binding_id: "client-A",
  version: 1,
  mode: "draft_only" as const,
};
const B = { ...A, workspace_id: "workspace-B", client_binding_id: "client-B" };
const packet = (scope = A, action = "preview") => ({
  scope,
  action,
  headers: ["Company"],
  rows: [{ ...scope, normalized: { company_name: "Synthetic" } }],
  preview_hash: "hash",
});
Deno.test("P3 field allowlists remain identical across server and UI", () =>
  assertEquals(IMPORT_FIELDS, SERVER_FIELDS));
Deno.test("P3 CSV reads preserve BOM for hashing and reject invalid UTF-8/oversize input", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
  assertEquals(
    await csvText({
      size: 4,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
    }),
    "\uFEFFA",
  );
  await assertRejects(() =>
    csvText({
      size: 250001,
      arrayBuffer: () => Promise.reject(Error("must not read")),
    })
  );
  await assertRejects(() =>
    csvText({
      size: 1,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff]).buffer),
    })
  );
});
Deno.test("P3 transport contains only explicit client scope, attestation and CSV mapping; no task or model", async () => {
  const calls: Record<string, unknown>[] = [];
  const c = new ImportPreview(A, async (body) => {
    calls.push(body);
    return packet();
  }, () => true);
  await c.run("preview", "Company\nSynthetic", { Company: "company_name" });
  assertEquals(calls[0].workspace_id, A.workspace_id);
  assertEquals(calls[0].approved_existing_leads, true);
  assertEquals(calls[0].task_id, undefined);
  assertEquals(calls[0].model, undefined);
  c.stop();
  await assertRejects(() => c.run("preview", "x", {}));
  assertEquals(calls.length, 1);
});
for (
  const name of [
    "switch",
    "logout",
    "A-B-A",
    "newer-request",
    "expired-before-file-read",
  ] as const
) {
  Deno.test(`P3 stale preview suppressed: ${name}`, async () => {
    let current = true, resolve!: (v: unknown) => void;
    const c = new ImportPreview(A, () =>
      new Promise((r) => {
        resolve = r;
      }), () => current);
    if (name === "expired-before-file-read") {
      current = false;
      await assertRejects(() => c.run("inspect", "x"));
      return;
    }
    const pending = c.run("preview", "x", {});
    const rejected = assertRejects(() => pending);
    if (name === "newer-request") {
      const oldResolve = resolve;
      const second = c.run("inspect", "y");
      resolve({ ...packet(A, "inspect"), rows: undefined });
      await second;
      oldResolve(packet());
    } else {
      current = false;
      if (name === "logout" || name === "A-B-A") c.stop();
      resolve(packet());
    }
    await rejected;
  });
}
Deno.test("P3 foreign envelope, foreign row and wrong action refused", () => {
  for (
    const raw of [
      packet(B),
      { ...packet(), rows: [{ ...B }] },
      packet(A, "inspect"),
      null,
      { ...packet(), rows: [null] },
    ]
  ) assertThrows(() => validatePreview(raw, A, "preview"));
});
Deno.test("P3 UI restricted to isolated gated route, no confirm/import persistence/export", async () => {
  const page = await Deno.readTextFile("src/pages/OutpostWorkspace.tsx"),
    ui = await Deno.readTextFile(
      "src/components/leads/pilot/ExistingLeadImport.tsx",
    );
  assert(page.includes("VITE_OUTPOST_PILOT_CSV_PREVIEW_ENABLED === 'true'"));
  assert(page.includes("state.revision}`"));
  assert(ui.includes("controller.stop()"));
  assert(
    !/from\(|\.insert\(|\.upsert\(|createTask|fetch\(|localStorage|sessionStorage/
      .test(ui),
  );
  assert(ui.includes("These are approved existing leads"));
  assert(ui.includes("setResult(null)"));
});

Deno.test("P3 React StrictMode setup-cleanup-setup permits new preview while rejecting old replies", async () => {
  let resolve!: (v: unknown) => void;
  let delayed = true;
  const c = new ImportPreview(
    A,
    async () =>
      delayed
        ? await new Promise((r) => {
          resolve = r;
        })
        : packet(),
    () => true,
  );
  c.start();
  const pending = c.run("preview", "x", {});
  const rejected = assertRejects(() => pending);
  c.stop();
  c.start();
  delayed = false;
  await c.run("preview", "y", {});
  resolve(packet());
  await rejected;
});
