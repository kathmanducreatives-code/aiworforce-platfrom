// PHASE 4 — FUNDING BECOMES A REAL COLLECTOR.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
//
// `funding_signal_discovery` is engine-driven and has a carded provider, so the
// audit called funding "wiring, not capability". It ran, it returned rounds,
// and the rounds were thrown away: `fundingRounds` was pushed to and never
// read. Nothing reached the evidence registry, so the evaluator had nothing to
// cite, so `assessSignals` reported `not_investigated` — and a funding monitor
// spent on discovery, identity and enrichment to establish nothing.
//
// The round IS the evidence: stage, amount, announced date, investors, and the
// articles that reported it. It now reaches the registry as a `funding_signal`
// item, and asserts its own verdict on the same terms hiring does — code may
// establish a fact, and only by pointing at the item that holds it.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileMonitoringMission } from "../../../supabase/functions/_shared/monitoringMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";
import {
  resolveResponseKind, structuredRowsLookIntact,
} from "../../../supabase/functions/_shared/providerResponseContract.ts";

/** A datahyena row in its REAL shape — see `normalizeDatahyenaFundingRound`. */
const ROUND_ROW = {
  id: "rnd-1",
  company: {
    name: "Northwind", domain: "northwind.io",
    linkedinUrl: "https://www.linkedin.com/company/northwind",
    hqCity: "Austin", hqCountry: { name: "United States" },
  },
  // Field names as the live actor emits them — see `normalizeDatahyenaFundingRound`.
  round: "Series A",
  amountUsd: 12_000_000,
  currency: "USD",
  announcedAt: "2026-08-01",
  investors: [{ id: "i1", name: "Acme Ventures" }],
  sources: [{ url: "https://techcrunch.example/northwind-series-a" }],
};

const SEARCH_ROW = {
  id: "northwind", name: "Northwind",
  linkedinUrl: "https://www.linkedin.com/company/northwind",
  website: "https://northwind.io",
  description: "Northwind is a B2B SaaS platform sold on subscription.",
  location: "Austin, TX",
};

const ICP = {
  verticals: ["b2b saas"], business_models: ["saas"],
  locations: ["United States"], stages: ["series_a"],
};

function fundingMission() {
  const r = compileMonitoringMission({
    workspace_id: "w",
    subjects: [{
      kind: "icp", identifier: null, label: "companies like our ICP",
      signals: [{ event: "funding", subject: "company" }], timeframe_days: 90,
    }],
    icp: ICP,
  });
  assert(r.ok && r.mission, `funding mission failed to compile: ${r.reason}`);
  return r.mission!;
}

/** The funding actor is the only discovery source this plan may use. */
function selector() {
  return () =>
    Promise.resolve([{
      actor_key: "apify_funding_rounds_datahyena",
      role: "primary",
      input: { limit: 25 },
      rationale: "test fixture: the funding cohort",
    }]);
}

async function runFunding(rows: Record<string, Record<string, unknown>[]>) {
  const calls: string[] = [];
  const mission = fundingMission();
  const plan = buildCapabilityGraph(mission as never);
  const run = await runCapabilityPlan(
    {
      invoke: (call: CompiledActorCall<unknown>) => {
        calls.push(call.actorKey);
        return Promise.resolve(rows[call.actorKey] ?? []);
      },
      verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
      planDiscovery: selector(),
      // deno-lint-ignore no-explicit-any
    } as unknown as CapabilityEngineDeps as any,
    // deno-lint-ignore no-explicit-any
    { mission, plan, maxCandidates: 25 } as any,
  );
  return { run, calls, plan };
}

Deno.test("1. a funding mission schedules the funding source and nothing lead-only", () => {
  const plan = buildCapabilityGraph(fundingMission() as never);
  const caps = plan.steps.map((s) => String(s.capability));
  assertEquals(caps[0], "funding_signal_discovery");
  assertFalse(caps.includes("persistence"), "a monitoring mission never persists leads");
});

Deno.test("2. the round reaches the evidence registry instead of being discarded", async () => {
  const { run, calls } = await runFunding({
    apify_funding_rounds_datahyena: [ROUND_ROW],
    apify_linkedin_company_search: [SEARCH_ROW],
  });
  assert(calls.includes("apify_funding_rounds_datahyena"));
  assertEquals(run.companies.length, 1, "the funded company must enter the pool");

  const items = run.companies[0].evidence_registry?.items ?? [];
  const funding = items.filter((i) => i.evidence_type === "funding_signal");
  assertEquals(funding.length, 1, "the round that discovered this company must be citable");

  const v = funding[0].structured_value as Record<string, unknown>;
  assertEquals(v.round_stage, "Series A");
  assertEquals(v.amount_usd, 12_000_000);
  assertEquals(v.announced_date, "2026-08-01");
  assertEquals(v.investors, ["Acme Ventures"]);
  // THE ANNOUNCED DATE IS THE OBSERVATION. A round announced in March was
  // announced in March however recently we read about it.
  assertEquals(funding[0].observed_at, "2026-08-01");
  assertEquals(funding[0].verification_state, "verified");
  // THE CITATION. An amount nobody can check is a claim, not evidence.
  assertEquals(funding[0].source_url, "https://techcrunch.example/northwind-series-a");
});

Deno.test("3. the round asserts its own verdict, citing the registry item", async () => {
  const { run } = await runFunding({
    apify_funding_rounds_datahyena: [ROUND_ROW],
    apify_linkedin_company_search: [SEARCH_ROW],
  });
  const assessments = run.companies[0].signal_assessments ?? [];
  const funding = assessments.find((a) => a.signal === "funding/company");
  assert(funding, `no funding assessment: ${JSON.stringify(assessments)}`);
  assertEquals(funding!.verdict, "verified");
  assert(funding!.evidence_ids.length > 0, "a verdict must point at what proved it");
  assert(
    funding!.evidence_ids.every((id) => id.startsWith("funding_signal:")),
    `the citation must be the funding evidence: ${funding!.evidence_ids.join(", ")}`,
  );
  assertEquals(funding!.established_by, "funding_signal_discovery");
});

