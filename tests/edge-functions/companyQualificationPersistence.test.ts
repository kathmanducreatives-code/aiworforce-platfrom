// A COMPANY THE RUN COUNTED AS QUALIFIED MUST PERSIST AS QUALIFIED.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Run e93380bd (lineage 862e81be) counted 5 of 5, stopped on `quota_met` and
// reported SATISFIED. Every one of the five rows it wrote looked like this:
//
//   { company_brain_status: "qualified",   ← the Brain passed it
//     verdict:              "NEEDS_REVIEW",
//     decision_maker_status:"pending",
//     quota_eligible:        false }       ← and the row denied it
//
// So the Workbench, which reads the rows, showed Qualified 0 / In review 5 for
// a run the engine had already called complete.
//
// Neither half was wrong on its own. Quota counted `qualified_company_keys` —
// Company Brain passes. `buildCompanyRowPersistencePlan` held a hard invariant
// that a company row is never quota-eligible, which is CORRECT for a mission
// that asked for contact-ready leads and wrong for one that asked for
// companies. The writer was never told which it was.
//
// ZERO network, ZERO DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCompanyRowPersistencePlan, companyRowStage,
} from "../../supabase/functions/_shared/companyRowProjection.ts";
import { projectMissionCompanyRows } from "../../supabase/functions/_shared/leadMissionPersistenceProjection.ts";
import { companyIsTheDeliverable } from "../../supabase/functions/_shared/leadMission.ts";
import { resolveQualification } from "../../src/lib/qualifiedLead/qualification.ts";
import { qualificationFromRow } from "../../src/lib/qualifiedLead/rowQualification.ts";
import { partitionLeads } from "../../src/lib/workbench/leadTabs.ts";

// deno-lint-ignore no-explicit-any
const any = (o: unknown): any => o;

/** An `EngineCompany` in the shape `projectMissionCompanyRows` actually reads. */
const engineCompany = (name: string, i: number, o: Record<string, unknown> = {}) => {
  const slug = name.toLowerCase().replace(/\W/g, "");
  return any({
    key: `c${i}`,
    verdict: "pass",
    company: {
      company_name: name,
      canonical_domain: `${slug}.com`,
      website: `https://${slug}.com`,
      linkedin_company_url: `linkedin.com/company/${slug}`,
      geography: "United Kingdom",
      description: null,
    },
    enriched: null,
    identity: null,
    hiring_jobs: [],
    yc_open_jobs: [],
    brain: { gate: "pass" },
    fit: { stage: null },
    ...o,
  });
};

/** A company shaped like the five CareerXperts/Storm4/EVONA rows. */
const pending = (o: Record<string, unknown> = {}) => any({
  company: {
    name: "CareerXperts Consulting",
    canonicalDomain: "careerxperts.com",
    linkedinUrl: "linkedin.com/company/careerxperts-consulting",
    dedupeKey: "domain:careerxperts.com",
    normalizedName: "careerxperts consulting",
  },
  reason: "no_decision_maker_returned",
  brainGate: "pass",
  jobEvidence: {
    title: "Business Growth Leader",
    url: "https://www.linkedin.com/jobs/view/4454181411",
    location: "Bengaluru, Karnataka, India",
    postedDate: "2026-08-21T07:09:38.000Z",
  },
  verticalOutcome: null,
  ...o,
});

/**
 * The persisted row, read back exactly the way the Workbench reads it.
 *
 * `useLeadResults` puts the DB row on `raw`; `qualificationFromRow` unwraps it
 * and `resolveQualification` decides. Nothing here re-implements either.
 */
function workbenchVerdict(plan: { leadCandidate: { raw: Record<string, unknown> } }) {
  const row = any({
    contact_status: plan.leadCandidate.raw.contact_status,
    raw: plan.leadCandidate.raw,
  });
  return resolveQualification(qualificationFromRow(row));
}

// ═══ 1. THE PREDICATE BOTH HALVES NOW SHARE ════════════════════════════════

