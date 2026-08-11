// WHAT GETS SEARCHED FOR IS THE MISSION'S DECISION.
//
// `planScoutQueries` compiles the jobs actor's query and location, and run-agent
// then OVERWRITES `normalizedQuery` and `location` with them and hands the same
// intent to the lead TIERING (`tierAndCount`). It built that intent by parsing
// the instruction with a category table, a role table, a geography table, a
// funding table and a size table — so a regex decided what was bought and which
// results counted, after the Mission had decided both from the same words.
//
// `leadSearchIntentFromMission` answers those questions from decided fields. What
// remains is formatting: turning a decided "United States" into the query
// builder's `US` group is provider-input shaping, not a reading of the request.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  leadSearchIntentFromMission, extractLeadSearchIntent, type MissionForSearchIntent,
} from "../../../supabase/functions/_shared/leadSearchIntent.ts";
import { planScoutQueries } from "../../../supabase/functions/_shared/scoutSourcingPlan.ts";

/** A sentence whose every semantic differs from the Mission beside it. */
const CONTRADICTING =
  "Find 30 recently funded ecommerce companies in London hiring SDRs, 10-100 employees";

function mission(over: Partial<MissionForSearchIntent> = {}): MissionForSearchIntent {
  return {
    original_user_query: CONTRADICTING,
    requested_count: 7,
    company_profile: {
      verticals: ["b2b saas"], stages: [], locations: ["United States"],
    },
    required_signals: [{ type: "hiring", role_families: ["rev_ops"] }],
    required_signal_terms: ["RevOps"],
    ...over,
  };
}

const BRAIN = { industries: ["Staffing"], disqualifiers: ["nonprofit"], geography: "UK" };

Deno.test("categories and roles come from the Mission, not the category/role tables", () => {
  const i = leadSearchIntentFromMission(mission());
  assertEquals(i.must_have_categories, ["b2b saas"], "the sentence says ecommerce");
  assert(i.role_terms.includes("RevOps"), "the sentence says SDRs");
  assertEquals(i.must_have_roles, ["RevOps"]);
});

Deno.test("the funding requirement is a decided signal, not a phrase match", () => {
  assertEquals(
    leadSearchIntentFromMission(mission()).funding_required, false,
    "'recently funded' in the sentence is not a decision",
  );
  assertEquals(
    leadSearchIntentFromMission(mission({
      required_signals: [{ type: "funding" }],
    })).funding_required,
    true,
  );
  // The text reader disagrees on the same sentence — which is the whole point.
  assertEquals(extractLeadSearchIntent({ message: CONTRADICTING }).funding_required, true);
});

Deno.test("the geography is the Mission's, formatted for the query builder", () => {
  const i = leadSearchIntentFromMission(mission());
  assertEquals(i.location_groups, ["US"], "'United States' becomes the builder's US group");
  assertEquals(i.locations, [], "and London does not survive");
  assertEquals(i.location_explicit, true);
  assertEquals(i.relaxation_allowed.location, false, "a decided geography is never relaxed");
});

Deno.test("a Mission that named no geography falls back to the Brain, relaxably", () => {
  const i = leadSearchIntentFromMission(
    mission({ company_profile: { verticals: ["b2b saas"], locations: [] } }), BRAIN,
  );
  assertEquals(i.locations, ["UK"], "the workspace geography backfills");
  assertEquals(i.location_explicit, false, "but it is not an explicit request");
  assertEquals(i.relaxation_allowed.location, true, "so it stays relaxable");
});

Deno.test("a soft geography stated by the Mission is relaxable", () => {
  const i = leadSearchIntentFromMission(mission({ geography_is_hard: false }));
  assertEquals(i.location_explicit, false);
  assertEquals(i.relaxation_allowed.location, true);
});

Deno.test("the count and the size range are decided fields", () => {
  assertEquals(leadSearchIntentFromMission(mission()).requested_count, 7, "the sentence says 30");
  assertEquals(
    leadSearchIntentFromMission(mission({ requested_count: null })).requested_count, 5,
    "a null count applies the default, not the sentence's number",
  );
  const sized = leadSearchIntentFromMission(mission({
    company_profile: { verticals: ["b2b saas"], employee_range: { min: 20, max: 200 } },
  }));
  assertEquals(sized.company_size_preference, { min: 20, max: 200, strict: false });
});

Deno.test("no_broadening_requested closes every relaxation the Mission allows", () => {
  const i = leadSearchIntentFromMission(mission({ no_broadening_requested: true }));
  assertEquals(i.relaxation_allowed.location, false);
  assertEquals(i.relaxation_allowed.exact_role, false);
  assertEquals(i.relaxation_allowed.size, false);
  assertEquals(i.relaxation_allowed.category, false);
});

Deno.test("a safety disqualifier that collides with the Mission's own target is dropped", () => {
  // The text version dropped one that collided with an explicit "find
  // recruitment agencies". The collision is now judged against a decided field.
  const i = leadSearchIntentFromMission(mission({
    company_profile: { verticals: ["recruiting agency"], locations: [] },
  }));
  assert(
    !i.hard_disqualifiers.some((d) => /recruit/i.test(d)),
    "a default exclusion must not sabotage the exact search the Mission asked for",
  );
  // Unrelated defaults stay.
  assert(i.hard_disqualifiers.some((d) => /mining|oil|government/i.test(d)));
});

Deno.test("planScoutQueries projects when a Mission is supplied and parses when it is not", () => {
  const projected = planScoutQueries({ instruction: CONTRADICTING, mission: mission() });
  assert(projected, "a decided category and role must still produce a plan");
  assertEquals(projected.intent.must_have_categories, ["b2b saas"]);
  assert(
    !/sdr/i.test(projected.primary.keywords),
    `the sentence's SDR must not reach the actor query: ${projected.primary.keywords}`,
  );

  const parsed = planScoutQueries({ instruction: CONTRADICTING });
  assert(parsed, "a missionless legacy task still plans from the instruction");
  assertEquals(parsed.intent.must_have_categories, ["ecommerce"]);
});

// ─────────────────────── structural: run-agent is wired ──────────────────────

Deno.test("run-agent hands the Mission to the scout planner", () => {
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const i = RUN.indexOf("planScoutQueries({");
  assert(i > 0, "the scout planner call must still exist");
  assert(
    RUN.slice(i, i + 300).includes("mission: separationMission"),
    "the persisted Mission must reach it, or the jobs query is still a regex's answer",
  );
});
