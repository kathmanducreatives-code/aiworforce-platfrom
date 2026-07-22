import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runDecisionMakerAction,
  identityInputFromLead,
  knownPersonFromLead,
  type IntegrationPorts,
  type LeadRecordLike,
} from "./integration.ts";
import {
  classifyToolFailure,
  extractProfiles,
  extractRunId,
  planToToolInput,
  makePeopleSearchProvider,
  runProviderPlan,
  type ToolResultLike,
} from "./providerAdapter.ts";
import { planPeopleSearch } from "./searchPlanner.ts";
import { normalizeProviderProfile } from "./personProfile.ts";
import { resolveCompanyIdentity } from "./companyIdentity.ts";
import * as F from "./fixtures.ts";

const WS = "00000000-0000-4000-8000-000000000001";
const OTHER_WS = "00000000-0000-4000-8000-0000000000ff";
const LEAD = "00000000-0000-4000-8000-000000000002";

const LEAD_RECORD: LeadRecordLike = {
  lead_candidate_id: LEAD,
  company_name: "Nimbus Forge",
  company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge/?trk=x",
  website: "https://nimbusforge.example/careers",
  employee_count: 12,
};

/** Ports with recording stubs — no network, provider or database anywhere. */
function ports(over: Partial<IntegrationPorts> = {}) {
  const calls = { provider: 0, persist: 0, lookup: 0, ownership: 0 };
  const persisted: string[] = [];
  const base: IntegrationPorts = {
    provider: async () => ({ status: "ok", profiles: [] }),
    lookupContacts: async () => [],
    persistContact: async (c) => { persisted.push(c.linkedin_url); return `contact_${persisted.length}`; },
    resolveLeadWorkspace: async () => WS,
  };
  const merged = { ...base, ...over };
  // Counters wrap the FINAL port set, so an override is still counted.
  const p: IntegrationPorts = {
    provider: async (plan) => { calls.provider += 1; return merged.provider(plan); },
    lookupContacts: async (ws) => { calls.lookup += 1; return merged.lookupContacts(ws); },
    persistContact: async (c) => { calls.persist += 1; return merged.persistContact(c); },
    resolveLeadWorkspace: async (id) => { calls.ownership += 1; return merged.resolveLeadWorkspace(id); },
  };
  return { p, calls, persisted };
}

const provOk = (profiles: unknown[], run_id = "run_synthetic") =>
  async () => ({ status: "ok" as const, profiles: profiles as Record<string, unknown>[], run_id });

// ===========================================================================
// PROVIDER ADAPTER — the defect this branch fixes
// ===========================================================================

Deno.test("14-15. disabled / unconfigured provider is unavailable, NOT an empty result", () => {
  assertEquals(classifyToolFailure({ ok: false, unavailable: true }), {
    status: "unavailable", error_code: "people_search_disabled",
  });
  assertEquals(classifyToolFailure({ ok: false, error: "actor not configured" }), {
    status: "unavailable", error_code: "provider_not_configured",
  });
  assertEquals(classifyToolFailure({ ok: false, error: "401 unauthorized" }).status, "unavailable");
});

Deno.test("17-18. timeout and generic errors stay distinct", () => {
  assertEquals(classifyToolFailure({ ok: false, error: "request timed out after 30s" }), {
    status: "timed_out", error_code: "provider_timed_out",
  });
  assertEquals(classifyToolFailure({ ok: false, error: "boom" }), {
    status: "failed", error_code: "provider_failed",
  });
});

