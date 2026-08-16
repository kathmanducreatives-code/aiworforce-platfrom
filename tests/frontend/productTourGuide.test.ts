// REGRESSION: the 6-step product tour restarted at step 1 forever.
//
// Two independent defects produced the loop:
//
//  1. PERSISTENCE. `useProductTour.save()` writes `onboarding_meta` through
//     `setup-company-brain` action="save_structured". That handler only applies
//     keys on an explicit allow-list; an older build's list omitted
//     `onboarding_meta`, so the write returned 200 and silently dropped the
//     field. `readMeta` then read back `product_tour_completed: undefined`,
//     `shouldAutoOpen` stayed true, and the guide reopened.
//
//  2. REOPEN RACE. ProductTour's auto-open effect depends on `open`. `close()`
//     set open=false, which re-ran the effect while `shouldAutoOpen` was still
//     stale, reopening at index 0. This looped even with persistence working.
//
// Plus a mapping defect: the final step's CTA pointed at
// `/onboarding/company-brain`, throwing the user back into the setup wizard.
//
// These tests are pure and structural - no DOM, no network, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  TOUR_STEPS,
  TOUR_TAG_BY_NAV_KEY,
  ctaLabelFor,
} from "../../src/components/tour/tourSteps.ts";

const read = (p: string) => Deno.readTextFile(new URL(p, import.meta.url));

const appSrc = () => read("../../src/App.tsx");
const sidebarSrc = () => read("../../src/components/Sidebar.tsx");
const tourSrc = () => read("../../src/components/tour/ProductTour.tsx");
const hookSrc = () => read("../../src/hooks/useProductTour.ts");
const setupFnSrc = () => read("../../supabase/functions/setup-company-brain/index.ts");

/** Sidebar nav items parsed straight from the component: key -> {label, path}. */
async function sidebarNav(): Promise<Record<string, { label: string; path: string }>> {
  const src = await sidebarSrc();
  const out: Record<string, { label: string; path: string }> = {};
  for (const m of src.matchAll(
    /\{\s*key:\s*'([^']+)',\s*path:\s*'([^']+)',[^}]*?label:\s*'([^']+)'/g,
  )) {
    out[m[1]] = { label: m[3], path: m[2] };
  }
  return out;
}

// ---------------------------------------------------------------- structure --

Deno.test("guide has the six canonical steps, in order, with stable ids", () => {
  assertEquals(
    TOUR_STEPS.map((s) => s.id),
    ["dashboard", "workflows", "conversations", "workbench", "awaiting", "company_brain"],
  );
  assertEquals(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length);
});

Deno.test("a new user starts at step 1 and every step carries complete copy", () => {
  assertEquals(TOUR_STEPS[0].id, "dashboard", "step 1 must be the Dashboard step");
  for (const s of TOUR_STEPS) {
    assert(s.title.length > 0, `${s.id}: empty title`);
    assert(s.body.length > 20, `${s.id}: body too short`);
    assert(s.where.length > 0 && s.useItFor.length > 0 && s.tryFirst.length > 0, `${s.id}: missing copy`);
    assert(s.ctaLabel.length > 0, `${s.id}: missing ctaLabel`);
    assert(s.featureName.length > 0, `${s.id}: missing featureName`);
  }
});

// ------------------------------------------------------------------ mapping --

Deno.test("every configured guide route exists in App.tsx", async () => {
  const src = await appSrc();
  const routes = new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
  for (const s of TOUR_STEPS) {
    assert(routes.has(s.ctaRoute), `step "${s.id}" targets ${s.ctaRoute}, which is not a declared route`);
  }
});

Deno.test("the final step opens the Company Brain page, not the onboarding wizard", () => {
  const step = TOUR_STEPS.find((s) => s.id === "company_brain")!;
  assertEquals(step.ctaRoute, "/company-brain");
  assert(
    !step.ctaRoute.startsWith("/onboarding/"),
    "Company Brain CTA must not send the user back into the setup wizard",
  );
});

Deno.test("every desktop target selector is unique and derived from its tag", () => {
  const tags = TOUR_STEPS.map((s) => s.anchorTag);
  assertEquals(new Set(tags).size, tags.length, `duplicate anchor tags: ${tags.join(", ")}`);
  for (const s of TOUR_STEPS) {
    assertEquals(s.anchorSelector, `[data-tour="${s.anchorTag}"]`);
  }
});

Deno.test("every nav-bound feature label matches the sidebar label exactly", async () => {
  const nav = await sidebarNav();
  for (const s of TOUR_STEPS) {
    if (!s.navKey) continue;
    const item = nav[s.navKey];
    assert(item, `step "${s.id}" references nav key "${s.navKey}" which the sidebar does not define`);
    assertEquals(
      s.featureName,
      item.label,
      `step "${s.id}" calls the feature "${s.featureName}" but the sidebar shows "${item.label}"`,
    );
  }
});

Deno.test("each nav-bound CTA route matches that sidebar item's own route", async () => {
  const nav = await sidebarNav();
  for (const s of TOUR_STEPS) {
    if (!s.navKey) continue;
    assertEquals(
      s.ctaRoute,
      nav[s.navKey].path,
      `step "${s.id}" CTA goes to ${s.ctaRoute} but the sidebar item goes to ${nav[s.navKey].path}`,
    );
  }
});

