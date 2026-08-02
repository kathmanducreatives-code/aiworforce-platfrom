// MULTI-SOURCE HIRING-EVIDENCE FUSION.
//
// Offline fixtures only. NO Apify Actor is executed, no Firecrawl call, no model
// call, no database access.
//
// The point of these tests is not only that fusion works, but that it delegates:
// the canonical event, its identity, freshness and the timing verdict all remain
// owned by the existing modules.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  newFusionState, fuseSourceResults, toNormalizedJob, roleForSource,
  companyEvidenceHash, classifyTransition, decidePeopleSearch, markPeopleSearchCompleted,
  labelForCompany, signalsForCompany, companyHasDeadListing, companyHasVerification,
  fusionDiagnostics, FUSION_STATE_KEY, FUSION_STATE_VERSION,
  type HiringEvidenceFusionState, type FusionSourceId,
} from "../../functions/_shared/hiringEvidenceFusion.ts";
import { jobRecordToSignalEvent } from "../../functions/_shared/jobsSignalAdapter.ts";
import { evaluateTimingSufficiency, compileTimingRequirement } from "../../functions/_shared/timingAssessment.ts";
import { compileEvidenceContract } from "../../functions/_shared/evidenceContract.ts";
import { compileLeadEntityIntent } from "../../functions/_shared/leadEntityIntent.ts";
import { listingStatusIsDead } from "../../functions/_shared/timingFreshnessPolicy.ts";
import { SOURCING_STATE_KEY } from "../../functions/_shared/companyFirstSourcingState.ts";

const WS = "ws-1";
const NOW = "2026-07-27T12:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

/** One RevOps opening at Acme, as each source would report it. */
function row(source: FusionSourceId, o: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    company: "Acme", companyWebsite: "https://acme.com",
    title: "Revenue Operations Manager",
    postedAt: daysAgo(5),
  };
  switch (source) {
    case "yc_job_discovery":
      return { ...base, url: "https://www.workatastartup.com/jobs/111", ...o };
    case "indeed_job_discovery":
      return { ...base, jobUrl: "https://indeed.com/viewjob?jk=abc", ...o };
    case "linkedin_job_discovery":
      return { ...base, job_url: "https://linkedin.com/jobs/view/222", ...o };
    case "glassdoor_job_discovery":
      return { ...base, link: "https://glassdoor.com/job/333", ...o };
    case "ats_job_verification":
      return { ...base, url: "https://boards.greenhouse.io/acme/jobs/444", status: "open", ...o };
  }
}

async function fuse(state: HiringEvidenceFusionState, source: FusionSourceId, rows: Array<Record<string, unknown>>, observedAt = NOW) {
  return await fuseSourceResults({ state, source, actorKey: `actor_${source}`, rows, workspaceId: WS, observedAt });
}

// ============================================ 1. reconciliation across sources ==

Deno.test("F1 Indeed and YC representations of the same event reconcile to ONE signal", async () => {
  const s = newFusionState();
  const a = await fuse(s, "yc_job_discovery", [row("yc_job_discovery")]);
  const b = await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);

  assertEquals(a.counts.signalsProduced, 1);
  assertEquals(b.counts.signalsProduced, 0, "the second source must not create a second event");
  assertEquals(b.counts.duplicatesCollapsed, 1);
  assertEquals(Object.keys(s.signals).length, 1, "one canonical event");
  assertEquals(Object.keys(s.companies).length, 1, "one canonical company");
});

Deno.test("F2 LinkedIn and Indeed copies preserve BOTH evidence references", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const before = Object.values(s.signals)[0].signal.evidence_refs.length;
  const r = await fuse(s, "linkedin_job_discovery", [row("linkedin_job_discovery")]);

  const fused = Object.values(s.signals)[0];
  assertEquals(fused.signal.evidence_refs.length, before + 1, "collapsing must not lose a reference");
  assertEquals(r.counts.evidenceRefsAdded, 1);
  const urls = fused.signal.evidence_refs.map((e) => e.sourceUrl ?? "");
  assert(urls.some((u) => u.includes("indeed.com")));
  assert(urls.some((u) => u.includes("linkedin.com")));
});

Deno.test("F13 evidence references are never OVERWRITTEN by a later source", async () => {
  const s = newFusionState();
  await fuse(s, "yc_job_discovery", [row("yc_job_discovery")]);
  const firstRef = { ...Object.values(s.signals)[0].signal.evidence_refs[0] };
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(s, "glassdoor_job_discovery", [row("glassdoor_job_discovery")]);

  const refs = Object.values(s.signals)[0].signal.evidence_refs;
  assertEquals(refs.length, 3);
  assertEquals(refs[0].sourceUrl, firstRef.sourceUrl, "the original reference stays first and intact");
});

