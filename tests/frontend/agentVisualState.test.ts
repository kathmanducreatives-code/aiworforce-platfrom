// PHASE 1 OF THE 3D WORKFORCE — WHAT AN AGENT'S FACE MAY CLAIM.
//
// A visual state is a claim about the backend: "Lyra is working" says a task
// is running right now. These tests pin that every such claim rests on live
// execution records — a fresh `running` task, a pending approval attributed by
// id, a reply being produced, a plan being planned — and that counts, stale
// rows, checkpoints, guesses from titles and unknown slugs claim nothing.
//
// They also pin the fallback system (portrait unless every capability check
// passes, and always in Phase 1), the restraint limits of the gaze, and that
// no 3D code is in the build yet.
//
// PURE. No network, no React render, no database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anyAgentWorking, attributeApprovals, deriveAgentVisualStates, EVENT_WINDOW_MS, LEGACY_SLUG_TO_VISUAL,
  nextVisualExpiry, PLANNING_FRESH_MS, RUNNING_FRESH_MS, taskPhase, VISUAL_AGENT_KEYS, visualAgentKey,
  type LiveSnapshot, type LiveTask,
} from "../../src/lib/agent3d/visualState.ts";
import {
  AGENT_3D_REGISTRY, clipFor, GAZE_LIMITS, MODEL_BUDGET_BYTES, modelFor, validateManifest, type AgentModelManifest,
} from "../../src/lib/agent3d/registry.ts";
import { chooseRenderTier, createFrameBudget, type DeviceEnv } from "../../src/lib/agent3d/capability.ts";
import { dampToward, pointerToGaze, splitGaze } from "../../src/lib/agent3d/gaze.ts";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const snap = (p: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ now: NOW, tasks: [], approvals: [], chat: null, plans: [], ...p });
const task = (p: Partial<LiveTask> = {}): LiveTask => ({ id: "t1", agentSlug: "scout", status: "running", updatedAt: ago(60_000), ...p });
const read = (path: string) => Deno.readTextFileSync(new URL(`../../${path}`, import.meta.url));

// ── truthfulness: what counts as evidence ─────────────────────────────────

Deno.test("no live evidence: every agent is idle, with no event", () => {
  const s = deriveAgentVisualStates(snap());
  for (const k of VISUAL_AGENT_KEYS) {
    assertEquals(s[k].base, "idle");
    assertEquals(s[k].event, null);
    assertEquals(s[k].source, "none");
  }
  assertFalse(anyAgentWorking(s));
});

Deno.test("a fresh running task makes its agent working — and only that agent", () => {
  const s = deriveAgentVisualStates(snap({ tasks: [task()] }));
  assertEquals(s.lyra.base, "working");
  assertEquals(s.lyra.source, "task");
  for (const k of ["pilot", "atlas", "mira", "orion"] as const) assertEquals(s[k].base, "idle");
  assert(anyAgentWorking(s));
});

Deno.test("a running row nobody has touched past the freshness window is stale, not working", () => {
  const s = deriveAgentVisualStates(snap({ tasks: [task({ updatedAt: ago(RUNNING_FRESH_MS + 1_000) })] }));
  assertEquals(s.lyra.base, "idle");
  assertEquals(s.lyra.reason, "Last run went quiet");
});

Deno.test("a running row with no timestamps at all proves nothing", () => {
  const s = deriveAgentVisualStates(snap({ tasks: [task({ updatedAt: null, startedAt: null, createdAt: null })] }));
  assertEquals(s.lyra.base, "idle");
});

Deno.test("queued is not working, and a checkpoint (ready / partial) is neither working nor completed", () => {
  for (const status of ["pending", "ready", "partial"]) {
    const s = deriveAgentVisualStates(snap({ tasks: [task({ status, finishedAt: ago(5_000) })] }));
    assertEquals(s.lyra.base, "idle", status);
    assertEquals(s.lyra.event, null, status);
  }
});

