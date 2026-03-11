

## Restore Original Black/Green Verdant Theme

### Overview
Revert the color theme to the original premium "Verdant" aesthetic — deep charcoal backgrounds with emerald green accents. The current theme has shifted to blue tones and needs to return to the forest-inspired green palette.

### Changes

#### 1. Tailwind Config — Restore Emerald Primary
**File: `tailwind.config.ts`**

Replace the blue primary palette with emerald green:
- Change `primary.DEFAULT` from `#3B82F6` (blue) to `#10B981` (emerald)
- Change `primary.light` from `#60A5FA` to `#34D399`
- Change `primary.dark` from `#2563EB` to `#059669`
- Change `primary.100`/`200` alpha values to use emerald rgba
- Update `shadow-primary` and `shadow-primary-lg` to emerald glow
- Change `secondary.DEFAULT` to maintain the green accent hierarchy

#### 2. CSS Variables — Verify Dark Theme Colors
**File: `src/index.css`**

The `[data-theme="dark"]` section already has the correct black/green values:
- Background: `0 0% 3%` (deep charcoal)
- Primary: `158 64% 42%` (emerald green)
- Card: `0 0% 5%` (dark surface)

Ensure these are being properly applied by checking the CSS variable mappings.

#### 3. Theme Context — Force Dark Mode Default
**File: `src/contexts/ThemeContext.tsx`**

Ensure the default theme is `dark` (the black/green Verdant theme) rather than potentially falling back to light:
- Keep default as `dark` if no stored preference
- Ensure `data-theme="dark"` attribute is applied correctly

#### 4. Component-Level Color Overrides
**Files: Various components using hardcoded colors**

Search for any hardcoded blue colors (`#3B82F6`, `blue-500`, etc.) in components and replace with semantic tokens:
- Replace `text-blue-500` → `text-primary`
- Replace `bg-blue-500` → `bg-primary`
- Replace hex blues with `hsl(var(--primary))`

### Technical Details
- The emerald palette: Primary `#10B981`, Light `#34D399`, Dark `#059669`
- Background: Deep charcoal `#080808` via `hsl(0 0% 3%)`
- Accents stay green — no blue tints in primary actions

### Files Modified
1. `tailwind.config.ts` — Restore emerald primary palette
2. `src/contexts/ThemeContext.tsx` — Verify dark default
3. `src/index.css` — Confirm dark theme variables (may need no changes)
4. Component files with hardcoded blues — Replace with semantic tokens

