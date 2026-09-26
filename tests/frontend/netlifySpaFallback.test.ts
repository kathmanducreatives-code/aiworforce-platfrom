// EVERY CLIENT ROUTE RESOLVES TO THE APP ON NETLIFY.
//
// Production 2026-09-26: https://teal-chimera-be7c79.netlify.app/dashboard,
// loaded directly, answered Netlify's "Page not found". The app routes with
// BrowserRouter, so /dashboard, /leads, /signals … exist only inside index.html,
// and the site had no fallback. `public/_redirects` (copied to the build root
// by Vite) rewrites every path to /index.html with a 200 — a rewrite Netlify
// applies only when no real file matches, so assets and static files are
// untouched and the app's own routing decides the page, exactly as before.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));

Deno.test("public/_redirects rewrites every path to index.html with a 200", async () => {
  const rules = (await read("public/_redirects")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assertEquals(rules.map((r) => r.split(/\s+/)), [["/*", "/index.html", "200"]],
    "one catch-all rewrite — a 200, not a 301/302, so the URL the user asked for is kept");
});

Deno.test("the app routes in the browser, which is why the fallback is needed", async () => {
  assert(/<BrowserRouter\b/.test(await read("src/App.tsx")));
});

Deno.test("no static file is shadowed: the rewrite never forces (`200!`)", async () => {
  assert(!/200!/.test(await read("public/_redirects")), "a forced rewrite would serve index.html instead of real assets");
});
