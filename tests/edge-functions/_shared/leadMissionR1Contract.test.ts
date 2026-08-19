// R1 — DOES THE CANONICAL MISSION PRESERVE WHAT THE REQUEST DECLARED?
//
// Every test below drives `compileLeadMission` with a MOCKED proposal built from
// `tests/planner-eval/goldMissions.ts` — a model that reports exactly what the
// human reviewer found in the sentence, nothing more. No network, no provider,
// no OpenAI or Anthropic call; the compiler is pure and takes the raw output in.
//
// The mock is deliberately a PERFECT model. That isolates the question R1 is
// actually asking: if the model reads the sentence correctly, does the mission
// still carry the answer by the time compilation finishes? Anything lost here is
// lost in OUR code, not in the model.
//
// Two kinds of test live here and they are labelled differently on purpose:
//
//   PRESERVED — the constraint survives compilation today. A regression fails it.
//   R2 GAP    — the constraint is LOST today, by a precedence rule R1 is not
//               allowed to change. The test pins the current loss so the R2
//               cutover cannot happen silently: when R2 fixes it, this test
//               fails and must be rewritten as a PRESERVED test.
//
// A green suite here therefore does NOT mean the pipeline is correct. It means
// the pipeline behaves exactly as measured, and every deviation is deliberate.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compileLeadMission, MissionCompilationBlockedError,
} from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { EVAL_SET } from "../../planner-eval/dataset.ts";
import { GOLD_BY_ID, GOLD_MISSIONS, type GoldMission } from "../../planner-eval/goldMissions.ts";

/** A model that reports precisely what the reviewer found. Never a network. */
function perfectProposal(g: GoldMission): Record<string, unknown> {
  return {
    // The schema requires a number, so a request that states no count still has
    // to send one. `field_provenance` is what records that nobody asked for it —
    // asserted in its own test below.
    requested_opportunity_count: g.requested_count ?? 5,
    requested_contact_ready_count: null,
    company_types: g.icp.verticals,
    geographies: g.geographies,
    employee_range: { min: null, max: null },
    decision_maker_roles: g.personas,
    hard_constraints: [], soft_preferences: [],
    preferred_signals: g.signals, adjacent_signals: [], excluded_signals: [],
    allowed_broadening: {
      role_families: [], company_types: [], geographies: [],
      employee_range: { min: null, max: null },
    },
    disallowed_broadening: g.no_broadening_requested ? ["geography"] : [],
    required_evidence: [], required_capabilities: [], preferred_source_strategy: [],
    evaluation_instructions: "", founder_unlock_recommended: false,
    confidence: 0.9, unknowns: [],
    known_companies: g.known_companies,
    signal_recency_days: g.signal_recency_days,
    required_signal_terms: g.required_signal_terms,
    no_broadening_requested: g.no_broadening_requested,
    geography_is_hard: g.geography_is_hard,
    prohibitions: g.prohibitions,
    output_intent: g.output_intent,
  };
}

function compileGold(id: string) {
  const c = EVAL_SET.find((x) => x.id === id)!;
  const g = GOLD_BY_ID.get(id)!;
  return { gold: g, query: c.query, result: compileLeadMission({ originalUserQuery: c.query, proposal: perfectProposal(g) }) };
}

const ALL_IDS = EVAL_SET.map((c) => c.id);

// ===========================================================================
// PRESERVED
// ===========================================================================

Deno.test("PRESERVED: the raw user sentence reaches the model verbatim and returns unaltered", () => {
  for (const id of ALL_IDS) {
    const { query, result } = compileGold(id);
    assertEquals(
      result.final_mission.original_user_query, query,
      `${id}: the mission must carry the user's own sentence, never a restatement`,
    );
  }
});

Deno.test("PRESERVED: requested count, and provenance says whether anyone asked for it", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    if (gold.requested_count !== null) {
      assertEquals(
        result.final_mission.requested_count, gold.requested_count,
        `${id}: the stated count must survive intact`,
      );
      assertEquals(
        result.final_mission.field_provenance["requested_count"], "explicit_user_request",
        `${id}: a count the user stated must be attributed to the user`,
      );
    } else {
      // The contract cannot represent "no count requested" — requested_count is a
      // non-nullable number. Provenance is the only place that distinction lives,
      // so it is the thing worth asserting.
      assertEquals(
        result.final_mission.field_provenance["requested_count"], "system_default",
        `${id}: an unrequested count must be marked a default, never the user's ask`,
      );
    }
  }
});

Deno.test("PRESERVED: required signal terms survive verbatim, un-normalised", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.required_signal_terms ?? [], gold.required_signal_terms,
      `${id}: the user's own role words must not be mapped to a taxonomy key`,
    );
  }
  // The decisive one: nonsense stays nonsense rather than becoming "engineering".
  const { result } = compileGold("noBroaden-02");
  assertEquals(result.final_mission.required_signal_terms, ["Quantum Banana Sandwich Wizard Engineer"]);
});

