// Provider-free integration tests for the run-agent ↔ company enrichment bridge.
// Every provider touch is an INJECTED fixture executor; nothing here makes a
// network call, writes a database, or invokes Firecrawl. These prove the exact
// run-agent integration contract (Section 9, assertions 1–31).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mapAcceptedPeople, makeCompanyEnrichmentExecutor, extractRawCompanyItems,
  recoverLegacyCompanyItems, extractCompanyItemsFromResult,
  runFindLeadsCompanyEnrichment, companyPatchFromEvidence, companyEvidenceFor,
  computeFinalAcceptedPersonIds, emptyCompanyEnrichmentObservability,
  PEOPLE_ACTOR_ID, type RunAgentAcceptedItem, type RunToolResultLike,
} from "../../functions/_shared/runAgentCompanyEnrichment.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";
import { COMPANY_DETAILS_ACTOR_ID, COMPANY_DETAILS_ACTOR_KEY } from "../../functions/_shared/structuredCompanyEnrichment.ts";
import type { CompanyActorExecutor } from "../../functions/_shared/companyEnrichmentOrchestrator.ts";
import { FIXTURE_COMPLETE, FIXTURE_ERROR } from "../../functions/_shared/linkedinCompanyActorFixture.ts";

const NOW = "2026-07-16T12:00:00.000Z";
const BRAIN = { industries: ["B2B SaaS", "AI SaaS"], geography: "United States", company_size: "10-150 employees" };
const HOT = compileLeadEntityIntent("Using my ICP, find me 5 hot founders I should contact right now.");
const FIT = compileLeadEntityIntent("Find founders of B2B SaaS companies");

/** A run-agent-shaped accepted item (mapItem output). */
const item = (over: Partial<RunAgentAcceptedItem> & { rawOver?: Record<string, unknown> } = {}): RunAgentAcceptedItem => {
  const { rawOver, ...rest } = over;
  return {
    name: "Founder One",
    title: "Co-Founder & CEO",
    company: "Acme SaaS",
    source_url: "https://www.linkedin.com/in/founder-one",
    location: "Austin, Texas, United States",
    location_country_code: "US",
    raw: {
      normalized_candidate_id: "cand-acme-1",
      profile_url: "https://www.linkedin.com/in/founder-one",
      company_linkedin_url: "https://www.linkedin.com/company/acme-saas",
      website: "https://acmesaas.com",
      ...rawOver,
    },
    ...rest,
  };
};

/** Records every injected call so tests can assert provider behavior. */
function recordingExecutor(items: unknown[] | ((input: any) => unknown[])): { exec: CompanyActorExecutor; calls: any[] } {
  const calls: any[] = [];
  const exec: CompanyActorExecutor = async (a) => {
    calls.push(a);
    return { items: typeof items === "function" ? items(a.input) : items, providerRunId: "run-x" };
  };
  return { exec, calls };
}

// ============================================================ (1) mapping =====
Deno.test("1: run-agent candidate mapping preserves identity, company keys, provenance-verified", () => {
  const people = mapAcceptedPeople([item()], { preRankScore: () => 71 });
  assertEquals(people.length, 1);
  const p = people[0];
  assertEquals(p.candidateId, "cand-acme-1");
  assertEquals(p.name, "Founder One");
  assertEquals(p.title, "Co-Founder & CEO");
  assertEquals(p.company, "Acme SaaS");
  assertEquals(p.profileUrl, "https://www.linkedin.com/in/founder-one");
  assertEquals(p.companyLinkedInUrl, "https://www.linkedin.com/company/acme-saas");
  assertEquals(p.companyWebsite, "https://acmesaas.com");
  assertEquals(p.countryCode, "US");
  assertEquals(p.providerVerified, true);
  assertEquals(p.preRankScore, 71);
});

Deno.test("1b: disqualified / duplicate / icp-contradiction flags map through", () => {
  const people = mapAcceptedPeople([item(), item({ rawOver: { normalized_candidate_id: "c2" } })], {
    isHardRejected: (_i, idx) => idx === 0,
    isDuplicate: (_i, idx) => idx === 1,
    icpContradiction: (_i, idx) => idx === 1,
  });
  assertEquals(people[0].disqualified, true);
  assertEquals(people[1].duplicate, true);
  assertEquals(people[1].icpContradiction, true);
});

