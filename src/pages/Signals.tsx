// Signals — department workspace page for the Company-Brain radar.
// Uses DepartmentWorkspaceShell + ScoutCopilot right rail. Reuses the existing
// useSignalFeed / useSignalReviews hooks; no schema or backend changes.

import { useMemo, useState } from 'react';
import { Radar, Loader2, Settings2 } from 'lucide-react';
import DepartmentWorkspaceShell, { type DeptTab } from '@/components/layout/DepartmentWorkspaceShell';
import ScoutCopilot from '@/components/signals/workspace/ScoutCopilot';
import SignalsFilters, { type SecondaryCategory } from '@/components/signals/workspace/SignalsFilters';
import TodaysSignalBrief from '@/components/signals/workspace/TodaysSignalBrief';
import SignalsFeedList from '@/components/signals/workspace/SignalsFeedList';
import SituationStrip from '@/components/signals/SituationStrip';
import EditRadarDrawer from '@/components/signals/EditRadarDrawer';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { deriveRadarBrief, type BriefSignal } from '@/lib/radarBrief';
import { resolveAgent } from '@/lib/agentResolver';
import { getDeptTheme } from '@/lib/departmentTheme';
import type { FeedSignal } from '@/lib/signalFeedModel';
import { toast } from 'sonner';

type PrimaryTab = 'today' | 'hiring' | 'competitors' | 'other';

const PRIMARY_TABS: DeptTab<PrimaryTab>[] = [
  { id: 'today', label: 'Today' },
  { id: 'hiring', label: 'Hiring' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'other', label: 'Other' },
];

function matchesPrimary(s: FeedSignal, tab: PrimaryTab): boolean {
  const t = s.signal_type;
  switch (tab) {
    case 'hiring':
      return t === 'hiring' || t === 'hiring_signal';
    case 'competitors':
      return t === 'competitor' || t === 'competitor_engagement';
    case 'other':
      return !['hiring', 'hiring_signal', 'competitor', 'competitor_engagement'].includes(t);
    default:
      return true;
  }
}

function matchesSecondary(s: FeedSignal, cat: SecondaryCategory): boolean {
  if (cat === 'all') return true;
  const t = s.signal_type;
  switch (cat) {
    case 'funding': return t === 'funding';
    case 'linkedin': return t === 'linkedin_intent' || t === 'linkedin_engagement' || t === 'linkedin_post';
    case 'comments': return t === 'linkedin_comment' || t === 'comments';
    case 'workflows': return t === 'workflow_trend';
    case 'people': return t === 'people' || t === 'people_profile' || t === 'decision_maker';
    default: return true;
  }
}

