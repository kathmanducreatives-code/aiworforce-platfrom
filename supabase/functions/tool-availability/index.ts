// tool-availability — read-only probe of which Agentory tools/providers are
// configured for this workspace's runtime. No DB writes, no external calls.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function bool(envKey: string, defaultValue = false): boolean {
  const v = Deno.env.get(envKey);
  if (v == null) return defaultValue;
  const lower = v.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(lower)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(lower)) return false;
  return defaultValue;
}
function present(envKey: string): boolean {
  const v = Deno.env.get(envKey);
  return !!v && v.length > 0;
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apifyToken = present("APIFY_API_TOKEN");
  const peopleEnabled = bool("APIFY_ENABLE_PEOPLE_SEARCH", false) && apifyToken;
  // Use the canonical flag name (matches actorRegistry: apify_linkedin_post_comments);
  // accept the legacy APIFY_ENABLE_COMMENTS as an alias so older envs still work.
  const commentsEnabled = (bool("APIFY_ENABLE_LINKEDIN_POST_COMMENTS", false) || bool("APIFY_ENABLE_COMMENTS", false)) && apifyToken;

  const availability = {
    gemini: {
      key: "gemini",
      enabled: present("LOVABLE_API_KEY") || present("GOOGLE_AI_API_KEY"),
      configured: present("LOVABLE_API_KEY") || present("GOOGLE_AI_API_KEY"),
    },
    claude: {
      key: "claude",
      enabled: present("ANTHROPIC_API_KEY"),
      configured: present("ANTHROPIC_API_KEY"),
      reason_if_unavailable: present("ANTHROPIC_API_KEY") ? undefined : "No Anthropic key configured",
      fallback_workflow: present("ANTHROPIC_API_KEY") ? undefined : "draft_outreach",
    },
    apify_jobs: {
      key: "apify_jobs",
      enabled: apifyToken,
      configured: apifyToken,
      reason_if_unavailable: apifyToken ? undefined : "Apify token not configured",
    },
    apify_people: {
      key: "apify_people",
      enabled: peopleEnabled,
      configured: peopleEnabled,
      reason_if_unavailable: peopleEnabled ? undefined : "People actor disabled or token missing",
      fallback_workflow: peopleEnabled ? undefined : "linkedin_intent_posts",
    },
    apify_posts: {
      key: "apify_posts",
      enabled: apifyToken,
      configured: apifyToken,
    },
    apify_comments: {
      key: "apify_comments",
      enabled: commentsEnabled,
      configured: commentsEnabled,
      reason_if_unavailable: commentsEnabled ? undefined : "Comments actor disabled or token missing",
      fallback_workflow: commentsEnabled ? undefined : "linkedin_intent_posts",
    },
    firecrawl: {
      key: "firecrawl",
      enabled: present("FIRECRAWL_API_KEY"),
      configured: present("FIRECRAWL_API_KEY"),
      reason_if_unavailable: present("FIRECRAWL_API_KEY") ? undefined : "Firecrawl key not configured",
    },
    resend_draft: {
      key: "resend_draft",
      enabled: present("RESEND_API_KEY"),
      configured: present("RESEND_API_KEY"),
    },
    supabase: {
      key: "supabase",
      enabled: true,
      configured: true,
    },
    csv_export: {
      key: "csv_export",
      enabled: true,
      configured: true,
    },
  };

  return new Response(JSON.stringify(availability), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
