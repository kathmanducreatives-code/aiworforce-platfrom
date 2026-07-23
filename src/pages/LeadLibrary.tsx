import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { useLeadLibrary, loadLocalAug, saveLocalAug } from "@/hooks/leadLibrary/useLeadLibrary";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { MetricStrip, type MetricKey } from "@/components/leads/library/MetricStrip";
import { EMPTY_FILTERS, applyFilters, type Filters } from "@/components/leads/library/FilterBar";
import { LeadTable } from "@/components/leads/library/LeadTable";
import { LeadDetailDrawer } from "@/components/leads/library/LeadDetailDrawer";
import { BulkActionBar } from "@/components/leads/library/BulkActionBar";
import { ListsTab } from "@/components/leads/library/ListsTab";
import { SearchRunsTab } from "@/components/leads/library/SearchRunsTab";
import { ActivityTab } from "@/components/leads/library/ActivityTab";
import { downloadCsv, leadsToCsv } from "@/lib/leadLibrary/types";
import { CommandBackdrop } from "@/components/leads/library/premium/CommandBackdrop";
import { PremiumSkeleton } from "@/components/leads/library/premium/PremiumSkeleton";
import { LibraryHeader } from "@/components/leads/library/LibraryHeader";
import { AtlasStrip } from "@/components/leads/library/AtlasStrip";
import { Toolbar, type TabId } from "@/components/leads/library/Toolbar";
import { Pagination } from "@/components/leads/library/Pagination";
import {
  deriveLeadDecisionState,
  sortRows,
  type LeadDecisionState,
  type SortKey,
} from "@/lib/leadLibrary/leadDecisionState";

function matchesMetric(s: LeadDecisionState, m: MetricKey): boolean {
  switch (m) {
    case "all": return true;
    case "qualified":
      return ["qualified", "buyer_needed", "draft_ready", "awaiting_approval", "contacted", "replied", "meeting"].includes(s.lifecycle);
    case "buyer_ready":
      return s.buyerState === "verified" &&
        ["qualified", "draft_ready", "awaiting_approval", "contacted", "replied", "meeting"].includes(s.lifecycle);
    case "draft_ready":
      return s.outreachState === "draft_ready" && ["draft_ready", "awaiting_approval"].includes(s.lifecycle);
    case "awaiting_approval": return s.lifecycle === "awaiting_approval";
    case "contacted": return s.lifecycle === "contacted";
    case "replied": return s.lifecycle === "replied";
    case "meetings": return s.lifecycle === "meeting";
  }
}

