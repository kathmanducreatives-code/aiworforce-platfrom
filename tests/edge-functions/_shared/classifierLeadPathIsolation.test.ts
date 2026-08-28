// THE CLASSIFIER NO LONGER ROUTES ANYTHING.
//
// ── WHAT THIS FILE USED TO DEFEND ──────────────────────────────────────────
//
// A split: `classifyWorkflow` owned WHICH branch a request was on, and the
// compiled Mission owned what the run MEANT. That split was the right fix for
// the defect of its day — `people_sourcing` delegated with no mission at all and
// with `decision.query`, `decision.role_keywords` and `decision.location` as the
// run's semantics, so a regex-first classifier WAS the interpreter and
// orchestrate refused the task as `mission_not_compiled`.
//
// It is not the right shape any more. The premise "the classifier still owns the
// branch decision" is exactly what the cleanup removes: Chat Brain owns it, the
// routes carry their own payloads, and the `people_sourcing` and
// `company_hiring_sourcing` branches this file tested no longer exist.
//
// The claims that outlived them are asserted where they now live:
//   which layer decides            -> oneSemanticBrain.test.ts
//   a lead route compiles a mission -> leadMissionTransport.test.ts
//   a social request is not a lead  -> signalSourcingSurface.test.ts
//
// What remains below is the one assertion that was never about the classifier.
//
// No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const PILOT = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** The code of a `if (decision.workflow_category === "<c>") { … }` branch. */
function branch(category: string): string {
  const head = `if (decision.workflow_category === "${category}") {`;
  const i = PILOT.indexOf(head);
  assert(i >= 0, `the ${category} branch must exist`);
  const rest = PILOT.slice(i);
  const end = rest.indexOf("\n  }\n");
  return rest.slice(0, end > 0 ? end + 5 : rest.length);
}

Deno.test("the lead card title no longer asserts a hiring signal the Mission did not state", () => {
  const card = PILOT.slice(PILOT.indexOf("function buildHiringConfirmation"));
  const body = card.slice(0, card.indexOf("\n}\n") + 3);
  assert(
    /hiringClause = intent\.hiring_signal\.requested/.test(body),
    "the 'hiring X' clause must be conditional on the Mission carrying the signal",
  );
  assert(
    !/companies hiring \$\{roleFamilyLabel\(fam\)\}/.test(body),
    "an unconditional hiring clause would preview 'companies hiring Hiring' for a " +
    "lead request with no hiring signal — which now reaches this card",
  );
  assert(
    /signal_type: mission\.required_signals\?\.\[0\]\?\.type/.test(body),
    "the contract's signal type must be the Mission's, not a hard-coded 'hiring'",
  );
});
