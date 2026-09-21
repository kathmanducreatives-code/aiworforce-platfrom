// A TASK RUNS THE MODEL IT NAMED, OR IT FAILS SAYING SO.
//
// `DEFAULT_MODELS` pointed all seven task types at Gemini models behind the
// Lovable gateway. That gateway needs `LOVABLE_API_KEY`, which the running
// environment does not have — so every Lovable attempt was skipped and all
// seven tasks quietly fell through to one hardcoded Anthropic helper model.
// Pilot chat, orchestration, agent execution, tool-input planning and both
// Company Brain tasks ran helper-grade, silently, because of a missing
// credential. `ok: true` came back either way.
//
// What these pin is the property, not the particular models: whatever a task
// intends, a missing credential is a REFUSAL unless that task has declared a
// fallback — and a fallback that runs is announced.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  TASK_MODELS, plannedAttempts, type TaskType, type ModelVendor,
} from "../../../supabase/functions/_shared/aiProvider.ts";

const ALL: TaskType[] = [
  "pilot_chat", "orchestration_plan", "agent_execution", "tool_input_planning",
  "company_brain_analyze", "company_brain_followups", "helper",
];
const both = () => true;
const none = () => false;
const only = (v: ModelVendor) => (x: ModelVendor) => x === v;

Deno.test("every task type declares a model, a vendor and a fallback policy", () => {
  for (const t of ALL) {
    const p = TASK_MODELS[t];
    assert(p, `${t} has no policy`);
    assert(p.model && p.model.length > 3, `${t} has no model`);
    assert(p.vendor === "anthropic" || p.vendor === "openai", `${t} has no vendor`);
    assert(p.rationale.length > 20, `${t} must say WHY this tier`);
    if (p.fallback) assert(p.fallback.model !== p.model, `${t}'s fallback is the same model`);
  }
  assertEquals(Object.keys(TASK_MODELS).sort(), [...ALL].sort(), "one policy per task, no extras");
});

Deno.test("no task routes through the retired Lovable/Gemini gateway", () => {
  for (const t of ALL) {
    const p = TASK_MODELS[t];
    const models = [p.model, p.fallback?.model ?? ""].join(" ");
    assertEquals(/gemini|google\//i.test(models), false, `${t} still names a Gemini model`);
    assertEquals(/lovable/i.test(models), false, `${t} still names the gateway`);
  }
});

Deno.test("with every credential present, a task runs the model it intends", () => {
  for (const t of ALL) {
    const [first] = plannedAttempts(t, both);
    assertEquals(first.model, TASK_MODELS[t].model, t);
    assertEquals(first.intended, true, t);
  }
});

Deno.test("a missing credential NEVER silently demotes a task", () => {
  for (const t of ALL) {
    const p = TASK_MODELS[t];
    // The intended vendor is unavailable.
    const otherVendor: ModelVendor = p.vendor === "anthropic" ? "openai" : "anthropic";
    const attempts = plannedAttempts(t, only(otherVendor));
    if (!p.fallback) {
      assertEquals(attempts, [], `${t} has no declared fallback, so it must attempt NOTHING`);
    } else {
      // A fallback may run, but it is never marked as the intended model.
      assertEquals(attempts.every((a) => !a.intended), true, t);
      assertEquals(attempts[0]?.model, p.fallback.model, t);
    }
  }
});

Deno.test("with no credentials at all, nothing is attempted", () => {
  for (const t of ALL) assertEquals(plannedAttempts(t, none), [], t);
});

Deno.test("the user-facing and decision-making tasks refuse rather than substitute", () => {
  // These produce what the user reads, or decide what work runs and what it
  // costs. A quieter model is not an acceptable stand-in for either.
  for (const t of ["pilot_chat", "orchestration_plan", "agent_execution",
                   "company_brain_analyze", "company_brain_followups"] as TaskType[]) {
    assertEquals(TASK_MODELS[t].fallback, null, `${t} must not substitute a model`);
  }
});

Deno.test("the mechanical tasks may substitute, and say which vendor", () => {
  for (const t of ["helper", "tool_input_planning"] as TaskType[]) {
    const p = TASK_MODELS[t];
    assert(p.fallback, `${t} should declare its fallback explicitly`);
    assert(p.fallback!.vendor !== p.vendor, `${t}'s fallback should be a different vendor to be useful`);
  }
});

Deno.test("the refusal names the credential an operator has to set", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/aiProvider.ts", import.meta.url),
  );
  assert(src.includes("no_provider_for_task"), "the refusal has its own code");
  assert(/needed_env/.test(src), "and the log says which variable is missing");
  // And a fallback that DOES run is announced rather than passing as normal.
  assert(/degraded: !att\.intended/.test(src), "the result must mark a degraded run");
  assert(/ran on its FALLBACK model/.test(src), "and warn about it");
});