Deno.test("PRESERVED: no-broadening reaches the canonical mission", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.no_broadening_requested ?? false, gold.no_broadening_requested,
      `${id}: a refusal to broaden is the request's hardest constraint`,
    );
  }
  assert(compileGold("noBroaden-01").result.final_mission.no_broadening_requested);
  assert(compileGold("noBroaden-02").result.final_mission.no_broadening_requested);
  // Its pair, identical but for the instruction, must NOT inherit it.
  assertEquals(compileGold("nonsense-01").result.final_mission.no_broadening_requested ?? false, false);
});

Deno.test("PRESERVED: exclusions — the actions a request forbids", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.prohibitions ?? [], gold.prohibitions,
      `${id}: a forbidden action must survive as a prohibition`,
    );
  }
  assertEquals(compileGold("enrich-01").result.final_mission.prohibitions, ["invent contacts"]);
  assertEquals(compileGold("persona-01").result.final_mission.prohibitions, ["send outreach"]);
});

Deno.test("PRESERVED: supplied entities survive, including companies named in prose", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.company_profile.known_companies ?? [], gold.known_companies,
      `${id}: supplied companies decide whether discovery runs at all`,
    );
  }
  // Before R1 this was empty: extractKnownCompanies matches DOMAINS only, and
  // the proposal schema had no field in which the model could report the names.
  assertEquals(
    compileGold("enrich-01").result.final_mission.company_profile.known_companies,
    ["Fireworks AI", "Notch", "1Commerce", "Palo Alto Networks", "Atlassian"],
  );
});

Deno.test("PRESERVED: required signals, and recency travels on the signal it constrains", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.required_signals.map((s) => s.type), gold.signals,
      `${id}: the signal set must match what the request implies`,
    );
  }
  // geo-01 names an ICP and a place and NO signal. Inventing one here silently
  // discards correct companies.
  assertEquals(compileGold("geo-01").result.final_mission.required_signals, []);

  // Recency attaches to each signal rather than to the mission at large.
  const withRecency = compileLeadMission({
    originalUserQuery: "Find 3 AI SaaS companies recently funded hiring SDRs in the US",
    proposal: { ...perfectProposal(GOLD_BY_ID.get("multi-01")!), signal_recency_days: 180 },
  });
  for (const s of withRecency.final_mission.required_signals) {
    assertEquals(s.timeframe_days, 180, "every required signal carries the recency window");
  }
});

Deno.test("PRESERVED: geography — kept, and any rewrite of the user's wording is recorded", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    const locs = result.final_mission.company_profile.locations;
    assertEquals(
      locs.length > 0, gold.geographies.length > 0,
      `${id}: a stated geography must not vanish, and an unstated one must not appear`,
    );
    // Where the compiler canonicalises the user's wording (USA → United States),
    // the substitution must be NAMED. Asserting the alias table here would just
    // re-encode the deterministic parser's own answer as the answer key.
    for (const want of gold.geographies) {
      const kept = locs.some((l) =>
        l.toLowerCase().includes(want.toLowerCase()) || want.toLowerCase().includes(l.toLowerCase()));
      const recorded = result.validator_changes.some((c) =>
        c.startsWith("geographies_overridden_by_user_words:") && c.includes(want));
      assert(kept || recorded, `${id}: "${want}" was neither kept nor recorded as rewritten`);
    }
    assertEquals(
      result.final_mission.geography_is_hard ?? false, gold.geography_is_hard,
      `${id}: a geography the user named themselves may never be widened`,
    );
  }
});

Deno.test("PRESERVED: the model's output intent is carried and its disagreement recorded", () => {
  for (const id of ALL_IDS) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.proposed_output_intent ?? null, gold.output_intent,
      `${id}: the model's reading of what the user wants back must be carried`,
    );
    if (gold.output_intent && gold.output_intent !== result.final_mission.requested_output) {
      assert(
        result.validator_changes.some((c) => c.startsWith("output_intent_proposed_not_authoritative:")),
        `${id}: a disagreement about the deliverable must be recorded, not silent`,
      );
    }
  }
});

// ===========================================================================
// R2 GAPS — pinned losses. When R2 fixes one, its test fails. That is the point.
// ===========================================================================

