// THE SAME QUESTION, ON THE SAME PAGES, IS NOT PAID FOR TWICE.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage ab06540f, 2026-09-06. THIRTY-SEVEN re-evaluation calls for FIVE
// companies. From the run's own logs, Metaview alone:
//
//   06:2x  reeval-decided { company: "Metaview", resolved: [], pages: 4, carried: 4 }
//   06:4x  reeval-decided { company: "Metaview", resolved: [], pages: 4, carried: 4 }
//   07:0x  reeval-decided { company: "Metaview", resolved: [], pages: 4, carried: 4 }
//   ... eight times, byte-identical, on the same four cached pages.
//
// ── WHY THE EXISTING GUARD NEVER FIRED ─────────────────────────────────────
//
// `reevaluateWithWebEvidence` compares the fetched pages against the web_page
// items in `c.evidence_registry`. In production that registry is the one the
// engine built for the FIRST pass, which runs before any page has been bought
// and so carries none. The comparison set is empty on every real candidate.
//
// Its unit test passes because the test builds a registry WITH pages in it —
// the one input production never produces. That is the shape this file tests
// instead: the registry the engine actually hands over, and the slice boundary
// an in-memory guard cannot see across.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  reevaluateWithWebEvidence, reevaluationOperationKey,
  type ReevalCandidate,
} from "../../../supabase/functions/_shared/webEvidenceReevaluation.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import type {
  MissionEvaluation, MissionEvaluationInput,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";

/** The registry as the ENGINE builds it for the first pass: no web pages. */
const firstPassRegistry = (key: string) =>
  buildEvidenceRegistry({
    evidence: {
      version: "company-evidence-v1", company_key: key, company_name: "Metaview",
      domain: "metaview.ai", linkedin_company_url: null, identity_state: "resolved",
      geography_evidence: "London, United Kingdom", employee_evidence: 134,
      industry_evidence: [], description: null, source_query: null,
      source_capability: "general_company_discovery",
      commercial_job_evidence: [], strongest_signal: null, evidence_urls: [],
      missing_fields: [], conflicting_evidence: [],
    } as never,
  } as never);

const prior = (): MissionEvaluation => ({
  version: "mission-evaluation-v1", decision: "insufficient_evidence",
  mission_fit: "review", icp_fit: "plausible", hiring_fit: "verified",
  confidence: 0.86, match_score: 90,
  matched_requirements: [], failed_requirements: [],
  reasoning: "", rejection_reasons: [], evidence_quality: "strong",
  unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"],
  next_action: null,
} as unknown as MissionEvaluation);

const input = (): MissionEvaluationInput => ({
  schema_version: "mission-evaluation-input-v1",
  instruction: "Find me 5 B2B SaaS companies in the UK",
  mission: {}, brain: {}, company: {},
});

const candidate = (o: Partial<ReevalCandidate> = {}): ReevalCandidate => ({
  key: "metaview", company_name: "Metaview", domain: "metaview.ai",
  mission_evaluation: prior(),
  // EXACTLY what run-agent hands over.
  evidence_registry: firstPassRegistry("metaview"),
  evaluation_input: input(),
  completed_operations: [],
  ...o,
});

const PAGES = [
  { source_url: "https://metaview.ai/", page_intent: "homepage",
    source_text: "Metaview is the Agentic Recruiting Platform.", status: "ok",
    fetched_at: new Date().toISOString() },
  { source_url: "https://metaview.ai/pricing", page_intent: "pricing",
    source_text: "Starter $100 monthly per user.", status: "ok",
    fetched_at: new Date().toISOString() },
];

const fakeDb = (rows: Array<Record<string, unknown>>) => ({
  from: () => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, order: () => b,
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    return b;
  },
}) as never;

const deps = (count: { n: number }, rows = PAGES) => ({
  db: fakeDb(rows), workspace_id: "w",
  reevaluate: () => { count.n++; return Promise.resolve({ mission_fit: "review" }); },
  rebuildRegistry: (k: string, p: readonly unknown[]) =>
    buildEvidenceRegistry({
      evidence: {
        version: "company-evidence-v1", company_key: k, company_name: "Metaview",
        domain: "metaview.ai", linkedin_company_url: null, identity_state: "resolved",
        geography_evidence: null, employee_evidence: null, industry_evidence: [],
        description: null, source_query: null,
        source_capability: "general_company_discovery",
        commercial_job_evidence: [], strongest_signal: null, evidence_urls: [],
        missing_fields: [], conflicting_evidence: [],
      } as never,
      web_pages: p as never,
    }),
});

