

## Update Similarity Score Display and Badge Thresholds

### Overview
Three changes: remove score percentage from candidate list cards, keep it prominent on detail page, and update the badge threshold logic with new tiers.

### Changes

#### 1. Update badge thresholds (`src/lib/matchBadges.ts`)

Replace the current 75/60/50/40 threshold system with new thresholds and styles:

| Score Range | Label | Background | Text |
|---|---|---|---|
| 30%+ | Excellent Match | `#059652` (emerald green) | White |
| 20-29% | Strong Match | `#6DDBA6` (primary-light) | Dark |
| 10-19% | Good Match | `#E8FDF5` (accent) | `#148C6E` |
| Below 10% | Weak Match | `#A1A1A1` (muted gray) | Dark |

- Update the `gradient` field styling for each tier to use the specified hex colors instead of Tailwind opacity classes
- Update labels and emojis accordingly

#### 2. Remove score from list cards (`src/components/icp/ProfileResultCard.tsx`)

- In the match badge banner (lines 188-197), remove the `<span>` that shows `{profile.similarity_score}%`
- Keep the badge label and emoji visible (just no numeric percentage)

#### 3. Keep score on detail page (`src/pages/ICPCandidateDetail.tsx`)

- The detail page already shows the score at line 383 (`— {profile.similarity_score}%`) inside the match badge -- this stays as-is
- The new badge colors from `matchBadges.ts` will automatically apply here

### Technical Details

**Files modified (2-3):**

| File | Change |
|---|---|
| `src/lib/matchBadges.ts` | New thresholds (30/20/10), new colors, new labels |
| `src/components/icp/ProfileResultCard.tsx` | Remove percentage display from card banner |
| `src/pages/ICPCandidateDetail.tsx` | No changes needed -- inherits new badge styles automatically |

**Note on the `gradient` field:** The current `gradient` string contains Tailwind classes for background, border, text, and shadow. These will be updated to use the new hex values via arbitrary Tailwind classes (e.g., `bg-[#059652] text-white border-[#059652]/50`).

