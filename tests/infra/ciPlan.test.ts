// THE CI TEST PLAN AND GATE (scripts/ci/planCore.mjs), against the real
// repository. What may be skipped is only the slow database-backed work, only
// with a dependency reason, and every doubt widens the plan. The gate passes
// nothing that did not run.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  EXTRA_DEPS, balance, closureOf, gateVerdict, mutationEntries, plan, scanDeps,
} from "../../scripts/ci/planCore.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string): string | null => {
  try { return Deno.readTextFileSync(new URL(p, ROOT)); } catch { return null; }
};
const CONTRACT = [...Deno.readDirSync(new URL("tests/db-contract/", ROOT))]
  .filter((e) => e.name.endsWith(".contract.test.ts")).map((e) => `tests/db-contract/${e.name}`).sort();
const MUTATION = read("tests/db-contract/mutation.sh")!;
const pr = (changed: string[] | null, draft: boolean) =>
  plan({ event: "pull_request", ref: "refs/pull/1/merge", draft, changed, contractFiles: CONTRACT, mutationScript: MUTATION, readFile: read });
const short = (f: string) => f.replace("tests/db-contract/", "").replace(".contract.test.ts", "");

// ═══════════════════════════════════════════════════════════════ levels ══

Deno.test("levels: draft 1, ready 2, release branch and manual full 3", () => {
  assertEquals(pr(["src/App.tsx"], true).level, 1);
  assertEquals(pr(["src/App.tsx"], false).level, 2);
  const at = (event: string, ref: string, requested?: string) =>
    plan({ event, ref, requested, changed: ["src/App.tsx"], contractFiles: CONTRACT, mutationScript: MUTATION, readFile: read }).level;
  assertEquals(at("push", "refs/heads/launch/hardening"), 3);
  assertEquals(at("push", "refs/heads/main"), 3);
  assertEquals(at("push", "refs/heads/integration/a7"), 3);
  assertEquals(at("push", "refs/heads/feat/lead-mission-v2-worker"), 1);
  assertEquals(at("workflow_dispatch", "refs/heads/x", "full"), 3);
  assertEquals(at("workflow_dispatch", "refs/heads/x", "integration"), 2);
});

Deno.test("level 3: everything — every contract file and every mutation proof", () => {
  const p = plan({ event: "push", ref: "refs/heads/launch/hardening", changed: ["README.md"], contractFiles: CONTRACT, mutationScript: MUTATION, readFile: read });
  assertEquals([p.contract, p.contract_all, p.mutation], [true, true, true]);
});

Deno.test("level 2: the complete database contract whatever changed", () => {
  for (const f of ["src/App.tsx", "docs/launch/ci.md", "tests/edge-functions/_shared/criterionVerdicts.test.ts"]) {
    const p = pr([f], false);
    assertEquals([p.contract, p.contract_all], [true, true], f);
  }
});

// ═════════════════════════════════════════════════════ example changes ══

Deno.test("UI-only draft: no database starts", () => {
  const p = pr(["src/components/chat/workspace/ChatView.tsx", "src/index.css"], true);
  assertEquals([p.contract, p.mutation], [false, false]);
});

Deno.test("mock-response-only draft: the scenario suites that use the mock, nothing else", () => {
  const p = pr(["tests/db-contract/lib/discoveryScenario.ts"], true);
  assertEquals(p.contract_files.map(short), ["a7Lifecycle", "a7Qualification", "a7Reliability", "canaryFundingRehearsal", "effectFenceMission", "killResume", "killResumeAdoption", "legacyPreEffectGuard", "modelOnlySmoke", "qualificationAuthority", "realGptJudge", "smokeCreditReconciliation"]);
  assertEquals(p.mutation, false);
});

Deno.test("qualification-engine draft: every contract suite that imports it, including the A7 scenarios", () => {
  const p = pr(["supabase/functions/_shared/candidateEligibility.ts"], true);
  const files = p.contract_files.map(short);
  for (const f of ["a7Qualification", "a7Reliability", "offlineSmokeProgress", "schemaCompat"]) assert(files.includes(f), f);
  // Ready for review, the same change runs the complete contract AND the proofs.
  const ready = pr(["supabase/functions/_shared/candidateEligibility.ts"], false);
  assertEquals([ready.contract_all, ready.mutation], [true, true]);
});

Deno.test("spending / authorization draft: the admission suites run", () => {
  for (const f of ["supabase/functions/_shared/smokeAdmission.ts", "supabase/functions/_shared/creditAuthorization.ts"]) {
    const files = pr([f], true).contract_files.map(short);
    assert(files.some((x) => x.startsWith("smokeAdmission")), `${f}: ${files.join(",")}`);
    assertEquals(pr([f], false).mutation, true, `${f}: proofs at level 2`);
  }
});

Deno.test("worker draft: the queue, lease and scenario suites run", () => {
  const files = pr(["worker/leadMissionRunner.ts"], true).contract_files.map(short);
  for (const f of ["a7Qualification", "offlineSmokeProgress"]) assert(files.includes(f), f);
  const main = pr(["worker/main.ts"], true).contract_files.map(short);
  for (const f of ["lineageQueue", "leadMissionExhaustedLease", "schemaCompat"]) assert(main.includes(f), `worker/main.ts → ${f}`);
});

