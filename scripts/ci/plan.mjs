#!/usr/bin/env node
// Decide this run's test plan (scripts/ci/planCore.mjs) and hand it to the
// workflow. Reads the event from the environment GitHub provides; any failure
// to read the diff makes the change set UNKNOWN, which runs everything the
// level allows — never less.
//
//   node scripts/ci/plan.mjs                 # in Actions: writes $GITHUB_OUTPUT
//   node scripts/ci/plan.mjs --base X --head Y --event pull_request --draft
//                                            # locally: prints the plan
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_SECONDS, balance, plan } from "./planCore.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = process.argv.slice(2);
const arg = (n) => { const k = args.indexOf(`--${n}`); return k >= 0 ? args[k + 1] : undefined; };

let event = process.env.GITHUB_EVENT_NAME ?? arg("event") ?? "pull_request";
let ref = process.env.GITHUB_REF ?? arg("ref") ?? "";
let draft = args.includes("--draft");
let base = arg("base"), head = arg("head");
const requested = process.env.REQUESTED_LEVEL || arg("level") || "auto";
if (process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)) {
  const e = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (event === "pull_request") {
    draft = e.pull_request?.draft === true;
    base = e.pull_request?.base?.sha; head = e.pull_request?.head?.sha;
  } else if (event === "push") {
    base = e.before; head = e.after;
  }
}

/** Changed paths, or null when they cannot be known exactly. */
function changedFiles() {
  if (!base || !head || /^0+$/.test(base)) return null;
  try {
    // Three dots: what the branch changed since it left its base.
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    console.error(`could not diff ${base}...${head}: ${e.message.split("\n")[0]}`);
    return null;
  }
}

const read = (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
const contractFiles = readdirSync(join(root, "tests/db-contract"))
  .filter((f) => f.endsWith(".contract.test.ts")).sort().map((f) => `tests/db-contract/${f}`);
const changed = event === "workflow_dispatch" ? null : changedFiles();

const p = plan({
  event, ref, draft, requested, changed, contractFiles,
  mutationScript: read("tests/db-contract/mutation.sh") ?? "", readFile: read,
});

// ── shards ──
const CONTRACT_SHARDS = 3;
const contractSelected = p.contract ? (p.contract_all ? contractFiles : p.contract_files) : [];
const contractShards = balance(contractSelected, CONTRACT_SHARDS,
  (f) => CONTRACT_SECONDS[f.replace("tests/db-contract/", "")] ?? 5);

const summary = [
  `## Test plan — level ${p.level}`,
  "",
  `| Suite | Runs |`, `|---|---|`,
  `| Fast checks (types, lint, UI, edge, infra, replay, build) | yes |`,
  `| Database contract | ${p.contract ? (p.contract_all ? "all files" : `${p.contract_files.length} file(s)`) : "no"} |`,
  `| Mutation proofs (all) | ${p.mutation ? "yes" : "no"} |`,
  "",
  `Changed paths: ${changed === null ? "unknown" : changed.length}`,
  `Contract files: ${contractSelected.length} in ${contractShards.filter((s) => s.length).length} non-empty shard(s)`,
  "",
  ...p.reasons.map((r) => `- ${r}`),
].join("\n");
console.log(summary);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `level=${p.level}`, `contract=${p.contract}`, `contract_all=${p.contract_all}`,
    `contract_files=${p.contract_files.join(" ")}`, `mutation=${p.mutation}`,
    // Real worker processes run whenever the database contract does.
    `realprocess=${p.contract}`,
    `contract_count=${contractSelected.length}`,
    ...contractShards.map((s, k) => `contract_shard_${k + 1}=${s.join(" ")}`), "",
  ].join("\n"));
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
