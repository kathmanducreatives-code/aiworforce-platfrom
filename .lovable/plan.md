

## Mobile Optimization for Job Screening

### Changes

#### 1. Full-Screen Create Job Form on Mobile
**File: `src/pages/ScreeningJobs.tsx`**
- On mobile, replace the `SlideOverPanel` with a full-screen overlay (using `Dialog` with `DialogContent` set to `w-full h-full max-w-none rounded-none` or a simple fixed div)
- Use `useIsMobile()` to conditionally render full-screen dialog vs slide-over panel
- Add a sticky header with back/close button and a sticky footer with the submit button

**File: `src/components/screening/CreateJobForm.tsx`**
- Remove the collapsible expand/collapse wrapper (the header button with Plus icon) since it's now opened from the page-level action
- Accept an optional `onCancel` prop for the close button
- Stack all form fields single-column (remove `md:grid-cols-2` and `md:grid-cols-3` grid splits -- already single-col on mobile, so this is fine)
- Ensure the form body scrolls independently within the full-screen container

#### 2. ScreeningJobs Page Mobile Tweaks
**File: `src/pages/ScreeningJobs.tsx`**
- Reduce padding: `px-4 py-4` on mobile instead of `px-6 py-6`
- KPI row: keep `grid-cols-1 sm:grid-cols-3` (already responsive)

#### 3. JobCard Mobile Optimization
**File: `src/components/screening/JobCard.tsx`**
- Make the "View Applicants" button full-width on mobile with icon-only dropdown trigger
- Tighten padding on small screens (`px-3 py-3` on mobile)

#### 4. JobApplicants Page Mobile Tweaks
**File: `src/pages/JobApplicants.tsx`**
- Reduce container padding to `px-4` on mobile
- Applicant grid: already `grid-cols-1` on mobile, no change needed
- Filter tabs: already have horizontal scroll, keep as-is

#### 5. ApplicantDetailModal Mobile
**File: `src/components/screening/ApplicantDetailModal.tsx`**
- Make the dialog full-screen on mobile (`max-w-full h-full rounded-none` on small screens)