export default function LeadLibrary() {
  const { workspaceId } = useWorkspace();
  const { data: rows = [], isLoading, error, refetch } = useLeadLibrary();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as TabId) || "all";
  const setTab = (t: TabId) => { params.set("tab", t); setParams(params, { replace: true }); };

  const [metric, setMetric] = useState<MetricKey>("all");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("recommended");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<string | null>(params.get("lead"));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Canonical decision states: computed once per row, reused everywhere so the
  // metric strip, filters, table and drawer can never disagree.
  const decisionByRow = useMemo(() => {
    const m = new Map<string, ReturnType<typeof deriveLeadDecisionState>>();
    for (const r of rows) m.set(r.id, deriveLeadDecisionState(r));
    return m;
  }, [rows]);

  const metricFiltered = useMemo(() => {
    const states = rows.map((r) => decisionByRow.get(r.id)!);
    const keep = new Set(
      rows.filter((_, i) => matchesMetric(states[i], metric)).map((r) => r.id),
    );
    return rows.filter((r) => keep.has(r.id));
  }, [rows, metric, decisionByRow]);

  const filtered = useMemo(() => applyFilters(metricFiltered, filters), [metricFiltered, filters]);
  const sorted = useMemo(() => sortRows(filtered, decisionByRow, sort), [filtered, decisionByRow, sort]);
  useEffect(() => { setPage(1); }, [filters, metric, tab, pageSize, sort]);

  const total = sorted.length;
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const currentLead = openLead ? rows.find((r) => r.id === openLead) ?? null : null;

  const handleExportAll = () => {
    const target = filtered.length > 0 ? filtered : rows;
    downloadCsv(`lead-library-${Date.now()}.csv`, leadsToCsv(target));
    toast.success(`Exported ${target.length} lead${target.length === 1 ? "" : "s"}`);
  };

  const handleCreateList = () => {
    if (!workspaceId) return;
    const name = window.prompt("Name your new list");
    if (!name) return;
    const aug = loadLocalAug(workspaceId);
    aug.savedViews.push({ id: crypto.randomUUID(), name, filters: null });
    saveLocalAug(workspaceId, aug);
    toast.success(`List "${name}" created`);
  };

  const handleSaveView = () => {
    if (!workspaceId) return;
    const name = window.prompt("Name this view");
    if (!name) return;
    const aug = loadLocalAug(workspaceId);
    aug.savedViews.push({ id: crypto.randomUUID(), name, filters });
    saveLocalAug(workspaceId, aug);
    toast.success(`Saved view "${name}"`);
  };

  return (
    <div className="relative h-[calc(100vh-190px)] min-h-[640px]">
      <CommandBackdrop />

      <div className="h-full max-w-[1440px] mx-auto px-6 lg:px-8 pt-4 flex flex-col gap-3 min-h-0">
        <LibraryHeader
          onAddLead={() => toast.info("Open the Add lead dialog from your CRM import flow.")}
          onImport={() => toast.info("CSV import — coming from the Import workflow.")}
          onExport={handleExportAll}
          onCreateList={handleCreateList}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-3">
          <AtlasStrip rows={rows} />
          <MetricStrip rows={rows} active={metric} onSelect={setMetric} />
        </div>

        <Toolbar
          tab={tab}
          onTab={setTab}
          rows={rows}
          filters={filters}
          onFilters={setFilters}
          onSaveView={handleSaveView}
        />

        {tab === "all" && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden bg-[rgba(10,13,12,0.55)] backdrop-blur-xl border border-white/[0.06]">
            {isLoading ? (
              <div className="p-4"><PremiumSkeleton /></div>
            ) : error ? (
              <div className="m-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                Lead data could not be synchronized.{" "}
                <button className="underline" onClick={() => refetch()}>Refresh</button>.
              </div>
            ) : total === 0 ? (
              <EmptyState
                hasRows={rows.length > 0}
                onReset={() => setFilters(EMPTY_FILTERS)}
              />
            ) : (
              <>
                <LeadTable
                  rows={pageRows}
                  selected={selected}
                  onToggle={(id) => {
                    const n = new Set(selected);
                    if (n.has(id)) n.delete(id); else n.add(id);
                    setSelected(n);
                  }}
                  onToggleAll={(all) => setSelected(all ? new Set(pageRows.map((r) => r.id)) : new Set())}
                  onOpen={(id) => { setOpenLead(id); params.set("lead", id); setParams(params, { replace: true }); }}
                />
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPage={setPage}
                  onPageSize={setPageSize}
                />
              </>
            )}
          </div>
        )}

        {tab === "lists" && (
          <div className="flex-1 min-h-0 overflow-auto">
            <ListsTab rows={rows} onOpenList={(name) => {
              setFilters(EMPTY_FILTERS);
              setTab("all");
              toast.info(`Filtered by list "${name}"`);
            }} />
          </div>
        )}

        {tab === "runs" && (
          <div className="flex-1 min-h-0 overflow-auto">
            <SearchRunsTab rows={rows} onOpenRun={(key) => {
              setTab("all");
              toast.info(`Filtered by search run ${key}`);
            }} />
          </div>
        )}

        {tab === "activity" && workspaceId && (
          <div className="flex-1 min-h-0 overflow-auto">
            <ActivityTab
              rows={rows}
              workspaceId={workspaceId}
              onOpenLead={(id) => { setOpenLead(id); params.set("lead", id); setParams(params, { replace: true }); setTab("all"); }}
            />
          </div>
        )}

        {workspaceId && selectedRows.length > 0 && (
          <BulkActionBar workspaceId={workspaceId} selectedRows={selectedRows} onClear={() => setSelected(new Set())} />
        )}
      </div>

      <LeadDetailDrawer
        lead={currentLead}
        onClose={() => { setOpenLead(null); params.delete("lead"); setParams(params, { replace: true }); }}
        onRefresh={() => refetch()}
      />
    </div>
  );
}

function EmptyState({ hasRows, onReset }: { hasRows: boolean; onReset: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <div className="text-[13px] text-foreground font-medium">
          {hasRows ? "No leads match this view" : "Your Lead Library is empty"}
        </div>
        <div className="mt-1 text-[12px] text-muted-foreground">
          {hasRows
            ? "Try adjusting or clearing filters to see the full library."
            : "Ask Atlas to find accounts, or import a CSV to begin."}
        </div>
        {hasRows && (
          <button
            onClick={onReset}
            className="mt-3 inline-flex items-center h-8 px-3 rounded-md text-[12px] text-primary bg-primary/[0.08] border border-primary/25 hover:bg-primary/[0.14]"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
