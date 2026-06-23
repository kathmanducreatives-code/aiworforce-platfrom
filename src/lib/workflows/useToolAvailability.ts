import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TOOL_AVAILABILITY, type ToolAvailabilityMap } from './tools';

let cached: ToolAvailabilityMap | null = null;
let inflight: Promise<ToolAvailabilityMap> | null = null;

async function fetchAvailability(): Promise<ToolAvailabilityMap> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('tool-availability', { body: {} });
      if (error || !data) return DEFAULT_TOOL_AVAILABILITY;
      const map = { ...DEFAULT_TOOL_AVAILABILITY, ...(data as Partial<ToolAvailabilityMap>) };
      cached = map;
      return map;
    } catch {
      return DEFAULT_TOOL_AVAILABILITY;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useToolAvailability(): ToolAvailabilityMap {
  const [state, setState] = useState<ToolAvailabilityMap>(cached ?? DEFAULT_TOOL_AVAILABILITY);
  useEffect(() => {
    let active = true;
    fetchAvailability().then((m) => { if (active) setState(m); });
    return () => { active = false; };
  }, []);
  return state;
}
