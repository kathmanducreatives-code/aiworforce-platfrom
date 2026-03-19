

## Brighten the Glowing Grid Background

The grid lines and intersection dots are currently very faint (0.06 opacity for lines, 0.03 for inner glow, 0.2 for dots). Nebulas are also subtle. The fix is a careful opacity bump — enough to be clearly visible without overwhelming the premium feel.

### Changes in `src/components/AuthenticatedBackground.tsx`

**Grid lines** (lines 53-54): `rgba(16, 185, 129, 0.06)` → `rgba(16, 185, 129, 0.12)` — double the line visibility

**Grid cell inner glow** (line 65): `rgba(16, 185, 129, 0.03)` → `rgba(16, 185, 129, 0.06)` — subtle glassy sheen boost

**Intersection dots** (line 75): `rgba(16, 185, 129, 0.2)` → `rgba(16, 185, 129, 0.35)` — make dots pop slightly

**Nebula 1** (line 29): opacity `0.35` → `0.45`, className `opacity-20` → `opacity-25`

**Nebula 2** (line 36): opacity `0.3` → `0.4`, className `opacity-15` → `opacity-20`

**Nebula 3** (line 42): opacity `0.25` → `0.35`, className `opacity-10` → `opacity-15`

**Light mode opacity** (line 23): `0.3` → `0.35` — slightly more visible in light mode too

Only one file modified. No structural changes.

