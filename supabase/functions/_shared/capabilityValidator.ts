// capabilityValidator: enforce platform capability constraints on a
// WorkflowDecision produced by workflowClassifier.
//
// Returns either {ok: true, decision} or {ok: false, decision, clarification, reason}.
// Mutates decision when needed (clamping, stripping unsafe actors, forcing approval).

import {
  ACTOR_REGISTRY,
  getActorByKey,
  isActorRuntimeEnabled,
} from "./actorRegistry.ts";
import type { WorkflowDecision } from "./workflowClassifier.ts";

export interface ValidationResult {
  ok: boolean;
  decision: WorkflowDecision;
  clarification?: string;
  reason?: string;
  notes?: string[];
}

function envStr(name: string): string | null {
  try {
    // @ts-ignore Deno runtime
    if (typeof Deno !== "undefined") {
      const v = Deno.env.get(name);
      return v && v.trim() ? v.trim() : null;
    }
  } catch { /* ignore */ }
  return null;
}

function envFlag(name: string): boolean {
  const v = envStr(name);
  if (!v) return false;
  return ["1", "true", "yes", "on", "enabled"].includes(v.toLowerCase());
}

function isSearchWebEnabled(): boolean {
  // Lovable AI grounded-search / Gemini search tool — gated by an explicit env flag.
  // Default = disabled. We surface an honest message when off.
  return envFlag("ENABLE_SEARCH_WEB") || !!envStr("SEARCH_WEB_API_KEY");
}

export function validateAgainstCapabilities(decision: WorkflowDecision): ValidationResult {
  const notes: string[] = [];
  const d = { ...decision };

  // 1. Unsafe: always strip and return ok (handler will produce safe reply).
  if (d.workflow_category === "unsafe_or_unsupported") {
    d.selected_actor_key = null;
    d.selected_tool = null;
    d.source_type = null;
    d.agents = [];
    d.execution_mode = "none";
    return { ok: true, decision: d, notes: ["unsafe — stripped any tool/actor selection"] };
  }

  // 2. If an actor was chosen, it must exist and be runtime-enabled.
  if (d.selected_actor_key) {
    const actor = getActorByKey(d.selected_actor_key);
    if (!actor) {
      return {
        ok: false,
        decision: { ...d, selected_actor_key: null, selected_tool: null, source_type: null },
        clarification: `The selected source "${d.selected_actor_key}" isn't registered. I can use Apify Jobs or Firecrawl instead — which would you like?`,
        reason: "unknown_actor_key",
      };
    }
    if (!isActorRuntimeEnabled(actor)) {
      // People search special-case: offer companies-hiring fallback.
      if (d.workflow_category === "people_sourcing") {
        return {
          ok: false,
          decision: { ...d, selected_actor_key: null, selected_tool: null, source_type: null },
          clarification:
            actor.missing_message ??
            "Individual people/profile sourcing isn't configured yet. I can find companies hiring those roles instead — reply \"companies\" to proceed.",
          reason: "people_actor_disabled",
        };
      }
      return {
        ok: false,
        decision: { ...d, selected_actor_key: null, selected_tool: null, source_type: null },
        clarification: actor.missing_message ?? `The actor "${actor.label}" isn't configured in this environment.`,
        reason: "actor_disabled",
      };
    }

    // 3. Clamp max_results to actor's cap.
    const cap = actor.max_safe_results ?? actor.max_safe_pages ?? 100;
    if (d.max_results > cap) {
      notes.push(`clamped max_results ${d.max_results} → ${cap}`);
      d.max_results = cap;
    }
  }

  // 4. url_analysis requires Firecrawl key.
  if (d.workflow_category === "url_analysis") {
    if (!envStr("FIRECRAWL_API_KEY")) {
      return {
        ok: false,
        decision: { ...d, selected_actor_key: null, selected_tool: null },
        clarification: "URL analysis needs Firecrawl, which isn't configured. Add FIRECRAWL_API_KEY to enable it.",
        reason: "firecrawl_unavailable",
      };
    }
    // Force tool/actor selection.
    d.selected_actor_key = d.selected_actor_key ?? "firecrawl_scrape_url";
    d.selected_tool = d.selected_tool ?? "scrape_url";
    d.agents = d.agents.length > 0 ? d.agents : ["hawk", "scribe"];
  }

  // 5. market_research requires search_web; otherwise degrade to honest reply.
  if (d.workflow_category === "market_research") {
    if (!isSearchWebEnabled()) {
      notes.push("search_web unavailable — degrading to honest reply");
      d.selected_actor_key = null;
      d.selected_tool = null;
      d.agents = [];
      d.execution_mode = "none";
      d.reason = (d.reason ? d.reason + " | " : "") + "search_web not configured";
      return {
        ok: true,
        decision: d,
        notes,
      };
    }
  }

  // 6. content_creation: Scribe-only, no tools required.
  if (d.workflow_category === "content_creation") {
    d.agents = d.agents.length > 0 ? d.agents : ["scribe"];
    d.execution_mode = "content";
    d.selected_actor_key = null;
    d.selected_tool = null;
    d.source_type = null;
  }

  // 7. outreach: always requires approval.
  if (d.workflow_category === "outreach" || d.needs_outreach) {
    d.requires_approval = true;
  }

  // 8. people_sourcing requires opt-in env flag (defense in depth — also caught at #2).
  if (d.workflow_category === "people_sourcing") {
    const actor = getActorByKey("apify_people_search");
    if (!actor || !isActorRuntimeEnabled(actor)) {
      return {
        ok: false,
        decision: { ...d, selected_actor_key: null, selected_tool: null, source_type: null },
        clarification:
          actor?.missing_message ??
          "Individual people/profile sourcing isn't configured yet. I can find companies hiring those roles instead.",
        reason: "people_actor_disabled",
      };
    }
  }

  return { ok: true, decision: d, notes };
}