Deno.test("a recent finish is one event keyed by its task; legacy spellings normalise; an old finish is not news", () => {
  for (const status of ["complete", "completed", "done"]) {
    const s = deriveAgentVisualStates(snap({ tasks: [task({ id: "t7", status, finishedAt: ago(30_000) })] }));
    assertEquals(s.lyra.base, "idle", status);
    assertEquals(s.lyra.event?.kind, "completed", status);
    assertEquals(s.lyra.event?.key, "completed:t7", status);
  }
  const old = deriveAgentVisualStates(snap({ tasks: [task({ status: "complete", finishedAt: ago(EVENT_WINDOW_MS + 1_000) })] }));
  assertEquals(old.lyra.event, null);
});

Deno.test("failures and refusals are recorded as their own events and are never celebrated", () => {
  const failed = deriveAgentVisualStates(snap({ tasks: [task({ status: "failed", finishedAt: ago(10_000) })] }));
  assertEquals(failed.lyra.event?.kind, "failed");
  const declined = deriveAgentVisualStates(snap({ tasks: [task({ status: "blocked", finishedAt: ago(10_000) })] }));
  assertEquals(declined.lyra.event?.kind, "declined");
  assertEquals(declined.lyra.base, "idle");
});

Deno.test("the most recent finish wins when several are in the window", () => {
  const s = deriveAgentVisualStates(snap({ tasks: [
    task({ id: "older", status: "complete", finishedAt: ago(90_000) }),
    task({ id: "newer", status: "failed", finishedAt: ago(20_000) }),
  ] }));
  assertEquals(s.lyra.event?.key, "failed:newer");
});

Deno.test("identity: hawk and aria are both Atlas; unknown slugs are attributed to nobody", () => {
  const s = deriveAgentVisualStates(snap({ tasks: [task({ agentSlug: "hawk" }), task({ id: "t2", agentSlug: "mystery-bot" })] }));
  assertEquals(s.atlas.base, "working");
  assertEquals(VISUAL_AGENT_KEYS.filter((k) => s[k].base === "working"), ["atlas"]);
  assertEquals(visualAgentKey("aria"), "atlas");
  assertEquals(visualAgentKey(" Scout "), "lyra");
  assertEquals(visualAgentKey("Lyra"), "lyra");
  assertEquals(visualAgentKey("mystery-bot"), null);
  assertEquals(visualAgentKey(null), null);
});

Deno.test("approvals are attributed by agent id, then by task — never by their wording", () => {
  const attributed = attributeApprovals(
    [
      { id: "a1", agent_id: "uuid-penn", title: "anything" },
      { id: "a2", task_id: "t9" },
      { id: "a3", title: "Draft outreach email for Mira" },
    ],
    { "uuid-penn": "penn" },
    { t9: "scribe" },
  );
  assertEquals(attributed.map((a) => a.agentSlug), ["penn", "scribe", null]);
  const s = deriveAgentVisualStates(snap({ approvals: attributed }));
  assertEquals(s.mira.base, "awaiting");
  assertEquals(s.orion.base, "awaiting");
  assertEquals(s.mira.source, "approval");
  assertEquals(s.lyra.base, "idle");
  assertEquals(s.pilot.base, "idle");
});

Deno.test("a reply being produced makes that chat's agent think; an unknown chat claims nothing", () => {
  assertEquals(deriveAgentVisualStates(snap({ chat: { agentSlug: "penn", awaitingReply: true } })).mira.base, "thinking");
  const unknown = deriveAgentVisualStates(snap({ chat: { agentSlug: null, awaitingReply: true } }));
  assertEquals(VISUAL_AGENT_KEYS.filter((k) => unknown[k].base !== "idle"), []);
  assertEquals(deriveAgentVisualStates(snap({ chat: { agentSlug: "penn", awaitingReply: false } })).mira.base, "idle");
});