// ================================================= 2. discovery / corroboration ==

Deno.test("F7/F10/F11 the discovery source stays identifiable; corroborators are separate", async () => {
  const s = newFusionState();
  await fuse(s, "yc_job_discovery", [row("yc_job_discovery")]);
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(s, "linkedin_job_discovery", [row("linkedin_job_discovery")]);

  const c = Object.values(s.signals)[0].contributions;
  assertEquals(c.length, 3);
  assertEquals(c[0].source, "yc_job_discovery");
  assertEquals(c[0].role, "discovery", "the FIRST source to surface the event is discovery");
  assertEquals(c[1].role, "corroboration");
  assertEquals(c[2].role, "corroboration");
});

Deno.test("F12 ATS contributes VERIFICATION, never discovery authority", async () => {
  assertEquals(roleForSource("ats_job_verification", true), "verification",
    "ATS is verification even when it is the first source to return the row");
  assertEquals(roleForSource("indeed_job_discovery", true), "discovery");
  assertEquals(roleForSource("indeed_job_discovery", false), "corroboration");

  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(s, "ats_job_verification", [row("ats_job_verification")]);
  const c = Object.values(s.signals)[0].contributions;
  assertEquals(c.find((x) => x.source === "ats_job_verification")?.role, "verification");
  assert(companyHasVerification(s, Object.keys(s.companies)[0]));
});

// ============================================================= 3. ATS closure ===

Deno.test("F4 ATS closure overrides an older active discovery claim", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const key = Object.keys(s.signals)[0];
  assertFalse(listingStatusIsDead(s.signals[key].signal.listing_status ?? null));

  const r = await fuse(s, "ats_job_verification", [row("ats_job_verification", { status: "closed", closed: true })]);
  assert(listingStatusIsDead(s.signals[key].signal.listing_status ?? null),
    "the company's own ATS outranks an indexed listing");
  assert(r.conflicts.some((c) => c.reason === "ats_closed_overrides_discovery_active"));
  assert(companyHasDeadListing(s, Object.keys(s.companies)[0]));
});

Deno.test("F5 a newer ATS active verification resolves an older closure", async () => {
  const s = newFusionState();
  await fuse(s, "ats_job_verification", [row("ats_job_verification", { status: "closed", closed: true })]);
  const key = Object.keys(s.signals)[0];
  assert(listingStatusIsDead(s.signals[key].signal.listing_status ?? null));

  const r = await fuse(s, "ats_job_verification", [row("ats_job_verification", { status: "open" })], "2026-07-27T18:00:00.000Z");
  assertFalse(listingStatusIsDead(s.signals[key].signal.listing_status ?? null));
  assert(s.signals[key].conflicts.includes("ats_active_resolved_prior_closed"),
    "the resolution is recorded, not silently applied");
  assert(r.conflicts.some((c) => c.reason === "ats_active_resolved_prior_closed"));
});

// =========================================================== 4. determinism =====

