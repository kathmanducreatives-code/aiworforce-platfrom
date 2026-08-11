// EXECUTION READS THE MISSION; IT DOES NOT RE-READ THE SENTENCE.
//
// run-agent compiled a LeadEntityIntent from `input ?? instruction` and routed
// on its `target_entity` — a SECOND reading of the same sentence, made after the
// canonical Mission had already decided the question, and able to disagree with
// it. `target_entity` selects the actor and gates which artifact may persist, so
// a disagreement here is a disagreement about what the run is for.
//
// The DTO's provider-input half still compiles from the instruction. Bounding a
// provider query is deterministic work this architecture keeps; deciding what
// the request MEANS is not.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyMissionEntityAuthority } from "../../../supabase/functions/_shared/leadEntityIntent.ts";

const REGEX_SAID = { target_entity: "job", clarification_required: true, keyword_queries: ["SDR"] };

Deno.test("the Mission's entity decision overrides the regex reading", () => {
  const out = applyMissionEntityAuthority(REGEX_SAID, { target_entity: "person" });
  assertEquals(out.target_entity, "person", "the Mission decided; execution obeys");
});

Deno.test("a decided Mission also resolves the regex's ambiguity", () => {
  // Leaving clarification_required set would send a resolved request down the
  // "ask the user" branch on the strength of a regex's doubt.
  assertEquals(
    applyMissionEntityAuthority(REGEX_SAID, { target_entity: "company" }).clarification_required,
    false,
  );
});

Deno.test("everything else on the DTO is untouched — this is a projection", () => {
  const out = applyMissionEntityAuthority(REGEX_SAID, { target_entity: "person" });
  assertEquals((out as { keyword_queries: string[] }).keyword_queries, ["SDR"]);
});

Deno.test("NO Mission leaves the DTO exactly as compiled", () => {
  // The deterministic-workspace path, gated separately by orchestrate.
  assertEquals(applyMissionEntityAuthority(REGEX_SAID, null), REGEX_SAID);
  assertEquals(applyMissionEntityAuthority(REGEX_SAID, undefined), REGEX_SAID);
  assertEquals(applyMissionEntityAuthority(REGEX_SAID, {}), REGEX_SAID);
});

Deno.test("the projection contains no parsing of its own", () => {
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/leadEntityIntent.ts", import.meta.url),
  );
  const fn = src.slice(src.indexOf("export function applyMissionEntityAuthority"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3).replace(/^[ \t]*\/\/.*$/gm, "");
  assert(!/match\(|RegExp|\/\^|original_query|instruction|message/.test(body),
    "a projection that could re-parse the sentence would be a second interpreter");
});

Deno.test("run-agent routes through the projection, from the persisted Mission", () => {
  const src = Deno.readTextFileSync(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url),
  ).replace(/^[ \t]*\/\/.*$/gm, "");
  assert(/applyMissionEntityAuthority\(\s*compileLeadEntityIntent\(/.test(src),
    "the compiled DTO must be overlaid with the Mission before it is used for routing");
  assert(/applyMissionEntityAuthority\([\s\S]{0,400}?readPersistedLeadMission\(/.test(src),
    "and the overlay's source must be the persisted canonical Mission");
});
