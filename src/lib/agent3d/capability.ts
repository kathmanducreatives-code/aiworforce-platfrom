// WHEN A SURFACE MAY RENDER AN AGENT IN 3D — AND, MORE OFTEN, WHY IT MAY NOT.
//
// The portrait is the default everywhere. A 3D model is an upgrade a surface
// earns only when every one of these holds: the surface opts in, a model and a
// renderer for its format exist, the viewer has not asked for less motion or
// less data, and the device can carry it. The cheap checks run first; the
// WebGL2 probe (which creates a context) runs last and only if everything else
// already passed.
//
// PURE. The environment is an input, and the probe is injected.

export type VisualSurface = 'home' | 'agent' | 'inline';

export type PortraitReason =
  | 'surface' | 'no-model' | 'no-renderer' | 'disabled' | 'degraded'
  | 'reduced-motion' | 'save-data' | 'low-memory' | 'low-cpu' | 'touch' | 'narrow' | 'no-webgl2';

export type RenderDecision = { tier: 'portrait'; reason: PortraitReason } | { tier: 'model' };

export interface DeviceEnv {
  reducedMotion: boolean;
  saveData: boolean;
  /** navigator.deviceMemory (GB, coarse) — null where the browser does not say. */
  deviceMemoryGb: number | null;
  cores: number | null;
  /** Primary input is touch: no hover, so no gaze to follow. */
  coarsePointer: boolean;
  viewportWidth: number;
  /** The viewer turned 3D off. */
  disabledByUser: boolean;
  /** A frame-budget monitor already downgraded this session. */
  degraded: boolean;
}

/** Surfaces that may show a model at all. Inline avatars never do. */
export const MODEL_SURFACES: readonly VisualSurface[] = ['home', 'agent'];
export const MIN_DEVICE_MEMORY_GB = 4;
export const MIN_CORES = 4;
/** Below this the gallery is two columns; portraits read better than small models. */
export const MIN_VIEWPORT_PX = 900;

export function chooseRenderTier(input: {
  surface: VisualSurface;
  hasModel: boolean;
  hasRenderer: boolean;
  env: DeviceEnv;
  probeWebGL2: () => boolean;
}): RenderDecision {
  const { surface, hasModel, hasRenderer, env } = input;
  const portrait = (reason: PortraitReason): RenderDecision => ({ tier: 'portrait', reason });
  if (!MODEL_SURFACES.includes(surface)) return portrait('surface');
  if (!hasModel) return portrait('no-model');
  if (!hasRenderer) return portrait('no-renderer');
  if (env.disabledByUser) return portrait('disabled');
  if (env.degraded) return portrait('degraded');
  if (env.reducedMotion) return portrait('reduced-motion');
  if (env.saveData) return portrait('save-data');
  if (env.deviceMemoryGb !== null && env.deviceMemoryGb < MIN_DEVICE_MEMORY_GB) return portrait('low-memory');
  if (env.cores !== null && env.cores < MIN_CORES) return portrait('low-cpu');
  if (env.coarsePointer) return portrait('touch');
  if (env.viewportWidth < MIN_VIEWPORT_PX) return portrait('narrow');
  if (!input.probeWebGL2()) return portrait('no-webgl2');
  return { tier: 'model' };
}

// ── runtime frame budget ───────────────────────────────────────────────────

export interface FrameBudget {
  /** Feed one frame's duration; returns 'degrade' once the budget is persistently blown. */
  record(frameMs: number): 'ok' | 'degrade';
}

/**
 * Downgrades on SUSTAINED slowness, never on a spike. Once a full window has
 * been observed, if more than `tolerance` of its frames took longer than
 * `budgetMs`, the model gives way to the portrait for the rest of the session.
 * Hidden-tab gaps (a frame "lasting" seconds) are ignored — they measure the
 * browser's throttling, not the model.
 */
export function createFrameBudget({ budgetMs = 25, windowSize = 90, tolerance = 0.25, ignoreAboveMs = 500 } = {}): FrameBudget {
  const recent: boolean[] = [];
  let slow = 0;
  let tripped = false;
  return {
    record(frameMs: number) {
      if (tripped) return 'degrade';
      if (!(frameMs > 0) || frameMs > ignoreAboveMs) return 'ok';
      const isSlow = frameMs > budgetMs;
      recent.push(isSlow);
      if (isSlow) slow++;
      if (recent.length > windowSize && recent.shift()) slow--;
      if (recent.length === windowSize && slow / windowSize > tolerance) tripped = true;
      return tripped ? 'degrade' : 'ok';
    },
  };
}
