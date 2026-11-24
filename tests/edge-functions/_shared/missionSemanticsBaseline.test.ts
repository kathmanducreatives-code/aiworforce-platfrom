// The semantic baseline: what every stored mission and corpus case means today.
//
// A change here is a SEMANTIC change. The failing test lists, per mission, what changed
// (a criterion added or removed, a kind / scope / value / window that moved). If the
// change is intended, record it with
//   deno run --allow-read --allow-write --allow-env scripts/dev/mission-semantics.ts --write
// and explain every listed difference in the PR. Persisted missions are re-derived as
// run-agent re-derives them at run time, so this is also the production replay of
// stored ORION missions against the current compiler.

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BASELINE_PATH, build, compare, type Entry } from "../../../scripts/dev/mission-semantics.ts";
import { missionSemantics, semanticDiff, semanticsFingerprint } from "../../../supabase/functions/_shared/missionSemantics.ts";

const baseline = JSON.parse(Deno.readTextFileSync(new URL(`../../../${BASELINE_PATH}`, import.meta.url))) as Record<string, Entry>;

Deno.test("every stored mission and corpus case means what the baseline records", async () => {
  const diff = compare(baseline, await build());
  assertEquals(diff, [], `semantic differences (record with scripts/dev/mission-semantics.ts --write and explain them):\n${diff.join("\n")}`);
});

Deno.test("the baseline covers the stored missions and the historical GPT failures", () => {
  const keys = Object.keys(baseline);
  assert(keys.filter((k) => k.startsWith("persisted:")).length >= 80, "persisted missions from the fixtures");
  for (const c of ["gpt_hiring_activity_restated", "gpt_hiring_dot_role_restated", "gpt_presence_for_us_companies", "smoke_b2b_salespeople", "paid_run_ae", "operating_in_us_is_not_hq"]) {
    assert(keys.includes(`corpus:${c}`), c);
  }
});

const C = (over: Record<string, unknown> = {}) => ({ id: "geography:united_states", kind: "hard", dimension: "geography", value: "United States", status: "ok", label: "Headquarters: United States", rationale: "stated", user_phrase: "US", geography_scope: "headquarters", ...over });
const M = { target_entity: "company", requested_output: "companies", requested_count: 3, required_signals: [] };

Deno.test("semantics: display text is not meaning; kind, scope and value are", () => {
  const base = missionSemantics(M, [C()]);
  assertEquals(semanticsFingerprint(missionSemantics(M, [C({ label: "US HQ", rationale: "x", user_phrase: "" })])), semanticsFingerprint(base));
  for (const over of [{ kind: "target" }, { geography_scope: "presence" }, { value: "Canada" }, { status: "unprovable_today" }, { time_window: { days: 30 } }]) {
    const s = missionSemantics(M, [C(over)]);
    assertNotEquals(semanticsFingerprint(s), semanticsFingerprint(base), JSON.stringify(over));
    assert(semanticDiff(base, s).length > 0, JSON.stringify(over));
  }
  assertEquals(semanticDiff(base, missionSemantics(M, [C({ geography_scope: "presence" })])), ["geography:united_states: geography_scope headquarters → presence"]);
  // Order and case of lists do not matter.
  const sig = (terms: string[]) => missionSemantics({ ...M, required_signals: [{ type: "hiring", qualifier: { role_terms: terms } }] }, []);
  assertEquals(semanticsFingerprint(sig(["SDR", "Account Executive"])), semanticsFingerprint(sig(["account executive", "sdr"])));
});
