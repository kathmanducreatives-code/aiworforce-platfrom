import { Component, forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import AgentPortrait from '@/components/agents/AgentPortrait';
import { IDLE_VISUAL, visualAgentKey, type AgentVisualState } from '@/lib/agent3d/visualState';
import { modelFor, validateManifest } from '@/lib/agent3d/registry';
import { chooseRenderTier, type RenderDecision, type VisualSurface } from '@/lib/agent3d/capability';
import { CAPABILITY_QUERIES, markDegraded, probeWebGL2, readDeviceEnv } from '@/lib/agent3d/deviceEnv';
import { RENDERER_LOADERS, type AgentRendererProps, type GestureRequest } from './rendererContract';

export interface AgentVisualHandle {
  /** A click was acknowledged. Plays a small nod on a model; a portrait does nothing. */
  acknowledge: () => void;
}

export interface AgentVisualProps {
  /** Any agent identifier — public id, legacy slug or display name. */
  agentId: string;
  /** Truthful state from `useAgentVisualStates`. Missing reads as idle. */
  state?: AgentVisualState | null;
  /** Where this renders. Only 'home' and 'agent' may ever show a model. */
  surface: VisualSurface;
  /** Element whose pointer drives the model's gaze — usually the card. */
  trackRef?: RefObject<HTMLElement>;
  /**
   * What renders whenever a model does not: today, always. Defaults to the
   * shared AgentPortrait; the home cards pass their own full-bleed image so
   * they look exactly as they did.
   */
  fallback?: ReactNode;
  /** Applied to the model's stage (the portrait path renders `fallback` untouched). */
  className?: string;
}

// A finish is acknowledged once per task, not once per mount: navigating away
// and back must not replay "completed" for work the user already saw finish.
const acknowledgedEvents = new Set<string>();

/**
 * THE ONE PLACE AN AGENT'S FACE IS CHOSEN.
 *
 * Every surface that may one day show a 3D agent renders this instead of an
 * image. It decides portrait vs model (capability.ts), and for a model it
 * lazy-loads the renderer only when on screen, keeps the portrait as a poster
 * until the first frame, and falls back to it for good on any failure.
 *
 * Phase 1: the registry has no models, so this renders `fallback` directly —
 * no wrapper element, no listeners, no probe. Visually identical to before.
 */
const AgentVisual = forwardRef<AgentVisualHandle, AgentVisualProps>(function AgentVisual(
  { agentId, state, surface, trackRef, fallback, className }, ref,
) {
  const key = visualAgentKey(agentId);
  const manifest = modelFor(key);
  const loader = manifest ? RENDERER_LOADERS[manifest.format] : undefined;
  const eligible = !!manifest && !!loader && validateManifest(manifest).length === 0;
  const decision = useRenderDecision(surface, eligible);
  const [failed, setFailed] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [gesture, setGesture] = useState<GestureRequest | null>(null);
  const showModel = decision.tier === 'model' && !failed;

  useImperativeHandle(ref, () => ({
    acknowledge: () => { if (showModel) setGesture((g) => ({ kind: 'acknowledge', nonce: (g?.nonce ?? 0) + 1 })); },
  }), [showModel]);

  const event = state?.event;
  useEffect(() => {
    if (!showModel || !modelReady || !event || acknowledgedEvents.has(event.key)) return;
    acknowledgedEvents.add(event.key);
    setGesture((g) => ({ kind: event.kind === 'completed' ? 'completed' : 'stopped', nonce: (g?.nonce ?? 0) + 1 }));
  }, [showModel, modelReady, event]);

  const poster = fallback ?? <AgentPortrait agentId={agentId} decorative />;
  if (!showModel || !manifest || !loader) return <>{poster}</>;
  return <ModelStage className={className} poster={poster} loader={loader} rendererProps={{ manifest, state: state ?? IDLE_VISUAL, gesture, trackRef }} onReady={() => setModelReady(true)} onFailure={() => setFailed(true)} />;
});

export default AgentVisual;

/** Portrait unless every capability check passes; re-evaluated when the viewer's settings change. */
function useRenderDecision(surface: VisualSurface, eligible: boolean): RenderDecision {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!eligible || typeof window === 'undefined' || !window.matchMedia) return;
    const lists = CAPABILITY_QUERIES.map((q) => window.matchMedia(q));
    const bump = () => setVersion((v) => v + 1);
    lists.forEach((l) => l.addEventListener?.('change', bump));
    return () => lists.forEach((l) => l.removeEventListener?.('change', bump));
  }, [eligible]);
  return useMemo(
    () => eligible
      ? chooseRenderTier({ surface, hasModel: true, hasRenderer: true, env: readDeviceEnv(), probeWebGL2 })
      : { tier: 'portrait', reason: 'no-model' },
    // `version` re-reads the environment after a media-query change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, eligible, version],
  );
}

type Loader = NonNullable<(typeof RENDERER_LOADERS)[keyof typeof RENDERER_LOADERS]>;

function ModelStage({ className, poster, loader, rendererProps, onFailure, onReady }: {
  className?: string;
  poster: ReactNode;
  loader: Loader;
  rendererProps: Omit<AgentRendererProps, 'active' | 'onReady' | 'onFailure' | 'onDegrade'>;
  onFailure: () => void;
  onReady: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const Renderer = useMemo(() => lazy(loader), [loader]);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(el);
    const onVis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Mounted on first sight, then kept (paused) — re-parsing a model on every scroll is worse than holding it.
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (inView) setSeen(true); }, [inView]);

  return <div ref={stage} className={className} data-render-tier="model" style={{ position: 'absolute', inset: 0 }}>
    <div aria-hidden style={{ position: 'absolute', inset: 0, opacity: ready ? 0 : 1, transition: 'opacity .6s ease' }}>{poster}</div>
    {seen && <RendererBoundary onError={onFailure}>
      <Suspense fallback={null}>
        <Renderer {...rendererProps} active={inView && visible} onReady={() => { setReady(true); onReady(); }} onFailure={onFailure} onDegrade={() => { markDegraded(); onFailure(); }} />
      </Suspense>
    </RendererBoundary>}
  </div>;
}

class RendererBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.warn('[AgentVisual] renderer failed; showing the portrait', error);
    this.props.onError();
  }
  render() { return this.state.failed ? null : this.props.children; }
}