export default function Signals() {
  const { workspaceId } = useWorkspace();
  const { data: brainData, refresh: refreshBrain } = useCompanyBrain();
  const { signals, clusters, relevance, loading, runRadarScan, scanning } = useSignalFeed(workspaceId);
  const { reviewsBySignal } = useSignalReviews(workspaceId);

  const [tab, setTab] = useState<PrimaryTab>('today');
  const [secondary, setSecondary] = useState<SecondaryCategory>('all');
  const [query, setQuery] = useState('');
  const [showUnverified, setShowUnverified] = useState(false);
  const [editRadarOpen, setEditRadarOpen] = useState(false);

  // Canonical Signal Scout identity (legacy 'scout' → public Lyra profile).
  const scout = resolveAgent('scout');
  const theme = getDeptTheme('growth');
  const accent = scout.accentHex ?? theme.hex;

  // Metrics
  const metrics = useMemo(() => {
    const verified = signals.filter((s) => s.show_by_default);
    const hiring = signals.filter((s) => s.signal_type === 'hiring' || s.signal_type === 'hiring_signal').length;
    const competitor = signals.filter((s) => s.signal_type === 'competitor' || s.signal_type === 'competitor_engagement').length;
    const reviewed = Object.values(reviewsBySignal).filter((r) => r.status && r.status !== 'ignored').length;
    return [
      { label: 'Verified signals', value: verified.length },
      { label: 'Hiring', value: hiring },
      { label: 'Competitor', value: competitor },
      { label: 'Reviewed', value: reviewed },
    ];
  }, [signals, reviewsBySignal]);

  // Brief inputs
  const brief = useMemo(() => {
    const briefSignals: BriefSignal[] = signals.map((s) => ({
      signal_type: s.signal_type,
      title: s.title,
      score: s.fit_score ?? 0,
      verified: s.show_by_default,
      recommended_action: s.next_action ?? s.reason ?? null,
      company: s.account_name ?? null,
    }));
    return deriveRadarBrief(briefSignals, []);
  }, [signals]);

  // Filtered list for body
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return signals.filter((s) => {
      if (!showUnverified && !s.show_by_default) return false;
      if (!matchesPrimary(s, tab)) return false;
      if (!matchesSecondary(s, secondary)) return false;
      if (q) {
        const hay = `${s.title} ${s.description ?? ''} ${s.account_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (reviewsBySignal[s.id]?.status === 'ignored') return false;
      return true;
    });
  }, [signals, tab, secondary, query, showUnverified, reviewsBySignal]);

  const primaryTabs = useMemo<DeptTab<PrimaryTab>[]>(
    () =>
      PRIMARY_TABS.map((t) => ({
        ...t,
        badge: t.id === 'today' ? brief.usefulCount || undefined : undefined,
      })),
    [brief.usefulCount],
  );

  const handleRunScan = async () => {
    try {
      const res = await runRadarScan({ mode: 'default' });
      if (res?.inserted !== undefined) {
        toast.success(`Scout added ${res.inserted} new ${res.inserted === 1 ? 'signal' : 'signals'}`);
      } else {
        toast.success('Radar scan complete');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Radar scan failed');
    }
  };

  return (
    <>
      <DepartmentWorkspaceShell
        eyebrow="Growth · Signals"
        title="Company Brain Radar"
        description="Verified market signals from your ICP — hiring, funding, competitor moves and buying-window activity, monitored by Scout."
        agent={{
          name: scout.name,
          role: scout.role,
          status: 'On duty',
          avatar: scout.image ?? '',
          accentHex: accent,
          fallbackInitial: (scout.name?.[0] ?? 'S').toUpperCase(),
        }}
        metrics={metrics}
        primaryAction={{
          label: scanning ? 'Scanning…' : 'Run radar scan',
          onClick: handleRunScan,
          icon: scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />,
          disabled: scanning,
        }}
        secondaryAction={{
          label: 'Edit radar',
          onClick: () => setEditRadarOpen(true),
          icon: <Settings2 className="h-3.5 w-3.5" />,
        }}
        tabs={primaryTabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PrimaryTab)}
        filtersSlot={
          <SignalsFilters
            query={query}
            onQueryChange={setQuery}
            secondary={secondary}
            onSecondaryChange={setSecondary}
            reviewFilter="all"
            onReviewFilterChange={() => {}}
            showUnverified={showUnverified}
            onShowUnverifiedChange={setShowUnverified}
            accentHex={accent}
          />
        }
        rail={
          <ScoutCopilot
            agentName={scout.name}
            agentRole={scout.role}
            agentAvatar={scout.image ?? ''}
            accentHex={accent}
            onRunRadarScan={handleRunScan}
            onEditRadar={() => setEditRadarOpen(true)}
          />
        }
        mobileRailLabel={`Open ${scout.name}`}
      >
        {tab === 'today' && (
          <TodaysSignalBrief
            brief={brief}
            scanning={scanning}
            onRunScan={handleRunScan}
            onReview={() => setTab('hiring')}
            accentHex={accent}
          />
        )}
        {/* ── SITUATIONS, ABOVE THE ROWS ──────────────────────────────────
            A company showing three signals is the thing to act on; the rows
            below are the evidence for it. Renders nothing when no company
            shows more than one signal. */}
        <SituationStrip
          clusters={clusters}
          relevance={relevance}
          onFocus={(c) => setQuery(c.subject_key ?? '')}
        />
        <SignalsFeedList
          signals={filtered}
          loading={loading}
          accentHex={accent}
          emptyLabel={
            tab === 'today'
              ? 'No verified signals yet — run a scan to populate the radar.'
              : 'No signals match this filter.'
          }
        />
      </DepartmentWorkspaceShell>

      <EditRadarDrawer
        open={editRadarOpen}
        onOpenChange={setEditRadarOpen}
        workspaceId={workspaceId}
        brainProfile={(brainData?.profile as Record<string, any> | null) ?? null}
        onSaved={() => {
          void refreshBrain();
          toast.success('Radar preferences saved');
        }}
      />
    </>
  );
}
