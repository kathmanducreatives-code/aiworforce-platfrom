// generate-company-brain-draft — Company Brain Onboarding v3 (server-only).
//
// Actions: research_founder | research_company | draft | save_draft | activate
//
// Every provider call is server-side, capped, and runs ONLY on an explicit user
// action. Founder enrichment additionally requires recorded consent. Nothing is
// auto-sent, no Scout Radar is triggered, and a Brain is only marked complete
// when it meets the minimum requirements.
//
// JWT-validated + workspace-membership enforced. The service_role client never
// leaves this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateJson, logProviderCall } from "../_shared/aiProvider.ts";
import { enrichFounderFromLinkedIn } from "../_shared/companyBrainResearch/founderLinkedIn.ts";
import { enrichCompanyFromWebsite, MAX_PAGES } from "../_shared/companyBrainResearch/companyWebsite.ts";
import { enrichCompanyFromLinkedIn } from "../_shared/companyBrainResearch/companyLinkedIn.ts";
import { generateBrainDraft, type DraftInput } from "../_shared/companyBrainResearch/generateBrainDraft.ts";
import type { FirecrawlPage, ResearchDeps, ResearchSourceType, ResearchProvider } from "../_shared/companyBrainResearch/types.ts";
import { applyBrainSave, deriveSignalPreferences, type CompanyBrainV2Patch } from "../_shared/companyBrainV2Save.ts";
import { normalizeCompanyBrain } from "../_shared/normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness } from "../_shared/companyBrainCompleteness.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type AnyObj = Record<string, unknown>;

/** Configurable Apify actor id — actors change; env always wins over the fallback. */
function actorId(envName: string, fallback: string): string {
  const v = Deno.env.get(envName);
  return v && v.trim() ? v.trim() : fallback;
}

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

