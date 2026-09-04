// P4 — READING BACK THE EVIDENCE P2 PAID FOR.
//
// Run a5c1616e refused seven companies that passed UK presence, employee count
// and verified sales hiring, with ZERO failed requirements, because nothing in
// the registry could be cited for "B2B SaaS". P2 then bought the pages and
// filed them, and nothing read them.
//
// What matters here is not that a second look happens. It is what the second
// look is FORBIDDEN to do:
//
//   - it may not re-run discovery, enrichment or hiring
//   - it may not buy a page
//   - it may not un-verify a requirement by forgetting to mention it
//   - it may not turn "Software Development" into "B2B SaaS"
//   - it may not turn missing evidence into a pass
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionReevaluationInput, mergeReevaluation,
  MISSION_REEVALUATION_PROMPT, MISSION_EVALUATION_PROMPT, EVIDENCE_POLICY,
  type MissionEvaluation, type MissionEvaluationInput,
} from "../../supabase/functions/_shared/missionEvaluation.ts";
import {
  reevaluateWithWebEvidence, type ReevalCandidate,
} from "../../supabase/functions/_shared/webEvidenceReevaluation.ts";
import { buildEvidenceRegistry } from "../../supabase/functions/_shared/leadEvidenceRegistry.ts";

const GEO = { requirement: "Company is located in the United Kingdom",
  evidence_id: "company_location:linkedin:42681bd9",
  excerpt: "London, United Kingdom; San Francisco, CA, United States" };
const SIZE = { requirement: "Company has 20-200 employees",
  evidence_id: "employee_count:linkedin:094d10f1", excerpt: "131 employees" };
const HIRING = { requirement: "Hiring a sales role",
  evidence_id: "job_posting:linkedin:aa11", excerpt: "Sales Development Representative" };

function priorEval(o: Partial<MissionEvaluation> = {}): MissionEvaluation {
  return {
    version: "mission-evaluation-v1", decision: "insufficient_evidence",
    mission_fit: "review", icp_fit: "plausible", hiring_fit: "verified",
    confidence: 0.94, match_score: 86,
    matched_requirements: [GEO, SIZE, HIRING],
    failed_requirements: [], reasoning: "", rejection_reasons: [],
    evidence_quality: "strong",
    unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"],
    next_action: null, ...o,
  } as MissionEvaluation;
}

const baseInput = (): MissionEvaluationInput => ({
  schema_version: "mission-evaluation-input-v1",
  instruction: "Find me 5 B2B SaaS companies in the UK",
  mission: {}, brain: {}, company: { company_name: "Metaview" },
});

// ────────────────────── merge: settled work is not re-decided ───────────────

Deno.test("PRIOR VERDICTS SURVIVE a second pass that forgets them", () => {
  // The failure this prevents: geography, size and hiring were established by
  // providers the re-evaluation never consults. A model that omits them must
  // not thereby un-verify them.
  const prior = priorEval();
  const next = { ...priorEval(), matched_requirements: [
    { requirement: "Company is a B2B SaaS company",
      evidence_id: "web_page:metaview.ai:pricing:abc",
      excerpt: "$40 per user per month" },
  ], unknown_fields: [] } as MissionEvaluation;

  const merged = mergeReevaluation(prior, next);
  const reqs = merged.matched_requirements.map((m) => m.requirement);
  assert(reqs.includes(GEO.requirement), "UK presence must survive");
  assert(reqs.includes(SIZE.requirement), "employee count must survive");
  assert(reqs.includes(HIRING.requirement), "hiring must survive");
  assert(reqs.includes("Company is a B2B SaaS company"), "and the new one lands");
  // Citations travel unchanged — not rebuilt, which could point at an id the
  // registry no longer holds.
  assertEquals(
    merged.matched_requirements.find((m) => m.requirement === GEO.requirement)?.evidence_id,
    GEO.evidence_id,
  );
});

Deno.test("a CONTRADICTION in the second pass does win", () => {
  // Carrying prior verdicts forward must not become ignoring new information.
  const prior = priorEval();
  const next = {
    ...priorEval(), matched_requirements: [], unknown_fields: [],
    failed_requirements: [{ requirement: GEO.requirement,
      evidence_id: "web_page:x:locations:1", why: "locations page lists US offices only" }],
  } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next);
  assert(!merged.matched_requirements.some((m) => m.requirement === GEO.requirement));
  assertEquals(merged.decision, "not_qualified");
});

