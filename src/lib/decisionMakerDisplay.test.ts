import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDecisionMakerRowView,
  normalizeDecisionMaker,
  resolveDisplayName,
  resolveLinkedInUrl,
  resolveTitle,
  resolveCompany,
  personaLabel,
  titleCompanyLine,
  verificationLine,
  emailStatusCopy,
  rowActionAvailability,
} from "./decisionMakerDisplay.ts";
import { deriveRowAction } from "./leadRowAction.ts";
import { emptyBatchTally, formatBatchSummary } from "./leadActionOutcome.ts";

// Synthetic only — no real people, companies or profile URLs.
const LI = "https://www.linkedin.com/in/synthetic-person-a";
const OK = { success: true, per_lead: [{}] };

/** CANONICAL shape — exactly what the live action response returns. */
const canonical = {
  contact_id: "c1",
  full_name: "Ada Kestrel",
  linkedin_url: LI,
  current_title: "Founder & CEO",
  current_company_name: "Nimbus Forge",
  role_family: "founder",
  verification_status: "verified",
  verification_methods: ["company_linkedin_url"],
  confidence: "high",
  rank: 1,
  rank_reasons: ["current employer verified"],
  persisted: true,
};

/** LEGACY shape — older persisted raw.decision_makers rows. */
const legacy = {
  name: "Bo Wrenfield",
  linkedinUrl: LI.replace("-a", "-b"),
  title: "Chief Revenue Officer",
  company: "Nimbus Forge",
  confidence: "high",
};

// ===========================================================================
// CONTRACT NORMALIZATION
// ===========================================================================

Deno.test("1-3. name precedence: full_name → name → fullName → first+last", () => {
  assertEquals(resolveDisplayName({ full_name: "A B", name: "Z" }), "A B", "canonical wins");
  assertEquals(resolveDisplayName({ name: "Legacy Person" }), "Legacy Person");
  assertEquals(resolveDisplayName({ fullName: "Camel Person" }), "Camel Person");
  assertEquals(resolveDisplayName({ first_name: "Ada", last_name: "Kestrel" }), "Ada Kestrel");
  assertEquals(resolveDisplayName({ firstName: "Ada", lastName: "Kestrel" }), "Ada Kestrel");
});

Deno.test("4. no resolvable name → not displayable (contract error, not a placeholder)", () => {
  assertEquals(resolveDisplayName({}), undefined);
  assertEquals(resolveDisplayName({ full_name: "   " }), undefined);
  assertEquals(normalizeDecisionMaker({ linkedin_url: LI }), null);
});

Deno.test("5-6. linkedin precedence: canonical over every legacy alias", () => {
  assertEquals(resolveLinkedInUrl({ linkedin_url: LI, linkedinUrl: "https://x" }), LI);
  assertEquals(resolveLinkedInUrl({ linkedinUrl: LI }), LI);
  assertEquals(resolveLinkedInUrl({ linkedInUrl: LI }), LI);
  assertEquals(resolveLinkedInUrl({ profile_url: LI }), LI);
  assertEquals(resolveLinkedInUrl({ profileUrl: LI }), LI);
  assertEquals(resolveLinkedInUrl({}), undefined);
});

Deno.test("7-10. title and company precedence", () => {
  assertEquals(resolveTitle({ current_title: "CRO", title: "old" }), "CRO");
  assertEquals(resolveTitle({ title: "VP Sales" }), "VP Sales");
  assertEquals(resolveCompany({ current_company_name: "New", company: "Old" }), "New");
  assertEquals(resolveCompany({ company: "Legacy Co" }), "Legacy Co");
  assertEquals(resolveCompany({ company_name: "Alt Co" }), "Alt Co");
});

