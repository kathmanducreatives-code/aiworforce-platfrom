// THE ANIMATION LAYER: visual state + cursor + gestures → what the rig does.
//
//   agent backend state → visual state → [this file] → rig
//
// Restraint is the design. At rest an agent breathes and blinks, nothing more.
// The cursor turns the head a few degrees toward it. Focus states (thinking,
// working) hold their own posture and answer the cursor only partly — the
// agent notices you without abandoning the work. A click earns one small nod;
// a finished task a smaller one; a stopped task nothing at all. Nothing loops
// for attention, and the only randomness is when the next blink falls.
//
// PURE. The renderer owns three.js; this owns timing and choices, and drives a
// `RigAdapter` that tests can record frame by frame.

import type { AgentVisualState, VisualBase } from './visualState.ts';
import { clipFor, gazeLimitsFor, type AgentModelManifest, type VisualGesture } from './registry.ts';
import { dampGaze, GAZE_REST, splitGaze, type GazeAngles, type GazeLimits } from './gaze.ts';

/** What a renderer exposes to be animated. Offsets are in degrees, model space. */
export interface RigAdapter {
  /** Cross-fade the looping base clip; null fades clips out (procedural only). */
  playBase(clip: string | null, fadeSeconds: number): void;
  /** A one-shot clip over the base, returning to it when done. */
  playGesture(clip: string, fadeSeconds: number): void;
  setHead(offset: GazeAngles): void;
  setEyes(offset: GazeAngles): void;
  setChest(pitchDeg: number): void;
  /** 0 = open, 1 = closed. */
  setBlink(amount: number): void;
}

export interface AnimatorInput {
  state: AgentVisualState;
  /** Where the cursor would have the agent look — null when it is not over the card. */
  pointer: GazeAngles | null;
  gesture: { kind: VisualGesture; nonce: number } | null;
}

export interface Posture {
  /** Where the gaze rests with no cursor. */
  gaze: GazeAngles;
  /** How much of the cursor this state answers (0 = none, 1 = fully). */
  attention: number;
  breathPeriodMs: number;
  /** Blink interval range. Concentration blinks less often. */
  blinkMs: readonly [number, number];
}

export const POSTURES: Readonly<Record<VisualBase, Posture>> = Object.freeze({
  idle: { gaze: { yawDeg: 0, pitchDeg: 0 }, attention: 1, breathPeriodMs: 4600, blinkMs: [2800, 6000] },
  // Waiting on you: settled, facing you, a touch more upright.
  awaiting: { gaze: { yawDeg: 0, pitchDeg: 0.5 }, attention: 1, breathPeriodMs: 4600, blinkMs: [2800, 5500] },
  // Held up by setup: neutral and still — no acting out of frustration.
  blocked: { gaze: { yawDeg: 0, pitchDeg: -1 }, attention: 0.8, breathPeriodMs: 4800, blinkMs: [3000, 6000] },
  // Thinking: eyes drift aside and down, slower breath, fewer blinks.
  thinking: { gaze: { yawDeg: -4, pitchDeg: -2.5 }, attention: 0.4, breathPeriodMs: 5200, blinkMs: [4000, 7500] },
  // Working: attention on an off-screen surface below.
  working: { gaze: { yawDeg: 2, pitchDeg: -5 }, attention: 0.35, breathPeriodMs: 4200, blinkMs: [3200, 6500] },
});

export const BREATH_AMPLITUDE_DEG = 0.6;
export const BLINK_MS = 150;
export const NOD = Object.freeze({ durationMs: 700, depthDeg: 3.5 });
/** A completed task's acknowledgement is smaller than a click's. */
export const COMPLETED_NOD_SCALE = 0.7;
export const BASE_FADE_S = 0.7;
export const GESTURE_FADE_S = 0.25;
/** A resumed tab can deliver a frame "lasting" seconds; motion never jumps by more than this. */
export const MAX_STEP_MS = 100;
const POINTER_HALF_LIFE_MS = 150;
const POSTURE_HALF_LIFE_MS = 480;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampGaze(g: GazeAngles, l: GazeLimits): GazeAngles {
  return { yawDeg: clamp(g.yawDeg, -l.maxYawDeg, l.maxYawDeg), pitchDeg: clamp(g.pitchDeg, -l.maxPitchDeg, l.maxPitchDeg) };
}

