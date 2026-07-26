// PART 12 — BLAST RADIUS.
//
// Every one of these requests goes through the SAME compiler + route + preview
// path the Sales-Operations fix changed. The table below is the full report:
// family, workflow kind, execution mode, geography, vertical, person roles,
// count entity, preview titles, and whether company-first is selected.
//
// The suite also PRINTS the table, so the report is reproducible rather than
// transcribed by hand.
//
// ZERO network, ZERO provider calls, ZERO model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  routeQualifiedLead, extractRequestedLeadCount,
  normalizeCompanyVertical, inferCompanyStage, contractJobTitles,
} from "../../../supabase/functions/_shared/qualifiedLeadRouting.ts";
import { compileLeadEntityIntent } from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { isCompanyFirstRequest } from "../../../supabase/functions/_shared/runAgentCompoundBridge.ts";
import { classifyRoleFamily, roleFamilyAliases } from "../../../supabase/functions/_shared/roleFamilies.ts";
import { inferFamilyKey, getJobFamily } from "../../../supabase/functions/_shared/jobFamilyRegistry.ts";
import { buildWorkflowPreview, previewStrings, type QualifiedLeadContract } from "./contract.ts";
import { showsFastModeBadge } from "./planCopy.ts";

const QUERIES = [
  "Find companies hiring software engineers.",
  "Find US SaaS companies hiring AI engineers.",
  "Find automation integrators hiring controls engineers in Texas.",
  "Find small manufacturers hiring their first salesperson in Ohio.",
  "Find companies expanding FP&A teams.",
  "Find MSSPs hiring sales leadership.",
];

interface Row {
  query: string;
  family: string | null;
  workflowKind: string;
  executionMode: string;
  geography: string[];
  vertical: string | null;
  personRoles: string[];
  countEntity: string;
  previewTitles: string[];
  companyFirstSelected: boolean;
}

function analyze(query: string): Row {
  const route = routeQualifiedLead(query);
  const intent = compileLeadEntityIntent(query);
  const family = classifyRoleFamily(query);
  const isQL = route.workflowKind === "qualified_lead_sourcing";
  const personRoles = isQL ? (intent.job_search_spec.requested_person_roles ?? ["Founder", "Co-Founder", "CEO"]) : [];

  // Preview titles are exactly what Pilot puts into the contract: the backend
  // registry family when it recognises the request, else the UI aliases.
  const previewTitles = contractJobTitles(
    roleFamilyAliases(family),
    getJobFamily(inferFamilyKey([], [query]))?.exact,
  );

  return {
    query,
    family,
    workflowKind: route.workflowKind,
    executionMode: route.executionMode,
    geography: intent.job_search_spec.location ? [intent.job_search_spec.location] : [],
    vertical: normalizeCompanyVertical(intent.job_search_spec.company_vertical, query),
    personRoles,
    countEntity: route.countEntity,
    previewTitles,
    // What run-agent's own branch guard decides for the compiled intent.
    companyFirstSelected: isCompanyFirstRequest(intent),
  };
}

Deno.test("PART 12: blast-radius report", () => {
  const rows = QUERIES.map(analyze);
  for (const r of rows) {
    console.log(
      `\n${r.query}\n` +
      `  family=${r.family ?? "null"}  workflow_kind=${r.workflowKind}  execution_mode=${r.executionMode}\n` +
      `  geography=${JSON.stringify(r.geography)}  vertical=${r.vertical ?? "null"}\n` +
      `  person_roles=${JSON.stringify(r.personRoles)}  count_entity=${r.countEntity}\n` +
      `  preview_titles=${JSON.stringify(r.previewTitles)}  company_first_selected=${r.companyFirstSelected}`,
    );
  }
  assertEquals(rows.length, 6);
});

Deno.test("PART 12: no request silently acquires Sales-Operations titles", () => {
  for (const r of QUERIES.map(analyze)) {
    if (r.family === "sales_operations") continue;
    const titles = r.previewTitles.join(" ").toLowerCase();
    for (const bad of ["sales operations", "revenue operations", "gtm operations"]) {
      assertFalse(titles.includes(bad), `${r.query} acquired "${bad}"`);
    }
  }
});

