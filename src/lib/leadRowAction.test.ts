import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveRowAction, unwrapLeadRaw, companyDisplayLinks } from "./leadRowAction.ts";

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

// Part J #7 — running → success
Deno.test("research_company enriched → success with summary detail", () => {
  const a = deriveRowAction("research_company", { success: true, per_lead: [{}] },
    { status: "enriched", summary_lines: ["Summary: Acme builds robots", "Confidence: medium"] });
  assertEquals(a.state, "success");
  assert(/Acme builds robots/.test(a.detail ?? ""));
});

Deno.test("research_company blocked no website → empty 'Blocked: no website'", () => {
  const a = deriveRowAction("research_company", { success: true, per_lead: [{}] },
    { status: "blocked", blocked_reason: "no company website/domain — enrichment blocked" });
  assertEquals(a.state, "empty");
  assertEquals(a.detail, "Blocked: no website");
});

// Part J #8 — running → empty for no decision-maker
Deno.test("find_decision_makers needs_manual_review → empty (No verified decision-maker)", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { needs_manual_review: true, decision_makers: [] });
  assertEquals(a.state, "empty");
});

Deno.test("find_decision_makers verified → success with recipient detail", () => {
  const a = deriveRowAction("find_decision_makers", { success: true, per_lead: [{}] },
    { needs_manual_review: false, decision_makers: [{ name: "Jane Doe", title: "CEO" }] });
  assertEquals(a.state, "success");
  assert(/Jane Doe · CEO/.test(a.detail ?? ""));
});

// Part J #10 — outreach without verified contact
Deno.test("generate_outreach insufficient → insufficient_context with missing", () => {
  const a = deriveRowAction("generate_outreach", { success: true, per_lead: [{}] },
    { status: "insufficient_context", missing_context: ["recipient_or_company_context"] });
  assertEquals(a.state, "insufficient_context");
  assert(/recipient_or_company_context/.test(a.detail ?? ""));
});

Deno.test("generate_outreach draft → success 'Draft ready for approval'", () => {
  const a = deriveRowAction("generate_outreach", { success: true, per_lead: [{}] },
    { status: "draft_needs_approval", recipient: "Jane Doe" });
  assertEquals(a.state, "success");
  assertEquals(a.detail, "Draft ready for approval");
});

Deno.test("hard failure (no per_lead) → error", () => {
  const a = deriveRowAction("research_company", { success: false, error: "run_agent_failed" }, {});
  assertEquals(a.state, "error");
  assertEquals(a.detail, "run_agent_failed");
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
