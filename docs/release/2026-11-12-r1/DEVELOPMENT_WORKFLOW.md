# One source of truth (after R1)

| Concern | Rule |
|---|---|
| **Integration branch** | `launch/hardening`. All work merges here by PR. `main` (2026-05-22) is stale; either retire it or fast-forward it to `launch/hardening` on each release (decide once). |
| **Production release** | Only a recorded, clean commit of `launch/hardening`, deployed by a script or workflow that: refuses a moved baseline, backs up what it replaces, stamps the SHA into each function (`x-agentory-build`), and verifies after. R1's `scripts/release/deploy-production-release.sh` is the template. Next step: move it into a `workflow_dispatch` job with the `production` environment's required reviewers. |
| **Frontend** | One hosting target bound to `ohsdatpvfdjdemstoiuj`. In Lovable, disconnect any Lovable-managed Supabase (`wqnig…` / `zbws…`) so builds cannot repoint. After every publish, run the live-bundle check: production ref present, no foreign refs. |
| **TEST / staging** | `tlvnfrxzjhsjgdofwehb` for agent and discovery work (Company Brain blocked by design). For Company Brain-dependent features, use production's own workspace (no customers) until a Brain-enabled staging project is approved. |
| **CI/CD** | `ci.yml` on every PR. Add three things: `test:vitest` for the vitest files under `src/`; the Deno-style `src/**` tests (35 files, currently in no runner); and the DB contract lane. `deploy-test-functions.yml` deploys TEST on merge (extend it to the bundled `pilot-chat`). |
| **Deployment manifest** | `docs/release/<date>-<name>/RELEASE_MANIFEST.md` per release, listing the function → SHA and migration → sha256 that were deployed. Live truth is always the `x-agentory-build` header. |
| **Migrations** | Production history is not authoritative (21 repo migrations unrecorded while their objects exist). From R1 on: apply each migration through one channel, record it, and keep a held/rollback pair. Before each release, run a catalog diff against production (as done here). |
| **Local development** | One canonical checkout on `launch/hardening` with `.env.local` pointing at TEST; worktrees for feature branches; `~/Projects/agentory` (uncommitted work) left untouched until you export it. |
| **Monitoring and rollback** | `ops-health` (production) plus the `ops-health.yml` schedule. Function backups per release (`release-backups/`, gitignored). Lovable version history for the frontend. |