Deno.test("PART 12: a first-salesperson request previews commercial sales titles", () => {
  const r = analyze("Find small manufacturers hiring their first salesperson in Ohio.");
  assertEquals(r.family, "gtm_sales", "the UI family is commercial sales");
  // …but the PREVIEW must not offer SDR/BDR to a manufacturer looking for its
  // first revenue hire. The registry family is the precise answer.
  assertEquals(r.previewTitles, ["Sales Representative", "Account Manager", "Territory Sales Manager"]);
  for (const bad of ["SDR", "BDR", "Sales Development Representative"]) {
    assertFalse(r.previewTitles.includes(bad), `previewed ${bad} for a first salesperson`);
  }
});

Deno.test("PART 12: families are stable and the salesperson gap is closed", () => {
  const expected: Array<[string, string | null]> = [
    ["Find companies hiring software engineers.", "engineering"],
    ["Find US SaaS companies hiring AI engineers.", "engineering"],
    ["Find automation integrators hiring controls engineers in Texas.", "engineering"],
    // Was null before Part 10.
    ["Find small manufacturers hiring their first salesperson in Ohio.", "gtm_sales"],
    ["Find companies expanding FP&A teams.", "finance"],
    ["Find MSSPs hiring sales leadership.", "gtm_sales"],
  ];
  for (const [q, fam] of expected) assertEquals(classifyRoleFamily(q), fam, `family drift for: ${q}`);
});

Deno.test("PART 12: none of these six is a qualified-lead request", () => {
  // None names a person to contact or a final lead quota, so all six keep the
  // account workflow — the fix did not widen the qualified-lead route.
  for (const r of QUERIES.map(analyze)) {
    assertEquals(r.workflowKind, "account_opportunity_sourcing", r.query);
    assertEquals(r.executionMode, "fast", r.query);
    assertEquals(r.countEntity, "account_opportunity", r.query);
    assertEquals(r.personRoles, [], `${r.query} invented person roles`);
    assert(showsFastModeBadge(r.workflowKind));
    assertEquals(extractRequestedLeadCount(r.query), null, `${r.query} invented a lead quota`);
  }
});

Deno.test("PART 12: adding a person target flips any of them to company-first", () => {
  // Same six requests, now naming decision-makers: the route must follow the
  // user's words, not the vertical.
  for (const q of QUERIES) {
    const withPeople = q.replace(/^Find /, "Find founders of ").replace(/\.$/, ". Return 5 qualified leads.");
    const r = routeQualifiedLead(withPeople);
    assertEquals(r.workflowKind, "qualified_lead_sourcing", withPeople);
    assertEquals(r.executionMode, "company_first", withPeople);
    assertEquals(r.quotaPolicy, "contact_only", withPeople);
    assertEquals(extractRequestedLeadCount(withPeople), 5, withPeople);
  }
});

Deno.test("PART 12: each family's preview renders without forbidden terms", () => {
  for (const r of QUERIES.map(analyze)) {
    if (r.previewTitles.length === 0) continue;
    const contract: QualifiedLeadContract = {
      workflow_kind: "qualified_lead_sourcing", execution_mode: "company_first",
      target_entity: "company_and_person", job_family: r.family, job_titles: r.previewTitles,
      company_vertical: r.vertical, company_stage: inferCompanyStage(r.query),
      geography: r.geography, requested_person_roles: ["Founder"],
      current_employer_required: true, requested_lead_count: 5,
      count_entity: "contact_ready_lead", quota_policy: "contact_only",
    };
    const rendered = previewStrings(buildWorkflowPreview(contract)).join(" | ").toLowerCase();
    assertFalse(rendered.includes("fast mode"), r.query);
    assertFalse(rendered.includes("account opportunities"), r.query);
    assert(rendered.includes("5 contact-ready leads"), r.query);
  }
});
