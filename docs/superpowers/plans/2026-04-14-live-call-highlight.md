# Live Call Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the power dialer is active, the matching lead row in the Leads tab pulses with a breathing blue animation so the user can see which lead is being called in real-time.

**Architecture:** Piggyback on the existing 2.5s `poll()` cycle. After each poll, extract `data.current_call.phone`, store it in `activeCallPhone` (digits-only), then run `syncActiveLeadHighlight()` which stamps/removes a `.calling-now` CSS class on the matching row. No new backend work, no new intervals.

**Tech Stack:** Vanilla JS, CSS keyframe animation, existing n8n `poll()` data (`current_call.phone`).

---

## File Map

| File | Change |
|------|--------|
| `dialer-dashboard.html` | 5 targeted edits — CSS rule, state var, `renderLeadsList` row template, new `syncActiveLeadHighlight()`, `poll()` update |

---

## Task 1: Add CSS animation for `.calling-now`

**Files:**
- Modify: `dialer-dashboard.html` (inside `<style>`, after line 285 — the last `.status-badge.pending` rule, before `</style>`)

- [ ] **Step 1: Add the keyframe + rule**

Find this line in the `<style>` block (it is the last CSS rule before `</style>`):
```css
  .status-badge.pending    { background:var(--surface2);   color:var(--text-muted); border:1px solid var(--border); }
```

Add immediately after it:
```css
  /* ── Live call highlight ── */
  @keyframes breathe-blue {
    0%, 100% { background: transparent; }
    50%       { background: var(--blue-dim); }
  }
  .lead-row.calling-now {
    animation: breathe-blue 1.6s ease-in-out infinite;
    border-left-color: var(--blue);
  }
```

- [ ] **Step 2: Visual smoke-check in browser**

Open `http://localhost:3333/dialer-dashboard.html`, open DevTools console and run:
```js
document.querySelectorAll('.lead-row')[0]?.classList.add('calling-now')
```
Expected: first lead row breathes blue. Run:
```js
document.querySelectorAll('.lead-row')[0]?.classList.remove('calling-now')
```
Expected: animation stops immediately.

- [ ] **Step 3: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add dialer-dashboard.html
git commit -m "feat: add breathing-blue CSS animation for .calling-now lead row"
```

---

## Task 2: Add state variable + stamp `data-phone` on each row

**Files:**
- Modify: `dialer-dashboard.html` — two edits: state var declaration + `renderLeadsList` row template

- [ ] **Step 1: Add `activeCallPhone` state variable**

Find (around line 514):
```js
let leadsTimer       = null;
```

Add one line immediately after:
```js
let activeCallPhone  = null;     // digits-only phone of lead currently being dialed
```

- [ ] **Step 2: Stamp `data-phone` on every rendered row**

Find in `renderLeadsList()` (around line 967):
```js
    return `<div class="lead-row${selected}" onclick="selectLead(${i})">
```

Replace with:
```js
    const phone = leadCol(row, 'phone').replace(/\D/g, '');
    return `<div class="lead-row${selected}" data-phone="${phone}" onclick="selectLead(${i})">
```

- [ ] **Step 3: Verify `data-phone` is in the DOM**

Open `http://localhost:3333/dialer-dashboard.html`, click the Leads tab, open DevTools console and run:
```js
document.querySelector('.lead-row[data-phone]')?.dataset.phone
```
Expected: a string of digits like `"16302500002"` (not undefined, not empty).

