# Onboarding Page: Add Exit & Restart Buttons

## Problem
The Review step (Step 9) currently lacks explicit navigation options to:
1. Exit onboarding and return to the Dashboard
2. Restart the entire onboarding flow from Step 1

While the header has a small X icon that navigates to `/dashboard`, and the `?restart=1` query param exists for restarting, these are not prominent enough for users who want to explicitly close or restart.

## Proposed Changes

### 1. Header: Make "Exit to Dashboard" More Explicit
- Replace the bare `X` icon button in the header with a labeled `Button` variant that reads "Exit to Dashboard" alongside a smaller close icon.
- Keep navigation to `/dashboard`.

### 2. Review Step: Add "Start from Beginning" Button
- In `renderReview()`, below the existing action buttons ("Activate Company Brain" / "Edit details"), add a ghost-style "Start from beginning" button.
- On click, navigate to `/onboarding/company-brain?restart=1`.
- This triggers the existing `restart` logic which forces Step 1 while keeping pre-filled data intact.

### 3. Optional: Add to Footer Nav (for non-review steps)
- In `renderFooter()`, add a small "Exit" link on the left side next to "Back" so users can bail out from any middle step without completing the flow.

## Files
- `src/pages/OnboardingCompanyBrain.tsx` — header button update, review step button, optional footer exit link.

## Acceptance
- [ ] "Exit to Dashboard" button visible and clickable in the header on all steps.
- [ ] "Start from beginning" button visible in the Review step.
- [ ] Clicking restart preserves pre-filled data (does not wipe) and lands on Step 1.
- [ ] No backend/schema changes needed.