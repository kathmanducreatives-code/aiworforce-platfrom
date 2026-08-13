// THE MISSION IS THE QUALIFICATION AUTHORITY.
//
// THE RUN THESE TESTS EXIST TO PREVENT — TEST plan
// cf6cce3d-1283-468e-9bff-cba13a06d8c0, 2026-08-13, build bd8eef5c.
//
// Mission: "Find 10 AI startups in the United States that are hiring software
// engineers." — gpt_validated, verticals ["AI startups"], stages ["startup"],
// locations ["united states"], required_signal_terms
// ["software engineers","hiring"], company_profile.employee_range NULL.
//
// The new architecture executed end to end and qualified ZERO of 100:
//
//     technical_only            42
//     insufficient_commercial   15
//     employee_size              7
//
// Two authorities answered a question the user did not ask:
//
//   * `commercialSignalPolicy` classifies "Software Engineer" as `technical`,
//     and `technical` can never produce a qualifying tier — so the funnel
//     rejected precisely the companies the Mission asked for.
//   * The workspace Brain contributed employee bounds 10-150 and
//     `hard_constraints: ["employee_count","industry","business_model"]`, none
//     of which the Mission mentioned. Its `employee_range` was NULL.
//
// These tests drive the REAL functions. No network, provider, model or DB.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildQualificationContext, resolveEmployeeBounds, brainMayReject,
  normalizeRoleTerm, qualificationContextSummary,
} from "../../../supabase/functions/_shared/missionQualificationContext.ts";
import { classifyTitle } from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import {
  prequalifyYcCompanies,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";

/** The Mission exactly as the run recorded it. */
const MISSION = {
  version: "lead-mission-v1",
  mission_parser_source: "gpt_validated",
  original_user_query:
    "Find 10 AI startups in the United States that are hiring software engineers.",
  target_entity: "company",
  requested_output: "qualified_companies",
  requested_count: 10,
  strategies: ["hiring"],
  company_profile: {
    verticals: ["AI startups"],
    stages: ["startup"],
    locations: ["united states"],
    business_models: [],
    // THE MISSION SET NO SIZE BOUND. This is the field the Brain's 10-150
    // overrode in the failing run.
    employee_range: null,
  },
  required_signals: [{ type: "hiring software engineers" }],
  required_signal_terms: ["software engineers", "hiring"],
  geography_is_hard: true,
  hard_constraints: {
    hiring: { value: "hiring software engineers", operator: "equals" },
    geography: { value: "United States", operator: "equals" },
  },
  soft_preferences: {},
  required_capabilities: ["startup_company_discovery", "persistence"],
  prohibited_capabilities: [],
} as never;

/** The workspace Brain that rejected everything, as recorded. */
const CONFLICTING_BRAIN = { employee_min: 10, employee_max: 150 };

// ═══ 1. THE CONTEXT CARRIES THE MISSION'S REQUIREMENTS ═════════════════════

Deno.test("context: Mission requirements are present and attributed", () => {
  const ctx = buildQualificationContext(MISSION);
  assertEquals(ctx.verticals, ["ai startups"]);
  assertEquals(ctx.stages, ["startup"]);
  assertEquals(ctx.locations, ["united states"]);
  assertEquals(ctx.strategies, ["hiring"]);
  assertEquals(ctx.target_entity, "company");
  assertEquals(
    ctx.original_user_query,
    "Find 10 AI startups in the United States that are hiring software engineers.",
  );
  assertEquals(Object.keys(ctx.hard_constraints).sort(), ["geography", "hiring"]);
});

Deno.test("context: the Mission owns the axes it spoke about, and only those", () => {
  const ctx = buildQualificationContext(MISSION);
  assertEquals(ctx.mission_owns.industry, true, "verticals were named");
  assertEquals(ctx.mission_owns.geography, true, "locations were named");
  assertEquals(ctx.mission_owns.stage, true, "stages were named");
  assertEquals(ctx.mission_owns.hiring_role, true, "a role requirement was named");
  assertEquals(ctx.mission_owns.employee_count, false,
    "employee_range was NULL — the Mission said nothing about size");
});

Deno.test("context: the role vocabulary comes from the Mission", () => {
  const ctx = buildQualificationContext(MISSION);
  assertEquals(ctx.role_vocabulary.source, "mission");
  assert(ctx.role_vocabulary.required_titles.includes("software engineer"),
    `expected a software-engineer title, got ${JSON.stringify(ctx.role_vocabulary.required_titles)}`);
  assert(!ctx.role_vocabulary.required_titles.includes("hiring"),
    "a bare signal word is not a role title");
});

Deno.test("normalizeRoleTerm: canonicalizes decided fields, drops signal words", () => {
  assertEquals(normalizeRoleTerm("software engineers"), "software engineer");
  assertEquals(normalizeRoleTerm("hiring software engineers"), "software engineer");
  assertEquals(normalizeRoleTerm("hiring"), null);
  assertEquals(normalizeRoleTerm("funding"), null);
  assertEquals(normalizeRoleTerm("  "), null);
  // Words that legitimately end in s are not truncated.
  assertEquals(normalizeRoleTerm("sales"), "sales");
});

// ═══ 2. MISSION HARD CONSTRAINTS OVERRIDE CONFLICTING BRAIN POLICY ═════════

Deno.test("authority: a Brain size bound cannot reject when the Mission set none", () => {
  const ctx = buildQualificationContext(MISSION);
  const bounds = resolveEmployeeBounds(ctx, CONFLICTING_BRAIN);
  assertEquals(bounds.enforceable, false,
    "the Brain's 10-150 must be advisory when the Mission named no range");
  assertEquals(bounds.source, "brain_advisory");
  assertEquals(bounds.min, 10, "the bound survives for RANKING");
  assertEquals(bounds.max, 150);
});

Deno.test("authority: the Mission's own size bound IS enforceable", () => {
  const sized = {
    ...MISSION,
    company_profile: { ...(MISSION as never as Record<string, never>)["company_profile"] as never,
      employee_range: { min: 1, max: 50 } },
  } as never;
  const bounds = resolveEmployeeBounds(buildQualificationContext(sized), CONFLICTING_BRAIN);
  assertEquals(bounds.enforceable, true);
  assertEquals(bounds.source, "mission");
  assertEquals(bounds.min, 1);
  assertEquals(bounds.max, 50, "the Mission's ceiling, not the Brain's 150");
});

Deno.test("authority: the Brain keeps its bounds when the Mission is silent AND has none", () => {
  const ctx = buildQualificationContext(MISSION);
  const none = resolveEmployeeBounds(ctx, { employee_min: null, employee_max: null });
  assertEquals(none.source, "none");
  assertEquals(none.enforceable, false);
});

Deno.test("authority: brainMayReject is false exactly on Mission-owned axes", () => {
  const ctx = buildQualificationContext(MISSION);
  assertEquals(brainMayReject(ctx, "industry"), false, "Mission named verticals");
  assertEquals(brainMayReject(ctx, "geography"), false, "Mission named locations");
  assertEquals(brainMayReject(ctx, "stage"), false, "Mission named stages");
  assertEquals(brainMayReject(ctx, "hiring_role"), false, "Mission named a role");
  assertEquals(brainMayReject(ctx, "employee_count"), true,
    "Mission said nothing about size, so the Brain still governs it");
});

// ═══ 3. THE HIRING REQUIREMENT IS EVALUATED FROM THE MISSION'S ROLE ════════

Deno.test("hiring: a software-engineer opening QUALIFIES under this Mission", () => {
  const vocab = buildQualificationContext(MISSION).role_vocabulary;
  for (const title of [
    "Software Engineer",
    "Senior Software Engineer",
    "Software Engineer, Applied AI",
    "Founding Engineer",
  ]) {
    const cls = classifyTitle(title, vocab);
    assert(cls === "A" || cls === "technical", `${title} -> ${cls}`);
  }
  // The two the Mission literally names must be QUALIFYING, not merely tolerated.
  assertEquals(classifyTitle("Software Engineer", vocab), "A");
  assertEquals(classifyTitle("Software Engineer, Applied AI", vocab), "A");
});

Deno.test("hiring: this is NOT a generic 'company has jobs' check", () => {
  const vocab = buildQualificationContext(MISSION).role_vocabulary;
  // An unrelated opening does not satisfy a software-engineering Mission.
  assertEquals(classifyTitle("Office Manager", vocab), "other");
  assertEquals(classifyTitle("Head of Sales", vocab), "other",
    "a commercial role does not satisfy a Mission that asked for engineers");
});

Deno.test("hiring: the default commercial ladder is unchanged without a Mission vocab", () => {
  // Byte-identical behaviour for missionless / non-role Missions.
  assertEquals(classifyTitle("Head of Sales"), "A");
  assertEquals(classifyTitle("Account Executive"), "B");
  assertEquals(classifyTitle("Head of Operations"), "C");
  assertEquals(classifyTitle("Software Engineer"), "technical");
  assertEquals(classifyTitle(""), "other");
});

Deno.test("hiring: a Mission naming commercial roles still uses ITS list", () => {
  const revops = {
    ...MISSION,
    required_signals: [{ type: "hiring" }],
    required_signal_terms: ["revenue operations"],
  } as never;
  const vocab = buildQualificationContext(revops).role_vocabulary;
  assertEquals(vocab.source, "mission");
  assertEquals(classifyTitle("Revenue Operations Manager", vocab), "A");
  assertEquals(classifyTitle("Software Engineer", vocab), "technical",
    "engineers do not satisfy a RevOps Mission");
});

// ═══ 4. END TO END THROUGH THE REAL PREQUALIFIER ═══════════════════════════

/** Three YC-shaped rows mirroring the failing run's population. */
const ROWS = [
  { name: "Raydar", website: "https://raydar.xyz", teamSize: 6,
    openJobs: [{ title: "Software Engineer" }] },                       // engineers only, below Brain min
  { name: "MindFort AI", website: "https://mindfort.ai", teamSize: 4,
    openJobs: [{ title: "Software Engineer" }] },                       // engineers only, below Brain min
  { name: "Widget Co", website: "https://widget.example", teamSize: 40,
    openJobs: [{ title: "Office Manager" }] },                          // nothing the Mission wants
];

Deno.test("E2E: the failing run's exclusions do not recur under Mission authority", () => {
  const ctx = buildQualificationContext(MISSION);
  const bounds = resolveEmployeeBounds(ctx, CONFLICTING_BRAIN);
  const res = prequalifyYcCompanies(
    ROWS as never,
    { min: bounds.min, max: bounds.max },
    { vocabulary: ctx.role_vocabulary, size_enforceable: bounds.enforceable },
  );

  const by = new Map(res.companies.map((c) => [c.name, c]));
  const raydar = by.get("Raydar")!;
  const mindfort = by.get("MindFort AI")!;
  const widget = by.get("Widget Co")!;

  assertEquals(raydar.exclusion, null, "no technical_only for a software-engineer Mission");
  assertEquals(raydar.eligible, true);
  assertEquals(mindfort.exclusion, null);
  assertEquals(mindfort.eligible, true);

  assertEquals(res.technical_only_companies, 0, "technical_only must be extinct here");
  assertEquals(res.employee_size_excluded, 0,
    "the Brain's 10-150 may not exclude a 6-person startup on a Mission with no size bound");

  // A company hiring nothing the Mission asked for is still correctly excluded.
  assertEquals(widget.eligible, false);
  assertEquals(widget.exclusion, "insufficient_commercial");
});

Deno.test("E2E: the same rows under the OLD behaviour reproduce the failure", () => {
  // No mission policy — exactly what the failing run did.
  const res = prequalifyYcCompanies(ROWS as never, { min: 10, max: 150 });
  assertEquals(res.eligible_companies, 0, "this is the bug: nothing qualified");
  assert(res.technical_only_companies + res.employee_size_excluded > 0,
    "and it was technical_only / employee_size that did it");
});

Deno.test("E2E: a Mission size bound still rejects an out-of-range company", () => {
  const sized = {
    ...MISSION,
    company_profile: { ...(MISSION as never as Record<string, never>)["company_profile"] as never,
      employee_range: { min: 1, max: 5 } },
  } as never;
  const ctx = buildQualificationContext(sized);
  const bounds = resolveEmployeeBounds(ctx, CONFLICTING_BRAIN);
  const res = prequalifyYcCompanies(
    ROWS as never, { min: bounds.min, max: bounds.max },
    { vocabulary: ctx.role_vocabulary, size_enforceable: bounds.enforceable },
  );
  const raydar = res.companies.find((c) => c.name === "Raydar")!;
  assertEquals(raydar.exclusion, "employee_size",
    "6 people exceeds the MISSION's own max of 5 — a Mission bound is hard");
});

// ═══ 5. MISSIONLESS BEHAVIOUR IS UNCHANGED ═════════════════════════════════

Deno.test("missionless: no vocabulary and enforceable size — legacy semantics", () => {
  const withMission = prequalifyYcCompanies(ROWS as never, { min: 10, max: 150 },
    { vocabulary: null, size_enforceable: true });
  const legacy = prequalifyYcCompanies(ROWS as never, { min: 10, max: 150 });
  assertEquals(withMission.eligible_companies, legacy.eligible_companies);
  assertEquals(withMission.technical_only_companies, legacy.technical_only_companies);
  assertEquals(withMission.employee_size_excluded, legacy.employee_size_excluded);
});

// ═══ 6. SOFT PREFERENCES NEVER REJECT ══════════════════════════════════════

Deno.test("soft: soft_preferences are carried but are not constraints", () => {
  const soft = { ...MISSION, soft_preferences: { prefers_recent_funding: true } } as never;
  const ctx = buildQualificationContext(soft);
  assertEquals(ctx.soft_preferences, { prefers_recent_funding: true });
  // They contribute no owned axis, so they can never gate anything.
  assertEquals(ctx.mission_owns.employee_count, false);
  assertEquals(ctx.mission_owns.industry, true, "verticals still owned via company_profile");
});

// ═══ 7. OBSERVABILITY ══════════════════════════════════════════════════════

Deno.test("summary: the context is loggable and names its authority", () => {
  const s = qualificationContextSummary(buildQualificationContext(MISSION));
  assertEquals(s.role_vocabulary_source, "mission");
  assertEquals(s.hard_constraint_keys, ["geography", "hiring"]);
  assertEquals(s.mission_owns.employee_count, false);
  assert(s.required_titles.includes("software engineer"));
});