Deno.test("migrations and database build inputs: the COMPLETE contract, even on a draft", () => {
  for (const f of ["supabase/migrations/20990101000000_x.sql", "supabase/migrations-held/README.md",
    "tests/db-contract/sql/00_supabase_shim.sql"]) {
    assertEquals(pr([f], true).contract_all, true, f);
    assertEquals(pr([f], false).mutation, true, `${f}: proofs at level 2`);
  }
});

Deno.test("CI or toolchain change: everything, mutation proofs included, even on a draft", () => {
  for (const f of [".github/workflows/ci.yml", "scripts/ci/planCore.mjs", "deno.lock", "package.json",
    "tests/db-contract/mutation.sh", "tests/db-contract/run.sh"]) {
    const p = pr([f], true);
    assertEquals([p.contract_all, p.mutation], [true, true], f);
  }
});

Deno.test("unclassified path: complete contract; proofs from level 2", () => {
  const d = pr(["somewhere/new/thing.py"], true);
  assertEquals([d.contract_all, d.mutation], [true, false]);
  assertEquals(pr(["somewhere/new/thing.py"], false).mutation, true);
});

Deno.test("unknown change set: everything", () => {
  const p = pr(null, true);
  assertEquals([p.contract_all, p.mutation], [true, true]);
});

// ═══════════════════════════════════════════════════════ dependencies ══

Deno.test("closures: every contract file's dependencies are named — none falls back to 'everything' unnoticed", () => {
  for (const f of CONTRACT) {
    const c = closureOf([f], read);
    assert(!c.everything, `${f} reads something the scanner cannot name; add an audited EXTRA_DEPS entry`);
    assert(c.files.size > 1, `${f} has a closure`);
  }
  assert(!closureOf(mutationEntries(MUTATION), read).everything);
});

Deno.test("closures: non-import reads count — worker/main.ts read as text, the catalog JSON, the reconciliation SQL", () => {
  assert(closureOf(["tests/db-contract/lineageQueue.contract.test.ts"], read).files.has("worker/main.ts"));
  assert(closureOf(["tests/db-contract/smokeAdmission.contract.test.ts"], read).files.has("scripts/test-project/smoke-reconciliation.sql"));
  assert(closureOf(["tests/db-contract/a7Qualification.contract.test.ts"], read).files.has("docs/launch/proposals/smoke-catalog-two-actor.json"));
});

Deno.test("scanner: an unnamed read widens to everything unless audited", () => {
  assertEquals(scanDeps("t/a.ts", 'await Deno.readTextFile(path);').unresolved, true);
  assertEquals(scanDeps("t/a.ts", 'Deno.readTextFileSync(new URL("../x.json", import.meta.url))').unresolved, false);
  assertEquals(scanDeps("t/a.ts", 'Deno.readTextFile(\n  new URL(\n    "../x.json",\n    import.meta.url,\n  ),\n)').unresolved, false);
  assertEquals(scanDeps("t/a.ts", 'const ROOT = new URL("../", import.meta.url);').root, true);
  assertEquals(scanDeps("t/a.ts", 'import { walk } from "https://deno.land/std/fs/walk.ts"; walk(".")').unresolved, true);
  assertEquals(scanDeps("t/a.ts", "function walk(o) { return o; } walk({})").unresolved, false, "a local helper is not a file read");
  const unread = closureOf(["tests/db-contract/x.ts"], (p: string) => p === "tests/db-contract/x.ts" ? "Deno.readDir(dir)" : null);
  assertEquals(unread.everything, true);
  for (const [f, deps] of Object.entries(EXTRA_DEPS)) {
    assert(read(f), `EXTRA_DEPS names a file that exists: ${f}`);
    for (const d of deps as string[]) {
      const st = Deno.statSync(new URL(d, ROOT));
      assert(d.endsWith("/") ? st.isDirectory : st.isFile, `EXTRA_DEPS entry exists: ${d}`);
    }
  }
});

Deno.test("mutation entries: what the proofs run and mutate is read from the script itself", () => {
  const e = mutationEntries(MUTATION);
  for (const f of ["tests/db-contract/smokeAdmission.contract.test.ts", "tests/db-contract/fencedWrite.contract.test.ts",
    "supabase/functions/_shared/smokeAdmission.ts", "supabase/migrations-held/20261015140000_discovery_smoke_admission.sql"]) {
    assert(e.includes(f), f);
  }
});

// ═══════════════════════════════════════════════════════════════ shards ══

Deno.test("shards: exact — every file once — and the longest files are spread", () => {
  const s = balance(CONTRACT, 3, (f: string) => f.includes("offlineSmoke") ? 192 : f.includes("a7Qualification") ? 160 : 5);
  assertEquals(s.flat().sort(), CONTRACT);
  const where = (n: string) => s.findIndex((x: string[]) => x.some((f) => f.includes(n)));
  assert(where("offlineSmoke") !== where("a7Qualification"), "the two longest never share a runner");
  assertEquals(balance([], 3, () => 1), [[], [], []]);
});

