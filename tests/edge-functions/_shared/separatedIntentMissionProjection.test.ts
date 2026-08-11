// SEPARATEINTENT BECOMES A PROJECTION OF THE CANONICAL MISSION.
//
// `separateIntent` read the user's sentence with its own persona table, signal
// phrase list, geography table and role-family matcher, and its answer then
// travelled to run-agent as `lead_routing` — labelled "authoritative". That made
// it a SECOND semantic interpreter of a sentence the Mission had already
// interpreted once, and the two could disagree about persona, signal and role
// family without anything logging a conflict.
//
// `separatedIntentFromMission` produces the same DTO from fields the Mission
// decided. These tests prove the projection FOLLOWS the Mission and is blind to
// the words in `original_user_query`.
//
// No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  separatedIntentFromMission, type MissionForSeparation,
} from "../../../supabase/functions/_shared/leadIntentModel.ts";
import { DEFAULT_REQUESTED_COUNT } from "../../../supabase/functions/_shared/leadMission.ts";

/** A mission whose SENTENCE says one thing and whose FIELDS say another. */
const LOUD_QUERY =
  "Find 25 founders of B2B SaaS startups hiring RevOps in the United States, " +
  "profiles of the founders at acme.com";

function mission(over: Partial<MissionForSeparation> = {}): MissionForSeparation {
  return {
    original_user_query: LOUD_QUERY,
    mission_type: "qualified_lead_sourcing",
    requested_count: null,
    company_profile: { verticals: [], locations: [] },
    required_signals: [],
    decision_makers: { roles: [] },
    ...over,
  };
}

Deno.test("target_personas comes from decision_makers.roles, not from the sentence", () => {
  // The sentence names founders loudly; the mission decided otherwise.
  const quiet = separatedIntentFromMission(mission());
  assertEquals(quiet.target_personas, [], "no decided role ⇒ no persona invented");

  const decided = separatedIntentFromMission(mission({
    decision_makers: { roles: ["Head of Talent", "COO"] },
  }));
  assertEquals(decided.target_personas, ["Head of Talent", "COO"]);
  assert(
    !decided.target_personas.includes("Founder"),
    "the word 'founders' in the query may not add a persona the mission did not decide",
  );
});

Deno.test("requested_signal is 'required' exactly when the mission carries a signal", () => {
  assertEquals(separatedIntentFromMission(mission()).requested_signal, "none");
  assertEquals(
    separatedIntentFromMission(mission({ required_signals: [{ type: "funding" }] })).requested_signal,
    "required",
  );
});

Deno.test("requested_role_family comes from the mission's signal families", () => {
  const m = separatedIntentFromMission(mission({
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
  }));
  // A taxonomy KEY is normalised into the phrase the matcher speaks — that is
  // punctuation handling on a decided field, not a reading of free text.
  assertEquals(m.requested_role_family, "revenue_operations");
  assertEquals(m.role_exactness, "hard");
  assert(m.evidence_requirements.includes("exact_role_family_job_post"));
});

Deno.test("requested_role_family falls back to required_signal_terms, the user's own words as the mission recorded them", () => {
  const m = separatedIntentFromMission(mission({
    required_signals: [{ type: "hiring" }],
    required_signal_terms: ["RevOps"],
  }));
  assertEquals(m.requested_role_family, "revenue_operations");
});

Deno.test("no decided family means no family, however the query is worded", () => {
  const m = separatedIntentFromMission(mission({ required_signals: [{ type: "hiring" }] }));
  assertEquals(m.requested_role_family, null, "'hiring RevOps' in the sentence is not a decision");
  assertEquals(m.role_exactness, "none");
  assertEquals(m.relaxation_policy.role_family, "never");
});

Deno.test("source_strategy is profile_first only when the mission says discovery is skipped", () => {
  assertEquals(separatedIntentFromMission(mission()).source_strategy, "account_first");

  for (const supplied of [
    mission({ company_profile: { known_companies: ["acme.com"] } }),
    mission({ mission_type: "known_company_enrichment" }),
    mission({ strategies: ["supplied_company"] }),
  ]) {
    const p = separatedIntentFromMission(supplied);
    assertEquals(p.source_strategy, "profile_first");
    assertEquals(p.decision_maker_strategy, "direct_lookup");
  }
});

Deno.test("decision_maker_strategy follows the route and the decided personas", () => {
  assertEquals(
    separatedIntentFromMission(mission()).decision_maker_strategy,
    "none",
    "no persona to resolve",
  );
  assertEquals(
    separatedIntentFromMission(mission({ decision_makers: { roles: ["CEO"] } })).decision_maker_strategy,
    "resolve_after_account",
  );
});

