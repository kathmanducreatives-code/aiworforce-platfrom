import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/agentoryApi';
import AgentPortrait from '@/components/agents/AgentPortrait';
import { fetchBriefHistory, requestExecutiveBrief } from '@/lib/orion/executiveBrief';
import OrionBriefView from './OrionBriefView';
import './orion-brief.css';

/**
 * ORION on the dashboard: loads the stored brief history for the workspace
 * (saved_outputs, RLS-scoped to members) and asks `daily-brief` for a new one
 * on demand. The view itself is presentational (OrionBriefView).
 */
export default function OrionBriefPanel({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = ['orion-briefs', workspaceId];
  const query = useQuery({
    queryKey: key,
    enabled: !!workspaceId,
    queryFn: () => fetchBriefHistory(supabase as never, workspaceId!),
    staleTime: 60_000,
  });

  // A workspace switch must never show the previous workspace's selection.
  useEffect(() => { setSelectedId(null); setError(null); }, [workspaceId]);

  const generate = async () => {
    if (!workspaceId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      await requestExecutiveBrief((name, body) => invokeFunction(name, body), workspaceId);
      setSelectedId(null); // show the newest
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Orion could not build the brief');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <OrionBriefView
      history={query.data ?? []}
      selectedId={selectedId}
      loading={!!workspaceId && query.isLoading}
      generating={generating}
      error={error ?? (query.error ? 'Could not load past briefs.' : null)}
      portrait={<AgentPortrait agentId="orion" size={22} decorative />}
      onGenerate={generate}
      onSelect={setSelectedId}
      onNavigate={(route) => navigate(route)}
    />
  );
}
