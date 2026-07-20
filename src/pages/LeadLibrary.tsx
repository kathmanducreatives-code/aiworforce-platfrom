import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, Upload, Download, FolderPlus, Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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
    // seed empty list into aug so it shows up in ListsTab metadata later
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
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-8 py-6 space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Lead Library</h1>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-xl">
              Every account Agentory has found, researched, qualified, and prepared for outreach.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="Global search…"
                className="h-8 pl-8 w-56 bg-background/60"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toast.info("Open the Add lead dialog from your CRM import flow.")}>
              <Plus className="h-3 w-3 mr-1" /> Add lead
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toast.info("CSV import — coming from the Import workflow.")}>
              <Upload className="h-3 w-3 mr-1" /> Import
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleExportAll}>
              <Download className="h-3 w-3 mr-1" /> Export
            </Button>
            <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleCreateList}>
              <FolderPlus className="h-3 w-3 mr-1" /> Create list
            </Button>
          </div>
        </header>

        {/* Metrics */}
        <MetricStrip rows={rows} active={metric} onSelect={setMetric} />

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList className="bg-card/40 border border-border/60">
            <TabsTrigger value="all" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs">All leads</TabsTrigger>
            <TabsTrigger value="lists" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs">Lists</TabsTrigger>
            <TabsTrigger value="runs" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs">Search runs</TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-xs">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4 space-y-3">
            <FilterBar rows={rows} filters={filters} onChange={setFilters} onSaveView={handleSaveView} />

            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading leads…
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
                Lead data could not be synchronized. <button className="underline" onClick={() => refetch()}>Refresh</button>.
              </div>
            ) : rows.length === 0 ? (
              <EmptyBlock title="No leads yet" body="Ask Scout to find accounts or import a CSV to begin building your Lead Library." />
            ) : filtered.length === 0 ? (
              <EmptyBlock title="No leads match these filters" body="Clear filters or adjust the selected view." />
            ) : (
              <>
                <div className="text-[11px] text-muted-foreground">
                  Showing {filtered.length} of {rows.length} · {computeMetric(rows, metric)} in {metric.replace("_", " ")}
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

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-10 text-center">
      <div className="text-sm text-foreground">{title}</div>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">{body}</p>
    </div>
  );
}