Deno.test("geography follows company_profile.locations and geography_is_hard", () => {
  const none = separatedIntentFromMission(mission());
  assertEquals(none.geography, { values: [], hard: false });
  assertEquals(none.relaxation_policy.geography, "last_resort");

  const stated = separatedIntentFromMission(mission({
    company_profile: { locations: ["United States"] },
  }));
  assertEquals(stated.geography, { values: ["United States"], hard: true });
  assertEquals(stated.relaxation_policy.geography, "never");

  // An explicit soft geography is respected — the mission may say so.
  const soft = separatedIntentFromMission(mission({
    company_profile: { locations: ["Europe"] }, geography_is_hard: false,
  }));
  assertEquals(soft.geography.hard, false);
  assertEquals(soft.relaxation_policy.geography, "last_resort");
});

Deno.test("no_broadening_requested hardens every relaxation the mission allows", () => {
  const m = separatedIntentFromMission(mission({
    no_broadening_requested: true,
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
  }));
  assertEquals(m.relaxation_policy, { geography: "never", role_family: "never", size: "hard" });
});

Deno.test("result_limit is the mission's count, or the ONE runtime default", () => {
  assertEquals(separatedIntentFromMission(mission({ requested_count: 12 })).result_limit, 12);
  assertEquals(
    separatedIntentFromMission(mission({ requested_count: null })).result_limit,
    DEFAULT_REQUESTED_COUNT,
    "a null count applies effectiveRequestedCount(), never a re-read of the sentence " +
    "(which says 25)",
  );
});

Deno.test("the projection is blind to the sentence: same query, different missions, different DTOs", () => {
  const a = separatedIntentFromMission(mission({
    decision_makers: { roles: ["Founder"] },
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
    company_profile: { locations: ["United States"], verticals: ["b2b saas"] },
  }));
  const b = separatedIntentFromMission(mission());
  assertEquals(a.original_query, b.original_query, "same words");
  assert(
    JSON.stringify(a) !== JSON.stringify(b),
    "identical sentences must still project differently when the missions differ — " +
    "which is only possible if the mission, not the sentence, is being read",
  );
});

Deno.test("workspace configuration is carried, never re-derived", () => {
  const m = separatedIntentFromMission(mission(), {
    brain: { industries: ["staffing services"], disqualifiers: ["nonprofit"] },
    hardExclusions: ["recruiting agencies"],
  });
  assertEquals(m.target_company_profile.categories, ["staffing services"]);
  assertEquals(m.hard_exclusions, ["recruiting agencies", "nonprofit"]);

  // The mission's own verticals outrank the Brain's default.
  const decided = separatedIntentFromMission(
    mission({ company_profile: { verticals: ["fintech"] } }),
    { brain: { industries: ["staffing services"] } },
  );
  assertEquals(decided.target_company_profile.categories, ["fintech"]);
});

// ─────────────────────────── structural: no second parser ───────────────────

const MODEL_SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/leadIntentModel.ts", import.meta.url),
);

/** The CODE of a named function, comments stripped. */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(name);
  assert(i >= 0, `${name} must exist`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n}\n");
  return rest.slice(0, end > 0 ? end + 3 : rest.length)
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

Deno.test("the projection contains no parser of its own", () => {
  const body = fnBody(MODEL_SRC, "export function separatedIntentFromMission");
  for (const construct of ["RegExp", ".test(", ".match(", "PERSONA_PATTERNS", "SIGNAL_PHRASES", "NAMED_COMPANY_LOOKUP", "requestedRoleFamily("]) {
    assert(
      !body.includes(construct),
      `${construct} must not appear in the projection — it would make this a second reader`,
    );
  }
  assert(
    !/\/[^\/\n]+\/[gimsuy]*\.test/.test(body),
    "no inline regular expression may appear in the projection",
  );
});

Deno.test("both live callers project from the Mission", () => {
  const ORCH = Deno.readTextFileSync(
    new URL("../../../supabase/functions/orchestrate/index.ts", import.meta.url),
  );
  const RUN = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  );
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  assert(
    code(ORCH).includes("separatedIntentFromMission("),
    "orchestrate must build lead_routing from the Mission",
  );
  assert(
    !code(ORCH).includes("separateIntent({"),
    "orchestrate must not read the user's sentence for routing — it transports a Mission",
  );

  assert(
    code(RUN).includes("separatedIntentFromMission("),
    "run-agent must project the DTO when the task carries a Mission",
  );
  // The legacy text reader survives ONLY behind a no-mission guard.
  const runCode = code(RUN);
  const idx = runCode.indexOf("separateIntent({");
  assert(idx > 0, "the legacy reader is still referenced for missionless legacy tasks");
  const guard = runCode.slice(Math.max(0, idx - 600), idx);
  assert(
    /separationMission\s*\n?\s*\?/.test(guard) || guard.includes("separationMission"),
    "and only inside the `separationMission ? projection : legacy` branch",
  );
});
