const must = (value: string | undefined, key: string): string => {
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const getEnv = () => {
  const n8nApiKey = process.env.N8N_API_KEY || process.env.envN8N_API_KEY;

  return {
    apifyToken: must(process.env.APIFY_API_TOKEN, "APIFY_API_TOKEN"),
    apifyPostSearchActorId: process.env.APIFY_LINKEDIN_POST_SEARCH_ACTOR_ID || "",
    apifyPostCommentsActorId: process.env.APIFY_LINKEDIN_POST_COMMENTS_ACTOR_ID || "harvestapi/linkedin-post-comments",
    firecrawlApiKey: must(process.env.FIRECRAWL_API_KEY, "FIRECRAWL_API_KEY"),
    firecrawlBaseUrl: process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev/v1",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    claudeModel: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
    supabaseUrl: must(process.env.SUPABASE_URL, "SUPABASE_URL"),
    supabaseServiceKey: must(process.env.SUPABASE_SERVICE_KEY, "SUPABASE_SERVICE_KEY"),
    supabaseOutreachTable: process.env.SUPABASE_OUTREACH_TABLE || "sp_outreach_leads_scored",
    supabaseVcTable: process.env.SUPABASE_VC_TABLE || "sp_vc_portfolio",
    n8nBaseUrl: must(process.env.N8N_WEBHOOK_URL, "N8N_WEBHOOK_URL"),
    n8nApiKey: n8nApiKey || "",
    n8nOutreachPath: process.env.N8N_OUTREACH_WEBHOOK_PATH || "/webhook/outreach-intercept",
    maxJobLeads: Number(process.env.MAX_JOB_LEADS || 20),
    dryRun: (process.env.DRY_RUN || "true").toLowerCase() === "true",
    runVcPortfolio: (process.env.RUN_VC_PORTFOLIO || "false").toLowerCase() === "true"
  };
};

export type PipelineEnv = ReturnType<typeof getEnv>;
