// VISIBILITY IS NOT QUALIFICATION.
//
// TEST plan edb4cbf6-909a-467b-b5bd-65b1d3fbbcda discovered 20 YC rows, qualified
// ZERO companies (`qualified_company_keys: []`), and the Workbench reported
// "Accounts found: 20 / Qualified companies: 20". Two independent fail-open
// defects produced that:
//
//   * `memoryWriter` published raw discovery rows alongside the capability
//     engine, with no verdict, no fit score and no evidence.
//   * `resolveQualification` treated the absence of a rejection as a pass, and
//     the counter asked `level !== 'not_qualified'`.
//
// Either alone would have been enough to invent 20 qualified companies.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isExplicitlyQualified, resolveQualification,
  type QualificationRecord,
} from "../../../src/lib/qualifiedLead/qualification.ts";
import { buildWorkbenchCounts } from "../../../src/lib/qualifiedLead/workbenchCounts.ts";

/** One raw discovery row exactly as memoryWriter used to publish it. */
const RAW_DISCOVERY_ROW: QualificationRecord = {
  quota_eligible: null,
  disposition: null,
  verdict: null,
  decision_maker_status: null,
  employer_match_status: null,
  gate_decision: null,
  analyst_verdict: null,
  contact_status: null,
  fit_score: null,
  fit_tier: null,
};

const count = (key: string, rows: QualificationRecord[]) =>
  buildWorkbenchCounts({ rows: rows as never, progress: null })
    .find((c) => c.key === key)?.value;

// ══════════════════════════ 1. one persistence authority per run ══

Deno.test("1. a LeadMission run has exactly ONE persistence writer", async () => {
  const writer = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/memoryWriter.ts", import.meta.url));
  const registry = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
  const runAgent = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));

  assert(writer.includes('if (ctx.persistence_authority === "capability_engine") {'),
    "the legacy writer must refuse to publish when the engine owns persistence");
  assert(writer.includes('persistence_authority?: "capability_engine" | "legacy" | null;'),
    "the authority is an explicit typed field");
  assert(registry.includes("persistence_authority:"),
    "runTool must forward the declared authority");
  assertEquals(
    (runAgent.match(/persistence_authority: "capability_engine" as const,/g) ?? []).length, 2,
    "BOTH engine invocation sites must declare the engine as the authority");
});

Deno.test("2. the authority is declared, never inferred from data shape", async () => {
  const writer = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/memoryWriter.ts", import.meta.url));
  // The guard reads the explicit field and nothing else.
  const guard = writer.slice(
    writer.indexOf("ONE PERSISTENCE AUTHORITY PER RUN"),
    writer.indexOf('if (tool === "source_with_apify")'));
  assert(guard.includes("ctx.persistence_authority"));
  for (const inferred of ["lead_mission", "mission_authority", "openJobs", "yc"]) {
    assertFalse(guard.includes(inferred),
      `the guard must not sniff ${inferred} — authority is declared`);
  }
});

Deno.test("3. legacy workflows keep the legacy writer", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/toolRegistry.ts", import.meta.url));
  assert(registry.includes('? "capability_engine" as const') && registry.includes(': "legacy" as const'),
    "anything that does not declare the engine stays on the legacy path");
});

// ══════════════════════════════════ 4. qualification fails closed ══

Deno.test("4. a null verdict resolves to not_evaluated, never a pass", () => {
  const r = resolveQualification(RAW_DISCOVERY_ROW);
  assertEquals(r.level, "not_evaluated");
  assertEquals(r.qualified, false);
  assertEquals(r.evaluated, false);
  assertEquals(r.quotaCredit, 0);
  assertEquals(r.contactReady, false);
  assertEquals(r.decidedBy, "no_qualification_evidence");
  // The exact expression that caused the defect must no longer imply qualified.
  assert(r.level !== "not_qualified",
    "it is genuinely not 'not_qualified' — which is why that test was wrong");
  assertFalse(r.qualified, "and it is still NOT qualified");
});

Deno.test("5. a missing fit score cannot qualify anything", () => {
  assertFalse(isExplicitlyQualified({ ...RAW_DISCOVERY_ROW }));
  assertFalse(isExplicitlyQualified({ ...RAW_DISCOVERY_ROW, fit_score: 92 }),
    "a high fit score is descriptive context, never a verdict");
  assertFalse(isExplicitlyQualified({ ...RAW_DISCOVERY_ROW, fit_tier: "excellent" }));
});

Deno.test("6. only an EXPLICIT positive verdict qualifies", () => {
  assert(isExplicitlyQualified({ quota_eligible: true }));
  assert(isExplicitlyQualified({ disposition: "contact" }));
  assert(isExplicitlyQualified({ verdict: "qualified" }));
  assert(isExplicitlyQualified({ gate_decision: "accept" }));

  // Explicit rejections stay rejections.
  for (const d of ["reject", "rejected", "skip", "skipped"]) {
    assertFalse(isExplicitlyQualified({ verdict: d }), `${d} must not qualify`);
    assertEquals(resolveQualification({ verdict: d }).level, "not_qualified");
    assertEquals(resolveQualification({ verdict: d }).qualified, false);
  }
  assertFalse(isExplicitlyQualified({ quota_eligible: false }));
});