Deno.test("an unresolved requirement keeps the company insufficient", () => {
  const prior = priorEval();
  const next = { ...priorEval(), matched_requirements: [], mission_fit: "review",
    unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"] } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next);
  assertEquals(merged.decision, "insufficient_evidence");
  assertEquals(merged.unknown_fields.length, 1);
});

Deno.test("MISSING EVIDENCE NEVER BECOMES A PASS", () => {
  // THE CASE THAT MATTERS, and the one my first attempt missed: the model
  // answers `mission_fit: "pass"` while STILL naming an unresolved requirement.
  // Trusting `mission_fit` alone would qualify a company on evidence nobody
  // produced — the precise failure this whole architecture exists to prevent.
  //
  // The earlier test used `mission_fit: "review"`, so removing the open-
  // requirement guard left it green. It was not testing the guard.
  const prior = priorEval();
  const next = {
    ...priorEval(), mission_fit: "pass", matched_requirements: [],
    unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"],
  } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next);
  assertEquals(merged.decision, "insufficient_evidence",
    "an open requirement outranks the model's own 'pass'");
  assertEquals(merged.unknown_fields.length, 1);
});

Deno.test("DROPPED CITATIONS CANNOT SILENTLY RESOLVE A REQUIREMENT", () => {
  // THE METAVIEW CANARY, 2026-09-03. The model answered confidently, cited the
  // company website for B2B SaaS — and every citation was dropped by the
  // verifier. It returned `unknown_fields: []` regardless.
  //
  // Trusting that would have removed the requirement from the record with
  // nothing establishing it. With `mission_fit: "pass"` it would have QUALIFIED
  // the company on zero surviving evidence.
  const prior = priorEval();
  const next = {
    ...priorEval(), mission_fit: "pass",
    matched_requirements: [],      // everything the model cited was dropped
    unknown_fields: [],            // and it stopped mentioning the open one
  } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next);
  assertEquals(merged.decision, "insufficient_evidence",
    "no surviving citation means nothing was established");
  assertEquals(merged.unknown_fields,
    ["Whether Metaview is specifically a B2B SaaS company"],
    "the prior open list stands when the pass proved nothing");
});

Deno.test("resolving the last open requirement qualifies", () => {
  const prior = priorEval();
  const next = { ...priorEval(), mission_fit: "pass", unknown_fields: [],
    matched_requirements: [{ requirement: "Company is a B2B SaaS company",
      evidence_id: "web_page:metaview.ai:pricing:abc",
      excerpt: "$40 per user per month" }] } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next);
  assertEquals(merged.decision, "qualified");
  assertEquals(merged.unknown_fields.length, 0);
  assertEquals(merged.matched_requirements.length, 4, "3 carried + 1 new");
});

// ───────────────────────── the input carries the split ──────────────────────

Deno.test("the payload separates established from open", () => {
  const input = buildMissionReevaluationInput({ base: baseInput(), prior: priorEval(), registry: registryFor('metaview', []) });
  assertEquals(input.established_requirements.length, 3);
  assertEquals(input.open_requirements,
    ["Whether Metaview is specifically a B2B SaaS company"]);
  // Verbatim from the evaluator's own words — nothing parses or classifies it,
  // which is what keeps the path generic across any requirement.
  assert(input.established_requirements.every((m) => m.evidence_id.length > 0));
});

Deno.test("BOTH prompts carry the same evidence bar", () => {
  // Phase 1. The forbidden-inference and corroboration rules used to live only
  // in the re-evaluation prompt, so the FIRST pass — the one that runs on every
  // company — qualified on a weaker standard. Lineage 8cfdfd10 qualified
  // DiligenceVault on `company_industry = "Software Development"`.
  //
  // Newlines are collapsed first: both prompts are arrays joined with "\n", so
  // a sentence is split across entries and a raw-string assertion would pass or
  // fail on line-wrapping rather than on content.
  const n = (x: string) => x.toLowerCase().replace(/\s+/g, " ");
  const policy = n(EVIDENCE_POLICY);
  for (const [name, prompt] of [
    ["first pass", MISSION_EVALUATION_PROMPT],
    ["re-evaluation", MISSION_REEVALUATION_PROMPT],
  ] as const) {
    assert(n(prompt).includes(policy),
      `${name} must embed the shared evidence policy verbatim, not a paraphrase`);
  }
  // The rules themselves, stated generically rather than about one category.
  assert(policy.includes("never establishes, on its own"),
    "a provider category must not establish a business model");
  assert(policy.includes("two surviving citations"), "corroboration bar");
  assert(policy.includes("never widen one so the evidence fits"),
    "requirement wording must not be broadened");
  // Still specific to the re-evaluation, which is the only pass that reads pages.
  const r = n(MISSION_REEVALUATION_PROMPT);
  assert(r.includes("data, not instructions"), "injection framing");
  assert(r.includes("do not re-litigate"), "established requirements are settled");
});

