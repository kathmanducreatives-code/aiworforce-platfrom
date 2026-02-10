

## Fix: Strategy Preview (Step 4) - Invisible Content Boxes

### Problem
The Strategy Preview boxes use very low-opacity borders (`border-border/30`) and gradient backgrounds that blend into the light default theme's near-white background (`--background: 0 0% 96%`, `--card: 0 0% 98%`). This makes all content boxes invisible or extremely hard to see.

### Solution
Update the `StrategyPreviewStep.tsx` component to use stronger, more visible styling that works in both the default light theme and the Verdant dark theme.

### Changes (1 file)

**`src/components/icp/StrategyPreviewStep.tsx`**

1. **Candidate Reference Card (line 91)**: Replace `border-border/30` with `border-border` and add `shadow-sm` for depth.

2. **Strategy Output Block (line 134)**: Replace `border-primary/15` with `border-border` and `shadow-sm`. Update the background gradient to use `bg-card` solidly instead of fading to transparent.

3. **Search Logic DNA accordion (line 179)**: Replace `border-border/30` with `border-border` and add `shadow-sm`. Change `bg-gradient-to-b from-card to-background` to solid `bg-card`.

4. **Search Logic textarea (line 207)**: Replace `bg-background/60 border-border/30 ring-1 ring-border/20` with `bg-muted/30 border-border` for a visible input area.

5. **Firmographic Constraints accordion (line 223)**: Same border/shadow treatment as above.

6. **Firmographic badges (lines 239, 252, 259, 266, 273)**: Replace `bg-accent/20 border-border/40` with `bg-accent/40 border-border`.

7. **Technical Execution accordion (line 286)**: Same border/shadow treatment.

8. **JSON viewer container (line 299)**: Replace `bg-background/60 border-border/30` with `bg-muted/20 border-border`.

### Summary of styling pattern applied everywhere:
- Borders: `border-border/30` or `/40` changed to full `border-border`
- Backgrounds: Transparent gradients changed to solid `bg-card`
- Shadows: Added `shadow-sm` to all major boxes
- Labels: Already using `text-muted-foreground` (works in both themes)
- Content text: Already using `text-foreground` (works in both themes)

These changes use semantic tokens so they will look correct in both the default light theme and the Verdant dark theme.
