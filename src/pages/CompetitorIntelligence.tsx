import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Eye, Play, Plus, AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/shared/PageHeader';
import MetricCard from '@/components/shared/MetricCard';
import EmptyState from '@/components/shared/EmptyState';
import AddCompetitorModal from '@/components/competitors/AddCompetitorModal';
import CompetitorIntelSignalCard from '@/components/competitor-intel/CompetitorIntelSignalCard';
import CompetitorProfileCard from '@/components/competitor-intel/CompetitorProfileCard';
import SignalGroupSection from '@/components/competitor-intel/SignalGroupSection';
import ImportanceAlertStrip from '@/components/competitor-intel/ImportanceAlertStrip';
import { runAllCompetitorScrapers } from '@/lib/scrapers/competitors/runAllCompetitorScrapers';

interface CompetitorSignal {
  id: string;
  competitor_id: string | null;
  competitor_name: string | null;
  signal_type: string;
  signal_title: string;
  signal_summary: string | null;
  signal_data: any;
  signal_source_url: string | null;
  signal_date: string | null;
  importance: string;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

interface CompetitorProfile {
  id: string;
  competitor_id: string | null;
  tagline: string | null;
  value_proposition: string | null;
  pricing_model: string | null;
  pricing_tiers: any;
  key_features: any;
  key_differentiators: any;
  total_employees_estimate: number | null;
  engineering_headcount_estimate: number | null;
  recent_executive_changes: any;
  g2_rating: number | null;
  g2_review_count: number | null;
  top_praise: any;
  top_complaints: any;
  last_full_scan_at: string | null;
  recent_launches: any;
}

interface Competitor {
  id: string;
  company_name: string;
}

const SIGNAL_GROUPS = [
  { key: 'pricing_change', label: 'Pricing Changes' },
  { key: 'new_feature,content_published', label: 'Product & Features' },
  { key: 'new_job_posting', label: 'Hiring Patterns' },
  { key: 'executive_change', label: 'Team Changes' },
  { key: 'review_trend', label: 'Customer Sentiment' },
  { key: 'positioning_shift', label: 'Positioning' },
];

const CompetitorIntelligence = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<CompetitorSignal[]>([]);
  const [profiles, setProfiles] = useState<CompetitorProfile[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedTab, setSelectedTab] = useState('all');

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    const [signalsRes, profilesRes, competitorsRes] = await Promise.all([
      (supabase as any).from('competitor_intel_signals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      (supabase as any).from('competitor_profiles').select('*').eq('user_id', user.id),
      (supabase as any).from('competitor_companies').select('id, company_name').eq('user_id', user.id),
    ]);

    if (signalsRes.data) setSignals(signalsRes.data);
    if (profilesRes.data) setProfiles(profilesRes.data);
    if (competitorsRes.data) setCompetitors(competitorsRes.data);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [user]);

  const handleRunScan = async () => {
    if (!user) return;
    setRunning(true);
    toast.info('Running competitor intelligence scan...');
    try {
      const result = await runAllCompetitorScrapers(user.id);
      toast.success(`Found ${result.totalSignals} new signals`);
      await loadData();
    } catch (e: any) {
      toast.error('Scan failed: ' + e.message);
    }
    setRunning(false);
  };

  const handleMarkRead = async (id: string) => {
    await (supabase as any).from('competitor_intel_signals').update({ is_read: true }).eq('id', id);
    setSignals(prev => prev.map(s => s.id === id ? { ...s, is_read: true } : s));
  };

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const filteredSignals = useMemo(() => {
    let filtered = signals.filter(s => !s.is_dismissed);
    if (selectedTab !== 'all') {
      filtered = filtered.filter(s => s.competitor_id === selectedTab);
    }
    return filtered;
  }, [signals, selectedTab]);

  const highImportanceUnread = signals.filter(s => s.importance === 'HIGH' && !s.is_read && !s.is_dismissed);

  const metrics = useMemo(() => ({
    tracked: competitors.length,
    signalsThisWeek: signals.filter(s => s.created_at >= weekAgo).length,
    pricingChanges: signals.filter(s => s.signal_type === 'pricing_change').length,
    highImportance: highImportanceUnread.length,
  }), [competitors, signals, weekAgo, highImportanceUnread]);

