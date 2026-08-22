// A STICKY CELL MUST BE OPAQUE, OR THE TABLE SCROLLS THROUGH ITSELF.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
//
//     const rowBg = isSel ? 'bg-emerald-500/[0.05]'
//                         : 'bg-[#0a0d12] group-hover:bg-white/[0.02]';
//
// Both halves set the SAME CSS property. On hover the literal `#0a0d12` was
// REPLACED by `rgba(255,255,255,0.02)` — a 98% transparent cell. For an
// ordinary column that is invisible; for a sticky one it is fatal, because the
// horizontally-scrolled columns pass underneath and show straight through. The
// reported screenshot shows "…eeded", the tail of "Setup needed" from the
// decision-maker column, rendering inside the company column.
//
// Selection was worse: `emerald/[0.05]` is translucent unconditionally, so a
// selected row bled with no hover at all.
//
// ── AND THE ROWS WERE NOT THE SAME HEIGHT ───────────────────────────────────
//
// `align-top` with content-driven heights: the signal column stacked three
// lines (signal, reason, evidence link) and an unlocked decision-maker stacked
// three more (name, title, LinkedIn), while every other cell held two. A row's
// height therefore depended on which columns happened to be unlocked, so
// neighbours disagreed and the grid looked broken even where nothing bled.
//
// ZERO network, ZERO React rendering.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SHEET = code(read(
  "../../src/components/chat/workspace/workbench/leadTable/LeadSpreadsheet.tsx"));
const CELL = code(read(
  "../../src/components/chat/workspace/workbench/leadTable/UnlockCell.tsx"));

// ═══ 1. NOTHING BEHIND A STICKY CELL MAY SHOW THROUGH ══════════════════════

Deno.test("1. NO ROW BACKGROUND IS TRANSLUCENT", () => {
  // Tailwind's `/[0.0x]` suffix is the alpha channel. Any of them on a row
  // surface reintroduces the bleed exactly.
  // Anchored FROM the declaration: `COL` is declared above and also ends with
  // `} as const;`, so an unanchored search sliced backwards and silently
  // matched an empty string — which passed the alpha check for the wrong
  // reason and failed only on the solids.
  const start = SHEET.indexOf("const ROW_BG");
  assert(start !== -1, "the row background table must exist");
  const block = SHEET.slice(start, SHEET.indexOf("} as const;", start));
  assert(!/\/\[0?\.\d+\]/.test(block),
    `a row background carries an alpha channel:\n${block}`);
  for (const solid of ["#0a0d12", "#0f1217", "#0a1618", "#0f1b1d"]) {
    assert(block.includes(solid), `${solid} must be a solid, pre-blended hex`);
  }
});

Deno.test("2. hover and selection REPLACE the base with another opaque colour", () => {
  // The bug was two rules on one property where the second happened to be
  // transparent. Two rules on one property is fine — both being opaque is what
  // matters.
  assert(SHEET.includes("group-hover:bg-[#0f1217]"), "hover is opaque");
  assert(SHEET.includes("group-hover:bg-[#0f1b1d]"), "selected + hover is opaque");
  assert(!/group-hover:bg-white/.test(SHEET),
    "`bg-white/[0.02]` is the exact rule that replaced the opaque base");
  assert(!/bg-emerald-500\/\[/.test(SHEET),
    "a translucent selection bled with no hover at all");
});

Deno.test("3. the sticky cells sit ABOVE the scrolling columns", () => {
  // z-[1] beat `auto`, but only just. The header must still win over both.
  assertEquals((SHEET.match(/sticky left-0 z-\[2\]/g) ?? []).length, 1);
  assertEquals((SHEET.match(/sticky left-9 z-\[2\]/g) ?? []).length, 1);
  assert(SHEET.includes("sticky left-0 z-[4]") && SHEET.includes("sticky left-9 z-[4]"),
    "the header's own sticky cells outrank the body's");
});

Deno.test("4. the header hairline is opaque too", () => {
  // It is inside a sticky `<thead>`; a bare translucent rule lets the scrolled
  // rows show through the seam under the column names.
  const head = SHEET.slice(SHEET.indexOf("<thead"), SHEET.indexOf("</thead>"));
  assert(/<tr className="bg-\[#0a0d12\]">/.test(head),
    "the hairline row needs its own opaque background");
});

// ═══ 2. EVERY ROW IS THE SAME HEIGHT ═══════════════════════════════════════

Deno.test("5. a fixed row height, vertically centred", () => {
  assert(/h-\[62px\]/.test(SHEET), "height is declared, not inferred from content");
  assert(/align-middle/.test(SHEET));
  assert(!/align-top/.test(SHEET),
    "`align-top` plus variable line counts is what made neighbours disagree");
});

Deno.test("6. NO CELL RENDERS MORE THAN TWO LINES", () => {
  // The two three-line cells are the ones that made rows uneven. Each now puts
  // its third element inline beside one of the first two.
  const dm = SHEET.slice(SHEET.indexOf("dmState === 'unlocked'"), SHEET.indexOf("label=\"Find contact\""));
  assert(/flex items-baseline gap-1\.5/.test(dm),
    "the decision-maker's LinkedIn link moves onto the name line");

  const sig = SHEET.slice(SHEET.indexOf("card.signal ??"), SHEET.indexOf("label=\"Find contact\""));
  assert(/flex items-baseline gap-2/.test(sig),
    "the evidence link moves onto the reason line");

  // Anything that clamps must clamp to two.
  const clamps = [...SHEET.matchAll(/line-clamp-(\d)/g)].map((m) => m[1]);
  assert(clamps.length > 0);
  assert(clamps.every((c) => c === "2"), `a cell clamps to ${clamps.join("/")} lines`);
});

Deno.test("7. content is clipped inside its own cell", () => {
  // Belt and braces: even a cell that miscalculates cannot paint into its
  // neighbour.
  assert((SHEET.match(/overflow-hidden/g) ?? []).length >= 2,
    "the sticky cells clip their own content");
  assert((SHEET.match(/truncate/g) ?? []).length >= 4,
    "single-line text truncates rather than wrapping the row taller");
});

// ═══ 3. THE FLOATING BOX WAS A NATIVE TOOLTIP ══════════════════════════════

Deno.test("8. no `title` duplicates text already on screen", () => {
  // The "Research company" box floating over the header is a browser tooltip
  // painted outside the table — an attribute, not a layout fault. It repeated
  // the label rendered one line below it.
  assert(!/title=\{label\}/.test(CELL),
    "a tooltip that repeats the visible label is noise that looks like a bug");
  // The states that keep one carry something not otherwise visible.
  assert(/title=\{blockedReason/.test(CELL), "why it cannot run");
  assert(/title=\{failureReason/.test(CELL), "what went wrong");
});

// ═══ 4. NOTHING ELSE MOVED ═════════════════════════════════════════════════

Deno.test("9. selection and the unlock actions are untouched", () => {
  assert(SHEET.includes("onToggle(r.id)"), "row selection survives");
  assert(SHEET.includes("onToggleAll"), "and select-all");
  assertEquals((SHEET.match(/onUnlock\('/g) ?? []).length, 3,
    "all three unlock actions still dispatch");
  assert(SHEET.includes("cost={priceFor("), "and still quote the real price");
});

Deno.test("10. it is still a table, not cards", () => {
  assert(SHEET.includes("<table"), "the spreadsheet stays a spreadsheet");
  assert(/flex-1 min-h-0 overflow-auto/.test(SHEET), "and the only growing region");
});
