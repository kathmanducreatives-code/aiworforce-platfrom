// ASK SCRIBE TO WRITE THE DRAFT.
//
// ── WHAT WAS MISSING, AND WHAT WAS NOT ──────────────────────────────────────
//
// The generation path already existed end to end:
//
//     run-agent  creates a task when none is supplied, executes the agent,
//                then calls writeMemoryFromAgentResult
//     memoryWriter  dispatches `scribe` to writeScribeContent
//     writeScribeContent  cleans the output and persists the draft
//
// `cleanScribeOutput` is careful code — it strips ```json fences, parses
// structured output and falls back safely — written for a path that had never
// run. NOTHING HAD EVER CREATED A SCRIBE TASK: production shows 106 `scout`
// tasks, 1 `aria`, and zero `scribe`. The gap was this call.
//
// ── WHY NOT `orchestrate` ───────────────────────────────────────────────────
//
// `contentEngagementLoop` — the only module that builds content plans — sits
// behind `orchestrate`, which is reached only from `submitInstruction`
// (CommandPalette and DepartmentRoom, and `/departments` is a redirect). But
// `orchestrate` PLANS: it decides which agent and which tool a sentence needs,
// so "write this draft" would be a proposal, not a guarantee. Content already
// knows the agent, the format and the draft being filled in, so it asks
// directly and the result is deterministic.
//
// ── WHY THE DRAFT EXISTS BEFORE THIS RUNS ───────────────────────────────────
//
// The `content_item` is created first and its id passed down. If the model
// fails, times out, or returns nothing, the user still has the draft they made
// and can retry — instead of a toast and no trace, which is what Content did
// for its whole life.

import { supabase } from '@/integrations/supabase/client';
import { functionErrorDetail } from '@/lib/content/functionError';
import type { ContentFormat } from '@/lib/content/contentItems';

export interface GenerateContentDraftArgs {
  /** The draft being filled in. Created before this is called. */
  contentItemId: string;
  workspaceId: string;
  /** What to write. Plain instruction text, as the agent receives it. */
  instruction: string;
  format: ContentFormat;
  topic?: string | null;
  /** Signals the draft is grounded in, when it came from the feed. */
  relatedSignalIds?: string[];
  /**
   * A REGENERATION of an existing draft, not a first write.
   *
   * The only difference the database can see is the provenance recorded on the
   * new version — and that is exactly what the history view shows, so the
   * caller states it rather than the writer inferring it from whether a body
   * already existed.
   */
  regenerate?: boolean;
  /**
   * A typed REVISION REQUEST — "make it more concise", "improve the hook" — from
   * the Scribe panel. Recorded on the new version's provenance so history can
   * say what was asked, not just that Scribe rewrote it.
   */
  revision?: string | null;
  /**
   * "Change format": the one format Scribe must produce. Null ⇒ Scribe chooses.
   * The writer refuses a plan that ignores it.
   */
  contentFormat?: string | null;
  /** "Use Company Brain". False ⇒ run-agent gives Scribe only who is writing. */
  useCompanyBrain?: boolean;
}

export interface GenerateContentDraftResult {
  ok: boolean;
  /** Machine-readable. Never prose to branch on. */
  error?: string;
}

/**
 * Run Scribe against a draft and let the server persist the result.
 *
 * DELIBERATELY RETURNS NO CONTENT. `writeScribeContent` writes the generated
 * text into `content_item` inside the same request, so the caller re-reads the
 * row rather than trusting a response body. One writer, one source of truth —
 * a client that also wrote the body could disagree with the row.
 */
export async function generateContentDraft(
  args: GenerateContentDraftArgs,
): Promise<GenerateContentDraftResult> {
  // ── A ONE-STEP PLAN, BECAUSE run-agent'S CONTRACT REQUIRES ONE ───────────
  //
  // run-agent has two entry modes. The DIRECT mode legitimately carries no
  // plan_id or step_index, but it is lead-specific (`isDirectLeadActionAttempt`)
  // and now a tombstone — workbench lead actions answer 410 and point at
  // `run-lead-action`. Everything else goes through the orchestrated gate,
  // which requires plan_id, step_index, agent_slug, workspace_id and
  // instruction, and returns `missing_required_fields` without them.
  //
  // So the plan is created here rather than faked. This is not fabricated
  // orchestration metadata: a content generation genuinely IS one step, run by
  // a known agent, against a known draft. Writing it down also means the run
  // shows up wherever plans are listed, instead of being an invisible task.
  const { data: plan, error: planError } = await supabase
    .from('task_plans')
    .insert({
      workspace_id: args.workspaceId,
      user_instruction: args.instruction,
      goal: args.instruction,
      plan_summary: `1 capability: ${args.format.replace(/_/g, ' ')} draft by scribe`,
      status: 'executing',
      current_step: 0,
      steps: [{
        step_index: 0,
        agent_slug: 'scribe',
        description: `Draft a ${args.format.replace(/_/g, ' ')}`,
        metadata: { content_item_id: args.contentItemId },
      }],
    })
    .select('id')
    .single();
  if (planError || !plan) {
    return { ok: false, error: planError?.message ?? 'plan_create_failed' };
  }

  const { data, error } = await supabase.functions.invoke('run-agent', {
    body: {
      plan_id: (plan as { id: string }).id,
      step_index: 0,
      workspace_id: args.workspaceId,
      // The decision recorded in CONTENT P1-2: scribe owns content. `penn` is
      // the outreach writer and persists to `outreach_drafts`, so addressing it
      // here would put content in the outreach object model.
      agent_slug: 'scribe',
      instruction: args.instruction,
      // `content_loop` is the shape writeScribeContent already reads; the only
      // new key is `content_item_id`, which tells it which draft to fill.
      tool_input: {
        content_loop: {
          source: 'content_surface',
          subtype: args.format,
          topic: args.topic ?? null,
          content_item_id: args.contentItemId,
          regenerate: args.regenerate === true,
          related_signal_ids: args.relatedSignalIds ?? [],
          revision: args.revision ?? null,
          content_format: args.contentFormat ?? null,
          use_company_brain: args.useCompanyBrain !== false,
        },
      },
    },
  });

  // The function's own reason, not supabase-js's "non-2xx" — see functionError.
  if (error) return { ok: false, error: (await functionErrorDetail(error)) ?? error.message ?? 'generation_failed' };

  const res = data as { success?: boolean; error?: string; message?: string } | null;
  // run-agent answers 200 with `success: false` for refusals — an unidentified
  // user, a spend ceiling, a provider failure. Treating a 200 as success is how
  // a refusal reads as a finished draft that never arrives.
  if (!res) return { ok: false, error: 'generation_failed' };
  if (res.success === false || res.error) {
    return { ok: false, error: res.error ?? res.message ?? 'generation_failed' };
  }
  return { ok: true };
}
