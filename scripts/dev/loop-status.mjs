#!/usr/bin/env node
// LOOP STATUS — one short report for a pull request into launch/hardening.
//
//   node scripts/dev/loop-status.mjs <pr-number>
//
// READ-ONLY (`gh api` GETs only). Prints:
//   PR and commit · CI result · TEST deployment · smoke result · blockers
// The TEST deployment and smoke result come from the automated TEST deploy
// (.github/workflows/deploy-test-functions.yml): its run for the merge commit and
// the `agentory/test-smoke` commit status it records.

import { execFileSync } from "node:child_process";
import { classify, fetchPr, repoSlug } from "./pr-risk.mjs";

export const DEPLOY_JOB = "Deploy and smoke-test TEST";
const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));

/** Pure: summarise check runs into one line and the failing names. */
export function ciSummary(checkRuns) {
  const gate = checkRuns.find((c) => c.name === "CI gate");
  const failed = checkRuns.filter((c) => c.conclusion && !["success", "skipped", "neutral"].includes(c.conclusion)).map((c) => c.name);
  const pending = checkRuns.filter((c) => c.status !== "completed").length;
  const state = !gate ? (pending ? "running" : "no CI gate run") : gate.status !== "completed" ? "running" : gate.conclusion;
  return { state, failed, pending, total: checkRuns.length };
}

/** Pure: the TEST deployment and smoke verdict for a merge commit. */
export function deploySummary(run, smokeStatus) {
  if (!run) return { deploy: "not started", smoke: "—" };
  if (run.status !== "completed") return { deploy: `running (${run.html_url})`, smoke: "pending" };
  if (run.conclusion === "success" && !smokeStatus) return { deploy: "superseded by a newer merge (nothing deployed for this commit)", smoke: "—" };
  return {
    deploy: `${run.conclusion} (${run.html_url})`,
    smoke: smokeStatus ? `${smokeStatus.state}: ${smokeStatus.description}` : "not recorded",
  };
}

export function report(n, repo = repoSlug()) {
  const { pr, files } = fetchPr(n, repo);
  const raw = gh(`repos/${repo}/pulls/${n}`);
  const head = raw.head.sha, merge = raw.merged ? raw.merge_commit_sha : null;
  const ci = ciSummary(gh(`repos/${repo}/commits/${head}/check-runs?per_page=100`).check_runs);
  const lines = [`PR #${n} "${pr.title}" — ${raw.merged ? `merged as ${merge.slice(0, 12)}` : pr.state}${raw.auto_merge ? " (auto-merge enabled)" : ""}; head ${head.slice(0, 12)}`];
  lines.push(`CI: ${ci.state}${ci.failed.length ? ` — failed: ${ci.failed.join(", ")}` : ""} (${ci.total} checks)`);
  const blockers = [];
  if (ci.failed.length) blockers.push(`CI failed: ${ci.failed.join(", ")}`);
  if (merge) {
    const runs = gh(`repos/${repo}/actions/workflows/deploy-test-functions.yml/runs?head_sha=${merge}&per_page=5`).workflow_runs ?? [];
    const statuses = gh(`repos/${repo}/commits/${merge}/statuses?per_page=100`).filter((s) => s.context === "agentory/test-smoke");
    // The TEST deploy job also reports on the merge commit; it is shown on its own line, not as CI.
    const mergeCi = ciSummary(gh(`repos/${repo}/commits/${merge}/check-runs?per_page=100`).check_runs.filter((c) => c.name !== DEPLOY_JOB));
    const d = deploySummary(runs[0] ?? null, statuses[0] ?? null);
    lines.push(`CI on merge: ${mergeCi.state}`);
    lines.push(`TEST deployment: ${d.deploy}`);
    lines.push(`Smoke: ${d.smoke}`);
    if (statuses[0] && statuses[0].state !== "success") blockers.push(`TEST not READY: ${statuses[0].description}`);
    if (mergeCi.failed.length) blockers.push(`CI failed on the merge commit: ${mergeCi.failed.join(", ")}`);
  } else {
    const r = classify(pr, files);
    lines.push(`Auto-merge policy: ${r.verdict}`);
    if (r.verdict === "owner_required") blockers.push(`owner merge required: ${r.reasons.slice(0, 3).join("; ")}${r.reasons.length > 3 ? "; …" : ""}`);
    if (r.verdict === "not_eligible") blockers.push(...r.blockers);
  }
  lines.push(`Blockers: ${blockers.length ? blockers.join(" | ") : "none"}`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = process.argv[2];
  if (!/^\d+$/.test(n ?? "")) { console.error("usage: node scripts/dev/loop-status.mjs <pr-number>"); process.exit(2); }
  console.log(report(n));
}
