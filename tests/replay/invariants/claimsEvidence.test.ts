// CLAIM / EVIDENCE INVARIANTS.
//
//   * A verdict comes from evidence only: triage withholding and an
//     unaffordable route change what is BOUGHT, never a hard check.
//   * The checkpoint round trip (toResumeRecord → restoreWorkingSet) preserves
//     every claim — a resume decides exactly what the slice before it decided.
//   * Every proven hard check of a qualified lead cites provider evidence.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { evidenceGapsFor } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import { missionCandidatesFrom, restoreWorkingSet, toResumeRecord } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { HIRING_ROUTE_ACTOR } from "../../../supabase/functions/_shared/hiringClaimVerifier.ts";
import { loadFixture } from "../lib/fixture.ts";
import { companiesAt } from "../lib/state.ts";
import { replayReadiness } from "../lib/verification.ts";
import { runGoldenMission } from "../lib/mission.ts";
import { GOLDEN } from "../golden/scenarios.ts";

const fx = loadFixture("canary8.hiring-affordability");
const S1 = "before_hiring_verification:slice1";
const mission = fx.mission as unknown as LeadMissionV1;
const criteria = deriveMissionCriteria(mission, replayReadiness());
const checksOf = (companies: ReturnType<typeof companiesAt>) =>
  missionCandidatesFrom({ companies }, { missionId: "t" }).map((c) => {
    const e = evaluateEligibility(criteria, c.graph);
    return { key: c.company_key, eligibility: e.eligibility, hard: e.checks.filter((x) => x.kind === "hard").map((x) => `${x.dimension}:${x.result}`) };
  });

Deno.test("[claims] triage withholding changes what is bought, never a verdict", () => {
  const plain = companiesAt(fx, S1);
  const withheld = companiesAt(fx, S1);
  for (const c of withheld) {
    c.triage = { company_key: c.key, relevance: "irrelevant", confidence: 0.99, matched_roles: [], signal_strength: 0, reasons: [] } as never;
    (c.enriched ?? c.company).provider_industry = "Internet News";
  }
  assert(missionCandidatesFrom({ companies: withheld }, { missionId: "t" }).every((c) => c.paid_verification_blocked), "the gate engaged");
  assertEquals(checksOf(withheld), checksOf(plain));
});

Deno.test("[claims] an unaffordable route closes the route, never the claim", () => {
  const plain = companiesAt(fx, S1);
  const closed = companiesAt(fx, S1);
  for (const c of closed) c.completed_operations.push(`unaffordable:${HIRING_ROUTE_ACTOR}`);
  assertEquals(checksOf(closed), checksOf(plain));
  const cand = missionCandidatesFrom({ companies: closed }, { missionId: "t" })[0];
  const e = evaluateEligibility(criteria, cand.graph);
  const gaps = evidenceGapsFor(e.checks.filter((x) => x.kind === "hard"), cand.graph, undefined,
    new Set(cand.attempted_routes), replayReadiness(), new Set(cand.unaffordable_routes));
  assertEquals(gaps.find((g) => g.dimension === "hiring")?.next, "blocked");
});

Deno.test("[claims] the checkpoint round trip preserves every claim (a resume decides what the slice decided)", () => {
  for (const cp of Object.keys(fx.checkpoints)) {
    const first = companiesAt(fx, cp);
    const again = restoreWorkingSet(first.map(toResumeRecord));
    assertEquals(checksOf(again), checksOf(first), cp);
  }
});

Deno.test("[claims] every proven hard check of a qualified lead cites the provider evidence it rests on", async () => {
  for (const name of ["qualified", "replenishment", "adoption"]) {
    const r = await runGoldenMission(GOLDEN[name]());
    for (const key of r.qualifiedKeys) {
      const l = r.view.leads.find((x) => x.company.key === key)!;
      for (const d of l.hard_check_details.filter((x) => x.result === "pass")) {
        assert(d.provenance && (d.provenance as { actor?: string }).actor, `${name}: ${key} ${d.dimension} passes without provenance`);
      }
      assert(l.key_evidence.every((e) => e.sources.length > 0), `${name}: evidence without a source`);
    }
  }
});
