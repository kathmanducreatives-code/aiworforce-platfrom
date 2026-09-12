// THE CONTENT STUDIO REDESIGN, AND THE ONE SIDEBAR RULE.
//
// Behaviour where the code is pure (the sidebar policy, the Studio model), and
// source where the guarantee is about wiring: that the sidebar decision lives
// once in the shared layout, that the Content page has one Content employee
// (Scribe), and that the UI reaches models only through the Content service.
//
// ZERO network, ZERO database, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  collapsedFor, defaultCollapsed, readPrefs, routeKind, withToggle, writePrefs, SIDEBAR_PREFS_KEY,
} from "../../src/lib/sidebarPolicy.ts";
import {
  SCRIBE_ACTIONS, forYou, revisionInstruction, sourceCardOf, versionLabel,
} from "../../src/lib/content/contentStudioModel.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

// ══════════ 1. the sidebar rule ═════════════════════════════════════════════

Deno.test("Dashboard opens expanded; every working page opens compact", () => {
  assertEquals(routeKind("/dashboard"), "home");
  assertEquals(routeKind("/dashboard/"), "home");
  for (const p of ["/content", "/signals", "/leads", "/agents", "/company-brain", "/email-sequences", "/workflows", "/integrations", "/settings/integrations"]) {
    assertEquals(routeKind(p), "work", p);
    assertEquals(collapsedFor(p, {}), true, p);
  }
  assertEquals(collapsedFor("/dashboard", {}), false);
  assertEquals([defaultCollapsed("home"), defaultCollapsed("work")], [false, true]);
});

Deno.test("the desired walk: Dashboard → Content → Signals → Dashboard", () => {
  const prefs = {};
  assertEquals(["/dashboard", "/content", "/signals", "/dashboard"].map((p) => collapsedFor(p, prefs)),
    [false, true, true, false]);
});

Deno.test("a manual toggle is kept for that kind of page for the session", () => {
  const store = memStore();
  // Expand on Content: working pages stay expanded, the Dashboard is unaffected.
  writePrefs(store, withToggle("/content", readPrefs(store), false));
  assertEquals(collapsedFor("/signals", readPrefs(store)), false);
  assertEquals(collapsedFor("/dashboard", readPrefs(store)), false);
  // Collapse on the Dashboard: home stays compact, work keeps its own choice.
  writePrefs(store, withToggle("/dashboard", readPrefs(store), true));
  assertEquals(collapsedFor("/dashboard", readPrefs(store)), true);
  assertEquals(collapsedFor("/leads", readPrefs(store)), false);
});

Deno.test("blocked or corrupt storage reads as no preference, never a crash", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assertEquals(readPrefs(broken), {});
  writePrefs(broken, { work: false }); // must not throw
  const junk = memStore(); junk.setItem(SIDEBAR_PREFS_KEY, "{not json");
  assertEquals(readPrefs(junk), {});
  assertEquals(readPrefs(null), {});
});

Deno.test("the rule lives ONCE, in the shared layout — no page carries collapse logic", async () => {
  const layout = code(await read("src/components/MainLayout.tsx"));
  assert(layout.includes("collapsedFor(location.pathname, readPrefs(sessionStore))"), "seeded and re-derived from the route");
  assert(layout.includes("onToggle={toggleSidebar}") && layout.includes("withToggle(location.pathname"), "manual toggle recorded");
  assert(/transition-\[margin\] duration-200/.test(layout), "a quiet ~200ms transition, no layout jump");
  assert(layout.includes("{isMobile && (") && layout.includes("<MobileHeader"), "mobile keeps its own drawer header");
  for (const page of ["src/pages/Content.tsx", "src/pages/Signals.tsx", "src/pages/Leads.tsx"]) {
    let s = "";
    try { s = code(await read(page)); } catch { continue; }
    assert(!/setIsSidebarCollapsed|sidebarPolicy|collapsedFor/.test(s), `${page} must not own sidebar state`);
  }
  const sidebar = await read("src/components/Sidebar.tsx");
  const m = sidebar.match(/collapsed \? 'w-\[(\d+)px\]'/);
  assert(m && Number(m[1]) >= 60 && Number(m[1]) <= 72, "collapsed width within 60–72px");
});

// ══════════ 2. the Studio model ═════════════════════════════════════════════

