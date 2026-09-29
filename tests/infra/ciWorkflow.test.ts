// THE CI WORKFLOW AND ITS RATCHET, PINNED.
//
// CI runs the suites this repo already has (docs/launch/ci.md). A workflow that
// drifts from `package.json`, grows a secret, or lets the build rewrite a file
// before the ratchets read it would fail quietly in the one place nobody reads.
// PURE: reads files, runs nothing.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/yaml/mod.ts";
import {
  compareCounts, formatBaseline, parseEslint, parseTsc, relPath,
} from "../../scripts/ci/ratchetCore.mjs";

const read = (p: string) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));
const WORKFLOW = read(".github/workflows/ci.yml");
interface Step { name?: string; run?: string; uses?: string }
interface Workflow {
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, { steps: Step[]; "timeout-minutes"?: number }>;
}
const wf = parse(WORKFLOW) as Workflow;
const PKG = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const steps = (job: string) => wf.jobs[job].steps;
const runs = (job: string) => steps(job).map((s) => s.run ?? "").join("\n");

// ═══════════════════════════════════════════════════════════════ ratchet ══

Deno.test("RATCHET: parses tsc output per file and code, repo-relative", () => {
  const out = [
    "/repo/src/lib/a.ts(3,7): error TS2339: Property 'x' does not exist.",
    "/repo/src/lib/a.ts(9,1): error TS2339: Property 'y' does not exist.",
    "src/lib/b.ts(1,1): error TS2353: Object literal may only specify known properties.",
    "Found 3 errors.",
  ].join("\n");
  assertEquals(parseTsc(out, "/repo"), { "src/lib/a.ts|TS2339": 2, "src/lib/b.ts|TS2353": 1 });
});

Deno.test("RATCHET: parses eslint JSON, errors only", () => {
  const json = [{ filePath: "/repo/src/x.tsx", messages: [
    { severity: 2, ruleId: "no-unused-vars" }, { severity: 2, ruleId: "no-unused-vars" },
    { severity: 1, ruleId: "react-hooks/exhaustive-deps" }, { severity: 2, ruleId: null },
  ] }];
  assertEquals(parseEslint(json, "/repo"), { "src/x.tsx|no-unused-vars": 2, "src/x.tsx|parse-error": 1 });
});

Deno.test("RATCHET: a rise anywhere fails; a fall is reported, not failed; a new file with errors fails", () => {
  const base = { "a|TS1": 2, "b|TS2": 1 };
  const same = compareCounts({ "a|TS1": 2, "b|TS2": 1 }, base);
  assert(same.ok);
  const worse = compareCounts({ "a|TS1": 3, "b|TS2": 1 }, base);
  assertFalse(worse.ok);
  assertEquals(worse.regressions, [{ key: "a|TS1", was: 2, now: 3 }]);
  const newFile = compareCounts({ "a|TS1": 2, "b|TS2": 1, "c|TS9": 1 }, base);
  assertEquals(newFile.regressions, [{ key: "c|TS9", was: 0, now: 1 }]);
  // Moving an error between files is not a free pass: the new file rises.
  assertFalse(compareCounts({ "a|TS1": 1, "b|TS2": 1, "d|TS1": 1 }, base).ok);
  const better = compareCounts({ "a|TS1": 1 }, base);
  assert(better.ok);
  assertEquals(better.improvements.map((i) => i.key), ["a|TS1", "b|TS2"]);
});

Deno.test("RATCHET: baselines are stable (sorted keys) and the committed ones are valid", () => {
  assertEquals(formatBaseline({ b: 1, a: 2 }), '{\n "a": 2,\n "b": 1\n}\n');
  assertEquals(relPath("C:\\repo\\src\\x.ts", "C:\\repo"), "src/x.ts");
  for (const tool of ["tsc", "eslint"]) {
    const text = read(`scripts/ci/baselines/${tool}.json`);
    const counts = JSON.parse(text) as Record<string, number>;
    assertEquals(text, formatBaseline(counts), `${tool} baseline is in canonical form`);
    assert(Object.values(counts).every((n) => Number.isInteger(n) && n > 0), tool);
    assertFalse(Object.keys(counts).some((k) => k.startsWith("/")), `${tool}: paths are repo-relative`);
  }
});

