#!/usr/bin/env node
// PR RISK — may Claude enable GitHub's native auto-merge on this pull request?
//
//   node scripts/dev/pr-risk.mjs <pr-number> [--sha <tested head sha>]
//
// Encodes the owner-approved policy (docs/launch/test-deploy-loop.md, "Auto-merge
// policy"). READ-ONLY: it fetches the PR and its file patches with `gh api` and
// prints a verdict; it never enables auto-merge, merges or writes anything.
//
//   auto_merge_eligible  every check passed; auto-merge may be enabled (GitHub still
//                        waits for the CI gate under the Active ruleset)
//   owner_required       a sensitive path or change: the owner merges it
//   not_eligible         wrong base, draft, closed, or the head moved since testing
//
// Conservative by construction: anything it cannot read (a patch GitHub omitted, a
// removed test) is owner_required. This file and its test are themselves on the
// sensitive list, so the gate cannot be loosened by an auto-merged PR.

import { execFileSync } from "node:child_process";

export const BASE = "launch/hardening";

/** Paths whose change always needs the owner's merge, with the reason shown. */
export const SENSITIVE_PATHS = [
  [/^\.github\//, "workflows / repository automation"],
  [/^scripts\/ci\//, "the CI gate and its planner"],
  [/^scripts\/deploy\//, "deploy and smoke scripts"],
  [/^scripts\/(supabase-target|verify-deploy-target)\.mjs$/, "Supabase project targeting"],
  [/^scripts\/dev\/pr-risk\.mjs$/, "the auto-merge policy itself"],
  [/^tests\/infra\/prRisk\.test\.ts$/, "the auto-merge policy's tests"],
  [/^supabase\/migrations/, "database schema (migrations)"],
  [/^supabase\/config\.toml$/, "Supabase project configuration"],
  [/^supabase\/functions\/_shared\/requestAuth\.ts$/, "authentication"],
  [/^supabase\/functions\/.*(?:^|\/)(?:auth|jwt|session)[A-Za-z]*\.tsx?$/i, "authentication"],
  [/^supabase\/functions\/_shared\/discoveryProviders\/(?:flags|budget|supabaseStore|connections)\.ts$/, "feature flags / spending ledger / provider keys"],
  [/^supabase\/functions\/_shared\/discoveryProviders\/adapters\//, "paid provider adapters"],
  [/^supabase\/functions\/_shared\/leadPipeline\/apifyInvoker\.ts$/, "paid Apify invoker and actor allowlist"],
  [/^supabase\/functions\/(?:provider-connections|lead-pipeline)\/index\.ts$/, "function wiring (keys, persistence)"],
  [/(?:^|\/)(?:phone|outreach|telnyx|twilio|send-scheduled-emails)[^/]*(?:\/|$)/i, "phone / outreach"],
  [/(?:^|\/)(?:package(?:-lock)?\.json|deno\.lock|deno\.jsonc?|import_map\.json|bun\.lockb|yarn\.lock|pnpm-lock\.yaml)$/, "dependencies"],
  [/^(?:railway\.json|netlify\.toml|Dockerfile|vercel\.json)$/, "hosting / production configuration"],
];

/** Changed lines (in non-test, non-doc code) that touch money, flags, secrets, auth or production. */
export const SENSITIVE_CONTENT = [
  [/ohsdatpvfdjdemstoiuj/, "names the production project"],
  [/\b(?:perItemUsd|perStartUsd|perItem|perStart|minimumUsd|emptyUsd|maxApifyUsd|max_apify_usd|maxLeadoceanRecords|max_leadocean_records|maxTotalChargeUsd|APOLLO_ACCESS_VALIDATED|PIPELINE_ACTORS|actorStatus|COMMERCIAL_TERMS\w*)\b/, "spending: prices, ceilings or actor allowlist"],
  [/\b[A-Z][A-Z0-9_]*_ENABLED\b/, "a feature flag"],
  [/\b(?:SERVICE_ROLE\w*|\w*API_KEY|\w*API_TOKEN|\w*ACCESS_TOKEN|secrets\.\w+|Deno\.env\.get|process\.env\.)/, "secrets / environment"],
  [/\b(?:verify_jwt|authenticateUser|getUser\(|auth\.uid)\b/, "authentication"],
];

const RECOVERY_RE = /\b(?:recover(?:y)?|rollback|roll back|revert|hotfix)\b/i;
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
  if (RECOVERY_RE.test(pr.title ?? "") || /recover/i.test(pr.branch ?? "")) owner.push("a recovery / rollback change");
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
