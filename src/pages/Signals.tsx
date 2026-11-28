// Signals — department workspace page for the Company-Brain radar.
// Uses DepartmentWorkspaceShell + LisaCopilot right rail (LISA, the Signals specialist). Reuses the existing
// useSignalFeed / useSignalReviews hooks; no schema or backend changes.

import { useMemo, useState } from 'react';
import { Radar, Loader2, Settings2 } from 'lucide-react';
import DepartmentWorkspaceShell, { type DeptTab } from '@/components/layout/DepartmentWorkspaceShell';
import LisaCopilot from '@/components/signals/workspace/LisaCopilot';
import SignalsFilters, { type SecondaryCategory } from '@/components/signals/workspace/SignalsFilters';
import TodaysSignalBrief from '@/components/signals/workspace/TodaysSignalBrief';
import SignalsFeedList from '@/components/signals/workspace/SignalsFeedList';
import SituationStrip from '@/components/signals/SituationStrip';
import EditRadarDrawer from '@/components/signals/EditRadarDrawer';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { useSignalFeed } from '@/hooks/useSignalFeed';
import { useSignalReviews } from '@/hooks/useSignalReviews';
import { useMonitoringPlans } from '@/hooks/useMonitoringPlans';
import { useDepartmentAgentStatus } from '@/hooks/useDepartmentAgentStatus';
import { deriveRadarBrief, type BriefSignal } from '@/lib/radarBrief';
import { matchesCategory, matchesReview, signalCounters, signalTab, type ReviewFilter } from '@/lib/signalCardView';
import { radarScanOutcome } from '@/lib/radarScanOutcome';
import MonitoringPlansPanel from '@/components/signals/workspace/MonitoringPlansPanel';
import { resolveAgent } from '@/lib/agentResolver';
import { getDeptTheme } from '@/lib/departmentTheme';
import { AmbientBackdrop } from '@/components/layout/AmbientBackdrop';
import type { FeedSignal } from '@/lib/signalFeedModel';
import { toast } from 'sonner';

type PrimaryTab = 'today' | 'hiring' | 'competitors' | 'other';

const PRIMARY_TABS: DeptTab<PrimaryTab>[] = [
  { id: 'today', label: 'Today' },
  { id: 'hiring', label: 'Hiring' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'other', label: 'Other' },
];

// One classifier for tabs, counters and filters (lib/signalCardView.ts), so they cannot disagree.
function matchesPrimary(s: FeedSignal, tab: PrimaryTab): boolean {
  return tab === 'today' || signalTab(s) === tab;
}

