// R2 — RETRY THEN REFUSE, NEVER SUBSTITUTE A REGEX READING.
//
// The architectural rule: a new lead request compiles to a canonical Mission,
// and a compilation that fails or returns invalid output RETRIES and then fails
// explicitly. It never silently falls back to regex interpretation, because that
// answers a differently-read request — R1's fixtures measured it inventing
// personas nobody named and discarding companies the user supplied.
//
// This file covers the RETRY half (in the binding) and the shape of the explicit
// failure. The refusal itself is raised at the call sites, which are the only
// places that know whether a workspace runs the compiled-mission architecture.
//
// Every model seam is a stub. Zero network, zero cost.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMissionCompilerBinding, isMissionCompilerEnabled,
  MAX_COMPILATION_ATTEMPTS, MissionCompilationFailedError,
  MISSION_COMPILER_FLAG, MISSION_COMPILER_WORKSPACES_ENV,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";

const WS = "00000000-0000-4000-8000-000000000001";
const CTX = { originalUserQuery: "Find 5 B2B SaaS companies hiring SDRs in London" };

/** Env that switches the compiler ON for exactly this workspace. */
const enabledEnv = (k: string) =>
  k === MISSION_COMPILER_FLAG ? "true"
  : k === MISSION_COMPILER_WORKSPACES_ENV ? WS
  : undefined;

/** A model seam that never reaches a network, and counts its invocations. */
function seam(outcomes: Array<{ ok: boolean; json?: unknown } | "throw">) {
  const calls = { n: 0 };
  const generate = (async () => {
    const o = outcomes[Math.min(calls.n, outcomes.length - 1)];
    calls.n += 1;
    if (o === "throw") throw new Error("transport exploded");
    return o;
  }) as never;
  return { generate, calls };
}

function binding(outcomes: Parameters<typeof seam>[0]) {
  const s = seam(outcomes);
  return {
    calls: s.calls,
    b: buildMissionCompilerBinding({ workspaceId: WS, read: enabledEnv, generate: s.generate }),
  };
}

Deno.test("the cap is a constant, so the worst case is bounded by construction", () => {
  assertEquals(MAX_COMPILATION_ATTEMPTS, 2);
  const { b } = binding([{ ok: true, json: { requested_opportunity_count: 5 } }]);
  assertEquals(b.diagnostics.calls_allowed, MAX_COMPILATION_ATTEMPTS);
});

Deno.test("a first-attempt success is NOT retried", () => {
  // The retry exists for transient failure. Burning a second call on a proposal
  // the model already returned would be spend with nothing bought — and
  // judging that proposal is compileLeadMission's job, not the binding's.
  const { b, calls } = binding([{ ok: true, json: { requested_opportunity_count: 5 } }]);
  return b.proposeMission!(CTX).then((p) => {
    assert(p != null, "the proposal must be returned");
    assertEquals(calls.n, 1);
  });
});

Deno.test("a transient failure is retried once and can succeed", async () => {
  const { b, calls } = binding([
    { ok: false },
    { ok: true, json: { requested_opportunity_count: 7 } },
  ]);
  const p = await b.proposeMission!(CTX);
  assertEquals(calls.n, 2);
  assertEquals((p as { requested_opportunity_count: number }).requested_opportunity_count, 7);
});

Deno.test("a THROWN first attempt still gets the second", async () => {
  // The old code swallowed a throw and returned null immediately, so a socket
  // hang-up cost the whole compilation.
  const { b, calls } = binding(["throw", { ok: true, json: { requested_opportunity_count: 3 } }]);
  const p = await b.proposeMission!(CTX);
  assertEquals(calls.n, 2);
  assert(p != null);
});

Deno.test("every attempt failing returns null — and stops at the cap", async () => {
  const { b, calls } = binding([{ ok: false }, { ok: false }, { ok: false }]);
  const p = await b.proposeMission!(CTX);
  assertEquals(p, null, "null means every attempt failed, honestly reported");
  assertEquals(calls.n, MAX_COMPILATION_ATTEMPTS, "must not exceed the cap");
});