function lerpGaze(a: GazeAngles, b: GazeAngles, t: number): GazeAngles {
  return { yawDeg: a.yawDeg + (b.yawDeg - a.yawDeg) * t, pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * t };
}

/** Eyelid closure over one blink: quick close, slower open. */
export function blinkCurve(elapsedMs: number): number {
  if (!(elapsedMs > 0) || elapsedMs >= BLINK_MS) return 0;
  const close = BLINK_MS * 0.4;
  return elapsedMs < close ? elapsedMs / close : 1 - (elapsedMs - close) / (BLINK_MS - close);
}

/** Head pitch during a nod (negative = down), easing in and out. */
export function nodCurve(elapsedMs: number, depthDeg: number = NOD.depthDeg): number {
  if (!(elapsedMs > 0) || elapsedMs >= NOD.durationMs) return 0;
  return -depthDeg * Math.sin((Math.PI * elapsedMs) / NOD.durationMs) ** 2;
}

export interface AgentAnimator { update(dtMs: number, input: AnimatorInput): void }

export function createAgentAnimator({ manifest, rig, random = Math.random }: {
  manifest: AgentModelManifest;
  rig: RigAdapter;
  random?: () => number;
}): AgentAnimator {
  const limits = gazeLimitsFor(manifest);
  // A model with its own idle clip already breathes; adding ours would double it.
  const proceduralBreath = !manifest.clips.idle;
  let t = 0;
  let base: VisualBase | null = null;
  let gaze: GazeAngles = GAZE_REST;
  let breathPhase = 0;
  let nextBlinkAt = 0;
  let blinkAt = -Infinity;
  let lastNonce: number | null = null;
  let nodAt = -Infinity;
  let nodDepth = 0;

  const scheduleBlink = (b: VisualBase) => {
    const [lo, hi] = POSTURES[b].blinkMs;
    nextBlinkAt = t + lo + random() * (hi - lo);
  };

  return {
    update(dtMs, input) {
      const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, MAX_STEP_MS);
      t += dt;
      const b = input.state.base;
      const posture = POSTURES[b];

      if (b !== base) {
        rig.playBase(clipFor(manifest, b), base === null ? 0 : BASE_FADE_S);
        if (base === null) scheduleBlink(b);
        base = b;
      }

      const g = input.gesture;
      if (g && g.nonce !== lastNonce) {
        lastNonce = g.nonce;
        const clip = manifest.gestures[g.kind];
        if (clip) rig.playGesture(clip, GESTURE_FADE_S);
        else if (g.kind !== 'stopped') {
          nodAt = t;
          nodDepth = NOD.depthDeg * (g.kind === 'completed' ? COMPLETED_NOD_SCALE : 1);
        }
      }

      const target = input.pointer ? lerpGaze(posture.gaze, clampGaze(input.pointer, limits), posture.attention) : posture.gaze;
      gaze = dampGaze(gaze, clampGaze(target, limits), dt, input.pointer ? POINTER_HALF_LIFE_MS : POSTURE_HALF_LIFE_MS);
      const { head, eyes } = splitGaze(gaze);
      rig.setHead({ yawDeg: head.yawDeg, pitchDeg: head.pitchDeg + nodCurve(t - nodAt, nodDepth) });
      rig.setEyes(eyes);

      // Phase accumulates, so a state change alters the pace without a jump.
      breathPhase = (breathPhase + (2 * Math.PI * dt) / posture.breathPeriodMs) % (2 * Math.PI);
      rig.setChest(proceduralBreath ? BREATH_AMPLITUDE_DEG * Math.sin(breathPhase) : 0);

      if (t >= nextBlinkAt && t - blinkAt >= BLINK_MS) { blinkAt = t; scheduleBlink(b); }
      rig.setBlink(blinkCurve(t - blinkAt));
    },
  };
}
