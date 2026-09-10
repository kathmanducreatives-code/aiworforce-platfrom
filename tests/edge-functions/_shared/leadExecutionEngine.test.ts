// The execution-engine flag is SAFE BY DEFAULT: with no allowlist every mission
// resolves to v1_edge, so V2 is disabled until a workspace is named explicitly.

import { assertEquals, assertFalse, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveLeadExecutionEngine, v2Enabled, v2WorkspaceAllowlist, LEAD_V2_WORKSPACES_ENV,
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