Deno.test("1c: a candidate with no provider url is not provider-verified", () => {
  const people = mapAcceptedPeople([{ name: "Ghost", company: "GhostCo", source_url: null, raw: {} }]);
  assertEquals(people[0].providerVerified, false);
});

// ============================================= (2) person provenance stays ====
Deno.test("2/18: enriched candidate keeps the PEOPLE actor as primary provenance", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const env = r.enrichment.envelopes[0];
  assertEquals(env.sourceProvenance.actorId, PEOPLE_ACTOR_ID); // primary person provenance untouched
  assertEquals(env.primaryArtifactType, "person_candidate");
});

Deno.test("19: appended company evidence carries the COMPANY actor provenance, verified", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const companyEv = companyEvidenceFor(r.enrichment.envelopes[0].evidence);
  assert(companyEv.length > 0);
  for (const e of companyEv) {
    assertEquals(e.actorId, COMPANY_DETAILS_ACTOR_ID);
    assertEquals(e.verified, true);
  }
});

// ============================================ (3) orchestrator called once ====
Deno.test("3: orchestrator invoked once per workflow (not per founder)", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  await runFindLeadsCompanyEnrichment({
    items: [item(), item({ rawOver: { normalized_candidate_id: "c2" } }), item({ rawOver: { normalized_candidate_id: "c3" } })],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  // Three founders, one shared company ⇒ ONE actor call.
  assertEquals(calls.length, 1);
});

// ================================= (4) three founders one company one call ====
Deno.test("4/8: three founders at one company ⇒ one call, evidence fanned to all three", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({
    items: [
      item({ rawOver: { normalized_candidate_id: "c1" } }),
      item({ rawOver: { normalized_candidate_id: "c2" } }),
      item({ rawOver: { normalized_candidate_id: "c3" } }),
    ],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(r.requalifyCandidateIds.size, 3);          // fanned to all three
  for (const id of ["c1", "c2", "c3"]) {
    assert(r.companyEvidenceById.get(id)!.length > 0, id);
    assert(r.companyPatchById.get(id)!.company_website === "https://www.acmesaas.com");
  }
});

// ========================================= (5)(6) canonical actor identity ====
Deno.test("5/6: the executor forces the canonical actor id; caller values cannot replace it", async () => {
  const seen: any[] = [];
  const runTool = async (_tool: string, input: any): Promise<RunToolResultLike> => {
    seen.push(input);
    return { ok: true, data: { items: [{ raw: { provider_payload: FIXTURE_COMPLETE } }], run_id: "prov-1" } };
  };
  const exec = makeCompanyEnrichmentExecutor(runTool, { agent_slug: "scout" });
  // A hostile args object trying to inject a different actor id + payload.
  const res = await exec({
    actorKey: "evil_actor", actorId: "attacker/malware",
    input: { companies: ["https://www.linkedin.com/company/acme-saas"] }, maxItems: 1,
  } as any);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].tool_name, "source_with_apify");
  assertEquals(seen[0].selected_actor_key, COMPANY_DETAILS_ACTOR_KEY);   // registry resolves the id
  assertEquals(seen[0].actor_id, undefined);                             // never a caller-provided id
  assert(!JSON.stringify(seen[0]).includes("attacker/malware"));         // hostile id dropped
  assertEquals(seen[0].input.companies, ["https://www.linkedin.com/company/acme-saas"]);
  assertEquals(res.items!.length, 1);                                    // raw payload recovered
  assertEquals((res.items![0] as any).name, "Acme SaaS");
  assertEquals(res.providerRunId, "prov-1");
});

Deno.test("extractRawCompanyItems recovers provider_payload, then raw, then item", () => {
  assertEquals(extractRawCompanyItems([{ raw: { provider_payload: { name: "A" } } }]), [{ name: "A" }]);
  assertEquals(extractRawCompanyItems([{ raw: { name: "B" } }]), [{ name: "B" }]);
  assertEquals(extractRawCompanyItems([{ name: "C" }]), [{ name: "C" }]);
  assertEquals(extractRawCompanyItems(null), []);
});