// ══════════ 1. the production shape, across a slice boundary ══════════════

Deno.test("THE RUN: the same pages are not re-asked on the next slice", async () => {
  const calls = { n: 0 };

  // SLICE 1 — nothing has been asked yet.
  const first = await reevaluateWithWebEvidence([candidate()], deps(calls));
  assertEquals(calls.n, 1, "the first look must happen");
  const key = first.outcomes[0].operation_key;
  assert(key, "and it must hand back what to record");

  // The caller records it; the checkpoint carries it; the next slice restores
  // it. That is the whole round trip, and it is the one an in-memory guard
  // cannot make.
  const second = await reevaluateWithWebEvidence(
    [candidate({ completed_operations: [key!] })], deps(calls),
  );
  assertEquals(calls.n, 1, "the second slice must buy nothing");
  assertEquals(second.skip_counts["no_new_evidence"], 1);
  assertEquals(second.outcomes[0].operation_key, null, "a skip records nothing");
});

// ══════════ 2. a page arriving reopens the question ═══════════════════════

Deno.test("2. a page that arrives since is a new question", async () => {
  const calls = { n: 0 };
  const first = await reevaluateWithWebEvidence([candidate()], deps(calls));
  const key = first.outcomes[0].operation_key!;

  const withMore = [...PAGES, {
    source_url: "https://metaview.ai/customers", page_intent: "customers",
    source_text: "Trusted by teams at Ramp and Brex.", status: "ok",
    fetched_at: new Date().toISOString(),
  }];
  const next = await reevaluateWithWebEvidence(
    [candidate({ completed_operations: [key] })], deps(calls, withMore),
  );
  assertEquals(calls.n, 2, "new evidence is exactly what a second look is for");
  assert(next.outcomes[0].operation_key !== key, "and it is a different question");
});

// ══════════ 3. the key is about the pages, and nothing else ═══════════════

Deno.test("3. the key is order-independent and derived from what is SHOWN", () => {
  const P = (u: string, t = "text of " + u) => ({ source_url: u, source_text: t });
  const a = reevaluationOperationKey([P("b"), P("a")]);
  const b = reevaluationOperationKey([P("a"), P("b")]);
  const dup = reevaluationOperationKey([P("a"), P("a"), P("b")]);
  assertEquals(a, b, "the order pages come back in is not information");
  assertEquals(a, dup, "nor is the same page listed twice");
  assert(a !== reevaluationOperationKey([P("a")]));
  // The TEXT is part of the question. A page whose content changed — or whose
  // selection changed — has not been asked about yet.
  assert(a !== reevaluationOperationKey([P("b", "new copy"), P("a")]),
    "sealing on the URL alone would hold a question asked of different text");
  assert(a.startsWith("web_evidence_reevaluation:"),
    "it shares the namespace of every other completed operation");
});

// ══════════ 4. run-agent records it before the checkpoint is written ══════

Deno.test("4. the key is recorded BEFORE the resume records are rebuilt", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  assert(src.includes("completed_operations: c.completed_operations,"),
    "the ledger must reach the re-evaluator");
  const push = src.indexOf("c.completed_operations.push(o.operation_key)");
  const rebuild = src.indexOf("engineRun.resume_records = engineRun.companies.map(toResumeRecord)");
  assert(push > 0, "the caller must record what the module handed back");
  assert(rebuild > 0);
  assert(push < rebuild,
    "recorded after the rebuild, the key never reaches the checkpoint and the " +
      "next slice asks again — which is the defect, not the fix");
});

// ══════════ 5. the run itself, replayed ══════════════════════════════════

