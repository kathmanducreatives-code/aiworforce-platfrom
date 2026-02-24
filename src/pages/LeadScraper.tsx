import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon, PanelLeftClose, PanelLeft, Database, Trash, Download, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { leadScraperApi } from "@/services/leadScraperApi";
import { deepSearchApi } from "@/services/deepSearchApi";
import { type LinkedInLead } from "@/components/lead-scraper/LeadTable";
import { SavedSearches } from "@/components/lead-scraper/SavedSearches";
import { ScrapingLoadingState } from "@/components/lead-scraper/ScrapingLoadingState";
import { SaveSearchCard } from "@/components/lead-scraper/SaveSearchCard";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FiltersSidebar, type FilterState } from "@/components/lead-scraper/FiltersSidebar";
import { AISearchBar } from "@/components/lead-scraper/AISearchBar";
import { RecentSearches } from "@/components/lead-scraper/RecentSearches";
import { EliteLeadGrid } from "@/components/lead-scraper/EliteLeadGrid";
import { LeadPeekSheet } from "@/components/lead-scraper/LeadPeekSheet";
import { BulkActionBar } from "@/components/lead-scraper/BulkActionBar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeepSearchResults } from "@/components/lead-scraper/DeepSearchResults";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Target, LayoutGrid, List } from "lucide-react";
import { ICPLeadsGallery } from "@/components/lead-scraper/ICPLeadsGallery";

const defaultFilters: FilterState = {
  skipOwned: false,
  jobTitles: [],
  industries: [],
  locations: [],
  companies: [],
  keywords: [],
  maxResults: 50,
};

