import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSignalsTool from "./tools/list-signals";
import listCandidatesTool from "./tools/list-candidates";
import listLeadsTool from "./tools/list-leads";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "agentory-mcp",
  title: "Agentory",
  version: "0.1.0",
  instructions:
    "Agentory tools: read your workspace's Scout signals, candidate profiles, and lead search results. All tools are read-only and scoped to the signed-in user via Supabase RLS.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listSignalsTool, listCandidatesTool, listLeadsTool],
});
