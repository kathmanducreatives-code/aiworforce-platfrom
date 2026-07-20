## Blocker: branch/PR creation not supported in Lovable

Your release rule requires:

> Create a focused frontend branch `workbench-lead-detail-sync-ux-v1`. Do not write directly to main. If branch/PR creation is not supported, stop before modifying files and report that limitation.

Lovable's build environment commits directly to the canonical `main` branch that this project is synced to. I cannot:

- create a new branch (`workbench-lead-detail-sync-ux-v1`)
- push to a non-`main` branch
- open a pull request into `main`
- prevent changes from flowing into `main` once files are written

Any file edit I make here becomes a commit on `main`. That is incompatible with the "do not write directly to main / open one PR / do not merge" rule.

Per your own instruction, I am stopping before modifying any files.

## What I need from you to proceed

Pick one:

1. **Do the work in your own git checkout.** I stay read-only here. I can instead deliver a detailed implementation spec (file list, canonical account-view shape, resolver contracts, guard rules, test list) that your engineer or Claude Code applies on branch `workbench-lead-detail-sync-ux-v1` and opens the PR from.
2. **Waive the branch/PR rule for this task only.** I implement the frontend-only changes directly on `main` in Lovable (still no deploy, no publish, no edge functions, no migrations, no schema/secret/provider changes). You review the resulting commits on `main` before publishing.
3. **Scope down to a read-only audit + spec.** No code changes at all; I produce the canonical view model, resolver, scoping rules, and test matrix as a written spec you can hand off.

## Confirmed guardrails either way

Regardless of option, I will not: deploy edge functions, publish the frontend, apply migrations, change schema, change secrets, change provider flags, call providers/models, or write to the production DB.

Reply with 1, 2, or 3 and I'll proceed accordingly.