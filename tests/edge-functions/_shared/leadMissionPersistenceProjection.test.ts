// THE MISSION → LEAD LIBRARY PROJECTION.
//
// A mission hiring run produced `tasks.result.workbench_*` and nothing else: the
// Workbench could render it, the Lead Library stayed empty. This projection is
// the handoff, and it is deliberately a MAPPING onto the existing
// `companyRowProjection` rather than a second persistence system.
//
// These tests pin what it emits, what it refuses to emit, and that it reuses the
// existing invariants rather than restating them.
//
// Pure. No network, no provider, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  projectMissionCompanyRows, missionPersistenceSummary,
  MISSION_PERSISTENCE_PROJECTION_VERSION,
} from "../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import type { EngineCompany } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

/** A qualified engine company, in the engine's own shape. */
function company(over: Partial<EngineCompany> = {}): EngineCompany {
  const norm = {
    external_source_id: "yc:sortly", company_name: "Sortly",
    canonical_domain: "sortly.com", linkedin_company_url: "https://www.linkedin.com/company/sortly",
    website: "https://sortly.com", description: "B2B SaaS inventory platform.",
    provider_industry: "B2B", industry_ids: [], employee_count: 42,
    employee_range_advisory: null, geography: "United States", company_type: null,
  };
  return {
    key: "https://www.linkedin.com/company/sortly",
    prequal_key: "yc:sortly",
    prequalified: null,
    shortlisted: true,
    company: norm as never,
    identity: {
      company_key: "https://www.linkedin.com/company/sortly",
      status: "verified_match",
      linkedin_company_url: "https://www.linkedin.com/company/sortly",
      evidence: ["domain_match"], ambiguous_candidates: [],
    } as never,
    enriched: norm as never,
    yc_open_jobs: [],
    hiring_jobs: [{
      job_id: "j1", job_url: "https://jobs/1", title: "Revenue Operations Manager",
      company_name: "Sortly", company_linkedin_url: "https://www.linkedin.com/company/sortly",
      company_source_id: null, location: "San Francisco", workplace_mode: null,
      posted_date: "2026-07-20", description: null, source: "linkedin", retrieved_at: null,
      missing_fields: [],
    }] as never,
    fit: null,
    hiring_assessment: null,
    brain: null,
    semantic_parse: null,
    completed_operations: [],
    evidence_registry: null,
    grounded: null,
    classification: null,
    verdict: "pass",
    founders: [],
    verified_founders: [],
    contact_identities: [],
    record: {} as never,
    ...over,
  } as EngineCompany;
}

// ══════════════════════ what reaches the Lead Library ═══════════════════════

Deno.test("a Brain-qualified company becomes an account-type persistence plan", () => {
  const p = projectMissionCompanyRows([company()], "ws-1");
  assertEquals(p.version, MISSION_PERSISTENCE_PROJECTION_VERSION);
  assertEquals(p.rows.length, 1);

  const plan = p.rows[0].plan;
  assertEquals(plan.leadCandidate.lead_type, "account");
  assertEquals(plan.workspaceId, "ws-1");
  assert(plan.persistable, plan.persistenceReason);
  assertEquals(plan.account?.domain, "sortly.com");
  assertEquals(plan.account?.linkedinUrl, "linkedin.com/company/sortly",
    "the canonical LinkedIn form the identity resolver produces");
});

Deno.test("the never-CONTACT invariant is inherited, not restated", () => {
  // A company row can never be CONTACT and never quota-eligible — only a
  // verified person can. The existing projection owns that rule.
  const p = projectMissionCompanyRows([company()], "ws-1");
  const plan = p.rows[0].plan;
  assertFalse(plan.verdict === "CONTACT", "an account row is never CONTACT");
  assertEquals(plan.contact, null, "and carries no person");
  assert(plan.contactBlocked, "the contact ceiling blocks it by construction");
});

Deno.test("the hiring evidence travels with the row", () => {
  const p = projectMissionCompanyRows([company()], "ws-1");
  const raw = p.rows[0].plan.leadCandidate.raw;
  assertEquals(p.rows[0].plan.leadCandidate.reason, "Hiring signal: Revenue Operations Manager");
  assertEquals(raw.company_name, "Sortly");
  assertEquals(raw.company_domain, "sortly.com");
  assertEquals(raw.company_resolution_status, "verified");
  assertEquals(raw.company_brain_status, "qualified");
});

Deno.test("embedded YC roles are used when no verified job exists", () => {
  const c = company({
    hiring_jobs: [] as never,
    yc_open_jobs: [{
      job_id: "y1", job_url: "https://x/1", title: "Sales Operations Lead",
      company_name: "Sortly", company_linkedin_url: null, company_source_id: "yc:sortly",
      location: null, workplace_mode: null, posted_date: null, description: null,
      source: "yc", retrieved_at: null, missing_fields: [],
    }] as never,
  });
  const p = projectMissionCompanyRows([c], "ws-1");
  assertEquals(p.rows[0].plan.leadCandidate.reason, "Hiring signal: Sales Operations Lead");
});

Deno.test("a company with no proven opening still persists, without inventing one", () => {
  const c = company({ hiring_jobs: [] as never, yc_open_jobs: [] as never });
  const p = projectMissionCompanyRows([c], "ws-1");
  assertEquals(p.rows.length, 1);
  assertEquals(p.rows[0].plan.leadCandidate.reason, null, "no evidence means no claim");
});

