import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon, PanelLeftClose, PanelLeft, Users, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { leadScraperApi } from "@/services/leadScraperApi";
import { LeadTable, type LinkedInLead } from "@/components/lead-scraper/LeadTable";
import { SavedSearches } from "@/components/lead-scraper/SavedSearches";
import { NameSearchDialog } from "@/components/lead-scraper/NameSearchDialog";
import { ScrapingLoadingState } from "@/components/lead-scraper/ScrapingLoadingState";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FiltersSidebar, type FilterState } from "@/components/lead-scraper/FiltersSidebar";
import { AISearchBar } from "@/components/lead-scraper/AISearchBar";
import { RecentSearches } from "@/components/lead-scraper/RecentSearches";

const defaultFilters: FilterState = {
  skipOwned: false,
  jobTitles: [],
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [pendingSearchData, setPendingSearchData] = useState<{ filters: FilterState; query?: string } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showFiltersSidebar, setShowFiltersSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState("search");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
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

  const handleAISearch = (query: string) => {
    setPendingSearchData({ filters, query });
    setNameDialogOpen(true);
  };

  const handleApplyFilters = () => {
    setPendingSearchData({ filters });
    setNameDialogOpen(true);
  };

  const handleStartScraping = async (searchName: string) => {
    if (!pendingSearchData) return;

    try {
      setIsLoading(true);

      const formData = {
        currentCompanies: pendingSearchData.filters.companies,
        currentJobTitles: pendingSearchData.filters.jobTitles,
        locations: pendingSearchData.filters.locations,
        maxItems: pendingSearchData.filters.maxResults,
        searchQuery: pendingSearchData.query || pendingSearchData.filters.keywords.join(" "),
      };

      const { data: session, error: sessionError } = await supabase
        .from("scraping_sessions")
        .insert({
          search_criteria: formData as any,
          status: "processing",
          total_leads: 0,
          name: searchName,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      await leadScraperApi.scrapeLeads(formData, session.id);

      toast({
        title: "Scraping Initiated! 🚀",
        description: `Searching for up to ${formData.maxItems} candidates. Results will be saved in "${searchName}"`,
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
      setActiveSessionName(searchName);
      setLeads([]);
      setIsScrapingActive(true);
      setNameDialogOpen(false);
      setPendingSearchData(null);
      setActiveTab("leads");
      
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
      }
      scrapingTimeoutRef.current = setTimeout(() => {
        setIsScrapingActive(false);
      }, 180000);
      
    } catch (error) {
      console.error("Error initiating scraping:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start scraping. Please try again.",
      });
      setIsScrapingActive(false);
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    return () => {
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
      }
    };
  }, []);

  const downloadCSV = () => {
    if (leads.length === 0) {
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
      ...leads.map((lead) =>
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
    a.download = `linkedin-leads-${activeSessionName || "all"}-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export Successful",
      description: `${leads.length} leads exported to CSV`,
    });
  };

  // Mobile: Sheet for Filters
  const FiltersMobile = () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <PanelLeft className="w-4 h-4" />
          Filters
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="h-[calc(100vh-80px)]">
          <FiltersSidebar
            filters={filters}
            onFiltersChange={setFilters}
            onApplyFilters={handleApplyFilters}
            isLoading={isLoading}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="w-full min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-40">
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
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
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
              {isMobile ? (
                <FiltersMobile />
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFiltersSidebar(!showFiltersSidebar)}
                  className="gap-2 h-9 transition-all duration-200 hover:bg-primary/5 hover:border-primary/30"
                >
                  {showFiltersSidebar ? (
                    <>
                      <PanelLeftClose className="w-4 h-4" />
                      <span className="hidden lg:inline">Hide Filters</span>
                    </>
                  ) : (
                    <>
                      <PanelLeft className="w-4 h-4" />
                      <span className="hidden lg:inline">Show Filters</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        <div className="flex gap-4 lg:gap-6">
          {/* Left Sidebar - Filters */}
          {!isMobile && showFiltersSidebar && (
            <aside className="w-72 xl:w-80 shrink-0 transition-all duration-300 ease-in-out">
              <div className="sticky top-24 h-[calc(100vh-8rem)]">
                <FiltersSidebar
                  filters={filters}
                  onFiltersChange={setFilters}
                  onApplyFilters={handleApplyFilters}
                  isLoading={isLoading}
                />
              </div>
            </aside>
          )}

          {/* Main Content Area */}
          <main className="flex-1 min-w-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-6 h-11 p-1 bg-muted/50">
                <TabsTrigger value="search" className="gap-2 px-4">
                  <SearchIcon className="w-4 h-4" />
                  Lead Scraper
                </TabsTrigger>
                <TabsTrigger value="leads" className="gap-2 px-4">
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
                <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 lg:p-8 shadow-sm">
                  <AISearchBar
                    onSearch={handleAISearch}
                    isLoading={isLoading}
                  />
                </div>
              </TabsContent>

              {/* Leads Tab */}
              <TabsContent value="leads" className="space-y-6 mt-0">
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

                <section className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden">
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
                  </div>

                  <div className="p-4 lg:p-6">
                    {isScrapingActive && leads.length === 0 ? (
                      <ScrapingLoadingState
                        searchName={activeSessionName || undefined}
                        leadsFound={leads.length}
                        onCancel={() => setIsScrapingActive(false)}
                      />
                    ) : (
                      <LeadTable
                        leads={leads}
                        isLoading={isFetchingLeads}
                        onDownloadCSV={downloadCSV}
                        onLeadDeleted={() => {
                          fetchLeads(activeSessionId);
                          setRefreshTrigger((prev) => prev + 1);
                        }}
                      />
                    )}
                  </div>
                </section>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </div>

      {/* Name Search Dialog */}
      <NameSearchDialog
        open={nameDialogOpen}
        onOpenChange={setNameDialogOpen}
        onConfirm={handleStartScraping}
        isLoading={isLoading}
      />
    </div>
  );
}
