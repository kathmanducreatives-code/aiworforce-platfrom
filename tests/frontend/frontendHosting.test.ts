// THE FRONTEND DEPLOYS WITHOUT LOVABLE, TO ONE BACKEND, UNDER A STRICT CSP.
// Cloudflare Pages / Netlify read public/_redirects + public/_headers; Vercel
// reads vercel.json. Both must allow exactly the production Supabase project
// and no inline scripts; index.html must not depend on Lovable's upload bucket.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));
const PROD = "ohsdatpvfdjdemstoiuj";

Deno.test("CSP: connect-src names only the production project; no inline scripts", async () => {
  const h = await read("public/_headers");
  const csp = /Content-Security-Policy: (.+)/.exec(h)?.[1] ?? "";
  assert(csp.includes(`connect-src 'self' https://${PROD}.supabase.co wss://${PROD}.supabase.co;`));
  assert(!/script-src[^;]*'unsafe-inline'/.test(csp));
  assert(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"));
  for (const ref of ["wqnigjhcwjxtmordrwno", "zbwsbnqqpkvdhqwavjke", "tlvnfrxzjhsjgdofwehb"]) assert(!h.includes(ref));
});

Deno.test("Vercel config carries the same CSP, the SPA rewrite and the dist output", async () => {
  const v = JSON.parse(await read("vercel.json"));
  const csp = (await read("public/_headers")).match(/Content-Security-Policy: (.+)/)?.[1];
  const all = v.headers.find((x: { source: string }) => x.source === "/(.*)");
  assertEquals(all.headers.find((x: { key: string }) => x.key === "Content-Security-Policy").value, csp);
  assertEquals(v.outputDirectory, "dist");
  assertEquals(v.rewrites[0].destination, "/index.html");
  assert(v.rewrites[0].source.includes("assets/"), "assets are never rewritten to index.html");
});

Deno.test("index.html: no inline script bodies or handlers, no Lovable-hosted assets", async () => {
  const html = await read("index.html");
  assert(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html), "inline <script> would be blocked by the CSP");
  assert(!/\son[a-z]+\s*=\s*["']/i.test(html), "inline event handlers would be blocked by the CSP");
  assert(!html.includes("gpt-engineer-file-uploads"));
  assert(html.includes('<script src="/boot-watchdog.js"></script>'));
  const js = await read("public/boot-watchdog.js");
  assert(js.includes("boot-reload") && js.includes("boot-signout"), "the recovery buttons are still wired");
});

Deno.test("Cloudflare Pages config builds dist", async () => {
  const w = await read("wrangler.toml");
  assert(/pages_build_output_dir = "dist"/.test(w));
});
