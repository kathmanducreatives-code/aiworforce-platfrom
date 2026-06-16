import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LeadResultItem {
  id: string;
  lead_candidate_id: string;
  account_id?: string | null;
  contact_id?: string | null;

  person_name?: string | null;
  title?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  location?: string | null;

  signal_type?: string | null;
  signal_summary?: string | null;
  source_url?: string | null;
  source_type?: string | null;

  fit_score?: number | null;
  fit_reason?: string | null;
  status?: string | null;
}

export function useLeadResults(planId: string | null) {
  const [items, setItems] = useState<LeadResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('lead_candidates' as any)
        .select(
          'id, plan_id, lead_type, status, fit_score, priority, reason, account_id, contact_id, ' +
          'accounts(id,name,domain,industry,stage), contacts(id,full_name,title,linkedin_url)',
        )
        .eq('plan_id', planId)
        .order('priority', { ascending: false });
      if (err) throw err;
      const rows = (data ?? []) as any[];
      const normalized: LeadResultItem[] = rows.map((r) => ({
        id: r.id,
        lead_candidate_id: r.id,
        account_id: r.account_id ?? null,
        contact_id: r.contact_id ?? null,
        person_name: r.contacts?.full_name ?? null,
        title: r.contacts?.title ?? null,
        company_name: r.accounts?.name ?? null,
        website: r.accounts?.domain ? `https://${r.accounts.domain}` : null,
        linkedin_url: r.contacts?.linkedin_url ?? null,
        location: null,
        signal_type: r.lead_type ?? null,
        signal_summary: r.reason ?? null,
        source_url: null,
        source_type: r.lead_type ?? null,
        fit_score: typeof r.fit_score === 'number' ? r.fit_score : null,
        fit_reason: r.reason ?? null,
        status: r.status ?? 'new',
      }));
      setItems(normalized);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lead results');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => { void load(); }, [load]);

  return { items, loading, error, refresh: load };
}
