// S6 — retiring obsolete interpretation paths, only where it is PROVEN safe.
// docs/architecture/mission-reliability-retirement.md is the register; these tests are
// its proofs. Nothing here deletes a path a supported mission still depends on.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compilePhrasing, loadCases, runCases } from "../../../scripts/dev/interpretation-corpus.ts";
import { persistedMissions } from "../../../scripts/dev/mission-semantics.ts";
import { restatesEmployeeBound, restatesFundingWindow, restatesHiringSignal } from "../../../supabase/functions/_shared/missionCriteria.ts";

type M = { hard_constraints?: Record<string, unknown>; required_signals?: never[]; company_profile?: { employee_range?: never } };
const guardHits = (m: M) => Object.entries(m.hard_constraints ?? {}).filter(([f, raw]) =>
  restatesHiringSignal(f, raw, m.required_signals ?? []) || restatesFundingWindow(f, raw, m.required_signals ?? []) ||
  restatesEmployeeBound(f, raw, m.company_profile?.employee_range)).map(([f]) => f);

Deno.test("retirement proof: no freshly compiled mission (v1 or v3) relies on a derive-time restatement guard", () => {
  // S1 reconciles every restatement at compile time, so these guards serve only LEGACY
  // stored missions. Once those are frozen (S5 option A) the guards can be deleted.
  const hits = loadCases().flatMap((c) => c.phrasings.flatMap((p) =>
    (["v1", "v3"] as const).flatMap((mode) => guardHits(compilePhrasing(p, mode) as M).map((f) => `${mode}:${c.id}:${p.label}:${f}`))));
  assertEquals(hits, []);
});

Deno.test("retirement gate: legacy stored missions still rely on them — so they are NOT deleted yet", async () => {
  const stored = (await persistedMissions()).filter(([, m]) => guardHits(m as M).length > 0);
  assert(stored.length > 0, "if no stored mission needs them any more, the register's gate is met: delete the guards");
});

// For each keyword re-reader v3 replaces, a phrasing the reader gets WRONG (v1) that v3
// gets RIGHT: the decision point no longer depends on the reader for a v3 mission.
const REPLACED: Record<string, { reader: string; witness: [string, string] }> = {
  NL1: { reader: "role words copied verbatim + authorizeHiringRoles / classifyRoleFamily on user text", witness: ["M13", "typo (model corrects the title)"] },
  NL2: { reader: "SIGNAL_CUE / statedHiringRequirement (necessity from a cue word)", witness: ["M13", "indirect question"] },
  NL3: { reader: "inQuery over a fixed country-word list (geography hardness)", witness: ["M15", "based out of the states"] },
  NL4: { reader: "scopeFromWords (presence from office/operations words)", witness: ["M16", "have a US office"] },
  D3: { reader: "crossSignalAlternatives (OR from cue words)", witness: ["M09", "signals listed"] },
  D2: { reader: "inQuery over the industry value (grammatical number)", witness: ["M10", "model wrote the singular"] },
  D6: { reader: "country normalisation of a stated region", witness: ["M11", "North America"] },
};
Deno.test("retirement proof: every replaced keyword reader no longer decides a v3 mission's meaning", () => {
  const v1 = runCases(loadCases(), "v1"), v3 = runCases(loadCases(), "v3");
  for (const [id, r] of Object.entries(REPLACED)) {
    const [c, label] = r.witness;
    const a = v1.find((x) => x.case === c && x.label === label)!, b = v3.find((x) => x.case === c && x.label === label)!;
    assert(!a.ok, `${id}: the witness must show the reader's v1 failure (${r.reader})`);
    assert(b.ok, `${id}: v3 must be right where the reader is wrong (${r.reader})`);
  }
});
