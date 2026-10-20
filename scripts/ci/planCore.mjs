// CI TEST PLAN — which verification a change needs, decided conservatively.
//
// Three levels (docs/launch/ci.md, "Test levels"):
//
//   1  development   a DRAFT pull request (or a push to a feature branch).
//                    The fast suites always run. The database contract runs
//                    only the files whose dependency closure the change
//                    touches. Mutation proofs wait for level 2.
//   2  integration   a pull request that is READY for review. Every suite,
//                    the COMPLETE database contract, and all mutation proofs
//                    when the change can affect what they prove.
//   3  release       a push to main / launch/hardening / integration/**, or
//                    a manual run asking for it. Everything, including every
//                    mutation proof, on the exact commit.
//
// THE ONLY THINGS THIS MAY SKIP are the database contract on a draft and the
// mutation proofs below level 3 — the slow, database-backed work. The fast
// suites are never selected by path: tests read source as text far too often
// (374 test files do) for path selection there to be safe, and they finish in
// minutes anyway. Every skip is justified by a dependency closure, and every
// doubt — an unreadable diff, an unclassified path, a test reading a file the
// scanner cannot name, a change to CI itself — widens the plan, never narrows
// it.
//
// Pure: callers pass the file reader. No network, no git, no clock.

/** Paths whose change re-verifies everything at the highest level the event allows, mutation proofs included. */
export const FULL_TRIGGERS = [
  /^\.github\//, /^scripts\/ci\//,
  /^deno\.jsonc?$/, /^deno\.lock$/, /^package\.json$/, /^package-lock\.json$/, /^import_map\.json$/,
  /^supabase\/functions\/import_map\.json$/, /^supabase\/functions\/deno\.jsonc?$/,
  /^tests\/db-contract\/(run|bootstrap|mutation)\.sh$/, /^tests\/db-contract\/mutants\//,
];

/** Read by the database bootstrap (a shell script), so no import scan sees them: every contract file depends on them. */
export const DB_ALL_TRIGGERS = [
  /^supabase\/migrations\//, /^supabase\/migrations-held\//, /^tests\/db-contract\/sql\//,
  /^tests\/db-contract\/[^/]+\.sh$/,
];

/**
 * Top-level areas the plan understands. A changed path outside all of them is
 * UNCLASSIFIED and runs the complete database contract (and the mutation
 * proofs from level 2): new code in a new place gets more testing, not less.
 */
export const KNOWN_AREAS = [
  /^src\//, /^public\//, /^supabase\//, /^worker\//, /^tests\//, /^scripts\//, /^docs\//, /^fixtures\//,
  /^\.github\//, /^[^/]+\.md$/, /^index\.html$/, /^(vite|tailwind|postcss|eslint)\.config\.[cm]?[jt]s$/,
  /^tsconfig(\.[a-z]+)?\.json$/, /^components\.json$/, /^\.gitignore$/, /^bun\.lockb$/,
  /^deno\.jsonc?$/, /^deno\.lock$/, /^package(-lock)?\.json$/,
];

/**
 * Reads the import scanner cannot resolve, named by hand. Audited by
 * tests/infra/ciPlan.test.ts: a contract file with an unresolvable read that is
 * NOT listed here makes the planner treat that file as depending on the whole
 * repository.
 */
export const EXTRA_DEPS = {
  // Reads every literal query in run-agent, the shared modules and the worker.
  "tests/db-contract/schemaCompat.contract.test.ts": [
    "supabase/functions/run-agent/index.ts", "supabase/functions/_shared/", "worker/",
  ],
};

const CODE = /\.(m?[jt]sx?|json)$/;
const norm = (p) => {
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop(); else out.push(seg);
  }
  return out.join("/") + (p.endsWith("/") ? "/" : "");
};
const dirOf = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";

/**
 * What one source file depends on: its relative imports, and every file or
 * directory it reads by a literal `new URL("…", import.meta.url)`. A read the
 * scanner cannot name (a variable path) marks the file `unresolved`; a literal
 * URL to the repository root itself sets `root`.
 */