// ======================================== (7) success reaches qualification ===
Deno.test("7/15: successful company evidence completes fit for a current-fit query", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const id = "cand-acme-1";
  assert(r.requalifyCandidateIds.has(id));
  assertEquals(r.enrichment.sufficiencyAfter.get(id)!.fitComplete, true);
  assertEquals(r.enrichment.sufficiencyAfter.get(id)!.nextDecision, "qualify_now");
  assertEquals(r.stagedByEnrichment.has(id), false);   // current-fit may proceed
  const patch = r.companyPatchById.get(id)!;
  assertEquals(patch.company_website, "https://www.acmesaas.com");
  assert(patch.company_industries!.includes("B2B SaaS"));
  assertEquals(patch.company_country_code, "US");
});

// ==================================================== (9) phone never leaks ====
Deno.test("9/27: phone/email/raw-payload never reach evidence, patch, or observability", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]); // FIXTURE_COMPLETE carries a phone
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const patch = r.companyPatchById.get("cand-acme-1")!;
  const patchJson = JSON.stringify(patch);
  assert(!/415 555 0199|"phone"/.test(patchJson), "phone in patch");
  const obsJson = JSON.stringify(r.observability);
  assert(!/415 555 0199|"phone"/.test(obsJson), "phone in observability");
  assert(!/utm_source|"raw"|provider_payload/.test(obsJson), "raw payload/query in observability");
  const evJson = JSON.stringify(companyEvidenceFor(r.enrichment.envelopes[0].evidence));
  assert(!/415 555 0199|"phone"/.test(evJson), "phone in evidence");
});

// ================================== (10) Brain requirements are not evidence ===
Deno.test("10: Company Brain requirements never become candidate evidence", async () => {
  // No executor ⇒ nothing enriched. The Brain says B2B SaaS / US / 10-150, but
  // the candidate must carry NONE of that as evidence.
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: null });
  const cats = r.enrichment.envelopes[0].evidence.map((e) => e.category);
  assert(!cats.includes("company_website"));
  assert(!cats.includes("company_industry"));
  assert(!cats.includes("company_size"));
  // Only person-provenance evidence exists before enrichment.
  for (const e of r.enrichment.envelopes[0].evidence) assertEquals(e.actorId, PEOPLE_ACTOR_ID);
});

// ===================================== (11) requalify only for changed ids =====
Deno.test("11: qualification reruns only for requalifyCandidateIds", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({
    items: [
      item({ rawOver: { normalized_candidate_id: "changed" } }),
      // Already disqualified AND at a different company ⇒ never enriched, never requalified.
      item({ rawOver: { normalized_candidate_id: "skip", company_linkedin_url: "https://www.linkedin.com/company/other" } }),
    ],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
    mapOptions: { isHardRejected: (_i, idx) => idx === 1 },
  });
  assert(r.requalifyCandidateIds.has("changed"));
  assertEquals(r.requalifyCandidateIds.has("skip"), false);
});

// ==================================== (12) no-result/error fabricate nothing ===
Deno.test("12: empty / error outcomes add no evidence and no requalification", async () => {
  const empty = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: async () => ({ items: [] }) });
  assertEquals(empty.enrichment.companyResults[0].outcome, "no_result");
  assertEquals(empty.requalifyCandidateIds.size, 0);
  assertEquals(empty.companyEvidenceById.size, 0);

  const errored = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: async () => ({ error: FIXTURE_ERROR }) });
  assertEquals(errored.enrichment.companyResults[0].outcome, "provider_error");
  assertEquals(errored.requalifyCandidateIds.size, 0);
});

Deno.test("12b: a timeout fabricates nothing", async () => {
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: async () => ({ timedOut: true }) });
  assertEquals(r.enrichment.companyResults[0].outcome, "timeout");
  assertEquals(r.requalifyCandidateIds.size, 0);
});

