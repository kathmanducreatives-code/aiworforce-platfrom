// PHASE 2 — HOW AN AGENT MOVES, AND HOW LITTLE.
//
// The animator turns a truthful visual state, the cursor and one-shot gestures
// into rig calls. These tests pin the restraint: breathing and blinking at
// rest; the head following the cursor only inside its cone and only partly
// while the agent is focused; one nod per click, a smaller one for a finished
// task, none for a stopped one; clips chosen by state and never borrowed from
// another state; no jump when a tab wakes up after minutes.
//
// PURE. A recording rig stands in for three.js.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BASE_FADE_S, blinkCurve, BLINK_MS, BREATH_AMPLITUDE_DEG, COMPLETED_NOD_SCALE, createAgentAnimator, NOD, nodCurve, POSTURES,
  type AnimatorInput, type RigAdapter,
} from "../../src/lib/agent3d/animationController.ts";
import { GAZE_LIMITS, type AgentModelManifest } from "../../src/lib/agent3d/registry.ts";
import { IDLE_VISUAL, type VisualBase } from "../../src/lib/agent3d/visualState.ts";
import type { GazeAngles } from "../../src/lib/agent3d/gaze.ts";

const MANIFEST: AgentModelManifest = {
  format: "glb", url: "/agents/3d/lyra.glb", bytes: 1,
  rig: { head: "Head", chest: "Spine2" },
  clips: { working: "Work" },
  gestures: {},
  framing: { target: [0, 1.5, 0], distance: 1, fovDeg: 28 },
};

function recorder() {
  const log = {
    base: [] as [string | null, number][], gestures: [] as string[],
    head: { yawDeg: 0, pitchDeg: 0 } as GazeAngles, eyes: { yawDeg: 0, pitchDeg: 0 } as GazeAngles,
    chest: 0, maxChest: 0, blink: 0, minHeadPitch: 0, blinks: 0,
  };
  let closed = false;
  const rig: RigAdapter = {
    playBase: (c, f) => log.base.push([c, f]),
    playGesture: (c) => log.gestures.push(c),
    setHead: (o) => { log.head = o; log.minHeadPitch = Math.min(log.minHeadPitch, o.pitchDeg); },
    setEyes: (o) => { log.eyes = o; },
    setChest: (p) => { log.chest = p; log.maxChest = Math.max(log.maxChest, Math.abs(p)); },
    setBlink: (a) => { if (a > 0.5 && !closed) log.blinks++; closed = a > 0.5; log.blink = a; },
  };
  return { log, rig };
}

const input = (base: VisualBase, extra: Partial<AnimatorInput> = {}): AnimatorInput => ({ state: { ...IDLE_VISUAL, base }, pointer: null, gesture: null, ...extra });
const run = (a: { update: (dt: number, i: AnimatorInput) => void }, ms: number, i: AnimatorInput, step = 16) => { for (let t = 0; t < ms; t += step) a.update(step, i); };
const near = (a: number, b: number, eps = 0.05) => Math.abs(a - b) <= eps;

Deno.test("the base clip follows the state, crossfades on change, and never borrows another state's clip", () => {
  const { log, rig } = recorder();
  const a = createAgentAnimator({ manifest: { ...MANIFEST, clips: { idle: "Idle", working: "Work" } }, rig, random: () => 0.5 });
  run(a, 200, input("idle"));
  assertEquals(log.base, [["Idle", 0]], "played once, immediately");
  run(a, 200, input("working"));
  assertEquals(log.base.at(-1), ["Work", BASE_FADE_S]);
  run(a, 200, input("thinking"));
  assertEquals(log.base.at(-1), ["Idle", BASE_FADE_S], "no thinking clip → idle, not work");
  assertEquals(log.base.length, 3);
});

Deno.test("blinks: first after the interval, a quick close-and-open, and fewer while thinking", () => {
  const { log, rig } = recorder();
  const a = createAgentAnimator({ manifest: MANIFEST, rig, random: () => 0 });
  // The first blink is scheduled from the first frame (16 ms), so it closes
  // just after the interval: none before it, exactly one across it.
  run(a, POSTURES.idle.blinkMs[0] - 32, input("idle"));
  assertEquals(log.blinks, 0);
  run(a, 120, input("idle"), 8);
  assertEquals(log.blinks, 1);
  run(a, BLINK_MS, input("idle"), 8);
  assertEquals(log.blink, 0, "eyes reopen");

  const count = (base: VisualBase) => { const r = recorder(); run(createAgentAnimator({ manifest: MANIFEST, rig: r.rig, random: () => 0.5 }), 60_000, input(base), 8); return r.log.blinks; };
  const idle = count("idle"), thinking = count("thinking");
  assert(idle >= 60_000 / POSTURES.idle.blinkMs[1] && idle <= 60_000 / POSTURES.idle.blinkMs[0] + 1, `idle blinks ${idle}`);
  assert(thinking < idle, `thinking ${thinking} < idle ${idle}`);
});