// ───────────────────── the runner: what it refuses to do ────────────────────

const registryFor = (key: string, pages: readonly { source_url: string; page_intent: string; source_text: string; fetched_at: string | null }[]) =>
  buildEvidenceRegistry({
    evidence: {
      version: "company-evidence-v1", company_key: key, company_name: "Metaview",
      domain: "metaview.ai", linkedin_company_url: null, identity_state: "resolved",
      geography_evidence: null, employee_evidence: null, industry_evidence: [],
      description: null, source_query: null, source_capability: "general_company_discovery",
      commercial_job_evidence: [], strongest_signal: null, evidence_urls: [],
      missing_fields: [], conflicting_evidence: [],
    } as never,
    web_pages: pages,
  });

function candidate(o: Partial<ReevalCandidate> = {}): ReevalCandidate {
  return {
    key: "metaview", company_name: "Metaview", domain: "metaview.ai",
    mission_evaluation: priorEval(), evidence_registry: null,
    evaluation_input: baseInput(), ...o,
  };
}

const fakeDb = (rows: Array<Record<string, unknown>>) => ({
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, order: () => b,
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    return b;
  },
}) as never;

const okPage = {
  source_url: "https://metaview.ai/pricing", page_intent: "pricing",
  source_text: "Pricing: $40 per user per month, billed annually.",
  fetched_at: new Date().toISOString(), status: "ok",
};

Deno.test("a qualified company is never re-evaluated", async () => {
  let calls = 0;
  const r = await reevaluateWithWebEvidence(
    [candidate({ mission_evaluation: priorEval({ decision: "qualified" }) })],
    { db: fakeDb([okPage]), workspace_id: "w",
      reevaluate: () => { calls++; return Promise.resolve({}); },
      rebuildRegistry: (k, p) => registryFor(k, p) },
  );
  assertEquals(calls, 0);
  assertEquals(r.skip_counts["not_insufficient"], 1);
});

Deno.test("NO CACHED EVIDENCE means no model call and no fetch", async () => {
  let calls = 0;
  const r = await reevaluateWithWebEvidence([candidate()], {
    db: fakeDb([]), workspace_id: "w",
    reevaluate: () => { calls++; return Promise.resolve({}); },
    rebuildRegistry: (k, p) => registryFor(k, p),
  });
  assertEquals(calls, 0, "this module must never buy a page");
  assertEquals(r.skip_counts["no_cached_evidence"], 1);
});

Deno.test("a 404 row is not evidence to re-read", async () => {
  const r = await reevaluateWithWebEvidence([candidate()], {
    db: fakeDb([{ ...okPage, status: "not_found", source_text: "" }]),
    workspace_id: "w",
    reevaluate: () => Promise.resolve({}),
    rebuildRegistry: (k, p) => registryFor(k, p),
  });
  assertEquals(r.skip_counts["no_cached_evidence"], 1);
});

Deno.test("evidence the first pass already saw is not re-asked", async () => {
  let calls = 0;
  const already = registryFor("metaview", [{
    source_url: okPage.source_url, page_intent: "pricing",
    source_text: okPage.source_text, fetched_at: okPage.fetched_at,
  }]);
  const r = await reevaluateWithWebEvidence(
    [candidate({ evidence_registry: already })],
    { db: fakeDb([okPage]), workspace_id: "w",
      reevaluate: () => { calls++; return Promise.resolve({}); },
      rebuildRegistry: (k, p) => registryFor(k, p) },
  );
  assertEquals(calls, 0, "same evidence, same question, no new information");
  assertEquals(r.skip_counts["no_new_evidence"], 1);
});

Deno.test("the model call budget is respected", async () => {
  let calls = 0;
  const many = Array.from({ length: 6 }, (_, i) =>
    candidate({ key: `c${i}`, domain: `c${i}.com` }));
  await reevaluateWithWebEvidence(many, {
    db: fakeDb([okPage]), workspace_id: "w", max_companies: 2,
    reevaluate: () => { calls++; return Promise.resolve({ mission_fit: "review" }); },
    rebuildRegistry: (k, p) => registryFor(k, p),
  });
  assertEquals(calls, 2);
});