Deno.test("Scribe's contextual actions are typed revisions, plus the visual", () => {
  assertEquals(SCRIBE_ACTIONS.map((a) => a.label),
    ["Improve hook", "Make more concise", "Change angle", "Give 3 alternatives", "Generate visual"]);
  assertEquals(SCRIBE_ACTIONS.filter((a) => a.revision === null).map((a) => a.id), ["visual"]);
});

Deno.test("a revision keeps the brief — and therefore who is writing and whose news it is — first", () => {
  const brief = "Scribe, write a LinkedIn post. Draft only.\n\nWHO IS WRITING: us\n\nWho it happened to: Outreach — a competitor of ours, not us.";
  const out = revisionInstruction(brief, "Make the draft more concise.", "Saw Outreach just dropped…");
  assert(out.startsWith(brief), "the attributed brief leads");
  assert(out.includes("Keep who is writing and whose news it is exactly as stated above."));
  assert(out.indexOf("Make the draft more concise.") < out.indexOf("CURRENT DRAFT:"));
  assert(out.endsWith("Saw Outreach just dropped…"));
});

Deno.test("history says what produced each version, including what was asked", () => {
  assertEquals(versionLabel({ generation_source: "manual_edit" }), "Edited by you");
  assertEquals(versionLabel({ generation_source: "scribe_regeneration", prompt_context: { revision: SCRIBE_ACTIONS[1].revision } }),
    "Rewritten by Scribe · Make more concise");
  assertEquals(versionLabel({ generation_source: "scribe_regeneration", prompt_context: { revision: "open with the customer's pain" } }),
    "Rewritten by Scribe · “open with the customer's pain”");
});

Deno.test("a source card shows the decision, and puts agent plumbing behind Why this?", () => {
  const c = sourceCardOf({
    id: "s1", title: "Outreach February 2026 Product Release", signal_type: "competitor_activity",
    description: "Outreach shipped agentic sequences.", reason: "Contrast approval-first with autopilot.",
    fit_score: 43.4, competitor_name: "outreach", store: "signal_events",
    raw: { subject_type: "competitor", subject_key: "outreach", origin: "radar" }, source: "firecrawl",
  });
  assertEquals([c.title, c.company, c.about, c.relevance], ["Outreach February 2026 Product Release", "Outreach", "Competitor · Outreach", 43]);
  assertEquals(c.angle, "Contrast approval-first with autopilot.");
  assert(c.why.some((w) => w.includes("radar")) && c.why.some((w) => w.includes("43/99")));
  assertEquals(forYou([{ id: "a", title: "a", fit_score: 10 }, { id: "b", title: "b", fit_score: 80 }], 1).map((s) => s.id), ["b"]);
});

// ══════════ 3. one Content employee, no model calls from the UI ═════════════

Deno.test("the Content page presents ONE Content employee: Scribe, Content Strategist", async () => {
  const files = ["src/pages/Content.tsx", "src/components/content/ScribePanel.tsx",
    "src/components/content/ContentStudioEditor.tsx", "src/components/content/ContentSourcesPanel.tsx",
    "src/components/content/SourcePreview.tsx"];
  for (const f of files) {
    assert(!/\bMira\b/.test(code(await read(f))), `${f}: Mira is the outreach persona, not Content's`);
  }
  const panel = await read("src/components/content/ScribePanel.tsx");
  assert(panel.includes(">Scribe</p>") && panel.includes(">Content Strategist</p>"));
});

Deno.test("no provider, model or key reaches the Content UI — every generation goes through the service", async () => {
  const files = ["src/pages/Content.tsx", "src/components/content/ScribePanel.tsx",
    "src/components/content/ContentStudioEditor.tsx", "src/components/content/ContentSourcesPanel.tsx",
    "src/components/content/SourcePreview.tsx"];
  for (const f of files) {
    const s = code(await read(f));
    for (const bad of ["api.openai.com", "api.anthropic.com", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "functions.invoke(", "gpt-image", "claude-haiku"]) {
      assert(!s.includes(bad), `${f} must not contain ${bad}`);
    }
    assert(!/supabase\s*\.from\(/.test(s), `${f} must not write tables directly`);
  }
});

Deno.test("reload reopens the same persisted draft: the open item is in the URL", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  assert(page.includes("const openDraftId = params.get('item');"));
  assert(page.includes("n.set('item', id)"));
});
