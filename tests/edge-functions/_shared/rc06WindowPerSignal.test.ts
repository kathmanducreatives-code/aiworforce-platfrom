// RC06 — ONE WINDOW PER SIGNAL (quality run 2026-10-06, Fix Wave 2 step 4).
//
// "Find developer tools companies funded in the last 24 months hiring sales"
// gave "currently hiring" funding's 730 days, so a two-year-old posting proved
// it. Two leaks: the proposal's single `signal_recency_days` was stamped on
// every signal, and the sentence reader gave a window to every signal sharing
// its clause (or to all, when no clause claimed it). These tests pin who owns a
// window in each sentence shape, through the real projection → compiler →
// criteria. Pure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { REQUEST_V1_VERSION, type RequestRequirement, type RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

const req = (event: "hiring" | "funding", phrase: string, recency_days?: number): RequestRequirement =>
  ({ event, subject: "company", phrase, qualifier: event === "hiring" ? { role_terms: ["sales"] } : {},
    ...(recency_days ? { recency_days } : {}) } as RequestRequirement);
const request = (utterance: string, requirements: RequestRequirement[]): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance, objective: "source",
  parts: [{ id: "p1", objective: "source", subject: { entity: "company", references: [], filters: [] },
    requirements, output: { shape: "records", count: 5 } }],
  ambiguity: [], authority: { may_spend: true, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
} as RequestV1);

/** "<dimension>@<days>" for the hiring and funding criteria of the compiled card. */
function windows(utterance: string, requirements: RequestRequirement[]): Record<string, number | undefined> {
  const r = request(utterance, requirements);
  const p = projectToLeadMission(r);
  const m = compileLeadMission({ originalUserQuery: utterance, proposal: p.proposal as never,
    requestedCount: p.requestedCount, signalRecencyByEvent: p.signalRecencyByEvent }).final_mission;
  return Object.fromEntries(deriveMissionCriteria(m)
    .filter((c) => c.dimension === "hiring" || c.dimension === "funding")
    .map((c) => [c.dimension, c.time_window?.days]));
}

Deno.test("RC06: a window written after its verb is that signal's — hiring keeps its own 30 days", () => {
  assertEquals(windows("Find companies funded in the last 24 months hiring sales.",
    [req("funding", "funded in the last 24 months", 730), req("hiring", "hiring sales")]), { funding: 730, hiring: 30 });
  assertEquals(windows("Find companies hiring sales that raised funding in the last 12 months.",
    [req("hiring", "hiring sales"), req("funding", "raised funding in the last 12 months", 365)]), { hiring: 30, funding: 365 });
});

Deno.test("RC06: a window opening the sentence goes to the nearest signal after it", () => {
  assertEquals(windows("In the last 12 months, which SaaS companies raised funding and are hiring sales?",
    [req("funding", "raised funding", 365), req("hiring", "hiring sales")]), { funding: 365, hiring: 30 });
});

Deno.test("RC06: two windows in two clauses map one each; a single signal keeps its window", () => {
  assertEquals(windows("Find companies funded in the last 2 years and hiring sales in the last 30 days.",
    [req("funding", "funded in the last 2 years", 730), req("hiring", "hiring sales in the last 30 days", 30)]),
    { funding: 730, hiring: 30 });
  assertEquals(windows("Find companies hiring sales in the last 30 days.",
    [req("hiring", "hiring sales in the last 30 days", 30)]), { hiring: 30 });
});

Deno.test("RC06: a proposal with only the single window (no per-event map) is unchanged", () => {
  const p = projectToLeadMission(request("x", [req("hiring", "hiring sales", 90)]));
  const m = compileLeadMission({ originalUserQuery: "Find companies hiring sales recently.",
    proposal: p.proposal as never, requestedCount: 5 }).final_mission;
  assertEquals(m.required_signals.map((s) => [s.type, s.timeframe_days]), [["hiring", 90]]);
});
