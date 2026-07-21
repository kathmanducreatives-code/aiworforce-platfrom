import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, Upload, Download, FolderPlus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useLeadLibrary, loadLocalAug, saveLocalAug } from "@/hooks/leadLibrary/useLeadLibrary";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { MetricStrip, computeMetric, type MetricKey } from "@/components/leads/library/MetricStrip";
import { FilterBar, EMPTY_FILTERS, applyFilters, type Filters } from "@/components/leads/library/FilterBar";
import { LeadTable } from "@/components/leads/library/LeadTable";
import { LeadDetailDrawer } from "@/components/leads/library/LeadDetailDrawer";
import { BulkActionBar } from "@/components/leads/library/BulkActionBar";
import { ListsTab } from "@/components/leads/library/ListsTab";
import { SearchRunsTab } from "@/components/leads/library/SearchRunsTab";
import { ActivityTab } from "@/components/leads/library/ActivityTab";
import { downloadCsv, leadsToCsv } from "@/lib/leadLibrary/types";
import { CommandBackdrop } from "@/components/leads/library/premium/CommandBackdrop";
import { AtlasPanel } from "@/components/leads/library/premium/AtlasPanel";
import { AtlasEmptyState } from "@/components/leads/library/premium/AtlasEmptyState";
import { PremiumSkeleton } from "@/components/leads/library/premium/PremiumSkeleton";

type TabId = "all" | "lists" | "runs" | "activity";