Deno.test("5. ab06540f's five companies over eight slices cost five calls, not forty", async () => {
  const NAMES = ["metaview", "hebbia", "kody", "pumpco", "diligencevault"];
  const calls = { n: 0 };
  // The ledger the checkpoint carries between slices, per company.
  const ledger = new Map<string, string[]>(NAMES.map((n) => [n, []]));

  for (let slice = 0; slice < 8; slice++) {
    const report = await reevaluateWithWebEvidence(
      NAMES.map((n) => candidate({
        key: n, company_name: n, completed_operations: ledger.get(n)!,
      })),
      // The budget the run actually allowed. Without the guard it is spent
      // every slice on the same five questions.
      { ...deps(calls), max_companies: 5 },
    );
    for (const o of report.outcomes) {
      if (o.operation_key) ledger.get(o.company_key)!.push(o.operation_key);
    }
  }

  assertEquals(calls.n, NAMES.length,
    "each company is asked once about these pages; ab06540f asked 37 times " +
      "for 5 companies and every answer after the first was identical");
});

// ══════════ 6. a failed call is not a question already asked ══════════════

Deno.test("6. a model call that THREW records nothing and is retried", async () => {
  let attempts = 0;
  const failing = {
    ...deps({ n: 0 }),
    reevaluate: () => { attempts++; return Promise.reject(new Error("upstream 503")); },
  };
  const r = await reevaluateWithWebEvidence([candidate()], failing);
  assertEquals(attempts, 1);
  assertEquals(r.outcomes[0].operation_key, null,
    "sealing a question the model never answered would lose it for good");
  assertEquals(r.skip_counts["reevaluation_failed"], 1);
  assertEquals(r.skip_counts["no_new_evidence"], undefined,
    "an outage must not read as a run with nothing left to look at");

  // So the next slice asks again.
  const calls = { n: 0 };
  const again = await reevaluateWithWebEvidence([candidate()], deps(calls));
  assertEquals(calls.n, 1);
  assert(again.outcomes[0].operation_key);
});

// ══════════ 7. an unusable answer buys exactly one more attempt ═══════════

Deno.test("7. an UNUSABLE response is retried once, then sealed", async () => {
  // Not an outage: the call returned. It returned something the strict parser
  // cannot use, which is neither an answer nor a reason to ask for ever.
  const junk = () => Promise.resolve({ nothing: "the parser can use" });
  let attempts = 0;
  const ledger: string[] = [];

  const run = async () => {
    const r = await reevaluateWithWebEvidence(
      [candidate({ completed_operations: [...ledger] })],
      { ...deps({ n: 0 }), reevaluate: () => { attempts++; return junk(); } },
    );
    const k = r.outcomes[0].operation_key;
    if (k) ledger.push(k);
    return r;
  };

  const first = await run();
  assertEquals(attempts, 1);
  assert(first.outcomes[0].operation_key!.startsWith("web_evidence_reevaluation_attempt:"),
    "the first unusable answer records an ATTEMPT, not a seal");

  const second = await run();
  assertEquals(attempts, 2, "and buys exactly one more call");
  assert(second.outcomes[0].operation_key!.startsWith("web_evidence_reevaluation:"),
    "the second unusable answer seals it");

  // A third slice must buy nothing. This is the bound.
  const third = await run();
  assertEquals(attempts, 2, "two calls per evidence state, ever");
  assertEquals(third.skip_counts["no_new_evidence"], 1);

  // ...and a page arriving still reopens it, because the seal is on the
  // evidence, not on the company.
  const more = [...PAGES, {
    source_url: "https://metaview.ai/customers", page_intent: "customers",
    source_text: "Trusted by teams at Ramp and Brex.", status: "ok",
    fetched_at: new Date().toISOString(),
  }];
  await reevaluateWithWebEvidence(
    [candidate({ completed_operations: [...ledger] })],
    { ...deps({ n: 0 }, more), reevaluate: () => { attempts++; return junk(); } },
  );
  assertEquals(attempts, 3, "new evidence is a new question, with its own two attempts");
});

Deno.test("8. a USABLE answer seals immediately, with no retry", async () => {
  const calls = { n: 0 };
  const r = await reevaluateWithWebEvidence([candidate()], deps(calls));
  assert(r.outcomes[0].operation_key!.startsWith("web_evidence_reevaluation:"),
    "an answer the parser could use is not owed a second attempt");
  const again = await reevaluateWithWebEvidence(
    [candidate({ completed_operations: [r.outcomes[0].operation_key!] })], deps(calls),
  );
  assertEquals(calls.n, 1);
  assertEquals(again.skip_counts["no_new_evidence"], 1);
});
