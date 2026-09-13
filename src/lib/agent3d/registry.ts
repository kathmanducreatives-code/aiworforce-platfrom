// THE 3D MODEL REGISTRY — one entry per public agent, `model: null` until a
// real rigged model exists.
//
// Phase 1 ships every entry empty on purpose: with no model, every surface
// renders the portrait it renders today, and no 3D code is fetched. Dropping
// in Lyra later means adding one manifest here and one renderer loader
// (src/components/agent3d/rendererContract.ts) — the card and its props do
// not change.
//
// Models are served from /public (e.g. /agents/3d/lyra.glb), never bundled:
// a model is fetched only when a surface is allowed to show it.
//
// PURE — data and validation only.

import type { VisualAgentKey, VisualBase } from './visualState.ts';

export type ModelFormat = 'glb' | 'vrm';
export type VisualGesture = 'acknowledge' | 'completed' | 'stopped';

export interface AgentModelManifest {
  format: ModelFormat;
  /** Same-origin path under /public. Remote hosts are refused (CSP, privacy, cost). */
  url: string;
  /** Measured file size. The loader refuses anything over `MODEL_BUDGET_BYTES`. */
  bytes: number;
  /**
   * Bone names the animator drives. The head is required; neck and eyes share
   * the gaze; the chest carries procedural breathing when there is no idle clip.
   */
  rig: { head: string; neck?: string; eyeLeft?: string; eyeRight?: string; chest?: string };
  /** Morph targets (ARKit-52 naming) for procedural blinks. Optional. */
  expressions?: { blinkLeft?: string; blinkRight?: string };
  /**
   * Clip name per continuous state. A missing state falls back to `idle`
   * (or procedural breathing) — never to another state's clip, so a model
   * without a `thinking` clip can look calm but cannot look busy.
   */
  clips: Partial<Record<VisualBase, string>>;
  /** One-shot clip names. Missing gestures are skipped, not substituted. */
  gestures: Partial<Record<VisualGesture, string>>;
  /** Head-and-shoulders camera. Units are the model's (metres for glTF). */
  framing: { target: readonly [number, number, number]; distance: number; fovDeg: number };
  /** Optional tighter gaze limits for this rig; never looser than `GAZE_LIMITS`. */
  gaze?: { maxYawDeg: number; maxPitchDeg: number };
}

export interface Agent3DEntry {
  key: VisualAgentKey;
  model: AgentModelManifest | null;
}

/** Per-model ceiling — compressed geometry and KTX2 textures fit well under it. */
export const MODEL_BUDGET_BYTES = 5 * 1024 * 1024;
/** Restraint, encoded: the head never turns further than this toward the cursor. */
export const GAZE_LIMITS = Object.freeze({ maxYawDeg: 12, maxPitchDeg: 8 });

export const AGENT_3D_REGISTRY: Readonly<Record<VisualAgentKey, Agent3DEntry>> = Object.freeze({
  pilot: { key: 'pilot', model: null },
  // LYRA — the Phase 2 pilot. Empty until her rigged model exists; when it does:
  //   model: { format: 'glb', url: '/agents/3d/lyra.glb', bytes: <measured>,
  //            rig: { head, neck, eyeLeft, eyeRight, chest }, expressions: { blinkLeft, blinkRight },
  //            clips: { idle, thinking, working, awaiting }, gestures: { acknowledge, completed },
  //            framing: { target: [x, y, z], distance, fovDeg } },
  lyra: { key: 'lyra', model: null },
  atlas: { key: 'atlas', model: null },
  mira: { key: 'mira', model: null },
  orion: { key: 'orion', model: null },
});

export function modelFor(key: VisualAgentKey | null | undefined, registry: Readonly<Record<VisualAgentKey, Agent3DEntry>> = AGENT_3D_REGISTRY): AgentModelManifest | null {
  return key ? registry[key]?.model ?? null : null;
}

/** The clip to hold for a state — the state's own, else idle, else none (procedural). */
export function clipFor(manifest: AgentModelManifest, base: VisualBase): string | null {
  return manifest.clips[base] ?? manifest.clips.idle ?? null;
}

/** Problems with a manifest, as sentences. Empty means loadable. */
export function validateManifest(m: AgentModelManifest): string[] {
  const problems: string[] = [];
  if (!/^\/(?!\/)[\w\-./]+\.(glb|vrm)$/i.test(m.url)) problems.push('url must be a same-origin path ending in .glb or .vrm');
  else if (!m.url.toLowerCase().endsWith(`.${m.format}`)) problems.push('url extension does not match format');
  if (!(m.bytes > 0)) problems.push('bytes must be measured');
  else if (m.bytes > MODEL_BUDGET_BYTES) problems.push(`model is ${m.bytes} bytes, over the ${MODEL_BUDGET_BYTES}-byte budget`);
  if (!m.rig.head?.trim()) problems.push('rig.head is required for gaze');
  const g = m.gaze;
  if (g && (g.maxYawDeg > GAZE_LIMITS.maxYawDeg || g.maxPitchDeg > GAZE_LIMITS.maxPitchDeg || g.maxYawDeg < 0 || g.maxPitchDeg < 0)) {
    problems.push('gaze limits may only be tighter than the global limits');
  }
  const f = m.framing;
  if (!(f.distance > 0) || !(f.fovDeg >= 10 && f.fovDeg <= 60) || f.target.some((v) => !Number.isFinite(v))) problems.push('framing is not a sane head-and-shoulders camera');
  return problems;
}

export function gazeLimitsFor(m: AgentModelManifest | null): { maxYawDeg: number; maxPitchDeg: number } {
  return m?.gaze ?? GAZE_LIMITS;
}