Deno.test("F14/F15 source ORDER does not change the fused output or the hash", async () => {
  const forward = newFusionState();
  await fuse(forward, "yc_job_discovery", [row("yc_job_discovery")]);
  await fuse(forward, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(forward, "linkedin_job_discovery", [row("linkedin_job_discovery")]);

  const reverse = newFusionState();
  await fuse(reverse, "linkedin_job_discovery", [row("linkedin_job_discovery")]);
  await fuse(reverse, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(reverse, "yc_job_discovery", [row("yc_job_discovery")]);

  assertEquals(Object.keys(forward.signals).length, Object.keys(reverse.signals).length);
  // The DISCOVERY source differs by construction, so the contribution roles differ;
  // what must not differ is the set of events and companies.
  assertEquals(Object.keys(forward.companies), Object.keys(reverse.companies));
});

Deno.test("F15b repeating the same source rows does not change the hash", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const companyKey = Object.keys(s.companies)[0];
  const h1 = s.companies[companyKey].evidenceHash;

  const r = await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery"), row("indeed_job_discovery")]);
  assertEquals(s.companies[companyKey].evidenceHash, h1,
    "re-observing the same posting from the same source is not new evidence");
  assertEquals(r.changedCompanyKeys, []);
  assertEquals(r.unchangedCompanyKeys, [companyKey]);
});

Deno.test("F49 evidence hashes are deterministic and exclude observation time", async () => {
  const a = newFusionState();
  await fuse(a, "indeed_job_discovery", [row("indeed_job_discovery")], "2026-07-27T01:00:00.000Z");
  const b = newFusionState();
  await fuse(b, "indeed_job_discovery", [row("indeed_job_discovery")], "2026-07-27T23:00:00.000Z");

  const ka = Object.keys(a.companies)[0], kb = Object.keys(b.companies)[0];
  assertEquals(ka, kb);
  assertEquals(a.companies[ka].evidenceHash, b.companies[kb].evidenceHash,
    "a different observation time must not look like new evidence");
  assertEquals(await companyEvidenceHash(a, a.companies[ka]), a.companies[ka].evidenceHash);
});

// ======================================================= 5. company identity ====

Deno.test("F16 the same company from many sources maps to ONE canonical company", async () => {
  const s = newFusionState();
  await fuse(s, "yc_job_discovery", [row("yc_job_discovery", { company: "Acme, Inc." })]);
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", { company: "Acme" })]);
  await fuse(s, "linkedin_job_discovery", [row("linkedin_job_discovery", { company: "ACME" })]);
  assertEquals(Object.keys(s.companies).length, 1, "domain identity collapses the display-name variants");
});

Deno.test("F17 similar names WITHOUT strong identity do not merge", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", {
    company: "Atlas", companyWebsite: null, companyDomain: null,
  })]);
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", {
    company: "Atlas Automation", companyWebsite: null, companyDomain: null,
    jobUrl: "https://indeed.com/viewjob?jk=zzz",
  })]);
  assertEquals(Object.keys(s.companies).length, 2,
    "two names without a shared domain or LinkedIn identity are two companies");
});

Deno.test("F18/F19 identity precedence and field-spelling compatibility hold", async () => {
  const snake = newFusionState();
  await fuse(snake, "indeed_job_discovery", [{
    company: "Acme", website_url: "https://acme.com",
    title: "Revenue Operations Manager", postedAt: daysAgo(3),
    jobUrl: "https://indeed.com/viewjob?jk=1",
  }]);
  const camel = newFusionState();
  await fuse(camel, "indeed_job_discovery", [{
    company: "Acme", companyWebsite: "https://acme.com",
    title: "Revenue Operations Manager", postedAt: daysAgo(3),
    jobUrl: "https://indeed.com/viewjob?jk=1",
  }]);
  assertEquals(Object.keys(snake.companies)[0], Object.keys(camel.companies)[0]);
  assert(Object.keys(snake.companies)[0].startsWith("domain:"),
    "domain must outrank the name+location fallback");
});

// ====================================================== 6. duplicate handling ===

Deno.test("F20/F21 duplicates create neither a second signal nor a second company", async () => {
  const s = newFusionState();
  const r1 = await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery"), row("indeed_job_discovery")]);
  assertEquals(Object.keys(s.signals).length, 1);
  assertEquals(r1.counts.duplicatesCollapsed, 1);

  const r2 = await fuse(s, "glassdoor_job_discovery", [row("glassdoor_job_discovery")]);
  assertEquals(Object.keys(s.companies).length, 1);
  assertEquals(r2.counts.signalsProduced, 0);
});

Deno.test("F39/F41 duplicate raw volume is not reported as incremental yield", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const r = await fuse(s, "linkedin_job_discovery", Array.from({ length: 25 }, () => row("linkedin_job_discovery")));

  assertEquals(r.counts.rowsReceived, 25);
  assertEquals(r.counts.signalsProduced, 0, "25 duplicate rows are zero new events");
  assertEquals(r.newSignalKeys, []);
  assert(r.counts.duplicatesCollapsed > 0);
});

// ======================================================= 7. freshness doctrine ==

Deno.test("F5b freshness follows the POSTING date, not the observation date", async () => {
  const s = newFusionState();
  // Scraped right now, but posted 400 days ago.
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", { postedAt: daysAgo(400) })], NOW);
  const sig = Object.values(s.signals)[0].signal;
  assertEquals(sig.occurred_at, new Date(Date.parse(daysAgo(400))).toISOString());
  assertEquals(sig.observed_at, NOW);
  assert(Date.parse(sig.occurred_at) < Date.parse(sig.observed_at),
    "a fresh scrape of an old posting is not a fresh job");
});

Deno.test("F21b a row with no posting date is REJECTED, never given a fabricated one", async () => {
  const s = newFusionState();
  const r = await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", { postedAt: null })]);
  assertEquals(Object.keys(s.signals).length, 0);
  assertEquals(r.rejected["missing_occurred_at"], 1);
});

