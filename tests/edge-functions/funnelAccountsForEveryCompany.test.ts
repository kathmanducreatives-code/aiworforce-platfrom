// PHASE 6 — `unaccounted` MUST BE ABLE TO RAISE AN ALARM.
//
// ── WHAT WAS OBSERVED ──────────────────────────────────────────────────────
//
// `company_brain` reported a non-zero `unaccounted` on essentially every
// mission for weeks:
//
//     8cfdfd10   entered 62   advanced 15   withheld 0   UNACCOUNTED 47
//     b1348724   entered 139  advanced 29   withheld 0   UNACCOUNTED 110
//     2f3d9c5c   entered 101  advanced 20   withheld 0   UNACCOUNTED 81
//     40295080   entered 97   advanced 22   withheld 0   UNACCOUNTED 75
//
// `unaccounted` is this system's one counter meaning "a stage dropped companies
// and cannot say where they went". A counter that is never zero cannot raise an
// alarm, and nobody reading it can tell the weeks of false positives from the
// real drop it exists to catch.
//
// Nothing was lost. The stage's `entered` is every identity-resolved company,
// but only companies passing the Brain eligibility gate are ever handed to the
// Brain, and the gate's decision was recorded nowhere. `qualification_deferred`
// covered the ones the CLOCK stopped; there was no marker for the ones the gate
// never admitted.
//
// ZERO network, ZERO DB, ZERO model, ZERO spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionFunnel,
  type FunnelCompany,
} from "../../supabase/functions/_shared/leadMissionFunnel.ts";
import {
  missionFunnelFor,
  runCapabilityPlan,
} from "../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseLeadMissionDeterministic } from "../../supabase/functions/_shared/leadMission.ts";
import { stubMissionEvaluator } from "./_shared/missionEvaluatorFixture.ts";

/** A company that reached the Brain and got a verdict. */
const advanced = (key: string): FunnelCompany => ({
  key,
  prequalified: true,
  triage: "relevant",
  shortlisted: true,
  shortlist_exclusion: null,
  identity: "resolved",
  enrichment: "success",
  reached_brain: true,
  brain: "QUALIFIED",
  evaluated: true,
  decision_source: "gpt_evaluation",
  verdict: "pass",
  persisted: true,
} as unknown as FunnelCompany);

/** Identity resolved, then the Brain gate refused it — for a stated reason. */
const gateRefused = (
  key: string,
  how: "refuted" | "unproven" | "clock",
): FunnelCompany => ({
  ...advanced(key),
  reached_brain: false,
  brain: null,
  evaluated: false,
  verdict: null,
  persisted: false,
  brain_refuted: how === "refuted",
  brain_unproven: how === "unproven",
  brain_blocked: how === "clock",
} as unknown as FunnelCompany);

const brainStage = (companies: FunnelCompany[]) => {
  const f = buildMissionFunnel(companies);
  const s = f.stages.find((x) => x.stage === "company_brain");
  assert(s, "the company_brain stage must exist");
  return s as unknown as {
    entered: number; advanced: number; decided: number;
    withheld: number; excluded: number; unaccounted: number;
  };
};

Deno.test("THE ALARM: a refused company is accounted for, not lost", () => {
  // 8cfdfd10 in miniature: some advance, the rest are refused by the gate.
  const companies = [
    ...["a", "b", "c"].map(advanced),
    ...["d", "e"].map((k) => gateRefused(k, "refuted")),
    ...["f", "g"].map((k) => gateRefused(k, "unproven")),
  ];
  const s = brainStage(companies);

  assertEquals(s.entered, 7);
  assertEquals(s.advanced, 3);
  assertEquals(
    s.unaccounted,
    0,
    `four companies were refused by the gate for stated reasons and must not ` +
      `be reported as lost; got unaccounted=${s.unaccounted}`,
  );
});

Deno.test("a refuted signal is EXCLUDED, an unestablished one is WITHHELD", () => {
  // The architecture's own rule: an empty provider result is an absence of
  // evidence, not a proven negative. Collapsing the two would say a company was
  // rejected when it was only never checked.
  const s = brainStage([
    advanced("a"),
    gateRefused("b", "refuted"),
    gateRefused("c", "unproven"),
  ]);
  assertEquals(s.excluded, 1, "the refuted company is a fact — excluded");
  assertEquals(s.withheld, 1, "the unestablished one is an absence — withheld");
  assertEquals(s.unaccounted, 0);
});

Deno.test("the clock case still counts as withheld", () => {
  // The earlier fix, preserved: a company the qualification loop ran out of
  // time for is resumable and never a fact about the company.
  const s = brainStage([advanced("a"), gateRefused("b", "clock")]);
  assertEquals(s.withheld, 1);
  assertEquals(s.excluded, 0);
  assertEquals(s.unaccounted, 0);
});

