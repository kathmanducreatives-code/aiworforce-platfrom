// run-agent: execute a single step in a plan, then chain to the next.
// Schema-aligned with the wqnigjhcwjxtmordrwno backend.
//
// Input:  { plan_id | task_plan_id, step_index, agent_slug | agent_id,
//           workspace_id, user_id, instruction, input?, needs_approval? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runTool, normalizeApifySourceType } from "../_shared/toolRegistry.ts";
import { generateText, logProviderCall } from "../_shared/aiProvider.ts";
import { preferredProviderForAgent } from "../_shared/providerRouting.ts";
import { getAgentorySystemPrompt, AGENTORY_SYSTEM_PROMPT_VERSION } from "../_shared/agentorySystemPrompt.ts";
import { summarizeRegistryForPrompt } from "../_shared/actorRegistry.ts";
import { buildCompanyBrainContext, hasUsableBrain } from "../_shared/companyBrainContext.ts";


const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
function humanizeApifyError(error: string | null | undefined): string {
  switch (error) {
    case "apify_unauthorized": return "Apify authentication failed";
    case "apify_insufficient_credits": return "the Apify account is out of credits";
    case "actor_missing":
    case "actor_key_unknown":
    case "apify_actor_not_configured":
    case "apify_not_configured": return "the required Apify actor isn't configured";
    default: return "Apify could not run the search";
  }
}

function buildUserMessage(instruction: string, input: string | null | undefined): string {
  if (!input) return `Task: ${instruction}`;
  return `Task: ${instruction}\n\nInput from previous step:\n${input}`;
}

type CompanyBrain = Record<string, unknown> | null;