Deno.test("20. raw provider error text is never propagated", async () => {
  const secret = "https://api.apify.com/v2/runs?token=SECRET_TOKEN_VALUE";
  const runTool = async (): Promise<ToolResultLike> => ({ ok: false, error: `failed calling ${secret}` });
  const plan = planPeopleSearch(resolveCompanyIdentity(F.TARGET_COMPANY), "company_employee_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const r = await runProviderPlan(plan.plan, runTool, {});
  assertEquals(r.error_code, "provider_failed");
  assert(!JSON.stringify(r).includes("SECRET_TOKEN_VALUE"));
  assert(!JSON.stringify(r).includes("api.apify.com"));
});

Deno.test("a thrown tool becomes failed, not an empty success", async () => {
  const runTool = async (): Promise<ToolResultLike> => { throw new Error("socket hang up"); };
  const plan = planPeopleSearch(resolveCompanyIdentity(F.TARGET_COMPANY), "company_employee_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const r = await runProviderPlan(plan.plan, runTool, {});
  assertEquals(r.status, "failed");
  assertEquals(r.error_code, "provider_failed");
  assert(!JSON.stringify(r).includes("socket hang up"));
});

Deno.test("19. provider run ID is preserved", () => {
  assertEquals(extractRunId({ run_id: "abc123" }), "abc123");
  assertEquals(extractRunId({ actor_run_id: "xyz" }), "xyz");
  assertEquals(extractRunId({}), null);
});

Deno.test("profile arrays are located across common envelopes", () => {
  assertEquals(extractProfiles([{ a: 1 }]).length, 1);
  assertEquals(extractProfiles({ items: [{ a: 1 }, { b: 2 }] }).length, 2);
  assertEquals(extractProfiles({ nothing: true }).length, 0);
});

Deno.test("the tool input never auto-persists raw people", () => {
  const plan = planPeopleSearch(resolveCompanyIdentity(F.TARGET_COMPANY), "company_employee_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const input = planToToolInput(plan.plan);
  assertEquals(input.defer_persistence, true);
  assertEquals(input.attach_to_accounts, false);
  assertEquals(input.max_results, plan.plan.maximum_results);
});

Deno.test("makePeopleSearchProvider maps a tool result into the pipeline contract", async () => {
  const runTool = async (): Promise<ToolResultLike> => ({ ok: true, data: { items: [F.VERIFIED_FOUNDER], run_id: "r1" } });
  const provider = makePeopleSearchProvider(runTool, {});
  const plan = planPeopleSearch(resolveCompanyIdentity(F.TARGET_COMPANY), "company_employee_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const res = await provider(plan.plan);
  assertEquals(res.status, "ok");
  assertEquals(res.run_id, "r1");
  assertEquals(res.profiles?.length, 1);
});

// ===========================================================================
// IDENTITY MAPPING FROM REAL RECORD SHAPES
// ===========================================================================

Deno.test("9. a real lead record maps to a strong identity", () => {
  const id = resolveCompanyIdentity(identityInputFromLead(LEAD_RECORD));
  assertEquals(id.identity_strength, "strong");
  assertEquals(id.domain, "nimbusforge.example");
});

Deno.test("7-8. weak / missing identity returns missing_company_identity with NO provider call", async () => {
  for (const lead of [
    { lead_candidate_id: LEAD, company_name: "Nimbus Forge" },
    { lead_candidate_id: LEAD },
  ] as LeadRecordLike[]) {
    const { p, calls } = ports({ provider: provOk([F.VERIFIED_FOUNDER]) });
    const r = await runDecisionMakerAction(lead, { workspace_id: WS }, p);
    assertEquals(r.status, "missing_company_identity");
    assertEquals(calls.provider, 0, "must not spend a provider call");
    assertEquals(calls.persist, 0);
  }
});

Deno.test("a job-board website does not become the company domain", async () => {
  const { p, calls } = ports({ provider: provOk([F.VERIFIED_FOUNDER]) });
  const r = await runDecisionMakerAction(
    { lead_candidate_id: LEAD, company_name: "Nimbus Forge", website: "https://jobs.lever.co/nimbus" },
    { workspace_id: WS }, p,
  );
  assertEquals(r.status, "missing_company_identity");
  assertEquals(calls.provider, 0);
});

// ===========================================================================
// SHORTCUT
// ===========================================================================

Deno.test("10-11. a job poster is a hint, not proof — it does not short-circuit verification", async () => {
  // The poster record carries no employment evidence, so the shortcut cannot
  // verify and the bounded search still runs.
  const lead: LeadRecordLike = {
    ...LEAD_RECORD,
    poster_contact_hint: { name: "Hana Quill", profile_url: "https://www.linkedin.com/in/hana-quill-synthetic", title: "Technical Recruiter" },
  };
  const { p, calls } = ports({ provider: provOk([F.VERIFIED_FOUNDER]) });
  const r = await runDecisionMakerAction(lead, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assertEquals(r.decision_makers[0].full_name, "Ada Kestrel", "the verified founder wins, not the recruiter");
  assert(calls.provider >= 1, "the search still ran");
});

Deno.test("knownPersonFromLead never asserts employment it cannot prove", () => {
  const kp = knownPersonFromLead({
    ...LEAD_RECORD,
    poster_contact_hint: { name: "Ada Kestrel", profile_url: "https://www.linkedin.com/in/ada-kestrel-synthetic", title: "Founder" },
  });
  assert(kp);
  assertEquals(kp!.current_company_name, undefined, "no self-verifying company claim");
  assertEquals((kp!.experience as unknown[]).length, 0);
});

Deno.test("a poster with a malformed profile URL yields no shortcut", () => {
  assertEquals(knownPersonFromLead({ ...LEAD_RECORD, poster_contact_hint: { name: "X", profile_url: "nope" } }), null);
});

// ===========================================================================
// OUTCOME PRESERVATION — the core regression
// ===========================================================================

Deno.test("43. a disabled provider does NOT become no_match", async () => {
  const { p } = ports({ provider: async () => ({ status: "unavailable" }) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "unavailable");
  assertEquals(r.reason_code, "people_search_disabled");
  assert(r.status !== "no_match");
});

Deno.test("44. a timeout does not become a generic failure", async () => {
  const { p } = ports({ provider: async () => ({ status: "timed_out" }) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "timed_out");
  assertEquals(r.retryable, true);
});

Deno.test("16 + 45. an empty provider success is no_match, never success", async () => {
  const { p, calls } = ports({ provider: provOk([]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "no_match");
  assertEquals(r.reason_code, "provider_no_results");
  assertEquals(r.decision_makers.length, 0);
  assertEquals(calls.persist, 0);
});

Deno.test("40. all profiles rejected returns no_match with nothing persisted", async () => {
  const { p, calls } = ports({ provider: provOk([F.UNRELATED_CRO, F.FORMER_FOUNDER, F.LOOKALIKE_COMPANY_PERSON]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "no_match");
  assertEquals(calls.persist, 0);
  assertEquals(r.decision_makers.length, 0);
});

Deno.test("41. probable-only returns needs_manual_review and persists nothing", async () => {
  const { p, calls } = ports({ provider: provOk([F.PROBABLE_EMPLOYEE]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "needs_manual_review");
  assertEquals(r.manual_review_count, 1);
  assertEquals(calls.persist, 0, "probable candidates are never auto-written");
  assertEquals(r.decision_makers.length, 0);
});

Deno.test("42 + 21. a verified founder succeeds and persists", async () => {
  const { p, calls, persisted } = ports({ provider: provOk([F.VERIFIED_FOUNDER]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assertEquals(r.persisted_count, 1);
  assertEquals(calls.persist, 1);
  assertEquals(persisted[0], "https://www.linkedin.com/in/ada-kestrel-synthetic");
  assertEquals(r.decision_makers[0].persisted, true);
  assert(r.decision_makers[0].contact_id);
});

// ===========================================================================
// PERSISTENCE
// ===========================================================================

Deno.test("34-35. an existing contact is reused, not inserted twice", async () => {
  const { p, calls } = ports({
    provider: provOk([F.VERIFIED_FOUNDER]),
    lookupContacts: async () => [{ id: "contact_existing", linkedin_url: "https://linkedin.com/in/ada-kestrel-synthetic/" }],
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assertEquals(calls.persist, 0, "no duplicate insert");
  assertEquals(r.existing_contact_count, 1);
  assertEquals(r.decision_makers[0].contact_id, "contact_existing");
  assertEquals(r.decision_makers[0].persisted, true);
});

Deno.test("36. a cross-workspace lead blocks the write", async () => {
  const { p, calls } = ports({
    provider: provOk([F.VERIFIED_FOUNDER]),
    resolveLeadWorkspace: async () => OTHER_WS,
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(calls.persist, 0, "ownership mismatch must block the write");
  assertEquals(r.persisted_count, 0);
  assertEquals(r.decision_makers[0].persisted, false);
});

Deno.test("37. one write fails and one succeeds → still succeeded, shortfall visible", async () => {
  let n = 0;
  const { p } = ports({
    provider: provOk([F.VERIFIED_FOUNDER, F.VERIFIED_CRO]),
    persistContact: async (c) => { n += 1; if (n === 1) throw new Error("db exploded"); return `contact_${n}`; },
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assertEquals(r.persisted_count, 1);
  assertEquals(r.observability.persistence_failed_count, 1);
});

Deno.test("38 + 39. all writes failing returns persistence_failed, sanitized", async () => {
  const { p } = ports({
    provider: provOk([F.VERIFIED_FOUNDER]),
    persistContact: async () => { throw new Error('duplicate key value violates unique constraint "contacts_pkey"'); },
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "failed");
  assertEquals(r.reason_code, "persistence_failed");
  assertEquals(r.retryable, true);
  const s = JSON.stringify(r);
  assert(!s.includes("duplicate key"), "raw DB error must not surface");
  assert(!s.includes("contacts_pkey"));
});

Deno.test("§4: a verified persist forwards current-employer verification into provenance", async () => {
  // Proves — through the ACTUAL caller, not a hand-built resolver input — that
  // the account-association resolver will receive a strong signal at persistence
  // time. Without this forwarding the contact would always resolve to
  // needs_review and account_id would never be written.
  let capturedProvenance: Record<string, unknown> | null = null;
  const { p } = ports({
    provider: provOk([F.VERIFIED_FOUNDER]),
    persistContact: async (c) => { capturedProvenance = c.provenance; return "contact_1"; },
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assert(capturedProvenance, "persistContact was called for the verified founder");
  assertEquals((capturedProvenance as Record<string, unknown>).verification_status, "verified", "verified current employer reaches persistence provenance");
  // extractContactSignals (used by attachContactAccount) treats this as a strong
  // current-employer signal, so a company-scoped discovery writes account_id.
});

Deno.test("31. persistence is consulted only for accepted candidates", async () => {
  const { p, calls } = ports({ provider: provOk([F.VERIFIED_FOUNDER, F.UNRELATED_CRO, F.FORMER_FOUNDER]) });
  await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(calls.persist, 1, "only the verified candidate reaches the write");
});

// ===========================================================================
// RESPONSE CONTRACT
// ===========================================================================

Deno.test("29 + 48. at most three verified people, no probable ones", async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    ...F.VERIFIED_CRO, full_name: `Person ${i}`, linkedin_url: `https://www.linkedin.com/in/p-${i}-synthetic`,
  }));
  const { p } = ports({ provider: provOk([...many, F.PROBABLE_EMPLOYEE]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.decision_makers.length, 3);
  assert(r.decision_makers.every((d) => d.verification_status === "verified"));
});

Deno.test("46. per-lead counts reconcile with observability", async () => {
  const { p } = ports({ provider: provOk([F.VERIFIED_FOUNDER, F.UNRELATED_CRO]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.returned_profile_count, 2);
  assertEquals(r.observability.final_outcome, r.status);
  assertEquals(r.observability.persisted_count, r.persisted_count);
  assertEquals(r.observability.existing_contact_count, r.existing_contact_count);
  assertEquals(r.verified_profile_count, 1);
});

Deno.test("50 + 56. the envelope carries no raw payload, experience blob or secret", async () => {
  const { p } = ports({
    provider: provOk([{ ...F.VERIFIED_FOUNDER, apiKey: "sk-leak", raw_html: "<html/>", email: "nope@example.invalid" }]),
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  const s = JSON.stringify(r);
  assert(!s.includes("sk-leak"));
  assert(!s.includes("raw_html"));
  assert(!s.includes("nope@example.invalid"));
  assert(!s.includes('"experience"'), "experience history is not exposed to the frontend");
});

Deno.test("53-54. no real database write or outreach occurs in these tests", async () => {
  // Every side effect is an injected stub; the modules import nothing else.
  const { p, calls } = ports({ provider: provOk([F.VERIFIED_FOUNDER]) });
  await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(calls.provider, 1);
  assertEquals(calls.ownership, 1);
  assert(calls.persist <= 3);
});

// ===========================================================================
// LEGACY REGRESSION GUARD (§18)
// ===========================================================================

const EXECUTOR_SRC = await Deno.readTextFile(new URL("../leadActionExecutor.ts", import.meta.url));

Deno.test("1-2. the live action uses the new engine and NOT the legacy verifier", () => {
  assert(
    /runDecisionMakerAction\(/.test(EXECUTOR_SRC),
    "find_decision_makers must call runDecisionMakerAction",
  );
  // The legacy discovery entrypoint must not be re-wired into the runtime.
  assert(
    !/await\s+runDecisionMakerDiscovery\(/.test(EXECUTOR_SRC),
    "the legacy runDecisionMakerDiscovery path must not return",
  );
  assert(
    !/peopleContactsToDecisionMakers\(/.test(EXECUTOR_SRC),
    "the legacy verifier must not be called from the executor",
  );
});

Deno.test("the provider failure mode that caused the bug cannot come back", () => {
  // `r.ok ? normalize(r.data) : []` collapsed disabled/timeout/failure into an
  // empty array, which the UI then reported as "no decision-makers found".
  assert(
    !/r\.ok\s*\?\s*normalizePeopleSearchRows\([^)]*\)\s*:\s*\[\]/.test(EXECUTOR_SRC),
    "provider status must not be discarded into an empty array",
  );
  assert(/makePeopleSearchProvider\(/.test(EXECUTOR_SRC), "must go through the status-preserving adapter");
});

Deno.test("3. research_company and generate_outreach paths are untouched", () => {
  assert(/runCompanyEnrichment\(/.test(EXECUTOR_SRC), "research_company still uses runCompanyEnrichment");
  assert(/runGenerateOutreach\(/.test(EXECUTOR_SRC), "generate_outreach still uses runGenerateOutreach");
  assert(/evaluateDraftGate\(/.test(EXECUTOR_SRC), "the outreach draft gate is still enforced");
});

// ===========================================================================
// PRODUCTION HOTFIX REGRESSIONS
// ===========================================================================

const REGISTRY_SRC = await Deno.readTextFile(new URL("../actorRegistry.ts", import.meta.url));

Deno.test("HOTFIX: every planned actor_key actually exists in the actor registry", () => {
  // The planner emitted "apify_company_employees", which is NOT a registry key
  // (the real one is apify_linkedin_company_employees). Stage 1 therefore always
  // failed as unconfigured, and — because unavailable short-circuited — masked
  // the working apify_people_search stage. Result: every strong-identity lead
  // reported "people search is disabled" without ever searching.
  const identity = resolveCompanyIdentity(F.TARGET_COMPANY);
  for (const stage of ["company_employee_search", "domain_people_search"] as const) {
    const planned = planPeopleSearch(identity, stage);
    assert(planned.ok, `${stage} should plan for a strong identity`);
    if (!planned.ok) return;
    assert(
      REGISTRY_SRC.includes(`"${planned.plan.actor_key}"`),
      `actor_key "${planned.plan.actor_key}" is not registered in actorRegistry.ts`,
    );
  }
});

Deno.test("HOTFIX: an unavailable first stage falls through to a working second stage", async () => {
  let call = 0;
  const { p, calls } = ports({
    provider: async () => {
      call += 1;
      // Stage 1 actor unconfigured; stage 2 works.
      return call === 1
        ? { status: "unavailable" as const, error_code: "provider_not_configured" }
        : { status: "ok" as const, profiles: [F.VERIFIED_FOUNDER] as Record<string, unknown>[] };
    },
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(calls.provider, 2, "must try the second stage");
  assertEquals(r.status, "succeeded", "a working stage must not be masked by an unconfigured one");
  assertEquals(r.decision_makers[0].full_name, "Ada Kestrel");
});

Deno.test("HOTFIX: when EVERY stage is unavailable the honest outcome is still unavailable", async () => {
  const { p, calls } = ports({
    provider: async () => ({ status: "unavailable" as const, error_code: "people_search_disabled" }),
  });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(calls.provider, 2, "both stages attempted");
  assertEquals(r.status, "unavailable");
  assertEquals(r.reason_code, "people_search_disabled");
  assertEquals(r.decision_makers.length, 0);
});

Deno.test("HOTFIX: a failing first stage still surfaces failed when nothing is found", async () => {
  const { p } = ports({ provider: async () => ({ status: "failed" as const, error_code: "provider_failed" }) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "failed");
  assertEquals(r.retryable, true);
});

// ===========================================================================
// LIVE-RESULT HOTFIX REGRESSIONS
//
// Derived from the sanitized STRUCTURE of the 2026-07-18 production run
// (5 tasks, 125 rows). No real names, URLs or companies are reproduced.
//
// Observed: apify_linkedin_company_employees returned 0 rows on all 5 calls
// while reporting success, and apify_people_search returned snake_case rows
// carrying `company_linkedin_url` on 108/125 rows.
// ===========================================================================

Deno.test("HOTFIX: the company-employees plan carries a target the actor can read", () => {
  // buildHarvestApiCompanyEmployeesInput sources its target from companies[] /
  // user_input.companyUrl / a query containing a company URL. Sending only
  // `company_linkedin_url` left it with nothing to scrape, so the actor
  // succeeded with an empty dataset on every call.
  const plan = planPeopleSearch(resolveCompanyIdentity(F.TARGET_COMPANY), "company_employee_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const input = planToToolInput(plan.plan) as Record<string, unknown>;

  const companies = input.companies as string[] | undefined;
  assert(Array.isArray(companies) && companies.length === 1, "companies[] must carry the company URL");
  assert(String(companies[0]).includes("/company/"));
  assert(String(input.query ?? "").includes("/company/"), "query fallback must also carry it");
  const ui = input.user_input as Record<string, unknown> | undefined;
  assert(ui && String(ui.companyUrl ?? "").includes("/company/"), "user_input.companyUrl must carry it");
  // Safety rails preserved.
  assertEquals(input.defer_persistence, true);
  assertEquals(input.attach_to_accounts, false);
});

Deno.test("HOTFIX: no company URL → no fabricated company targeting", () => {
  const domainOnly = resolveCompanyIdentity({ company_name: "Nimbus Forge", website: "https://nimbusforge.example" });
  const plan = planPeopleSearch(domainOnly, "domain_people_search");
  assert(plan.ok);
  if (!plan.ok) return;
  const input = planToToolInput(plan.plan) as Record<string, unknown>;
  assertEquals(input.companies, undefined);
  assertEquals(input.user_input, undefined);
});

Deno.test("HOTFIX: live snake_case rows keep their company identifier", () => {
  // Structural shape observed in production: name/full_name/headline/title/
  // company/profile_url/company_linkedin_url/location — all snake_case.
  const liveShape = {
    name: "Synthetic Person",
    full_name: "Synthetic Person",
    headline: "Chief Revenue Officer at Nimbus Forge",
    title: "Chief Revenue Officer",
    company: "Nimbus Forge",
    profile_url: "https://www.linkedin.com/in/synthetic-person-x",
    company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge",
    location: "Synthetic City",
  };
  const p = normalizeProviderProfile(liveShape);
  assertEquals(p.linkedin_url, "https://www.linkedin.com/in/synthetic-person-x");
  assertEquals(p.current_company_linkedin_url, "https://www.linkedin.com/company/nimbus-forge");
  assertEquals(p.current_company_name, "Nimbus Forge");
  assertEquals(p.current_title, "Chief Revenue Officer");
});

Deno.test("HOTFIX: a live-shaped row at the target company now VERIFIES", async () => {
  const onTarget = {
    name: "Synthetic Founder", full_name: "Synthetic Founder",
    title: "Founder & CEO", company: "Nimbus Forge",
    profile_url: "https://www.linkedin.com/in/synthetic-founder-x",
    company_linkedin_url: "https://www.linkedin.com/company/nimbus-forge",
  };
  const { p } = ports({ provider: provOk([onTarget]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "succeeded");
  assertEquals(r.decision_makers[0].verification_status, "verified");
});

Deno.test("HOTFIX: off-company live rows are rejected as another employer, not 'no evidence'", async () => {
  // Previously the missing alias erased the company identifier, so a person
  // plainly at another company was filed as "no_current_employment_evidence".
  const offTarget = {
    name: "Synthetic Other", full_name: "Synthetic Other",
    title: "Chief Revenue Officer", company: "Quillstone",
    profile_url: "https://www.linkedin.com/in/synthetic-other-x",
    company_linkedin_url: "https://www.linkedin.com/company/quillstone-synthetic",
  };
  const { p } = ports({ provider: provOk([offTarget]) });
  const r = await runDecisionMakerAction(LEAD_RECORD, { workspace_id: WS }, p);
  assertEquals(r.status, "no_match");
  const reasons = (r.rejected_profiles as Array<Record<string, unknown>>).map((x) => x.reason_code);
  assertEquals(reasons, ["current_employer_is_another_company"]);
  // And it must still be a rejection — never persisted.
  assertEquals(r.persisted_count, 0);
});
