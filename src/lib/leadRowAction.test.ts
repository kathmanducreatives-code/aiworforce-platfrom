import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveRowAction, rowActionCopy, unwrapLeadRaw, companyDisplayLinks, rowsForExport } from "./leadRowAction.ts";
import { isRetryableStatus } from "./leadActionOutcome.ts";

// Part 7 — CSV export never headers-only when rows are visible.
Deno.test("rowsForExport: no selection → visible rows; selection → selected rows", () => {
  const visible = [{ id: "a" }, { id: "b" }];
  assertEquals(rowsForExport([], visible).length, 2);              // visible when no selection
  assertEquals(rowsForExport([{ id: "b" }], visible).map((r) => r.id), ["b"]); // selection wins
  assertEquals(rowsForExport([], []).length, 0);                   // truly empty stays empty
});

// Display mapping (Issue 1): both website AND LinkedIn are exposed as links.
Deno.test("companyDisplayLinks exposes both website and company LinkedIn", () => {
  const l = companyDisplayLinks({ website: "https://flatpay.com/", company_linkedin_url: "https://www.linkedin.com/company/flatpay" });
  assertEquals(l.website, "https://flatpay.com/");
  assertEquals(l.websiteHost, "flatpay.com");
  assertEquals(l.linkedinUrl, "https://www.linkedin.com/company/flatpay");
});
Deno.test("companyDisplayLinks: LinkedIn shows even when website missing; empties → null", () => {
  const a = companyDisplayLinks({ website: null, company_linkedin_url: "https://www.linkedin.com/company/x" });
  assertEquals(a.website, null);
  assertEquals(a.linkedinUrl, "https://www.linkedin.com/company/x");
  const b = companyDisplayLinks({ website: "", company_linkedin_url: "" });
  assertEquals(b.website, null);
  assertEquals(b.linkedinUrl, null);
});

// Row states now read the CANONICAL status the backend assigned, rather than
// re-deriving an outcome from provider-shaped fields.
Deno.test("research_company succeeded → succeeded with summary detail", () => {
  const a = deriveRowAction("research_company", { success: true, per_lead: [{}] },
    { status: "succeeded", reason_code: "company_enriched", summary_lines: ["Summary: Acme builds robots", "Confidence: medium"] });
  assertEquals(a.status, "succeeded");
  assert(/Acme builds robots/.test(a.detail ?? ""));
});

Deno.test("research_company missing identity → distinct status + copy", () => {
  const a = deriveRowAction("research_company", { success: true, per_lead: [{}] },
    { status: "missing_company_identity", reason_code: "company_domain_missing" });
  assertEquals(a.status, "missing_company_identity");
  assertEquals(a.reason_code, "company_domain_missing");
  assertEquals(rowActionCopy(a), "Verify the company domain or LinkedIn page first");
});

Deno.test("find_decision_makers no_match is an ANSWER, not a crash", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "no_match", reason_code: "provider_no_results", decision_makers: [] });
  assertEquals(a.status, "no_match");
  assertEquals(rowActionCopy(a), "No verified founder or GTM leader found");
});

Deno.test("find_decision_makers unavailable → provider-disabled copy, not failure", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "unavailable", reason_code: "people_search_disabled" });
  assertEquals(a.status, "unavailable");
  assertEquals(rowActionCopy(a), "People search is disabled in this environment");
});

Deno.test("find_decision_makers needs_manual_review is distinct from no_match", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "needs_manual_review", reason_code: "employment_unverified" });
  assertEquals(a.status, "needs_manual_review");
  assertEquals(rowActionCopy(a), "Profiles were found but current employment could not be verified");
});

Deno.test("find_decision_makers timed_out is distinct and retryable", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "timed_out", reason_code: "provider_timed_out" });
  assertEquals(a.status, "timed_out");
  assertEquals(rowActionCopy(a), "Decision-maker search timed out");
  assert(isRetryableStatus(a.status));
});

Deno.test("find_decision_makers succeeded → recipient detail (legacy alias shape)", () => {
  // A displayable decision-maker needs a contact link: decidePersistence rejects
  // invalid_profile_url, so a verified person always has one. Legacy name/title
  // aliases still map through the display adapter.
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "succeeded", reason_code: "decision_maker_found",
      decision_makers: [{ name: "Jane Doe", title: "CEO", linkedinUrl: "https://www.linkedin.com/in/synthetic-jane" }] });
  assertEquals(a.status, "succeeded");
  assert(/Jane Doe · CEO/.test(a.detail ?? ""));
});

Deno.test("find_decision_makers: a person with NO contact link is a contract error", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { status: "succeeded", decision_makers: [{ name: "Jane Doe", title: "CEO" }] });
  assertEquals(a.status, "failed");
  assertEquals(a.reason_code, "decision_maker_display_contract_invalid");
});

Deno.test("generate_outreach blocked → 'complete the required previous step'", () => {
  const a = deriveRowAction("generate_outreach", { success: true, per_lead: [{}] },
    { status: "blocked", reason_code: "verified_decision_maker_required" });
  assertEquals(a.status, "blocked");
  assertEquals(rowActionCopy(a), "Complete the required previous step first");
});

Deno.test("generate_outreach succeeded → draft ready for approval", () => {
  const a = deriveRowAction("generate_outreach", { success: true, per_lead: [{}] },
    { status: "succeeded", reason_code: "draft_ready_for_approval" });
  assertEquals(a.status, "succeeded");
  assertEquals(rowActionCopy(a), "Draft ready for approval");
});

// THE REGRESSION: a request rejected before execution must NOT look like a lead
// that was examined and found wanting.
Deno.test("pre-execution rejection → request_error, never failed/no_match", () => {
  const a = deriveRowAction("find_decision_makers",
    { success: false, error: "task_insert_failed", message: "Couldn't start the action — try again.", requestError: true }, {});
  assertEquals(a.status, "request_error");
  assertEquals(a.reason_code, "task_insert_failed");
  assertEquals(rowActionCopy(a), "Action request was rejected before execution");
});

Deno.test("hard failure with no per_lead → request_error", () => {
  const a = deriveRowAction("research_company", { success: false, error: "run_agent_failed" }, {});
  assertEquals(a.status, "request_error");
  assertEquals(a.reason_code, "run_agent_failed");
});

// Part J #11 — CSV uses raw.raw fallback (the nesting fix)
Deno.test("unwrapLeadRaw returns the jsonb one level deep (raw.raw)", () => {
  const dbRow = { id: "x", raw: { job_title: "RevOps Lead", company_website: "https://acme.com" } };
  const raw = unwrapLeadRaw(dbRow);
  assertEquals(raw.job_title, "RevOps Lead");
  assertEquals(raw.company_website, "https://acme.com");
});

// Part J #12 — legacy rows (flat / null) don't crash
Deno.test("unwrapLeadRaw tolerates flat, null, and non-object inputs", () => {
  assertEquals(unwrapLeadRaw({ job_title: "flat" }).job_title, "flat"); // no nested .raw → use dbRow
  assertEquals(Object.keys(unwrapLeadRaw(null)).length, 0);
  assertEquals(Object.keys(unwrapLeadRaw(undefined)).length, 0);
  assertEquals(Object.keys(unwrapLeadRaw("str" as unknown)).length, 0);
});
