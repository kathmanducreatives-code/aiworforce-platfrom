

## Mobile Optimization for Job Screening

Improve the mobile experience across all Job Screening pages to follow the platform's enterprise-grade mobile standards: zero horizontal scroll, proper spacing, touch-friendly targets, and responsive layouts.

---

### Changes by Component

**1. `src/pages/ScreeningJobs.tsx`**
- Reduce padding from `p-6` to responsive `p-4 md:p-6`
- Scale heading from `text-2xl` to `text-xl md:text-2xl`
- Ensure the page fits naturally under the mobile header offset

**2. `src/components/screening/CreateJobForm.tsx`**
- Stack the 2-column grid (`grid-cols-2`) to single column on mobile (`grid-cols-1 md:grid-cols-2`)
- Stack the 3-column grid (years/education/salary) to single column on mobile (`grid-cols-1 md:grid-cols-3`)
- Ensure salary range inputs don't overflow on narrow screens
- Make the "Create Screening Link" button full-width (already is)
- In the success state, stack the URL input and copy button vertically on mobile

**3. `src/components/screening/JobCard.tsx`**
- Stack the card layout vertically on mobile: job info on top, action buttons below
- Wrap application count badges with `flex-wrap` to prevent overflow
- Make action buttons full-width row on mobile instead of cramped icon buttons

**4. `src/pages/JobApplicants.tsx`**
- Reduce padding from `p-6` to responsive `p-4 md:p-6`
- Stats grid: keep `grid-cols-2` on mobile (already works), reduce card padding
- Filter tabs: wrap `TabsList` with horizontal scroll or `flex-wrap` so the 5 tabs don't clip on small screens
- Candidate grid: already `grid-cols-1` on mobile (good)

**5. `src/components/screening/ApplicantCard.tsx`**
- Stack header (name + score/badge) vertically on very narrow screens
- Wrap footer action row with `flex-wrap` so buttons don't clip
- Ensure text doesn't overflow with proper `break-words` / `truncate`

**6. `src/components/screening/ApplicantDetailModal.tsx`**
- Change dialog width from `max-w-3xl` to `w-full max-w-3xl` and add proper mobile padding
- Replace the 5-column tab grid (`grid-cols-5`) with a scrollable horizontal tabs list on mobile, showing icons only (no text labels) to save space
- Stack the header score/badge row vertically on mobile
- Stack the meta info row (applied date, time, tab switches) vertically on mobile
- Resume tab: change the 2-column info grid to single column on mobile
- Actions tab: ensure form elements are full-width

**7. `src/components/screening/InterviewQuestionsPanel.tsx`** (if needed)
- Ensure copy/print buttons are accessible and full-width on mobile

---

### Technical Approach

All changes use responsive Tailwind classes (e.g., `md:` prefix) with no new dependencies. Following existing mobile patterns:
- Touch targets minimum 44px
- Padding scales from `px-4` mobile to `px-6` desktop
- Zero horizontal scroll enforced
- Semantic color tokens only (no hardcoded colors)