Deno.test("only a fresh plan in `planning` makes Pilot think", () => {
  assertEquals(deriveAgentVisualStates(snap({ plans: [{ id: "p", status: "planning", createdAt: ago(20_000) }] })).pilot.base, "thinking");
  assertEquals(deriveAgentVisualStates(snap({ plans: [{ id: "p", status: "planning", createdAt: ago(PLANNING_FRESH_MS + 1) }] })).pilot.base, "idle");
  assertEquals(deriveAgentVisualStates(snap({ plans: [{ id: "p", status: "executing", createdAt: ago(1_000) }] })).pilot.base, "idle");
});

Deno.test("priority: working > thinking > awaiting > blocked, and a running task beats a setup gate", () => {
  const all = deriveAgentVisualStates(snap({
    tasks: [task()],
    approvals: [{ id: "a", agentSlug: "scout" }],
    chat: { agentSlug: "scout", awaitingReply: true },
  }));
  assertEquals(all.lyra.base, "working");
  const thinkingOverAwaiting = deriveAgentVisualStates(snap({ approvals: [{ id: "a", agentSlug: "scout" }], chat: { agentSlug: "scout", awaitingReply: true } }));
  assertEquals(thinkingOverAwaiting.lyra.base, "thinking");
  const gate = { atlas: "Needs your Company Brain" };
  assertEquals(deriveAgentVisualStates(snap({ setupBlocked: gate })).atlas.base, "blocked");
  assertEquals(deriveAgentVisualStates(snap({ setupBlocked: gate })).atlas.source, "setup");
  assertEquals(deriveAgentVisualStates(snap({ setupBlocked: gate, tasks: [task({ agentSlug: "aria" })] })).atlas.base, "working");
  assertEquals(deriveAgentVisualStates(snap({ setupBlocked: gate, approvals: [{ id: "a", agentSlug: "aria" }] })).atlas.base, "awaiting");
  assertEquals(deriveAgentVisualStates(snap({ setupBlocked: {} })).atlas.base, "idle");
});

Deno.test("task lifecycle table", () => {
  const table: Record<string, string> = {
    running: "active", pending: "queued", awaiting_approval: "awaiting", complete: "succeeded", completed: "succeeded",
    done: "succeeded", failed: "failed", blocked: "declined", ready: "checkpoint", partial: "checkpoint", skipped: "ignored", "": "ignored",
  };
  for (const [status, phase] of Object.entries(table)) assertEquals(taskPhase(status), phase, status);
  assertEquals(taskPhase(null), "ignored");
});

Deno.test("time-driven changes get one timer at the earliest edge, and none when nothing will change", () => {
  assertEquals(nextVisualExpiry(snap()), null);
  const s = snap({ tasks: [task({ updatedAt: ago(60_000) }), task({ id: "t2", agentSlug: "penn", status: "complete", finishedAt: ago(30_000) })] });
  assertEquals(nextVisualExpiry(s), NOW - 30_000 + EVENT_WINDOW_MS + 1);
  const runningOnly = snap({ tasks: [task({ updatedAt: ago(60_000) })] });
  assertEquals(nextVisualExpiry(runningOnly), NOW - 60_000 + RUNNING_FRESH_MS + 1);
  // Past the edge, the same data derives the changed state.
  assertEquals(deriveAgentVisualStates({ ...runningOnly, now: nextVisualExpiry(runningOnly)! }).lyra.base, "idle");
});