Deno.test("R2 GAP: an empty persona is overwritten by a default founder set", () => {
  // The deterministic pass injects Founder/Co-Founder/CEO whenever the query
  // contains people-ish words ("leads", "hiring ... roles"), and
  // validateLeadMission only takes the model's roles when they are NON-EMPTY.
  // A model correctly reporting "the user named no persona" therefore cannot say
  // so, and the mission acquires a targeting constraint nobody asked for.
  //
  // persona-02 is the worst of the three: "founder-support roles" is the job
  // being HIRED, and the mission ends up targeting founders.
  const LOSES_EMPTY_PERSONA = ["persona-02", "multi-02", "noBroaden-01"];
  for (const id of LOSES_EMPTY_PERSONA) {
    const { gold, result } = compileGold(id);
    assertEquals(gold.personas, [], `${id}: the fixture must declare no persona`);
    assertEquals(
      result.final_mission.decision_makers.roles, ["Founder", "Co-Founder", "CEO"],
      `${id}: pinned loss — if this now matches the gold, R2 has landed; rewrite this as PRESERVED`,
    );
  }

  // Everywhere else a stated persona survives exactly, including "owner", which
  // must not be folded into the founder set.
  for (const id of ALL_IDS.filter((i) => !LOSES_EMPTY_PERSONA.includes(i))) {
    const { gold, result } = compileGold(id);
    assertEquals(
      result.final_mission.decision_makers.roles.map((r) => r.toLowerCase()), gold.personas,
      `${id}: a stated persona must survive unchanged`,
    );
  }
  assertEquals(
    compileGold("persona-01").result.final_mission.decision_makers.roles.map((r) => r.toLowerCase()),
    ["founder", "owner"],
  );
});

Deno.test("PRESERVED: output intent is obeyed — R2's cutover has landed", () => {
  // Was `R2 GAP: output intent is recorded but never obeyed`.
  //
  // `validateLeadMission` used to overwrite requested_output / target_entity /
  // mission_type from the deterministic reading unconditionally, so the marker
  // table decided what the run was FOR while the model interpreted everything
  // else. These two cases are where the two readings differ, and the model's
  // now stands.
  const DISAGREES = ["persona-02", "multi-02"];
  for (const id of DISAGREES) {
    const { gold, result } = compileGold(id);
    assertEquals(result.final_mission.proposed_output_intent, gold.output_intent);
    assertEquals(
      result.final_mission.requested_output, gold.output_intent,
      `${id}: the reviewer's reading of what was asked for must now be the mission's`,
    );
    // The disagreement is still visible — a run whose two readings differ is
    // exactly the run worth looking at.
    assert(
      result.validator_changes.some((c) => c.startsWith("output_intent_model_authoritative:")),
      `${id}: the disagreement with the deterministic reading must still be recorded`,
    );
  }

  // Everywhere else the two agree, and nothing is recorded.
  const { result: agrees } = compileGold("simple-01");
  assertFalse(
    agrees.validator_changes.some((c) => c.startsWith("output_intent_model_authoritative:")),
    "agreement must stay silent, or the record means nothing",
  );
});

Deno.test("R2 GAP: the contract has no output value meaning 'social posts'", () => {
  // social-01 asks for LinkedIn POSTS. RequestedOutput offers contact_ready_leads,
  // qualified_companies, job_listings and enriched_companies — none of them.
  // The gold records null BECAUSE THE CONTRACT CANNOT SAY IT.
  const { gold, result } = compileGold("social-01");
  assertEquals(gold.output_intent, null);
  assertEquals(result.final_mission.proposed_output_intent ?? null, null);
  // The mission still has to say something, and what it says is wrong.
  assertEquals(result.final_mission.requested_output, "contact_ready_leads");
});

Deno.test("R2 GAP: a stated ICP term can be dropped when the parser recognises a sibling", () => {
  // persona-01 states "recruiting Agency in B2B". The deterministic vertical
  // table matches "recruiting agencies" and, being non-empty, wins outright —
  // so "B2B" is discarded rather than merged.
  const { result } = compileGold("persona-01");
  assertEquals(result.final_mission.company_profile.verticals, ["recruiting agencies"]);
  assert(
    result.validator_changes.some((c) => c.startsWith("company_types_overridden_by_user_words:") && c.includes("B2B")),
    "the dropped ICP term must at least be recorded",
  );
});

// ===========================================================================
// FIXTURE INTEGRITY — the answer key has to be trustworthy before it proves anything
// ===========================================================================

Deno.test("every dataset case has exactly one gold mission, and no gold is orphaned", () => {
  assertEquals(GOLD_MISSIONS.length, EVAL_SET.length);
  for (const c of EVAL_SET) assert(GOLD_BY_ID.has(c.id), `no gold mission for ${c.id}`);
  for (const g of GOLD_MISSIONS) {
    assert(EVAL_SET.some((c) => c.id === g.id), `gold ${g.id} matches no dataset case`);
  }
});

