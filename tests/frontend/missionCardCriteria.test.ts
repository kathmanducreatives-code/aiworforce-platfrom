// THE CARD'S "YOUR CRITERIA" / "AGENTORY ADDED" SPLIT.
//
// Both ends of the seam: the real backend builds the confirmation card for a
// request, and the frontend groups its criteria — by the mission's structured
// `criteria` sources first, by the lines' own source when a mission predates
// them. Pure — no network, no model, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileChain, funding, hiring, request } from "../lead-v2-quality/lib/chain.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { buildMissionPreview } from "../../supabase/functions/_shared/missionPreview.ts";
import { buildMissionConfirmation } from "../../supabase/functions/_shared/missionConfirmationCard.ts";
import { projectToLeadMission } from "../../supabase/functions/_shared/projectToLeadMission.ts";
import { PRODUCTION_READINESS } from "../../supabase/functions/_shared/routeReadiness.ts";
import {
  cardCriteria, criteriaSectionsOf, criterionNote, criterionPhrase, humanWindow, missionTitle, readCriterionLine,
  type CriteriaSections, type MissionCriterionLike,
} from "../../src/lib/leadMission/missionView.ts";

globalThis.fetch = () => { throw new Error("card criteria tests must not reach the network"); };

// The production smoke sentence of 2026-10-08 (task ea562324), word for word.
const QUERY = "Find 1 US company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.";
// The smoke workspace's Company Brain industries.
const BRAIN = {
  industries: ["b2b saas (founder-led or small teams)", "recruiting / talent acquisition / staffing agencies"],
  stages: [], locations: [],
};
const STEERS = "also chooses which companies are searched";

function card(utterance: string, spec: Parameters<typeof request>[1], brain: Parameters<typeof compileChain>[1] = null) {
  const r = request(utterance, spec);
  const c = compileChain(r, brain);
  assert(c.ok && c.mission, JSON.stringify(c.refusal));
  const plan = buildCapabilityGraph(c.mission!, { executability: "enforce", readiness: PRODUCTION_READINESS });
  return buildMissionConfirmation(c.mission!, buildMissionPreview(c.mission!, plan, null, projectToLeadMission(r)), utterance);
}
const SMOKE_SPEC = {
  count: 1,
  filters: [
    { field: "geography", op: "eq", value: "United States" },
    { field: "employee_count", op: "range", value: { min: 11, max: 50 } },
  ] as never,
  requirements: [funding("raised funding in the last 24 months", 730), hiring("currently hiring sales", ["sales"], ["sales"], 30)],
};
const MAIN = () => card(QUERY, SMOKE_SPEC);
const WITH_BRAIN = () => card(QUERY, SMOKE_SPEC, BRAIN as never);

/** What the card component does: the sections, grouped by the mission's structured criteria. */
const groupsOf = (p: ReturnType<typeof card>) =>
  cardCriteria(criteriaSectionsOf(p), (p.lead_mission as { criteria?: MissionCriterionLike[] }).criteria ?? null);
const lines = (s: CriteriaSections) => [...s.hard, ...s.target, ...s.opportunity_signals, ...s.hypotheses, ...s.time_windows];

// ── the production smoke sentence ────────────────────────────────────────────

Deno.test("smoke sentence: the stated request is the person's own criteria, nothing is added", () => {
  const p = MAIN();
  assert(Array.isArray((p.lead_mission as { criteria?: unknown }).criteria), "the card's mission carries structured criteria");
  const c = groupsOf(p);
  assertEquals(c.user.map(criterionPhrase), [
    "United States",
    "11–50 employees",
    "Funding in the last 24 months",
    "Hiring sales in the last 30 days",
  ]);
  assertEquals(c.added, [], "no Brain, nothing inferred: Agentory added nothing");
  assertEquals(c.details, []);
  assertEquals(c.unsupported, []);
  assertEquals(p.lead_mission.requested_count, 1, "one company requested");
});

Deno.test("smoke sentence: funding and hiring are required, with their 730- and 30-day windows", () => {
  const c = groupsOf(MAIN());
  const fundingC = c.user.find((x) => x.text.startsWith("Funding"))!;
  const hiringC = c.user.find((x) => x.text.startsWith("Hiring"))!;
  assertEquals([fundingC.required, fundingC.window], [true, { days: 730, source: "you said this" }]);
  assertEquals([hiringC.required, hiringC.window], [true, { days: 30, source: "default" }]);
});

Deno.test("the 30-day hiring window is enforced: no line says otherwise, and the card carries no 'not enforced' state", () => {
  const p = MAIN();
  assertFalse(lines(criteriaSectionsOf(p)!).some((l) => /not yet enforced/.test(l)), "the backend no longer says it (#44)");
  const w = groupsOf(p).user.find((x) => x.text.startsWith("Hiring"))!.window!;
  assertEquals(Object.keys(w).sort(), ["days", "source"], "a window is days + source; enforcement is not a variable");
});