Deno.test("clock, refuted and unestablished are counted apart", () => {
  const s = brainStage([
    advanced("a"),
    gateRefused("b", "clock"),
    gateRefused("c", "refuted"),
    gateRefused("d", "unproven"),
  ]);
  assertEquals(s.excluded, 1, "refuted only");
  assertEquals(s.withheld, 2, "clock + unestablished");
  assertEquals(s.unaccounted, 0);
});

Deno.test("THE ALARM STILL WORKS: an unmarked disappearance is reported", () => {
  // The counter has to keep meaning what it says. A company that neither
  // advanced nor carries any reason IS a silent drop, and must still show up.
  const ghost = {
    ...advanced("ghost"),
    reached_brain: false,
    brain: null,
    evaluated: false,
    verdict: null,
    persisted: false,
  } as unknown as FunnelCompany;

  const s = brainStage([advanced("a"), ghost]);
  assertEquals(
    s.unaccounted,
    1,
    "a company with no stated reason must still raise the alarm — otherwise " +
      "this fix has only silenced the counter",
  );
});

Deno.test("the funnel's own arithmetic holds on every stage", () => {
  // `entered - advanced` must equal `decided + withheld + excluded +
  // unaccounted` — the invariant the file states about itself.
  const f = buildMissionFunnel([
    ...["a", "b"].map(advanced),
    gateRefused("c", "refuted"),
    gateRefused("d", "unproven"),
    gateRefused("e", "clock"),
  ]);
  for (const s of f.stages) {
    const st = s as unknown as {
      stage: string; entered: number; advanced: number;
      decided: number; withheld: number; excluded: number; unaccounted: number;
    };
    assertEquals(
      st.entered - st.advanced,
      st.decided + st.withheld + st.excluded + st.unaccounted,
      `${st.stage} does not balance`,
    );
  }
});

// ───────────────── the engine half, which is where the symptom was ──────────
//
// Everything above builds `FunnelCompany` fixtures by hand, so it tests the
// COUNTING and not the marking. With the engine's gate marking removed, all of
// it still passed — which is the same toothless shape the counter itself had.
// This test runs the real engine and asks the real funnel.

Deno.test("THE ENGINE: a company the gate refuses is not reported as lost", async () => {
  const m = parseLeadMissionDeterministic(
    "Find B2B SaaS companies in the United Kingdom hiring sales representatives. " +
      "Return 5 qualified leads.",
  );
  const mission = {
    ...m,
    requested_count: 5,
    company_profile: { ...m.company_profile, employee_range: { min: 20, max: 200 } },
  };
  const row = (i: number) => ({
    companyName: `Co${i}`,
    linkedinUrl: `https://www.linkedin.com/company/co-${i}`,
    website: `https://co-${i}.com`,
    employeeCount: 60,
    description: `Co${i} is a B2B SaaS platform sold on subscription.`,
  });

  const result = await runCapabilityPlan({
    invoke: () =>
      Promise.resolve(
        Array.from({ length: 6 }, (_, i) => row(i)) as Record<string, unknown>[],
      ),
    // NO commercial signal comes back, so the Brain gate admits nobody. This is
    // the shape that produced 47-of-62 UNACCOUNTED on 8cfdfd10.
    verifyEmployer: () => ({ verified: false, outcome: "no_matching_open_role" }),
    evaluateMission: stubMissionEvaluator({ mission_fit: "review" }),
    planDiscovery: () =>
      Promise.resolve([{
        actor_key: "apify_linkedin_company_search",
        role: "primary",
        input: { searchQuery: "B2B SaaS", locations: ["United Kingdom"] },
      }]),
  } as never, {
    mission,
    plan: buildCapabilityGraph(mission as never),
    brain: {
      employee_min: 20,
      employee_max: 200,
      positive_industries: ["b2b saas"],
      excluded_industries: [] as string[],
      required_geography: null,
    } as never,
    maxCandidates: 50,
    remainingLeads: 5,
    readEnv: () => undefined,
  } as never);

  const companies = (result as unknown as { companies: unknown[] }).companies;
  const funnel = missionFunnelFor(companies as never);
  const brain = funnel.stages.find((s) => s.stage === "company_brain") as unknown as {
    entered: number; advanced: number; excluded: number;
    withheld: number; unaccounted: number;
  };

  assert(brain, "the company_brain stage must exist");
  assert(brain.entered > 0, "companies must have reached the stage at all");
  assertEquals(brain.advanced, 0, "no company had a qualifying signal");
  assertEquals(
    brain.unaccounted,
    0,
    `the gate refused all ${brain.entered} for a stated reason; reporting them ` +
      `as unaccounted is what made the alarm useless`,
  );
  assertEquals(
    brain.excluded + brain.withheld,
    brain.entered,
    "every refused company must carry one attribution or the other",
  );
});
