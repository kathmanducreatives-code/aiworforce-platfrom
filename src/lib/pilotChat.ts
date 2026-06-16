// Frontend wrapper for the pilot-chat edge function.
// Replaces the legacy src/lib/chatRespond.ts wrapper.
//
// Pilot decides whether to reply directly or delegate to the workforce
// (which runs orchestrate -> run-agent under the hood). The synthetic
// assistant message Pilot persists for a delegation arrives via the
// realtime subscription in useChatConversation just like any other turn,
// so callers usually only need result.conversation_id.

import { supabase } from '@/integrations/supabase/client';

export interface PilotChatInput {
  message: string;
  workspace_id: string;
  conversation_id?: string | null;
  /** Source of an in-chat card action (e.g. 'post_lead_actions_card'). Backend rejects card actions without conversation_id. */
  action_source?: string;
  /** Structured metadata that travels with the action (lead_request, post_lead_action, etc.). */
  metadata?: Record<string, unknown>;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  agent_slug: string | null;
  model_used: string | null;
  tokens_used: number | null;
  is_error: boolean;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export type PilotChatResult =
  | {
      type: 'reply';
      conversation_id: string;
      message: ChatMessageRow;
    }
  | {
      type: 'plan';
      conversation_id: string;
      message: ChatMessageRow;
      plan_id: string;
      plan_title?: string;
      plan_summary: string;
      steps_count: number;
      agents?: string[];
      connector_limitations?: string[];
    };

export async function pilotChat(input: PilotChatInput): Promise<PilotChatResult> {
  const { data, error } = await supabase.functions.invoke('pilot-chat', { body: input });
  if (error) {
    const context = typeof error.context === 'object' && error.context !== null ? error.context as { json?: () => Promise<unknown>; text?: () => Promise<string> } : null;
    try {
      const body = context?.json ? await context.json() as { error?: string; message?: string; details?: string } : null;
      const message = body?.error || body?.message || body?.details;
      if (message) throw new Error(message);
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message !== error.message) throw parseError;
    }
    throw new Error(error.message || 'Pilot chat failed to respond.');
  }
  if (!data || typeof (data as { conversation_id?: unknown }).conversation_id !== 'string') {
    throw new Error('Pilot chat returned an invalid response.');
  }
  return data as PilotChatResult;
}
