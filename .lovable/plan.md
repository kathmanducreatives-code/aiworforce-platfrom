## Blocker: branch/PR creation not supported in Lovable

Your release rule requires:

> Create a focused frontend branch `company-brain-tab-state-draft-persistence-v1`. Do not write directly to main. … Push the branch and open one PR into main. Do not merge.

Lovable's build environment commits directly to the canonical `main` branch this project is synced to. I cannot:

- create a new branch (`company-brain-tab-state-draft-persistence-v1`)
- push to a non-`main` branch
- open a pull request into `main`
- prevent changes from flowing into `main` once files are written

Any file edit I make becomes a commit on `main`. That is incompatible with the "do not write directly to main / open one PR / do not merge" rule.

Per your own instruction, I am stopping before modifying any files.

## What I need from you to proceed

Pick one:

1. **Do the work in your own git checkout.** I stay read-only here and deliver a detailed implementation spec (root causes for the full-page reload and draft loss, exact files to change, cache/stale-time settings, draft key scheme, dirty-guard contract, test matrix). Your engineer or Claude Code applies it on branch `company-brain-tab-state-draft-persistence-v1` and opens the PR.
2. **Waive the branch/PR rule for this task only.** I implement the frontend-only changes directly on `main` in Lovable (still no deploy, no publish, no edge functions, no migrations, no schema/secret/provider changes, no provider/model calls). You review the resulting commits on `main` before publishing.
3. **Scope down to a read-only audit + spec.** No code changes at all; I produce the proven root causes, the caching strategy, the draft-persistence contract, the workspace/user scoping rules, and the full test matrix as a written spec you can hand off.

## Confirmed guardrails either way

Regardless of option, I will not: deploy edge functions, publish the frontend, apply migrations, change schema, change secrets, change provider flags, call providers/models, or write to the production DB.

Reply with 1, 2, or 3 and I'll proceed accordingly.