// ══════════════════════════════════════════════════════════════ workflow ══

Deno.test("WORKFLOW: read-only token, no secrets, no deploy, pinned Deno", () => {
  assertEquals(wf.permissions, { contents: "read" });
  assertFalse(/secrets\./.test(WORKFLOW), "CI needs no secret");
  assertFalse(/supabase (functions )?deploy|railway|netlify deploy|git push/i.test(WORKFLOW), "CI never deploys");
  assertEquals(wf.env.DENO_VERSION, "v2.8.2");
  for (const job of Object.keys(wf.jobs)) {
    assert(Number(wf.jobs[job]["timeout-minutes"]) > 0, `${job} is time-bounded`);
    const deno = steps(job).find((s) => s.uses?.startsWith("denoland/setup-deno"));
    assert(deno, `${job} installs Deno`);
  }
});

Deno.test("WORKFLOW: runs exactly the repo's own suites — the same commands as package.json", () => {
  const backend = runs("backend");
  assert(backend.includes(PKG.scripts["test:edge"]), "edge suite");
  assert(backend.includes(PKG.scripts["test:deploy-safety"]), "deploy-safety suite");
  assert(backend.includes(PKG.scripts["qa:lead-quality:test"]));
  assert(backend.includes(PKG.scripts["qa:model-routing:test"]));
  // Found by a fresh-checkout dry run: deploy-safety type-checks against
  // @types/node in node_modules, so the backend job installs before it.
  const b = steps("backend").map((x) => x.run ?? "");
  const install = b.findIndex((r) => r.includes("npm ci"));
  const infra = b.findIndex((r) => r.includes(PKG.scripts["test:deploy-safety"]));
  assert(install >= 0 && install < infra, "npm ci before the deploy-safety suite");
  const frontend = runs("frontend");
  for (const script of ["test:ui", "test:ui:node", "build"]) {
    assert(frontend.includes(`npm run ${script}`), script);
    assert(PKG.scripts[script], `package.json defines ${script}`);
  }
  assert(frontend.includes("npm ci"), "a clean install from the lockfile");
});

Deno.test("WORKFLOW: the ratchets run BEFORE the build, which regenerates supabase/functions/mcp/index.ts", () => {
  const names = steps("frontend").map((s) => s.run ?? "");
  const tsc = names.findIndex((r) => r.includes("ratchet.mjs tsc"));
  const lint = names.findIndex((r) => r.includes("ratchet.mjs eslint"));
  const build = names.findIndex((r) => r.includes("npm run build"));
  assert(tsc >= 0 && lint >= 0 && build >= 0);
  assert(tsc < build && lint < build);
  assert(read("supabase/functions/mcp/index.ts").startsWith("// AUTO-GENERATED"), "the reason for the order still holds");
});

Deno.test("WORKFLOW: every edge function is type-checked; only the generated MCP bundle is excepted", () => {
  const check = runs("backend");
  assert(check.includes("ls supabase/functions/*/index.ts | grep -v '/mcp/index.ts'"));
  assert(check.includes("echo worker/main.ts; } | xargs deno check"));
  assertFalse(/grep -v '[^']*(?<!\/mcp\/index\.ts)'/.test(check.replace("grep -v '/mcp/index.ts'", "")), "no other exception");
});

Deno.test("UI RUNNERS: the Deno UI suite skips node:test files, and the Node runner picks them up", () => {
  assert(PKG.scripts["test:ui"].includes("--ignore='tests/frontend/**/*.test.cjs'"));
  assertEquals(PKG.scripts["test:ui:node"], "node --test tests/frontend/*.test.cjs");
  const cjs = [...Deno.readDirSync(new URL("../frontend/", import.meta.url))].filter((e) => e.name.endsWith(".test.cjs"));
  assert(cjs.length > 0);
  for (const f of cjs) assert(read(`tests/frontend/${f.name}`).includes("require('node:test')"), `${f.name} is a node:test file`);
});