export default function Signals() {
  const { workspaceId } = useWorkspace();
  const { data: brainData, refresh: refreshBrain } = useCompanyBrain();
  const { signals, clusters, relevance, loading, runRadarScan, scanning } = useSignalFeed(workspaceId);
  const { reviewsBySignal, setReview } = useSignalReviews(workspaceId);
  const monitoring = useMonitoringPlans(workspaceId);
  // LISA's live state — the Signals specialist (agentRegistry `lisa`), as on her dashboard card.
  const lisaStatus = useDepartmentAgentStatus(workspaceId, 'lisa');

  const [tab, setTab] = useState<PrimaryTab>('today');
  const [secondary, setSecondary] = useState<SecondaryCategory>('all');
  const [query, setQuery] = useState('');
  const [showUnverified, setShowUnverified] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [editRadarOpen, setEditRadarOpen] = useState(false);

  // The canonical Signals agent is LISA (agentRegistry / departments.ts). Legacy 'scout' is ATLAS.
  const lisa = resolveAgent('lisa');
  const theme = getDeptTheme('growth');
  const accent = theme.hex;

  // Metrics — from the same classifier as the tabs and filters.
  const metrics = useMemo(() => {
    const c = signalCounters(signals, (id) => reviewsBySignal[id]?.status ?? null);
    return [
      { label: 'Verified signals', value: c.verified },
      { label: 'Hiring', value: c.hiring },
      { label: 'Competitor', value: c.competitor },
      { label: 'Reviewed', value: c.reviewed },
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
      if (!matchesCategory(s, secondary)) return false;
      if (q) {
        const raw = (s.raw ?? {}) as Record<string, unknown>;
        const lisa = (raw.lisa ?? {}) as { company?: { name?: string } };
        const hay = `${s.title} ${s.description ?? ''} ${s.account_name ?? ''} ${lisa.company?.name ?? ''} ${raw.subject_key ?? ''} ${s.source_url ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (!matchesReview(reviewsBySignal[s.id]?.status ?? null, reviewFilter)) return false;
      return true;
    });
  }, [signals, tab, secondary, query, showUnverified, reviewsBySignal, reviewFilter]);

  const primaryTabs = useMemo<DeptTab<PrimaryTab>[]>(
    () =>
      PRIMARY_TABS.map((t) => ({
        ...t,
        badge: t.id === 'today' ? brief.usefulCount || undefined : undefined,
      })),
    [brief.usefulCount],
  );

  // An honest result: "nothing ran" when no source is configured — never "added 0".
  const handleRunScan = async () => {
    try {
      const res = await runRadarScan({ mode: 'default' });
      const out = radarScanOutcome(res, lisa.name);
      if (out.kind === 'nothing_ran') toast.warning('Scan did not run', { description: out.message });
      else if (out.kind === 'added') toast.success(out.message);
      else toast.message(out.message);
    } catch (e) {
      toast.error('Radar scan failed', { description: e instanceof Error ? e.message : 'Nothing was saved. Try again.' });
    }
  };

  return (
    <>
      <AmbientBackdrop variant="signals" />
      <DepartmentWorkspaceShell
        eyebrow="Growth · Signals"
        title="Company Brain Radar"
        description="Market signals for your ICP — hiring, expansion, funding, leadership and competitor moves — collected, verified and scored by LISA against your Company Brain."
        agent={{
          name: lisa.name,
          role: lisa.role,
          status: lisaStatus ?? undefined,
          avatar: lisa.image ?? '',
          accentHex: accent,
          fallbackInitial: (lisa.name?.[0] ?? 'S').toUpperCase(),
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
            reviewFilter={reviewFilter}
            onReviewFilterChange={setReviewFilter}
            showUnverified={showUnverified}
            onShowUnverifiedChange={setShowUnverified}
            accentHex={accent}
          />
        }
        rail={
          <LisaCopilot
            agentName={lisa.name}
            agentRole={lisa.role}
            agentAvatar={lisa.image ?? ''}
            agentStatus={lisaStatus}
            accentHex={accent}
            onRunRadarScan={handleRunScan}
            onEditRadar={() => setEditRadarOpen(true)}
          />
        }
        collapsibleRail
        mobileRailLabel={`Open ${lisa.name}`}
      >
        {tab === 'today' && (
          <TodaysSignalBrief
            brief={brief}
            scanning={scanning}
            onRunScan={handleRunScan}
            onReview={() => setTab('hiring')}
            accentHex={accent}
            agentName={lisa.name}
            activeMonitoring={monitoring.available ? monitoring.activeCount : null}
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
        <MonitoringPlansPanel workspaceId={workspaceId} monitoring={monitoring} accentHex={accent} agentName={lisa.name} />
        <SignalsFeedList
          signals={filtered}
          loading={loading}
          accentHex={accent}
          reviewStatusOf={(id) => reviewsBySignal[id]?.status ?? null}
          onReview={async (id, st) => {
            try { await setReview(id, st); toast.success(st === 'ignored' ? 'Signal ignored' : st === 'saved' ? 'Signal saved' : 'Marked reviewed'); }
            catch (e) { toast.error('Review not saved', { description: e instanceof Error ? e.message : 'Nothing was changed.' }); }
          }}
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
        brainUpdatedAt={brainData?.updated_at ?? null}
        onSaved={() => {
          void refreshBrain();
          toast.success('Radar preferences saved');
        }}
      />
    </>
  );
}