Deno.test("the sidebar derives its anchors from the canonical config - no second map", async () => {
  const src = await sidebarSrc();
  assert(
    /TOUR_TAG_BY_NAV_KEY/.test(src) && /from '\.\/tour\/tourSteps'/.test(src),
    "Sidebar must import the canonical anchor map",
  );
  assert(
    !/dashboard:\s*'sidebar-dashboard'/.test(src),
    "Sidebar still hardcodes a second tour-tag map - it will drift",
  );
  for (const s of TOUR_STEPS) {
    if (!s.navKey) continue;
    assertEquals(TOUR_TAG_BY_NAV_KEY[s.navKey], s.anchorTag);
  }
});

Deno.test("no legacy ScreeningPilot or superseded feature terminology in the guide", () => {
  const blob = JSON.stringify(TOUR_STEPS);
  for (const bad of ["ScreeningPilot", "Screening Pilot", "Scout Radar", "Conversations"]) {
    assert(!blob.includes(bad), `guide config still contains legacy term "${bad}"`);
  }
});

Deno.test("CTA says Continue when the user is already on the destination", () => {
  const dash = TOUR_STEPS.find((s) => s.id === "dashboard")!;
  assertEquals(ctaLabelFor(dash, "/dashboard"), "Continue");
  assertEquals(ctaLabelFor(dash, "/workflows"), "Open Dashboard");
  // The regression: "Open Dashboard" must never render while on /dashboard.
  for (const s of TOUR_STEPS) {
    assert(
      !ctaLabelFor(s, s.ctaRoute).startsWith("Open "),
      `step "${s.id}" still offers "${ctaLabelFor(s, s.ctaRoute)}" while already on ${s.ctaRoute}`,
    );
  }
});

// --------------------------------------------------------------- loop guard --

Deno.test("auto-open is settled per mount so closing cannot reopen the guide", async () => {
  const src = await tourSrc();
  assert(/settledRef\s*=\s*useRef\(false\)/.test(src), "missing the per-mount auto-open guard");
  assert(
    /if\s*\(open\s*\|\|\s*settledRef\.current\)\s*return;/.test(src),
    "auto-open effect must bail once settled - otherwise close() re-enters it",
  );
  assert(/settledRef\.current\s*=\s*true;/.test(src), "guard is never armed");
});

Deno.test("changing routes does not reset the step index", async () => {
  const src = await tourSrc();
  const openFeature = src.match(/const openFeature = \(\) => \{[\s\S]*?\n  \};/);
  assert(openFeature, "could not locate openFeature");
  assert(
    !/setIndex/.test(openFeature[0]),
    "navigating from a CTA must not reset the guide to step 1",
  );
  // setIndex(0) may only appear in auto-open and explicit restart.
  assertEquals(
    [...src.matchAll(/setIndex\(0\)/g)].length,
    2,
    "setIndex(0) should exist only in the auto-open effect and the restart handler",
  );
});

Deno.test("a missing anchor does not restart the sequence", async () => {
  const src = await tourSrc();
  // The anchor rect is advisory: the card centres itself when it is null. Nothing
  // in the render path may close the tour or rewind the index because of it.
  assert(!/if\s*\(!rect\)\s*return null/.test(src), "a missing anchor must not unmount the guide");
  assert(!/rect[^\n]*setIndex/.test(src), "a missing anchor must not change the step index");
});

Deno.test("exactly one ProductTour instance is mounted", async () => {
  const app = await appSrc();
  const layout = await read("../../src/components/MainLayout.tsx");
  const mounts = [...(app + layout).matchAll(/<ProductTour\s*\/>/g)].length;
  assertEquals(mounts, 1, "the guide must be mounted once - duplicates fight over open state");
});

// -------------------------------------------------------------- persistence --

Deno.test("completion is read from exactly the field it is written to", async () => {
  const src = await hookSrc();
  // One canonical persisted field: company_brain.profile.onboarding_meta.
  assert(/m\.product_tour_completed/.test(src), "readMeta must read product_tour_completed");
  assert(/product_tour_completed:\s*true/.test(src), "markCompleted must write product_tour_completed");
  assert(
    /onboarding_meta:\s*next/.test(src),
    "the write must target onboarding_meta - the same object readMeta parses",
  );
  assert(
    !/localStorage\.setItem\(\s*['"]agentory\.product_tour_completed/.test(src),
    "completion must not also live in localStorage - that is a competing source of truth",
  );
});

Deno.test("Skip persists a distinct, readable marker", async () => {
  const src = await hookSrc();
  assert(/product_tour_skipped_at:\s*new Date\(\)/.test(src), "markSkipped must stamp skipped_at");
  assert(/state\.skipped_at/.test(src), "shouldAutoOpen must honour skipped_at");
});

Deno.test("REGRESSION: save_structured allows onboarding_meta through", async () => {
  // The deployed handler silently dropped any key absent from this list, so the
  // tour's completion write succeeded (200) and persisted nothing.
  const src = await setupFnSrc();
  const allow = src.match(/const allowed:[\s\S]*?\];/);
  assert(allow, "could not locate the save_structured allow-list");
  assert(
    allow[0].includes('"onboarding_meta"'),
    "save_structured drops onboarding_meta - product-tour completion will never persist",
  );
});

Deno.test("progress is scoped per workspace, so users cannot share guide state", async () => {
  const src = await hookSrc();
  assert(/workspace_id:\s*workspaceId/.test(src), "the write must be workspace-scoped");
  assert(/if\s*\(!workspaceId\)\s*return;/.test(src), "must refuse to write without a workspace");
});
