# Deploying lead-intelligence Edge Functions

## The rule that caused an incident

**Supabase bundles `_shared` INTO each Edge Function at deploy time.**
Changing a file under `supabase/functions/_shared/` does **not** update any
already-deployed function. Every function that imports it — directly or
transitively — must be redeployed, or it keeps running its old copy.

On 2026-08-07 `leadPaidExecutionPreflight.ts` was changed twice and only
`run-agent` was redeployed. `pilot-chat`, which is where `compileLeadMission()`
actually runs, kept executing an Aug 6 bundle. Missions reached the executor
with `directives: null`, the pre-spend guard blocked them, and the failure
looked like a code bug for half a day. The guard was right; the deploy was
incomplete.

## The second half of the trap

**`supabase secrets set` is NOT a code deployment.**

It increments a function's `VERSION` and re-binds its environment, for *every*
function, without deploying any code. During the incident `pilot-chat` read
version 94 → 95 → 96 while its code sat unchanged from Aug 6. Rising version
numbers looked like successful deploys.

| Field | Means |
|---|---|
| `VERSION` | bumped by `secrets set` too — **not** proof of a code deploy |
| `UPDATED_AT` | the last actual **code** deployment — trust this one |

## Use the script

```bash
node scripts/deploy-lead-intelligence.mjs --dry-run   # show the set, deploy nothing
node scripts/deploy-lead-intelligence.mjs             # deploy all of them to TEST
```

It **derives** the function set by following imports from each function's
`index.ts` through `_shared`, transitively. It is deliberately not a hardcoded
list: a hardcoded list goes stale the first time somebody adds an import, which
is the same class of bug this script exists to prevent. The dry run found
`orchestrate` in the set via a transitive `leadMission.ts` import that a
hand-written map had missed.

It runs `verify-deploy-target.mjs` first, deploys in order, **fails immediately**
on any error (a partial deploy across functions sharing code is exactly the
broken state to avoid), then prints `UPDATED_AT` for each function and the
digests of the workspace allow-lists.

TEST only, by construction — the project ref is pinned in the script and the
target guard runs before anything is deployed.

## After changing anything under `_shared/`

1. `node scripts/deploy-lead-intelligence.mjs --dry-run` — check which functions
   are implicated and how stale they are.
2. Deploy the whole set, not the one function you were working on.
3. Confirm every `UPDATED_AT` moved. If one did not, that function is still
   running old shared code.
