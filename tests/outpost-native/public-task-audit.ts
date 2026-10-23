// Intentionally FAILS until the coordinated public-table authorization gap closes.
// Run through the disposable runner with OUTPOST_NATIVE_PUBLIC_AUDIT=1.
// deno-lint-ignore no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { api, fixture, jwt } from "./fixture.ts";
import { closeHarness } from "../db-contract/lib/harness.ts";
try {
  const x = await fixture(), viewer = await jwt(x.viewer, x.sv);
  const owner = await jwt(x.ua, x.sa);
  const positive = await api(
    owner.token,
    `tasks?id=eq.${x.ta}&select=id`,
    "GET",
    undefined,
    "public",
  );
  assertEquals(positive.status, 200);
  assertEquals(
    positive.body.length,
    1,
    "denying every task is not an authorization fix",
  );
  const privateRead = await api(viewer.token, "task_bindings");
  const legacyRead = await api(
    viewer.token,
    `tasks?id=eq.${x.ta}&select=id,payload`,
    "GET",
    undefined,
    "public",
  );
  const secure = legacyRead.status === 403 ||
    (legacyRead.status === 200 && Array.isArray(legacyRead.body) &&
      legacyRead.body.length === 0);
  console.log(
    JSON.stringify(
      {
        gate: "public_pilot_task_direct_api",
        expected: "viewer denied bound pilot task",
        actual_http: legacyRead.status,
        visible_rows: Array.isArray(legacyRead.body)
          ? legacyRead.body.length
          : null,
        private_metadata_visible: Array.isArray(privateRead.body)
          ? privateRead.body.length
          : null,
        verdict: secure ? "PASS" : "FAIL",
        customer_pilot_ready: false,
        owner_dependency:
          "existing public tasks permissions / legacy containment; no shared policy rewrite in this slice",
      },
      null,
      2,
    ),
  );
  if (!secure) Deno.exitCode = 1;
} finally {
  await closeHarness();
}
