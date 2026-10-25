# Company Brain readiness v2: rollout, rollback and cross-device behaviour

Company Brain roadmap **Phase 2**. Two switches, both **off by default**:

| Switch | Where | Read by |
|---|---|---|
| `BRAIN_READINESS_V2` | edge function secret (`1` / `true` / `on`) | `pilot-chat`, `run-agent` |
| `VITE_BRAIN_READINESS_V2` | frontend build env (`true`) | the route guard, the Signals / Leads / Content notices, onboarding autosave |

With both off, every gate behaves as before. The tests pin this:
- `brainReadinessFrontend.test.ts` F-6 checks all 192 route-guard states, and F-7 checks that autosave never starts;
- `brainReadinessGate.test.ts` G-7 and G-8 check that the original chat gate and prompt context are used and no readiness is computed.

## What the rule is

`companyBrainReadiness(brain, activated)` is mirrored in `src/lib`, with a parity test.

| Capability | Minimum | Owner decision (2026-10-23) |
|---|---|---|
| `read_only` (dashboard, results, settings) | none | |
| `signals` | industries **or** must-haves | |
| `lead_search` | industries **and** (buyers **or** must-haves) | allowed before activation |
| `content` (drafts) | a company description **and** (a pain point **or** a content angle) | drafts allowed; a person approves before anything is published |
| `outreach` | an activated Brain **and** a positioning promise | |

**States:**
- `draft`: nothing usable;
- `usable`: at least one capability, not activated;
- `ready`: activated.

Readiness decides only whether the Brain holds enough **context**. Mission admission, credits, evidence requirements and qualification are unchanged and still run afterwards.

**Content is never published automatically.** Generation writes `content_item.status = "draft"`, only a person's approval in the editor sets `approved`, and no code publishes (test G-6).

## What changes with the switches on

| Surface | Before | With v2 |
|---|---|---|
| Chat (`pilot-chat`) | `source` / `research` / `compose` refused until activated | refused only if that capability's minimum is missing; the reply names what to add |
| Prompt context (`pilot-chat`, `run-agent`) | only an activated Brain is injected | a `usable` Brain is injected too, so admitted work never runs context-free |
| Routing | every page redirects to onboarding until activated | a `usable` Brain opens the app; an empty `draft` still goes to onboarding |
| Signals / Leads / Content pages | no notice | a notice lists what to add (guidance only; the server enforces) |
| Onboarding | progress only in the tab (`sessionStorage`) | progress also saved to the server and resumed on any device |
| Radar | degraded scan for an un-activated Brain | **unchanged**: still the cautious scan (half caps, nothing marked verified). Aligning it is a compiler change, coordinated in #165 |

## Onboarding progress across devices

**Where it's stored:** `company_brain.profile.onboarding_meta.setup` = `{ version: 1, step, answers, updated_at }`.

**What's stored:**
- `answers`: the wizard's own form fields only (company and founder forms, first goal), trimmed, at most 2,000 characters each and 8 KB in total;
- **never** `enrichment_consent`: consent is recorded by its own path and never restored from saved progress;
- research results are never stored there.

**How it's saved:**
- `save_draft` with `setup` saves progress. The Brain itself isn't written: the autosave patch is empty.
- **Versioned:** a save carrying `setup` must send `expected_updated_at`, and it is written only if that's still the stored version (a conditional update).
- A save **without** `setup` behaves exactly as before, so older clients are unaffected.

**Resume:**
- On load, the newer of the server copy and this tab's buffer wins.
- A tie, or a buffer with no readable time, goes to the server.

**Concurrent edits:** a stale save returns **409 with the current copy**, and the client merges field by field against the copy it last saved:

| This tab | Other device | Result |
|---|---|---|
| changed | unchanged | this tab's value |
| unchanged | changed | the other device's value |
| same change | same change | kept once |
| different change | different change | **the other device's value is kept**; this tab's value is shown in a notice ("Kept the other device's name. Yours: …"). Nothing typed disappears silently |
| cleared | unchanged | stays cleared (a clear is a change) |

The step becomes the furthest either side reached, and the merge is saved again on top of the other device's version.

**Activation:**
- Activation clears the progress record.
- An activated Brain is **never** autosaved: a draft save there would set the stored `setup_status` to "in progress". Re-running setup on an activated Brain keeps the explicit Save draft.

**Offline:** if a save fails, the status reads "Offline — saved in this tab". The tab's buffer still holds everything, and the next change retries.

**Browser check:** a two-device harness (a shared fake server running the real progress logic and version check) confirmed:
- device B resumes A's step and values;
- a concurrent rename merges with B's new description;
- a conflicting rename keeps the other device's value and shows B's.

## Rollout (each step needs separate approval)

1. **Deploy with both switches off.**
   - Functions: `generate-company-brain-draft`, `pilot-chat`, `run-agent` (plus the worker, which bundles `run-agent`).
   - Nothing changes for users: no client sends `setup` yet, and the gates read the switch.
2. **Smoke on a test workspace, switch still off:**
   - chat refuses `source` on an un-activated Brain with the original reply;
   - `save_draft` without `setup` is unchanged.
3. **Turn on `BRAIN_READINESS_V2`** (edge secret). Check on a test workspace:
   - an un-activated Brain with industries plus a buyer can run lead search;
   - the same Brain with industries only gets the "add a buyer persona" reply;
   - outreach is still refused until activation.
4. **Build and publish the frontend with `VITE_BRAIN_READINESS_V2=true`.** Check:
   - a usable workspace opens the dashboard and Signals and sees the notices;
   - onboarding resumes in a second browser.
5. **Watch:**
   - `gated: "brain_not_ready"` replies in chat logs;
   - save_draft 409 rates;
   - no change in admission refusals or spend.

The backend switch goes on **before** the frontend's. The frontend only lets usable workspaces in; the backend decides what they can do.

## Rollback

| Problem | Action | Effect |
|---|---|---|
| Wrong chat gating or context | turn `BRAIN_READINESS_V2` off | instantly back to the activation-only gate and context; no redeploy |
| Routing or onboarding problem | rebuild the frontend with `VITE_BRAIN_READINESS_V2` unset | the original guard and tab-only progress; stored progress records are ignored |
| Code itself | redeploy the previous function versions (deploy workflow backup) and the previous frontend | stored `onboarding_meta.setup` is inert to the old code |

No migration and no new table: progress lives in the existing `profile` JSON.
