// setup-company-brain: server-only onboarding handler.
// Actions: save_basics | save_sources | analyze | generate_followups | save_followups | finalize
// All AI/tool calls are server-side. Workspace membership enforced.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { isToolConfigured, runTool } from "../_shared/toolRegistry.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type AnyObj = Record<string, unknown>;

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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: AnyObj;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }

  const action = String(body.action ?? "");
  const workspace_id = String(body.workspace_id ?? "");
  if (!workspace_id) return json({ error: "missing_workspace_id" }, 400);

  // Verify membership
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id")
    .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden" }, 403);

  // Helper: load current profile
  async function loadProfile(): Promise<AnyObj> {
    const { data } = await admin
      .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
    return ((data?.profile as AnyObj) ?? {});
  }
  async function saveProfile(patch: AnyObj, extra: AnyObj = {}) {
    const current = await loadProfile();
    const merged = { ...current, ...patch };
    const { error } = await admin.from("company_brain").upsert({
      workspace_id, profile: merged, updated_at: new Date().toISOString(), ...extra,
    }, { onConflict: "workspace_id" });
    if (error) throw error;
    return merged;
  }

  try {
    if (action === "save_basics") {
      const fields = ["company_name", "website_url", "linkedin_company_url", "founder_linkedin_url", "short_description", "current_primary_goal"];
      const patch: AnyObj = {};
      for (const k of fields) if (body[k] != null) patch[k] = body[k];
      const merged = await saveProfile(patch);
      return json({ ok: true, profile: merged });
    }

    if (action === "save_sources") {
      const sources = Array.isArray(body.sources) ? body.sources : [];
      // Clear and re-insert for simplicity
      await admin.from("workspace_sources").delete().eq("workspace_id", workspace_id);
      const rows = sources
        .filter((s: AnyObj) => s && typeof s.url === "string" && s.url.trim())
        .map((s: AnyObj) => ({
          workspace_id,
          source_type: String(s.source_type ?? "other"),
          url: String(s.url).trim(),
          label: s.label ? String(s.label) : null,
          status: "pending",
        }));
      if (rows.length > 0) {
        const { error } = await admin.from("workspace_sources").insert(rows);
        if (error) throw error;
      }
      return json({ ok: true, count: rows.length });
    }

    if (action === "analyze") {
      const profile = await loadProfile();
      const { data: srcRows } = await admin
        .from("workspace_sources").select("source_type,url,label").eq("workspace_id", workspace_id);
      const sources = srcRows ?? [];

      // Optional enrichment via scrape_url if configured
      const scrapeReady = isToolConfigured("scrape_url").ready;
      const researchReady = isToolConfigured("research_web").ready;
      const enrichments: { url: string; summary: string }[] = [];
      const warnings: string[] = [];

      if (scrapeReady && sources.length) {
        const targets = sources.slice(0, 3); // limit
        for (const s of targets) {
          try {
            const r = await runTool("scrape_url", { url: s.url }, {
              admin, workspace_id, agent_slug: "system", agent_id: null, user_id: userId,
            } as any);
            if (r.ok && r.data) {
              const txt = typeof r.data === "string" ? r.data : JSON.stringify(r.data).slice(0, 2000);
              enrichments.push({ url: s.url, summary: txt.slice(0, 2000) });
            }
          } catch (_) { /* non-blocking */ }
        }
      } else if (sources.length) {
        warnings.push("Live enrichment requires Firecrawl. Continuing with manually entered data.");
      }

      const ai = await generateJson({
        taskType: "company_brain_analyze",
        systemPrompt: "You produce a faithful structured company profile. Leave a field empty (null or '') if it is not supported by the user-provided input. NEVER invent facts.",
        messages: [{
          role: "user",
          content: `User-provided company info:\n${JSON.stringify(profile, null, 2)}\n\nSources:\n${JSON.stringify(sources, null, 2)}\n\nEnrichment excerpts (may be empty):\n${JSON.stringify(enrichments, null, 2)}\n\nReturn ONLY JSON:\n{\n  "company_summary": "1-2 sentences about what the company does",\n  "target_customer_profile": "who they sell/serve",\n  "target_candidate_profile": "who they typically hire (if applicable)",\n  "offer_summary": "core offer/service",\n  "positioning": "how they position vs competitors",\n  "brand_voice": "tone of voice",\n  "outreach_style": "outreach style guidelines",\n  "competitors": ["..."],\n  "agent_instructions": "short instructions for all agents"\n}`
        }],
        temperature: 0.3,
        maxTokens: 1200,
        functionName: "setup-company-brain",
        workspaceId: workspace_id,
      });

      await logProviderCall(admin, {
        workspace_id, function_name: "setup-company-brain", task_type: "company_brain_analyze",
        provider: ai.provider, model: ai.model, success: ai.ok, latency_ms: ai.latencyMs, error_code: ai.errorCode,
      }).catch(() => {});

      const draft = (ai.ok && ai.json ? ai.json : {}) as AnyObj;
      const merged = await saveProfile({ ...draft, enriched: enrichments.length > 0 });
      return json({ ok: true, draft, profile: merged, warnings, enriched: enrichments.length > 0, connectors: { scrape_url: scrapeReady, research_web: researchReady } });
    }

    if (action === "generate_followups") {
      const profile = await loadProfile();
      const ai = await generateJson({
        taskType: "company_brain_followups",
        systemPrompt: "You generate concise onboarding follow-up questions. Output JSON only.",
        messages: [{
          role: "user",
          content: `Given this company profile:\n${JSON.stringify(profile, null, 2)}\n\nGenerate 4 short follow-up questions to refine the AI workforce's understanding. Focus on ideal customer/candidate, current goals, do-not-targets, brand tone, and top competitors. Return ONLY JSON:\n{ "questions": ["q1","q2","q3","q4"] }`
        }],
        temperature: 0.4,
        maxTokens: 600,
        functionName: "setup-company-brain",
        workspaceId: workspace_id,
      });
      const qs = (ai.ok && (ai.json as any)?.questions) || [
        "Who is your ideal customer or candidate right now?",
        "What outcome do you want ScreeningPilot to help with this month?",
        "What kind of leads/candidates should we avoid?",
        "Who are your top competitors or reference companies?",
      ];
      return json({ ok: true, questions: qs });
    }

    if (action === "save_followups") {
      const qa = Array.isArray(body.qa) ? body.qa : [];
      const merged = await saveProfile({ pilot_followup_qa: qa });
      return json({ ok: true, profile: merged });
    }

    if (action === "finalize") {
      const patch: AnyObj = {};
      if (body.profile && typeof body.profile === "object") Object.assign(patch, body.profile);
      const merged = await saveProfile(patch, {
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
      });
      // Non-blocking activity log
      admin.from("activity_feed").insert({
        workspace_id,
        event_type: "onboarding_completed",
        title: "Company Brain setup completed",
        body: merged.company_name ? String(merged.company_name) : null,
        metadata: { user_id: userId },
      }).then(() => {}, () => {});
      return json({ ok: true, profile: merged });
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e) {
    console.error("setup-company-brain error", e);
    return json({ error: "internal_error", details: e instanceof Error ? e.message : String(e) }, 500);
  }
});
