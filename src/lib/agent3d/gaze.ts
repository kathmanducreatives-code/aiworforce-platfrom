// CURSOR → HEAD AND EYES, WITH RESTRAINT.
//
// The renderer asks "where should the head be looking?" every frame. The
// answer is the pointer's position over the card, mapped into a small cone
// (±12° yaw, ±8° pitch by default) and approached with frame-rate-independent
// damping, so the head eases toward the cursor and settles back to centre when
// it leaves — never snaps, never overshoots.
//
// PURE. Pointer events and the animation loop live in the renderer.

export interface GazeAngles { yawDeg: number; pitchDeg: number }
export interface GazeLimits { maxYawDeg: number; maxPitchDeg: number }
export interface Box { left: number; top: number; width: number; height: number }

export const GAZE_REST: GazeAngles = Object.freeze({ yawDeg: 0, pitchDeg: 0 });

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pointer over a box → the angles the head should turn to. The box centre is
 * straight ahead; the edges are the limits. Pointer right → positive yaw,
 * pointer up → positive pitch (looking up). Outside the box clamps to the edge.
 */
export function pointerToGaze(clientX: number, clientY: number, box: Box, limits: GazeLimits): GazeAngles {
  if (!(box.width > 0) || !(box.height > 0)) return GAZE_REST;
  const x = clamp(((clientX - box.left) / box.width) * 2 - 1, -1, 1);
  const y = clamp(((clientY - box.top) / box.height) * 2 - 1, -1, 1);
  return { yawDeg: x * limits.maxYawDeg, pitchDeg: -y * limits.maxPitchDeg };
}

/**
 * Exponential approach with a half-life: after `halfLifeMs` the remaining
 * distance halves, whatever the frame rate. Two 8 ms steps land where one
 * 16 ms step does, so 60 Hz and 120 Hz screens move the head identically.
 */
export function dampToward(current: number, target: number, dtMs: number, halfLifeMs: number): number {
  if (!(dtMs > 0)) return current;
  if (!(halfLifeMs > 0)) return target;
  return target + (current - target) * Math.pow(0.5, dtMs / halfLifeMs);
}

export function dampGaze(current: GazeAngles, target: GazeAngles, dtMs: number, halfLifeMs = 140): GazeAngles {
  return {
    yawDeg: dampToward(current.yawDeg, target.yawDeg, dtMs, halfLifeMs),
    pitchDeg: dampToward(current.pitchDeg, target.pitchDeg, dtMs, halfLifeMs),
  };
}

/** Eyes lead, the head follows part of the way — how people actually look at things. */
export function splitGaze(g: GazeAngles, headShare = 0.6): { head: GazeAngles; eyes: GazeAngles } {
  const s = clamp(headShare, 0, 1);
  return {
    head: { yawDeg: g.yawDeg * s, pitchDeg: g.pitchDeg * s },
    eyes: { yawDeg: g.yawDeg * (1 - s), pitchDeg: g.pitchDeg * (1 - s) },
  };
}