- [ ] **Step 4: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add dialer-dashboard.html
git commit -m "feat: stamp data-phone on lead rows for live highlight matching"
```

---

## Task 3: Add `syncActiveLeadHighlight()` + wire into `poll()`

**Files:**
- Modify: `dialer-dashboard.html` — two edits: new function in LEADS CRM section + `poll()` update

- [ ] **Step 1: Add `syncActiveLeadHighlight()` function**

Find this comment in the LEADS CRM section (around line 874):
```js
// ────────────────────────────────────────────────────────────────────────────
//  LEADS CRM
// ────────────────────────────────────────────────────────────────────────────
async function fetchLeads() {
```

Add the new function immediately before `async function fetchLeads()`:
```js
function syncActiveLeadHighlight() {
  const list = document.getElementById('leads-list');
  if (!list) return;
  list.querySelectorAll('.lead-row[data-phone]').forEach(row => {
    const match = activeCallPhone && row.dataset.phone === activeCallPhone;
    row.classList.toggle('calling-now', !!match);
  });
}

```

- [ ] **Step 2: Wire `syncActiveLeadHighlight()` into `poll()`**

Find in `poll()` (around line 1184):
```js
    renderCurrentCall(data.current_call||null);
    renderCallLog(data.session_log||[]);
    renderBalance(data.balance||null);
    // Sync dialer state from n8n if provided
```

Replace with:
```js
    renderCurrentCall(data.current_call||null);
    renderCallLog(data.session_log||[]);
    renderBalance(data.balance||null);
    activeCallPhone = data.current_call?.phone?.replace(/\D/g, '') || null;
    syncActiveLeadHighlight();
    // Sync dialer state from n8n if provided
```

- [ ] **Step 3: Also call `syncActiveLeadHighlight()` at end of `renderLeadsList()`**

This ensures the highlight is re-applied after the list re-renders (e.g. after a 30s leads poll). Find the closing lines of `renderLeadsList()` (around line 975):
```js
  list.innerHTML = leadsFiltered.map((row, i) => {
    const phone = leadCol(row, 'phone').replace(/\D/g, '');
    return `<div class="lead-row${selected}" data-phone="${phone}" onclick="selectLead(${i})">
```
...scroll to the end of the function, which closes with:
```js
  });
}
```

The full closing of `renderLeadsList` looks like:
```js
        <span class="lead-row-attempts">${esc(attempts)} attempt${attempts === '1' ? '' : 's'}</span>
      </div>
    </div>`;
  }).join('');
}
```

Replace the closing `}` with:
```js
        <span class="lead-row-attempts">${esc(attempts)} attempt${attempts === '1' ? '' : 's'}</span>
      </div>
    </div>`;
  }).join('');
  syncActiveLeadHighlight();
}
```

- [ ] **Step 4: Simulate in DevTools — verify end-to-end**

Open `http://localhost:3333/dialer-dashboard.html`, click Leads tab. In DevTools console run:
```js
// Simulate a call coming in on Alok Aggarwal's number
activeCallPhone = document.querySelector('.lead-row[data-phone]')?.dataset.phone;
syncActiveLeadHighlight();
```
Expected: first lead row breathes blue.

Then simulate call ending:
```js
activeCallPhone = null;
syncActiveLeadHighlight();
```
Expected: animation stops, row returns to normal.

Then simulate call on a number NOT in the current filtered view:
```js
activeCallPhone = '0000000000';
syncActiveLeadHighlight();
```
Expected: no rows highlight, no errors in console.

- [ ] **Step 5: Commit**

```bash
cd /Users/prasidha/screeningpilot/screeningpilot
git add dialer-dashboard.html
git commit -m "feat: live call highlight — breathing blue row in Leads tab synced to poll()"
```

---

## Task 4: Sync dashboard to worktree + final screenshot

**Files:**
- Sync: `dialer-dashboard.html` → `.claude/worktrees/festive-lamport/dialer-dashboard.html`

- [ ] **Step 1: Sync file to preview worktree**

```bash
cp /Users/prasidha/screeningpilot/screeningpilot/dialer-dashboard.html \
   /Users/prasidha/screeningpilot/screeningpilot/.claude/worktrees/festive-lamport/dialer-dashboard.html
echo "synced"
```

- [ ] **Step 2: Hard-reload preview and take screenshot**

Navigate preview to:
```
http://localhost:3333/dialer-dashboard.html?v=final
```
Click Leads tab. Run in DevTools:
```js
activeCallPhone = document.querySelector('.lead-row[data-phone]')?.dataset.phone;
syncActiveLeadHighlight();
```
Take screenshot — the first lead row should be pulsing blue.

- [ ] **Step 3: Verify no console errors**

Check DevTools console — zero errors expected. Specifically check:
- No `Cannot read properties of null` errors
- No `syncActiveLeadHighlight is not defined` errors
- No errors when switching status filter chips while `activeCallPhone` is set

---

## Self-Review

**Spec coverage:**
- ✅ Breathing blue full-row animation → Task 1 CSS
- ✅ Driven by existing `poll()` (2.5s, no new requests) → Task 3 poll() update
- ✅ `data-phone` for matching → Task 2
- ✅ `activeCallPhone` state var → Task 2
- ✅ `syncActiveLeadHighlight()` → Task 3
- ✅ Re-apply after leads re-render → Task 3, Step 3
- ✅ Null / missing lead edge cases → `syncActiveLeadHighlight` no-ops gracefully
- ✅ Phone normalisation (digits-only) → both `data-phone` stamping and `activeCallPhone` extraction

**Placeholder scan:** None — all steps have complete code.

**Type consistency:** `activeCallPhone` is set as digits-only string in both `poll()` and `syncActiveLeadHighlight` comparison. `data-phone` is set as digits-only in `renderLeadsList`. Consistent throughout.
