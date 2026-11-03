#!/usr/bin/env node
// PR RISK — may Claude enable GitHub's native auto-merge on this pull request?
//
//   node scripts/dev/pr-risk.mjs <pr-number> [--sha <tested head sha>]
//
// Encodes the owner-approved policy (docs/launch/test-deploy-loop.md, "Autonomous
// merge policy", authorised 2026-11-02). READ-ONLY: it fetches the PR and its file
// patches with `gh api` and prints a verdict; it never enables auto-merge, merges or
// writes anything.
//
//   auto_merge_eligible  Claude may enable GitHub's native auto-merge; GitHub still
//                        merges only when the Active ruleset is satisfied (CI gate)
//   owner_required       production, GitHub permissions, database schema, paid-provider
//                        enablement, phone/outreach, a deleted test, or this policy itself
//   not_eligible         wrong base (production branches never), draft, closed, or the
//                        head moved since testing
//
// Routine code, edge functions, CI/CD and TEST deploy workflows, dependencies,
// tooling, docs, auth and flag code, and recovery PRs are eligible: the owner
// authorised them, and the CI gate and TEST smoke suite still have to pass.
// Conservative where it cannot read: an omitted diff is owner_required.

import { execFileSync } from "node:child_process";

export const BASE = "launch/hardening";

/** Paths whose change still needs the owner's merge, with the reason shown. */
export const SENSITIVE_PATHS = [
  [/^\.github\/workflows\/(?:deploy-production-[^/]*|deploy-held-back-functions)\.ya?ml$/, "a production deployment workflow"],
  [/^\.github\/(?:CODEOWNERS|settings\.ya?ml|rulesets?\/)/, "GitHub permissions / repository settings"],
  [/^scripts\/(?:supabase-target|verify-deploy-target)\.mjs$/, "production project targeting"],
  [/^scripts\/dev\/pr-risk\.mjs$/, "the merge policy itself"],
  [/^tests\/infra\/prRisk\.test\.ts$/, "the merge policy's tests"],
  [/^supabase\/migrations/, "database schema (migrations)"],
  // Option E: what a stored mission MEANS is the owner's decision (Stage 1 baseline,
  // Stage 7 production replay gate and its approvals).
  [/^tests\/fixtures\/mission-semantics\/baseline\.json$/, "a change in what a stored mission means (semantic baseline)"],
  [/^tests\/fixtures\/mission-semantics\/production-replay-approved\.json$/, "an approval to change existing production missions' meaning"],
  [/^scripts\/dev\/production-replay\.ts$/, "the production semantic replay gate"],
  // ATLAS review Stage 0: qualification verdicts and the labelled corpus are owner decisions.
  [/^tests\/fixtures\/atlas-eval\/verdict-baseline\.json$/, "a change in stored candidates' qualification verdicts"],
  [/^tests\/fixtures\/atlas-eval\/v\d+\/corpus\.json$/, "the labelled evaluation corpus (owner policy and labels)"],
  [/^scripts\/dev\/verdict-replay\.ts$/, "the qualification-verdict replay gate"],
  [/(?:^|\/)(?:phone|outreach|telnyx|twilio|send-scheduled-emails)[^/]*(?:\/|$)/i, "phone / outreach"],
  [/^(?:railway\.json|netlify\.toml|Dockerfile|vercel\.json)$/, "production hosting configuration"],
];

/** Changed lines (in non-test, non-doc files) that reach production, permissions or paid-provider enablement. */
export const SENSITIVE_CONTENT = [
  [/ohsdatpvfdjdemstoiuj/, "names the production project"],
  [/\benvironment:\s*production\b/, "uses the production environment"],
  [/\b[a-z][a-z-]*:\s*write\b/, "grants a GitHub token write permission"],
  [/\b(?:perItemUsd|perStartUsd|perItem|perStart|minimumUsd|emptyUsd|maxApifyUsd|max_apify_usd|maxLeadoceanRecords|max_leadocean_records|maxTotalChargeUsd|APOLLO_ACCESS_VALIDATED|PIPELINE_ACTORS|actorStatus|COMMERCIAL_TERMS\w*)\b/, "paid providers: prices, ceilings or actor allowlist"],
];

const EXEMPT_FROM_CONTENT = /^(?:tests\/|docs\/|[^/]+\.md$)/;

/**
 * Pure. `pr`: { base, state, draft, title, head, branch }, `files`: [{ filename, status, patch? }].
 * `testedSha`: the head the tests ran on (optional; checked when given).
 *
 * @param {{ base: string, state: string, draft?: boolean, title?: string, head: string, branch?: string }} pr
 * @param {{ filename: string, status?: string, patch?: string | null, previous_filename?: string }[]} files
 * @param {string | null} [testedSha]
 */
export function classify(pr, files, testedSha = null) {
  const blockers = [], owner = [];
  if (pr.base !== BASE) blockers.push(`targets ${pr.base}, not ${BASE}`);
  if (pr.state !== "open") blockers.push(`PR is ${pr.state}`);
  if (pr.draft) blockers.push("PR is a draft");
  if (testedSha && testedSha !== pr.head) blockers.push(`head moved: tested ${testedSha.slice(0, 12)}, PR head ${String(pr.head).slice(0, 12)}`);
  if (!files.length) owner.push("no changed files listed (cannot review)");
  for (const f of files) {
    const path = f.filename;
    for (const [re, why] of SENSITIVE_PATHS) if (re.test(path)) owner.push(`${path}: ${why}`);
    if (f.status === "removed" && /^tests\//.test(path)) owner.push(`${path}: a test is deleted`);
    if (f.previous_filename) for (const [re, why] of SENSITIVE_PATHS) if (re.test(f.previous_filename)) owner.push(`${f.previous_filename} (renamed): ${why}`);
    if (EXEMPT_FROM_CONTENT.test(path)) continue;
    if (f.patch == null) { if (f.status !== "removed") owner.push(`${path}: diff not available for review`); continue; }
    const changed = f.patch.split("\n").filter((l) => /^[+-]/.test(l) && !/^(?:\+\+\+|---)/.test(l)).join("\n");
    for (const [re, why] of SENSITIVE_CONTENT) if (re.test(changed)) owner.push(`${path}: ${why}`);
  }
  const reasons = [...new Set(owner)];
  return {
    verdict: blockers.length ? "not_eligible" : reasons.length ? "owner_required" : "auto_merge_eligible",
    blockers, reasons,
  };
}

function gh(path) {
  return JSON.parse(execFileSync("gh", ["api", "--paginate", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

export function repoSlug() {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url) ?? /\/git\/([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`cannot read the GitHub repository from ${url}`);
  return m[1];
}

export function fetchPr(n, repo = repoSlug()) {
  const p = gh(`repos/${repo}/pulls/${n}`);
  const files = gh(`repos/${repo}/pulls/${n}/files?per_page=100`);
  return {
    pr: { number: p.number, base: p.base.ref, state: p.merged ? "merged" : p.state, draft: p.draft, title: p.title, head: p.head.sha, branch: p.head.ref },
    files,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = process.argv[2];
  const i = process.argv.indexOf("--sha");
  if (!/^\d+$/.test(n ?? "")) { console.error("usage: node scripts/dev/pr-risk.mjs <pr-number> [--sha <tested head>]"); process.exit(2); }
  const { pr, files } = fetchPr(n);
  const r = classify(pr, files, i > 0 ? process.argv[i + 1] : null);
  console.log(JSON.stringify({ pr: pr.number, head: pr.head, files: files.map((f) => f.filename), ...r }, null, 2));
}
