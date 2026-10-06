// THE QUALITY-RUN REGRESSION CASES — one record per test, from the 2026-10-06 run.
//
// Every test in this suite is registered here with the five facts the report
// recorded: the quality query ID, the original query, what the run actually
// produced (CURRENT WRONG RESULT), what it must produce (EXPECTED), and the
// root cause ID. Tests assert EXPECTED, never CURRENT — so a test in this suite
// may fail on today's code. That is the point: it fails until the root cause is
// fixed, and then it guards the fix.
//
// `boundary` says where the test enters the pipeline:
//   recorded       the run's own recorded output (fixtures/quality-run-2026-10-06.json)
//                  through the deterministic downstream
//   reconstructed  a RequestV1 rebuilt from the sentence (see lib/chain.ts LIMITATION),
//                  through the real projection + compiler + criteria
//   fixture        a Replay Lab golden-mission variant (production engine, zero network)
//   pure           production functions called directly

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";

export type Boundary = "recorded" | "reconstructed" | "fixture" | "pure";

export interface QualityCase {
  /** Quality-run query or probe ID. */
  id: string;
  /** Root cause ID from the consolidated report. */
  rc: string;
  query: string;
  current: string;
  expected: string;
  boundary: Boundary;
}

const RUN = JSON.parse(Deno.readTextFileSync(new URL("../fixtures/quality-run-2026-10-06.json", import.meta.url))) as {
  cases: Record<string, { query: string; route: string | null; outcome: unknown; card_text: string; card_inputs: unknown; lead_mission: LeadMissionV1 | null }>;
};

/** The run's recorded reply for a catalogue query. */
export function recorded(id: string) {
  const r = RUN.cases[id];
  if (!r) throw new Error(`no recorded quality-run case ${id}`);
  return r;
}

/** The run's recorded compiled mission. */
export function recordedMission(id: string): LeadMissionV1 {
  const m = recorded(id).lead_mission;
  if (!m) throw new Error(`quality-run case ${id} recorded no mission (it was refused)`);
  return structuredClone(m);
}

const REGISTRY = new Map<string, QualityCase>();

/** Register a case and return the Deno test name for it. */
export function qcase(c: QualityCase): string {
  const key = `${c.rc}:${c.id}:${c.expected}`;
  if (REGISTRY.has(key)) throw new Error(`duplicate quality case ${key}`);
  // A catalogue ID's query must be the run's own words.
  if (/^[A-Z]+\d+$/.test(c.id) && !/^[TUVWX]\d/.test(c.id)) {
    const r = (() => { try { return recorded(c.id); } catch { return null; } })();
    if (r) assert(r.query === c.query, `${c.id}: query differs from the recorded run`);
  }
  REGISTRY.set(key, c);
  return `[quality ${c.rc} ${c.id}] ${c.expected}  (was: ${c.current}) — ${c.boundary}`;
}

export const registeredCases = () => [...REGISTRY.values()];
