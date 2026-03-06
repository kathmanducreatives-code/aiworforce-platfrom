

## Expert Interview Marketplace — Premium Layout Redesign

### Overview
Elevate the Expert Marketplace from a functional prototype to a polished, premium SaaS experience aligned with the Verdant design system. Focus on glassmorphism, better spacing, refined typography, and responsive mobile layout.

### Changes

#### 1. Page Header — `ExpertMarketplace.tsx`
- Replace flat header with glassmorphism card (`bg-card/60 backdrop-blur-xl border-border/50`)
- Add animated mesh gradient background orbs using the Verdant palette (`#059467`, `#14b8a5`) instead of purple/blue
- Add a third stat card: "Satisfaction Rate — 98%"
- Make stats row horizontally scrollable on mobile
- Reduce header padding on mobile (`px-4 py-8` vs `px-6 py-12`)

#### 2. Tab Navigation — `ExpertMarketplace.tsx`
- Convert to pill-style tabs with glassmorphism active state (`bg-primary/10 border border-primary/20 rounded-full`) instead of underline
- Horizontally scrollable on mobile with `overflow-x-auto` and hidden scrollbar
- Icon-only on mobile (`sm:` breakpoint shows labels)

#### 3. Expert Directory Cards (inline in `ExpertMarketplace.tsx`)
- Apply glassmorphism (`bg-card/60 backdrop-blur-sm border-border/50`)
- Add staggered fade-in animation (80ms delay per card)
- Replace color bar with a subtle left accent bar matching availability (green = available, amber = busy)
- Add hover scale micro-interaction (`hover:scale-[1.02]`) with 200ms transition
- Make avatar larger (w-14 h-14) with gradient ring border on hover
- Move "Request Interview" button to a sticky footer area within the card

#### 4. Active Requests Tab — `ExpertMarketplace.tsx`
- Wrap each request row in glassmorphism card styling
- Add subtle left border color based on status (blue=scheduled, yellow=pending, purple=in_progress, green=completed)
- Improve mobile layout: stack all columns vertically with clear section labels

#### 5. Interview Hub — `InterviewHub.tsx`
- Apply glassmorphism to stat cards with gradient icon backgrounds
- Live session cards: add subtle pulsing border glow (`shadow-[0_0_20px_rgba(5,148,103,0.15)]`)
- Upcoming session cards: add glassmorphism styling and staggered animation
- Video modal: keep as-is (already well-designed)

#### 6. Company Review Panel — `CompanyReviewPanel.tsx`
- Apply glassmorphism to review cards
- Scorecard progress bars: use primary green color instead of default
- Add recommendation badge with larger, bolder styling
- Recording placeholder: add gradient overlay matching Verdant palette

#### 7. Recording Archive — `RecordingArchive.tsx`
- Apply glassmorphism to stat cards and interviewer profile cards
- Recording thumbnails: replace broken local file path with a gradient placeholder (`bg-gradient-to-br from-primary/20 to-blue-500/20`)
- Add staggered card animations

#### 8. Global Responsive Improvements
- All grids: `grid-cols-1` on mobile, scale up at `sm:`/`md:`/`lg:` breakpoints (already mostly done, verify consistency)
- Search bars: full-width on mobile
- Filter buttons in directory: wrap into a second row on mobile instead of overflowing

### Files Modified
1. `src/pages/ExpertMarketplace.tsx` — Header, tabs, directory cards, requests tab
2. `src/components/expert-marketplace/InterviewHub.tsx` — Glassmorphism, live glow
3. `src/components/expert-marketplace/CompanyReviewPanel.tsx` — Card styling, progress colors
4. `src/components/expert-marketplace/RecordingArchive.tsx` — Fix broken thumbnail, glassmorphism