Deno.test("every attempt throwing returns null rather than propagating", async () => {
  const { b, calls } = binding(["throw", "throw"]);
  assertEquals(await b.proposeMission!(CTX), null);
  assertEquals(calls.n, MAX_COMPILATION_ATTEMPTS);
});

Deno.test("an ok response with a null body is not a usable proposal", async () => {
  // `ok: true, json: null` used to satisfy the old `?.ok` check and return
  // undefined, which compileLeadMission reads as "no model ran" — the same
  // outcome as a failure, reached without retrying.
  const { b, calls } = binding([{ ok: true, json: null }, { ok: true, json: { requested_opportunity_count: 5 } }]);
  const p = await b.proposeMission!(CTX);
  assertEquals(calls.n, 2, "an empty body must be treated as a failed attempt");
  assert(p != null);
});

// ── REPLACED 2026-08-17: THERE IS NO LONGER A DISABLED WORKSPACE ──────────
//
// This asserted that an unset `GPT_LEAD_MISSION_COMPILER` produced
// `proposeMission: null`. That was the whole defect: the flag has never been
// set on the live project, so no model ever read a user's request and a regex
// reading became the mission.
//
// The flag was REMOVED from the decision rather than defaulted to true — a
// hidden switch that changes what a request means is the thing being
// eliminated. What replaces the old assertion is its opposite: interpretation
// cannot be switched off, whatever the environment says.
Deno.test("interpretation cannot be switched off by an unset flag", () => {
  const off = buildMissionCompilerBinding({ workspaceId: WS, read: () => undefined });
  assert(off.proposeMission !== null, "a model must be offered regardless of the old flag");
  assertEquals(off.diagnostics.calls_allowed, MAX_COMPILATION_ATTEMPTS);
  assertEquals(off.diagnostics.provider, "openai", "and it must be the GPT adapter");
});

Deno.test("the explicit failure is a distinct class that says what did NOT happen", () => {
  const e = new MissionCompilationFailedError(WS, "enabled");
  assert(e instanceof Error);
  assertEquals(e.name, "MissionCompilationFailedError");
  assertEquals(e.workspaceId, WS);
  assertEquals(e.enablementReason, "enabled");
  // The message has to state the two things an operator needs: that nothing was
  // substituted, and that nothing was scheduled.
  assert(/no deterministic mission was substituted/i.test(e.message));
  assert(/no provider work was scheduled/i.test(e.message));
});

// ---------------------------------------------------------------------------
// THE CALL-SITE REFUSAL, asserted structurally.
// ---------------------------------------------------------------------------

const PILOT_CHAT_SRC = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
);

// ── UPDATED 2026-08-17: THE REFUSAL NO LONGER KEYS ON THE MODE ────────────
//
// This required the refusal to check BOTH `new_architecture` and the parser
// source. Keying on the mode is what made it decorative: the mode needs five
// flags, none was ever set, so the second half of the condition was never
// evaluated on a real run and every run returned a regex reading as its
// mission. The parser source alone is the honest condition.
Deno.test("pilot-chat refuses an uncompiled mission rather than substituting", () => {
  assert(
    /mission_parser_source === "deterministic_fallback"/.test(PILOT_CHAT_SRC),
    "the refusal must key on the parser source",
  );
  // BOTH producers refuse: the canonical mission and the confirmation card.
  // The card is what the user approves before money moves, so an unverified
  // reading there is worse than one deeper in the pipeline, not better.
  assertEquals(
    (PILOT_CHAT_SRC.match(/mission_parser_source === "deterministic_fallback"/g) ?? []).length,
    2,
    "both the canonical path and the confirmation card must refuse",
  );
  assert(
    /throw new MissionCompilationFailedError\(/.test(PILOT_CHAT_SRC),
    "it must throw the distinct class, not return a deterministic mission",
  );
});
