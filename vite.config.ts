import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { execSync } from "node:child_process";
import type { Plugin } from "vite";
import {
  PRODUCTION_SUPABASE_PUBLISHABLE_KEY, PRODUCTION_SUPABASE_URL, supabaseTargetMismatch,
} from "./src/integrations/supabase/productionTarget";

// WHAT COMMIT IS THE FRONTEND? Netlify sets COMMIT_REF at build time; a local
// build falls back to git. The answer ships as /version.json and as
// import.meta.env.VITE_BUILD_SHA (read by src/lib/env/projectEnvironment.ts).
function buildSha(): string {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF;
  if (process.env.VITE_BUILD_SHA) return process.env.VITE_BUILD_SHA;
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unstamped"; }
}

function versionFile(sha: string, builtAt: string): Plugin {
  return {
    name: "agentory-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({
          sha, built_at: builtAt,
          context: process.env.CONTEXT ?? null,
          deploy_id: process.env.DEPLOY_ID ?? null,
        }, null, 1) + "\n",
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  // A PRODUCTION BUILD NAMES ONE SUPABASE PROJECT. The URL and the key the bundle
  // will use (env, else the defaults the client falls back to) must belong to the
  // same project, or the site ships a login that can never work — the pairing
  // agentory.space would have shipped with (publishing plan, 2026-09-30).
  if (command === "build" && mode === "production") {
    const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
    const mismatch = supabaseTargetMismatch(
      env.VITE_SUPABASE_URL || PRODUCTION_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY || PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
    );
    if (mismatch) throw new Error(`Refusing to build: ${mismatch}.`);
  }
  const sha = buildSha();
  const builtAt = new Date().toISOString();
  process.env.VITE_BUILD_SHA = sha;
  return {
  server: {
    host: true,
    port: 8080,
  },
  plugins: [
    react(),
    mcpPlugin(),
    versionFile(sha, builtAt),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "undici": path.resolve(__dirname, "./src/lib/dummy.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
};
});