function buildDeps(): { deps: ResearchDeps; apifyReady: boolean; firecrawlReady: boolean; llmReady: boolean } {
  const apifyToken = Deno.env.get("APIFY_API_TOKEN");
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  const llmReady = !!Deno.env.get("ANTHROPIC_API_KEY") || !!Deno.env.get("LOVABLE_API_KEY");

  const deps: ResearchDeps = { actorId };

  if (apifyToken) {
    deps.runApifyActor = async (actor, input) => {
      const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${apifyToken}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`apify_${res.status}`);
      const items = await res.json();
      return Array.isArray(items) ? items : [];
    };
  }

  if (firecrawlKey) {
    deps.firecrawlScrape = async (url): Promise<FirecrawlPage | null> => {
      const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      });
      if (!res.ok) return null;
      const j = await res.json();
      const d = (j?.data ?? {}) as AnyObj;
      const meta = (d.metadata ?? {}) as AnyObj;
      return {
        url,
        title: (meta.title as string) ?? null,
        description: (meta.description as string) ?? null,
        markdown: (d.markdown as string) ?? null,
      };
    };
    deps.firecrawlMap = async (url): Promise<string[]> => {
      const res = await fetch(`${FIRECRAWL_V2}/map`, {
        method: "POST",
        headers: { Authorization: `Bearer ${firecrawlKey}`, "Content-Type": "application/json" },
        // Hard cap: onboarding never maps a whole site.
        body: JSON.stringify({ url, limit: 60 }),
      });
      if (!res.ok) return [];
      const j = await res.json();
      const links = (j?.links ?? j?.data ?? []) as unknown[];
      return links.map((l) => (typeof l === "string" ? l : String((l as AnyObj)?.url ?? ""))).filter(Boolean);
    };
  }

  return { deps, apifyReady: !!apifyToken, firecrawlReady: !!firecrawlKey, llmReady };
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

  let body: AnyObj;
  try { body = await req.json(); } catch { return json({ error: "invalid_json_body" }, 400); }

  const action = String(body.action ?? "");
  const workspace_id = String(body.workspace_id ?? "");
  if (!workspace_id) return json({ error: "missing_workspace_id" }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Workspace membership — the only authorization gate.
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id")
    .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "forbidden" }, 403);

  const { deps, apifyReady, firecrawlReady, llmReady } = buildDeps();

  async function loadProfile(): Promise<AnyObj> {
    const { data } = await admin.from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
    return (data?.profile as AnyObj) ?? {};
  }

  /** Best-effort audit trail. Never blocks onboarding if the table is absent. */
  async function recordRun(run: {
    source_type: ResearchSourceType; provider: ResearchProvider; source_url?: string;
    status: "completed" | "failed"; input?: unknown; output?: unknown; evidence?: unknown; error_message?: string;
  }) {
    try {
      await admin.from("company_brain_research_runs").insert({
        workspace_id, user_id: userId,
        source_type: run.source_type, provider: run.provider,
        source_url: run.source_url ?? null, status: run.status,
        input: run.input ?? {}, output: run.output ?? {}, evidence: run.evidence ?? {},
        error_message: run.error_message ?? null,
      });
    } catch (e) {
      console.warn("research run not recorded (table may not exist yet)", e);
    }
  }

  try {
    // ---------------- Step 1: founder (consent + explicit click required) ----
    if (action === "research_founder") {
      const profileUrl = String(body.linkedin_url ?? "");
      const consent = body.consent === true;
      if (!consent) return json({ ok: false, skipped: true, reason: "consent_not_given" });
      if (!apifyReady) return json({ ok: false, skipped: true, reason: "apify_not_configured" });

      const r = await enrichFounderFromLinkedIn({ profileUrl, consent }, deps);
      await recordRun({
        source_type: "founder_linkedin", provider: "apify", source_url: profileUrl,
        status: r.ok ? "completed" : "failed",
        input: { linkedin_url: profileUrl, consent },
        output: r.research ?? {}, evidence: { source_url: profileUrl },
        error_message: r.ok ? undefined : (r.error ?? r.reason),
      });
      return json({ ok: r.ok, research: r.research, skipped: r.skipped, reason: r.reason, error: r.error });
    }

    // ---------------- Step 2: company (website required, LinkedIn optional) --
    if (action === "research_company") {
      const websiteUrl = String(body.website_url ?? "");
      const companyLinkedIn = String(body.linkedin_url ?? "");
      if (!firecrawlReady) return json({ ok: false, skipped: true, reason: "firecrawl_not_configured" });

      const web = await enrichCompanyFromWebsite({
        websiteUrl,
        nameHint: String(body.name ?? ""),
        descriptionHint: String(body.description ?? ""),
        maxPages: MAX_PAGES,
      }, deps);
      await recordRun({
        source_type: "company_website", provider: "firecrawl", source_url: websiteUrl,
        status: web.ok ? "completed" : "failed",
        input: { website_url: websiteUrl, max_pages: MAX_PAGES },
        output: web.research ?? {}, evidence: { source_pages: web.research?.source_pages ?? [] },
        error_message: web.ok ? undefined : (web.error ?? web.reason),
      });

      // Optional — never required, only when the user supplied a company URL.
      let li = null as Awaited<ReturnType<typeof enrichCompanyFromLinkedIn>> | null;
      if (companyLinkedIn && apifyReady) {
        li = await enrichCompanyFromLinkedIn({ companyUrl: companyLinkedIn }, deps);
        await recordRun({
          source_type: "company_linkedin", provider: "apify", source_url: companyLinkedIn,
          status: li.ok ? "completed" : "failed",
          input: { linkedin_url: companyLinkedIn },
          output: li.research ?? {}, evidence: { linkedin_url: companyLinkedIn },
          error_message: li.ok ? undefined : (li.error ?? li.reason),
        });
      }

      return json({
        ok: web.ok,
        company_research: web.research,
        company_linkedin: li?.research ?? null,
        pages_fetched: web.pages_fetched,
        error: web.error, skipped: web.skipped, reason: web.reason,
      });
    }

    // ---------------- Step 3: AI draft -------------------------------------
    if (action === "draft") {
      if (!llmReady) return json({ ok: false, skipped: true, reason: "llm_not_configured" });

      const draftInput: DraftInput = {
        founder_input: (body.founder_input ?? {}) as DraftInput["founder_input"],
        founder_research: (body.founder_research ?? null) as DraftInput["founder_research"],
        company_input: (body.company_input ?? {}) as DraftInput["company_input"],
        company_research: (body.company_research ?? null) as DraftInput["company_research"],
        company_linkedin: (body.company_linkedin ?? null) as DraftInput["company_linkedin"],
        existing_company_brain: await loadProfile(),
      };

      deps.generateJson = async ({ system, user }) => {
        const ai = await generateJson({
          taskType: "helper",
          systemPrompt: system,
          messages: [{ role: "user", content: user }],
          temperature: 0.2,
          maxTokens: 3000,
          functionName: "generate-company-brain-draft",
          workspaceId: workspace_id,
        });
        await logProviderCall(admin, {
          workspace_id, function_name: "generate-company-brain-draft", task_type: "helper",
          provider: ai.provider, model: ai.model, success: ai.ok, latency_ms: ai.latencyMs, error_code: ai.errorCode,
        }).catch(() => {});
        return { ok: ai.ok, json: ai.json, error: ai.error };
      };

      const r = await generateBrainDraft(draftInput, deps);
      await recordRun({
        source_type: "ai_draft", provider: "claude",
        status: r.ok ? "completed" : "failed",
        input: { has_founder_research: !!draftInput.founder_research, has_company_research: !!draftInput.company_research },
        output: r.draft ?? {}, evidence: r.draft?.evidence ?? {},
        error_message: r.ok ? undefined : r.error,
      });
      return json({ ok: r.ok, draft: r.draft, error: r.error });
    }

    // ---------------- Step 4/5: save draft, then activate -------------------
    if (action === "save_draft" || action === "activate") {
      const patch = (body.patch ?? {}) as CompanyBrainV2Patch;
      const existing = await loadProfile();
      const result = applyBrainSave(existing, patch, { activate: action === "activate" });

      if (action === "activate" && !result.onboarding_completed) {
        // Refuse to mark a half-built Brain as ready — but keep the draft saved.
        await admin.from("company_brain").upsert({
          workspace_id, profile: result.profile, updated_at: new Date().toISOString(),
        }, { onConflict: "workspace_id" });
        return json({
          ok: false, activated: false, blocked_reasons: result.blocked_reasons,
          completeness: result.completeness, profile: result.profile,
        }, 200);
      }

      const row: AnyObj = { workspace_id, profile: result.profile, updated_at: new Date().toISOString() };
      if (result.onboarding_completed) {
        row.onboarding_completed = true;
        row.onboarding_completed_at = new Date().toISOString();
        // Give Radar usable defaults derived from the Brain (no scan is triggered).
        row.signal_preferences = deriveSignalPreferences(result.normalized);
      }
      const { error } = await admin.from("company_brain").upsert(row, { onConflict: "workspace_id" });
      if (error) throw error;

      if (result.onboarding_completed) {
        admin.from("activity_feed").insert({
          workspace_id, event_type: "onboarding_completed",
          title: "Company Brain activated",
          body: String(result.normalized.company.name || ""),
          metadata: { user_id: userId, confidence: result.completeness.confidence },
        }).then(() => {}, () => {});
      }

      return json({
        ok: true, activated: result.onboarding_completed,
        completeness: result.completeness, profile: result.profile,
      });
    }

    // ---------------- read-only status -------------------------------------
    if (action === "status") {
      const profile = await loadProfile();
      const normalized = normalizeCompanyBrain(profile);
      return json({
        ok: true,
        completeness: computeCompanyBrainCompleteness(normalized),
        capabilities: { apify: apifyReady, firecrawl: firecrawlReady, llm: llmReady },
      });
    }

    return json({ error: "unknown_action", action }, 400);
  } catch (e) {
    console.error("generate-company-brain-draft error", e);
    return json({ error: "internal_error", details: e instanceof Error ? e.message : String(e) }, 500);
  }
});
