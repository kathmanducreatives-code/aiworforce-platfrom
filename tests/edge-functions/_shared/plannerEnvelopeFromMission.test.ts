// THE CLAUDE PLANNER'S ENVELOPE OBEYS THE CANONICAL MISSION.
//
// `buildLeadMission` builds the envelope the Claude-first planner reasons over,
// and it built every field of it by re-reading the instruction: `resolveJobIntent`
// for the hiring role and the decision maker, `buildLeadGeographyContext` for the
// geography, `extractRequestedLeadCount` for the quota. That was the only option
// before LeadMissionV1 existed. With a canonical Mission threaded in it is a
// second reading of a sentence already interpreted — and the two could disagree
// about WHO to contact and WHERE, which is the exact pair this envelope was
// written to keep from collapsing into each other.
//
// The GPT adapter received the Mission in R2-5; this is the same cutover for the
// Claude adapter.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLeadMission, DEFAULT_REQUESTED_LEAD_COUNT,
} from "../../../supabase/functions/_shared/intelligence/leads/leadMission.ts";

/** A sentence whose every semantic differs from the Mission threaded beside it. */
const CONTRADICTING =
  "Find 30 founders at seed-stage fintech companies in London currently hiring SDRs";

const CANONICAL = {
  company_profile: {
    verticals: ["b2b saas"], stages: ["growth_stage"], locations: ["United States"],
  },
  required_signals: [{ type: "funding" }],
  required_signal_terms: ["RevOps"],
  decision_makers: { roles: ["Head of Talent"], current_employment_required: false },
};

function build(canonicalMission: unknown | null) {
  return buildLeadMission({
    missionId: "m-1", workspaceId: "ws-1",
    originalInstruction: CONTRADICTING,
    environmentMode: "test",
    canonicalMission: canonicalMission as never,
  });
}

Deno.test("the person to contact is the Mission's, not the sentence's 'founders'", () => {
  const m = build(CANONICAL);
  assertEquals(m.decision_maker.roles, ["Head of Talent"]);
  assertEquals(m.decision_maker.current_employer_required, false);
});

Deno.test("the geography is the Mission's, and the parser's reading is kept as advisory", () => {
  const m = build(CANONICAL);
  assertEquals(m.company_target.geography.explicit_raw_locations, ["United States"]);
  assertEquals(m.company_target.geography.normalized_locations, ["United States"]);
  assertEquals(m.company_target.geography.source, "explicit_user");
  // The parser's own locations survive only where they always belonged: as the
  // advisory `parser_locations`, which a planner may see but not mistake for the
  // user's words.
  assert(
    !m.company_target.geography.normalized_locations.includes("London"),
    "the sentence's London may not become the executed geography",
  );
});

Deno.test("vertical, stage and signal follow the Mission", () => {
  const m = build(CANONICAL);
  assertEquals(m.company_target.verticals, ["b2b saas"], "the sentence says fintech");
  assertEquals(m.company_target.company_stages, ["growth_stage"], "the sentence says seed-stage");
  assertEquals(m.signal.types, ["funding"], "the sentence says hiring");
});

Deno.test("the role words the Mission preserved become the explicit titles", () => {
  assertEquals(build(CANONICAL).hiring_role.explicit_titles, ["RevOps"]);
});

Deno.test("a Mission that stated nothing erases nothing", () => {
  // Absent is not the same as empty. A Mission with no geography must leave the
  // parser's reading in place rather than blanking a constraint the user gave.
  const quiet = build({ company_profile: {}, decision_makers: {} });
  const legacy = build(null);
  assertEquals(
    quiet.company_target.geography.explicit_raw_locations,
    legacy.company_target.geography.explicit_raw_locations,
  );
  assertEquals(quiet.decision_maker.roles, legacy.decision_maker.roles);
});

Deno.test("with no Mission the envelope is exactly what it was before", () => {
  const legacy = build(null);
  assertEquals(legacy.output.requested_count, DEFAULT_REQUESTED_LEAD_COUNT);
  assert(
    legacy.decision_maker.roles.length > 0,
    "the deterministic path still reads the person clause — it is the only reading there is",
  );
});

// ─────────────────────── structural: the seam is wired ───────────────────────

const BRIDGE = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/intelligence/leads/leadPlanningBridge.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const ORCHESTRATION = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/intelligence/leads/leadPlanOrchestration.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("the call site threads the Mission to BOTH adapters", () => {
  assert(
    /mission: input\.leadMission \?\? null/.test(ORCHESTRATION),
    "the GPT adapter receives it (R2-5)",
  );
  assert(
    /canonicalMission: mission/.test(ORCHESTRATION),
    "and so does the Claude adapter",
  );
  assert(
    /canonicalMission: input\.canonicalMission \?\? null/.test(BRIDGE),
    "the bridge passes it into the envelope builder rather than dropping it",
  );
});

Deno.test("the plan contract's vertical is Mission-only when a Mission exists", () => {
  const i = ORCHESTRATION.indexOf("companyVertical: mission");
  assert(i > 0, "the contract must decide its vertical from the Mission");
  const line = ORCHESTRATION.slice(i, i + 220);
  assert(
    !line.includes("?? spec.company_vertical"),
    "falling back to the compiled spec's vertical would let the sentence decide " +
    "after all: a Mission that named no vertical means there is none",
  );
});
