# R1.1 rollback

R1.1 changes one thing in production: the `pilot-chat` function. No secret, no database row and no other function changes, so rollback means redeploying the previous `pilot-chat`.

## Primary: from the validated backup the deploy made

`--deploy` downloads the live `pilot-chat` (R1, `3bef8fd0`) into `release-backups/r11-<UTC>/` before deploying. It validates the backup and writes `MANIFEST.sha256` and `STATE` there. To roll back:

```bash
scripts/release/deploy-r11-pilot-chat.sh --rollback --confirm ohsdatpvfdjdemstoiuj --backup release-backups/r11-<UTC>
```

It:
1. refuses a backup whose files do not match the manifest;
2. redeploys the backed-up source (no build, no secrets);
3. verifies `x-agentory-build` equals the build recorded in `STATE`, and that a no-token POST returns 401.

## Fallback: rebuild R1's pilot-chat from git

Use this if the backup is lost. Build `pilot-chat` from a clean worktree of `3bef8fd03998c4133b9bebaf87acdd03a3dad5f9` with `scripts/test-project/build-pilot-chat-bundle.mjs <out> pilot-chat production`, then deploy it with `npm run supabase:prod -- functions deploy pilot-chat --use-api --workdir <out>`.

Do **not** use the R1 release script for this. It deploys five functions and sets flags.

## What a rollback does not need

- **Secrets:** unchanged by R1.1.
- **Database:** R1.1 has no migration.
- **Frontend:** the draft chip renders only when a message carries `metadata.orion_draft`. Older messages keep it; nothing new is marked.
