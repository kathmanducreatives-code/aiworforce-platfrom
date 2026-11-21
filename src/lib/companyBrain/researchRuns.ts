// Company Brain V2 (B2.0): the onboarding research already stored for this
// workspace, read for completion suggestions. READ ONLY: no research is run, no
// provider is called. RLS lets members read their workspace's runs. A failed
// read yields no research suggestions, never an error on the page.
import { supabase } from '@/integrations/supabase/client';
import type { StoredResearchRun } from './completion';

export async function fetchStoredResearch(workspaceId: string): Promise<StoredResearchRun[]> {
  try {
    const { data, error } = await supabase
      .from('company_brain_research_runs')
      .select('source_type, status, output, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error || !Array.isArray(data)) return [];
    return data as unknown as StoredResearchRun[];
  } catch {
    return [];
  }
}
