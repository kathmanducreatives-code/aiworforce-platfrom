// THE MISSION IS COMPILED FROM WHAT THE USER TYPED.
//
// The lead-intake branch ran `extractLeadDetails(message)` — a regex reading of
// role, industry, location, category and count — and `leadRequestToInstruction`
// reassembled those fields into a synthetic sentence. That rewrite was then
// handed to `compileCanonicalLeadMission` as the prompt.
//
// So the regex decided the semantics and the model only re-read its summary:
// anything the parse dropped ("hiring RevOps", "recently funded", "do not
// broaden") was gone before the interpreter ever saw the request. And the
// Mission's `original_user_query` — the field the contract calls immutable and
// "never the thing a planner rewrites" — held the rewrite.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractLeadDetails, leadRequestToInstruction, type LeadRequest,
} from "../../../supabase/functions/_shared/leadIntake.ts";

const TYPED =
  "Find me 5 founders at recently funded B2B SaaS startups in the US that are " +
  "hiring RevOps — do not broaden the search";

Deno.test("the rewrite really does lose what the user said", () => {
  // Not an assertion about the parser's quality — a demonstration of why the
  // interpreter must see the original: the rewrite is a different sentence.
  const d = extractLeadDetails(TYPED);
  const req: LeadRequest = {
    mode: d.mode ?? "people",
    target_role: d.target_role ?? undefined,
    industry: d.industry ?? undefined,
    location: d.location ?? undefined,
    company_category: d.company_category ?? undefined,
    buying_signal: d.buying_signal ?? undefined,
    count: d.count ?? 5,
    needs_outreach: d.needs_outreach,
    original_user_request: TYPED,
    company_brain_context_used: false,
  };
  const rewritten = leadRequestToInstruction(req);
  assert(rewritten !== TYPED, "the executed instruction is a rewrite, by design");
  assert(
    !/do not broaden/i.test(rewritten),
    `the no-broadening constraint does not survive the rewrite: ${rewritten}`,
  );
  assertEquals(req.original_user_request, TYPED, "but the LeadRequest still carries the words");
});

// ─────────────────────── structural: the seam is wired ───────────────────────

const PILOT = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

Deno.test("the intake branch compiles its Mission from the user's own sentence", () => {
  const i = PILOT.indexOf("const intakeMission = canonicalMissionForTransport(");
  assert(i > 0, "the intake branch must still compile a Mission");
  const site = PILOT.slice(i, i + 320);
  assert(
    /prompt: req\.original_user_request/.test(site),
    "the compiler must read what the user typed, not the reassembled instruction",
  );
  assert(
    !/prompt: intakeInstruction,/.test(site),
    "compiling from the rewrite makes the regex the interpreter and the model its reader",
  );
});

Deno.test("the rewrite still executes as the step instruction", () => {
  // The parse is not being deleted — it is being demoted from interpreter to
  // provider input. The step the plan runs is unchanged.
  const i = PILOT.indexOf("const intakeMission = canonicalMissionForTransport(");
  const after = PILOT.slice(i, i + 900);
  assert(
    /instruction: intakeInstruction/.test(after),
    "the assembled instruction is still what the step executes",
  );
  assert(/\.\.\.ti,/.test(after), "and `ti` is still the provider input the parse produced");
});

Deno.test("every compiler call site still supplies a null count", () => {
  const sites = [...PILOT.matchAll(/compileCanonicalLeadMission\(\{[\s\S]{0,400}?\}\)/g)].map((m) => m[0]);
  assert(sites.length >= 4, `expected the four lead paths, found ${sites.length}`);
  for (const s of sites) {
    assert(/requestedCount: null/.test(s), `a compiler call site supplies a count:\n${s}`);
  }
});