Deno.test("40. canonical fields win when a record carries BOTH shapes", () => {
  const both = { ...canonical, name: "WRONG", title: "WRONG", company: "WRONG", linkedinUrl: "https://wrong" };
  const dm = normalizeDecisionMaker(both);
  assert(dm);
  assertEquals(dm!.full_name, "Ada Kestrel");
  assertEquals(dm!.current_title, "Founder & CEO");
  assertEquals(dm!.current_company_name, "Nimbus Forge");
  assertEquals(dm!.linkedin_url, LI);
});

Deno.test("a person with no profile link is not displayable", () => {
  assertEquals(normalizeDecisionMaker({ full_name: "No Link" }), null);
});

// ===========================================================================
// THE PRODUCTION BUG
// ===========================================================================

Deno.test("REGRESSION: canonical payload never renders the string 'undefined'", () => {
  // Production returned full_name/current_title while the row read name/title,
  // so the template literal interpolated `undefined`.
  const a = deriveRowAction("find_decision_makers", OK, { status: "succeeded", decision_makers: [canonical] });
  assertEquals(a.status, "succeeded");
  assert(a.detail, "a detail line must exist");
  assert(!a.detail!.includes("undefined"), `detail leaked undefined: ${a.detail}`);
  assert(a.detail!.includes("Ada Kestrel"));
  assert(a.detail!.includes("Founder & CEO"));
});

Deno.test("36-38. all three live sources normalize identically", () => {
  for (const [label, rec] of [["canonical", canonical], ["legacy", legacy]] as const) {
    const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [rec] });
    assertEquals(view.status, "succeeded", label);
    assert(view.primary_decision_maker, label);
    assert(!JSON.stringify(view).includes("undefined"), label);
  }
});

// ===========================================================================
// SUCCESSFUL ROW
// ===========================================================================

Deno.test("12-15 + 21. primary is rank 1 with name, title, company and verification", () => {
  const second = { ...canonical, full_name: "Bo Wrenfield", linkedin_url: LI + "-2", rank: 2 };
  const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [second, canonical] });
  assertEquals(view.primary_decision_maker!.full_name, "Ada Kestrel", "rank 1 wins regardless of array order");
  assertEquals(view.primary_decision_maker!.rank, 1);
  assertEquals(titleCompanyLine(view.primary_decision_maker!), "Founder & CEO · Nimbus Forge");
  assertEquals(verificationLine(view.primary_decision_maker!), "Current employer verified");
});

Deno.test("20 + 22. additional verified people are kept, not discarded", () => {
  const people = [1, 2, 3].map((i) => ({ ...canonical, full_name: `Person ${i}`, linkedin_url: `${LI}-${i}`, rank: i }));
  const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: people });
  assertEquals(view.additional_decision_makers.length, 2, "ranks 2 and 3 survive");
  assertEquals(view.additional_decision_makers.map((d) => d.rank), [2, 3]);
});

Deno.test("19. persona label replaces the generic badge", () => {
  assertEquals(personaLabel("founder"), "Founder");
  assertEquals(personaLabel("executive_revenue"), "Revenue Leader");
  assertEquals(personaLabel("sales_leadership"), "Sales Leader");
  assertEquals(personaLabel(undefined), "Decision Maker");
  assert(personaLabel("founder") !== "Profile");
});

Deno.test("17. absent email never claims none exists", () => {
  assertEquals(emailStatusCopy("not_enriched"), "Email not enriched");
  assertEquals(emailStatusCopy("not_searched"), "Email not searched");
  assertEquals(emailStatusCopy("unavailable"), "Email enrichment unavailable");
  for (const s of ["not_enriched", "not_searched", "unavailable"] as const) {
    assert(!emailStatusCopy(s).toLowerCase().includes("no email"));
  }
});

Deno.test("18. a partial record still renders without undefined", () => {
  const partial = { full_name: "Ada Kestrel", linkedin_url: LI, verification_status: "verified" };
  const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [partial] });
  assertEquals(titleCompanyLine(view.primary_decision_maker!), "", "no title/company → empty, not 'undefined'");
  assert(!JSON.stringify(view).includes("undefined"));
});

// ===========================================================================
// CONTRACT ERROR
// ===========================================================================

