// THE DEMO REQUEST'S INTERPRETATION, JUDGED BEFORE ANYTHING IS QUEUED.
//
//   "Find 5 US companies hiring Account Executives that raised funding within
//    the last six months."
//
// The A7 judge (realGptJudge.ts) is specific to A7's sentence. This judges the
// demo's compiled mission the same way — PASS/FAIL per question, read off the
// mission the worker will run — and lists every window the request did NOT
// state as a DISCLOSURE the operator must acknowledge before queueing it.
//
// Pure.

import type { Json, Verdict } from "./realGptJudge.ts";

export const DEMO_FUNDING_MISSION =
  "Find 5 US companies hiring Account Executives that raised funding within the last six months.";
/** The first real-Apify canary: the same request, for one company. */
export const CANARY_FUNDING_MISSION =
  "Find one US company hiring Account Executives that raised funding within the last six months.";

const lower = (v: unknown) => String(v ?? "").toLowerCase();
const crit = (m: Json, dim: string) => ((m.criteria ?? []) as Json[]).find((c) => c.dimension === dim && c.kind === "hard") ?? null;
const sig = (m: Json, event: string) => ((m.required_signals ?? []) as Json[]).find((s) => (s.event ?? s.type) === event) ?? null;

/** Windows the user did not state, worded for the approval. Empty when every window is the user's. */
export function assumedWindowDisclosures(m: Json): string[] {
  return ((m.criteria ?? []) as Json[])
    .filter((c) => c.time_window?.source === "system_default")
    .map((c) => `${c.label ?? c.dimension}: last ${c.time_window.days} days is Agentory's default for ` +
      `"${c.time_window.rule ?? "recent"}" — the request states no ${c.dimension} timeframe`);
}

/** `count`: the companies the request asks for (5 for the demo, 1 for the canary). */
export function judgeDemoFundingInterpretation(m: Json, count = 5): Verdict[] {
  const v = (id: string, criterion: string, ok: boolean, observed: string): Verdict =>
    ({ id, question: "I", criterion, result: ok ? "PASS" : "FAIL", observed });
  const hiring = crit(m, "hiring"), funding = crit(m, "funding"), geo = crit(m, "geography");
  const hs = sig(m, "hiring"), fs = sig(m, "funding");
  const roleTerms = ((hs?.qualifier?.role_terms ?? []) as string[]).map(lower);
  const roles = (m.decision_makers?.roles ?? []) as string[];
  // A hard criterion is representable only when its status is ok AND some
  // evidence dimension answers it. `constraint` is the catch-all no evidence
  // answers: canary session 2 compiled a hard `constraint` restating the hiring
  // role, every candidate stayed unknown on it, and D7 still passed.
  const unsupported = ((m.criteria ?? []) as Json[]).filter((c) => c.kind === "hard" &&
    ((c.status ?? "ok") !== "ok" || c.dimension === "constraint"));
  return [
    v("D1", "the deliverable is companies, not people", m.target_entity === "company" && m.requested_output === "qualified_companies" && roles.length === 0,
      `target=${m.target_entity} output=${m.requested_output} roles=${JSON.stringify(roles)}`),
    v("D2", `${count} compan${count === 1 ? "y is" : "ies are"} requested`, m.requested_count === count, `requested_count=${m.requested_count}`),
    v("D3", "United States is a hard requirement", !!geo && JSON.stringify(geo.value ?? "").toLowerCase().includes("united states"),
      `geography=${JSON.stringify(geo?.value ?? null)}`),
    v("D4", "hiring Account Executives is hard, on the AE role", !!hiring && roleTerms.some((t) => /account executive/.test(t)),
      `hiring=${!!hiring} role_terms=${JSON.stringify(roleTerms)}`),
    v("D5", "funding within 180 days is hard and the user's own window", !!funding && funding.time_window?.days === 180 &&
      funding.time_window?.source === "user_explicit" && fs?.timeframe_days === 180,
      `funding=${JSON.stringify(funding?.time_window ?? null)} runtime=${fs?.timeframe_days ?? null}`),
    v("D6", "the hiring window is separate, enforced at runtime, and disclosed when assumed",
      !!hiring && hs?.timeframe_days === hiring.time_window?.days && hs?.timeframe_days !== fs?.timeframe_days &&
        (hiring.time_window?.source !== "system_default" || assumedWindowDisclosures(m).some((d) => /^Hiring/i.test(d))),
      `hiring window=${JSON.stringify(hiring?.time_window ?? null)} runtime=${hs?.timeframe_days ?? null}`),
    v("D7", "every hard requirement is representable", unsupported.length === 0,
      `unsupported=${JSON.stringify(unsupported.map((c) => c.dimension))}`),
  ];
}
