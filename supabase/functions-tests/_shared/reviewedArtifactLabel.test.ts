// THE SUMMARY MUST NAME WHAT WAS ACTUALLY REVIEWED.
//
// Production task bb1ce7fe reported "20 profiles reviewed" when all 20 artifacts
// were JOB POSTINGS and no profile was ever fetched — the run died at the source
// location gate, before people search. Saying "profiles" told the user we had
// looked at 20 founders and rejected them, which is the opposite of what
// happened and pointed the diagnosis at the wrong stage entirely.
//
// PURE. No provider, model, network or database access.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reviewedArtifactNoun, reviewedArtifactLabel, buildOutcomeReport, buildProcessNarrative } from "../../functions/_shared/sourceQuality.ts";

const counts = (raw: number, accepted = 0) => ({
  raw_result_count: raw, accepted_count: accepted, rejected_count: raw - accepted,
  duplicate_count: 0, persisted_count: accepted, requested_count: 5,
  reject_reason_counts: {}, status: (accepted > 0 ? "partial" : "failed") as "partial" | "failed",
});

Deno.test("A1 the noun follows the artifact type", () => {
  assertEquals(reviewedArtifactNoun("job_signal"), "job result");
  assertEquals(reviewedArtifactNoun("hiring_signal"), "job result");
  assertEquals(reviewedArtifactNoun("company_accounts"), "company");
  assertEquals(reviewedArtifactNoun("people_profiles"), "profile");
  assertEquals(reviewedArtifactNoun("contacts"), "profile");
});

Deno.test("A2 an unknown or missing artifact type stays NEUTRAL", () => {
  for (const t of [null, undefined, "", "something_new", "mixed"]) {
    assertEquals(reviewedArtifactNoun(t), "result", `${String(t)} should be neutral`);
  }
});

Deno.test("A3 pluralization is correct, including 'companies'", () => {
  assertEquals(reviewedArtifactLabel(20, "job_signal"), "20 job results");
  assertEquals(reviewedArtifactLabel(1, "job_signal"), "1 job result");
  assertEquals(reviewedArtifactLabel(20, "company_accounts"), "20 companies");
  assertEquals(reviewedArtifactLabel(1, "company_accounts"), "1 company");
  assertEquals(reviewedArtifactLabel(20, "people_profiles"), "20 profiles");
  assertEquals(reviewedArtifactLabel(1, "people_profiles"), "1 profile");
  assertEquals(reviewedArtifactLabel(20, null), "20 results");
});

Deno.test("A4 the production line now reads '20 job results reviewed'", () => {
  const report = buildOutcomeReport({ counts: counts(20), requested: 5, source_type: "job_signal" });
  const line = report.quality_lines[0];
  assertEquals(line, "Scout reviewed 20 job results.");
  assertEquals(line.includes("profile"), false, "job artifacts must never be called profiles");
});

Deno.test("A5 the process narrative agrees with the outcome report", () => {
  const lines = buildProcessNarrative({
    actor_label: "the jobs actor", counts: counts(20), attempt_labels: ["a"],
    entity_label: "accounts", aria_ran: false, source_type: "job_signal",
  });
  const reviewed = lines.filter((l) => l.includes("reviewed"));
  assertEquals(reviewed.length > 0, true);
  for (const l of reviewed) {
    assertEquals(l.includes("job result"), true, `expected job-result wording: ${l}`);
    assertEquals(l.includes("profile"), false, `must not say profiles: ${l}`);
  }
});

Deno.test("A6 omitting the artifact type keeps the previous neutral wording", () => {
  // Callers that have not been threaded yet must not regress into a wrong noun.
  const report = buildOutcomeReport({ counts: counts(20), requested: 5 });
  assertEquals(report.quality_lines[0], "Scout reviewed 20 results.");
});

Deno.test("A7 qualification behavior is untouched by the label", () => {
  const a = buildOutcomeReport({ counts: counts(20, 3), requested: 5, source_type: "job_signal" });
  const b = buildOutcomeReport({ counts: counts(20, 3), requested: 5, source_type: "people_profiles" });
  assertEquals(a.status, b.status);
  assertEquals(a.next_actions, b.next_actions);
});

Deno.test("A8 run-agent threads source_type into the outcome report", async () => {
  // The label helper is only useful if the ONE real caller passes the artifact
  // type. Without this the production line silently falls back to "20 results",
  // which is neutral but not the fix that was asked for.
  const src = await Deno.readTextFile(new URL("../run-agent/index.ts", import.meta.url));
  const call = /buildOutcomeReport\(\{[^}]*\}\)/.exec(src)?.[0] ?? "";
  assertEquals(call.includes("source_type"), true, `buildOutcomeReport must receive source_type: ${call}`);
});