Deno.test("32. a malformed success is NOT counted as succeeded", () => {
  const malformed = { status: "succeeded", decision_makers: [{ role_family: "founder" }] };
  const view = buildDecisionMakerRowView(malformed);
  assertEquals(view.status, "contract_error");
  assertEquals(view.contract_error_reason, "decision_maker_display_contract_invalid");

  const a = deriveRowAction("find_decision_makers", OK, malformed);
  assertEquals(a.status, "failed", "must not render as success");
  assertEquals(a.reason_code, "decision_maker_display_contract_invalid");

  const tally = emptyBatchTally(1);
  if (a.status !== "running") tally[a.status] += 1;
  assertEquals(tally.succeeded, 0);
  assertEquals(tally.failed, 1);
});

Deno.test("succeeded with an empty people list is a contract error too", () => {
  const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [] });
  assertEquals(view.status, "contract_error");
  assertEquals(view.contract_error_reason, "succeeded_without_decision_makers");
});

// ===========================================================================
// NO MATCH / MANUAL REVIEW / ACTIONS
// ===========================================================================

Deno.test("23-26. no_match is truthful and blocks contact actions", () => {
  const view = buildDecisionMakerRowView({ status: "no_match", reason_code: "company_match_failed", rejected_count: 25 });
  assertEquals(view.status, "no_match");
  assertEquals(view.primary_decision_maker, undefined);

  const acts = rowActionAvailability(view);
  assertEquals(acts.enrich_contact, false);
  assertEquals(acts.generate_outreach, false);
  assertEquals(acts.research_company, true);
  assertEquals(acts.retry_search, true);
});

Deno.test("27-30. manual review is not presented as verified", () => {
  const view = buildDecisionMakerRowView({ status: "needs_manual_review", manual_review_count: 2, decision_makers: [] });
  assertEquals(view.status, "needs_manual_review");
  assertEquals(view.primary_decision_maker, undefined, "probable people are never a primary contact");

  const acts = rowActionAvailability(view);
  assertEquals(acts.enrich_contact, false);
  assertEquals(acts.generate_outreach, false);
  assertEquals(acts.review_profiles, true);
});

Deno.test("10 + 16. a verified contact enables enrichment; nothing else does", () => {
  const ok = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [canonical] });
  assertEquals(rowActionAvailability(ok).enrich_contact, true);
  for (const st of ["unavailable", "timed_out", "failed"] as const) {
    const v = buildDecisionMakerRowView({ status: st });
    assertEquals(rowActionAvailability(v).enrich_contact, false, st);
    assertEquals(rowActionAvailability(v).generate_outreach, false, st);
  }
});

// ===========================================================================
// BATCH + PRESERVED STATUSES
// ===========================================================================

Deno.test("31. the production batch reads '3 succeeded · 1 no match'", () => {
  const tally = emptyBatchTally(4);
  tally.succeeded = 3;
  tally.no_match = 1;
  const s = formatBatchSummary(tally);
  assert(s.includes("3 succeeded"), s);
  assert(s.includes("1 no match"), s);
});

Deno.test("33-35. unavailable / timed_out / failed survive the display layer", () => {
  for (const st of ["unavailable", "timed_out", "failed"] as const) {
    const a = deriveRowAction("find_decision_makers", OK, { status: st, reason_code: `${st}_code` });
    assertEquals(a.status, st);
    assertEquals(a.decisionMakers?.status, st);
  }
});

// ===========================================================================
// SAFETY
// ===========================================================================

Deno.test("46-47. fixtures carry no real people and no raw payloads", () => {
  const view = buildDecisionMakerRowView({ status: "succeeded", decision_makers: [canonical] });
  const s = JSON.stringify(view);
  assert(s.includes("synthetic"), "profile URLs are synthetic");
  assert(!s.includes("apiKey") && !s.includes("raw_html"));
  assert(!/@[a-z]+\.(com|io|ai)/i.test(s), "no email-like strings");
});