Deno.test("a card compiled before #44 still reads: the old 'not yet enforced' marker is dropped, the window kept", () => {
  const c = cardCriteria({
    hard: [], target: [], hypotheses: [], unsupported: [],
    opportunity_signals: ["Hiring: sales · required · you said this"],
    time_windows: ['Hiring: last 30 days · default for "currently / actively hiring" · shown, not yet enforced'],
  });
  assertEquals(c.user.map(criterionPhrase), ["Hiring sales in the last 30 days"]);
  assertEquals(c.user[0].window, { days: 30, source: "default" });
});

// ── the Company Brain ────────────────────────────────────────────────────────

Deno.test("smoke sentence + Company Brain: the Brain's industries are added, with the search note beside them", () => {
  const c = groupsOf(WITH_BRAIN());
  assertEquals(c.user.map(criterionPhrase), [
    "United States", "11–50 employees", "Funding in the last 24 months", "Hiring sales in the last 30 days",
  ], "the person's own criteria are unchanged by the Brain");
  assertEquals(c.added.map(criterionPhrase), [
    "b2b saas (founder-led or small teams)",
    "recruiting / talent acquisition / staffing agencies",
  ]);
  for (const x of c.added) {
    assertEquals(x.source, "from your Company Brain");
    assertFalse(x.text.includes(STEERS), `the note is never part of the criterion: ${x.text}`);
    assertFalse(x.text.includes("Company Brain"), `nor is the source: ${x.text}`);
    assert(x.note?.startsWith(`${STEERS} (LinkedIn: `), String(x.note));
    assert(criterionNote(x)!.startsWith("Also chooses which companies are searched (LinkedIn: "), String(criterionNote(x)));
  }
  assertEquals(c.details, []);
});

Deno.test("a Company Brain value the person did not state is 'added', never the person's", () => {
  const c = groupsOf(card("Find 3 companies hiring sales.", {
    count: 3, requirements: [hiring("hiring sales", ["sales"], ["sales"])],
  }, { industries: ["b2b saas"], stages: [], locations: ["united states"] }));
  assert(c.added.length > 0, JSON.stringify(c));
  for (const x of c.added) assert(x.source !== "you said this", JSON.stringify(x));
  assert(!c.user.some((x) => /United States/i.test(x.text)), "a Brain geography is never the person's own criterion");
});

Deno.test("a Brain line written note-after-source (the #46 order) still reads as Brain-added with its note", () => {
  const line = `Industry: b2b saas · from your Company Brain · ${STEERS} (LinkedIn: Software Development)`;
  assertEquals(readCriterionLine(line), {
    text: "Industry: b2b saas", source: "from your Company Brain", origin: "added", required: null,
    notes: [], explanation: `${STEERS} (LinkedIn: Software Development)`,
  });
  const c = cardCriteria({ hard: [], target: [line], opportunity_signals: [], hypotheses: [], time_windows: [], unsupported: [] });
  assertEquals([c.added.length, c.user.length, c.details.length], [1, 0, 0]);
  assertEquals(c.added[0].note, `${STEERS} (LinkedIn: Software Development)`);
});

// ── reading one line ─────────────────────────────────────────────────────────

Deno.test("line reader: the source is found at the end of a line", () => {
  assertEquals(readCriterionLine("Geography: United States · you said this"), {
    text: "Geography: United States", source: "you said this", origin: "user", required: null, notes: [], explanation: null,
  });
  assertEquals(readCriterionLine("Hiring: sales · first hire in the function · required · inferred (confidence 0.80)"), {
    text: "Hiring: sales · first hire in the function", source: "inferred (confidence 0.80)", origin: "added",
    required: true, notes: [], explanation: null,
  });
});

Deno.test("line reader: the source is found when it is not at the end", () => {
  const r = readCriterionLine(`Industry: b2b saas · ${STEERS} (LinkedIn: Software Development) · from your Company Brain`);
  assertEquals([r.text, r.source, r.origin, r.explanation],
    ["Industry: b2b saas", "from your Company Brain", "added", `${STEERS} (LinkedIn: Software Development)`]);
  const s = readCriterionLine("Geography: United States · you said this · something the backend adds later");
  assertEquals([s.text, s.source, s.origin],
    ["Geography: United States · something the backend adds later", "you said this", "user"],
    "an unrecognised segment stays with the words; the source still counts");
});