export function scanDeps(path, text) {
  const deps = new Set();
  const base = dirOf(path);
  const rel = (s) => norm(base + s);
  // Static, re-export and dynamic imports with a literal relative specifier.
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g)) deps.add(rel(m[1]));
  // Literal URLs relative to the module: files and directories it reads.
  let root = false;
  for (const m of text.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*,?\s*\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    const d = rel(m[1]);
    // The repository root itself: a base other reads are resolved against.
    if (d === "/" || d === "") root = true; else deps.add(d);
  }
  // A file-system read whose argument is not one of the literal URLs above.
  let unresolved = false;
  for (const m of text.matchAll(/\bDeno\.(?:readTextFile|readTextFileSync|readFile|readFileSync|readDir|readDirSync|open|openSync)\(\s*([^)]*)/g)) {
    const arg = m[1].trim();
    if (!/^new URL\(\s*["'][^"']+["']\s*,\s*import\.meta\.url\s*,?\s*\)?,?$/.test(arg)) unresolved = true;
  }
  // The std `walk` and node's fs readers — only when actually imported (a local
  // helper named walk() traverses objects, not the file system).
  if (/import\s*\{[^}]*\bwalk\b[^}]*\}\s*from\s*["'][^"']*\/fs\//.test(text) && /\bwalk\(/.test(text)) unresolved = true;
  if (/from\s*["'](?:node:)?fs(?:\/promises)?["']/.test(text) &&
    /\b(?:readdirSync|readFileSync|readdir|readFile|opendir|createReadStream)\(/.test(text)) unresolved = true;
  return { deps: [...deps], unresolved, root };
}

/**
 * The transitive closure of some entry files. `files` are code files reached
 * (and the entries); `prefixes` are directories something reads; `everything`
 * is set when some file in the closure reads what the scanner cannot name and
 * no audited EXTRA_DEPS entry covers it.
 */
export function closureOf(entries, readFile) {
  const files = new Set(), prefixes = new Set();
  let everything = false;
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop();
    if (files.has(f)) continue;
    files.add(f);
    if (!CODE.test(f) || f.endsWith(".json")) continue;
    const text = readFile(f);
    if (text == null) continue;
    const { deps, unresolved, root } = scanDeps(f, text);
    const extra = EXTRA_DEPS[f];
    // A read the scanner cannot name, or a read of the repository root, depends
    // on everything — unless an audited EXTRA_DEPS entry names what it reads.
    if ((unresolved || root) && !extra) everything = true;
    for (const d of [...deps, ...(extra ?? [])]) {
      if (d.endsWith("/")) prefixes.add(d);
      else if (CODE.test(d)) queue.push(d);
      else files.add(d);
    }
  }
  return { files, prefixes: [...prefixes], everything };
}

export const touches = (closure, changed) =>
  closure.everything || closure.files.has(changed) || closure.prefixes.some((p) => changed.startsWith(p));

/** Test files and source files named in the mutation script: what the proofs run and what they mutate. */
export function mutationEntries(script) {
  const out = new Set();
  for (const m of script.matchAll(/\$root\/((?:tests|supabase|worker)\/[\w./-]+\.(?:ts|sql))/g)) out.add(m[1]);
  return [...out];
}

const RELEASE_BRANCHES = /^refs\/heads\/(main|launch\/hardening|integration\/.+)$/;

/**
 * The plan for one event.
 *
 * @param i.event       github.event_name
 * @param i.ref         github.ref
 * @param i.draft       pull request draft flag (pull_request only)
 * @param i.requested   workflow_dispatch input: "auto" | "integration" | "full"
 * @param i.changed     changed paths, or null when the diff is unknown
 * @param i.contractFiles  every tests/db-contract/*.test.ts, repo-relative
 * @param i.mutationScript the text of tests/db-contract/mutation.sh
 * @param i.readFile    repo-relative path -> text, or null
 */
export function plan(i) {
  const reasons = [];
  let level =
    i.event === "workflow_dispatch" && i.requested === "full" ? 3
    : i.event === "push" && RELEASE_BRANCHES.test(i.ref ?? "") ? 3
    : i.event === "workflow_dispatch" && i.requested === "integration" ? 2
    : i.event === "workflow_dispatch" ? 3
    : i.event === "pull_request" && !i.draft ? 2
    : 1;
  reasons.push(`level ${level}: ${
    level === 3 ? (i.event === "push" ? `push to ${i.ref}` : "manual full verification")
    : level === 2 ? (i.event === "pull_request" ? "pull request ready for review" : "manual integration run")
    : i.event === "pull_request" ? "draft pull request" : `push to ${i.ref}`}`);

  const changed = i.changed;
  const unknownDiff = changed === null;
  if (unknownDiff) reasons.push("the change set is unknown: every selected suite runs completely");

  const full = unknownDiff ? [] : changed.filter((f) => FULL_TRIGGERS.some((r) => r.test(f)));
  if (full.length) reasons.push(`CI / toolchain change (${full.slice(0, 5).join(", ")}): everything runs, mutation proofs included`);
  const unclassified = unknownDiff ? [] : changed.filter((f) => !KNOWN_AREAS.some((r) => r.test(f)));
  if (unclassified.length) reasons.push(`unclassified path(s) (${unclassified.slice(0, 5).join(", ")}): complete database contract`);
  const dbAll = unknownDiff ? [] : changed.filter((f) => DB_ALL_TRIGGERS.some((r) => r.test(f)));
  if (dbAll.length) reasons.push(`database build input(s) (${dbAll.slice(0, 5).join(", ")}): complete database contract`);

  // ── database contract ──────────────────────────────────────────────────
  let contract = [];
  const everyContract = level >= 2 || unknownDiff || full.length > 0 || unclassified.length > 0 || dbAll.length > 0;
  if (everyContract) {
    contract = [...i.contractFiles];
  } else {
    for (const f of i.contractFiles) {
      const c = closureOf([f], i.readFile);
      const hit = changed.find((x) => touches(c, x));
      if (hit) { contract.push(f); reasons.push(`${f.replace("tests/db-contract/", "")}: depends on ${c.everything ? "an unnamed read (whole repository)" : hit}`); }
    }
  }
  const contractAll = contract.length === i.contractFiles.length;

  // ── mutation proofs ────────────────────────────────────────────────────
  let mutation = false;
  if (level === 3 || full.length > 0 || unknownDiff) mutation = true;
  else if (level === 2) {
    if (unclassified.length || dbAll.length) { mutation = true; }
    else {
      const c = closureOf(mutationEntries(i.mutationScript), i.readFile);
      const hit = changed.find((x) => touches(c, x));
      if (hit) { mutation = true; reasons.push(`mutation proofs: their tests or targets depend on ${hit}`); }
      else reasons.push("mutation proofs: nothing they run or mutate changed (they run at level 3)");
    }
  }
  if (level === 1 && !mutation) reasons.push("mutation proofs: deferred to ready-for-review / release");

  return {
    level,
    fast: true,
    contract: contract.length > 0,
    contract_all: contractAll,
    contract_files: contractAll ? [] : contract,
    mutation,
    reasons,
  };
}

// ── SHARDS ──────────────────────────────────────────────────────────────────
//
// Parallel jobs on separate runners, each with its OWN Postgres: nothing
// mutable is shared. A partition must be EXACT — every file in
// one shard, none twice — or it throws, and a planner that throws fails the
// gate.

/** Measured seconds per contract file on a hosted runner (run 39372375641); unknown files weigh 5. */
export const CONTRACT_SECONDS = {
  "offlineSmokeProgress.contract.test.ts": 192, "a7Qualification.contract.test.ts": 160,
  "a7Reliability.contract.test.ts": 68, "smokeAdmission.contract.test.ts": 28,
  "a7Lifecycle.contract.test.ts": 20, "smokeAdmissionRuntime.contract.test.ts": 20,
};

/** Longest first onto the lightest shard. Deterministic for a given input. */
export function balance(files, n, weight) {
  const shards = Array.from({ length: n }, () => ({ files: [], load: 0 }));
  const sorted = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  for (const f of sorted) {
    const s = shards.reduce((m, x) => (x.load < m.load ? x : m), shards[0]);
    s.files.push(f); s.load += weight(f);
  }
  const out = shards.map((s) => s.files.sort());
  assertExact(files, out);
  return out;
}

export function assertExact(files, shards) {
  const flat = shards.flat();
  const want = new Set(files);
  if (flat.length !== want.size || new Set(flat).size !== flat.length || !flat.every((f) => want.has(f))) {
    throw new Error(`shard partition is not exact: ${files.length} file(s), ${flat.length} assigned`);
  }
}


// ── THE GATE ────────────────────────────────────────────────────────────────
//
// One check decides whether a commit is verified at its level. A job the plan
// required must have SUCCEEDED — skipped, cancelled or missing is a failure,
// never a pass. A job the plan did not require must have been SKIPPED (or have
// succeeded): a failure anywhere fails the gate. Success is not taken on
// trust: every contract shard reports how many files Deno actually ran, and
// they must add up to the plan's count; the mutation proofs must add up too —
// every shard reported, every shard walked the same list, and the proofs that
// ran account for every proof in it, which is at least MIN_PROOFS.

export const ALWAYS_REQUIRED = ["backend", "frontend", "replay"];

/**
 * @param i.needs    the workflow's `needs` context: { job: { result, outputs } }
 * @param i.contractTallies  parsed contract-shard tallies { shard, planned, ran }
 * @param i.contractShards   contract shard count the workflow ran (3)
 * @param i.tallies  parsed MUTATION_TALLY files, one per shard that reported
 * @param i.shards   mutation shard count the workflow ran
 * @param i.minProofs the floor on the number of proofs (64)
 */
export function gateVerdict(i) {
  const problems = [];
  const res = (j) => i.needs[j]?.result ?? "missing";
  if (res("plan") !== "success") {
    return { ok: false, level: null, problems: [`plan: ${res("plan")} — without a plan nothing is verified`] };
  }
  const out = i.needs.plan.outputs ?? {};
  const level = Number(out.level);
  if (![1, 2, 3].includes(level)) problems.push(`plan: no valid level (${out.level})`);
  for (const j of ALWAYS_REQUIRED) if (res(j) !== "success") problems.push(`${j}: required, ${res(j)}`);
  const conditional = { contract: out.contract === "true", mutation: out.mutation === "true" };
  for (const [j, required] of Object.entries(conditional)) {
    const r = res(j);
    if (required && r !== "success") problems.push(`${j}: required by the plan, ${r}`);
    if (!required && r !== "skipped" && r !== "success") problems.push(`${j}: not required, but ${r}`);
  }
  if (level === 3 && !conditional.mutation) problems.push("level 3 without the mutation proofs");
  if (level >= 2 && out.contract_all !== "true") problems.push(`level ${level} without the complete database contract`);
  if (conditional.contract) {
    // A shard that succeeded having run nothing must not pass: every planned
    // file must have been EXECUTED (counted from Deno's own output).
    const t = i.contractTallies ?? [];
    const seen = new Set(t.map((x) => x.shard));
    const want = Number(out.contract_count);
    if (t.length !== i.contractShards || seen.size !== i.contractShards) {
      problems.push(`contract: ${seen.size} of ${i.contractShards} shard tallies`);
    }
    for (const x of t) if (x.ran !== x.planned) problems.push(`contract shard ${x.shard}: ran ${x.ran} of ${x.planned} planned file(s)`);
    const planned = t.reduce((n, x) => n + x.planned, 0), ran = t.reduce((n, x) => n + x.ran, 0);
    if (!Number.isInteger(want) || want < 1) problems.push(`contract: the plan names no file count (${out.contract_count})`);
    else if (planned !== want || ran !== want) problems.push(`contract: ${ran} file(s) ran, ${planned} assigned, of ${want} planned`);
  }
  if (conditional.mutation) {
    const t = i.tallies ?? [];
    const seen = new Set(t.map((x) => x.shard));
    if (t.length !== i.shards || seen.size !== i.shards) problems.push(`mutation: ${seen.size} of ${i.shards} shard tallies`);
    if (t.some((x) => x.shards !== i.shards)) problems.push("mutation: a shard ran with a different shard count");
    const totals = new Set(t.map((x) => x.total));
    if (totals.size > 1) problems.push(`mutation: shards disagree on the proof count (${[...totals].join(", ")})`);
    const total = t[0]?.total ?? 0;
    const ran = t.reduce((n, x) => n + x.ran, 0);
    if (ran !== total) problems.push(`mutation: ${ran} proof(s) ran of ${total}`);
    if (total < i.minProofs) problems.push(`mutation: only ${total} proof(s) defined, expected at least ${i.minProofs}`);
  }
  return { ok: problems.length === 0, level, problems };
}