Deno.test("1. only a qualified_companies mission makes the company the deliverable", () => {
  assert(companyIsTheDeliverable({ requested_output: "qualified_companies" }));
  assert(!companyIsTheDeliverable({ requested_output: "contact_ready_leads" }));
  // Enrichment counts CONTACT identities toward quota, so a company row on one
  // does not reach quota and must not claim to.
  assert(!companyIsTheDeliverable({ requested_output: "enriched_companies" }));
  assert(!companyIsTheDeliverable({ requested_output: "job_listings" }));
  assert(!companyIsTheDeliverable({ requested_output: null }));
  assert(!companyIsTheDeliverable(null));
  assert(!companyIsTheDeliverable(undefined));
});

// ═══ 2. THE INVARIANT ══════════════════════════════════════════════════════

Deno.test("2. brain=qualified + counted toward quota + persisted → Workbench Qualified", () => {
  const plan = buildCompanyRowPersistencePlan(pending(), "ws-1", "company");
  const raw = plan.leadCandidate.raw as Record<string, unknown>;

  // The row states what earned the credit.
  assertEquals(raw.company_brain_status, "qualified");
  assertEquals(raw.quota_eligible, true);
  assertEquals(raw.verdict, "QUALIFIED");
  // The PLAN verdict is the compound pipeline's PERSON vocabulary and drives
  // `VERDICT_TO_CEIL`. `CONTACT` here would grant a contact ceiling to a row
  // with no person, so it stays `NEEDS_REVIEW` — deliberately, not by omission.
  assertEquals(plan.verdict, "NEEDS_REVIEW");
  assertEquals(raw.qualification_basis, "company_brain_pass");
  assertEquals(raw.quota_basis, "qualified_companies_mission");

  // And the canonical resolver — untouched in its decision — agrees.
  const q = workbenchVerdict(plan);
  assert(q.qualified, "a company counted toward quota must resolve as Qualified");
  assertEquals(q.quotaCredit, 1);
  assertEquals(q.decidedBy, "quota_eligible");
});

Deno.test("2b. and it lands on the Qualified tab, not In review", () => {
  const plan = buildCompanyRowPersistencePlan(pending(), "ws-1", "company");
  const row = any({ contact_status: "needs_contact", raw: plan.leadCandidate.raw });
  const p = partitionLeads([{ ...row, ...qualificationFromRow(row) }] as never);
  assertEquals(p.qualified.length, 1);
  assertEquals(p.inReview.length, 0);
});

// ═══ 3. WHAT MUST NOT CHANGE ═══════════════════════════════════════════════

Deno.test("3. a contact mission keeps the old row exactly — a company is not a lead", () => {
  const plan = buildCompanyRowPersistencePlan(pending(), "ws-1", "contact");
  const raw = plan.leadCandidate.raw as Record<string, unknown>;
  assertEquals(raw.quota_eligible, false);
  assertEquals(raw.verdict, "NEEDS_REVIEW");
  assertEquals(plan.verdict, "NEEDS_REVIEW");
  assertEquals(raw.decision_maker_status, "pending");
  assertEquals(raw.qualification_basis, null);
  const q = workbenchVerdict(plan);
  assert(!q.qualified, "a Brain pass with no person is not a contact-ready lead");
  assertEquals(q.level, "needs_verification");
});

Deno.test("3b. the default is the old behaviour, so untaught callers are unchanged", () => {
  const withDefault = buildCompanyRowPersistencePlan(pending(), "ws-1");
  const explicit = buildCompanyRowPersistencePlan(pending(), "ws-1", "contact");
  assertEquals(JSON.stringify(withDefault), JSON.stringify(explicit));
});

Deno.test("3c. a company mission does NOT qualify a company the Brain did not pass", () => {
  for (const gate of ["fail", "unknown", undefined]) {
    const plan = buildCompanyRowPersistencePlan(pending({ brainGate: gate }), "ws-1", "company");
    const raw = plan.leadCandidate.raw as Record<string, unknown>;
    assertEquals(raw.quota_eligible, false, `brainGate=${gate} must not be quota-eligible`);
    assertEquals(raw.verdict, "NEEDS_REVIEW");
    assert(!workbenchVerdict(plan).qualified);
  }
});

