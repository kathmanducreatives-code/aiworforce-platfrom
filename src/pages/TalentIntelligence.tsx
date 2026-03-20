import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Users, Play, Briefcase, Filter, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/shared/PageHeader';
import MetricCard from '@/components/shared/MetricCard';
import EmptyState from '@/components/shared/EmptyState';
import TalentSignalCard from '@/components/talent-intel/TalentSignalCard';
import SignalFilterPills from '@/components/talent-intel/SignalFilterPills';
import { runAllTalentScrapers } from '@/lib/scrapers/talent/runAllTalentScrapers';

interface TalentSignal {
  id: string;
  candidate_name: string | null;
  candidate_linkedin_url: string | null;
  candidate_email: string | null;
  candidate_title: string | null;
  candidate_company: string | null;
  candidate_location: string | null;
  candidate_photo_url: string | null;
  signal_type: string;
  signal_title: string;
  signal_summary: string | null;
  signal_source_url: string | null;
  signal_detected_at: string;
  signal_score: number;
  tier: string;
  is_actioned: boolean;
  action_type: string | null;
  actioned_at: string | null;
  is_dismissed: boolean;
  matched_job_id: string | null;
  role_match_score: number | null;
  created_at: string;
}

interface ScreeningJob {
  id: string;
  title: string;
}

const hasApiKey = !!import.meta.env.VITE_FIRECRAWL_API_KEY;