Deno.test("hover: the head turns toward the cursor inside its cone, and only partly while working", () => {
  const right: GazeAngles = { yawDeg: GAZE_LIMITS.maxYawDeg, pitchDeg: 0 };
  const settle = (base: VisualBase, pointer: GazeAngles | null) => { const r = recorder(); run(createAgentAnimator({ manifest: MANIFEST, rig: r.rig, random: () => 0.5 }), 3_000, input(base, { pointer })); return r.log; };
  const idle = settle("idle", right);
  assert(near(idle.head.yawDeg + idle.eyes.yawDeg, GAZE_LIMITS.maxYawDeg, 0.1), "idle looks fully at the cursor");
  assert(idle.head.yawDeg < GAZE_LIMITS.maxYawDeg, "eyes lead, head follows part of the way");
  const working = settle("working", right);
  const expected = POSTURES.working.gaze.yawDeg + (GAZE_LIMITS.maxYawDeg - POSTURES.working.gaze.yawDeg) * POSTURES.working.attention;
  assert(near(working.head.yawDeg + working.eyes.yawDeg, expected, 0.1), "working answers the cursor only partly");
  assert(working.head.yawDeg < idle.head.yawDeg);
  const wild = settle("idle", { yawDeg: 90, pitchDeg: -90 });
  assert(wild.head.yawDeg + wild.eyes.yawDeg <= GAZE_LIMITS.maxYawDeg + 1e-9);
  assert(wild.head.pitchDeg + wild.eyes.pitchDeg >= -GAZE_LIMITS.maxPitchDeg - 1e-9);
});

Deno.test("the cursor leaving eases the head back to the state's posture", () => {
  const { log, rig } = recorder();
  const a = createAgentAnimator({ manifest: MANIFEST, rig, random: () => 0.5 });
  run(a, 2_000, input("idle", { pointer: { yawDeg: 12, pitchDeg: 8 } }));
  run(a, 4_000, input("idle"));
  assert(near(log.head.yawDeg, 0, 0.05) && near(log.head.pitchDeg, 0, 0.05));
  run(a, 4_000, input("thinking"));
  const g = POSTURES.thinking.gaze;
  assert(near(log.head.yawDeg + log.eyes.yawDeg, g.yawDeg, 0.05) && near(log.head.pitchDeg + log.eyes.pitchDeg, g.pitchDeg, 0.05));
});

Deno.test("every posture sits inside the gaze limits and answers the cursor by at most 100%", () => {
  for (const [base, p] of Object.entries(POSTURES)) {
    assert(Math.abs(p.gaze.yawDeg) <= GAZE_LIMITS.maxYawDeg && Math.abs(p.gaze.pitchDeg) <= GAZE_LIMITS.maxPitchDeg, base);
    assert(p.attention >= 0 && p.attention <= 1, base);
  }
});

Deno.test("gestures: one nod per click, a smaller one for a finish, none for a stop, and a clip when the model has one", () => {
  const nod = (kind: "acknowledge" | "completed" | "stopped") => {
    const r = recorder();
    const a = createAgentAnimator({ manifest: MANIFEST, rig: r.rig, random: () => 0.5 });
    run(a, 1_000, input("idle"));
    run(a, NOD.durationMs + 100, input("idle", { gesture: { kind, nonce: 1 } }), 8);
    return r.log;
  };
  assert(near(nod("acknowledge").minHeadPitch, -NOD.depthDeg, 0.05));
  assert(near(nod("completed").minHeadPitch, -NOD.depthDeg * COMPLETED_NOD_SCALE, 0.05));
  assert(near(nod("stopped").minHeadPitch, 0, 0.01), "a stopped task is not acted out");

  const { log, rig } = recorder();
  const a = createAgentAnimator({ manifest: MANIFEST, rig, random: () => 0.5 });
  run(a, NOD.durationMs + 100, input("idle", { gesture: { kind: "acknowledge", nonce: 7 } }), 8);
  assert(near(log.head.pitchDeg, 0, 0.01), "the nod ends");
  log.minHeadPitch = 0;
  run(a, NOD.durationMs + 100, input("idle", { gesture: { kind: "acknowledge", nonce: 7 } }), 8);
  assert(near(log.minHeadPitch, 0, 0.01), "the same request is not replayed");

  const withClip = recorder();
  const b = createAgentAnimator({ manifest: { ...MANIFEST, gestures: { acknowledge: "Nod" } }, rig: withClip.rig, random: () => 0.5 });
  run(b, 900, input("idle", { gesture: { kind: "acknowledge", nonce: 1 } }), 8);
  assertEquals(withClip.log.gestures, ["Nod"]);
  assert(near(withClip.log.minHeadPitch, 0, 0.01), "the clip replaces the procedural nod");
});

Deno.test("breathing: procedural and under a degree without an idle clip; left to the clip when there is one", () => {
  const { log, rig } = recorder();
  run(createAgentAnimator({ manifest: MANIFEST, rig, random: () => 0.5 }), 10_000, input("idle"));
  assert(log.maxChest > BREATH_AMPLITUDE_DEG * 0.9 && log.maxChest <= BREATH_AMPLITUDE_DEG + 1e-9);
  const clip = recorder();
  run(createAgentAnimator({ manifest: { ...MANIFEST, clips: { idle: "Idle" } }, rig: clip.rig, random: () => 0.5 }), 10_000, input("idle"));
  assertEquals(clip.log.maxChest, 0);
});

Deno.test("a tab waking after minutes moves the agent no further than one short frame", () => {
  const pointer = { yawDeg: 12, pitchDeg: 0 };
  const slept = recorder(), stepped = recorder();
  createAgentAnimator({ manifest: MANIFEST, rig: slept.rig, random: () => 0.5 }).update(300_000, input("idle", { pointer }));
  createAgentAnimator({ manifest: MANIFEST, rig: stepped.rig, random: () => 0.5 }).update(100, input("idle", { pointer }));
  assertEquals(slept.log.head, stepped.log.head);
  assertFalse(Number.isNaN(slept.log.chest));
});

Deno.test("the curves stay in range", () => {
  for (let t = -10; t < 900; t += 5) {
    const b = blinkCurve(t), n = nodCurve(t);
    assert(b >= 0 && b <= 1);
    assert(n <= 0 && n >= -NOD.depthDeg);
  }
  assertEquals(blinkCurve(BLINK_MS), 0);
  assertEquals(nodCurve(NOD.durationMs), 0);
});
