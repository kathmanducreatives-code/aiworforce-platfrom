// THE SEAM A 3D RENDERER PLUGS INTO.
//
// AgentVisual owns every decision — whether 3D is allowed, when it is on
// screen, which state is true, which gesture to play once. A renderer only
// draws: it receives this contract and reports back. Three.js / React Three
// Fiber arrive with the first renderer (Phase 2), inside the lazily loaded
// module below — never in the main bundle, never on a surface that shows a
// portrait.

import type { ComponentType, RefObject } from 'react';
import type { AgentVisualState } from '@/lib/agent3d/visualState';
import type { AgentModelManifest, ModelFormat, VisualGesture } from '@/lib/agent3d/registry';

/** A one-shot to play. A new `nonce` is a new request; the same nonce is not replayed. */
export interface GestureRequest { kind: VisualGesture; nonce: number }

export interface AgentRendererProps {
  manifest: AgentModelManifest;
  /** Truthful state (see visualState.ts). Hold `clipFor(manifest, state.base)`. */
  state: AgentVisualState;
  gesture: GestureRequest | null;
  /** Element whose pointer drives gaze (`pointerToGaze` + `dampGaze`). */
  trackRef?: RefObject<HTMLElement>;
  /** False while off screen or in a hidden tab: stop the frame loop entirely. */
  active: boolean;
  /** Called once the first frame is drawn — the poster then fades out. */
  onReady: () => void;
  /** Load or runtime failure: the portrait comes back and stays. */
  onFailure: (reason: string) => void;
  /** Frame budget blown (`createFrameBudget`): portraits for the rest of the session. */
  onDegrade: () => void;
}

export type AgentRendererModule = { default: ComponentType<AgentRendererProps> };

/**
 * One loader per model format, each a dynamic import so three.js stays in its
 * own chunk. A loader is only ever called for an agent whose registry entry
 * has a valid manifest on a surface that passed every capability check — with
 * no manifest (today, every agent), nothing here is fetched.
 *
 * `vrm` has no renderer yet; a VRM manifest therefore falls back to the portrait.
 */
export const RENDERER_LOADERS: Partial<Record<ModelFormat, () => Promise<AgentRendererModule>>> = {
  glb: () => import('./GltfAgentRenderer'),
};