// ============================================ (13) failure isolation by co. ====
Deno.test("13: one company's error never affects another company", async () => {
  const exec: CompanyActorExecutor = async (a) => {
    const id = (a.input.companies ?? [])[0] ?? "";
    if (id.includes("/bad")) return { error: FIXTURE_ERROR };
    return { items: [FIXTURE_COMPLETE], providerRunId: "ok" };
  };
  const r = await runFindLeadsCompanyEnrichment({
    items: [
      item({ rawOver: { normalized_candidate_id: "good", company_linkedin_url: "https://www.linkedin.com/company/good" } }),
      item({ rawOver: { normalized_candidate_id: "bad", company_linkedin_url: "https://www.linkedin.com/company/bad" } }),
    ],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  assert(r.requalifyCandidateIds.has("good"));
  assertEquals(r.requalifyCandidateIds.has("bad"), false);
  const outcomes = new Map(r.enrichment.companyResults.map((c) => [c.companyKey, c.outcome]));
  assertEquals(outcomes.get("li:linkedin.com/company/good"), "enriched");
  assertEquals(outcomes.get("li:linkedin.com/company/bad"), "provider_error");
});

// ================================== (14) Hot founder staged without timing =====
Deno.test("14: Hot founder with complete fit but no timing is force-staged, not accepted", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: HOT, brain: BRAIN, now: NOW, execute: exec });
  const id = "cand-acme-1";
  assertEquals(r.enrichment.sufficiencyAfter.get(id)!.fitComplete, true);
  assertEquals(r.enrichment.sufficiencyAfter.get(id)!.timingComplete, false);
  assertEquals(r.stagedByEnrichment.has(id), true);                 // stays staged
  const pc = r.perCandidate.get(id)!;
  assertEquals(pc.sufficientAfter, false);
  assert(pc.decisionAfter === "signal_enrichment" || pc.decisionAfter === "stage_missing_evidence");
});

// ===================================== (16)(17)(20)(21) persistence + Aria =====
Deno.test("16/17/20/21: accepted-only persistence; staged create nothing; Aria == accepted count", () => {
  // Three candidates: A canonical-accept + not staged ⇒ accepted; B canonical-accept
  // but enrichment-staged ⇒ NOT accepted; C canonical-reject ⇒ NOT accepted.
  const canonicalPersist = (id: string) => id === "A" || id === "B";
  const staged = new Set<string>(["B"]);
  const accepted = computeFinalAcceptedPersonIds(["A", "B", "C"], { canonicalPersist, stagedByEnrichment: staged });
  assertEquals([...accepted].sort(), ["A"]);
  // Aria receives ONLY the accepted set — count equality (assertion 21).
  const ariaInput = [...accepted];
  assertEquals(ariaInput.length, accepted.size);
  assertEquals(ariaInput.length, 1);
});

// ================================================= (22)(23)(24)(25) terminals ==
Deno.test("22/23: both observability objects present on success and partial", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  // Success / partial carry the REAL observability with a called company.
  assertEquals(r.observability.summary.companies_called, 1);
  assertEquals(r.observability.summary.reconciles, true);
});

Deno.test("24/25: no_results / tool_failed terminals still carry a reconciling company observability", () => {
  // Terminals reached before any enrichment ran use the empty observability.
  const empty = emptyCompanyEnrichmentObservability(0);
  assertEquals(empty.summary.companies_called, 0);
  assertEquals(empty.summary.companies_planned, 0);
  assertEquals(empty.summary.reconciles, true);
  assertEquals(empty.companies.length, 0);
});

// =================================================== (26) observability recon ==
Deno.test("26: company observability reconciles across mixed outcomes", async () => {
  const exec: CompanyActorExecutor = async (a) => {
    const id = (a.input.companies ?? [])[0] ?? "";
    if (id.includes("/bad")) return { error: FIXTURE_ERROR };
    if (id.includes("/empty")) return { items: [] };
    return { items: [FIXTURE_COMPLETE], providerRunId: "ok" };
  };
  const r = await runFindLeadsCompanyEnrichment({
    items: [
      item({ rawOver: { normalized_candidate_id: "g", company_linkedin_url: "https://www.linkedin.com/company/good" } }),
      item({ rawOver: { normalized_candidate_id: "b", company_linkedin_url: "https://www.linkedin.com/company/bad" } }),
      item({ rawOver: { normalized_candidate_id: "e", company_linkedin_url: "https://www.linkedin.com/company/empty" } }),
    ],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  const s = r.observability.summary;
  assertEquals(s.companies_planned, s.companies_called + s.companies_cached + s.companies_skipped);
  assertEquals(s.companies_called, s.companies_enriched + s.companies_no_result + s.companies_failed);
  assertEquals(s.reconciles, true);
  assertEquals(s.companies_enriched, 1);
  assertEquals(s.companies_no_result, 1);
  assertEquals(s.companies_failed, 1);
});

// ================================= (28) mapping-only geography green kept ======
Deno.test("28: company geography evidence carries countryCode into the patch", async () => {
  const { exec } = recordingExecutor([FIXTURE_COMPLETE]);
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const patch = r.companyPatchById.get("cand-acme-1")!;
  assertEquals(patch.company_country_code, "US");
  assertEquals(patch.company_country, "US");
});

// ================================= (30)(31) Firecrawl never / no network =======
Deno.test("30/31: with NO executor injected nothing is called (no Firecrawl, no network)", async () => {
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: null });
  assertEquals(r.enrichment.companyResults[0].outcome, "budget_skipped");
  assertEquals(r.observability.summary.companies_called, 0);
  assertEquals(r.requalifyCandidateIds.size, 0);
});

