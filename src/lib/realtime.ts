import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export function createRealtimeChannelName(prefix: string): string {
  const suffix =
    typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}:${suffix}`;
}

export function removeRealtimeChannel(channel: RealtimeChannel): void {
  try {
    void supabase.removeChannel(channel);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[realtime] channel cleanup failed', error);
    }
  }
}

export function logRealtimeStatus(label: string) {
  return (status: string, error?: Error) => {
    if (import.meta.env.DEV && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
      console.warn(`[realtime] ${label} ${status}`, error);
    }
  };
}