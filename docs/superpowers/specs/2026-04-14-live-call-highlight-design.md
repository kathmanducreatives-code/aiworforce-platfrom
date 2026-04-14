---
title: Live Call Highlight in Leads Tab
date: 2026-04-14
status: approved
---

# Live Call Highlight — Leads Tab

## Goal
When the power dialer is active, the lead currently being called pulses with a breathing blue animation in the Leads list, so you can always see which row the dialer is on. When the call ends, the row returns to its normal appearance instantly.

## Scope
- Frontend only — no backend or n8n changes
- Single visual state: "currently being dialed" (no outcome flash)
- Rides entirely on the existing 2.5s `poll()` cycle

## Architecture

```
n8n poll (every 2.5s)
  → data.current_call.phone
      → activeCallPhone (state var, digits-only)
          → syncActiveLeadHighlight()
              → .calling-now CSS class on matching .lead-row
                  → @keyframes breathe-blue animation
```

No new intervals, no new network requests, no new n8n nodes.

## Components

### 1. State variable
```js
let activeCallPhone = null; // digits-only phone of lead currently being dialed
```
Added near the other `let` declarations (around line 510).

### 2. `poll()` update
After `renderCurrentCall(...)`, extract and store:
```js
activeCallPhone = data.current_call?.phone?.replace(/\D/g, '') || null;
syncActiveLeadHighlight();
```

### 3. `syncActiveLeadHighlight()` — new function
- Scans `#leads-list` for `.lead-row[data-phone]` elements
- Compares each `data-phone` attribute against `activeCallPhone`
- Adds `.calling-now` to the matching row, removes from all others
- No-ops silently if `#leads-list` is not in the DOM or leads tab is hidden

### 4. `renderLeadsList()` update
Stamp `data-phone` (digits-only) on every rendered row:
```html
<div class="lead-row" data-phone="16305550002" onclick="selectLead(0)">
```

### 5. CSS
```css
@keyframes breathe-blue {
  0%, 100% { background: transparent; }
  50%       { background: var(--blue-dim); }
}
.lead-row.calling-now {
  animation: breathe-blue 1.6s ease-in-out infinite;
  border-left-color: var(--blue);
}
```

The `.selected` and `.calling-now` classes can coexist — the breathing blue on top of the selected background is intentional and readable.

## Data Normalisation
Phone numbers are stripped to digits-only (`replace(/\D/g,'')`) before comparison. This handles `+1 (555) 000-1234`, `+15550001234`, and `5550001234` matching the same row.

## Error Handling
- `current_call` is null → `activeCallPhone = null` → all rows lose `.calling-now`
- Active lead not in current filtered view → no visual effect (acceptable — lead is filtered out)
- `#leads-list` not rendered → `syncActiveLeadHighlight` is a no-op

## Testing
1. Start the dialer → within 2.5s, the active lead's row should pulse blue
2. Dialer moves to next lead → previous row stops pulsing, new row starts
3. Dialer stops → all rows return to normal
4. Switch to a different status filter that excludes the active lead → no crash, no orphan highlight
5. Search that hides the active lead → no crash

## Files Changed
- `dialer-dashboard.html` (single file, ~5 diffs)
