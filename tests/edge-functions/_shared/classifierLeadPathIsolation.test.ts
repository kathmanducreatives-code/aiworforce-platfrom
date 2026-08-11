// THE WORKFLOW CLASSIFIER ROUTES; IT DOES NOT INTERPRET.
//
// `classifyWorkflow` is regex-first with a Gemini fallback, and it is the right
// tool for the one question it owns: WHICH branch is this request on? That
// question runs upstream of mission compilation — it is what decides whether a
// Mission is compiled at all — so it cannot be replaced by the thing it gates.
//
// What it may not do is supply the run's MEANING. On the `people_sourcing`
// branch it did exactly that: pilot-chat delegated with no mission at all and
// with `decision.query`, `decision.role_keywords`, `decision.location` and
// `decision.max_results` as the run's semantics. So for a people request the
// regex-first classifier WAS the interpreter — and under `new_architecture`
// orchestrate then refused the task outright (422 `mission_not_compiled`),
// because the one object it requires never arrived.
//
// These tests pin the split: the classifier keeps the branch decision, the
// Mission supplies the semantics, and non-lead workflows are untouched.
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

Deno.test("the classifier still owns the branch decision", () => {
  assert(
    /const wf = await classifyWorkflow\(message\)/.test(PILOT),
    "classifyWorkflow answers WHICH branch this is, upstream of any mission",
  );
});

Deno.test("the people-sourcing branch compiles and carries a Mission", () => {
  const b = branch("people_sourcing");
  assert(
    /compileCanonicalLeadMission\(\{/.test(b),
    "a lead path must compile the canonical Mission",
  );
  assert(/leadMission: peopleMission/.test(b), "…and thread it to orchestrate");
  assert(
    /requestedCount: null/.test(b),
    "with no regex count hint, like every other compiler call site",
  );
});

Deno.test("the people-sourcing branch takes its semantics from the Mission", () => {
  const b = branch("people_sourcing");
  // WHO to look for.
  assert(
    /role_keywords: peopleIntent\?\.target_buyer\?\.length/.test(b),
    "the persona must be the Mission's decision makers, not the classifier's keywords",
  );
  // WHERE.
  assert(
    /location: peopleIntent\?\.target_geography\?\.\[0\]/.test(b),
    "the geography must be the Mission's",
  );
  // HOW MANY.
  assert(
    /effectiveRequestedCount\(peopleMission\)/.test(b),
    "the count must be the Mission's, through the one runtime default",
  );
  // The classifier's own values survive only as the no-mission fallback.
  for (const legacy of ["decision.role_keywords ?? []", "decision.location ?? null", "decision.max_results ?? 5"]) {
    assert(
      b.includes(legacy),
      `the classifier's ${legacy} must remain as the missionless fallback, not be deleted`,
    );
  }
});

Deno.test("non-lead workflows keep the classifier untouched", () => {
  // `signal_sourcing` is LinkedIn engagement/post sourcing — it executes through
  // orchestrate's staged social plan and has no Mission provider yet. It must
  // keep reading the classifier, and must NOT be given a lead card that previews
  // a run that does not exist.
  assert(
    /decision.workflow_category === "signal_sourcing"/.test(PILOT),
    "the social branch still routes on the classifier",
  );
  const leadCategories = PILOT.slice(
    PILOT.indexOf("const LEAD_CONFIRMATION_CATEGORIES"),
  ).slice(0, 200);
  assert(
    !leadCategories.includes("signal_sourcing"),
    "a social-signal request must not be previewed as a lead mission",
  );
  for (const c of ["company_hiring_sourcing", "people_sourcing"]) {
    assert(leadCategories.includes(c), `${c} is a lead card category`);
  }
});

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