Deno.test("the slug alias map mirrors LEGACY_TO_PUBLIC in agentRegistry.ts", () => {
  const src = read("src/config/agentRegistry.ts");
  const block = src.slice(src.indexOf("export const LEGACY_TO_PUBLIC"), src.indexOf("};", src.indexOf("export const LEGACY_TO_PUBLIC")));
  const pairs = Object.fromEntries([...block.matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
  assertEquals(pairs, { ...LEGACY_SLUG_TO_VISUAL });
});

// ── the live wiring: sources, and non-sources ─────────────────────────────

Deno.test("the live hook reads execution records, never counts or the legacy count-based status", () => {
  const hook = read("src/hooks/useAgentVisualStates.ts");
  const imports = hook.split("\n").filter((l) => /^import|^\s+[\w, {}]+ from /.test(l) || / from '/.test(l)).join("\n");
  assertFalse(/useWorkforceState|useSignalFeed|useContentItems/.test(imports), "must not import count-based sources");
  assert(/deriveAgentVisualStates/.test(hook));
  assert(/attributeApprovals/.test(hook));
  const sources = read("src/lib/agent3d/liveSources.ts");
  assertFalse(/select\(\s*['"]\*['"]/.test(sources), "no select('*') from the home page");
  assertFalse(/\bresult\b|output_json|payload/.test(sources.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")), "no JSON columns");
});

Deno.test("the pure layer stays pure: no app aliases, no network, no React", () => {
  for (const f of ["visualState.ts", "registry.ts", "capability.ts", "gaze.ts"]) {
    const src = read(`src/lib/agent3d/${f}`);
    assertFalse(/from ['"]@\//.test(src), f);
    assertFalse(/supabase|from ['"]react['"]/.test(src.replace(/\/\/.*$/gm, "")), f);
  }
});

Deno.test("the dashboard hands cards the live visual state, and the card keeps its exact portrait as fallback", () => {
  const dash = read("src/pages/Dashboard.tsx");
  assert(/useAgentVisualStates\(workspaceId\)/.test(dash));
  assert(/visual=\{visualStates\[visualAgentKey\(id\)!\]\}/.test(dash));
  const card = read("src/components/dashboard/WorkforceAgentCard.tsx");
  assert(/<AgentVisual[^>]*surface="home"/.test(card));
  assert(/fallback=\{<img className="team-agent__portrait" src=\{profile\?\.avatar\}/.test(card));
});

Deno.test("the card's attention dot and announced status rest on the visual state, not on counts", () => {
  const card = read("src/components/dashboard/WorkforceAgentCard.tsx").replace(/\/\/.*$/gm, "");
  assert(/const base = visual\?\.base \?\? 'idle'/.test(card));
  assert(/const attention = !loading && \(base === 'awaiting' \|\| base === 'blocked'\)/.test(card));
  assert(/const status = loading \? 'Loading workspace' : visual\?\.reason/.test(card));
  assertFalse(/agent\.status/.test(card), "the count-based status must not drive any claim on the card");
  assertFalse(/agent\.todayOutput/.test(card), "counts are not announced as status");
});

// ── fallback system ───────────────────────────────────────────────────────

const CAPABLE: DeviceEnv = {
  reducedMotion: false, saveData: false, deviceMemoryGb: 8, cores: 8, coarsePointer: false,
  viewportWidth: 1440, disabledByUser: false, degraded: false,
};

Deno.test("no model is fabricated: every registry entry is empty, so every surface renders the portrait", () => {
  for (const k of VISUAL_AGENT_KEYS) {
    assertEquals(AGENT_3D_REGISTRY[k].model, null, k);
    assertEquals(modelFor(k), null, k);
    assertEquals(chooseRenderTier({ surface: "home", hasModel: !!modelFor(k), hasRenderer: true, env: CAPABLE, probeWebGL2: () => true }), { tier: "portrait", reason: "no-model" });
  }
});

Deno.test("the glb renderer is a lazy chunk, and the only module in the app that imports three.js", () => {
  const contract = read("src/components/agent3d/rendererContract.ts");
  assert(/glb:\s*\(\)\s*=>\s*import\('\.\/GltfAgentRenderer'\)/.test(contract), "glb loads through a dynamic import");
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const e of Deno.readDirSync(new URL(`../../${dir}`, import.meta.url))) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /from ['"]three(\/|['"])/.test(read(p))) importers.push(p);
    }
  };
  walk("src");
  assertEquals(importers, ["src/components/agent3d/GltfAgentRenderer.tsx"]);
  assertFalse(/import .*GltfAgentRenderer/.test(read("src/components/agent3d/AgentVisual.tsx")), "never imported statically");
  const pkg = JSON.parse(read("package.json"));
  assertFalse(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => d.startsWith("@react-three/")), "plain three.js, no React Three Fiber");
});

Deno.test("every capability gate falls back to the portrait, with its reason", () => {
  const decide = (env: Partial<DeviceEnv>, surface: "home" | "agent" | "inline" = "home") =>
    chooseRenderTier({ surface, hasModel: true, hasRenderer: true, env: { ...CAPABLE, ...env }, probeWebGL2: () => true });
  assertEquals(decide({}), { tier: "model" });
  assertEquals(decide({}, "agent"), { tier: "portrait", reason: "surface" }, "Phase 2 is homepage-only");
  assertEquals(decide({}, "inline"), { tier: "portrait", reason: "surface" });
  assertEquals(decide({ reducedMotion: true }), { tier: "portrait", reason: "reduced-motion" });
  assertEquals(decide({ saveData: true }), { tier: "portrait", reason: "save-data" });
  assertEquals(decide({ deviceMemoryGb: 2 }), { tier: "portrait", reason: "low-memory" });
  assertEquals(decide({ cores: 2 }), { tier: "portrait", reason: "low-cpu" });
  assertEquals(decide({ coarsePointer: true }), { tier: "portrait", reason: "touch" });
  assertEquals(decide({ viewportWidth: 820 }), { tier: "portrait", reason: "narrow" });
  assertEquals(decide({ disabledByUser: true }), { tier: "portrait", reason: "disabled" });
  assertEquals(decide({ degraded: true }), { tier: "portrait", reason: "degraded" });
  // Unknown hardware hints do not block; they are simply unknown.
  assertEquals(decide({ deviceMemoryGb: null, cores: null }), { tier: "model" });
  assertEquals(chooseRenderTier({ surface: "home", hasModel: true, hasRenderer: false, env: CAPABLE, probeWebGL2: () => true }), { tier: "portrait", reason: "no-renderer" });
});

Deno.test("the WebGL2 probe runs last, and only when every cheap check has passed", () => {
  let probes = 0;
  const probe = () => { probes++; return false; };
  chooseRenderTier({ surface: "home", hasModel: true, hasRenderer: true, env: { ...CAPABLE, reducedMotion: true }, probeWebGL2: probe });
  chooseRenderTier({ surface: "inline", hasModel: true, hasRenderer: true, env: CAPABLE, probeWebGL2: probe });
  chooseRenderTier({ surface: "home", hasModel: false, hasRenderer: true, env: CAPABLE, probeWebGL2: probe });
  assertEquals(probes, 0);
  assertEquals(chooseRenderTier({ surface: "home", hasModel: true, hasRenderer: true, env: CAPABLE, probeWebGL2: probe }), { tier: "portrait", reason: "no-webgl2" });
  assertEquals(probes, 1);
});

Deno.test("the frame budget ignores spikes and hidden-tab gaps, and degrades on sustained slowness", () => {
  const spiky = createFrameBudget({ budgetMs: 25, windowSize: 20, tolerance: 0.25 });
  for (let i = 0; i < 200; i++) assertEquals(spiky.record(i % 10 === 0 ? 60 : 16), "ok");
  const hidden = createFrameBudget({ windowSize: 20 });
  for (let i = 0; i < 100; i++) assertEquals(hidden.record(i % 2 ? 16 : 4_000), "ok");
  const slow = createFrameBudget({ budgetMs: 25, windowSize: 20, tolerance: 0.25 });
  let verdict = "ok";
  for (let i = 0; i < 19; i++) verdict = slow.record(40);
  assertEquals(verdict, "ok", "not before a full window");
  assertEquals(slow.record(40), "degrade");
  assertEquals(slow.record(8), "degrade", "stays degraded for the session");
});

// ── the model registry ────────────────────────────────────────────────────

const LYRA: AgentModelManifest = {
  format: "glb", url: "/agents/3d/lyra.glb", bytes: 3_200_000,
  rig: { head: "Head", neck: "Neck", eyeLeft: "LeftEye", eyeRight: "RightEye" },
  expressions: { blinkLeft: "eyeBlinkLeft", blinkRight: "eyeBlinkRight" },
  clips: { idle: "Idle", working: "Work" },
  gestures: { acknowledge: "Nod" },
  framing: { target: [0, 1.55, 0], distance: 0.9, fovDeg: 28 },
};

Deno.test("a well-formed manifest validates; each defect is named", () => {
  assertEquals(validateManifest(LYRA), []);
  assert(validateManifest({ ...LYRA, url: "https://cdn.example.com/lyra.glb" }).length > 0, "remote host");
  assert(validateManifest({ ...LYRA, url: "//cdn.example.com/lyra.glb" }).length > 0, "protocol-relative host");
  assert(validateManifest({ ...LYRA, url: "/agents/3d/lyra.vrm" }).length > 0, "extension vs format");
  assert(validateManifest({ ...LYRA, bytes: MODEL_BUDGET_BYTES + 1 }).length > 0, "over budget");
  assert(validateManifest({ ...LYRA, bytes: 0 }).length > 0, "unmeasured");
  assert(validateManifest({ ...LYRA, rig: { head: "" } }).length > 0, "no head bone");
  assert(validateManifest({ ...LYRA, gaze: { maxYawDeg: 30, maxPitchDeg: 8 } }).length > 0, "looser gaze");
  assert(validateManifest({ ...LYRA, framing: { ...LYRA.framing, fovDeg: 90 } }).length > 0, "fisheye framing");
});

Deno.test("a missing state clip falls back to idle — never to another state's clip", () => {
  assertEquals(clipFor(LYRA, "working"), "Work");
  assertEquals(clipFor(LYRA, "thinking"), "Idle");
  assertEquals(clipFor(LYRA, "awaiting"), "Idle");
  assertEquals(clipFor({ ...LYRA, clips: { working: "Work" } }, "thinking"), null);
});

// ── gaze: restraint, encoded ──────────────────────────────────────────────

Deno.test("gaze maps the card into a small cone and never beyond it", () => {
  const box = { left: 100, top: 100, width: 200, height: 300 };
  assertEquals(pointerToGaze(200, 250, box, GAZE_LIMITS), { yawDeg: 0, pitchDeg: -0 });
  assertEquals(pointerToGaze(300, 250, box, GAZE_LIMITS).yawDeg, GAZE_LIMITS.maxYawDeg);
  assertEquals(pointerToGaze(200, 100, box, GAZE_LIMITS).pitchDeg, GAZE_LIMITS.maxPitchDeg, "pointer at top → looks up");
  assertEquals(pointerToGaze(9_999, -9_999, box, GAZE_LIMITS), { yawDeg: GAZE_LIMITS.maxYawDeg, pitchDeg: GAZE_LIMITS.maxPitchDeg });
  assertEquals(pointerToGaze(1, 1, { left: 0, top: 0, width: 0, height: 0 }, GAZE_LIMITS), { yawDeg: 0, pitchDeg: 0 });
  assert(GAZE_LIMITS.maxYawDeg <= 12 && GAZE_LIMITS.maxPitchDeg <= 8);
});

Deno.test("damping is frame-rate independent, halves per half-life, and settles", () => {
  const twoSmall = dampToward(dampToward(10, 0, 8, 140), 0, 8, 140);
  const oneBig = dampToward(10, 0, 16, 140);
  assert(Math.abs(twoSmall - oneBig) < 1e-9);
  assert(Math.abs(dampToward(10, 0, 140, 140) - 5) < 1e-9);
  let v = 12;
  for (let i = 0; i < 120; i++) v = dampToward(v, 0, 16, 140);
  assert(Math.abs(v) < 0.01);
  assertEquals(dampToward(3, 9, 0, 140), 3);
  const { head, eyes } = splitGaze({ yawDeg: 10, pitchDeg: -5 });
  assert(Math.abs(head.yawDeg + eyes.yawDeg - 10) < 1e-9 && Math.abs(head.pitchDeg + eyes.pitchDeg + 5) < 1e-9);
});