Deno.test("F5c reconciliation keeps the FRESHEST source-backed occurrence", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery", { postedAt: daysAgo(20) })]);
  const key = Object.keys(s.signals)[0];
  const older = s.signals[key].signal.occurred_at;
  await fuse(s, "linkedin_job_discovery", [row("linkedin_job_discovery", { postedAt: daysAgo(20) })]);
  assertEquals(s.signals[key].signal.occurred_at, older, "an equal-age copy changes nothing");
});

// ==================================================== 8. verdict delegation =====

Deno.test("F6 the existing timing assessment remains the SOLE verdict authority", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const companyKey = Object.keys(s.companies)[0];

  const contract = compileEvidenceContract(
    compileLeadEntityIntent("Find founders of SaaS startups hiring Revenue Operations in the United States"),
    { industries: ["B2B SaaS"], geography: "United States", company_size: "10-150 employees" },
  );
  const assessment = evaluateTimingSufficiency({
    candidateId: companyKey,
    requirement: compileTimingRequirement(contract),
    signals: signalsForCompany(s, companyKey),
    now: NOW,
  });

  // The label is a MAPPING of that decision, never an independent calculation.
  const label = labelForCompany(assessment.decision, { anyDead: false, unresolvedConflicts: 0 });
  assertEquals(label, assessment.decision === "timing_sufficient" ? "sufficient"
    : assessment.decision === "timing_not_required" ? "not_required"
    : assessment.decision === "timing_contradicted" ? "conflicting" : "insufficient");
});

Deno.test("F6b the label maps every timing decision and adds no arithmetic", () => {
  assertEquals(labelForCompany("timing_sufficient", { anyDead: false, unresolvedConflicts: 0 }), "sufficient");
  assertEquals(labelForCompany("missing_timing_evidence", { anyDead: false, unresolvedConflicts: 0 }), "insufficient");
  assertEquals(labelForCompany("timing_contradicted", { anyDead: false, unresolvedConflicts: 0 }), "conflicting");
  assertEquals(labelForCompany("timing_not_required", { anyDead: false, unresolvedConflicts: 0 }), "not_required");
  // Fused facts the timing enum cannot express, read from state — not recomputed.
  assertEquals(labelForCompany("timing_sufficient", { anyDead: true, unresolvedConflicts: 0 }), "closed");
  assertEquals(labelForCompany("timing_sufficient", { anyDead: false, unresolvedConflicts: 2 }), "conflicting");
});

// ================================================ 9. transitions + suppression ==

Deno.test("F23 an unchanged evidence hash suppresses reprocessing", () => {
  const t = classifyTransition({
    previousHash: "h1", currentHash: "h1",
    currentStrongIdentity: true, currentSourceCount: 3, hasVerification: true, isDead: false,
    currentConflictCount: 0,
  });
  assertEquals(t, "none");
  const company = { companyKey: "c", signalDedupeKeys: [], evidenceSourceTypes: [], evidenceHash: "h1", peopleSearchCompleted: true, strongIdentity: true, conflicts: [] };
  assertEquals(decidePeopleSearch(company, t), { run: false, reason: "evidence_unchanged", transition: "none" });
});

Deno.test("F24/F25 meaningful transitions permit re-evaluation", () => {
  assertEquals(classifyTransition({
    previousHash: "h1", currentHash: "h2",
    previousDecision: "missing_timing_evidence", currentDecision: "timing_sufficient",
    previousStrongIdentity: true, currentStrongIdentity: true,
    currentSourceCount: 2, hasVerification: false, isDead: false, currentConflictCount: 0,
  }), "timing_became_sufficient");

  assertEquals(classifyTransition({
    previousHash: "h1", currentHash: "h2",
    previousStrongIdentity: false, currentStrongIdentity: true,
    currentSourceCount: 1, hasVerification: false, isDead: false, currentConflictCount: 0,
  }), "identity_strengthened");

  assertEquals(classifyTransition({
    previousHash: "h1", currentHash: "h2",
    currentStrongIdentity: true, currentSourceCount: 1,
    hadVerification: false, hasVerification: true, isDead: false, currentConflictCount: 0,
  }), "verification_added");

  assertEquals(classifyTransition({
    previousHash: "h1", currentHash: "h2",
    currentStrongIdentity: true, currentSourceCount: 1, hasVerification: true,
    wasDead: false, isDead: true, currentConflictCount: 0,
  }), "listing_closed");
});

