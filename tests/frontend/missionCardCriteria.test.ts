// THE CARD'S "YOUR CRITERIA" / "AGENTORY ADDED" SPLIT, READ FROM THE BACKEND'S OWN LINES.
//
// Both ends of the seam: the real backend builds the confirmation card for a
// request, and the frontend reads its criteria lines. Pure — no network, no
// model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileChain, funding, hiring, request } from "../lead-v2-quality/lib/chain.ts";
import { buildCapabilityGraph } from "../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { buildMissionPreview } from "../../supabase/functions/_shared/missionPreview.ts";
import { buildMissionConfirmation } from "../../supabase/functions/_shared/missionConfirmationCard.ts";
import { projectToLeadMission } from "../../supabase/functions/_shared/projectToLeadMission.ts";
import { PRODUCTION_READINESS } from "../../supabase/functions/_shared/routeReadiness.ts";
import {
  cardCriteria, criteriaSectionsOf, criterionPhrase, humanWindow, missionTitle, readCriterionLine,
} from "../../src/lib/leadMission/missionView.ts";

globalThis.fetch = () => { throw new Error("card criteria tests must not reach the network"); };

const QUERY = "Find 1 US company with 11–50 employees that raised funding in the last 24 months and is currently hiring sales.";

function card(utterance: string, spec: Parameters<typeof request>[1], brain: Parameters<typeof compileChain>[1] = null) {
  const r = request(utterance, spec);
  const c = compileChain(r, brain);
  assert(c.ok && c.mission, JSON.stringify(c.refusal));
  const plan = buildCapabilityGraph(c.mission!, { executability: "enforce", readiness: PRODUCTION_READINESS });
  return buildMissionConfirmation(c.mission!, buildMissionPreview(c.mission!, plan, null, projectToLeadMission(r)), utterance);
}

const MAIN = () => card(QUERY, {
  count: 1,
  filters: [
    { field: "geography", op: "eq", value: "United States" },
    { field: "employee_count", op: "range", value: { min: 11, max: 50 } },
  ] as never,
  requirements: [funding("raised funding in the last 24 months", 730), hiring("currently hiring sales", ["sales"], ["sales"], 30)],
});

Deno.test("the stated request reads as the person's own criteria, with each signal's window — nothing is 'added'", () => {
  const c = cardCriteria(criteriaSectionsOf(MAIN()));
  assertEquals(c.user.map(criterionPhrase), [
    "United States",
    "11–50 employees",
    "Funding in the last 24 months",
    "Hiring sales in the last 30 days",
  ]);
  assertEquals(c.added, [], "no Brain, nothing inferred: Agentory added nothing");
  assertEquals(c.unsupported, []);
  const hiringWindow = c.user.find((x) => x.text.startsWith("Hiring"))!.window!;
  assertEquals([hiringWindow.days, hiringWindow.source, hiringWindow.enforced], [30, "default", false],
    "the hiring window is the backend's default, shown but not yet enforced");
});

Deno.test("a Company Brain value the person did not state is 'added', never the person's", () => {
  const c = cardCriteria(criteriaSectionsOf(card("Find 3 companies hiring sales.", {
    count: 3, requirements: [hiring("hiring sales", ["sales"], ["sales"])],
  }, { industries: ["b2b saas"], stages: [], locations: ["united states"] })));
  assert(c.added.length > 0, JSON.stringify(c));
  for (const x of c.added) assert(x.source !== "you said this", JSON.stringify(x));
  assert(!c.user.some((x) => /United States/i.test(x.text)), "a Brain geography is never the person's own criterion");
});

Deno.test("an unprovable requirement is listed as such", () => {
  const c = cardCriteria(criteriaSectionsOf(card(
    "Find ONLY seed-stage B2B SaaS startups in the US hiring their first growth marketer.", {
      count: 5,
      filters: [
        { field: "industry", op: "eq", value: "B2B SaaS" },
        { field: "geography", op: "eq", value: "United States" },
        { field: "stage", op: "eq", value: "seed" },
      ] as never,
      requirements: [hiring("hiring their first growth marketer", ["growth marketer"], ["marketing"])],
    })));
  assert(c.unsupported.length > 0);
});

Deno.test("line reader: text, source, signal kind and notes; an unknown shape keeps its words", () => {
  assertEquals(readCriterionLine("Geography: United States · you said this"),
    { text: "Geography: United States", source: "you said this", origin: "user", required: null, notes: [] });
  assertEquals(readCriterionLine("Hiring: sales · first hire in the function · required · inferred (confidence 0.80)"),
    { text: "Hiring: sales · first hire in the function", source: "inferred (confidence 0.80)", origin: "added", required: true, notes: [] });
  assertEquals(readCriterionLine('Hiring: last 30 days · default for "recent" · shown, not yet enforced'),
    { text: "Hiring: last 30 days", source: "default", origin: "added", required: null, notes: ["shown, not yet enforced"] });
  assertEquals(readCriterionLine("Something new the backend says").origin, "unspecified");
});

Deno.test("windows and titles read the way a person says them", () => {
  assertEquals([730, 365, 90, 30, 1].map(humanWindow), ["24 months", "12 months", "3 months", "30 days", "1 day"]);
  const m = { target_entity: "company", requested_count: 1 };
  assertEquals(missionTitle(m, "Find 1 companies"), "Find 1 company");
  assertEquals(missionTitle(m, "Find 1 AI company"), "Find 1 AI company", "any other title is shown as written");
  assertEquals(missionTitle({ ...m, requested_count: 3 }, "Find 3 companies"), "Find 3 companies");
});
