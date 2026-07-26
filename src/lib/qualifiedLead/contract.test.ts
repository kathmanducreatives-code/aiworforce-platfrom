// PART 1 — the workflow preview renders from the CONTRACT, never the title.
// PART 11 boundary — the Start Workflow payload.
// ZERO network, ZERO model calls.

import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildWorkflowPreview, buildStartWorkflowPayload, isQualifiedLeadPayload,
  previewStrings, FORBIDDEN_PREVIEW_TERMS, type QualifiedLeadContract,
} from "./contract.ts";

const TARGET = "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";

export const TARGET_CONTRACT: QualifiedLeadContract = {
  workflow_kind: "qualified_lead_sourcing",
  execution_mode: "company_first",
  target_entity: "company_and_person",
  signal_type: "hiring",
  job_family: "sales_operations",
  job_titles: ["Sales Operations", "Revenue Operations", "GTM Operations"],
  company_vertical: "b2b_saas",
  company_stage: "startup_or_small_team",
  geography: ["United States"],
  requested_person_roles: ["Founder", "Co-Founder", "CEO"],
  current_employer_required: true,
  requested_lead_count: 5,
  count_entity: "contact_ready_lead",
  quota_policy: "contact_only",
  original_instruction: TARGET,
};

Deno.test("PART 1: the preview matches the required copy exactly", () => {
  const p = buildWorkflowPreview(TARGET_CONTRACT);
  assertEquals(p.title, "Find founders at SaaS startups hiring Sales Operations");
  assertEquals(p.target, "5 CONTACT-ready leads");
  assertEquals(p.hiringRoles, ["Sales Operations", "Revenue Operations", "GTM Operations"]);
  assertEquals(p.decisionMakers, ["Founder", "Co-Founder", "CEO"]);
  assertEquals(p.companyConstraints, ["B2B SaaS", "Startup / small team", "United States"]);
  assertEquals(p.executionMode, "Company-first qualified lead sourcing");
  assertEquals(p.output, "Qualified company + verified decision-maker leads in Workbench");
});

Deno.test("PART 1: the preview never shows SDR/BDR/AE, fast mode or account opportunities", () => {
  const rendered = previewStrings(buildWorkflowPreview(TARGET_CONTRACT)).join(" | ").toLowerCase();
  for (const bad of FORBIDDEN_PREVIEW_TERMS) {
    assertFalse(rendered.includes(bad.toLowerCase()), `preview leaked "${bad}"`);
  }
  // "5" must never be presented as accounts or bare results.
  assertFalse(/\b5 (accounts?|results?|companies)\b/.test(rendered), rendered);
});

Deno.test("PART 1: the title is built from contract fields, not the workflow_name", () => {
  // A deliberately WRONG generated title must not reach the preview.
  const p = buildWorkflowPreview({ ...TARGET_CONTRACT });
  const payload = {
    workflow_name: "Find SDR hiring-signal accounts",   // the corrupted title
    qualified_lead_contract: TARGET_CONTRACT,
  };
  assert(isQualifiedLeadPayload(payload));
  assertFalse(p.title.toLowerCase().includes("sdr"));
  assertStringIncludes(p.title, "Sales Operations");
});

Deno.test("PART 1: a singular quota reads 'lead', not 'leads'", () => {
  const p = buildWorkflowPreview({ ...TARGET_CONTRACT, requested_lead_count: 1 });
  assertEquals(p.target, "1 CONTACT-ready lead");
});

Deno.test("isQualifiedLeadPayload rejects an inconsistent contract", () => {
  assertFalse(isQualifiedLeadPayload({ qualified_lead_contract: null }));
  assertFalse(isQualifiedLeadPayload({
    qualified_lead_contract: { ...TARGET_CONTRACT, quota_policy: "account_only" } as never,
  }));
});

// ---- Start Workflow payload -----------------------------------------------

Deno.test("PART 11 #1: Start Workflow sends the ORIGINAL request, not a rebuilt title", () => {
  const payload = {
    workflow_id: "find_qualified_leads",
    workflow_name: "Find founders at SaaS companies hiring Sales / Revenue Operations",
    original_instruction: TARGET,
    qualified_lead_contract: TARGET_CONTRACT,
    inputs: { count: 5 },
  };
  const out = buildStartWorkflowPayload(payload, { count: 5, location: "United States" });

  assertEquals(out.text, TARGET);
  assertFalse(out.text.startsWith("Run workflow:"), "the title reconstruction is gone");
  assertEquals(out.metadata.workflow_kind, "qualified_lead_sourcing");
  assertEquals(out.metadata.execution_mode, "company_first");
  assertEquals(out.metadata.requested_lead_count, 5);
  assertEquals(out.metadata.quota_policy, "contact_only");
  assertEquals(out.metadata.count_entity, "contact_ready_lead");
  assertEquals(out.metadata.job_family, "sales_operations");
  assertEquals(out.metadata.selected_actor_key, "apify_jobs");
  assertEquals(out.metadata.qualified_lead_contract, TARGET_CONTRACT);
});

Deno.test("PART 11 #4: the Start Workflow payload carries no SDR/BDR/AE title", () => {
  const out = buildStartWorkflowPayload(
    { original_instruction: TARGET, qualified_lead_contract: TARGET_CONTRACT },
    {},
  );
  const blob = JSON.stringify(out).toLowerCase();
  for (const bad of ["sdr", "bdr", "account executive", "founding ae"]) {
    assertFalse(blob.includes(bad), `Start Workflow payload leaked "${bad}"`);
  }
});

Deno.test("an account-only payload keeps account shape and invents no lead quota", () => {
  const out = buildStartWorkflowPayload(
    {
      workflow_id: "find_hiring_signal_accounts",
      workflow_name: "Find GTM / Sales hiring-signal accounts",
      original_instruction: "Find five SaaS companies with sales hiring signals.",
      qualified_lead_contract: null,
      inputs: { count: 5 },
    },
    { count: 5 },
  );
  assertEquals(out.text, "Find five SaaS companies with sales hiring signals.");
  assertEquals(out.metadata.workflow_kind, "account_opportunity_sourcing");
  assertEquals(out.metadata.execution_mode, "fast");
  assertEquals(out.metadata.count_entity, "account");
  assertEquals(out.metadata.requested_lead_count, undefined);
  assertEquals(out.metadata.quota_policy, undefined);
});
