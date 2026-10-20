#!/usr/bin/env node
// The CI gate (scripts/ci/planCore.mjs, gateVerdict): the ONE check that says
// whether this commit is verified, and at which level. Exit 0 only on a pass.
//
//   NEEDS='${{ toJSON(needs) }}' TALLY_DIR=… MUTATION_SHARDS=8 MIN_PROOFS=64 node scripts/ci/gate.mjs
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gateVerdict } from "./planCore.mjs";

const needs = JSON.parse(process.env.NEEDS ?? "{}");
const dir = process.env.TALLY_DIR ?? "";
const tallies = [];
if (dir && existsSync(dir)) {
  for (const f of readdirSync(dir, { recursive: true })) {
    if (String(f).endsWith(".json")) tallies.push(JSON.parse(readFileSync(join(dir, String(f)), "utf8")));
  }
}
const v = gateVerdict({
  needs, tallies, shards: Number(process.env.MUTATION_SHARDS), minProofs: Number(process.env.MIN_PROOFS),
});
const sha = process.env.GITHUB_SHA ?? "(local)";
const name = { 1: "development", 2: "integration", 3: "FULL RELEASE" }[v.level] ?? "unknown";
const lines = v.ok
  ? [`## VERIFIED — level ${v.level} (${name}) on \`${sha}\``,
    ...(v.level === 3 ? ["", "Every suite, the complete database contract and every mutation proof passed on this exact commit."] : [])]
  : [`## NOT VERIFIED on \`${sha}\``, "", ...v.problems.map((p) => `- ${p}`)];
const jobs = Object.entries(needs).map(([j, n]) => `| ${j} | ${n.result} |`);
const tally = tallies.length
  ? [`Mutation proofs: ${tallies.reduce((n, t) => n + t.ran, 0)} of ${tallies[0].total} ran across ${tallies.length} shard(s).`] : [];
const summary = [...lines, "", "| Job | Result |", "|---|---|", ...jobs, "", ...tally].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
process.exit(v.ok ? 0 : 1);