const TalentIntelligence = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<TalentSignal[]>([]);
  const [jobs, setJobs] = useState<ScreeningJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selectedType, setSelectedType] = useState('all');
  const [selectedJob, setSelectedJob] = useState('all');
  const [showDismissed, setShowDismissed] = useState(false);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    const [signalsRes, jobsRes] = await Promise.all([
      (supabase as any).from('talent_signals').select('*').eq('user_id', user.id).order('signal_score', { ascending: false }),
      supabase.from('screening_jobs').select('id, title').eq('user_id', user.id),
    ]);

    if (signalsRes.data) setSignals(signalsRes.data);
    if (jobsRes.data) setJobs(jobsRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = (supabase as any)
      .channel('talent-signals-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'talent_signals',
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          const newSignal = payload.new as TalentSignal;
          setSignals(prev => [newSignal, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleRunScrapers = async () => {
    if (!user || !hasApiKey) return;
    setRunning(true);
    toast.info('Running talent scrapers...');
    try {
      const result = await runAllTalentScrapers(user.id);
      toast.success(`Found ${result.totalSignals} new signals in ${Math.round(result.duration_ms / 1000)}s`);
      if (result.errors.length) {
        toast.warning(`${result.errors.length} scraper errors occurred`);
      }
      await loadData();
    } catch (e: any) {
      toast.error('Scraper run failed: ' + e.message);
    }
    setRunning(false);
  };

  const handleDismiss = async (id: string) => {
    await (supabase as any).from('talent_signals').update({ is_dismissed: true }).eq('id', id);
    setSignals(prev => prev.map(s => s.id === id ? { ...s, is_dismissed: true } : s));
  };

  const handleAction = async (id: string, actionType: string) => {
    const signal = signals.find(s => s.id === id);
    if (!signal || !user) return;

    if (actionType === 'add_to_outreach') {
      await (supabase as any).from('outreach_leads').insert({
        contact_name: signal.candidate_name || 'Unknown',
        company: signal.candidate_company || 'Unknown',
        email: signal.candidate_email,
        linkedin_url: signal.candidate_linkedin_url,
        title: signal.candidate_title,
        discovery_source: `talent_intel_${signal.signal_type}`,
        notes: signal.signal_summary,
      });
      toast.success('Added to outreach leads');
    } else if (actionType === 'add_to_icp') {
      const sessionId = crypto.randomUUID();
      await (supabase as any).from('icp_lookalike_sessions').insert({
        session_id: sessionId,
        user_id: user.id,
        lookalike_url: signal.candidate_linkedin_url || '',
        profile_name: signal.candidate_name || 'From Talent Intel',
        status: 'draft',
      });
      toast.success('Added as ICP seed profile');
    }

    await (supabase as any).from('talent_signals').update({
      is_actioned: true,
      action_type: actionType,
      actioned_at: new Date().toISOString(),
    }).eq('id', id);

    setSignals(prev => prev.map(s => s.id === id ? { ...s, is_actioned: true, action_type: actionType } : s));
  };

  const filteredSignals = useMemo(() => {
    let filtered = signals;
    if (!showDismissed) filtered = filtered.filter(s => !s.is_dismissed);
    if (selectedType !== 'all') filtered = filtered.filter(s => s.signal_type === selectedType);
    if (selectedJob !== 'all') filtered = filtered.filter(s => s.matched_job_id === selectedJob);
    return filtered;
  }, [signals, selectedType, selectedJob, showDismissed]);

  const typeCounts = useMemo(() => {
    const active = signals.filter(s => !s.is_dismissed && !s.is_actioned);
    return {
      all: active.length,
      open_to_work: active.filter(s => s.signal_type === 'open_to_work').length,
      layoff_victim: active.filter(s => s.signal_type === 'layoff_victim').length,
      published_content: active.filter(s => s.signal_type === 'published_content').length,
      spoke_at_event: active.filter(s => s.signal_type === 'spoke_at_event').length,
      company_acquired: active.filter(s => s.signal_type === 'company_acquired').length,
    };
  }, [signals]);

  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const metrics = useMemo(() => ({
    newToday: signals.filter(s => s.created_at?.slice(0, 10) === today).length,
    hotCandidates: signals.filter(s => s.tier === 'HOT' && !s.is_dismissed).length,
    matchedToRoles: signals.filter(s => s.matched_job_id && !s.is_dismissed).length,
    actionedThisWeek: signals.filter(s => s.is_actioned && s.actioned_at && s.actioned_at >= weekAgo).length,
  }), [signals, today, weekAgo]);

  return (
    <div className="min-h-screen bg-transparent p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Talent Intelligence"
        subtitle="Find candidates at the moment they are most likely to move"
        primaryAction={{
          label: running ? 'Scanning...' : 'Run Scrapers',
          onClick: handleRunScrapers,
          icon: <Play className="h-4 w-4" />,
        }}
      />

      {/* API Key Missing Banner */}
      {!hasApiKey && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive">
            Firecrawl API key not configured. Add <code className="font-mono bg-destructive/10 px-1 rounded">VITE_FIRECRAWL_API_KEY</code> to your environment to enable live scraping.
          </p>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)
        ) : (
          <>
            <MetricCard label="New Signals Today" value={metrics.newToday} icon={<Users className="h-4 w-4 text-primary" />} />
            <MetricCard label="HOT Candidates" value={metrics.hotCandidates} icon={<Users className="h-4 w-4 text-destructive" />} />
            <MetricCard label="Matched to Roles" value={metrics.matchedToRoles} icon={<Briefcase className="h-4 w-4 text-primary" />} />
            <MetricCard label="Actioned This Week" value={metrics.actionedThisWeek} icon={<Users className="h-4 w-4 text-primary" />} />
          </>
        )}
      </div>

      {/* Role Match Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Showing signals for:</span>
        </div>
        <Select value={selectedJob} onValueChange={setSelectedJob}>
          <SelectTrigger className="w-[220px] rounded-lg border-border bg-card/50">
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {jobs.map(job => (
              <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Signal Type Filter Pills */}
      <SignalFilterPills
        selectedType={selectedType}
        onSelectType={setSelectedType}
        counts={typeCounts}
      />

      {/* Signal Cards */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[200px] rounded-2xl" />)}
        </div>
      ) : filteredSignals.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7 text-muted-foreground/60" />}
          title="No talent signals yet"
          description="Run the scrapers to find candidates who are likely to move based on real-time signals."
          actionLabel="Run Scrapers Now"
          onAction={handleRunScrapers}
          actionIcon={<Play className="h-4 w-4" />}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {filteredSignals.map(signal => (
            <TalentSignalCard
              key={signal.id}
              signal={signal}
              onDismiss={handleDismiss}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TalentIntelligence;