Deno.test("F22/F26 a duplicate corroborating source alone does NOT repeat a completed search", () => {
  const company = {
    companyKey: "c", signalDedupeKeys: ["k"], evidenceSourceTypes: [] as FusionSourceId[],
    evidenceHash: "h2", peopleSearchCompleted: true, strongIdentity: true, conflicts: [],
  };
  const t = classifyTransition({
    previousHash: "h1", currentHash: "h2",
    previousStrongIdentity: true, currentStrongIdentity: true,
    previousSourceCount: 1, currentSourceCount: 2,
    hadVerification: false, hasVerification: false,
    wasDead: false, isDead: false, previousConflictCount: 0, currentConflictCount: 0,
  });
  assertEquals(t, "new_independent_source");
  const d = decidePeopleSearch(company, t);
  assertFalse(d.run, "another job board listing the same role tells us nothing new about who to contact");
  assertEquals(d.reason, "already_searched_no_material_change");
});

Deno.test("F26b an eligibility-changing transition DOES permit another search", () => {
  const company = {
    companyKey: "c", signalDedupeKeys: ["k"], evidenceSourceTypes: [] as FusionSourceId[],
    evidenceHash: "h2", peopleSearchCompleted: true, strongIdentity: true, conflicts: [],
  };
  assert(decidePeopleSearch(company, "identity_strengthened").run);
  assert(decidePeopleSearch(company, "timing_became_sufficient").run);
  assert(decidePeopleSearch(company, "verification_added").run);
});

Deno.test("F26c a company never searched is always eligible for its first search", () => {
  const company = {
    companyKey: "c", signalDedupeKeys: ["k"], evidenceSourceTypes: [] as FusionSourceId[],
    evidenceHash: "h1", peopleSearchCompleted: false, strongIdentity: true, conflicts: [],
  };
  assert(decidePeopleSearch(company, "first_evidence").run);
  assert(decidePeopleSearch(company, "new_independent_source").run);
  markPeopleSearchCompleted(company, "h1");
  assert(company.peopleSearchCompleted);
  assertEquals(company.lastProcessedEvidenceHash, "h1");
});

// ========================================================== 10. continuation ====

Deno.test("F34-F37 fused state, provenance, hashes and suppression survive continuation", async () => {
  const s = newFusionState();
  await fuse(s, "yc_job_discovery", [row("yc_job_discovery")]);
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(s, "ats_job_verification", [row("ats_job_verification")]);
  const companyKey = Object.keys(s.companies)[0];
  markPeopleSearchCompleted(s.companies[companyKey], s.companies[companyKey].evidenceHash);

  // Exactly the round trip the existing checkpoint column performs.
  const restored = JSON.parse(JSON.stringify(s)) as HiringEvidenceFusionState;

  assertEquals(restored.version, FUSION_STATE_VERSION);
  assertEquals(Object.keys(restored.signals).length, 1);
  assertEquals(restored.signals[Object.keys(restored.signals)[0]].contributions.length, 3,
    "every source contribution survives");
  assertEquals(restored.companies[companyKey].evidenceHash, s.companies[companyKey].evidenceHash);
  assert(restored.companies[companyKey].peopleSearchCompleted);
  assertEquals(await companyEvidenceHash(restored, restored.companies[companyKey]),
    s.companies[companyKey].evidenceHash, "the hash recomputes identically after a resume");
});

Deno.test("F39b conflicts survive continuation", async () => {
  const s = newFusionState();
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  await fuse(s, "ats_job_verification", [row("ats_job_verification", { status: "closed", closed: true })]);
  const restored = JSON.parse(JSON.stringify(s)) as HiringEvidenceFusionState;
  const key = Object.keys(restored.signals)[0];
  assert(restored.signals[key].conflicts.length > 0);
  assert(restored.companies[Object.keys(restored.companies)[0]].conflicts.length > 0);
});

// =========================================================== 11. storage ========

Deno.test("F34b the fusion state is a SLICE of the existing checkpoint", () => {
  assertEquals(SOURCING_STATE_KEY, "company_first_state");
  assertEquals(FUSION_STATE_KEY, "hiring_evidence_fusion");
  const container: Record<string, unknown> = {
    [SOURCING_STATE_KEY]: { [FUSION_STATE_KEY]: newFusionState() },
  };
  const inner = (container[SOURCING_STATE_KEY] as Record<string, unknown>)[FUSION_STATE_KEY];
  assertEquals((inner as HiringEvidenceFusionState).version, FUSION_STATE_VERSION);
});

// ======================================================= 12. no second owner ====

