// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CALL_BRIEF_SCHEMA } from "../../../supabase/functions/_shared/pilot/callBriefContract.ts";
import { modelSelection } from "../../../supabase/functions/_shared/pilot/pilotTaskModelPolicy.ts";
import {
  PILOT_HARD_LIMITS,
  PILOT_MODEL_REGISTRY,
} from "../../../supabase/functions/_shared/pilot/pilotModelRegistry.ts";
import { CRED_A } from "../_helpers/pilotScopeFixture.ts";
Deno.test("P6 strict provider schema has required fields and no factual prose slots", () => {
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const r = v as Record<string, unknown>;
    if (r.type === "object") {
      assertEquals(r.additionalProperties, false);
      assertEquals(
        r.required,
        Object.keys(r.properties as Record<string, unknown>),
      );
    }
    Object.values(r).forEach(walk);
  };
  walk(CALL_BRIEF_SCHEMA.schema);
  const keys = Object.keys(CALL_BRIEF_SCHEMA.schema.properties);
  assertEquals(keys, [
    "schema_version",
    "company_overview",
    "business_context",
    "signal_evidence",
    "talking_points",
    "discovery_questions",
    "missing_information",
  ]);
  assert(!JSON.stringify(CALL_BRIEF_SCHEMA).includes('"text"'));
});
Deno.test("P6 extends only P4 contract allowlist, keeps every model disabled and A7 budgets unchanged", () => {
  const base = {
    provider: "openai",
    model: "gpt-4.1-mini",
    credential_id: CRED_A,
    policy_version: 1,
    task_kind: "call_brief",
  };
  for (const schema of ["pilot_model_probe_v1", "call_brief_v1"]) {
    assertEquals(modelSelection({ ...base, schema }).schema, schema);
  }
  assertThrows(() => modelSelection({ ...base, schema: "anything_else" }));
  assert(PILOT_MODEL_REGISTRY.every((m) => !m.enabled));
  assertEquals(PILOT_HARD_LIMITS, {
    runtime_attempts: 4,
    model_usd: 0.05,
    provider_usd: 0.20,
    combined_usd: 0.25,
  });
});
