import { supabase } from '@/integrations/supabase/client';

export interface ChatRespondInput {
  message: string;
  agent_slug: string;
  conversation_id?: string | null;
  channel?: string | null;
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

export async function chatRespond(input: ChatRespondInput): Promise<{ conversation_id: string; message: ChatMessageRow; error: boolean }> {
  const { data, error } = await supabase.functions.invoke('chat-respond', { body: input });
  if (error) throw error;
  return data as any;
}