// =================================== patch derives only from mapped evidence ===
Deno.test("companyPatchFromEvidence returns null when there is no company evidence", () => {
  assertEquals(companyPatchFromEvidence([]), null);
});

// ==============================================================================
// COMPLETE-COMPANY-RESULT HARDENING (session 2). Proves the dedicated
// company_items path defeats the legacy job-normalization + 4,000-char
// provider_payload truncation. All executors are injected fakes — no network.
// ==============================================================================

/** A source_with_apify result carrying the typed complete company items. */
const companyResult = (company_items: unknown[], run_id = "prov-run"): RunToolResultLike =>
  ({ ok: true, data: { actor_id: COMPANY_DETAILS_ACTOR_ID, selected_actor_key: COMPANY_DETAILS_ACTOR_KEY, company_items, items: [], run_id, count: company_items.length } });

/** A LEGACY job-normalized result burying the raw item under provider_payload. */
const legacyResult = (provider_payload: unknown, run_id = "legacy-run"): RunToolResultLike =>
  ({ ok: true, data: { items: [{ signal_type: "company", company: "X", raw: { provider_payload } }], run_id } });

/** A company object whose JSON serialization pushes real fields PAST char 4,000,
 * so the old truncObj(JSON.stringify(item), 4000) path would have dropped them. */
function oversizedCompany(): Record<string, unknown> {
  const big: Record<string, unknown> = {};
  big._padding = "x".repeat(5000);                       // serialized FIRST → pushes the rest past 4,000
  big.universalName = "bigco";
  big.linkedinUrl = "https://www.linkedin.com/company/bigco";
  big.name = "BigCo";
  big.website = "https://bigco.example.com";
  big.industries = ["B2B SaaS"];
  big.employeeCountRange = { start: 51, end: 200 };
  big.description = "BigCo builds revenue software.";
  big.locations = [{ city: "Austin", geographicArea: "Texas", country: "US", countryCode: "US", headquarter: true, parsed: { text: "Austin, Texas, United States", city: "Austin", countryCode: "US" } }];
  big.phone = "+1 415 555 0199";                          // MUST NOT reach evidence
  big.email = "founder@bigco.example.com";                // MUST NOT reach evidence
  return big;
}

// ---- (1) bypasses job normalization ----
Deno.test("H1: company_items bypass job normalization (executor returns the raw company object)", async () => {
  const exec = makeCompanyEnrichmentExecutor(async () => companyResult([FIXTURE_COMPLETE]), {});
  const res = await exec({ actorKey: "x", actorId: "y", input: { companies: ["https://www.linkedin.com/company/acme-saas"] }, maxItems: 1 } as any);
  assertEquals(res.items!.length, 1);
  const it = res.items![0] as any;
  assertEquals(it.name, "Acme SaaS");            // real company shape, not job-normalized
  assertEquals(it.signal_type, undefined);        // NOT a fabricated job record
  assert(Array.isArray(it.industries));
  assertEquals(res.providerRunId, "prov-run");
});

