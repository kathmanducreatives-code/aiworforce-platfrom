// A DECIDED MISSION MUST NOT LEAVE AN INCOHERENT EXECUTION MODE BEHIND.
//
// `compileLeadEntityIntent` asserts its own invariant for a company request
// (leadEntityIntent.ts): target_entity "company" always means
// execution_mode "company_first" and company_gate_required true. It is not
// text-dependent — every company request gets it.
//
// But the ambiguity fallback immediately below that
// (`if (clarification_required) { execution_mode = "person_first"; ... }`)
// degrades an unsure reading to person_first with no gate. When a Mission then
// overrides `target_entity` to "company" and clears the doubt, the degraded
// mode SURVIVES, producing an intent that says company but executes
// person_first without a gate.
//
// That incoherence is not cosmetic. run-agent nests the entire mission-driven
// capability engine inside `isCompanyFirstRequest(routingEntityIntent)`, which
// requires BOTH flags — so a company-only mission (exactly the shape a
// Signals "Investigate company" action produces) is refused with
// `sourcing_requires_mission_architecture` and no provider is ever called.
//
// Pure. No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyMissionEntityAuthority,
  compileLeadEntityIntent,
} from "../../../supabase/functions/_shared/leadEntityIntent.ts";
import { isCompanyFirstRequest } from "../../../supabase/functions/_shared/runAgentCompoundBridge.ts";

// The sentence a Signals situation produces: a named company, a signal, and
// no person vocabulary at all — which is precisely what the regex compiler
// finds ambiguous.
const AMBIGUOUS = "Check Vercel for hiring signals";

Deno.test("company mission over an ambiguous sentence executes company_first", () => {
  const intent = applyMissionEntityAuthority(
    compileLeadEntityIntent(AMBIGUOUS),
    { target_entity: "company" },
  );
  assertEquals(intent.target_entity, "company");
  assertEquals(intent.execution_mode, "company_first");
  assertEquals(intent.company_gate_required, true);
});

Deno.test("a company mission reaches the capability engine's gate", () => {
  const intent = applyMissionEntityAuthority(
    compileLeadEntityIntent(AMBIGUOUS),
    { target_entity: "company" },
  );
  assert(
    isCompanyFirstRequest(intent),
    "run-agent nests the capability engine inside this predicate; false here " +
      "means the mission is refused as sourcing_requires_mission_architecture",
  );
});

Deno.test("the mission's answer matches an unambiguous sentence's own answer", () => {
  // The authority overlay must reproduce what the compiler would have decided
  // had the sentence been clear — not invent a third routing rule.
  const direct = compileLeadEntityIntent("Find companies hiring sales engineers");
  const viaMission = applyMissionEntityAuthority(
    compileLeadEntityIntent(AMBIGUOUS),
    { target_entity: "company" },
  );
  assertEquals(direct.target_entity, "company");
  assertEquals(viaMission.execution_mode, direct.execution_mode);
  assertEquals(viaMission.company_gate_required, direct.company_gate_required);
});

Deno.test("a person mission is NOT forced into a company gate", () => {
  // The person branch is text-dependent (company qualifier / company signal),
  // so the overlay must leave it exactly as compiled.
  const compiled = compileLeadEntityIntent("Find me founders looking for work");
  const viaMission = applyMissionEntityAuthority(compiled, { target_entity: "person" });
  assertEquals(viaMission.execution_mode, compiled.execution_mode);
  assertEquals(viaMission.company_gate_required, compiled.company_gate_required);
});

Deno.test("no mission leaves the compiled intent untouched", () => {
  const compiled = compileLeadEntityIntent(AMBIGUOUS);
  const passthrough = applyMissionEntityAuthority(compiled, null);
  assertEquals(passthrough, compiled);
});
