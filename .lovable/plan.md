

## Redesign Match Badges: Full-Width Banner to Corner Pill

### Overview
Replace the current solid-color full-width header bar on candidate cards with a compact, gradient pill badge positioned in the top-right corner.

### What Changes

**Current**: A full-width `div` spanning the top of the card acts as a colored banner showing the match tier label and emoji.

**New**: A small absolute-positioned gradient pill badge (roughly 130px x 34px) sitting in the top-right corner of the card, overlaying the card content.

### Files Modified

| File | Change |
|---|---|
| `src/lib/matchBadges.ts` | Replace `gradient` field values with actual CSS gradient strings and add a `glow` field for box-shadow |
| `src/components/icp/ProfileResultCard.tsx` | Replace the full-width banner div with an absolute-positioned pill badge |

### Detailed Changes

#### 1. `src/lib/matchBadges.ts` -- Update gradient and add glow

Add a `glow` field to `MatchBadgeConfig` for badge box-shadow. Update `gradient` to hold inline style gradient values instead of Tailwind bg classes:

- **Excellent (30+)**: gradient `linear-gradient(135deg, #059652 0%, #14b8a5 100%)`, white text, glow `0 0 16px rgba(5,150,82,0.35)`
- **Strong (20+)**: gradient `linear-gradient(135deg, #6DDBA6 0%, #34D399 100%)`, dark text `#171717`, glow `0 0 12px rgba(109,219,166,0.25)`
- **Good (10+)**: gradient `linear-gradient(135deg, #E8FDF5 0%, #6DDBA6 50%, #14b8a5 100%)`, text `#148C6E`, glow `0 0 10px rgba(20,140,110,0.15)`
- **Weak (<10)**: gradient `linear-gradient(135deg, #A1A1A1 0%, #D4D4D4 100%)`, dark text, no glow

The `gradient` field will now store the CSS `background` value for use in inline styles rather than Tailwind classes. The existing `color` field already stores the text color class. A new `textHex` field will provide the raw hex for inline style use.

#### 2. `src/components/icp/ProfileResultCard.tsx` -- Replace banner with pill badge

**Remove** (lines 188-197): The full-width `div` with `flex items-center justify-between px-5 py-2.5 border-b` that spans the card top.

**Replace with**: An absolute-positioned pill badge inside the Card, using inline `style` for the gradient background and box-shadow:

```
position: absolute, top: 12px, right: 12px
border-radius: 9999px (full pill)
padding: 6px 14px
height: ~32px
z-index: 10
display: flex, align-items: center, gap: 6px
font-size: 12px, font-weight: 600
```

The badge uses `style={{ background: badge.gradient, boxShadow: badge.glow, color: badge.textHex }}` for the gradient effect since Tailwind cannot do multi-stop gradients with arbitrary hex values inline.

The card's existing `overflow-hidden` will clip the badge neatly. The profile header section padding-top will be kept as-is since the badge floats over it without displacing content.

### Visual Result

Cards will go from having a colored strip across the top to having a small floating pill in the corner -- cleaner, more modern, and less visually heavy. The gradient gives each tier a premium feel while the glow provides subtle depth.