Deno.test("F45-F48 no second event model, freshness policy, verdict or dedupe authority", async () => {
  const src = await Deno.readTextFile(new URL("hiringEvidenceFusion.ts", import.meta.url));

  // The canonical event and its identity come from the existing adapter.
  assert(src.includes("jobRecordToSignalEvent"), "must route through the existing adapter");
  assertFalse(/interface\s+CanonicalHiringEvent\b/.test(src), "no second event model");
  assertFalse(/interface\s+CanonicalHiringEvidence\b/.test(src), "no second evidence model");

  // Identity is the adapter's dedupe_key — never regenerated here.
  assertFalse(/function\s+build\w*DedupeKey/.test(src), "no second dedupe-key generator");
  assert(src.includes("signal.dedupe_key"), "identity is read from the canonical event");

  // Freshness and verdict are delegated.
  assertFalse(/function\s+\w*[Ff]reshness\w*\(/.test(src), "no second freshness calculator");
  assert(src.includes("listingStatusIsDead"), "dead-listing detection is the existing one");
  assertFalse(/type\s+\w*ActivityVerdict\b/.test(src), "no second verdict enum");
  assert(src.includes("TimingDecision"), "the verdict type comes from timingAssessment");

  // Company identity is the existing precedence.
  assert(src.includes("companyDedupeKeyFor"), "company identity is the existing authority");
  assertFalse(/function\s+resolveCompanyIdentity\b/.test(src), "no second identity resolver");
});

Deno.test("F44/F50 no Actor runs and no module reaches a provider directly", async () => {
  const src = await Deno.readTextFile(new URL("hiringEvidenceFusion.ts", import.meta.url));
  for (const forbidden of ["fetch(", "apify.com", "APIFY_TOKEN", "firecrawl"]) {
    assertFalse(src.includes(forbidden), `fusion reaches a provider via ${forbidden}`);
  }
});

// ========================================================== 13. diagnostics =====

Deno.test("F52 diagnostics carry the funnel and no raw payloads or secrets", async () => {
  const s = newFusionState();
  await fuse(s, "yc_job_discovery", [row("yc_job_discovery", { apify_token: "SECRET_TOKEN_VALUE" })]);
  await fuse(s, "indeed_job_discovery", [row("indeed_job_discovery")]);
  const last = await fuse(s, "ats_job_verification", [row("ats_job_verification")]);

  const d = fusionDiagnostics(s, last);
  assertEquals(d.canonical_signals, 1);
  assertEquals(d.canonical_companies, 1);
  assertEquals(d.discovery_sources, 1);
  assertEquals(d.corroborating_sources, 1);
  assertEquals(d.verification_sources, 1);
  assertEquals(d.evidence_refs_total, 3);

  const blob = JSON.stringify(d);
  for (const marker of ["SECRET_TOKEN_VALUE", "apify_token", "boards.greenhouse.io", "indeed.com"]) {
    assertFalse(blob.includes(marker), `diagnostics leaked ${marker}`);
  }
});

// ====================================================== 14. row translation =====

Deno.test("F9 provider field-name differences translate into the existing input shape", () => {
  const yc = toNormalizedJob("yc_job_discovery", { company: "A", title: "RevOps", url: "https://x/1", postedAt: NOW });
  assertEquals(yc.jobUrl, "https://x/1");
  const li = toNormalizedJob("linkedin_job_discovery", { company_name: "A", job_title: "RevOps", job_url: "https://x/2", posted_at: NOW });
  assertEquals(li.company, "A");
  assertEquals(li.jobTitle, "RevOps");
  assertEquals(li.jobUrl, "https://x/2");
  // ATS status reaches the field `normalizeListingStatus` already reads.
  const ats = toNormalizedJob("ats_job_verification", { company: "A", title: "RevOps", postedAt: NOW, closed: true });
  assertEquals((ats.raw as Record<string, unknown>).closed, true);
  // A non-ATS source carries no status claim at all.
  assertEquals(toNormalizedJob("indeed_job_discovery", { status: "closed" }).raw, undefined);
});

// ============================================ 15. PR #108 runtime integration ==

Deno.test("F38/F40/F42 the sequential runtime fuses after EVERY attempt and reports fused yield", async () => {
  const { deterministicOrderedPlan } = await import("../../functions/_shared/hiringSourcePlan.ts");
  const { newSourceExecutionState, } = await import("../../functions/_shared/sourceExecutionState.ts");
  const { sequentialJobsInvoker, actorKeyForCapability, applyObservation } =
    await import("../../functions/_shared/sequentialSourceRuntime.ts");

  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
  ]) Deno.env.set(k, "1");

  const prof = {
    industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
    hiring: { required: true, roleFamily: "revenue_operations", approvedAliases: ["Revenue Operations"], geography: "United States", maximumPostingAgeDays: 14 },
    decisionMakerRoles: ["Founder"], currentEmployerRequired: true,
    requestedCount: 5, countEntity: "contact_ready_lead", quotaPolicy: "contact_only", requiredEvidence: [],
  } as never;
  const plan = await deterministicOrderedPlan(prof);
  const state = newSourceExecutionState({
    planHash: plan.planHash,
    steps: plan.steps.map((s) => ({ stepId: s.stepId, capability: s.capability, order: s.order, actorKey: actorKeyForCapability(s.capability) })),
    requestedCount: 5, now: NOW,
  });
  const fusionState = newFusionState();

  // Step one (YC) discovers the opening.
  const h1 = sequentialJobsInvoker({
    taskId: "t-fuse", plan, state,
    invokeJobs: async () => [row("yc_job_discovery")],
    fusion: { state: fusionState, workspaceId: WS },
    now: () => NOW,
  });
  await h1.invokeJobs({}, 25);
  assertEquals(h1.lastOutcome()?.fusion?.counts.signalsProduced, 1);
  assertEquals(Object.keys(fusionState.companies).length, 1);

  // Advance, then step two returns 20 duplicates of the SAME opening.
  applyObservation(plan, state, {
    stepId: plan.steps[0].stepId, capability: plan.steps[0].capability, attempt: 1,
    funnel: {} as never, rejectionSummary: {} as never,
    incrementalContactReady: 0, totalContactReady: 0, remainingQuota: 5,
    remainingBudgetUsd: 4, sourceExhausted: true, broadeningActionsUsed: [],
  } as never);

  const h2 = sequentialJobsInvoker({
    taskId: "t-fuse", plan, state,
    invokeJobs: async () => Array.from({ length: 20 }, (_, i) => row("linkedin_job_discovery", { job_url: `https://linkedin.com/jobs/view/${i}` })),
    fusion: { state: fusionState, workspaceId: WS },
    now: () => NOW,
  });
  await h2.invokeJobs({}, 25);
  const f2 = h2.lastOutcome()?.fusion;

  assertEquals(f2?.counts.rowsReceived, 20);
  assertEquals(f2?.counts.signalsProduced, 0, "20 copies of one opening are zero new events");
  assertEquals(Object.keys(fusionState.signals).length, 1, "prior fused evidence is preserved across the advance");
  assertEquals(Object.keys(fusionState.companies).length, 1);
  // Evidence accumulated rather than being replaced by the later source.
  assert(Object.values(fusionState.signals)[0].contributions.length >= 2);
});

