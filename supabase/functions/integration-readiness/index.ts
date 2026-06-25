// integration-readiness: returns provider availability for the current workspace.
// Pure read of secret presence; never returns secret values. Also mirrors the
// status map into company_brain.profile.integration_status so agents can read it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Status = "connected" | "setup_needed" | "optional" | "unavailable";
interface Entry { status: Status; label: string; reason?: string }

function present(name: string): boolean {
  const v = Deno.env.get(name);
  return !!(v && v.trim().length > 0);
}

function flag(name: string, fallback = false): boolean {
  const v = Deno.env.get(name);
  if (v == null) return fallback;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function build(): Record<string, Entry> {
  const lovable = present("LOVABLE_API_KEY");
  const firecrawl = present("FIRECRAWL_API_KEY");
  const apifyToken = present("APIFY_API_TOKEN");
  const apifyEnabled = flag("APIFY_ENABLE_PEOPLE_SEARCH", true);
  const resend = present("RESEND_API_KEY");
  const openai = present("OPENAI_API_KEY");
  const anthropic = present("ANTHROPIC_API_KEY");
  const google = present("GOOGLE_AI_API_KEY");

  return {
    lovable_ai: {
      status: lovable ? "connected" : "setup_needed",
      label: "Lovable AI Gateway",
      reason: lovable ? undefined : "Required for agent reasoning. Contact support if missing.",
    },
    firecrawl: {
      status: firecrawl ? "connected" : "setup_needed",
      label: "Firecrawl (web research)",
      reason: firecrawl ? undefined : "Needed for website audits, competitor research, and ICP enrichment.",
    },
    apify_people: {
      status: apifyToken && apifyEnabled ? "connected" : (apifyToken ? "setup_needed" : "setup_needed"),
      label: "Apify (people / hiring signals)",
      reason: apifyToken && apifyEnabled
        ? undefined
        : (!apifyToken
            ? "Add an Apify API token to find decision-makers and hiring signals."
            : "People search is disabled. Set APIFY_ENABLE_PEOPLE_SEARCH=true."),
    },
    resend: {
      status: resend ? "connected" : "optional",
      label: "Resend (email drafts)",
      reason: resend ? undefined : "Optional. Needed to send approved email drafts.",
    },
    openai: {
      status: openai ? "connected" : "optional",
      label: "OpenAI",
      reason: openai ? undefined : "Optional fallback model.",
    },
    anthropic: {
      status: anthropic ? "connected" : "optional",
      label: "Anthropic",
      reason: anthropic ? undefined : "Optional fallback model.",
    },
    google_ai: {
      status: google ? "connected" : "optional",
      label: "Google AI",
      reason: google ? undefined : "Optional fallback model.",
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* GET-style call ok */ }
  const workspace_id = String(body.workspace_id ?? "");

  const providers = build();

  // Mirror into company_brain.profile.integration_status when a workspace is provided.
  if (workspace_id) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: member } = await admin
      .from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
    if (member) {
      const { data: row } = await admin
        .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
      const current = (row?.profile as Record<string, unknown>) ?? {};
      const next = { ...current, integration_status: providers };
      await admin.from("company_brain").upsert({
        workspace_id, profile: next, updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" }).then(() => {}, () => {});
    }
  }

  const summary = {
    connected: Object.values(providers).filter((p) => p.status === "connected").length,
    setup_needed: Object.values(providers).filter((p) => p.status === "setup_needed").length,
    optional: Object.values(providers).filter((p) => p.status === "optional").length,
  };

  return json({ ok: true, providers, summary });
});
