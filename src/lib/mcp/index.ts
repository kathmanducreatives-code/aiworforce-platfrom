import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignalsTool from "./tools/list-signals";
import listCandidatesTool from "./tools/list-candidates";
import listLeadsTool from "./tools/list-leads";

// The issuer is the project this function is DEPLOYED to, read at run time from the
// function's own environment. Never `import.meta.env`: the plugin bundles this file into
// supabase/functions/mcp/index.ts and inlines the whole build-time env object (every
// VITE_ value) into the deployed source.
const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");

export default defineMcp({
  name: "agentory-mcp",
  title: "Agentory",
  version: "0.1.0",
  instructions:
    "Agentory tools: read your workspace's Scout signals, candidate profiles, and lead search results. All tools are read-only and scoped to the signed-in user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `${supabaseUrl}/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listSignalsTool, listCandidatesTool, listLeadsTool],
});
