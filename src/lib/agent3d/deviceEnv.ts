// The browser side of `capability.ts`: reads the environment it decides on.
// Every access is guarded — storage can throw (private windows, blocked site
// data) and older browsers lack deviceMemory / connection — and a missing
// signal reads as "unknown", never as "capable".

import type { DeviceEnv } from './capability.ts';

const DISABLED_KEY = 'agentory.agent3d.disabled';
const DEGRADED_KEY = 'agentory.agent3d.degraded';

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

function matches(query: string): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches; } catch { return false; }
}

function flag(storage: () => Storage, key: string): boolean {
  try { return storage().getItem(key) === '1'; } catch { return false; }
}

export function readDeviceEnv(): DeviceEnv {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as NavigatorHints;
  return {
    reducedMotion: matches('(prefers-reduced-motion: reduce)'),
    saveData: !!nav.connection?.saveData,
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    cores: typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 ? nav.hardwareConcurrency : null,
    coarsePointer: matches('(pointer: coarse)'),
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
    disabledByUser: flag(() => localStorage, DISABLED_KEY),
    degraded: flag(() => sessionStorage, DEGRADED_KEY),
  };
}

let webgl2: boolean | null = null;

/**
 * Once per page: can this device run WebGL2 without a major performance
 * caveat (software rendering)? The probe context is released immediately.
 */
export function probeWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true, powerPreference: 'low-power' });
    webgl2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/** A renderer that blew its frame budget: portraits for the rest of this session. */
export function markDegraded(): void {
  try { sessionStorage.setItem(DEGRADED_KEY, '1'); } catch { /* storage blocked — the in-memory decision still holds */ }
}

/** The media queries whose change should re-run the decision. */
export const CAPABILITY_QUERIES = ['(prefers-reduced-motion: reduce)', '(pointer: coarse)', '(min-width: 900px)'] as const;
