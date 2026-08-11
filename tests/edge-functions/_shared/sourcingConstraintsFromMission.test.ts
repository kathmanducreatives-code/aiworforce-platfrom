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

Deno.test("the sourcing run reads its Mission once and uses it for all four", () => {
  assert(
    /const sourcingMission = readPersistedLeadMission\(/.test(RUN),
    "one read, reused — not four separate lookups that could drift apart",
  );
  assert(
    /const separationMission = sourcingMission;/.test(RUN),
    "the separated-intent projection uses the same object",
  );
});

Deno.test("the geography and role fallbacks are Mission-first, text-only when missionless", () => {
  assert(
    /location = missionLocations\[0\] \?\? null;/.test(RUN),
    "the decided geography must be preferred over the `in <Place>` scan",
  );
  assert(
    /if \(!location && !sourcingMission\) \{/.test(RUN),
    "and the scan must be unreachable when a Mission exists",
  );
  assert(
    /roleKeywords = \[\.\.\.new Set\(missionRoleTerms\)\];/.test(RUN),
    "the decided role terms must be preferred over the keyword scan",
  );
  assert(
    /if \(roleKeywords\.length === 0 && !sourcingMission\) \{/.test(RUN),
    "and that scan must be unreachable when a Mission exists",
  );
});

Deno.test("the strict flags and the attempt budget are Mission-first", () => {
  assert(
    /const strict = sourcingMission\s*\n?\s*\? strictConstraintsFromMission\(sourcingMission\)/.test(RUN),
    "the hard-filter flags must come from decided fields",
  );
  assert(
    /const maxAttempts = sourcingMission\s*\n?\s*\? maxAttemptsFromStrict\(strict\)/.test(RUN),
    "and the attempt budget must not re-scan the sentence for 'exactly'",
  );
  assert(
    /strictForPlan = sourcingMission/.test(RUN),
    "the actor planner's copy of the flags must come from the same source",
  );
});
