import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createAgentAnimator, type RigAdapter } from '@/lib/agent3d/animationController';
import { createFrameBudget } from '@/lib/agent3d/capability';
import { GAZE_REST, pointerToGaze, type GazeAngles } from '@/lib/agent3d/gaze';
import { gazeLimitsFor, type AgentModelManifest } from '@/lib/agent3d/registry';
import type { AgentRendererProps } from './rendererContract';

/**
 * THE glTF RENDERER — the only module that imports three.js.
 *
 * Loaded lazily by AgentVisual (see RENDERER_LOADERS), so three.js lives in its
 * own chunk and is fetched only when a surface is allowed to show a model. The
 * portrait stays on screen until this reports its first frame, and any failure
 * — WebGL, network, a missing bone, a lost context — hands the card back to it.
 *
 * It draws and nothing else: the animation choices come from
 * animationController.ts, the state from the Phase 1 visual-state model.
 */
export default function GltfAgentRenderer(props: AgentRendererProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const stage = useRef<Stage | null>(null);
  const { manifest, active } = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let s: Stage;
    try {
      s = createStage(el, manifest, latest);
    } catch (e) {
      latest.current.onFailure(`webgl: ${describe(e)}`);
      return;
    }
    stage.current = s;
    if (latest.current.active) s.start();
    s.load().catch((e) => { if (!s.disposed) latest.current.onFailure(`model: ${describe(e)}`); });
    return () => { stage.current = null; s.dispose(); };
  }, [manifest]);

  useEffect(() => { if (active) stage.current?.start(); else stage.current?.stop(); }, [active]);

  return <div ref={host} aria-hidden style={{ position: 'absolute', inset: 0 }} />;
}

interface Stage { start(): void; stop(): void; load(): Promise<void>; dispose(): void; readonly disposed: boolean }

const DEG = Math.PI / 180;
/** Without the cursor over the card the model renders at ~30 fps; hover gets the display's rate. */
const RESTING_FRAME_MS = 32;