Deno.test("a model failure leaves every prior verdict untouched", async () => {
  const c = candidate();
  const before = c.mission_evaluation;
  await reevaluateWithWebEvidence([c], {
    db: fakeDb([okPage]), workspace_id: "w",
    reevaluate: () => { throw new Error("model down"); },
    rebuildRegistry: (k, p) => registryFor(k, p),
  });
  assertEquals(c.mission_evaluation, before, "the run continues as it was");
});

Deno.test("web_page items reach the registry as citable evidence", () => {
  const reg = registryFor("metaview", [{
    source_url: "https://metaview.ai/pricing", page_intent: "pricing",
    source_text: "Pricing: $40 per user per month.", fetched_at: "2026-09-03T00:00:00Z",
  }]);
  const web = reg.items.filter((i) => i.evidence_type === "web_page");
  assertEquals(web.length, 1);
  assertEquals(web[0].source_url, "https://metaview.ai/pricing");
  assert(web[0].source_text?.includes("$40 per user per month"));
  assert(web[0].evidence_id.length > 0, "must be citable");
  assertEquals(web[0].verification_state, "verified");
});

// ══════════ THE RECEIPT MUST CARRY THE VERDICT ══════════
//
// The Metaview canary qualified on reasoning that cited per-seat recurring
// pricing AND a platform sold to teams — two independent facts. The receipt
// attached was one quote carrying the second fact only. The verdict was right
// and its inspectable justification was thinner than the reasoning behind it.
//
// These pin the rule that closes that gap. It counts receipts and compares ids;
// it reads no requirement text, so it is not specific to any claim.

import {
  enforceReceiptSufficiency, type RequirementMatch,
} from "../../supabase/functions/_shared/missionEvaluation.ts";

const B2B = "Company is a B2B SaaS company";
const cite = (id: string, support: "verified" | "supported", req = B2B): RequirementMatch =>
  ({ requirement: req, evidence_id: id, excerpt: "x", support });

const PAGES: Record<string, string> = {
  "web_page:pricing": "pricing",
  "web_page:product": "product",
  "web_page:pricing2": "pricing",
};
const pageIntentFor = (id: string) => PAGES[id] ?? null;

Deno.test("VERIFIED: one sufficient citation closes the requirement", () => {
  const r = enforceReceiptSufficiency([cite("web_page:pricing", "verified")], pageIntentFor);
  assertEquals(r.satisfied.length, 1);
  assertEquals(r.insufficient.length, 0);
});

Deno.test("SUPPORTED: two distinct citations from two pages close it", () => {
  const r = enforceReceiptSufficiency(
    [cite("web_page:pricing", "supported"), cite("web_page:product", "supported")],
    pageIntentFor,
  );
  assertEquals(r.satisfied.length, 2);
  assertEquals(r.insufficient.length, 0);
});

Deno.test("SUPPORTED with ONE citation stays insufficient", () => {
  // The Metaview shape exactly: corroborating reasoning, a single receipt.
  const r = enforceReceiptSufficiency([cite("web_page:pricing", "supported")], pageIntentFor);
  assertEquals(r.satisfied.length, 0);
  assertEquals(r.insufficient[0].reason, "supported_needs_two_citations");
  assertEquals(r.insufficient[0].citations, 1);
});

Deno.test("SUPPORTED with two citations from the SAME page stays insufficient", () => {
  // Two quotes off one page is one fact stated twice, not corroboration.
  const r = enforceReceiptSufficiency(
    [cite("web_page:pricing", "supported"), cite("web_page:pricing2", "supported")],
    pageIntentFor,
  );
  assertEquals(r.satisfied.length, 0);
  assertEquals(r.insufficient[0].reason, "corroboration_from_one_page");
});

Deno.test("the same evidence cited twice is ONE receipt", () => {
  const r = enforceReceiptSufficiency(
    [cite("web_page:pricing", "supported"), cite("web_page:pricing", "supported")],
    pageIntentFor,
  );
  assertEquals(r.satisfied.length, 0, "quoting one item twice is not two facts");
});

Deno.test("the WEAKEST claim governs a mixed set", () => {
  // A hedge must not be laundered by pairing it with a confident duplicate.
  const r = enforceReceiptSufficiency(
    [cite("web_page:pricing", "verified"), cite("web_page:pricing", "supported")],
    pageIntentFor,
  );
  assertEquals(r.satisfied.length, 0);
});

Deno.test("SUPPORTED + one citation DROPPED by the verifier stays insufficient", () => {
  // The verifier runs first, so a dropped citation never reaches this. What
  // arrives is the survivor alone — and one survivor is not corroboration.
  const survived = [cite("web_page:pricing", "supported")]; // second was dropped
  const r = enforceReceiptSufficiency(survived, pageIntentFor);
  assertEquals(r.satisfied.length, 0);
});

