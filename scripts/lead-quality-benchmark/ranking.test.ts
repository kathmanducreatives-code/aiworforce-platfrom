// Tests 31–35: deterministic ranking.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateRun } from "./evaluate.ts";
import { normalizeCandidate } from "./normalize.ts";
import { allFixtureRaws, FIXTURE_AS_OF, FIXTURES } from "./fixtures.ts";
import type { AgentoryOutput, RankedEvaluation, RawCandidate } from "./types.ts";

function agentoryMap(raws: RawCandidate[], keys: (keyof typeof FIXTURES)[]): Record<string, AgentoryOutput> {
  const map: Record<string, AgentoryOutput> = {};
  for (const k of keys) {
    const f = FIXTURES[k];
    if (!f.agentoryByIndex) continue;
    for (const r of f.raws) {
      const a = f.agentoryByIndex[r.rawItemIndex];
      if (a) map[normalizeCandidate(r, { asOf: FIXTURE_AS_OF }).candidateId] = a;
    }
  }
  return map;
}
function evaluateMany(keys: (keyof typeof FIXTURES)[]): RankedEvaluation[] {
  const raws = keys.flatMap((k) => FIXTURES[k].raws);
  return evaluateRun(raws, { asOf: FIXTURE_AS_OF, agentoryByCandidateId: agentoryMap(raws, keys) });
}
const rankOf = (evals: RankedEvaluation[], company: string) =>
  evals.find((e) => e.normalized.raw.companyName === company)!.finalRank;

Deno.test("31. a valid strong account ranks before an ambiguous account", () => {
  const evals = evaluateMany(["F19_strong_rank_leader", "F16_ambiguous_saas"]);
  assert(rankOf(evals, "RankLeader") < rankOf(evals, "Acme Group"));
});

Deno.test("32. CONTACT ranks before WATCH", () => {
  const evals = evaluateMany(["F19_strong_rank_leader", "F08_valid_founder_current"]);
  const contact = evals.find((e) => e.verdict === "CONTACT")!;
  const watch = evals.find((e) => e.verdict === "WATCH")!;
  assert(contact.finalRank < watch.finalRank);
});

Deno.test("33. WATCH ranks before REJECT", () => {
  const evals = evaluateMany(["F08_valid_founder_current", "F03_generic_sales_role"]);
  const watch = evals.find((e) => e.verdict === "WATCH")!;
  const reject = evals.find((e) => e.verdict === "REJECT")!;
  assert(watch.finalRank < reject.finalRank);
});

Deno.test("34. tie-breaking is deterministic across runs", () => {
  const a = evaluateMany(["F01_valid_us_saas_sales_ops", "F19_strong_rank_leader"]);
  const b = evaluateMany(["F01_valid_us_saas_sales_ops", "F19_strong_rank_leader"]);
  assertEquals(a.map((e) => e.normalized.candidateId), b.map((e) => e.normalized.candidateId));
});

Deno.test("35. no duplicate appears in the top 10", () => {
  const raws = allFixtureRaws();
  const keys = Object.keys(FIXTURES) as (keyof typeof FIXTURES)[];
  const evals = evaluateRun(raws, { asOf: FIXTURE_AS_OF, agentoryByCandidateId: agentoryMap(raws, keys) });
  // The presented top 10 excludes REJECT/duplicate rows (matches ranked-leads.csv).
  const top10 = evals.filter((e) => e.verdict !== "REJECT").slice(0, 10);
  for (const e of top10) assert(e.duplicateStatus === "unique", `dup in top10: ${e.normalized.raw.companyName}`);
  // No repeated strong account key either.
  const acctKeys = top10.map((e) => e.normalized.duplicateKeys.accountByDomain).filter(Boolean);
  assertEquals(new Set(acctKeys).size, acctKeys.length);
});