Deno.test("line reader: a line with no known source is unspecified, never the person's", () => {
  assertEquals(readCriterionLine("Something new the backend says").origin, "unspecified");
  assertEquals(readCriterionLine("Industry: fintech · preferred").origin, "unspecified");
});

// ── grouping ─────────────────────────────────────────────────────────────────

const SECTIONS = (over: Partial<CriteriaSections>): CriteriaSections => ({
  hard: [], target: [], opportunity_signals: [], hypotheses: [], time_windows: [], unsupported: [], ...over,
});

Deno.test("grouping: you said this → Your criteria; from your Company Brain → Agentory added; unknown → Request details", () => {
  const c = cardCriteria(SECTIONS({
    hard: ["Geography: United States · you said this", "Company size: 11–50 employees · Company Brain rule"],
    target: ["Industry: fintech · from your Company Brain", "Industry: payments"],
  }));
  assertEquals(c.user.map((x) => x.text), ["Geography: United States"]);
  assertEquals(c.added.map((x) => x.text), ["Company size: 11–50 employees", "Industry: fintech"]);
  assertEquals(c.details.map((x) => x.text), ["Industry: payments"], "no source: a request detail, not the person's");
});

Deno.test("grouping: the mission's structured source is the source of truth", () => {
  const s = SECTIONS({
    hard: ["Geography: United States · you said this"],
    target: ["Industry: fintech", `Industry: saas · ${STEERS} (LinkedIn: Software Development) · from your Company Brain`],
  });
  const structured: MissionCriterionLike[] = [
    { label: "Geography: United States", source: "company_brain_policy", kind: "hard" },
    { label: "Industry: fintech", source: "user_explicit", kind: "hard" },
    { label: "Industry: saas", source: "company_brain_preference", kind: "target" },
  ];
  const c = cardCriteria(s, structured);
  assertEquals(c.added.map((x) => [x.text, x.source]), [
    ["Geography: United States", "Company Brain rule"],
    ["Industry: saas", "from your Company Brain"],
  ], "a structured Brain source wins over a line that says otherwise");
  assertEquals(c.user.map((x) => [x.text, x.source]), [["Industry: fintech", "you said this"]],
    "a structured user source places a line that carries none");
  assertEquals(c.details, []);
  assertEquals(c.added[1].note, `${STEERS} (LinkedIn: Software Development)`);
});

Deno.test("grouping: an unknown structured source falls back to the line, and an unknown line stays a detail", () => {
  const c = cardCriteria(SECTIONS({ target: ["Industry: fintech", "Industry: retail · from your Company Brain"] }), [
    { label: "Industry: fintech", source: "something_new" },
    { label: "Industry: retail", source: "something_new" },
  ]);
  assertEquals(c.details.map((x) => x.text), ["Industry: fintech"]);
  assertEquals(c.added.map((x) => x.text), ["Industry: retail"]);
});

Deno.test("grouping: ranks-only signals and hypotheses are 'Also considered', not criteria", () => {
  const c = cardCriteria(SECTIONS({
    opportunity_signals: ["Hiring: sales (proxy) · can rank, never reject"],
    hypotheses: ["Likely to need a growth marketer · to be tested, never required"],
  }));
  assertEquals(c.considered.map((x) => x.section), ["opportunity_signals", "hypotheses"]);
  assertEquals([c.user.length, c.added.length, c.details.length], [0, 0, 0]);
});

// ── the rest of the card ─────────────────────────────────────────────────────

Deno.test("an unprovable requirement is listed as such", () => {
  const c = groupsOf(card(
    "Find ONLY seed-stage B2B SaaS startups in the US hiring their first growth marketer.", {
      count: 5,
      filters: [
        { field: "industry", op: "eq", value: "B2B SaaS" },
        { field: "geography", op: "eq", value: "United States" },
        { field: "stage", op: "eq", value: "seed" },
      ] as never,
      requirements: [hiring("hiring their first growth marketer", ["growth marketer"], ["marketing"])],
    }));
  assert(c.unsupported.length > 0);
});

Deno.test("windows and titles read the way a person says them", () => {
  assertEquals([730, 365, 90, 30, 1].map(humanWindow), ["24 months", "12 months", "3 months", "30 days", "1 day"]);
  const m = { target_entity: "company", requested_count: 1 };
  assertEquals(missionTitle(m, "Find 1 companies"), "Find 1 company");
  assertEquals(missionTitle(m, "Find 1 companies in b2b saas, recruiting"), "Find 1 company in b2b saas, recruiting",
    "the backend's title with the industries the search is scoped to");
  assertEquals(missionTitle(m, "Find 1 AI company"), "Find 1 AI company", "any other title is shown as written");
  assertEquals(missionTitle({ ...m, requested_count: 3 }, "Find 3 companies"), "Find 3 companies");
});