export default function LeadScraper() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [leads, setLeads] = useState<LinkedInLead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingLeads, setIsFetchingLeads] = useState(true);
  const [isScrapingActive, setIsScrapingActive] = useState(false);
  const [isSearchInitialized, setIsSearchInitialized] = useState(false);
  const [hasStartedScraping, setHasStartedScraping] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [sessionIdForSaveCard, setSessionIdForSaveCard] = useState<string | null>(null);
  const [saveSearchDismissed, setSaveSearchDismissed] = useState(false);
  const [saveSearchCompleted, setSaveSearchCompleted] = useState(false);
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showFiltersSidebar, setShowFiltersSidebar] = useState(true);

  // New state for re-triggering search
  const [lastSearchQuery, setLastSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searchResultMetadata, setSearchResultMetadata] = useState<any>(undefined);

  const [activeTab, setActiveTab] = useState("search");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  // New States for Elite Dashboard
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());
  const [peekLead, setPeekLead] = useState<LinkedInLead | null>(null);
  const [runningDeepSearchIds, setRunningDeepSearchIds] = useState<Set<string>>(new Set());
  const [showDeepSearchResults, setShowDeepSearchResults] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'gallery'>('list');

  // ICP Targeting
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Sync sidebar state with active tab
  useEffect(() => {
    if (activeTab === 'search') {
      setShowFiltersSidebar(true);
    } else if (activeTab === 'leads') {
      // Keep sidebar open if scraping is active
      if (isScrapingActive) {
        setShowFiltersSidebar(true);
      } else {
        setShowFiltersSidebar(false);
      }
    }
  }, [activeTab, isScrapingActive]);

  const lastToastTime = useRef(0);
  const pendingLeads = useRef<LinkedInLead[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const scrapingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Debounced toast notification - max 1 per 5 seconds
  const showToast = useCallback(() => {
    const now = Date.now();
    if (now - lastToastTime.current > 5000) {
      const count = pendingLeads.current.length;
      if (count > 0) {
        toast({
          title: `${count} New Lead${count > 1 ? 's' : ''} Discovered! 🎉`,
          description: count === 1
            ? `${pendingLeads.current[0].candidate_name} has been added.`
            : `${count} candidates have been added to your leads.`,
        });
        pendingLeads.current = [];
        lastToastTime.current = now;
      }
    }
  }, []);

  // Batch lead updates
  const handleNewLead = useCallback((payload: any) => {
    const newLead = payload.new as LinkedInLead;

    const currentSessionId = activeSessionIdRef.current;
    if (!currentSessionId || newLead.session_id === currentSessionId) {
      pendingLeads.current.push(newLead);
      setLeads((prev) => [newLead, ...prev]);
      showToast();

      setIsScrapingActive(false);
      setHasStartedScraping(false);
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
        scrapingTimeoutRef.current = null;
      }
    }

    setRefreshTrigger((prev) => prev + 1);
  }, [showToast]);

  // Initial load
  useEffect(() => {
    fetchLeads();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("linkedin-leads-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "linkedin_leads" },
        handleNewLead
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [handleNewLead]);

  const fetchLeads = async (sessionId?: string | null) => {
    try {
      if (sessionId !== undefined) {
        setSessionIdForSaveCard((prev) => (sessionId !== prev ? null : prev));
      }
      setIsFetchingLeads(true);
      let query = supabase
        .from("linkedin_leads")
        .select("*")
        .order("scraped_at", { ascending: false });

      if (sessionId) {
        query = query.eq("session_id", sessionId);

        const { data: sessionData } = await supabase
          .from("scraping_sessions")
          .select("name, search_criteria")
          .eq("id", sessionId)
          .maybeSingle();

        if (sessionData) {
          setActiveSessionName(
            sessionData.name ||
            (sessionData.search_criteria as any)?.searchQuery ||
            "Untitled Search"
          );
        }
      } else {
        setActiveSessionName(null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLeads(data || []);
      setActiveSessionId(sessionId || null);

      // Switch to leads tab when viewing results
      if (sessionId) {
        setActiveTab("leads");
      }
    } catch (error) {
      console.error("Error fetching leads:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch leads. Please try again.",
      });
    } finally {
      setIsFetchingLeads(false);
    }
  };

  const hasJobRequirements =
    filters.jobTitles.length > 0 ||
    filters.locations.length > 0 ||
    filters.companies.length > 0 ||
    filters.keywords.length > 0;

  const handleApplyFilters = () => {
    // Only show toast, do not trigger search or change application state
    toast({ title: "Filters applied", description: "Enter a search query and click AI Search to start." });
    if (isMobile) setFiltersSheetOpen(false);
  };

  const handleAISearch = async (query: string, mode: 'standard' | 'advanced' = 'standard', filtersOverride?: FilterState) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // Use current filters or override if provided (for suggestions)
    const activeFilters = filtersOverride || filters;

    // Check requirements using activeFilters (only for standard mode)
    const hasRequirements =
      mode === 'advanced' ||
      activeFilters.jobTitles.length > 0 ||
      activeFilters.industries.length > 0 ||
      activeFilters.locations.length > 0 ||
      activeFilters.companies.length > 0 ||
      activeFilters.keywords.length > 0;

    if (!hasRequirements) {
      toast({
        variant: "destructive",
        title: "Job requirements needed",
        description: "Add at least one filter (job title, location, company, or keyword) to run a search.",
      });
      return;
    }

    try {
      // Start animation immediately
      setIsLoading(true);
      setIsScrapingActive(true);
      setHasStartedScraping(true);
      setLeads([]);
      setActiveTab("leads");

      setSearchResultMetadata(undefined);
      setSuggestions([]);
      setLastSearchQuery(trimmed);

      const prefix = mode === 'advanced' ? 'ADV: ' : 'AI: ';
      const autoName =
        trimmed.length > 45 ? `${prefix}${trimmed.slice(0, 45)}...` : `${prefix}${trimmed}`;

      const formData: any = {
        currentCompanies: activeFilters.companies,
        currentJobTitles: activeFilters.jobTitles,
        industries: activeFilters.industries,
        locations: activeFilters.locations,
        maxItems: activeFilters.maxResults,
        searchQuery: trimmed,
        mode: mode,
      };

      const { data: session, error: sessionError } = await supabase
        .from("scraping_sessions")
        .insert({
          search_criteria: formData as any,
          status: "processing",
          total_leads: 0,
          name: autoName,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      const result = await leadScraperApi.scrapeLeads(formData, session.id);

      if (result.results_metadata) {
        setSearchResultMetadata(result.results_metadata);
      }
      if (result.suggestions) {
        setSuggestions(result.suggestions);
      }

      toast({
        title: mode === 'advanced' ? "Deep Search Initiated! 🌎" : "Scraping Initiated! 🚀",
        description: `Searching for up to ${formData.maxItems} candidates. Results will appear in My Leads.`,
      });

      setTimeout(async () => {
        await supabase
          .from("scraping_sessions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", session.id);
      }, 2000);

      setActiveSessionId(session.id);
      setActiveSessionName(autoName);
      // setLeads([]) handled above
      // setIsScrapingActive(true) handled above
      // setHasStartedScraping(true) handled above
      setIsSearchInitialized(true);
      setSessionIdForSaveCard(session.id);
      setSaveSearchDismissed(false);
      setSaveSearchCompleted(false);
      // setActiveTab("leads") handled above

      if (scrapingTimeoutRef.current) clearTimeout(scrapingTimeoutRef.current);
      scrapingTimeoutRef.current = setTimeout(() => {
        setIsScrapingActive(false);
        setHasStartedScraping(false);
      }, 180000);
    } catch (error) {
      console.error("Error initiating scraping:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to start scraping. Please try again.",
      });
      setIsScrapingActive(false);
      setHasStartedScraping(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSearch = async (name: string) => {
    if (!activeSessionId) return;
    const { error } = await supabase
      .from("scraping_sessions")
      .update({ name })
      .eq("id", activeSessionId);
    if (error) throw error;
    setActiveSessionName(name);
    setSaveSearchCompleted(true);
    toast({ title: "Search saved", description: `Saved as "${name}"` });
  };

  const handleApplySuggestion = (suggestion: { action: string; value?: string }) => {
    let newFilters = { ...filters };
    let toastMessage = "";

    switch (suggestion.action) {
      case "remove_company_filter":
        newFilters.companies = [];
        toastMessage = "Removed company filters";
        break;
      case "expand_location":
        newFilters.locations = [];
        toastMessage = "Expanded location search";
        break;
      case "remove_keywords":
        newFilters.keywords = [];
        toastMessage = "Removed specific keywords";
        break;
      default:
        toastMessage = "Applied suggestion";
    }

    setFilters(newFilters);
    toast({ title: toastMessage, description: "Re-running search with optimizations..." });

    // Trigger re-search with the NEW filters immediately
    handleAISearch(lastSearchQuery || "Optimized Search", 'standard', newFilters);
  };

  const handleBulkDelete = async () => {
    const count = selectedLeadIds.size;
    if (count === 0) return;

    try {
      const { error } = await supabase
        .from('linkedin_leads')
        .delete()
        .in('id', Array.from(selectedLeadIds));

      if (error) throw error;

      toast({
        title: "Leads Deleted",
        description: `${count} leads have been removed.`,
      });

      setLeads(prev => prev.filter(l => !selectedLeadIds.has(l.id)));
      setSelectedLeadIds(new Set());
    } catch (error) {
      console.error('Error deleting leads:', error);
      toast({
        title: "Error",
        description: "Failed to delete selected leads",
        variant: "destructive",
      });
    }
  };

  // Re-implemented downloadCSV for bulk export support
  const downloadCSV = () => {
    // If items selected, only export those. Else export all current leads.
    const leadsToExport = selectedLeadIds.size > 0
      ? leads.filter(l => selectedLeadIds.has(l.id))
      : leads;

    if (leadsToExport.length === 0) {
      toast({
        variant: "destructive",
        title: "No Data",
        description: "There are no leads to export.",
      });
      return;
    }

    const headers = [
      "Name", "Job Title", "Company", "Location", "LinkedIn URL",
      "Email", "Experience Level", "Keywords", "Scraped At",
    ];

    const csvContent = [
      headers.join(","),
      ...leadsToExport.map((lead) =>
        [
          lead.candidate_name, lead.job_title || "", lead.company || "",
          lead.location || "", lead.linkedin_url || "", lead.contact_email || "",
          lead.experience_level || "", (lead.keywords || []).join("; "),
          new Date(lead.scraped_at).toLocaleDateString(),
        ]
          .map((field) => `"${field}"`)
          .join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linkedin-leads-${leadsToExport.length}-items.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export Successful",
      description: `${leadsToExport.length} leads exported to CSV`,
    });
  };

  const handleRunDeepSearch = async (lead: LinkedInLead) => {
    try {
      setRunningDeepSearchIds(prev => new Set(prev).add(lead.id));

      await deepSearchApi.runDeepSearch({
        candidateId: lead.id,
        candidateName: lead.candidate_name,
        linkedinUrl: lead.linkedin_url || undefined,
        company: lead.company || undefined,
      });

      toast({
        title: "Deep Search Initiated",
        description: `AI analysis started for ${lead.candidate_name}. Results will appear shortly.`,
      });

      setShowDeepSearchResults(lead.id);
    } catch (error) {
      console.error('Error running deep search:', error);
      toast({
        title: "Deep Search Failed",
        description: error instanceof Error ? error.message : "Failed to initiate deep search",
        variant: "destructive",
      });
    } finally {
      setRunningDeepSearchIds(prev => {
        const next = new Set(prev);
        next.delete(lead.id);
        return next;
      });
    }
  };

  useEffect(() => {
    return () => {
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
      }
    };
  }, []);

  // Universal Filter Sheet (Used for desktop to replace sidebar, and mobile)
  const FiltersSheet = ({
    open,
    onOpenChange,
    onApplyFilters,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onApplyFilters: () => void;
  }) => (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <PanelLeft className="w-4 h-4" />
          Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[340px] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="h-[calc(100vh-80px)]">
          <FiltersSidebar
            filters={filters}
            onFiltersChange={setFilters}
            onApplyFilters={onApplyFilters}
            isLoading={isLoading}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="w-full min-h-screen bg-background relative selection:bg-primary/20">

      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-0 w-full h-[500px] bg-gradient-to-b from-primary/5 to-transparent opacity-60" />
      </div>

      {/* Header */}
      <header className="border-b border-border/40 bg-background/60 backdrop-blur-md sticky top-0 z-40 transition-all duration-300">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
                className="h-9 w-9 rounded-xl hover:bg-primary/10 transition-all duration-200 shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20 shrink-0 ring-1 ring-white/10">
                  <SearchIcon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">
                    Lead Scraper
                  </h1>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Desktop Sidebar Toggle */}
              {!isMobile && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 hidden lg:flex"
                  onClick={() => setShowFiltersSidebar(!showFiltersSidebar)}
                >
                  {showFiltersSidebar ? (
                    <>
                      <PanelLeftClose className="w-4 h-4" />
                      Hide Filters
                    </>
                  ) : (
                    <>
                      <PanelLeft className="w-4 h-4" />
                      Show Filters
                    </>
                  )}
                </Button>
              )}

              {/* Mobile Filter Sheet Toggle */}
              <div className="lg:hidden">
                <FiltersSheet
                  open={filtersSheetOpen}
                  onOpenChange={setFiltersSheetOpen}
                  onApplyFilters={handleApplyFilters}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex gap-4 lg:gap-6">
          {/* Desktop Sidebar */}
          {!isMobile && showFiltersSidebar && (
            <aside className="hidden lg:block w-[280px] shrink-0 space-y-4 animate-in slide-in-from-left-4 duration-300">
              <div className="sticky top-24">
                <FiltersSidebar
                  filters={filters}
                  onFiltersChange={setFilters}
                  onApplyFilters={() => { }}
                  isLoading={isLoading}
                />
              </div>
            </aside>
          )}

          {/* Main Content Area */}
          <main className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-6 h-11 p-1 bg-muted/30 backdrop-blur-sm border border-border/40">
                <TabsTrigger value="search" className="gap-2 px-4 data-[state=active]:bg-background/80">
                  <SearchIcon className="w-4 h-4" />
                  Lead Scraper
                </TabsTrigger>
                <TabsTrigger value="leads" className="gap-2 px-4 data-[state=active]:bg-background/80">
                  <Database className="w-4 h-4" />
                  My Leads
                  {leads.length > 0 && (
                    <span className="ml-1 text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                      {leads.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Search Tab */}
              <TabsContent value="search" className="space-y-6 mt-0">
                {/* AI Search Bar */}
                <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-md p-4 sm:p-6 lg:p-8 shadow-sm">
                  <AISearchBar
                    onSearch={handleAISearch}
                    isLoading={isLoading}
                    loadingLabel="Starting scrape..."
                  />
                </div>
              </TabsContent>

              {/* Leads Tab */}
              <TabsContent value="leads" className="space-y-6 mt-0">
                {/* Save Search card: Rendered when search is initialized */}
                <div className={`transition-all duration-300 ease-in-out transform ${isSearchInitialized ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none absolute'}`}>
                  {isSearchInitialized &&
                    activeSessionId === sessionIdForSaveCard &&
                    !saveSearchDismissed &&
                    !saveSearchCompleted && (
                      <SaveSearchCard
                        sessionId={activeSessionId}
                        currentName={activeSessionName || ""}
                        onSave={handleSaveSearch}
                        onDismiss={() => setSaveSearchDismissed(true)}
                      />
                    )}
                </div>

                {/* Saved & Recent Searches */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                  <SavedSearches
                    activeSessionId={activeSessionId}
                    onSessionSelect={fetchLeads}
                    refreshTrigger={refreshTrigger}
                  />
                  <RecentSearches
                    onSearchSelect={fetchLeads}
                    refreshTrigger={refreshTrigger}
                    limit={5}
                  />
                </div>

                <section className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden min-h-[500px]">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 lg:p-6 border-b border-border/30">
                    <div className="min-w-0">
                      <h2 className="text-lg lg:text-xl font-semibold text-foreground truncate">
                        {activeSessionName ? activeSessionName : "All Leads"}
                      </h2>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        {leads.length} lead{leads.length !== 1 ? "s" : ""} found
                        {activeSessionId && (
                          <Button
                            variant="link"
                            size="sm"
                            className="text-xs sm:text-sm text-primary ml-2 h-auto p-0 hover:underline"
                            onClick={() => fetchLeads(null)}
                          >
                            View All
                          </Button>
                        )}
                      </p>
                    </div>
                    {/* View Toggle */}
                    <div className="flex bg-muted/50 rounded-lg p-0.5 border border-border/40 shrink-0">
                      <Button
                        variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setViewMode('list')}
                      >
                        <List className="w-4 h-4" />
                      </Button>
                      <Button
                        variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setViewMode('gallery')}
                      >
                        <LayoutGrid className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="p-0">
                    {/* If gallery mode, we use full-screen overlay style or integrated style? 
                        The requirement was "Leads Gallery Page", implying full view. 
                        Let's render it within this tab for now, but it usually takes over.
                        Given the CSS of ICPLeadsGallery has min-h-screen and bg-black, it might look odd inside the card.
                        I'll adjust ICPLeadsGallery to handle container behavior or just render properly here.
                    */}
                    {isScrapingActive && leads.length === 0 ? (
                      <div className="p-6">
                        <ScrapingLoadingState
                          searchName={activeSessionName || undefined}
                          leadsFound={leads.length}
                          onCancel={() => setIsScrapingActive(false)}
                        />
                      </div>
                    ) : viewMode === 'gallery' ? (
                      <ICPLeadsGallery
                        leads={leads}
                        isLoading={isFetchingLeads}
                        onExport={downloadCSV}
                        lookalikeName={activeSessionName?.replace("AI: ", "") || "Current Search"}
                      />
                    ) : (
                      <div className="p-4 lg:p-6">
                        <EliteLeadGrid
                          leads={leads}
                          isLoading={isFetchingLeads}
                          selectedLeads={selectedLeadIds}
                          onSelectLead={(id, selected) => {
                            const next = new Set(selectedLeadIds);
                            if (selected) next.add(id);
                            else next.delete(id);
                            setSelectedLeadIds(next);
                          }}
                          onSelectAll={(selected) => {
                            if (selected) setSelectedLeadIds(new Set(leads.map(l => l.id)));
                            else setSelectedLeadIds(new Set());
                          }}
                          onLeadClick={(lead) => setPeekLead(lead)}
                          onRunDeepSearch={handleRunDeepSearch}
                          onDeleteLead={(lead) => {
                            // Single delete still uses direct toast/logic here or reuse bulk
                            // For simplicity, we can just trigger a single delete confirm.
                            // But to match prop, let's just reuse our local delete logic if needed, 
                            // or for now just select it and show bulk. 
                            // Actually, let's implement single delete confirm in the grid or here.
                            // Grid has dropdown, so let's handle it.
                            if (window.confirm(`Delete ${lead.candidate_name}?`)) {
                              // Quick hack for single delete using bulk logic
                              const s = new Set([lead.id]);
                              setSelectedLeadIds(s);
                              // Wait a tick for state then delete? No, easier to just call delete directly.
                              // But my handleBulkDelete uses selectedLeadIds state.
                              // Let's just create a helper for single delete.
                              (async () => {
                                const { error } = await supabase.from('linkedin_leads').delete().eq('id', lead.id);
                                if (!error) {
                                  toast({ title: "Deleted", description: "Lead removed." });
                                  setLeads(prev => prev.filter(l => l.id !== lead.id));
                                  // remove from selection if there
                                  const next = new Set(selectedLeadIds);
                                  next.delete(lead.id);
                                  setSelectedLeadIds(next);
                                }
                              })();
                            }
                          }}
                          runningDeepSearchIds={runningDeepSearchIds}
                          suggestions={suggestions}
                          onApplySuggestion={handleApplySuggestion}
                        />
                      </div>
                    )}
                  </div>
                </section>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div >

      <LeadPeekSheet
        lead={peekLead}
        open={!!peekLead}
        onOpenChange={(open) => !open && setPeekLead(null)}
        onRunDeepSearch={handleRunDeepSearch}
        isDeepSearchRunning={peekLead ? runningDeepSearchIds.has(peekLead.id) : false}
      />

      <BulkActionBar
        selectedCount={selectedLeadIds.size}
        onClearSelection={() => setSelectedLeadIds(new Set())}
        onExport={downloadCSV}
        onDelete={handleBulkDelete}
      />

      {/* Persistent Dialog for Deep Search Results */}
      <Dialog open={!!showDeepSearchResults} onOpenChange={(open) => !open && setShowDeepSearchResults(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              Deep Search Results
            </DialogTitle>
          </DialogHeader>
          {showDeepSearchResults && (
            <DeepSearchResults candidateId={showDeepSearchResults} />
          )}
        </DialogContent>
      </Dialog>
    </div >
  );
}
