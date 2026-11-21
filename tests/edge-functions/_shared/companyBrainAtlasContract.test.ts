// COMPANY BRAIN V2 · THE ATLAS READ CONTRACT, PINNED (B2.1 prerequisite).
//
// ATLAS (owned by another session) reads the Brain through exactly these
// functions: `compilerBrainContext` / `contractBrainInput` / `brainPlanningContext`
// (leadPipeline/brainContext.ts → `BrainMergeInput` / `ContractBrainInput`) and,
// underneath them, `compileCompanyBrainContext`. Brain V2 must not change what
// they return for any existing profile shape, nor the authority semantics
// (user > size policy > preferences) that missionContract/brain.ts applies.
//
// The golden file was generated from launch/hardening a2c0b55f BEFORE any V2
// change. It may only be regenerated deliberately:
//   UPDATE_GOLDEN=1 deno test -A --no-check tests/edge-functions/_shared/companyBrainAtlasContract.test.ts
// and a regenerated golden needs the ATLAS session's sign-off in the PR.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brainPlanningContext, compilerBrainContext, contractBrainInput,
} from "../../../supabase/functions/_shared/leadPipeline/brainContext.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { planBrainUpdate } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";

const FIX = new URL("../../fixtures/company-brain/atlas-contract-profiles.json", import.meta.url);
const GOLD = new URL("../../fixtures/company-brain/atlas-contract-golden.json", import.meta.url);
type Raw = Record<string, unknown>;
const profiles = (JSON.parse(await Deno.readTextFile(FIX)) as { profiles: Record<string, Raw> }).profiles;

/** Every surface ATLAS reads, for one stored profile. */
function surfaces(profile: Raw) {
  return {
    compilerBrainContext: compilerBrainContext(profile),
    contractBrainInput: contractBrainInput(profile),
    planning_onboarded: brainPlanningContext({ profile, onboarding_completed: true }),
    planning_not_onboarded: brainPlanningContext({ profile, onboarding_completed: false }),
    compiled: compileCompanyBrainContext({ workspace_id: "w", profile }),
  };
}

/** Edits through the authorized update path; ATLAS then reads the stored result. */
const EDITS: Record<string, { base: string; patch: Raw }> = {
  edit_industries: { base: "live_shape", patch: { target_customer: { industries: ["Healthcare"] } } },
  clear_geography: { base: "live_shape", patch: { target_customer: { geography: [] } } },
  edit_size: { base: "live_shape", patch: { target_customer: { company_size: { min: 11, max: 50, label: "11-50" } } } },
  edit_personas: { base: "v2_only", patch: { buyer_personas: ["COO", "Head of Finance"] } },
};
function afterEdit(e: { base: string; patch: Raw }) {
  const plan = planBrainUpdate({ existing: profiles[e.base], currentUpdatedAt: "v1", expectedUpdatedAt: "v1", patch: e.patch, alreadyActive: true });
  if (!plan.ok) return { refused: plan.reason };
  return surfaces(plan.profile);
}

function snapshot() {
  const out: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(profiles)) out[`profile:${name}`] = surfaces(p);
  for (const [name, e] of Object.entries(EDITS)) out[`edit:${name}`] = afterEdit(e);
  return JSON.parse(JSON.stringify(out));
}

if (Deno.env.get("UPDATE_GOLDEN") === "1") {
  await Deno.writeTextFile(GOLD, JSON.stringify(snapshot(), null, 2) + "\n");
  console.log("golden regenerated:", GOLD.pathname);
}

const golden = JSON.parse(await Deno.readTextFile(GOLD)) as Record<string, unknown>;
const now = snapshot();

for (const key of Object.keys(golden)) {
  Deno.test(`ATLAS read contract unchanged: ${key}`, () => {
    assertEquals(now[key], golden[key]);
  });
}
Deno.test("ATLAS read contract: no case added or removed without regenerating the golden", () => {
  assertEquals(Object.keys(now).sort(), Object.keys(golden).sort());
});