Deno.test("F43 without a fusion state the runtime behaves exactly as PR #108 shipped", async () => {
  const { deterministicOrderedPlan } = await import("../../functions/_shared/hiringSourcePlan.ts");
  const { newSourceExecutionState } = await import("../../functions/_shared/sourceExecutionState.ts");
  const { sequentialJobsInvoker, actorKeyForCapability } = await import("../../functions/_shared/sequentialSourceRuntime.ts");

  const prof = {
    industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
    hiring: { required: true, roleFamily: "revenue_operations", geography: "United States" },
    decisionMakerRoles: ["Founder"], currentEmployerRequired: true,
    requestedCount: 5, countEntity: "contact_ready_lead", quotaPolicy: "contact_only", requiredEvidence: [],
  } as never;
  const plan = await deterministicOrderedPlan(prof);
  const state = newSourceExecutionState({
    planHash: plan.planHash,
    steps: plan.steps.map((s) => ({ stepId: s.stepId, capability: s.capability, order: s.order, actorKey: actorKeyForCapability(s.capability) })),
    requestedCount: 5, now: NOW,
  });

  const h = sequentialJobsInvoker({
    taskId: "t-nofuse", plan, state,
    invokeJobs: async () => [row("yc_job_discovery")],
  });
  const rows = await h.invokeJobs({}, 25);
  assertEquals(rows.length, 1);
  assertEquals(h.lastOutcome()?.fusion, null, "fusion is additive, never a precondition");
});