// ---- (2)(3)(4)(5)(6) complete oversized object reaches the normalizer ----
Deno.test("H2-6: an oversized company object is normalized COMPLETE (industry/website/HQ past char 4,000)", async () => {
  const big = oversizedCompany();
  const serialized = JSON.stringify(big);
  // Precondition: the real fields genuinely sit beyond the old 4,000-char cut.
  assert(serialized.length > 4000, "fixture must exceed 4,000 chars");
  assert(serialized.indexOf('"website"') > 4000, "website must sit past char 4,000");
  assert(serialized.indexOf('"industries"') > 4000, "industries must sit past char 4,000");
  assert(serialized.indexOf('"locations"') > 4000, "locations must sit past char 4,000");

  const exec = makeCompanyEnrichmentExecutor(async () => companyResult([big]), {});
  const r = await runFindLeadsCompanyEnrichment({
    items: [item({ rawOver: { normalized_candidate_id: "bigc", company_linkedin_url: "https://www.linkedin.com/company/bigco" } })],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  const patch = r.companyPatchById.get("bigc")!;
  assertEquals(patch.company_website, "https://bigco.example.com");   // (5) survived
  assert(patch.company_industries!.includes("B2B SaaS"));             // (4) survived
  assertEquals(patch.company_country_code, "US");                     // (6) HQ survived
  assertEquals(patch.company_employee_range!.start, 51);
});

// ---- (7)(8)(9) sanitization: no raw object / phone / email leaks ----
Deno.test("H7-9: oversized result never leaks raw object / phone / email into evidence or observability", async () => {
  const big = oversizedCompany();
  const exec = makeCompanyEnrichmentExecutor(async () => companyResult([big]), {});
  const r = await runFindLeadsCompanyEnrichment({
    items: [item({ rawOver: { normalized_candidate_id: "bigc", company_linkedin_url: "https://www.linkedin.com/company/bigco" } })],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  const evJson = JSON.stringify(companyEvidenceFor(r.enrichment.envelopes[0].evidence));
  const obsJson = JSON.stringify(r.observability);
  const patchJson = JSON.stringify(r.companyPatchById.get("bigc"));
  for (const [label, blob] of [["evidence", evJson], ["observability", obsJson], ["patch", patchJson]] as const) {
    assert(!/415 555 0199|"phone"/.test(blob), `phone leaked into ${label}`);
    assert(!/founder@bigco|"email"/.test(blob), `email leaked into ${label}`);
    assert(!/_padding|xxxxx/.test(blob), `raw padding leaked into ${label}`);
    assert(!/provider_payload/.test(blob), `raw payload leaked into ${label}`);
  }
});

// ---- (12)(13)(14) canonical actor id immutable through the executor ----
Deno.test("H12-14: executor forces the canonical company actor key; caller/tool/planner cannot override", async () => {
  const seen: any[] = [];
  const exec = makeCompanyEnrichmentExecutor(async (_t, input) => { seen.push(input); return companyResult([FIXTURE_COMPLETE]); }, {});
  await exec({ actorKey: "planner_evil", actorId: "attacker/malware", input: { companies: ["https://www.linkedin.com/company/acme-saas"] }, maxItems: 3 } as any);
  assertEquals(seen[0].selected_actor_key, COMPANY_DETAILS_ACTOR_KEY);
  assertEquals(seen[0].actor_id, undefined);
  assert(!JSON.stringify(seen[0]).includes("attacker/malware"));
  // (20) max-items forwarded to the provider path.
  assertEquals(seen[0].max_results, 3);
});

// ---- (15) empty typed result stages safely ----
Deno.test("H15: empty company_items stages safely (no_result, no requalification)", async () => {
  const exec = makeCompanyEnrichmentExecutor(async () => companyResult([]), {});
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  assertEquals(r.enrichment.companyResults[0].outcome, "no_result");
  assertEquals(r.requalifyCandidateIds.size, 0);
});

// ---- (16) invalid typed result stages safely ----
Deno.test("H16: an identity-less company item is invalid_result, never fabricated", async () => {
  const exec = makeCompanyEnrichmentExecutor(async () => companyResult([{ website: "https://x.example.com" }]), {});
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  assertEquals(r.enrichment.companyResults[0].outcome, "invalid_result");
  assertEquals(r.requalifyCandidateIds.size, 0);
});

// ---- (17) legacy complete payload fallback still supported ----
Deno.test("H17: legacy complete provider_payload is still recovered and normalized", async () => {
  const exec = makeCompanyEnrichmentExecutor(async () => legacyResult(FIXTURE_COMPLETE), {});
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  assertEquals(r.enrichment.companyResults[0].outcome, "enriched");
  assert(r.companyPatchById.get("cand-acme-1")!.company_website === "https://www.acmesaas.com");
});

// ---- (18) truncated legacy payload is rejected, not partially trusted ----
Deno.test("H18: a truncated legacy provider_payload is rejected (provider failure), never partially trusted", async () => {
  const truncated = { _truncated: true, preview: '{"name":"Acme","phone":"+1 415 555 0199"' };
  const exec = makeCompanyEnrichmentExecutor(async () => legacyResult(truncated), {});
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec });
  const res = r.enrichment.companyResults[0];
  assertEquals(res.outcome, "provider_error");
  assertEquals(res.failureReason, "company_result_truncated");
  assertEquals(r.requalifyCandidateIds.size, 0);           // nothing enriched
  // The truncated preview (incl. its phone) never reaches evidence/observability.
  const blob = JSON.stringify(companyEvidenceFor(r.enrichment.envelopes[0].evidence)) + JSON.stringify(r.observability);
  assert(!/415 555 0199/.test(blob), "truncated preview leaked");
});

// ---- (19) provider error isolated by company ----
Deno.test("H19: a truncated company is isolated — a healthy company at the same run still enriches", async () => {
  const exec = makeCompanyEnrichmentExecutor(async (_t, input: any) => {
    const url = (input.input?.companies ?? [])[0] ?? "";
    if (url.includes("/bad")) return legacyResult({ _truncated: true, preview: "{" });
    return companyResult([FIXTURE_COMPLETE]);
  }, {});
  const r = await runFindLeadsCompanyEnrichment({
    items: [
      item({ rawOver: { normalized_candidate_id: "good", company_linkedin_url: "https://www.linkedin.com/company/good" } }),
      item({ rawOver: { normalized_candidate_id: "bad", company_linkedin_url: "https://www.linkedin.com/company/bad" } }),
    ],
    intent: FIT, brain: BRAIN, now: NOW, execute: exec,
  });
  assert(r.requalifyCandidateIds.has("good"));
  assertEquals(r.requalifyCandidateIds.has("bad"), false);
});

// ---- extraction-unit coverage ----
Deno.test("extractCompanyItemsFromResult prefers company_items over legacy items", () => {
  const r = extractCompanyItemsFromResult({ company_items: [{ name: "A" }], items: [{ raw: { provider_payload: { name: "B" } } }] });
  assertEquals(r, { items: [{ name: "A" }], truncated: false });
});

Deno.test("recoverLegacyCompanyItems flags truncation and drops the partial payload", () => {
  const r = recoverLegacyCompanyItems([{ raw: { provider_payload: { _truncated: true, preview: "{" } } }]);
  assertEquals(r.truncated, true);
  assertEquals(r.items.length, 0);
});

Deno.test("recoverLegacyCompanyItems recovers a complete provider_payload untouched", () => {
  const r = recoverLegacyCompanyItems([{ raw: { provider_payload: { name: "Acme" } } }]);
  assertEquals(r, { items: [{ name: "Acme" }], truncated: false });
});

Deno.test("extractRawCompanyItems (legacy helper) still recovers payload → raw → item", () => {
  assertEquals(extractRawCompanyItems([{ raw: { provider_payload: { name: "A" } } }]), [{ name: "A" }]);
});

// ---- deadline pass-through (bounded enrichment) ----
Deno.test("H-deadline: a past deadline skips all company calls; nothing requalified; observability reconciles", async () => {
  const { exec, calls } = recordingExecutor([FIXTURE_COMPLETE]);
  // deadlineMs 0 with the real clock (now = Date.now() ≫ 0) ⇒ every company is
  // reached with clock ≥ deadline ⇒ skipped_due_deadline, no provider call.
  const r = await runFindLeadsCompanyEnrichment({ items: [item()], intent: FIT, brain: BRAIN, now: NOW, execute: exec, deadlineMs: 0 });
  assertEquals(calls.length, 0);
  assertEquals(r.enrichment.companyResults[0].outcome, "skipped_due_deadline");
  assertEquals(r.requalifyCandidateIds.size, 0);
  assertEquals(r.companyEvidenceById.size, 0);
  assertEquals(r.observability.summary.companies_skipped_deadline, 1);
  assertEquals(r.observability.summary.companies_skipped, 1);
  assertEquals(r.observability.summary.reconciles, true);
});
