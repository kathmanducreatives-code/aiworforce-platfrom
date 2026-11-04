// P8 — the TEST smoke proves which interpretation contract the RUNNING service used.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { understandingCheck } from "../../scripts/deploy/test-functions-smoke.ts";
import { understandingReport } from "../../supabase/functions/_shared/leadPipeline/service.ts";
import { compilePhrasing, loadCases } from "../../scripts/dev/interpretation-corpus.ts";

const phrasing = loadCases().find((c) => c.id === "M07")!.phrasings[0]; // AEs but not SDRs
const body = (u: unknown) => ({ interpretation: { understanding: u } }) as never;

Deno.test("report: a v3 compile carries the validated understanding and frozen criteria", () => {
  const r = understandingReport(compilePhrasing(phrasing, "v3"), "v3");
  assertEquals([r.version, r.freeze, r.rejected, r.ambiguities], ["mission-understanding-v1", "frozen", 0, 0]);
  assertEquals(r.roles, 2, "AE required, SDR excluded");
  assertEquals(understandingCheck(body(r)).status, "pass");
});

Deno.test("report: a v1 compile has no understanding, and P8 passes for v1", () => {
  const r = understandingReport(compilePhrasing(phrasing, "v1"), "v1");
  assertEquals([r.version, r.freeze], [null, "frozen"]);
  assertEquals(understandingCheck(body(r)).status, "pass");
});

Deno.test("P8 fails when v3 is configured but no understanding was applied", () => {
  const r = understandingReport(compilePhrasing(phrasing, "v1"), "v3");
  assertEquals(understandingCheck(body(r)).status, "fail");
});

Deno.test("P8 fails when the criteria are not frozen, or when the build predates the report", () => {
  assertEquals(understandingCheck(body({ contract: "v1", version: null, roles: 0, places: 0, signals: 0, rejected: 0, ambiguities: 0, freeze: "void" })).status, "fail");
  assertEquals(understandingCheck({ interpretation: {} } as never).status, "fail");
});
