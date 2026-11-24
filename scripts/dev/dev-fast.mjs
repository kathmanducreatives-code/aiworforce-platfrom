#!/usr/bin/env node
// DEV:FAST — the frontend with hot reload, safe by default.
//
//   npm run dev:fast                    # simulated ATLAS providers (no network to any provider)
//   npm run dev:fast -- --live-backend  # the lead panel calls the real lead-pipeline of your
//                                       # .env.local project (still never production)
//   npm run dev:fast -- --port 8090
//
// Refuses to start when .env.local points at PRODUCTION or puts a server key in a VITE_
// variable (Vite ships every VITE_ value to the browser). With the simulation on, the
// Workbench lead panel answers from dev-sim/preview.json (npm run dev:atlas -- <scenario>
// --preview) or the committed simulation — labelled SIMULATED DATA in the UI.

import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const PRODUCTION_REF = "ohsdatpvfdjdemstoiuj";
const argv = process.argv.slice(2);
const live = argv.includes("--live-backend");
const portAt = argv.indexOf("--port");
const port = portAt >= 0 ? argv[portAt + 1] : "8080";

const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const die = (msg) => { console.error(`\n✗ dev:fast refused: ${msg}\n`); process.exit(1); };
const url = env.VITE_SUPABASE_URL ?? "";
const ref = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url)?.[1] ?? null;
if (!url) die("no VITE_SUPABASE_URL in .env.local. Point it at the TEST project (tlvnfrxzjhsjgdofwehb) with its PUBLISHABLE key — see docs/dev/LOCAL_DEVELOPMENT.md.");
if (ref === PRODUCTION_REF) die(`.env.local targets PRODUCTION (${ref}). Use the TEST project for development.`);
for (const [k, v] of Object.entries(env)) {
  if (k.startsWith("VITE_") && /^(sb_secret_|eyJ)/.test(v) && /^sb_secret_/.test(v)) die(`${k} holds a server (sb_secret_) key; Vite would ship it to the browser.`);
  if (k.startsWith("VITE_") && v.startsWith("eyJ")) {
    try { const role = JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString()).role; if (role === "service_role") die(`${k} holds a service_role key.`); } catch { /* not a JWT */ }
  }
}

const childEnv = { ...process.env, VITE_STRATEGY_DISCOVERY: "true" };
if (!live) childEnv.VITE_STRATEGY_DISCOVERY_MOCK = "true";
const banner = [
  "",
  "┌───────────────────────────────────────────────────────────────────────┐",
  `│ dev:fast — Supabase project: ${(ref ?? "?").padEnd(42)}│`,
  `│ ATLAS providers: ${(live ? "LIVE backend of that project (approval still required)" : "SIMULATED — no external provider is called").padEnd(53)}│`,
  `│ Workbench preview: ${(existsSync("dev-sim/preview.json") ? "dev-sim/preview.json (from dev:atlas)" : "committed simulation (run dev:atlas … --preview)").padEnd(51)}│`,
  `│ http://localhost:${port.padEnd(53)}│`,
  "└───────────────────────────────────────────────────────────────────────┘",
  "",
];
console.log(banner.join("\n"));
const child = spawn("npx", ["vite", "--port", port, "--strictPort"], { stdio: "inherit", env: childEnv });
child.on("exit", (code) => process.exit(code ?? 0));