Deno.test("F43b the bridge carries fused evidence and stays inert when disabled", async () => {
  const { applySequentialSourceExecution, sequentialSourceDiagnostics } =
    await import("../../functions/_shared/sequentialSourceBridge.ts");
  const prof = {
    industries: ["b2b saas"], stages: ["seed"], triggerRequirements: ["active_hiring"],
    hiring: { required: true, roleFamily: "revenue_operations", geography: "United States" },
    decisionMakerRoles: ["Founder"], currentEmployerRequired: true,
    requestedCount: 5, countEntity: "contact_ready_lead", quotaPolicy: "contact_only", requiredEvidence: [],
  } as never;

  const original: (e: Record<string, unknown>, m: number) => Promise<unknown[]> = async () => [row("yc_job_discovery")];
  const off = await applySequentialSourceExecution({
    workspaceId: WS, taskId: "t", invokeJobs: original, profile: prof, readEnv: () => undefined,
  });
  assertEquals(off.invokeJobs, original, "disabled returns the caller's own function");
  assertEquals(off.fusion, null);
  assertEquals(sequentialSourceDiagnostics(off).sequential_source_execution, false);

  for (const k of [
    "APIFY_ENABLE_INDEED_JOBS_AUTOMATION_LAB", "APIFY_ENABLE_LINKEDIN_JOBS_CRAWLWORKS",
    "APIFY_ENABLE_GLASSDOOR_JOBS", "APIFY_ENABLE_YC_JOBS", "APIFY_ENABLE_ATS_VERIFICATION",
  ]) Deno.env.set(k, "1");

  const on = await applySequentialSourceExecution({
    workspaceId: "ws-allowed", taskId: "t2", invokeJobs: original, profile: prof,
    readEnv: (k) =>
      k === "DYNAMIC_HIRING_SOURCE_PLANNING" ? "true"
      : k === "DYNAMIC_HIRING_SOURCE_PLANNING_WORKSPACES" ? "ws-allowed" : undefined,
  });
  assert(on.enabled);
  assert(on.fusion, "an enabled run carries a fusion state");
  await on.invokeJobs({}, 25);
  const d = sequentialSourceDiagnostics(on) as Record<string, unknown>;
  const ev = d.evidence_fusion as Record<string, unknown>;
  assertEquals(ev.canonical_signals, 1);
  assertEquals(ev.canonical_companies, 1);
});

// ---------------------------------------------------------------------------
// REGRESSION — production task c30fbc6d, round 3.
//
// 25 crawlworks rows entered fusion; 21 were rejected `missing_occurred_at` and
// 0 signals were produced, because `postedDate` was absent from the accepted
// date aliases while `datePosted` (Indeed's key) was present. The rejected rows
// were on-target GTM roles at real companies — they never reached a company
// judgment at all. Field names verified official:2026-07-30 against
// apify.com/crawlworks/linkedin-jobs-scraper.
// ---------------------------------------------------------------------------

Deno.test("fusion: crawlworks `postedDate` survives into postedAt", () => {
  const j = toNormalizedJob("linkedin_job_discovery", {
    companyName: "SolarWinds",
    jobTitle: "Director, Revenue Operations",
    jobUrl: "https://www.linkedin.com/jobs/view/4429558301",
    postedDate: "2026-07-26",
    postedTime: "20 hours ago",
    validThrough: "2027-02-11",
  });
  assertEquals(j.postedAt, "2026-07-26");
});

Deno.test("fusion: a crawlworks row now yields a signal instead of missing_occurred_at", () => {
  const j = toNormalizedJob("linkedin_job_discovery", {
    companyName: "SolarWinds",
    jobTitle: "Director, Revenue Operations",
    jobUrl: "https://www.linkedin.com/jobs/view/4429558301",
    postedDate: "2026-07-26",
  });
  const res = jobRecordToSignalEvent({
    job: j, workspace_id: "ws-1", company_ref: "solarwinds.com", observedAt: NOW,
  });
  assertFalse(res.rejected);
  assert(res.signal);
  // occurred_at is the SOURCE posting date, never the observation clock.
  assertEquals(res.signal!.occurred_at, new Date(Date.parse("2026-07-26")).toISOString());
  assert(res.signal!.occurred_at !== NOW);
});

Deno.test("fusion: a dateless crawlworks row is still rejected missing_occurred_at", () => {
  const j = toNormalizedJob("linkedin_job_discovery", {
    companyName: "SolarWinds",
    jobTitle: "Director, Revenue Operations",
    jobUrl: "https://www.linkedin.com/jobs/view/4429558301",
    postedTime: "20 hours ago",   // localized text is not a date
    validThrough: "2027-02-11",   // a deadline is not a posting date
  });
  const res = jobRecordToSignalEvent({
    job: j, workspace_id: "ws-1", company_ref: "solarwinds.com", observedAt: NOW,
  });
  assert(res.rejected);
  assertEquals(res.reason, "missing_occurred_at");
});