Deno.test("3d. a rejected company stays rejected and never reaches the writer", () => {
  // `projectMissionCompanyRows` only projects `verdict === "pass"`; a rejection
  // is evidence of work done and belongs in the evaluation rows.
  const out = projectMissionCompanyRows(
    [engineCompany("Nope", 1, { verdict: "reject" })], "ws-1", "company",
  );
  assertEquals(out.rows.length, 0);
});

Deno.test("3e. an unidentified company is still not persistable, whatever the mission", () => {
  const plan = buildCompanyRowPersistencePlan(
    pending({ company: { name: "Nameless Co" } }), "ws-1", "company",
  );
  assert(!plan.persistable);
  assertEquals(plan.persistenceReason, "company_identity_unresolved");
});

// ═══ 4. NOTHING HERE MAKES A COMPANY CONTACTABLE ═══════════════════════════

Deno.test("4. a qualified company row is still contact-blocked and has no person", () => {
  const plan = buildCompanyRowPersistencePlan(pending(), "ws-1", "company");
  const raw = plan.leadCandidate.raw as Record<string, unknown>;
  assertEquals(plan.contact, null);
  assert(plan.contactBlocked);
  assert((plan.blockReasons ?? []).includes("no_verified_decision_maker"));
  assertEquals(raw.contact_status, "needs_contact");
  // `not_required` is the honest status: nothing is missing, because nothing
  // was ever sought. It is deliberately NOT one of `MISSING_DM`.
  assertEquals(raw.decision_maker_status, "not_required");
});

Deno.test("4b. the card does not claim a decision-maker it does not have", () => {
  const company = workbenchVerdict(buildCompanyRowPersistencePlan(pending(), "ws-1", "company"));
  assert(!company.displayLines.includes("Verified decision-maker"));
  assert(company.displayLines.includes("Qualified company"));

  // A real verified person still says so.
  const person = resolveQualification({
    quota_eligible: true, decision_maker_status: "verified", contact_status: "verified",
  });
  assert(person.displayLines.includes("Verified decision-maker"));
});

Deno.test("4c. the stage stops promising a search the mission never asked for", () => {
  const p = pending();
  assertEquals(companyRowStage(p), "decision_maker_search_pending");
  const plan = buildCompanyRowPersistencePlan(p, "ws-1", "company");
  assertEquals((plan.leadCandidate.raw as Record<string, unknown>).workbench_stage, "company_qualified");
  const contactPlan = buildCompanyRowPersistencePlan(p, "ws-1", "contact");
  assertEquals(
    (contactPlan.leadCandidate.raw as Record<string, unknown>).workbench_stage,
    "decision_maker_search_pending",
  );
});

// ═══ 5. END TO END, THROUGH THE MISSION PROJECTION ═════════════════════════

Deno.test("5. five passed companies project as five qualified rows", () => {
  const companies = ["Storm4", "Talentoma", "Storm3", "CareerXperts Consulting", "EVONA"]
    .map((name, i) => engineCompany(name, i));

  const out = projectMissionCompanyRows(companies, "ws-1", "company");
  assertEquals(out.rows.length, 5, `skipped: ${JSON.stringify(out.skipped)}`);
  for (const r of out.rows) {
    const q = workbenchVerdict(r.plan as never);
    assert(q.qualified, `${JSON.stringify(r.company_key)} must resolve Qualified`);
  }

  // THE INVARIANT, STATED AS ARITHMETIC: what the engine counted toward quota
  // is what the Workbench will count.
  const qualifiedRows = out.rows.filter((r) => workbenchVerdict(r.plan as never).qualified).length;
  assertEquals(qualifiedRows, companies.length);
});

Deno.test("5b. the same five on a contact mission stay In review", () => {
  const companies = ["Storm4", "Talentoma"].map((name, i) => engineCompany(name, i));
  const out = projectMissionCompanyRows(companies, "ws-1", "contact");
  assertEquals(out.rows.length, 2);
  for (const r of out.rows) {
    assert(!workbenchVerdict(r.plan as never).qualified);
  }
});