Deno.test("4. an UNDATED round is not evidence and produces no verdict", async () => {
  // `is_evidence` is false without an announced date, so the company never
  // enters the pool — a funding mission may not carry a company whose round
  // cannot be dated. That rule is the provider normalizer's and is unchanged;
  // what this pins is that nothing downstream invents a verdict for it.
  const { run } = await runFunding({
    apify_funding_rounds_datahyena: [{ ...ROUND_ROW, announcedAt: null }],
    apify_linkedin_company_search: [SEARCH_ROW],
  });
  assertEquals(run.companies.length, 0, "an undated round is not a candidate");
  assertEquals(run.state.qualified_company_keys, []);
});

Deno.test("5. no funding capability, no funding verdict", async () => {
  // The guarantee `assessSignals` exists for: a signal is a function of what
  // actually RAN. With the discovery capability never completing, a funding
  // verdict cannot appear however much evidence a row claims to carry.
  const { run } = await runFunding({
    apify_funding_rounds_datahyena: [],
    apify_linkedin_company_search: [SEARCH_ROW],
  });
  assertEquals(run.companies.length, 0);
  const completed = run.state.completed_capabilities;
  assertFalse(
    completed.includes("funding_signal_discovery") && run.companies.length > 0,
    "a capability that returned nothing cannot establish anything",
  );
});


Deno.test("6. a hiring mission's eligibility is unchanged by the funding clause", async () => {
  // The clause that admits a funding-discovered company is scoped to companies
  // THIS run found by a round. A hiring mission has none, so the filter behaves
  // exactly as it did — which is what makes the change safe rather than merely
  // small.
  const hiring = compileMonitoringMission({
    workspace_id: "w",
    subjects: [{
      kind: "icp", identifier: null, label: "companies like our ICP",
      signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90,
    }],
    // A cohort the YC directory genuinely covers, so the validator admits the
    // stub actor and this test exercises eligibility rather than a refusal.
    icp: { ...ICP, stages: ["seed"] },
  });
  assert(hiring.ok && hiring.mission);
  const plan = buildCapabilityGraph(hiring.mission! as never);

  // A company with no openings and no round: ineligible, as before.
  const run = await runCapabilityPlan(
    {
      invoke: (call: CompiledActorCall<unknown>) =>
        Promise.resolve(
          call.actorKey === "apify_yc_companies_memo23"
            ? [{
              id: "nw", name: "Northwind", website: "https://northwind.io",
              industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
              oneLiner: "B2B SaaS.", allLocations: "Austin, TX, USA", openJobs: [],
            }]
            : call.actorKey === "apify_linkedin_company_search"
            ? [SEARCH_ROW]
            : [],
        ),
      verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
      planDiscovery: stubDiscoverySelector(),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    { mission: hiring.mission, plan, maxCandidates: 25 } as any,
  );

  const funded = run.companies.filter((c) =>
    (c.evidence_registry?.items ?? []).some((i) => i.evidence_type === "funding_signal"));
  assertEquals(funded.length, 0, "a hiring mission must produce no funding evidence");
});

// ── 7–8. THE TRANSPORT MUST NOT RESHAPE A FUNDING ROUND ─────────────────────
//
// Live run 2026-08-24: `apify_funding_rounds_datahyena` SUCCEEDED and returned
// 25 rows. `resolveResponseKind` did not recognise the actor, fell through to
// the tool's declared source type — "hiring" — and read them through the JOBS
// path. Every row arrived reshaped into a job record, with the real round
// buried under `raw.provider_payload`, so the normalizer found no `round` and
// no `company`, marked all 25 `is_evidence: false`, and the engine logged "the
// actor returned no rows at all" for a call that had returned twenty-five.

Deno.test("7. the funding actor resolves to the shape-preserving path", () => {
  // BY EITHER IDENTIFIER. `resolveResponseKind` accepts a key or an id, and a
  // call carrying only one must resolve the same as a call carrying the other.
  assertEquals(
    resolveResponseKind({ actorKey: "apify_funding_rounds_datahyena", actorId: null }),
    "structured_companies",
  );
  assertEquals(
    resolveResponseKind({ actorKey: null, actorId: "datahyena/company-funding-rounds" }),
    "structured_companies",
  );
  // AND THE ACTOR WINS OVER A DECLARED SOURCE TYPE. This is the exact
  // precedence that failed: the tool declared "hiring" for a funding call.
  assertEquals(
    resolveResponseKind({
      actorKey: "apify_funding_rounds_datahyena",
      actorId: "datahyena/company-funding-rounds",
      sourceType: "hiring",
    }),
    "structured_companies",
  );
});

Deno.test("8. a job-normalized funding row is detected, not read as empty", () => {
  // What the live run actually received. The guard exists so this is a VISIBLE
  // transport failure rather than a silent zero.
  const jobShaped = [{
    job_title: null, job_url: null, posted_at: null, source_type: "hiring",
    raw: { provider_payload: { round: "seed", company: { name: "EULER" } } },
  }];
  const shape = structuredRowsLookIntact(jobShaped);
  assertFalse(shape.intact);
  assert(/provider_payload/.test(shape.reason ?? ""), shape.reason ?? "");

  // And the provider's own shape passes.
  assertEquals(structuredRowsLookIntact([ROUND_ROW]).intact, true);
});
