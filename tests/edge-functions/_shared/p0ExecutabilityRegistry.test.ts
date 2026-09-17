// LEAD V2 P0 — THE EXECUTABILITY TABLE CANNOT DRIFT FROM THE ENGINE IT DESCRIBES.
//
// `capabilityExecutability.ts` is a declaration. These tests re-derive, from
// the engine's own source and exported sets, which capabilities actually have
// an executor, and fail if the table claims more (a capability marked
// executable the engine skips) or less (an executor the table ignores).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CAPABILITY_EXECUTABILITY, EXECUTABILITY_GATE_ENV, capabilityExecutability,
  executabilityGateFor, executabilityStateOf, isCapabilityExecutable,
} from "../../../supabase/functions/_shared/capabilityExecutability.ts";
import {
  CAPABILITY_IDS, isCapabilitySupported,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  ENGINE_DRIVEN_DISCOVERY, ENGINE_DRIVEN_SIGNAL_VERIFICATION,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { ENGINE_DRIVEN_CAPABILITIES } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";
import { LEAD_V2_WORKSPACES_ENV } from "../../../supabase/functions/_shared/leadExecutionEngine.ts";

const ENGINE = Deno.readTextFileSync(
  new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));

/** Capabilities with an explicit `cap === "<id>"` branch in the engine. */
function branched(id: string): boolean {
  return ENGINE.includes(`cap === "${id}"`);
}

/** Capabilities the engine explicitly finishes as "not yet engine-driven". */
function skippedByEngine(): Set<string> {
  const at = ENGINE.indexOf('"capability is not yet engine-driven');
  assert(at > 0, "the engine's explicit skip branch exists");
  const head = ENGINE.lastIndexOf("if (cap ===", at);
  return new Set([...ENGINE.slice(head, at).matchAll(/cap === "(\w+)"/g)].map((m) => m[1]));
}

Deno.test("the table covers every capability the graph knows, and nothing else", () => {
  assertEquals(Object.keys(CAPABILITY_EXECUTABILITY).sort(), [...CAPABILITY_IDS].sort());
  for (const id of CAPABILITY_IDS) assertEquals(capabilityExecutability(id).capability, id);
});

Deno.test("an executable capability has an engine executor and is not skipped", () => {
  const skipped = skippedByEngine();
  for (const id of CAPABILITY_IDS) {
    if (!isCapabilityExecutable(id)) continue;
    const driven = ENGINE_DRIVEN_DISCOVERY.has(id) || ENGINE_DRIVEN_SIGNAL_VERIFICATION.has(id) || branched(id);
    assert(driven, `${id} is marked executable but the engine has no executor for it`);
    assert(!skipped.has(id), `${id} is marked executable but the engine skips it`);
  }
});

Deno.test("a non-executable capability really has no executor today", () => {
  const skipped = skippedByEngine();
  const nonExecutable = CAPABILITY_IDS.filter((id) => !isCapabilityExecutable(id));
  // P3: job_discovery (LinkedIn job search) and job_deduplication became executable.
  assertEquals(nonExecutable.sort(), [
    "company_post_verification", "expansion_signal_discovery",
    "product_launch_discovery", "technology_verification",
  ]);
  for (const id of nonExecutable) {
    assert(!ENGINE_DRIVEN_DISCOVERY.has(id) && !ENGINE_DRIVEN_SIGNAL_VERIFICATION.has(id), id);
    // Either explicitly skipped, or never branched on (→ "unhandled capability").
    assert(skipped.has(id) || !branched(id), `${id} has an engine branch — re-grade it`);
  }
  assert(ENGINE.includes("`unhandled capability: ${cap}`"), "the unhandled fall-through the table relies on");
  // The four the signal audit named are the ones `isCapabilitySupported` wrongly passes.
  for (const id of ["product_launch_discovery", "expansion_signal_discovery",
    "technology_verification", "company_post_verification"] as const) {
    assert(isCapabilitySupported(id), `${id}: supported (claim not refuted)…`);
    assert(!isCapabilityExecutable(id), `${id}: …but not executable`);
  }
});

Deno.test("state and primitives agree: executable ⇔ every primitive present", () => {
  for (const e of Object.values(CAPABILITY_EXECUTABILITY)) {
    const p = e.primitives;
    const all = p.provider_available && p.verified_contract && p.engine_executor && p.normalizer &&
      (p.entity_extraction === true || p.entity_extraction === "n/a");
    assertEquals(e.state === "executable", all, e.capability);
    assert(e.reason.length > 10, `${e.capability} states why`);
  }
  assertEquals(executabilityStateOf("technology_verification"), "needs_engine_work");
  assertEquals(executabilityStateOf("product_launch_discovery"), "needs_extraction_work");
  assertEquals(executabilityStateOf("job_discovery"), "executable", "P3: carded, driven, normalised");
  assertEquals(executabilityStateOf("no_such_capability"), "unsupported");
  assertEquals(isCapabilityExecutable("no_such_capability"), false, "unknown is never executable");
});

Deno.test("every capability the playbooks call engine-driven is executable", () => {
  for (const id of ENGINE_DRIVEN_CAPABILITIES) assert(isCapabilityExecutable(id), id);
});

Deno.test("the gate is enforced only for Lead V2, and the kill switch always wins", () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];
  const WS = "e8af257d-4c42-4fc2-9d62-037cdfac27c4";
  const OTHER = "11111111-2222-4333-8444-555555555555";
  const v2 = { [LEAD_V2_WORKSPACES_ENV]: WS };
  assertEquals(executabilityGateFor(WS, env(v2)), "enforce", "allowlisted V2 workspace");
  assertEquals(executabilityGateFor(OTHER, env(v2)), "legacy", "V1 workspace");
  assertEquals(executabilityGateFor(WS, env({})), "legacy", "empty allowlist = V1 everywhere");
  assertEquals(executabilityGateFor(null, env(v2)), "legacy");
  assertEquals(executabilityGateFor(null, env({}), true), "enforce", "the V2 queue executing it");
  for (const off of ["off", "legacy", " OFF "]) {
    const killed = { ...v2, [EXECUTABILITY_GATE_ENV]: off };
    assertEquals(executabilityGateFor(WS, env(killed)), "legacy", `kill switch ${off}`);
    assertEquals(executabilityGateFor(WS, env(killed), true), "legacy", `kill switch ${off} beats the queue`);
  }
});