// ═══════════════════════════════ 7/8. the counters stay separate ══

Deno.test("7. 20 discovered / 0 evaluated / 0 qualified — the real failing run", () => {
  const rows = Array.from({ length: 20 }, () => ({ ...RAW_DISCOVERY_ROW }));

  assertEquals(count("accounts_found", rows), 20, "discovery is still reported honestly");
  assertEquals(count("evaluated", rows), 0, "nothing judged these rows");
  assertEquals(count("qualified_companies", rows), 0,
    "this read 20 before the fix, for a run whose qualified_company_keys was empty");
  assertEquals(count("decision_makers_verified", rows), 0);
  assertEquals(count("contact_ready", rows), 0);
});

Deno.test("8. Accounts found and Qualified companies are independent", () => {
  const rows: QualificationRecord[] = [
    { ...RAW_DISCOVERY_ROW },                                   // untouched
    { ...RAW_DISCOVERY_ROW, verdict: "rejected" },              // explicitly out
    { ...RAW_DISCOVERY_ROW, quota_eligible: true,
      decision_maker_status: "verified", disposition: "contact" }, // explicitly in
  ];
  assertEquals(count("accounts_found", rows), 3);
  assertEquals(count("evaluated", rows), 2, "the untouched row was never evaluated");
  assertEquals(count("qualified_companies", rows), 1, "exactly one explicit pass");
});

Deno.test("9. the capability engine's qualified set is the authority when present", () => {
  const rows = Array.from({ length: 20 }, () => ({
    ...RAW_DISCOVERY_ROW, quota_eligible: true, disposition: "contact",
  }));
  // Rows claim 20; the engine reports 0. The engine wins.
  const counts = buildWorkbenchCounts({
    rows: rows as never,
    progress: { qualifiedCompanies: 0, verifiedDecisionMakers: 0, eligible: 0, remaining: 5 } as never,
  });
  assertEquals(counts.find((c) => c.key === "qualified_companies")?.value, 0);
  assertEquals(counts.find((c) => c.key === "accounts_found")?.value, 20);
});

Deno.test("10. the defective condition is gone from the counter", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../src/lib/qualifiedLead/workbenchCounts.ts", import.meta.url));
  // Assert on CODE, not on the comment that quotes the old expression.
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assertFalse(/filter\(\(q\) => q\.level !== 'not_qualified'\)/.test(code),
    "`level !== not_qualified` counted rows nothing had looked at");
  assert(src.includes("resolved.filter((q) => q.qualified).length"),
    "the counter must require an explicit positive verdict");
  assert(src.includes("q.evaluated"), "Evaluated must be its own counter");
});

// ═══════════════════════ 11. Find decision-makers is fail-closed ══

Deno.test("11. Workbench direct action cannot bypass the people gate", async () => {
  const { recommendNextAction, isRecommendationDispatchable, peopleSearchEligibleRows } =
    await import("../../../src/components/chat/workspace/workbench/leadTable/credits.ts");

  // The 20 unqualified rows from the failing run.
  const unqualified = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`, lead_candidate_id: `lc${i}`,
    domain_status: "ok", contact_status: "needs_contact",
  })) as never[];

  assertEquals(peopleSearchEligibleRows(unqualified).length, 0);
  const rec = recommendNextAction(unqualified);
  assertEquals(rec.action, "find_contacts");
  assertEquals(rec.enabled, false);
  assertEquals(rec.unmet_prerequisite, "no_qualified_companies_ready_for_people_search");
  assertEquals(rec.estimated_credits, 0, "a blocked action must cost nothing");
  assertFalse(isRecommendationDispatchable(rec), "the panel must not be able to dispatch it");
});

Deno.test("12. an explicitly REJECTED task cannot start a people search", async () => {
  const { recommendNextAction, isRecommendationDispatchable } =
    await import("../../../src/components/chat/workspace/workbench/leadTable/credits.ts");

  // Exactly how the invalidated rows were marked in TEST.
  const rejected = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`, lead_candidate_id: `lc${i}`,
    domain_status: "ok", contact_status: "needs_contact",
    verdict: "REJECT", disposition: "rejected",
    quota_eligible: false, gate_decision: "reject",
  })) as never[];

  const rec = recommendNextAction(rejected);
  assertFalse(isRecommendationDispatchable(rec));
  assertEquals(rec.unmet_prerequisite, "no_qualified_companies_ready_for_people_search");
});

Deno.test("13. a genuinely qualified company DOES unblock the action", async () => {
  const { peopleSearchEligibleRows } =
    await import("../../../src/components/chat/workspace/workbench/leadTable/credits.ts");

  const mixed = [
    { id: "a", lead_candidate_id: "a", domain_status: "ok", contact_status: "needs_contact" },
    { id: "b", lead_candidate_id: "b", domain_status: "ok", contact_status: "needs_contact",
      quota_eligible: true, disposition: "contact" },
  ] as never[];

  const eligible = peopleSearchEligibleRows(mixed);
  assertEquals(eligible.length, 1, "only the explicitly qualified company is searchable");
  assertEquals((eligible[0] as { id: string }).id, "b");
});
