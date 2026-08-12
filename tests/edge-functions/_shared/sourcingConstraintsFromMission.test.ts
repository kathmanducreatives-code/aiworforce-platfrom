// THE SOURCING RUN'S LAST RAW-TEXT FALLBACKS.
//
// Inside run-agent's `shouldRun` block, four things still answered themselves by
// scanning the instruction whenever the threaded `tool_input` had left them
// blank:
//
//   location        /\bin\s+([A-Z]…)/ over the sentence
//   roleKeywords    a 25-token keyword scan over the sentence
//   strict.*        `parseStrictConstraints` — "only", "strictly", "do not
//                   broaden" and a location-token list deciding whether the
//                   geography, industry and stage are HARD filters
//   maxAttempts     `resolveMaxAttempts` — "exactly", "high quality", "fill all"
//
// Each is a semantic decision (WHERE, WHAT ROLE, WHAT MAY BE RELAXED, HOW HARD
// TO TRY), each reaches the provider input and the source gates, and each had
// already been decided by the Mission — `company_profile.locations`,
// `required_signal_terms`, `geography_is_hard`, `no_broadening_requested`.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseStrictConstraints, strictConstraintsFromMission, maxAttemptsFromStrict,
  resolveMaxAttempts,
} from "../../../supabase/functions/_shared/sourcingRetry.ts";

Deno.test("a geography the Mission stated is a hard filter", () => {
  const s = strictConstraintsFromMission({
    company_profile: { locations: ["United States"] },
  });
  assertEquals(s.location, true);
  assertEquals(s.industry, false, "a stated geography does not lock the industry");
  assertEquals(s.stage, false);
  assertEquals(s.count_exact, false);
});

Deno.test("a geography the Mission marked soft is not", () => {
  const s = strictConstraintsFromMission({
    company_profile: { locations: ["Europe"] }, geography_is_hard: false,
  });
  assertEquals(s.location, false);
});

Deno.test("no_broadening_requested locks geography, industry, stage and the count", () => {
  const s = strictConstraintsFromMission({
    company_profile: {}, no_broadening_requested: true,
  });
  assertEquals(s, { location: true, industry: true, stage: true, count_exact: true });
  assertEquals(maxAttemptsFromStrict(s), 5, "an exact count earns the larger attempt budget");
});

Deno.test("a Mission that constrained nothing locks nothing", () => {
  const s = strictConstraintsFromMission({ company_profile: {} });
  assertEquals(s, { location: false, industry: false, stage: false, count_exact: false });
  assertEquals(maxAttemptsFromStrict(s), 3);
});

Deno.test("the phrase reader disagrees on the same words — which is the point", () => {
  // The sentence says "only" and names a location; the Mission says the
  // geography is soft and no broadening restriction was requested.
  const sentence = "Find SaaS companies in London only, high quality";
  const fromText = parseStrictConstraints(sentence);
  assertEquals(fromText.location, true);
  assertEquals(resolveMaxAttempts(sentence, fromText), 5);

  const fromMission = strictConstraintsFromMission({
    company_profile: { locations: ["London"] }, geography_is_hard: false,
  });
  assertEquals(fromMission.location, false);
  assertEquals(maxAttemptsFromStrict(fromMission), 3);
  assert(
    fromText.location !== fromMission.location,
    "the two readings can differ, and only one of them is the decision",
  );
});

// ─────────────────────── structural: run-agent is wired ──────────────────────

const RUN = Deno.readTextFileSync(
  new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// ── POST-CUTOVER ────────────────────────────────────────────────────────────
//
// These three tests asserted that the legacy sourcing block preferred the
// Mission over its own regex scans — geography over the `in <Place>` match,
// decided role terms over the keyword scan, decided strict flags over an
// "exactly" scan. They were the right assertions while that block existed.
//
// The Mission cutover deleted the block outright, so the invariant is now
// stronger and simpler: there are no competing scans left to prefer the
// Mission over. The projection helpers above are still unit-tested directly;
// what changed is that run-agent no longer contains a second reader at all.

Deno.test("run-agent has no rival reader for the Mission to outrank", () => {
  for (const goneScan of [
    "missionLocations",
    "missionRoleTerms",
    "strictConstraintsFromMission",
    "maxAttemptsFromStrict",
    "strictForPlan",
    "sourcingMission",
  ]) {
    assert(
      !new RegExp(goneScan).test(RUN),
      `${goneScan} belonged to the deleted legacy sourcing block`,
    );
  }
  assert(!/runAdaptiveSourcing/.test(RUN), "the adaptive sourcing loop is gone");
});
