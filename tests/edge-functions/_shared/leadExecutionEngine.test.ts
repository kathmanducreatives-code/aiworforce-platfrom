// The execution-engine flag is SAFE BY DEFAULT: with no allowlist every mission
// resolves to v1_edge, so V2 is disabled until a workspace is named explicitly.

import { assertEquals, assertFalse, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveLeadExecutionEngine, v2Enabled, v2WorkspaceAllowlist, LEAD_V2_WORKSPACES_ENV,
  clampWorkerCeilingMs, LEAD_WORKER_DEFAULT_RUNTIME_MS, LEAD_WORKER_MAX_RUNTIME_CAP_MS,
  type EnvReader,
} from "../../../supabase/functions/_shared/leadExecutionEngine.ts";

const reader = (val: string | undefined): EnvReader => (k) => (k === LEAD_V2_WORKSPACES_ENV ? val : undefined);

Deno.test("default (unset env): V2 disabled, every workspace is v1_edge", () => {
  const read = reader(undefined);
  assertFalse(v2Enabled(read));
  assertEquals(resolveLeadExecutionEngine("ws-anything", read), "v1_edge");
  assertEquals(resolveLeadExecutionEngine(null, read), "v1_edge");
});

Deno.test("empty / whitespace allowlist: still disabled", () => {
  for (const v of ["", "   ", " , , "]) {
    const read = reader(v);
    assertFalse(v2Enabled(read));
    assertEquals(v2WorkspaceAllowlist(read).size, 0);
    assertEquals(resolveLeadExecutionEngine("ws-1", read), "v1_edge");
  }
});

Deno.test("allowlisted workspace is v2_worker; everything else stays v1_edge", () => {
  const read = reader("ws-internal-A, ws-internal-B");
  assert(v2Enabled(read));
  assertEquals(resolveLeadExecutionEngine("ws-internal-A", read), "v2_worker");
  assertEquals(resolveLeadExecutionEngine("ws-internal-B", read), "v2_worker");
  assertEquals(resolveLeadExecutionEngine("ws-customer-X", read), "v1_edge");
  assertEquals(resolveLeadExecutionEngine(null, read), "v1_edge");
});

Deno.test("worker ceiling: unusable values default, large values are capped under the credit-release window", () => {
  for (const bad of [undefined, null, "", "abc", 0, -5, Number.NaN]) {
    assertEquals(clampWorkerCeilingMs(bad as never), LEAD_WORKER_DEFAULT_RUNTIME_MS);
  }
  assertEquals(clampWorkerCeilingMs(120_000), 120_000);
  assertEquals(clampWorkerCeilingMs("240000"), 240_000);
  assertEquals(clampWorkerCeilingMs(24 * 60 * 60_000), LEAD_WORKER_MAX_RUNTIME_CAP_MS);
  // Reservations are released after 30 minutes; the cap must stay well inside it.
  assert(LEAD_WORKER_MAX_RUNTIME_CAP_MS < 30 * 60_000);
  assert(LEAD_WORKER_DEFAULT_RUNTIME_MS > 150_000, "the default must actually exceed the edge wall clock");
});