Deno.test("evidence with no page intent is independent by nature", () => {
  // Firmographic and job evidence carry no page. Two such citations corroborate.
  const r = enforceReceiptSufficiency(
    [cite("employee_count:linkedin:1", "supported"), cite("job_posting:x:2", "supported")],
    pageIntentFor,
  );
  assertEquals(r.satisfied.length, 2);
});

Deno.test("MERGE: a thin receipt does not close the requirement", () => {
  const prior = priorEval();
  const next = {
    ...priorEval(), mission_fit: "pass", unknown_fields: [],
    matched_requirements: [
      { requirement: B2B, evidence_id: "web_page:pricing", excerpt: "x",
        support: "supported" as const },
    ],
  } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next, pageIntentFor);
  assertEquals(merged.decision, "insufficient_evidence");
  assert(!merged.matched_requirements.some((m) => m.requirement === B2B),
    "an unjustified requirement is stripped from the record");
  // And the three established ones are untouched.
  assertEquals(merged.matched_requirements.length, 3);
});

Deno.test("MERGE: two independent receipts do close it, prior verdicts intact", () => {
  const prior = priorEval();
  const next = {
    ...priorEval(), mission_fit: "pass", unknown_fields: [],
    matched_requirements: [
      { requirement: B2B, evidence_id: "web_page:pricing", excerpt: "x", support: "supported" as const },
      { requirement: B2B, evidence_id: "web_page:product", excerpt: "y", support: "supported" as const },
    ],
  } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next, pageIntentFor);
  assertEquals(merged.decision, "qualified");
  assertEquals(merged.unknown_fields.length, 0);
  for (const p of prior.matched_requirements) {
    const kept = merged.matched_requirements.find((m) => m.requirement === p.requirement);
    assert(kept, `${p.requirement} must survive`);
    assertEquals(kept!.evidence_id, p.evidence_id, "original citation preserved");
  }
});

Deno.test("PRIOR requirements are never re-judged on receipt count", () => {
  // They were decided against a registry this pass never saw. Re-judging their
  // receipts here would discard verified work on evidence that is not in view.
  const prior = priorEval();
  const next = { ...priorEval(), matched_requirements: [], unknown_fields: [] } as MissionEvaluation;
  const merged = mergeReevaluation(prior, next, pageIntentFor);
  assertEquals(merged.matched_requirements.length, 3);
});

// ── THE DECISION MUST REACH THE CALLER ──────────────────────────────────────
//
// The first live canary logged Metaview as `qualified` while the checkpoint
// still held `insufficient_evidence`. The runner mutated `c.mission_evaluation`
// on the candidate it was handed — and `run-agent` maps the engine's companies
// into fresh object literals before calling, so the write landed on a
// throwaway. The verdict was computed and discarded.

Deno.test("the merged verdict is RETURNED, not written onto the candidate", async () => {
  const c = candidate();
  const before = c.mission_evaluation;
  const r = await reevaluateWithWebEvidence([c], {
    db: fakeDb([okPage]), workspace_id: "w",
    reevaluate: () => Promise.resolve({
      mission_fit: "pass", unknown_fields: [],
      matched_requirements: [{
        requirement: "Company is a B2B SaaS company",
        evidence_id: "web_page:company_website:0", excerpt: "no", support: "verified",
      }],
    }),
    rebuildRegistry: (k, p) => registryFor(k, p),
  });
  // The candidate handed in is untouched — a module that decides hands its
  // decision back rather than reaching into whatever object it was given.
  assertEquals(c.mission_evaluation, before);
  // And the decision is on the outcome, where the caller can apply it.
  const outcome = r.outcomes.find((o) => o.skipped === null);
  assert(outcome, "a re-evaluated company must report an outcome");
  assert(outcome!.merged !== null, "the merged verdict must be returned");
});

Deno.test("a skipped company carries no merged verdict to apply", () => {
  // Guards the write-back loop: `if (!o.merged) continue`.
  return reevaluateWithWebEvidence(
    [candidate({ mission_evaluation: priorEval({ decision: "qualified" }) })],
    { db: fakeDb([okPage]), workspace_id: "w",
      reevaluate: () => Promise.resolve({}),
      rebuildRegistry: (k, p) => registryFor(k, p) },
  ).then((r) => {
    assertEquals(r.outcomes[0].skipped, "not_insufficient");
    assertEquals(r.outcomes[0].merged, null);
  });
});