// ══════════════════════ what does NOT reach it ══════════════════════════════

Deno.test("only an explicit Brain pass is persisted", () => {
  for (const verdict of ["reject", "unknown", null] as const) {
    const p = projectMissionCompanyRows([company({ verdict })], "ws-1");
    assertEquals(
      p.rows.length, 0,
      `verdict ${verdict} must not reach the Lead Library — it belongs in the evaluation rows`,
    );
  }
});

Deno.test("a company with no strong identifier is skipped, with a reason", () => {
  const weak = company({
    company: {
      external_source_id: "yc:ghost", company_name: "Ghost", canonical_domain: null,
      linkedin_company_url: null, website: null, description: null,
      provider_industry: null, industry_ids: [], employee_count: null,
      employee_range_advisory: null, geography: null, company_type: null,
    } as never,
    enriched: null,
    identity: null,
  });
  const p = projectMissionCompanyRows([weak], "ws-1");
  assertEquals(p.rows.length, 0, "a name-only company creates no unresolvable row");
  assertEquals(p.skipped.length, 1);
  // The reason comes from the EXISTING projection, which is more precise than
  // anything this module would have invented.
  assertEquals(p.skipped[0].reason, "company_identity_unresolved");
});

// ══════════════════════ deduplication ═══════════════════════════════════════

Deno.test("the same company twice produces ONE row, keyed by the existing rule", () => {
  const p = projectMissionCompanyRows([company(), company()], "ws-1");
  assertEquals(p.rows.length, 1, "one company, one row");
  assertEquals(p.rows[0].key, "domain:sortly.com",
    "the existing companyRowKey (dedupeKey) is the identity");
});

Deno.test("two different companies produce two rows", () => {
  const other = company({
    key: "https://www.linkedin.com/company/clay",
    company: {
      external_source_id: "yc:clay", company_name: "Clay", canonical_domain: "clay.com",
      linkedin_company_url: "https://www.linkedin.com/company/clay",
      website: "https://clay.com", description: "GTM platform.",
      provider_industry: "B2B", industry_ids: [], employee_count: 30,
      employee_range_advisory: null, geography: "United States", company_type: null,
    } as never,
    enriched: null,
    identity: {
      company_key: "clay", status: "verified_match",
      linkedin_company_url: "https://www.linkedin.com/company/clay",
      evidence: ["domain_match"], ambiguous_candidates: [],
    } as never,
  });
  const p = projectMissionCompanyRows([company(), other], "ws-1");
  assertEquals(p.rows.length, 2);
  assertEquals(new Set(p.rows.map((r) => r.key)).size, 2);
});

// ══════════════════════ identity precedence ════════════════════════════════

Deno.test("resolved identity outranks whatever discovery carried", () => {
  const c = company({
    company: {
      external_source_id: "yc:sortly", company_name: "Sortly", canonical_domain: null,
      linkedin_company_url: "https://www.linkedin.com/company/WRONG",
      website: null, description: null, provider_industry: null, industry_ids: [],
      employee_count: null, employee_range_advisory: null, geography: null, company_type: null,
    } as never,
    enriched: null,
  });
  const p = projectMissionCompanyRows([c], "ws-1");
  assertEquals(
    p.rows[0].plan.account?.linkedinUrl, "linkedin.com/company/sortly",
    "the RESOLVED url wins over the discovery row's",
  );
});

Deno.test("an unresolved identity says so in the pending reason", () => {
  const c = company({ identity: null });
  const p = projectMissionCompanyRows([c], "ws-1");
  // Still persistable — the domain is a strong id — but the row records that a
  // scoped people search could not have run.
  assertEquals(p.rows.length, 1);
  assertEquals(p.rows[0].plan.leadCandidate.raw.pending_reason,
    "company_identity_insufficient_for_scoped_search");
});

// ══════════════════════ contract hygiene ════════════════════════════════════

Deno.test("the projection writes nothing and reads no raw text", () => {
  const SRC = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadMissionPersistenceProjection.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  for (const parser of [
    "extractLeadIntent", "extractRequestedLeadCount", "separateIntent",
    "classifyWorkflow", "parseLeadMissionDeterministic", "extractLeadSearchIntent",
  ]) {
    assertFalse(SRC.includes(parser), `${parser} must not appear`);
  }
  assertFalse(
    /original_user_query|\binstruction\b|\bprompt\b/.test(SRC),
    "the projection reads the engine's result, never the user's sentence",
  );
  for (const io of ["fetch(", "supabase", "insert(", "await "]) {
    assertFalse(SRC.includes(io), `${io} must not appear: the projection persists nothing`);
  }
  assert(
    SRC.includes("buildCompanyRowPersistencePlan"),
    "it must REUSE the existing projection rather than building its own plan",
  );
});

Deno.test("the summary reports planned, persisted and skipped", () => {
  const p = projectMissionCompanyRows([company(), company({ verdict: "reject" })], "ws-1");
  const s = missionPersistenceSummary(p, 1);
  assertEquals(s.planned, 1);
  assertEquals(s.persisted, 1);
  assertEquals(s.skipped, []);
});
