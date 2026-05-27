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
      plan_summary: string;
      steps_count: number;
    };

export async function pilotChat(input: PilotChatInput): Promise<PilotChatResult> {
  const { data, error } = await supabase.functions.invoke('pilot-chat', { body: input });
  if (error) throw error;
  return data as PilotChatResult;
}