export default function LeadLibrary() {
  const { workspaceId } = useWorkspace();
  const { data: rows = [], isLoading, error, refetch } = useLeadLibrary();
  const [params, setParams] = useSearchParams();

  const tab = (params.get("tab") as TabId) || "all";
  const setTab = (t: TabId) => { params.set("tab", t); setParams(params, { replace: true }); };

  const [metric, setMetric] = useState<MetricKey>("all");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLead, setOpenLead] = useState<string | null>(params.get("lead"));

  const metricFiltered = useMemo(() => {
    if (metric === "all") return rows;
    return rows.filter((r) => {
      switch (metric) {
        case "qualified": return r.accountStatus === "qualified";
        case "contact_ready": return r.contactReadiness === "verified";
        case "draft_ready": return r.opener?.status === "draft_ready" || r.opener?.status === "approved";
        case "contacted": return r.engagementStatus === "contacted";
        case "replied": return r.engagementStatus === "replied";
        case "meetings": return r.engagementStatus === "meeting";
      }
    });
  }, [rows, metric]);

  const filtered = useMemo(() => applyFilters(metricFiltered, filters), [metricFiltered, filters]);
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
    toast.success(`List "${name}" created. Add leads via bulk actions.`);
  };

  const handleSaveView = () => {
    if (!workspaceId) return;
    const name = window.prompt("Name this view");
    if (!name) return;
    const aug = loadLocalAug(workspaceId);
    aug.savedViews.push({ id: crypto.randomUUID(), name, filters });
    saveLocalAug(workspaceId, aug);
    toast.success(`Saved view "${name}" (local to this browser)`);
  };

  return (
    <div className="relative min-h-screen">
      <CommandBackdrop />

      <div className="max-w-[1440px] mx-auto px-6 lg:px-8 py-6 lg:py-8 space-y-5">
        {/* Header row */}
        <header className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] uppercase tracking-[0.18em] text-primary/80 font-semibold">
                Lead Operations
              </span>
              <span className="h-1 w-1 rounded-full bg-primary/60" />
              <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Command Desk
              </span>
            </div>
            <h1 className="mt-1.5 text-[28px] font-semibold text-foreground tracking-tight leading-tight">
              Lead Library
            </h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground max-w-xl leading-relaxed">
              Every account Atlas has found, researched, qualified, and prepared for outreach — one intelligent desk for your entire pipeline.
            </p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-1 text-[11px] text-primary/90">
              <Sparkles className="h-3 w-3" />
              Organized by Atlas — AI Account Analyst
            </div>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20"
                onClick={() => toast.info("Open the Add lead dialog from your CRM import flow.")}
              >
                <Plus className="h-3.5 w-3.5 mr-1 text-primary/80" /> Add lead
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20"
                onClick={() => toast.info("CSV import — coming from the Import workflow.")}
              >
                <Upload className="h-3.5 w-3.5 mr-1 text-primary/80" /> Import
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20"
                onClick={handleExportAll}
              >
                <Download className="h-3.5 w-3.5 mr-1 text-primary/80" /> Export
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-[linear-gradient(180deg,#10B981_0%,#059669_100%)] hover:brightness-110 text-white border-0 shadow-[0_10px_30px_-10px_rgba(16,185,129,0.75),inset_0_1px_0_rgba(255,255,255,0.15)]"
                onClick={handleCreateList}
              >
                <FolderPlus className="h-3.5 w-3.5 mr-1" /> Create list
              </Button>
            </div>
          </div>

          <div className="lg:col-span-4">
            <AtlasPanel rows={rows} />
          </div>
        </header>

        {/* Metric strip */}
        <MetricStrip rows={rows} active={metric} onSelect={setMetric} />

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList className="bg-[rgba(10,14,12,0.6)] backdrop-blur-xl border border-white/[0.07] p-1 h-auto rounded-xl">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))] data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)] text-xs rounded-lg px-3 py-1.5"
            >All leads</TabsTrigger>
            <TabsTrigger
              value="lists"
              className="data-[state=active]:bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))] data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)] text-xs rounded-lg px-3 py-1.5"
            >Lists</TabsTrigger>
            <TabsTrigger
              value="runs"
              className="data-[state=active]:bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))] data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)] text-xs rounded-lg px-3 py-1.5"
            >Search runs</TabsTrigger>
            <TabsTrigger
              value="activity"
              className="data-[state=active]:bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(16,185,129,0.04))] data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)] text-xs rounded-lg px-3 py-1.5"
            >Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4 space-y-3">
            <FilterBar rows={rows} filters={filters} onChange={setFilters} onSaveView={handleSaveView} />

            {isLoading ? (
              <PremiumSkeleton />
            ) : error ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200 backdrop-blur-xl">
                Lead data could not be synchronized.{" "}
                <button className="underline" onClick={() => refetch()}>Refresh</button>.
              </div>
            ) : rows.length === 0 ? (
              <AtlasEmptyState
                title="Your Lead Library is ready to fill"
                body="Ask Atlas to find accounts that match your ICP, or import a CSV to begin building the desk."
              />
            ) : filtered.length === 0 ? (
              <AtlasEmptyState
                title="No leads match this view"
                body="Adjust the filters above or clear them to see the full library."
              />
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                  <span>
                    Showing <span className="text-foreground font-medium">{filtered.length}</span> of {rows.length}
                    <span className="mx-1.5 text-white/20">·</span>
                    <span className="text-primary/90">{computeMetric(rows, metric)}</span> in {metric.replace("_", " ")}
                  </span>
                  <span className="uppercase tracking-[0.14em] text-[10px]">Live · Atlas monitoring</span>
                </div>
                <LeadTable
                  rows={filtered}
                  selected={selected}
                  onToggle={(id) => {
                    const n = new Set(selected);
                    if (n.has(id)) n.delete(id); else n.add(id);
                    setSelected(n);
                  }}
                  onToggleAll={(all) => setSelected(all ? new Set(filtered.map((r) => r.id)) : new Set())}
                  onOpen={(id) => { setOpenLead(id); params.set("lead", id); setParams(params, { replace: true }); }}
                />
                {workspaceId && (
                  <BulkActionBar workspaceId={workspaceId} selectedRows={selectedRows} onClear={() => setSelected(new Set())} />
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="lists" className="mt-4">
            <ListsTab rows={rows} onOpenList={(name) => {
              setFilters(EMPTY_FILTERS);
              setTab("all");
              toast.info(`Filtered by list "${name}" (using tag filter for now)`);
            }} />
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <SearchRunsTab rows={rows} onOpenRun={(key) => {
              setTab("all");
              toast.info(`Filtered by search run ${key}`);
            }} />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            {workspaceId && (
              <ActivityTab
                rows={rows}
                workspaceId={workspaceId}
                onOpenLead={(id) => { setOpenLead(id); params.set("lead", id); setParams(params, { replace: true }); setTab("all"); }}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <LeadDetailDrawer
        lead={currentLead}
        onClose={() => { setOpenLead(null); params.delete("lead"); setParams(params, { replace: true }); }}
        onRefresh={() => refetch()}
      />
    </div>
  );
}
