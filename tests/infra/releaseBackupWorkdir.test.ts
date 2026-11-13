// R1 HOTFIX: the production release script refused at "5. backups" with
// "could not back up pilot-chat; nothing was changed".
//
// Cause: the backup step ran `npm run supabase:prod -- functions download …` from
// inside `release-backups/r1-…`. The wrapper `scripts/supabase-target.mjs` then
// called `node scripts/verify-deploy-target.mjs` by a path relative to the
// CURRENT directory, which does not exist there, so every download failed, and
// the script discarded stderr, so the real error was invisible.
//
// These tests pin the fix: the wrapper resolves its helpers from the repo root
// wherever it is started, the release script runs downloads from the repo root
// into an explicit backup --workdir, shows sanitized diagnostics, and validates
// every backup before the first production write.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const STUBS = `${ROOT}/tests/release/stubs`;
const SCRIPT = await Deno.readTextFile(`${ROOT}/scripts/release/deploy-production-release.sh`);
const PROD_REF = "ohsdatpvfdjdemstoiuj";

async function runWrapper(cwd: string, env: Record<string, string>, args: string[]) {
  const out = await new Deno.Command("node", {
    args: [`${ROOT}/scripts/supabase-target.mjs`, ...args],
    cwd,
    env: { PATH: `${STUBS}:${Deno.env.get("PATH") ?? ""}`, STUB_LOG: "/dev/null", ...env },
    clearEnv: true,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
  return { code: out.code, text };
}

// ═══ THE ORIGINAL FAILURE: THE WRAPPER STARTED OUTSIDE THE REPO ROOT ═══════

for (const sub of ["tests/release", "supabase/functions", "scripts/release"]) {
  Deno.test(`wrapper verifies the production target when started from ${sub}/ (was: Cannot find module)`, async () => {
    const r = await runWrapper(`${ROOT}/${sub}`, { SUPABASE_TARGET: "production" },
      ["production", "--", "secrets", "list"]);
    assert(!r.text.includes("Cannot find module"), r.text);
    assertEquals(r.code, 0, r.text);
    assertStringIncludes(r.text, `OK: target ${PROD_REF} is the production project`);
    assertStringIncludes(r.text, `--project-ref ${PROD_REF}`);
  });
}

Deno.test("wrapper still refuses production without SUPABASE_TARGET=production, from any directory", async () => {
  const r = await runWrapper(`${ROOT}/tests/release`, {}, ["production", "--", "secrets", "list"]);
  assert(r.code !== 0, r.text);
  assert(!r.text.includes("running: supabase"), r.text);
});

Deno.test("a failing CLI exits with its own status and message, not a Node stack trace", async () => {
  const r = await runWrapper(`${ROOT}/tests/release`, { SUPABASE_TARGET: "production", STUB_DOWNLOAD: "fail" },
    ["production", "--", "functions", "download", "pilot-chat", "--workdir", "/nonexistent-backup-dir"]);
  assertEquals(r.code, 1);
  assertStringIncludes(r.text, "unexpected status 401");
  assert(!r.text.includes("at execFileSync"), r.text);
});

// ═══ THE RELEASE SCRIPT'S BACKUP STEP ══════════════════════════════════════

const lines = SCRIPT.split("\n");
const firstWrite = lines.findIndex((l) => /^\s*(\[.*\]\s*&&\s*)?p secrets set\b/.test(l));
const downloads = lines.map((l, i) => [l, i] as const).filter(([l]) => /\bp functions download\b/.test(l));

Deno.test("every backup download runs through the wrapper into the explicit backup workdir", () => {
  assert(downloads.length >= 2, "expected the --use-api download and its fallback");
  for (const [l] of downloads) {
    assertStringIncludes(l, '--workdir "$BK"');
    assert(!/cd\s+"?\$BK/.test(l), `download must not cd into the backup dir: ${l}`);
    assert(!/2>\s*\/dev\/null|>\s*\/dev\/null/.test(l), `download output must be logged, not discarded: ${l}`);
  }
  // p() itself must run the wrapper from the repo root.
  const p = lines.find((l) => /^p\(\)/.test(l)) ?? "";
  assertStringIncludes(p, '"$ROOT"');
});

Deno.test("no line changes into the backup directory and then calls the wrapper", () => {
  for (const l of lines) {
    if (/cd\s+"?\$BK/.test(l)) assert(!/\bp\s+\w/.test(l.replace(/^.*cd\s+"?\$BK"?/, "")), l);
  }
});

Deno.test("backups are validated, checked against the repo, and manifested before the first production write", () => {
  assert(firstWrite > 0, "secrets set not found");
  const before = (re: RegExp, what: string) => {
    const i = lines.findIndex((l) => re.test(l));
    assert(i > 0 && i < firstWrite, `${what} must come before the first production write (line ${i} vs ${firstWrite})`);
  };
  for (const [, i] of downloads) assert(i < firstWrite, "download after the first write");
  before(/has no source files/, "the empty-backup refusal");
  before(/implausibly small/, "the size check");
  before(/Deno\\\.serve\|serve/, "the entry-point check");
  before(/changed the repository's supabase\/functions/, "the repo-unchanged check");
  before(/MANIFEST\.sha256/, "the manifest");
  // No functions deploy before backups either.
  const firstDeploy = lines.findIndex((l) => /\bp functions deploy\b/.test(l) || /deploy_fn /.test(l) && !/^deploy_fn\(\)/.test(l));
  assert(firstDeploy === -1 || firstDeploy > firstWrite, "a deploy precedes the backups");
});

Deno.test("refusals print sanitized diagnostics", () => {
  const refusals = lines.filter((l) => /refusing: (could not back up|backup of \$fn has no source)/.test(l));
  assert(refusals.length >= 1);
  const block = SCRIPT.slice(SCRIPT.indexOf("refusing: could not back up"));
  assertStringIncludes(block.slice(0, 300), "| sanitize");
});

Deno.test("sanitize redacts tokens, keys, JWTs and credentials", async () => {
  const fn = lines.slice(lines.findIndex((l) => l.startsWith("sanitize()")),
    lines.findIndex((l) => l.startsWith("sanitize()")) + 6).join("\n");
  const secret = [
    "token sbp_0123456789abcdef0123456789abcdef0123 rejected",
    "key sb_secret_AbCdEfGhIjKlMnOp and sb_publishable_AbCdEfGhIjKlMnOp",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl",
    "url?password=hunter2hunter2&x=1 apikey abcdef123456",
  ].join("\n");
  const out = await new Deno.Command("bash", {
    args: ["-c", `${fn}\nsanitize`],
    stdin: "piped", stdout: "piped",
  }).spawn();
  const w = out.stdin.getWriter();
  await w.write(new TextEncoder().encode(secret));
  await w.close();
  const text = new TextDecoder().decode((await out.output()).stdout);
  for (const leak of ["0123456789abcdef0123", "AbCdEfGhIjKlMnOp", "eyJhbGciOiJIUzI1NiJ9", "hunter2", "abcdef123456"]) {
    assert(!text.includes(leak), `leaked ${leak}: ${text}`);
  }
  assertStringIncludes(text, "sbp_<redacted>");
});

// ═══ APP RELEASE SHA vs DEPLOYMENT-TOOL SHA ════════════════════════════════

Deno.test("the approved app commit is built from its own worktree and stamped with that SHA", () => {
  assertStringIncludes(SCRIPT, '--sha <APP_SHA> --tool-sha <TOOL_SHA>');
  assert(/\[ "\$\(git rev-parse HEAD\)" = "\$TOOL_SHA" \]/.test(SCRIPT), "HEAD must equal the tool SHA");
  assertStringIncludes(SCRIPT, 'git merge-base --is-ancestor "$APP_SHA" HEAD');
  assertStringIncludes(SCRIPT, 'git worktree add --detach "$BUILD_TREE" "$APP_SHA"');
  assert(/"sha": ?"?\$APP_SHA/.test(SCRIPT) || SCRIPT.includes('\\"sha\\": \\"$APP_SHA\\"') || /sha.*\$APP_SHA/.test(
    lines.find((l) => /stamp/.test(l) && /APP_SHA/.test(l)) ?? ""), "bundles must be stamped with the app SHA");
  assertStringIncludes(SCRIPT, "--confirm $REF");
});

Deno.test("deployment scope is unchanged: the same five functions and flags", () => {
  for (const fn of ["pilot-chat", "daily-brief", "generate-company-brain-draft", "setup-company-brain", "company-brain-memory"]) {
    assertStringIncludes(SCRIPT, fn);
  }
  assertStringIncludes(SCRIPT, "p secrets set AGENTORY_DELEGATION_ENABLED=false AGENTORY_ORION_EVIDENCE_CONTEXT=true");
  assert(!/\bp db (push|reset)\b|migration up/.test(SCRIPT), "the release script must not touch the database");
});