Deno.test("gold agrees with the dataset's own declared expectations", () => {
  // dataset.ts's `expect` was authored separately, as "what the request DECLARES".
  // Two independent readings of the same sentence agreeing is what makes either
  // usable as an answer key; a disagreement means one of them misread it.
  for (const c of EVAL_SET) {
    const g = GOLD_BY_ID.get(c.id)!;
    assertEquals(g.requested_count, c.expect.requestedCount, `${c.id}: count`);
    assertEquals(g.no_broadening_requested, c.expect.noBroadening, `${c.id}: no-broadening`);
    assertEquals(g.personas, c.expect.personas, `${c.id}: personas`);
    assertEquals(
      g.known_companies.length > 0, c.expect.suppliedEntities,
      `${c.id}: supplied entities`,
    );
    assertEquals(
      g.geographies.length > 0, c.expect.geography !== null,
      `${c.id}: geography presence`,
    );
  }
});

Deno.test("a field listed as undetermined is genuinely left empty", () => {
  // Otherwise `undetermined` becomes decoration and the fixture quietly asserts a
  // constraint the request never made.
  for (const g of GOLD_MISSIONS) {
    for (const f of g.undetermined) {
      if (f === "requested_count") assertEquals(g.requested_count, null, `${g.id}`);
      if (f === "signal_recency_days") assertEquals(g.signal_recency_days, null, `${g.id}`);
      if (f === "personas") assertEquals(g.personas, [], `${g.id}`);
      if (f === "signals") assertEquals(g.signals, [], `${g.id}`);
      if (f === "icp.verticals") assertEquals(g.icp.verticals, [], `${g.id}`);
      if (f === "output_intent") assertEquals(g.output_intent, null, `${g.id}`);
    }
  }
});

Deno.test("gold was not copied from the deterministic parser", () => {
  // If the fixtures had been generated by running the parsers, they could not
  // disagree with them — and the three persona cases below plus social-01's null
  // output intent are exactly where the parsers are wrong. This asserts the answer
  // key is independent of the system it grades.
  const disagreements = ALL_IDS.filter((id) => {
    const { gold, result } = compileGold(id);
    return JSON.stringify(result.final_mission.decision_makers.roles.map((r) => r.toLowerCase())) !==
      JSON.stringify(gold.personas);
  });
  assert(
    disagreements.length > 0,
    "gold agreeing with the parser on every case would mean it was derived from it",
  );
  assertEquals(disagreements.sort(), ["multi-02", "noBroaden-01", "persona-02"]);
});

// ===========================================================================
// SCHEMA SHAPE
// ===========================================================================

Deno.test("the R1 fields are read defensively — an omitting model fabricates nothing", () => {
  const minimal = compileLeadMission({
    originalUserQuery: "Find 5 B2B SaaS companies hiring SDRs",
    proposal: { requested_opportunity_count: 5 },
  });
  const m = minimal.final_mission;
  assertEquals(m.no_broadening_requested ?? false, false, "silence is not a refusal to broaden");
  assertEquals(m.required_signal_terms ?? [], []);
  assertEquals(m.prohibitions ?? [], []);
  assertEquals(m.geography_is_hard ?? false, false);
  assertEquals(m.proposed_output_intent ?? null, null);
  assertEquals(m.company_profile.known_companies ?? [], []);
});

Deno.test("recency is clamped, not trusted, and never invents a window", () => {
  const g = GOLD_BY_ID.get("multi-01")!;
  const tooLong = compileLeadMission({
    originalUserQuery: "Find 3 recently funded AI SaaS companies",
    proposal: { ...perfectProposal(g), signal_recency_days: 3650 },
  });
  for (const s of tooLong.final_mission.required_signals) assertEquals(s.timeframe_days, 730);
  assert(tooLong.validator_changes.some((c) => c.startsWith("signal_recency_days_capped:")));

  const none = compileLeadMission({
    originalUserQuery: "Find 3 AI SaaS companies",
    proposal: { ...perfectProposal(g), signal_recency_days: null },
  });
  for (const s of none.final_mission.required_signals) {
    assertEquals(s.timeframe_days, undefined, "an unstated window must not become a constraint");
  }
});

Deno.test("an unsafe proposal BLOCKS rather than half-applying the new fields", () => {
  // The property is unchanged: a proposal that tries to name an Actor must not
  // be sanitised and partly used. What changed is the answer to "then what?" —
  // it used to be the regex reading, and is now a stated refusal.
  let blocked: MissionCompilationBlockedError | null = null;
  try {
    compileLeadMission({
      originalUserQuery: "Find exactly 5 SDR hiring leads in London. Do not broaden outside London.",
      proposal: {
        ...perfectProposal(GOLD_BY_ID.get("noBroaden-01")!),
        actor_id: "memo23/some-scraper",
      },
    });
  } catch (e) {
    if (e instanceof MissionCompilationBlockedError) blocked = e;
    else throw e;
  }
  assert(blocked, "an unsafe proposal must not produce a mission at all");
  assert(blocked!.reasons.length > 0, "and the refusal names what was unsafe");
});