Deno.test("shards: a lost or duplicated file is an error, not a quieter run", () => {
  // assertExact is what balance() ends with; feed it a broken partition directly.
  assertThrows(() => balance(["a", "a"], 2, () => 1));
});

// ═════════════════════════════════════════════════════════════════ gate ══

const ok = { result: "success" };
const planned = (o: Record<string, string>) => ({ result: "success", outputs: { contract_all: "true", contract_count: "14", ...o } });
const tallies = (n: number, total: number, ranEach?: number[]) =>
  Array.from({ length: n }, (_, k) => ({ shard: k, shards: n, total, ran: ranEach ? ranEach[k] : Math.floor(total / n) + (k < total % n ? 1 : 0) }));
// Three contract shards that ran every planned file (the plan's contract_count defaults to 14 below).
const ctally = (ran = [5, 5, 4], planned = [5, 5, 4]) => planned.map((p, k) => ({ shard: k + 1, planned: p, ran: ran[k] }));
const gate = (needs: Record<string, unknown>, t: unknown[] = [], c: unknown[] = ctally()) =>
  gateVerdict({ needs, tallies: t, shards: 8, minProofs: 64, contractTallies: c, contractShards: 3 });

Deno.test("gate: a full level-3 run passes only with every job and every proof", () => {
  const needs = { plan: planned({ level: "3", contract: "true", mutation: "true" }), backend: ok, replay: ok, frontend: ok, contract: ok, mutation: ok };
  assertEquals(gate(needs, tallies(8, 64)).ok, true);
  assertEquals(gate(needs, tallies(7, 64)).ok, false, "a missing shard tally");
  assertEquals(gate(needs, tallies(8, 64, [8, 8, 8, 8, 8, 8, 8, 7])).ok, false, "a proof that did not run");
  assertEquals(gate(needs, tallies(8, 60)).ok, false, "fewer proofs than the floor");
  assertEquals(gate(needs, [...tallies(7, 64), { shard: 7, shards: 8, total: 63, ran: 8 }]).ok, false, "shards disagree on the list");
});

Deno.test("gate: skipped, cancelled or missing required jobs fail — never pass", () => {
  const base = { plan: planned({ level: "2", contract: "true", mutation: "false" }), backend: ok, replay: ok, frontend: ok, contract: ok, mutation: { result: "skipped" } };
  assertEquals(gate(base).ok, true);
  for (const [j, r] of [["contract", "skipped"], ["contract", "cancelled"], ["backend", "skipped"], ["replay", "cancelled"], ["frontend", "failure"]]) {
    assertEquals(gate({ ...base, [j]: { result: r } }).ok, false, `${j} ${r}`);
  }
  const { backend: _b, ...missing } = base;
  assertEquals(gate(missing).ok, false, "a missing job");
  assertEquals(gate({ ...base, plan: { result: "failure" } }).ok, false, "no plan, no verification");
});

Deno.test("gate: a job the plan skipped may not fail either; level 3 without proofs is refused", () => {
  const draft = { plan: planned({ level: "1", contract: "false", mutation: "false", contract_all: "false" }), backend: ok, replay: ok, frontend: ok, contract: { result: "skipped" }, mutation: { result: "skipped" } };
  assertEquals(gate(draft).ok, true);
  assertEquals(gate({ ...draft, contract: { result: "failure" } }).ok, false);
  const forged = { plan: planned({ level: "3", contract: "true", mutation: "false" }), backend: ok, replay: ok, frontend: ok, contract: ok, mutation: { result: "skipped" } };
  assertEquals(gate(forged).ok, false);
});

Deno.test("gate: a contract shard that succeeded without running its files fails the gate", () => {
  const base = { plan: planned({ level: "2", contract: "true", mutation: "false" }), backend: ok, replay: ok, frontend: ok, contract: ok, mutation: { result: "skipped" } };
  assertEquals(gate(base).ok, true);
  // Every shard green, but the planned files never reached them (e.g. a lost plan output).
  assertEquals(gate(base, [], ctally([0, 0, 0], [0, 0, 0])).ok, false, "nothing assigned, nothing ran");
  assertEquals(gate(base, [], ctally([5, 0, 4])).ok, false, "one shard ran nothing of its files");
  assertEquals(gate(base, [], ctally([5, 5, 4], [5, 5, 3])).ok, false, "a planned file was never assigned");
  assertEquals(gate(base, [], ctally().slice(0, 2)).ok, false, "a shard tally is missing");
  assertEquals(gate({ ...base, plan: planned({ level: "2", contract: "true", mutation: "false", contract_count: "" }) }).ok, false,
    "no planned count, nothing to check against");
  // Not planned: no tallies are expected.
  const draft = { plan: planned({ level: "1", contract: "false", mutation: "false", contract_all: "false", contract_count: "0" }), backend: ok, replay: ok, frontend: ok, contract: { result: "skipped" }, mutation: { result: "skipped" } };
  assertEquals(gate(draft, [], []).ok, true);
});