// Compact, labeled Company Brain summary for agent prompts — name, one-line
// description, ICP, target roles, industries, geography, goals, competitors,
// plus an explicit note when context is missing. Never dumps the full raw JSON
// profile (avoids verbosity + hallucination from stray fields).
function renderBrainForAgent(brain: CompanyBrain): string {
  if (!hasUsableBrain(brain, null)) {
    return `<company_brain>\n(no company brain yet — workspace hasn't completed onboarding. Do not invent company details, ICP, or competitors.)\n</company_brain>`;
  }
  return `<company_brain>\n${buildCompanyBrainContext(brain as Record<string, unknown>)}\n</company_brain>`;
}



Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json_body" }, 400);
  }

  const plan_id: string | undefined = body.plan_id ?? body.task_plan_id;
  const step_index: number | undefined = body.step_index;
  let agent_slug: string | undefined = body.agent_slug;
  const agent_id_in: string | undefined = body.agent_id;
  const workspace_id: string | undefined = body.workspace_id;
  const user_id: string | undefined = body.user_id;
  const instruction: string | undefined = body.instruction;
  const input: string | null | undefined = body.input ?? null;
  const needs_approval: boolean = body.needs_approval === true;
  const tool_input_body: any = body.tool_input ?? null;
  const execution_mode_body: string | undefined = body.execution_mode;

  if (!plan_id || step_index === undefined || (!agent_slug && !agent_id_in) || !workspace_id || !instruction) {
    return json({ error: "missing_required_fields" }, 400);
  }

  // Resolve agent (by slug, falling back to id).
  let agentQuery = supabase.from("agents").select("id, slug, name, model, role_prompt, department");
  if (agent_slug) agentQuery = agentQuery.eq("slug", agent_slug);
  else agentQuery = agentQuery.eq("id", agent_id_in!);
  const { data: agent, error: agentErr } = await agentQuery.maybeSingle();

  if (agentErr || !agent) {
    console.error("[run-agent] agent not found:", { agent_slug, agent_id_in, agentErr });
    return json({ error: "agent_not_found", details: agentErr?.message }, 404);
  }
  agent_slug = agent.slug ?? agent_slug;

  // Insert task row with real columns.
  const { data: task, error: taskErr } = await supabase
    .from("tasks")
    .insert({
      plan_id,
      agent_slug,
      user_id: user_id ?? null,
      status: "running",
      payload: { instruction, input, step_index },
    })
    .select("id")
    .single();

  if (taskErr || !task) {
    console.error("[run-agent] failed to insert task:", taskErr);
    return json({ error: "task_insert_failed", details: taskErr?.message }, 500);
  }

  await supabase.from("activity_feed").insert({
    workspace_id,
    plan_id,
    agent_id: agent.id,
    event_type: "agent_started",
    title: `${agent.name} started`,
    body: instruction,
    metadata: { step_index, task_id: task.id, agent_slug },
  });

  // Load company_brain.
  const { data: brainRow } = await supabase
    .from("company_brain")
    .select("profile")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  const brain = (brainRow?.profile ?? null) as CompanyBrain;

  // Inject a compact, labeled brain summary (not the raw JSON). We omit
  // companyBrain from getAgentorySystemPrompt so it doesn't add its own
  // JSON-trimmed block, then append the labeled summary once.
  const brainBlock = renderBrainForAgent(brain);
  const systemPrompt = `${agent.role_prompt ?? `You are ${agent.name}.`}\n\n${getAgentorySystemPrompt({
    taskType: "agent_execution",
    currentAgent: agent_slug ?? agent.slug ?? undefined,
    actorRegistrySummary: summarizeRegistryForPrompt(),
  })}\n\n${brainBlock}`;

  // --- Tool layer: hawk + scout get live tools (Firecrawl scrape, Apify sourcing). Broad web search is optional. ---
  let toolContext: string | null = null;
  let scrapedContext: string | null = null;
  let apifyContext: string | null = null;
  const toolNotices: string[] = [];
  // Set when an explicitly-selected Apify sourcing actor can't run (auth/config/
  // credits). Triggers a clean plan failure + in-chat error card — never a fake
  // "complete" with zero leads.
  let sourcingFailure: { error: string; message: string } | null = null;
  // Attempt log from the adaptive multi-attempt sourcing loop (Scout step).
  let adaptiveAttempts: Array<Record<string, unknown>> = [];
  // Set when an Apify sourcing actor RAN successfully but accepted 0 qualified
  // leads (not a tool failure). We then skip Aria — there is nothing to rank.
  let zeroAcceptedSourcing = false;
  let sourcingAttemptsCount = 0;
  // AI Source Planner artifacts (carried into the Scout task result so the final
  // step can render Workbench Insights + a definitive process narrative).
  let sourcePlanMeta: Record<string, unknown> | null = null;
  let sourceQualityMeta: Record<string, unknown> | null = null;

  if (agent_slug === "hawk" || agent_slug === "scout") {
    const baseCtx = {
      admin: supabase,
      workspace_id,
      agent_slug,
      agent_id: agent.id,
      agent_name: agent.name,
      plan_id,
      task_id: task.id,
      user_id: user_id ?? null,
    };

    // 1) Firecrawl scrape — if instruction/input contains URLs.
    const urlRe = /https?:\/\/[^\s)\]"'<>]+/g;
    const haystack = `${instruction ?? ""}\n${input ?? ""}`;
    const urls = Array.from(new Set((haystack.match(urlRe) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))).slice(0, 3);

    if (urls.length > 0) {
      const blocks: string[] = [];
      for (const u of urls) {
        const r = await runTool("scrape_url", { url: u, extraction_goal: instruction, max_pages: 1 }, baseCtx);
        if (r.ok && r.data) {
          const d = r.data as { source_url?: string; title?: string; markdown?: string; summary?: string };
          blocks.push(`SOURCE: ${d.source_url ?? u}${d.title ? ` — ${d.title}` : ""}${d.summary ? `\nSUMMARY: ${d.summary}` : ""}\n\n${d.markdown ?? ""}`);
        } else if (r.unavailable) {
          toolNotices.push(`Firecrawl unavailable for ${u} (${r.error ?? "not configured"}).`);
        } else if (!r.ok) {
          toolNotices.push(`Scrape failed for ${u}: ${r.error ?? "unknown"}.`);
        }
      }
      if (blocks.length > 0) {
        scrapedContext = `SCRAPED CONTENT (Firecrawl):\n\n${blocks.join("\n\n---\n\n")}`;
      }
    }

    // 2) Apify sourcing — only when the planner explicitly selected an Apify tool/actor,
    //    or (legacy path) when no tool_input was supplied and the instruction looks like sourcing.
    const sourcingRe = /\b(find|source|sourcing|discover|prospects?|leads?|founders?|companies|hiring|job openings|roles|recruit(?:ers?|ing)|candidates?|engineers?|marketers?|linkedin posts?|comments?)\b/i;
    const planned_actor_key: string | null = tool_input_body?.selected_actor_key ?? null;
    const planned_tool_name: string | null = tool_input_body?.tool_name ?? null;
    const isFirecrawlSelected =
      planned_tool_name === "scrape_url"
      || planned_actor_key === "firecrawl_scrape_url";
    const isApifySelected =
      planned_tool_name === "source_with_apify"
      || (typeof planned_actor_key === "string" && planned_actor_key.startsWith("apify_"));
    const shouldUseApify = !isFirecrawlSelected && (
      isApifySelected
      || (!tool_input_body && sourcingRe.test(`${instruction ?? ""} ${input ?? ""}`))
    );

    if (shouldUseApify) {
      const raw_source_type: string | null = tool_input_body?.source_type ?? null;
      let source_type = normalizeApifySourceType(raw_source_type);
      if (!raw_source_type && !planned_actor_key) {
        const text = `${instruction ?? ""} ${input ?? ""}`.toLowerCase();
        if (/\b(hiring|job openings?|jobs?|roles?|engineers?|marketers?|developers?|candidates?|people|companies|founders?|prospects?|startups?|orgs?)\b/.test(text)) {
          source_type = "jobs";
        } else if (/\blinkedin\b|\bposts?\b|\bcomments?\b/.test(text)) {
          source_type = "jobs";
        }
      }

      const shouldRun = agent_slug === "scout" || agent_slug === "hawk";

      if (shouldRun) {
        let location: string | null = tool_input_body?.location ?? null;
        let roleKeywords: string[] = Array.isArray(tool_input_body?.role_keywords) ? tool_input_body.role_keywords : [];
        let max_results: number = typeof tool_input_body?.max_results === "number"
          ? Math.max(1, Math.min(200, tool_input_body.max_results))
          : 5; // QA-safe default — never silently source 25.

        if (!location) {
          const locMatch = (instruction ?? "").match(/\bin\s+([A-Z][A-Za-z\s\-]+?)(?:[.,]|$)/);
          location = locMatch?.[1]?.trim() ?? null;
        }
        if (roleKeywords.length === 0) {
          roleKeywords = Array.from(
            new Set(((instruction ?? "").toLowerCase().match(/\b(marketing|marketer|sales|engineer|developer|designer|founder|product|react|frontend|backend|growth|recruiter)\b/g) ?? [])),
          );
        }

        // Adaptive input validation: fix typos (GGTM→GTM, healtcare→healthcare)
        // on the query, roles, and location before the actor runs.
        const { normalizeTerm } = await import("../_shared/inputNormalize.ts");
        const rawQuery = (tool_input_body?.query as string) ?? instruction;
        let normalizedQuery = normalizeTerm(rawQuery) || rawQuery;
        roleKeywords = roleKeywords.map((r) => normalizeTerm(r)).filter(Boolean);
        if (location) location = normalizeTerm(location);

        let plannedUserInput: Record<string, unknown> | undefined =
          (tool_input_body?.user_input && typeof tool_input_body.user_input === "object")
            ? tool_input_body.user_input as Record<string, unknown> : undefined;

        // ---- AI Source Planner (Phase 4): Gemini shapes the best GENERIC actor
        // input for the (already deterministically-selected) actor; a deterministic
        // planner + validator are the authoritative fallback/guardrail. Never lets
        // the model pick the actor or run a tool. Only runs when we know the actor's
        // schema; otherwise the existing deterministic input is used unchanged.
        try {
          const { getActorInputSchema } = await import("../_shared/actorInputSchemas.ts");
          const plannerSchema = getActorInputSchema(planned_actor_key);
          if (plannerSchema) {
            const { planActorInput } = await import("../_shared/actorInputPlanner.ts");
            const { parseStrictConstraints: _psc } = await import("../_shared/sourcingRetry.ts");
            const strictForPlan = _psc(instruction ?? "");
            const postUrls = Array.isArray((plannedUserInput?.postUrls)) ? plannedUserInput!.postUrls as string[]
              : ((instruction ?? "").match(/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)"']+/ig) ?? []);
            const planRes = await planActorInput({
              user_request: instruction ?? "",
              actor_key: planned_actor_key!,
              source_type: plannerSchema.source_type,
              count: max_results,
              normalized: {
                role: roleKeywords[0] ?? (tool_input_body?.target_role as string) ?? undefined,
                industry: (tool_input_body?.industry as string) ?? undefined,
                location: location ?? undefined,
                company_category: (tool_input_body?.company_category as string) ?? undefined,
                company_stage: (tool_input_body?.stage as string) ?? undefined,
                topic: (tool_input_body?.query as string) ?? undefined,
                count: max_results,
              },
              competitors: Array.isArray(tool_input_body?.competitors) ? tool_input_body.competitors as string[] : undefined,
              post_urls: postUrls,
              strict: strictForPlan,
              strict_location_value: strictForPlan.location ? (location ?? null) : null,
            });
            const pin = planRes.input as Record<string, unknown>;
            if (typeof pin.query === "string" && pin.query.trim()) normalizedQuery = pin.query.trim();
            if (Array.isArray(pin.role_keywords) && (pin.role_keywords as unknown[]).length) roleKeywords = pin.role_keywords as string[];
            if (typeof pin.location === "string" && pin.location.trim()) location = pin.location.trim();
            if (pin.user_input && typeof pin.user_input === "object") {
              plannedUserInput = { ...(plannedUserInput ?? {}), ...(pin.user_input as Record<string, unknown>) };
            }
            sourcePlanMeta = {
              source: planRes.source,
              planner_mode: planRes.planner_mode,
              provider_used: planRes.provider_used,
              model_used: planRes.model_used,
              ai_calls: planRes.ai_calls,
              gemini_used: planRes.provider_used === "lovable-ai",
              claude_used: planRes.provider_used === "anthropic",
              deterministic_fallback_used: planRes.planner_mode === "deterministic_fallback",
              actor_key: planned_actor_key,
              primary_query: planRes.plan.query_strategy.primary_query,
              role_aliases: planRes.plan.query_strategy.role_aliases ?? [],
              broadening_level: planRes.plan.query_strategy.broadening_level,
              expected_entity_type: planRes.plan.expected_entity_type,
              generated_actor_input: planRes.plan.input,
              sanitized_actor_input: planRes.input,
              validation_ok: planRes.validation.ok,
              validation_warnings: planRes.validation.warnings,
              missing_info: planRes.plan.missing_info,
            };
            console.log("[run-agent] source planner", { mode: planRes.planner_mode, provider: planRes.provider_used, model: planRes.model_used, valid: planRes.validation.ok, query: normalizedQuery, roles: roleKeywords.length });
          }
        } catch (e) { console.warn("[run-agent] source planner failed, using deterministic input:", e); }

        const apifyInput = {
          selected_actor_key: planned_actor_key ?? undefined,
          source_type,
          search_goal: normalizedQuery,
          query: normalizedQuery,
          location: location ?? undefined,
          role_keywords: roleKeywords.length > 0 ? roleKeywords : undefined,
          max_results,
          // Phase 3 — pass whitelisted structured input (e.g. LinkedIn targetUrls,
          // keywords, topics) through to the actor-specific input adapter.
          input: plannedUserInput,
        };

        console.log("[run-agent] apify input", {
          requested_source_type: raw_source_type,
          normalized_source_type: source_type,
          ...apifyInput,
        });
        // Adaptive multi-attempt sourcing: broaden role aliases → industry →
        // relax stage/location and retry until the requested count is met (or
        // caps / strict constraints / a tool failure stop it). Items are
        // validated, deduped across attempts, and capped at the requested count.
        const { runAdaptiveSourcing, parseStrictConstraints, resolveMaxAttempts } = await import("../_shared/sourcingRetry.ts");
        const strict = parseStrictConstraints(instruction ?? "");
        const maxAttempts = resolveMaxAttempts(instruction ?? "", strict);
        const criteria = {
          requested: max_results,
          role: roleKeywords[0] ?? null,
          industry: (tool_input_body?.industry as string) ?? null,
          location: location ?? null,
          stage: (tool_input_body?.stage as string) ?? null,
          category: (tool_input_body?.company_category as string) ?? null,
          source_type: (tool_input_body?.source_type as string) ?? source_type ?? null,
        };
        const mapItem = (it: any) => {
          // HarvestAPI people profiles nest the useful fields: name = firstName+
          // lastName, title/company live in currentPosition[0], location is an
          // object. Extract those so real profiles aren't rejected as "missing
          // name/company / wrong role".
          const cp = Array.isArray(it?.currentPosition) ? it.currentPosition[0] : (it?.currentPosition ?? null);
          const fullName = [it?.firstName, it?.lastName].filter(Boolean).join(" ").trim();
          const locObj = it?.location;
          const locStr = typeof locObj === "string" ? locObj
            : (locObj?.parsed?.text ?? locObj?.linkedinText ?? locObj?.parsed?.city ?? null);
          return {
            name: it?.name ?? it?.fullName ?? (fullName || null) ?? it?.author?.name ?? it?.actor?.name ?? null,
            title: it?.title ?? it?.jobTitle ?? it?.position ?? cp?.position ?? cp?.title ?? it?.headline ?? null,
            company: it?.company ?? it?.companyName ?? cp?.companyName ?? it?.organization ?? it?.actor?.name ?? null,
            source_url: it?.url ?? it?.link ?? it?.postUrl ?? it?.linkedinUrl ?? it?.jobUrl ?? it?.query?.post ?? null,
            location: locStr ?? it?.companyLocation ?? null,
            raw: it,
          };
        };
        const rawAllItems: ReturnType<typeof mapItem>[] = [];
        const runAttempt = async (strategy: { role_keywords: string[]; relax_location: boolean }) => {
          const attemptInput = {
            ...apifyInput,
            role_keywords: strategy.role_keywords.length > 0 ? strategy.role_keywords : apifyInput.role_keywords,
            location: strategy.relax_location ? undefined : apifyInput.location,
            max_results,
            // Don't persist per attempt — we persist ONCE below with the capped,
            // deduped accepted set so DB lead_candidates == accepted count.
            defer_persistence: true,
          };
          const rr = await runTool("source_with_apify", attemptInput, baseCtx);
          if (rr.ok && rr.data) {
            const mapped = ((rr.data as { items?: any[] }).items ?? []).map(mapItem);
            rawAllItems.push(...mapped); // accumulate for source-quality reject reasons
            return { items: mapped };
          }
          // unavailable / !ok = tool failure (auth/config/credits). 0-results is ok+data above.
          return { items: [], tool_failed: true, error: rr.error ?? "apify_failed" };
        };

        const adaptive = await runAdaptiveSourcing({ criteria, strict, maxAttempts, runAttempt });
        adaptiveAttempts = adaptive.attempts as unknown as Array<Record<string, unknown>>;

        // Source Quality Engine (Phase 6): honest raw vs accepted vs persisted
        // counts + reject reasons, surfaced in Workbench Insights + narrative.
        // Per-lead quality keyed by normalized company name, reused below to
        // persist fit_score + raw.lead_quality onto each Workbench row.
        const normName = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
        const leadQualityByName = new Map<string, { score: number; tier: string; why: string; matched_icp: string[]; missing_fields: string[]; confidence: string; reasons: string[] }>();
        try {
          const { summarizeSourceQuality, classifyResults, topRejectReasons } = await import("../_shared/sourceQuality.ts");
          const { evaluateLeadQuality, buildWhyThisLead } = await import("../_shared/leadQuality.ts");
          const classified = classifyResults(rawAllItems, criteria, strict);

          // Claude-Code-level quality scoring of the accepted set, against
          // Company Brain + the user's request. Surfaced in Workbench Insights
          // (tier mix + why-samples); never fabricates fields.
          const brainLite = brain ? {
            icp: (brain as Record<string, unknown>).icp as Record<string, unknown> | undefined,
            gtm: (brain as Record<string, unknown>).gtm as Record<string, unknown> | undefined,
            positioning: (brain as Record<string, unknown>).positioning as Record<string, unknown> | undefined,
            company: (brain as Record<string, unknown>).company as Record<string, unknown> | undefined,
          } : null;
          const qReq = {
            // For hiring/company sourcing the requested industry is encoded in
            // the query string, so fall back to it when no explicit industry field.
            role: criteria.role, industry: criteria.industry ?? (strict.industry ? null : criteria.query), location: criteria.location,
            stage: criteria.stage, category: criteria.category,
            strict_location: strict.location, strict_industry: strict.industry, strict_stage: strict.stage,
          };
          const qStrictness = (strict.location || strict.industry || strict.stage) ? "strict" as const : "flexible" as const;
          const tierCounts: Record<string, number> = { hot: 0, qualified: 0, weak: 0, rejected: 0 };
          const whySamples: string[] = [];
          let scoreSum = 0;
          for (const it of classified.accepted) {
            const r = (it.raw ?? {}) as Record<string, unknown>;
            const q = evaluateLeadQuality({
              lead: {
                name: it.name ?? it.company, company: it.company, title: it.title, location: it.location,
                website: (r.companyUrl ?? r.website ?? r.company_website ?? r.url) as string | undefined,
                industry: (r.industry ?? r.category) as string | undefined,
                team_size: (r.team_size ?? r.companySize ?? r.employees) as string | undefined,
                exact_signal: (r.exact_signal ?? r.jobTitle ?? r.positionName ?? r.title) as string | undefined,
                signal_type: source_type === "jobs" ? "hiring" : undefined,
                source_url: it.source_url,
              },
              companyBrain: brainLite,
              sourceType: criteria.source_type ?? source_type,
              userRequest: qReq,
              strictness: qStrictness,
            });
            tierCounts[q.tier] = (tierCounts[q.tier] ?? 0) + 1;
            scoreSum += q.score;
            if (whySamples.length < 3 && q.accepted) whySamples.push(`${(it.name ?? it.company ?? "Lead")}: ${buildWhyThisLead(q)}`);
            const nk = normName(it.name ?? it.company);
            if (nk) leadQualityByName.set(nk, {
              score: q.score, tier: q.tier, why: buildWhyThisLead(q),
              matched_icp: q.matched_icp_fields, missing_fields: q.missing_fields,
              confidence: q.confidence, reasons: q.reasons,
            });
          }
          const leadQualitySummary = {
            tiers: tierCounts,
            avg_score: classified.accepted.length ? Math.round(scoreSum / classified.accepted.length) : 0,
            why_samples: whySamples,
          };
          const counts = summarizeSourceQuality({
            attempts: adaptive.attempts,
            accepted_count: adaptive.found,
            requested_count: max_results,
            duplicate_count: classified.duplicates.length,
            reject_reason_counts: classified.reject_reason_counts,
          });
          sourceQualityMeta = {
            ...counts,
            top_reject_reasons: topRejectReasons(classified.reject_reason_counts),
            attempt_labels: adaptive.attempts.map((a) => a.strategy),
            needs_permission_to_broaden: !!adaptive.needs_permission_to_broaden,
            lead_quality: leadQualitySummary,
          };
          // Phase 5 — clean AI-employee activity timeline (no raw logs/provider noise).
          const plannerLabel = (sourcePlanMeta?.planner_mode === "claude") ? "Claude"
            : (sourcePlanMeta?.planner_mode === "gemini") ? "Gemini" : "deterministic rules";
          await supabase.from("activity_feed").insert([
            { workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started", title: `Scout created actor input with ${plannerLabel}`, body: String(sourcePlanMeta?.primary_query ?? ""), metadata: { step_index, task_id: task.id, source_planner: true } },
            { workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started", title: `Scout reviewed ${counts.raw_result_count} raw result${counts.raw_result_count === 1 ? "" : "s"}`, body: `Accepted ${counts.accepted_count} qualified · rejected ${counts.rejected_count}`, metadata: { step_index, task_id: task.id, source_quality: true } },
          ]);
        } catch (e) { console.warn("[run-agent] source quality summary failed:", e); }

        const toolFailed = adaptive.status === "failed" && adaptive.attempts.some((a) => !!a.note);
        if (toolFailed && isApifySelected) {
          sourcingFailure = { error: adaptive.reason || "apify_failed", message: humanizeApifyError(adaptive.reason) };
        }
        if (adaptive.accepted.length > 0) {
          const rawItems = adaptive.accepted.map((a) => a.raw);
          const attachAccounts = Array.isArray(tool_input_body?.attach_to_accounts) ? tool_input_body.attach_to_accounts : null;

          if (attachAccounts && attachAccounts.length > 0) {
            // Contact discovery: ATTACH discovered decision-makers to existing
            // account rows (no new leads, no invented contacts) instead of creating.
            try {
              const { planContactAttachments } = await import("../_shared/contactDiscovery.ts");
              const plan = planContactAttachments(rawItems, attachAccounts as Array<{ lead_candidate_id: string; company: string; signal_role?: string | null }>);
              
              const candidateIds = attachAccounts.map(a => a.lead_candidate_id).filter(Boolean);
              if (candidateIds.length > 0) {
                await supabase.from("lead_candidates").update({ plan_id }).in("id", candidateIds);
              }

              for (const att of plan) {
                const { data: c } = await supabase.from("contacts").insert({
                  workspace_id,
                  full_name: att.contact.name,
                  title: att.contact.title,
                  linkedin_url: att.contact.linkedin_url,
                  email: att.contact.email,
                  raw: { source: att.contact.source, via: "contact_discovery", confidence: att.contact.confidence },
                }).select("id").maybeSingle();
                if (c?.id) await supabase.from("lead_candidates").update({ contact_id: c.id }).eq("id", att.lead_candidate_id);
              }
              console.log("[run-agent] attached contacts:", plan.length);
            } catch (e) { console.warn("[run-agent] contact attach failed:", e); }
          } else {
            // Normal sourcing: persist ONCE with only the capped/deduped accepted
            // set, so DB lead_candidates/signals == accepted count.
            try {
              const { writeMemoryFromToolCall } = await import("../_shared/memoryWriter.ts");
              await writeMemoryFromToolCall({
                admin: supabase,
                workspace_id,
                plan_id,
                task_id: task.id,
                tool_call_id: null,
                tool_name: "source_with_apify",
                selected_actor_key: planned_actor_key ?? null,
                output: { items: rawItems, total: rawItems.length, summary: `${adaptive.found}/${adaptive.requested} accepted across ${adaptive.attempts.length} attempt(s)` },
              });
            } catch (e) { console.warn("[run-agent] capped persistence failed:", e); }

            // Phase 3 — persist per-row lead quality onto each Workbench row
            // (fit_score + raw.lead_quality), matched by company name. Uses an
            // existing jsonb column, so no migration. Never overwrites real data.
            try {
              const { data: rows } = await supabase
                .from("lead_candidates")
                .select("id, account_id, raw, fit_score")
                .eq("plan_id", plan_id);
              const acctIds = (rows ?? []).map((r) => (r as Record<string, unknown>).account_id).filter(Boolean) as string[];
              const nameById = new Map<string, string>();
              if (acctIds.length) {
                const { data: accts } = await supabase.from("accounts").select("id, name").in("id", acctIds);
                for (const a of accts ?? []) nameById.set((a as Record<string, unknown>).id as string, String((a as Record<string, unknown>).name ?? ""));
              }
              for (const row of rows ?? []) {
                const r = row as Record<string, unknown>;
                const q = leadQualityByName.get(normName(nameById.get(r.account_id as string) ?? ""));
                if (!q) continue;
                const existingRaw = (r.raw ?? {}) as Record<string, unknown>;
                await supabase.from("lead_candidates").update({
                  fit_score: typeof r.fit_score === "number" ? r.fit_score : q.score,
                  raw: {
                    ...existingRaw,
                    lead_quality: { score: q.score, confidence: q.confidence, reasons: q.reasons },
                    fit_tier: q.tier,
                    why_this_lead: q.why,
                    matched_icp: q.matched_icp,
                    missing_fields: q.missing_fields,
                  },
                }).eq("id", r.id as string);
              }
            } catch (e) { console.warn("[run-agent] per-row quality persistence failed:", e); }
          }

          const lens = source_type === "jobs" ? "\n\nNOTE: These are companies/jobs hiring for the requested role, not individual people profiles." : "";
          const log = adaptive.attempts.map((a) => `Attempt ${a.n}: ${a.strategy} — ${a.accepted_count} accepted (total ${a.total_accepted})`).join("\n");
          apifyContext = `APIFY SOURCING (${adaptive.found}/${adaptive.requested} accepted across ${adaptive.attempts.length} attempt(s)):\nATTEMPTS:\n${log}${lens}\n\nITEMS (accepted, capped):\n${JSON.stringify(rawItems, null, 2).slice(0, 8000)}`;
        } else if (!toolFailed) {
          toolNotices.push(`Sourcing ran ${adaptive.attempts.length} attempt(s) and found 0 matching results.`);
          // Actor ran fine but accepted 0 qualified leads. Mark it so we skip
          // Aria (nothing to rank) and finalize as no_results below.
          if (isApifySelected) {
            zeroAcceptedSourcing = true;
            sourcingAttemptsCount = adaptive.attempts.length;
          }
        }
      }
    }


    // 3) Optional broad research — only attempt if Perplexity is actually configured AND
    //    we're not in fast mode (fast mode skips this entirely to keep cost low).
    // Perplexity (research_web) is OPTIONAL and never required. Skip it entirely
    // for fast mode, explicit Apify steps, and ALL competitor-discovery steps —
    // competitor inference is done by Gemini (this step's own output), parsed
    // downstream. This removes the hard Perplexity dependency.
    const skipBroadResearch = execution_mode_body === "fast"
      || tool_input_body?.tool_name === "source_with_apify"
      || tool_input_body?.competitor_discovery === true
      || !!tool_input_body?.discovery_mode;
    if (!apifyContext && !scrapedContext && !skipBroadResearch) {
      const toolRes = await runTool("research_web", { query: instruction }, baseCtx);
      if (toolRes.ok && toolRes.data) {
        const d = toolRes.data as { content?: string; citations?: string[] };
        const citations = (d.citations ?? []).slice(0, 8).map((c, i) => `[${i + 1}] ${c}`).join("\n");
        toolContext = `BROAD RESEARCH:\n${d.content ?? ""}\n\nCITATIONS:\n${citations}`;
      } else if (toolRes.unavailable) {
        toolNotices.push(
          "Broad web research is not configured for this workspace. Use Apify for hiring signals or Firecrawl for specific URLs.",
        );
      } else if (!toolRes.ok) {
        toolNotices.push(`Research tool failed: ${toolRes.error ?? "unknown"}.`);
      }
    }
  }


  // Hard sourcing failure (Apify auth/config/credits) with no results → fail the
  // plan cleanly and surface an in-chat error card. Never let the LLM fabricate a
  // "complete" plan with zero leads, and never chain to Aria with nothing to rank.
  if (sourcingFailure && !apifyContext) {
    const failMsg = `Scout could not run because ${sourcingFailure.message}.`;
    await supabase.from("tasks").update({ status: "failed", error_message: sourcingFailure.error, result: { error: sourcingFailure.error, message: failMsg } }).eq("id", task.id);
    await supabase.from("task_plans").update({ status: "failed" }).eq("id", plan_id);
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started",
      title: `${agent.name} could not source leads`, body: failMsg, metadata: { step_index, task_id: task.id, failed: true, error: sourcingFailure.error },
    });
    try {
      const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
      const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (conversationId) {
        const criteria = (tool_input_body?.query as string) ?? instruction;
        const card = {
          kind: "lead_sourcing_error",
          title: "Scout could not source leads",
          message: `${sourcingFailure.message[0].toUpperCase()}${sourcingFailure.message.slice(1)}, so Scout could not run the search. No leads were saved, no credits charged, and nothing was sent.`,
          source_type: (tool_input_body?.source_type as string) ?? source_type ?? null,
          criteria, count: typeof tool_input_body?.max_results === "number" ? tool_input_body.max_results : null,
          error: sourcingFailure.error,
          retry_command: instruction,
          lead_request: (tool_input_body && typeof tool_input_body === "object") ? tool_input_body : null,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: failMsg + " You can update the Apify token and retry, or pick a different lead source.",
          agent_slug: "scout",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "scout", workflow_step: "source_leads", status: "failed" },
        });
      }
    } catch (e) { console.warn("[run-agent] sourcing-error card failed:", e); }
    return json({ success: false, task_id: task.id, status: "failed", error: sourcingFailure.error });
  }

  // Sourcing actor RAN but accepted 0 qualified leads (no tool failure). There is
  // nothing to rank, so SKIP Aria (and any downstream step): do not chain, do not
  // call the LLM, do not persist fake rows, do not emit a post-lead actions card.
  // Finalize the plan honestly as no_qualified_matches.
  if (zeroAcceptedSourcing && !apifyContext) {
    const { data: planRow } = await supabase.from("task_plans").select("steps").eq("id", plan_id).maybeSingle();
    const planSteps: any[] = Array.isArray(planRow?.steps) ? (planRow!.steps as any[]) : [];
    const nextStepSlug: string | null = planSteps[(step_index as number) + 1]?.agent_slug ?? null;
    const ariaFollows = planSteps.some((s, i) => i > (step_index as number) && s?.agent_slug === "aria");

    // Decision-maker (contact-discovery) runs get SPECIFIC honest copy — never the
    // generic "0 matching leads". Per-agent messages (Scout/Aria/Pilot) per main.
    const attachAccts = Array.isArray(tool_input_body?.attach_to_accounts) ? tool_input_body.attach_to_accounts : null;
    const isContactDiscovery = !!(attachAccts && attachAccts.length > 0);
    const acctN = attachAccts?.length ?? 0;
    // Specific reject reasons (e.g. "wrong title, weak company match, wrong location")
    // instead of a generic "0 matching leads".
    const rawReviewed = Number((sourceQualityMeta as { raw_result_count?: number } | null)?.raw_result_count ?? 0);
    const rejReasons = Array.isArray((sourceQualityMeta as { top_reject_reasons?: string[] } | null)?.top_reject_reasons)
      ? (sourceQualityMeta as { top_reject_reasons: string[] }).top_reject_reasons.map((r) => r.replace(/\s*\(\d+\)$/, "")).join(", ")
      : "";
    const reasonTail = rejReasons ? ` Main reject reasons: ${rejReasons}.` : "";
    const scoutMsg = isContactDiscovery
      ? `I searched for decision-makers at ${acctN} account${acctN === 1 ? "" : "s"} but no verified contacts matched the account names closely enough. No contacts were attached.`
      : rawReviewed > 0
        ? `I reviewed ${rawReviewed} profile${rawReviewed === 1 ? "" : "s"}; 0 matched the requested persona and location closely enough.${reasonTail}`
        : `I reviewed ${sourcingAttemptsCount} attempt(s) and accepted 0 qualified leads. None of the raw results matched closely enough.`;
    const ariaSkipMsg = "Skipped — there were no accepted leads to rank.";
    const pilotRecMsg = isContactDiscovery
      ? "Try a broader persona, draft an account-level template, or export the accounts. No contacts attached, no credits charged, nothing sent."
      : "Try broadening the role, industry, or location — or pick another lead source. No leads were saved, no credits charged, nothing sent.";

    await supabase.from("tasks").update({
      status: "complete",
      result: { output: scoutMsg, no_qualified_matches: true, attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined },
    }).eq("id", task.id);
    await supabase.from("task_plans").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", plan_id);

    if (ariaFollows && nextStepSlug === "aria") {
      await supabase.from("activity_feed").insert({
        workspace_id, plan_id, agent_id: agent.id, event_type: "handoff",
        title: "Aria skipped — no accepted leads to rank",
        body: "Scout accepted 0 qualified leads, so ranking was skipped.",
        metadata: { step_index, task_id: task.id, skipped_agent: "aria", reason: "no_accepted_leads" },
      });
    }
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "plan_complete",
      title: "Plan failed — no qualified matches",
      body: scoutMsg,
      metadata: { step_index, task_id: task.id, workflow_status: "no_qualified_matches" },
    });
    await supabase.from("activity_feed").insert({
      workspace_id, plan_id, agent_id: agent.id, event_type: "agent_started",
      title: "Pilot suggested broadening the search",
      body: "Broaden the role/industry/location, edit criteria, or change the source.",
      metadata: { step_index, task_id: task.id, suggestion: "broaden_search" },
    });

    try {
      const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
      const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (conversationId) {
        const failActions = isContactDiscovery
          ? ["broaden_search", "export_csv", "done"]
          : ["broaden_search", "edit_criteria", "change_source", "view_details", "done"];
        // Scout: honest sourcing result
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: scoutMsg, agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: "no_qualified_matches", attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined },
        });
        // Aria: skipped (only when ranking was actually in the plan)
        if (ariaFollows) {
          await supabase.from("messages").insert({
            conversation_id: conversationId, role: "assistant",
            content: ariaSkipMsg, agent_slug: "aria",
            metadata: { plan_id, agent_id: "aria", workflow_step: "rank", status: "skipped", reason: "no_accepted_leads" },
          });
        }
        // Pilot: coordinator recommendation + UI card actions
        const card = {
          kind: "lead_sourcing_error",
          title: isContactDiscovery ? "No decision-makers found" : "No qualified matches found",
          message: pilotRecMsg,
          error: isContactDiscovery ? "no_decision_makers" : "no_qualified_matches",
          retry_command: instruction,
          next_actions: failActions,
          source_brief: instruction,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: pilotRecMsg, agent_slug: "pilot",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "pilot", workflow_status: "no_qualified_matches", aria_skipped: ariaFollows, next_actions: failActions, source_brief: instruction },
        });
      }
    } catch (e) { console.warn("[run-agent] no-qualified-matches card failed:", e); }
    return json({ success: false, task_id: task.id, status: "no_qualified_matches", aria_skipped: ariaFollows });
  }

  const contextParts: string[] = [];
  if (scrapedContext) contextParts.push(scrapedContext);
  if (apifyContext) contextParts.push(apifyContext);
  if (toolContext) contextParts.push(toolContext);
  const toolNotice = toolNotices.length > 0 ? toolNotices.join(" ") : null;

  const userMessage = contextParts.length > 0
    ? `${buildUserMessage(instruction, input)}\n\n${contextParts.join("\n\n")}${toolNotice ? `\n\nNOTE TO AGENT: ${toolNotice} Do NOT fabricate data beyond what is provided.` : ""}`
    : toolNotice
      ? `${buildUserMessage(instruction, input)}\n\nNOTE TO AGENT: ${toolNotice} Do NOT fabricate live data. Acknowledge the limitation, then produce the best plan/analysis you can from available context.`
      : buildUserMessage(instruction, input);

  // Writing agents (Scribe content/comments, Penn outreach/DM copy) prefer
  // Claude/Anthropic for higher-quality writing when ANTHROPIC_API_KEY is set.
  // aiProvider falls back to Gemini/Lovable automatically when the key is absent
  // — planner/controller agents (pilot/scout/hawk/aria) stay on Gemini.
  const preferredProvider = preferredProviderForAgent(agent_slug);
  if (preferredProvider === "anthropic" && !Deno.env.get("ANTHROPIC_API_KEY")) {
    console.log("[run-agent] anthropic preferred for", agent_slug, "but ANTHROPIC_API_KEY missing — falling back to default provider");
  }

  const ai = await generateText({
    taskType: "agent_execution",
    systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    temperature: 0.6,
    maxTokens: 2048,
    preferredProvider,
    functionName: "run-agent",
    agentSlug: agent_slug ?? undefined,
    workspaceId: workspace_id,
  });

  await logProviderCall(supabase, {
    workspace_id,
    plan_id,
    agent_id: agent.id,
    function_name: "run-agent",
    agent_slug: agent_slug ?? null,
    task_type: "agent_execution",
    provider: ai.provider,
    model: ai.model,
    success: ai.ok,
    latency_ms: ai.latencyMs,
    error_code: ai.errorCode,
    prompt_version: AGENTORY_SYSTEM_PROMPT_VERSION,
  });

  let apiText = ai.ok ? ai.content : "";
  const usage = (ai.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  const tokensIn = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const tokensOut = usage.completion_tokens ?? usage.output_tokens ?? 0;
  let apiError: string | null = null;
  if (!ai.ok) apiError = ai.error ?? "ai provider failed";
  else if (!apiText) apiError = "empty content from AI provider";


  if (apiError) {
    console.error("[run-agent] api failure:", apiError);
    await supabase.from("tasks").update({
      status: "failed",
      error_message: apiError,
      result: { error: apiError },
    }).eq("id", task.id);
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "agent_started",
      title: `${agent.name} failed`,
      body: apiError,
      metadata: { step_index, task_id: task.id, failed: true },
    });
    await supabase.from("task_plans").update({ status: "failed" }).eq("id", plan_id);
    return json({ error: "step_failed", details: apiError, task_id: task.id }, 500);
  }

  const finalStatus = needs_approval ? "awaiting_approval" : "complete";
  await supabase.from("tasks").update({
    status: finalStatus,
    result: { output: apiText, tokens_in: tokensIn, tokens_out: tokensOut, attempt_log: adaptiveAttempts.length ? adaptiveAttempts : undefined, source_plan: sourcePlanMeta ?? undefined, source_quality: sourceQualityMeta ?? undefined },
  }).eq("id", task.id);

  // Phase 2: persist agent outputs into structured GTM memory. Fire-and-forget.
  if (agent_slug === "aria" || agent_slug === "penn" || agent_slug === "scribe") {
    try {
      const { writeMemoryFromAgentResult } = await import("../_shared/memoryWriter.ts");
      await writeMemoryFromAgentResult({
        admin: supabase,
        workspace_id,
        plan_id,
        task_id: task.id,
        agent_slug,
        output_text: apiText,
        // Memory-driven draft_outreach carries the target lead ids so Penn
        // drafts link to the remembered leads (which live in a prior plan).
        lead_candidate_ids: Array.isArray(tool_input_body?.lead_candidate_ids)
          ? tool_input_body.lead_candidate_ids
          : undefined,
        // Phase 7 — content-loop metadata so Scribe drafts are tagged with
        // subtype/topic/audience/angle/engagement_queries in saved_outputs.raw.
        content_loop: (tool_input_body?.content_loop && typeof tool_input_body.content_loop === "object")
          ? tool_input_body.content_loop
          : undefined,
      });
    } catch (e) {
      console.warn("[run-agent] memoryWriter failed:", e);
    }
  }

  // Load plan steps to find next.
  const { data: plan } = await supabase
    .from("task_plans")
    .select("steps, plan_summary")
    .eq("id", plan_id)
    .maybeSingle();
  const steps: any[] = Array.isArray(plan?.steps) ? (plan!.steps as any[]) : [];
  const nextStep = steps[(step_index as number) + 1] ?? null;

  if (needs_approval) {
    await supabase.from("approvals").insert({
      workspace_id,
      plan_id,
      task_id: task.id,
      agent_id: agent.id,
      title: `${agent.name} needs approval`,
      description: instruction,
      status: "pending",
    });
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "awaiting_approval",
      title: `${agent.name} awaiting approval`,
      body: `${agent.name}'s output needs your review before continuing.`,
      metadata: { step_index, task_id: task.id },
    });
    await supabase.from("task_plans").update({ status: "awaiting_approval" }).eq("id", plan_id);
    return json({ success: true, task_id: task.id, status: "awaiting_approval" });
  }

  // Phase 4.2 — inference→search threading. When Hawk (competitor discovery)
  // hands off to Scout's LinkedIn search, parse Hawk's inferred competitors from
  // its output and inject them into Scout's tool_input (queries + discovery
  // context for memory tagging). Inferred competitors are hypotheses, not facts.
  let nextToolInput: any = nextStep?.metadata?.tool_input ?? tool_input_body ?? null;
  if (
    nextStep && agent_slug === "hawk" && nextStep.agent_slug === "scout" &&
    (nextToolInput?.source_type === "linkedin_engagement") &&
    (nextToolInput?.competitor_discovery || tool_input_body?.competitor_discovery || tool_input_body?.discovery_mode)
  ) {
    try {
      const { parseInferredCompetitors, buildCompetitorSearchQueries } = await import("../_shared/competitorDiscovery.ts");
      const inferred = parseInferredCompetitors(apiText ?? "");
      // Source order: known competitors (user-provided / company-brain, carried on
      // tool_input.competitors) take precedence, then Gemini-inferred hypotheses.
      const knownNames: string[] = Array.isArray(tool_input_body?.competitors)
        ? tool_input_body.competitors
        : (Array.isArray((nextToolInput as any)?.competitors) ? (nextToolInput as any).competitors : []);
      const knownHyps = knownNames.filter(Boolean).map((n: string) => ({
        name: n, category: "other", reason: "known competitor (brain/user-provided)",
        confidence: 0.9, source: "seed" as const, keywords: [],
      }));
      const allHyps = [...knownHyps, ...inferred.competitors];
      // buildCompetitorSearchQueries sanitizes the topic, so a raw business
      // description can never become a LinkedIn query; empty → category fallback.
      const queries = buildCompetitorSearchQueries(allHyps, nextToolInput?.query ?? instruction);
      if (queries.length > 0) {
        nextToolInput = {
          ...nextToolInput,
          query: queries.join(", "),
          competitor_discovery: true,
          user_input: {
            ...(nextToolInput?.user_input ?? {}),
            keywords: queries,
            competitor_discovery: true,
            inferred_competitors: inferred.competitors.map((c: any) => c.name).filter(Boolean),
            competitor_category: inferred.category,
            matched_query: queries.join(", "),
            original_business_description: tool_input_body?.business_description ?? nextToolInput?.business_description ?? null,
            original_website_url: tool_input_body?.business_website ?? nextToolInput?.business_website ?? null,
            hypothesis_reason: inferred.competitors[0]?.reason ?? "inferred from business context",
          },
        };
      }
    } catch (e) {
      console.warn("[run-agent] inferred-competitor threading failed:", e);
    }
  }

  if (nextStep) {
    await supabase.from("handoffs").insert({
      workspace_id,
      plan_id,
      task_id: task.id,
      from_agent_slug: agent_slug ?? null,
      to_agent_slug: nextStep.agent_slug ?? null,
      payload: { instruction: nextStep.instruction, input: apiText },
    });
    await supabase.from("activity_feed").insert({
      workspace_id,
      plan_id,
      agent_id: agent.id,
      event_type: "handoff",
      title: `${agent.name} finished`,
      body: `${agent.name} finished. Handing to ${nextStep.agent_name ?? nextStep.agent_slug}.`,
      metadata: { step_index, task_id: task.id, next_agent_slug: nextStep.agent_slug },
    });

    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        plan_id,
        step_index: (step_index as number) + 1,
        agent_slug: nextStep.agent_slug,
        workspace_id,
        user_id,
        instruction: nextStep.instruction,
        input: apiText,
        needs_approval: nextStep.needs_approval === true,
        // Per-step tool_input (set on the step's metadata) wins, so a plan can
        // mix tools across steps (e.g. Hawk scrape → Scout apify). Steps without
        // their own metadata inherit the current step's tool_input as before.
        // For competitor discovery, nextToolInput carries Hawk's inferred queries.
        tool_input: nextToolInput,
        execution_mode: execution_mode_body,
      }),
    }).catch((e) => console.error("[run-agent] chain fetch failed:", e));

    return json({
      success: true,
      task_id: task.id,
      status: "complete",
      next_agent: nextStep.agent_name ?? nextStep.agent_slug,
    });
  }

  // Final step. Adaptive status — never blindly "complete". For a sourcing plan, derive
  // complete / partial / failed from produced-vs-requested; emit the right card.
  let planStatus = "complete";
  try {
    const { data: srcCalls } = await supabase.from("tool_calls").select("id").eq("plan_id", plan_id).eq("tool_name", "source_with_apify").limit(1);
    const wasSourcing = (srcCalls ?? []).length > 0;

    const { data: leads } = await supabase.from("lead_candidates").select("id, contact_id, account:accounts(name, domain, linkedin_url), contact:contacts(full_name, title, linkedin_url, email)").eq("plan_id", plan_id);
    const leadRows = (leads ?? []) as Array<{ id: string; contact_id?: string | null; account?: { name?: string | null; domain?: string | null; linkedin_url?: string | null } | null; contact?: { full_name?: string | null; title?: string | null; linkedin_url?: string | null; email?: string | null } | null }>;
    const { count: sigCount } = await supabase.from("signals").select("id", { count: "exact", head: true }).eq("plan_id", plan_id);
    const produced = Math.max(leadRows.length, sigCount ?? 0);

    const steps: any[] = Array.isArray(plan?.steps) ? (plan!.steps as any[]) : [];
    const reqStep = steps.find((s) => typeof s?.metadata?.tool_input?.max_results === "number");
    const requested = reqStep?.metadata?.tool_input?.max_results ?? produced;

    const { data: planMsg } = await supabase.from("messages").select("conversation_id").filter("metadata->>plan_id", "eq", plan_id).limit(1).maybeSingle();
    const conversationId = (planMsg as { conversation_id?: string } | null)?.conversation_id ?? null;

    // Pull the adaptive attempt log recorded by the Scout step (separate invocation).
    const { data: scoutTask } = await supabase.from("tasks").select("result").eq("plan_id", plan_id).eq("agent_slug", "scout").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const scoutResult = (scoutTask as { result?: Record<string, unknown> } | null)?.result ?? {};
    const attemptLog = (scoutResult.attempt_log as unknown) ?? [];
    const attemptSummary = Array.isArray(attemptLog)
      ? (attemptLog as Array<Record<string, unknown>>).map((a) => `Attempt ${a.n}: ${a.strategy} — ${a.accepted_count} accepted (total ${a.total_accepted})`)
      : [];
    // AI Source Planner artifacts (Phase 8 Workbench Insights).
    const sourcePlan = (scoutResult.source_plan as Record<string, unknown> | undefined) ?? null;
    const sourceQuality = (scoutResult.source_quality as Record<string, unknown> | undefined) ?? null;
    const searchInsights = (sourcePlan || sourceQuality) ? {
      source: sourcePlan?.actor_key ?? null,
      planner: sourcePlan?.source ?? null, // ai | ai_repaired | deterministic
      primary_query: sourcePlan?.primary_query ?? null,
      role_aliases: sourcePlan?.role_aliases ?? [],
      attempts: attemptSummary,
      raw_reviewed: sourceQuality?.raw_result_count ?? null,
      accepted: sourceQuality?.accepted_count ?? null,
      rejected: sourceQuality?.rejected_count ?? null,
      duplicates: sourceQuality?.duplicate_count ?? null,
      main_reject_reasons: sourceQuality?.top_reject_reasons ?? [],
    } : null;

    if (wasSourcing) {
      const { evaluateWorkflowStatus } = await import("../_shared/adaptiveWorkflow.ts");
      const ev = evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested, produced });
      planStatus = ev.status; // complete | partial | failed

      if (produced === 0 && conversationId) {
        // Actor ran but found nothing — honest "no results", never "complete".
        // Scout speaks the operational result, then Pilot wraps with the recommendation card.
        const failBrief = (reqStep?.instruction as string) ?? undefined;
        const failActions = ["broaden_search", "edit_criteria", "change_source", "view_details", "done"];
        const reviewedCount = sourceQuality?.raw_result_count ?? "the";
        const scoutLine = `I reviewed ${reviewedCount} raw result${sourceQuality?.raw_result_count === 1 ? "" : "s"}, but none matched closely enough. I didn't save any leads.`;
        const pilotLine = "Try broadening your criteria or changing the source. No credits charged, nothing sent.";
        const card = {
          kind: "lead_sourcing_error",
          title: "No qualified matches",
          message: `${scoutLine} ${pilotLine}`,
          error: "no_qualified_matches",
          retry_command: failBrief,
          next_actions: failActions,
          source_brief: failBrief,
        };
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: scoutLine,
          agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: "no_qualified_matches" },
        });
        await supabase.from("messages").insert({
          conversation_id: conversationId, role: "assistant",
          content: pilotLine,
          agent_slug: "pilot",
          metadata: { ui_card: card, lead_sourcing_error: true, plan_id, agent_id: "pilot", workflow_status: "failed", next_actions: failActions, source_brief: failBrief },
        });
      } else if (leadRows.length > 0 && conversationId) {
        const lo = await import("../_shared/leadOpportunity.ts");
        const planSummary = String(plan?.plan_summary ?? "").toLowerCase();
        const sourceType: string = planSummary.includes("hiring") ? "hiring_signal"
          : planSummary.includes("linkedin") ? "linkedin_engagement"
          : planSummary.includes("people") || planSummary.includes("profile") ? "people_profiles"
          : planSummary.includes("competitor") ? "competitor_engagement"
          : "company_search";
        // Account vs contact split — contact-ready only with real person data.
        const contactRows = leadRows.filter((l) => !!l.contact_id && lo.canDraftOutreach({ name: l.contact?.full_name, linkedin_url: l.contact?.linkedin_url, email: l.contact?.email }));
        const contacts = contactRows.length;
        const accounts = leadRows.length;
        const canDraft = contacts > 0;
        const allAccountOnly = contacts === 0;
        // Domain discovery before enrichment (fixes "0 websites").
        const domainGuesses = leadRows.map((l) => lo.guessDomain({ website: null, linkedin_url: l.account?.linkedin_url, source_url: null, company: l.account?.name }));
        const realDomains = leadRows.filter((l) => !!l.account?.domain).length;
        const enrichable = Math.max(realDomains, domainGuesses.filter((g) => g.confidence !== "unavailable").length);
        const persona = lo.inferContactPersona((reqStep?.instruction as string) ?? planSummary);
        const nextAction = lo.recommendNextAction({ accounts, contacts, enriched_contacts: 0, requested });
        const recommended_next_action = { action: nextAction.action, label: nextAction.label, reason: nextAction.reason, estimated_credits: allAccountOnly ? leadRows.length : (canDraft ? contacts * 2 : enrichable) };
        const header = lo.buildLeadResultsHeader({ accounts, contacts });
        const { buildPostLeadActionsCard } = await import("../_shared/creditEstimate.ts");
        const card = buildPostLeadActionsCard(leadRows.length, enrichable, leadRows.map((l) => l.id));
        const partial = planStatus === "partial";
        const actions = canDraft
          ? ["enrich", "draft_outreach", "enrich_and_draft", "rank", "export_csv", "save_to_signal_feed"]
          : ["find_contacts", "research_company", "rank", "export_csv", "save_to_signal_feed"];
        // AI-employee outcome report (humanized result + next-action pills).
        const { buildOutcomeReport } = await import("../_shared/sourceQuality.ts");
        const sourceBrief = (reqStep?.instruction as string) ?? planSummary;
        const qCounts = (sourceQuality && typeof sourceQuality === "object")
          ? sourceQuality as unknown as { raw_result_count: number; accepted_count: number; rejected_count: number; duplicate_count: number; persisted_count: number; requested_count: number; reject_reason_counts: Record<string, number>; status: "complete" | "partial" | "failed" }
          : { raw_result_count: produced, accepted_count: produced, rejected_count: 0, duplicate_count: 0, persisted_count: produced, requested_count: requested, reject_reason_counts: {}, status: planStatus as "complete" | "partial" | "failed" };
        const outcome = buildOutcomeReport({ counts: qCounts, requested, has_contacts: canDraft });
        const uiPanel = {
          kind: "lead_results" as const,
          view: "spreadsheet" as const,
          title: header,
          subtitle: lo.LEAD_RESULTS_SUBTITLE,
          source_type: sourceType,
          lead_count: leadRows.length,
          account_count: accounts,
          contact_count: contacts,
          enrichable_count: enrichable,
          can_draft: canDraft,
          recommended_persona: persona,
          contact_status: canDraft ? "contact_found" : "needs_contact",
          next_action: nextAction,
          lead_candidate_ids: leadRows.map((l) => l.id),
          plan_id,
          default_view: "table",
          actions,
          locked_columns: ["decision_maker", "contact_info", "company_enrichment", "personalized_message"],
          available_actions: actions,
          recommended_next_action,
          // Phase 8 — Workbench Insights: summarized search strategy (never raw JSON / dataset IDs).
          insights: searchInsights,
          // Humanized outcome + next-action pills.
          outcome: { status: outcome.status, line: outcome.outcome_line, quality_lines: outcome.quality_lines },
          next_actions: outcome.next_actions,
          source_brief: sourceBrief,
        };

        // Phase 7 — split the post-lead summary into per-agent messages so the
        // chat reads like a Slack-style team: Scout reports sourcing, Aria reports
        // ranking (only if it actually ran), and Pilot wraps with the workbench
        // open + recommended next action card.
        const ariaInPlan = Array.isArray(plan?.steps)
          ? (plan!.steps as any[]).some((s) => s?.agent_slug === "aria")
          : false;
        const reviewedSummary = searchInsights?.raw_reviewed != null
          ? `I reviewed ${searchInsights.raw_reviewed} raw result${searchInsights.raw_reviewed === 1 ? "" : "s"} and accepted ${produced} qualified ${allAccountOnly ? "account opportunit" + (produced === 1 ? "y" : "ies") : "lead" + (produced === 1 ? "" : "s")}.`
          : `I accepted ${produced} qualified ${allAccountOnly ? "account opportunit" + (produced === 1 ? "y" : "ies") : "lead" + (produced === 1 ? "" : "s")}.`;
        const partialPrefix = partial ? `Found ${produced} of ${requested}. ` : "";

        // 1. Scout speaks the sourcing outcome
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: `${partialPrefix}${reviewedSummary}`,
          agent_slug: "scout",
          metadata: { plan_id, agent_id: "scout", workflow_step: "source_leads", status: planStatus, attempt_log: attemptSummary.length ? attemptSummary : [`Sourced ${produced}/${requested}`] },
        });

        // 2. Aria speaks ranking (if it was in the plan)
        if (ariaInPlan) {
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: "I ranked the accepted opportunities against your Company Brain.",
            agent_slug: "aria",
            metadata: { plan_id, agent_id: "aria", workflow_step: "rank", status: "complete" },
          });
        }

        // 3. Pilot wraps with workbench-open + next action card. The ui_panel
        // stays on this Pilot message so the existing auto-open hook still fires.
        const partialTail = partial ? ` Want me to broaden the search to fill the last ${Math.max(1, requested - produced)}?` : "";
        const pilotWrap = allAccountOnly
          ? `I opened the results in Workbench. Contact/enrichment/outreach columns are locked until you run those actions. Recommended next step: find decision-makers.${partialTail} Nothing was sent.`
          : `I opened the results in Workbench. Recommended next step: ${ariaInPlan ? "review the ranked list" : "rank by fit"}, then research or draft outreach.${partialTail} Nothing was sent.`;
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: pilotWrap,
          agent_slug: "pilot",
          metadata: { ui_card: card, ui_panel: uiPanel, post_lead_actions: true, plan_id, agent_id: "pilot", workflow_status: planStatus, can_draft: canDraft, next_action: nextAction.action, next_actions: outcome.next_actions, source_brief: sourceBrief },
        });
      }
    }
  } catch (e) {
    console.warn("[run-agent] adaptive status/card failed:", e);
  }

  await supabase.from("activity_feed").insert({
    workspace_id, plan_id, agent_id: agent.id, event_type: "plan_complete",
    title: planStatus === "complete" ? "Plan complete" : `Plan ${planStatus}`,
    body: `${plan?.plan_summary ?? "Plan"} — ${planStatus}.`,
    metadata: { step_index, task_id: task.id, workflow_status: planStatus },
  });
  await supabase.from("task_plans").update({ status: planStatus, completed_at: new Date().toISOString() }).eq("id", plan_id);

  return json({ success: planStatus !== "failed", task_id: task.id, status: planStatus });
});
