#!/usr/bin/env node
// VERIFY A PRODUCTION FRONTEND BUILD before it is deployed anywhere.
//   node scripts/release/verify-frontend-build.mjs [dist]
// Refuses when the bundle: talks to any Supabase project but production
// (ohsdatpvfdjdemstoiuj); mentions the retired Lovable-era projects; carries a
// server key (service_role JWT or sb_secret_); lacks the SPA fallback, the
// security headers, the version stamp, or the same-origin boot script; or keeps
// an inline <script> body / inline event handler (the CSP forbids them).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const PROD = "ohsdatpvfdjdemstoiuj";
const RETIRED = ["wqnigjhcwjxtmordrwno", "zbwsbnqqpkvdhqwavjke", "luvostyizefajbltukkc", "eifnmcvswscoggoavsup"];
const dist = process.argv[2] ?? "dist";
const fail = [];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
if (!existsSync(dist)) { console.error(`no build at ${dist}`); process.exit(2); }
walk(dist);
const text = files.filter((f) => /\.(js|html|json|css|txt|xml)$/.test(f) || /_redirects$|_headers$/.test(f))
  .map((f) => [f, readFileSync(f, "utf8")]);

const urlRefs = new Set();
for (const [, s] of text) for (const m of s.matchAll(/https?:\/\/([a-z0-9]{20})\.supabase\.(co|in)/g)) urlRefs.add(m[1]);
for (const r of urlRefs) if (r !== PROD) fail.push(`Supabase URL for a non-production project: ${r}`);
if (!urlRefs.has(PROD)) fail.push("the production Supabase URL is not in the bundle");
for (const [f, s] of text) for (const r of RETIRED) if (s.includes(r)) fail.push(`retired project ${r} referenced in ${f}`);

for (const [f, s] of text) {
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(s)) fail.push(`a Supabase secret key (sb_secret_) in ${f}`);
  for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const claims = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (claims.role && claims.role !== "anon") fail.push(`a ${claims.role} JWT in ${f}`);
      if (claims.ref && claims.ref !== PROD) fail.push(`a key for project ${claims.ref} in ${f}`);
    } catch { /* not a JWT */ }
  }
}

const need = (p) => existsSync(join(dist, p)) || fail.push(`missing ${p}`);
["index.html", "_redirects", "_headers", "version.json", "boot-watchdog.js", "agentory-icon.png"].forEach(need);
if (existsSync(join(dist, "_redirects")) && !/^\/\*\s+\/index\.html\s+200\s*$/m.test(readFileSync(join(dist, "_redirects"), "utf8"))) fail.push("_redirects lacks the SPA fallback");
if (existsSync(join(dist, "_headers"))) {
  const h = readFileSync(join(dist, "_headers"), "utf8");
  if (!h.includes(`connect-src 'self' https://${PROD}.supabase.co wss://${PROD}.supabase.co`)) fail.push("CSP connect-src does not name exactly the production project");
  if (/script-src[^;]*unsafe-inline/.test(h)) fail.push("CSP allows inline scripts");
}
const html = existsSync(join(dist, "index.html")) ? readFileSync(join(dist, "index.html"), "utf8") : "";
if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) fail.push("index.html has an inline <script> body (blocked by the CSP)");
if (/\son[a-z]+\s*=\s*["']/i.test(html)) fail.push("index.html has an inline event handler (blocked by the CSP)");
if (html.includes("gpt-engineer-file-uploads")) fail.push("index.html still loads an asset from the Lovable upload bucket");

let version = null;
try { version = JSON.parse(readFileSync(join(dist, "version.json"), "utf8")); } catch { /* reported above */ }
if (fail.length) { console.error("FRONTEND BUILD REFUSED:\n  - " + fail.join("\n  - ")); process.exit(1); }
console.log(JSON.stringify({ ok: true, supabase_projects: [...urlRefs], build: version, files: files.length }));
