// Tests 40–43: replay is offline, cached, deterministic.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateRun } from "./evaluate.ts";
import { compareRuns, canonicalJson, stableHash } from "./manifest.ts";
import { runLiveSourcing } from "./live-runner.ts";
import { normalizeCandidate } from "./normalize.ts";
import { allFixtureRaws, FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import { TEST_PROJECT_REF, DEFAULT_LIMITS, type AgentoryOutput, type RawCandidate } from "./types.ts";

const cachedRaws = allFixtureRaws();

Deno.test("40. replay uses no provider; the provider is only touched in LIVE", async () => {
  let providerCalls = 0;
  const spy = (_inv: unknown) => {
    providerCalls += 1;
    return Promise.resolve({ rawCandidates: [] as RawCandidate[], agentoryByCandidateId: {}, actorRunIds: [], reportedSpendUsd: 0, modelCallCount: 0 });
  };
  // Replay core: pure evaluation, no provider argument at all.
  evaluateRun(cachedRaws, { asOf: FIXTURE_AS_OF });
  assertEquals(providerCalls, 0);
  // Contrast: the LIVE runner is the only path that reaches the provider.
  await runLiveSourcing({ projectRef: TEST_PROJECT_REF, workspaceId: "ws-test", limits: DEFAULT_LIMITS, invokeRunAgent: spy });
  assertEquals(providerCalls, 1);
});

Deno.test("41. replay re-evaluates cached raw data deterministically", () => {
  const a = evaluateRun(cachedRaws, { asOf: FIXTURE_AS_OF });
  const b = evaluateRun(cachedRaws, { asOf: FIXTURE_AS_OF });
  assertEquals(a.map((e) => [e.finalRank, e.normalized.candidateId, e.verdict]), b.map((e) => [e.finalRank, e.normalized.candidateId, e.verdict]));
});

Deno.test("42. baseline↔refined comparison is deterministic and flags fixed false positives", () => {
  const raw = FIXTURES.F01_valid_us_saas_sales_ops.raws[0];
  const cid = normalizeCandidate(raw, { asOf: FIXTURE_AS_OF }).candidateId;
  const good: AgentoryOutput = { leadCandidateId: null, score: 88, decision: "contact", rank: 1, whyNow: "BigID is hiring a Sales Strategy and Operations lead, suggesting it is formalizing GTM operations.", outreachAngle: null };
  const bad: AgentoryOutput = { ...good, whyNow: "They are scaling fast and probably need more pipeline." };
  const baseline = evaluateRun([raw], { asOf: FIXTURE_AS_OF, agentoryByCandidateId: { [cid]: good } });
  const refined = evaluateRun([raw], { asOf: FIXTURE_AS_OF, agentoryByCandidateId: { [cid]: bad } });
  assertEquals(baseline[0].verdict, "CONTACT");
  assert(refined[0].verdict !== "CONTACT");
  const cmp1 = compareRuns(baseline, refined);
  const cmp2 = compareRuns(baseline, refined);
  assertEquals(cmp1, cmp2);
  assert(cmp1.falsePositivesFixed.includes(cid));
});

Deno.test("43. raw artifact hashes are stable and order-independent", () => {
  assertEquals(stableHash(cachedRaws), stableHash(cachedRaws));
  assertEquals(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
  assert(stableHash(cachedRaws) !== stableHash([...cachedRaws, cachedRaws[0]]));
  // Canonical JSON is key-order independent.
  assertEquals(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});
