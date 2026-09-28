import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import { execSync } from "node:child_process";
import type { Plugin } from "vite";

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
export default defineConfig(({ mode }) => {
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