  const unreadByCompetitor = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of signals) {
      if (!s.is_read && !s.is_dismissed && s.competitor_id) {
        map[s.competitor_id] = (map[s.competitor_id] || 0) + 1;
      }
    }
    return map;
  }, [signals]);

  return (
    <div className="min-h-screen bg-transparent p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Competitor Intelligence"
        subtitle="Pricing, product, hiring, and positioning — updated automatically"
        primaryAction={{
          label: running ? 'Scanning...' : 'Run Scan',
          onClick: handleRunScan,
          icon: <Play className="h-4 w-4" />,
        }}
        secondaryActions={[{
          label: 'Add Competitor',
          onClick: () => setAddModalOpen(true),
          icon: <Plus className="h-4 w-4" />,
          variant: 'outline',
        }]}
      />

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)
        ) : (
          <>
            <MetricCard label="Competitors Tracked" value={metrics.tracked} icon={<Eye className="h-4 w-4 text-primary" />} />
            <MetricCard label="Signals This Week" value={metrics.signalsThisWeek} icon={<Eye className="h-4 w-4 text-primary" />} />
            <MetricCard label="Pricing Changes" value={metrics.pricingChanges} icon={<Eye className="h-4 w-4 text-primary" />} />
            <MetricCard label="High Importance" value={metrics.highImportance} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} />
          </>
        )}
      </div>

      {/* Alert strip */}
      <ImportanceAlertStrip count={highImportanceUnread.length} />

      {loading ? (
        <div className="space-y-4 mt-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[160px] rounded-2xl" />)}
        </div>
      ) : competitors.length === 0 && signals.length === 0 ? (
        <EmptyState
          icon={<Eye className="h-7 w-7 text-muted-foreground/60" />}
          title="No competitor intelligence yet"
          description="Add competitors and run a scan to see their pricing, product moves, hiring patterns, and customer sentiment."
          actionLabel="Add Competitor"
          onAction={() => setAddModalOpen(true)}
          actionIcon={<Plus className="h-4 w-4" />}
        />
      ) : (
        <>
          {/* Competitor tabs */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="mt-6">
            <TabsList className="bg-card/50 border border-border rounded-xl p-1 h-auto flex-wrap">
              <TabsTrigger value="all" className="rounded-lg text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                All
              </TabsTrigger>
              {competitors.map(comp => (
                <TabsTrigger key={comp.id} value={comp.id} className="rounded-lg text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary gap-1.5">
                  {comp.company_name}
                  {unreadByCompetitor[comp.id] > 0 && (
                    <Badge variant="secondary" className="h-4 min-w-[16px] text-[10px] px-1 bg-destructive/10 text-destructive">
                      {unreadByCompetitor[comp.id]}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value={selectedTab} className="mt-4 space-y-4">
              {/* Signal groups */}
              {SIGNAL_GROUPS.map(group => {
                const types = group.key.split(',');
                const groupSignals = filteredSignals.filter(s => types.includes(s.signal_type));
                if (groupSignals.length === 0) return null;
                const unreadCount = groupSignals.filter(s => !s.is_read).length;

                return (
                  <SignalGroupSection key={group.key} title={group.label} unreadCount={unreadCount}>
                    {groupSignals.map(signal => (
                      <CompetitorIntelSignalCard key={signal.id} signal={signal} onMarkRead={handleMarkRead} />
                    ))}
                  </SignalGroupSection>
                );
              })}

              {filteredSignals.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No signals for this selection.</p>
              )}
            </TabsContent>
          </Tabs>

          {/* Competitor Profile Cards */}
          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Competitor Profiles</h2>
            {competitors.map(comp => {
              const profile = profiles.find(p => p.competitor_id === comp.id);
              return (
                <CompetitorProfileCard
                  key={comp.id}
                  competitor={comp}
                  profile={profile || null}
                  signals={signals.filter(s => s.competitor_id === comp.id)}
                  onRescan={handleRunScan}
                />
              );
            })}
          </div>
        </>
      )}

      <AddCompetitorModal open={addModalOpen} onOpenChange={setAddModalOpen} onAdded={loadData} />
    </div>
  );
};

export default CompetitorIntelligence;
