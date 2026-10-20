#!/usr/bin/env node
// The CI gate (scripts/ci/planCore.mjs, gateVerdict): the ONE check that says
// whether this commit is verified, and at which level. Exit 0 only on a pass.
//
//   NEEDS='${{ toJSON(needs) }}' TALLY_DIR=… CONTRACT_TALLY_DIR=… CONTRACT_SHARDS=3 \
//     MUTATION_SHARDS=8 MIN_PROOFS=64 node scripts/ci/gate.mjs
//
// WHICH COMMIT. On a pull request GitHub tests a temporary merge commit
// (GITHUB_SHA), not the branch head. The summary names both — the head the
// verdict belongs to, and the base it was merged onto — so "verified on this
// exact SHA" can be checked against the PR without guessing.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gateVerdict } from "./planCore.mjs";

const needs = JSON.parse(process.env.NEEDS ?? "{}");
const readTallies = (dir) => {
  const out = [];
  if (dir && existsSync(dir)) {
    for (const f of readdirSync(dir, { recursive: true })) {
      if (String(f).endsWith(".json")) out.push(JSON.parse(readFileSync(join(dir, String(f)), "utf8")));
    }
  }
  return out;
};
const tallies = readTallies(process.env.TALLY_DIR ?? "");
const contractTallies = readTallies(process.env.CONTRACT_TALLY_DIR ?? "");
const v = gateVerdict({
  needs, tallies, shards: Number(process.env.MUTATION_SHARDS), minProofs: Number(process.env.MIN_PROOFS),
  contractTallies, contractShards: Number(process.env.CONTRACT_SHARDS),
});
const event = process.env.GITHUB_EVENT_PATH && existsSync(process.env.GITHUB_EVENT_PATH)
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
const pr = event.pull_request;
const tested = process.env.GITHUB_SHA ?? "(local)";
// The commit the verdict belongs to: a pull request's HEAD, otherwise the pushed / dispatched commit.
const sha = pr?.head?.sha ?? tested;
const commit = pr
  ? [`Pull request #${pr.number} head \`${pr.head.sha}\`, tested as merge commit \`${tested}\` onto base \`${pr.base.ref}\` @ \`${pr.base.sha}\`.`]
  : [`Commit \`${tested}\` (${process.env.GITHUB_REF ?? "local"}).`];
const name = { 1: "development", 2: "integration", 3: "FULL RELEASE" }[v.level] ?? "unknown";
const lines = v.ok
  ? [`## VERIFIED — level ${v.level} (${name}) on \`${sha}\``,
    ...(v.level === 3 ? ["", "Every suite, the complete database contract and every mutation proof passed on this exact commit."] : [])]
  : [`## NOT VERIFIED on \`${sha}\``, "", ...v.problems.map((p) => `- ${p}`)];
const jobs = Object.entries(needs).map(([j, n]) => `| ${j} | ${n.result} |`);
const tally = tallies.length
  ? [`Mutation proofs: ${tallies.reduce((n, t) => n + t.ran, 0)} of ${tallies[0].total} ran across ${tallies.length} shard(s).`] : [];
const contract = contractTallies.length
  ? [`Contract files: ${contractTallies.reduce((n, t) => n + t.ran, 0)} ran of ${needs.plan?.outputs?.contract_count ?? "?"} planned across ${contractTallies.length} shard(s).`] : [];
const summary = [...lines, "", ...commit, "", "| Job | Result |", "|---|---|", ...jobs, "", ...contract, ...tally].join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
process.exit(v.ok ? 0 : 1);
