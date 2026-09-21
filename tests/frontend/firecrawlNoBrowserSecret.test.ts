// THE FIRECRAWL KEY MUST NOT BE REACHABLE FROM THE BROWSER.
//
// `src/lib/firecrawl.ts` was a real Firecrawl client holding
// `import.meta.env.<VITE-prefixed Firecrawl key>`. Vite inlines every VITE_*
// value into the JavaScript it ships, so any production build made in an
// environment carrying that variable published the key to every visitor. The
// variable is set in the Railway environment; the last build was clean only
// because that build happened to run without it.
//
// These pin the fix at the source level, where it is cheap to check on every
// run. The bundle itself is checked separately by building with a canary key.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

/** Every file Vite could bundle. */
async function* sourceFiles(dir = "src"): AsyncGenerator<string> {
  for await (const e of Deno.readDir(new URL(dir + "/", ROOT))) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* sourceFiles(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) yield p;
  }
}

Deno.test("no browser source reads a VITE-prefixed Firecrawl key", async () => {
  // Built from parts so this test file does not itself contain the token —
  // the substitution Vite performs is textual and does not spare comments.
  const TOKEN = ["VITE", "FIRECRAWL", "API", "KEY"].join("_");
  const offenders: string[] = [];
  for await (const f of sourceFiles()) {
    if ((await read(f)).includes(TOKEN)) offenders.push(f);
  }
  assertEquals(offenders, [], `these files would inline the key into the bundle: ${offenders.join(", ")}`);
});

Deno.test("no browser source talks to the Firecrawl API directly", async () => {
  const offenders: string[] = [];
  for await (const f of sourceFiles()) {
    if ((await read(f)).includes("api.firecrawl.dev")) offenders.push(f);
  }
  // The one permitted mention is the comment in the proxy explaining what the
  // old client used to do; assert it carries no Authorization header with it.
  for (const f of offenders) {
    const body = await read(f);
    assert(!/Authorization[^\n]*firecrawl/i.test(body), `${f} still authenticates to Firecrawl from the browser`);
    assert(!/fetch\(\s*[`'"]https:\/\/api\.firecrawl\.dev/.test(body), `${f} still fetches Firecrawl directly`);
  }
});

Deno.test("the browser client is a proxy to the Edge Function, and refuses the rest", async () => {
  const lib = await read("src/lib/firecrawl.ts");
  assert(lib.includes('supabase.functions.invoke("firecrawl-scrape"'), "scrapeUrl must go through the Edge Function");
  assertEquals(/apiKey|Authorization|Bearer/.test(lib), false, "the browser proxy must hold no credential");
  // crawl and search stay server-side: exposing them would be a paid open proxy.
  for (const m of ["search", "crawlUrl"]) {
    assert(new RegExp(`${m}\\([^)]*\\)[^{]*\\{[^}]*reject`, "s").test(lib), `${m} must not be proxied to the browser`);
  }
});

Deno.test("a provider failure reaches the caller instead of looking like an empty page", async () => {
  const lib = await read("src/lib/firecrawl.ts");
  assert(/if \(!r\?\.ok\)[\s\S]{0,200}throw new Error/.test(lib),
    "a refused scrape must throw, not return an empty result");
});

Deno.test("the live consumer no longer imports a keyed client", async () => {
  const card = await read("src/components/distribution/PlatformCard.tsx");
  assert(card.includes("firecrawl.scrapeUrl("), "the job-distribution sync still scrapes");
  assertEquals(/formats:\s*\['extract'\]/.test(card), false, "v1 extract format must be gone");
  assertEquals(/api\.firecrawl\.dev|apiKey/.test(card), false);
});
