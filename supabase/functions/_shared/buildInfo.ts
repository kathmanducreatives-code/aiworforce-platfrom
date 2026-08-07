// GENERATED AT DEPLOY TIME by scripts/deploy-lead-intelligence.mjs.
//
// The committed values below are the LOCAL/UNDEPLOYED defaults. They are what a
// test run or a `deno run` sees, and they are deliberately obvious: a task row
// showing `git_sha: "local"` was produced by something that never went through
// the deploy script, which is itself worth knowing.
//
// Because `_shared` is bundled into each Edge Function at deploy time, each
// deployed function carries its own copy of this file — so the bundle knows
// which build it is, which is precisely what was missing when a stale
// pilot-chat and a fresh run-agent could not be told apart from a task row.
//
// DO NOT hand-edit. Regenerate by deploying.

export const BUILD_INFO = {
  git_sha: "local",
  build_timestamp: "1970-01-01T00:00:00.000Z",
  dirty: true,
} as const;
