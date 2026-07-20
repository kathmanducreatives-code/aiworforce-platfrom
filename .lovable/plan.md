## Goal

Replace the right-side ICP edit Sheet with a premium centered Dialog editor that visually belongs to the Company Brain page. Frontend-only, no backend/contract changes. All six sections (company, targeting, buyers, signals, disqualifiers, messaging) use the same editor shell — Target Market/targeting gets the richest grouped layout.

## Files to change

- **Rewrite** `src/components/company-brain/CompanyBrainEditDrawer.tsx` — swap `Sheet` for `Dialog`, keep the exported default component name and `Props` (so `CompanyBrainDashboard.tsx` needs no change). Internally rename the shell to `CompanyBrainEditorDialog` and re-export as default.
- **New** `src/components/company-brain/editor/EditorShell.tsx` — centered glass modal shell (backdrop blur, header, section-context strip, sticky footer, dirty-state, focus trap via Radix Dialog, Escape guard, reduced-motion aware).
- **New** `src/components/company-brain/editor/EditorField.tsx` — label/helper/error primitive + `FieldGroup` glass panel wrapper.
- **New** `src/components/company-brain/editor/TargetingEditorPanel.tsx` — grouped Target Market layout (Market Definition / Company Size / Must-have / Optional).
- **New** `src/components/company-brain/editor/sections/*` — thin wrappers for the five other sections reusing existing `ChipInput`/`Input`/`Textarea` inside `FieldGroup`s.
- **New tests** `src/components/company-brain/editor/__tests__/CompanyBrainEditor.test.tsx` — covers the 22 test items (rendered as Dialog not Sheet, chip render/wrap, numeric min/max, size label, save payload equality vs current `buildPatch`, cancel/dirty, escape guard, focus trap presence, sticky header/footer nodes, no network calls via fetch spy).

## Layout

Centered `Dialog` (Radix, already in the app):

- container: `w-[min(1040px,calc(100vw-64px))] max-h-[calc(100vh-72px)] rounded-3xl` with translucent dark-emerald glass (`bg-card/55 backdrop-blur-2xl backdrop-saturate-150`), thin emerald border, soft outer shadow, top hairline.
- backdrop: existing Radix overlay, tuned to `bg-background/60 backdrop-blur-sm` (page faintly visible, no harsh black).
- structure: sticky header → context strip (`Section N of 5 · <title>`) → scroll body → sticky footer.
- mobile (`<640px`): near full-width, rounded top corners, single column, sticky footer.

## Header

- Icon tile (emerald glass) + eyebrow `COMPANY BRAIN` + title (`Edit ICP & Targeting` for `targeting`, mapped titles for other sections) + one-line description.
- Right: dirty dot ("Unsaved changes"), close button.

## Section navigation

Compact non-interactive stepper pills for the five sections + a `Section N of 5 · <title>` context label. Not clickable (each section is opened from the dashboard picker; we don't fake unsupported cross-section nav).

## Target Market form grouping

Two-column grid (`md:grid-cols-2`, `md:grid-cols-3` for size row), full-width for tag fields.

- **Market Definition** panel: Industries (full), Business models + Company stage row, Geography (full).  
  Note: current schema exposes `industries`, `business_models`, `geography`, `funding_stage`. There is no separate `stage` field on `target_customer` — we map "Company stage" to existing `funding_stage` (already saved via the same `buildPatch`). No schema change.
- **Company Size** panel: min / max / label in a 3-column row plus live "Qualified range: X–Y employees" helper (pure derived text). Numbers stay strings in state (matches current `buildPatch`).
- **Must-have traits** panel: uses `ChipInput` (already wraps). For long-sentence traits it wraps to multiple lines — no truncation; verified by test.
- **Optional**: Nice-to-have + Funding stage kept (already in current form; funding_stage now displayed once, not duplicated with "Company stage" — label reads "Funding stage" in a single control).

## Other sections

Same shell, single `FieldGroup` per section, existing controls reused verbatim. No field renames.

## Footer

Sticky bottom bar inside the dialog: left = "Unsaved changes" / "All changes saved"; right = Cancel + Save. Save button uses existing primary gradient. Loading/disabled preserved. Cancel with dirty state prompts `window.confirm('Discard changes?')` — same guard on Escape and backdrop click.

## Behavior preserved

- `initialFor` and `buildPatch` reused unchanged → save payload is byte-identical to current.
- `onSave`/`onOpenChange` props unchanged.
- ChipInput Enter-to-add, keyboard nav, `useReducedMotion` all preserved.
- No new deps.

## Validation

Client-side only, non-blocking hints under fields:
- min > max → "Minimum must be less than maximum."
- both size fields empty → allowed (matches current contract).
- targeting industries empty → soft warning, does not block save (contract accepts empty).

## Tests, checks

- Vitest suite for the editor.
- `npx tsc --noEmit` and `npm run build` via harness.
- Manual visual review at 1512 / 1280 / 1024 / 375.

## Out of scope

Backend, edge functions, migrations, providers, publish, other Company Brain page chrome, draft persistence (tracked separately).