function createStage(el: HTMLElement, manifest: AgentModelManifest, latest: MutableRefObject<AgentRendererProps>): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
  el.appendChild(canvas);

  // Lit like the portraits: warm key from the front-left, emerald rim behind.
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe4f2ea, 0x09110d, 0.8));
  const key = new THREE.DirectionalLight(0xfff0e2, 2.0);
  key.position.set(-1.1, 2.1, 2.2);
  const rim = new THREE.DirectionalLight(0x9ee8c3, 1.3);
  rim.position.set(1.5, 1.9, -1.6);
  scene.add(key, rim);

  const f = manifest.framing;
  const target = new THREE.Vector3(...f.target);
  const camera = new THREE.PerspectiveCamera(f.fovDeg, 1, 0.05, 50);
  camera.position.set(target.x, target.y, target.z + f.distance);
  camera.lookAt(target);

  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  let disposed = false;
  let wanted = false;
  let raf = 0;
  let tick: ((now: number) => void) | null = null;
  let detach = () => {};
  let mixer: THREE.AnimationMixer | null = null;

  const begin = () => { if (wanted && tick && !raf && !disposed) raf = requestAnimationFrame(tick); };
  const halt = () => { cancelAnimationFrame(raf); raf = 0; };
  const onContextLost = (e: Event) => { e.preventDefault(); wanted = false; halt(); latest.current.onFailure('webgl context lost'); };
  canvas.addEventListener('webglcontextlost', onContextLost);

  return {
    get disposed() { return disposed; },
    start() { wanted = true; begin(); },
    stop() { wanted = false; halt(); },
    async load() {
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(manifest.url);
      if (disposed) { disposeTree(gltf.scene); return; }
      const model = gltf.scene;
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      const rig = createRig(model, gltf.animations, mixer, manifest);
      const animator = createAgentAnimator({ manifest, rig });
      const budget = createFrameBudget();
      const limits = gazeLimitsFor(manifest);

      let pointer: GazeAngles | null = null;
      const track = latest.current.trackRef?.current ?? null;
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse' || !track) return;
        pointer = pointerToGaze(e.clientX, e.clientY, track.getBoundingClientRect(), limits);
      };
      const onLeave = () => { pointer = null; };
      track?.addEventListener('pointermove', onMove);
      track?.addEventListener('pointerleave', onLeave);
      detach = () => { track?.removeEventListener('pointermove', onMove); track?.removeEventListener('pointerleave', onLeave); };

      let lastFrame = 0, lastRender = 0, ready = false;
      tick = (now) => {
        raf = requestAnimationFrame(tick!);
        // The budget watches the display's frame interval, not ours: a device
        // that cannot keep up stretches every rAF, capped or not.
        const frameMs = lastFrame ? now - lastFrame : 16;
        lastFrame = now;
        if (budget.record(frameMs) === 'degrade') { wanted = false; halt(); latest.current.onDegrade(); return; }
        if (!pointer && lastRender && now - lastRender < RESTING_FRAME_MS) return;
        const dt = lastRender ? now - lastRender : 16;
        lastRender = now;
        const p = latest.current;
        rig.reset();
        mixer!.update(dt / 1000);
        animator.update(dt, { state: p.state, pointer, gesture: p.gesture });
        rig.apply();
        renderer.render(scene, camera);
        if (!ready) { ready = true; p.onReady(); }
      };
      begin();
    },
    dispose() {
      disposed = true;
      wanted = false;
      halt();
      detach();
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      mixer?.stopAllAction();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

// ── the rig: bones and morphs the animator drives ─────────────────────────

const _parent = new THREE.Quaternion();
const _root = new THREE.Quaternion();
const _offset = new THREE.Quaternion();
const _inverse = new THREE.Quaternion();
const _euler = new THREE.Euler();

/**
 * Turn a bone by yaw/pitch expressed in the MODEL's frame (glTF: +Y up, facing
 * +Z toward the camera), whatever the bone's own local axes are:
 *   local' = P⁻¹ · offset · P · local, with P the parent's rotation in model space.
 * Positive yaw turns toward screen right; positive pitch looks up.
 */
function turnInModelSpace(bone: THREE.Object3D, model: THREE.Object3D, yawDeg: number, pitchDeg: number) {
  if ((!yawDeg && !pitchDeg) || !bone.parent) return;
  model.getWorldQuaternion(_root).invert();
  bone.parent.getWorldQuaternion(_parent).premultiply(_root);
  _offset.setFromEuler(_euler.set(-pitchDeg * DEG, yawDeg * DEG, 0, 'YXZ'));
  _inverse.copy(_parent).invert();
  bone.quaternion.premultiply(_parent).premultiply(_offset).premultiply(_inverse);
}

function createRig(model: THREE.Object3D, clips: THREE.AnimationClip[], mixer: THREE.AnimationMixer, manifest: AgentModelManifest): RigAdapter & { reset(): void; apply(): void } {
  const find = (name?: string) => (name ? model.getObjectByName(name) ?? null : null);
  const head = find(manifest.rig.head);
  if (!head) throw new Error(`head bone "${manifest.rig.head}" not found`);
  const neck = find(manifest.rig.neck), chest = find(manifest.rig.chest);
  const eyes = [find(manifest.rig.eyeLeft), find(manifest.rig.eyeRight)].filter((b): b is THREE.Object3D => !!b);
  // Rest pose of every driven bone: restored before the mixer runs, so a bone
  // no clip animates does not accumulate offsets frame after frame.
  const rest = new Map([chest, neck, head, ...eyes].filter((b): b is THREE.Object3D => !!b).map((b) => [b, b.quaternion.clone()]));

  const blinkTargets: { influences: number[]; index: number }[] = [];
  const blinkNames = [manifest.expressions?.blinkLeft, manifest.expressions?.blinkRight].filter((n): n is string => !!n);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
    for (const name of blinkNames) {
      const index = mesh.morphTargetDictionary[name];
      if (index !== undefined) blinkTargets.push({ influences: mesh.morphTargetInfluences, index });
    }
  });

  const actionFor = (name: string) => {
    const clip = THREE.AnimationClip.findByName(clips, name);
    return clip ? mixer.clipAction(clip) : null;
  };
  let base: THREE.AnimationAction | null = null;
  let gesture: { action: THREE.AnimationAction; returnAt: number; fade: number } | null = null;
  let head$: GazeAngles = GAZE_REST, eyes$: GazeAngles = GAZE_REST, chest$ = 0, blink$ = 0;

  return {
    playBase(name, fade) {
      const next = name ? actionFor(name) : null;
      if (next === base) return;
      if (next) {
        next.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        if (base) base.crossFadeTo(next, fade, false);
        else next.fadeIn(fade);
      } else base?.fadeOut(fade);
      base = next;
    },
    playGesture(name, fade) {
      const action = actionFor(name);
      if (!action) return;
      action.reset().setLoop(THREE.LoopOnce, 1).play();
      if (base) base.crossFadeTo(action, fade, false);
      else action.fadeIn(fade);
      gesture = { action, returnAt: Math.max(0, action.getClip().duration - fade), fade };
    },
    setHead(o) { head$ = o; },
    setEyes(o) { eyes$ = o; },
    setChest(p) { chest$ = p; },
    setBlink(a) { blink$ = a; },
    reset() {
      for (const [bone, q] of rest) bone.quaternion.copy(q);
      // Hand back to the base clip just before the gesture ends, so it never snaps.
      if (gesture && gesture.action.time >= gesture.returnAt) {
        const { action, fade } = gesture;
        if (base) { base.reset().play(); action.crossFadeTo(base, fade, false); } else action.fadeOut(fade);
        gesture = null;
      }
    },
    apply() {
      // Parents before children, so each turn composes with the one above it.
      if (chest) turnInModelSpace(chest, model, 0, chest$);
      const neckShare = neck ? 0.4 : 0;
      if (neck) turnInModelSpace(neck, model, head$.yawDeg * neckShare, head$.pitchDeg * neckShare);
      turnInModelSpace(head, model, head$.yawDeg * (1 - neckShare), head$.pitchDeg * (1 - neckShare));
      for (const eye of eyes) turnInModelSpace(eye, model, eyes$.yawDeg, eyes$.pitchDeg);
      for (const t of blinkTargets) t.influences[t.index] = blink$;
    },
  };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
