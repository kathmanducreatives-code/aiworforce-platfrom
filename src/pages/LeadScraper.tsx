import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Search as SearchIcon, PanelLeftClose, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { leadScraperApi } from "@/services/leadScraperApi";
import { StatsCards } from "@/components/lead-scraper/StatsCards";
import { SearchForm, type SearchFormData } from "@/components/lead-scraper/SearchForm";
import { LeadTable, type LinkedInLead } from "@/components/lead-scraper/LeadTable";
import { SavedSearches } from "@/components/lead-scraper/SavedSearches";
import { NameSearchDialog } from "@/components/lead-scraper/NameSearchDialog";
import { ScrapingLoadingState } from "@/components/lead-scraper/ScrapingLoadingState";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const [pendingFormData, setPendingFormData] = useState<SearchFormData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSavedSearches, setShowSavedSearches] = useState(true);
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

  // Batch lead updates - uses ref to avoid dependency on activeSessionId
  const handleNewLead = useCallback((payload: any) => {
    const newLead = payload.new as LinkedInLead;
    
    // Only add to current view if it matches the active session or we're viewing all
    const currentSessionId = activeSessionIdRef.current;
    if (!currentSessionId || newLead.session_id === currentSessionId) {
      pendingLeads.current.push(newLead);
      setLeads((prev) => [newLead, ...prev]);
      showToast();
      
      // Turn off scraping loading state when first lead arrives
      setIsScrapingActive(false);
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
        scrapingTimeoutRef.current = null;
      }
    }
    
    // Refresh saved searches to update counts
    setRefreshTrigger((prev) => prev + 1);
  }, [showToast]);

  // Initial load - only runs once on mount
  useEffect(() => {
    fetchLeads();
  }, []);

  // Realtime subscription - stable dependency since handleNewLead no longer depends on activeSessionId
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
        
        // Also fetch session name
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

  const handleFormSubmit = (formData: SearchFormData) => {
    setPendingFormData(formData);
    setNameDialogOpen(true);
  };

  const handleStartScraping = async (searchName: string) => {
    if (!pendingFormData) return;

    try {
      setIsLoading(true);

      // Create a new scraping session with the name
      const { data: session, error: sessionError } = await supabase
        .from("scraping_sessions")
        .insert({
          search_criteria: pendingFormData as any,
          status: "processing",
          total_leads: 0,
          name: searchName,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      console.log("Created session:", session);

      // Trigger the scraping webhook
      await leadScraperApi.scrapeLeads(pendingFormData, session.id);

      toast({
        title: "Scraping Initiated! 🚀",
        description: `Searching for up to ${pendingFormData.maxItems} candidates. Results will be saved in "${searchName}"`,
      });

      // Update session to completed (in real implementation, this would be done by the webhook)
      setTimeout(async () => {
        await supabase
          .from("scraping_sessions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", session.id);
      }, 2000);

      // Set active session and clear current leads for fresh view
      setActiveSessionId(session.id);
      setActiveSessionName(searchName);
      setLeads([]); // Clear leads for this new session
      setIsScrapingActive(true); // Show scraping loading state
      setNameDialogOpen(false);
      setPendingFormData(null);
      
      // Safety timeout - turn off scraping state after 3 minutes if no leads arrive
      if (scrapingTimeoutRef.current) {
        clearTimeout(scrapingTimeoutRef.current);
      }
      scrapingTimeoutRef.current = setTimeout(() => {
        setIsScrapingActive(false);
      }, 180000); // 3 minutes
      
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
  
  // Cleanup timeout on unmount
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
      "Name",
      "Job Title",
      "Company",
      "Location",
      "LinkedIn URL",
      "Email",
      "Experience Level",
      "Keywords",
      "Scraped At",
    ];

    const csvContent = [
      headers.join(","),
      ...leads.map((lead) =>
        [
          lead.candidate_name,
          lead.job_title || "",
          lead.company || "",
          lead.location || "",
          lead.linkedin_url || "",
          lead.contact_email || "",
          lead.experience_level || "",
          (lead.keywords || []).join("; "),
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

  // Mobile/Tablet: Sheet for Saved Searches
  const SavedSearchesMobile = () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <PanelLeft className="w-4 h-4" />
          Saved Searches
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-80 p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle>Saved Searches</SheetTitle>
        </SheetHeader>
        <div className="p-4">
          <SavedSearches
            activeSessionId={activeSessionId}
            onSessionSelect={(id) => {
              fetchLeads(id);
            }}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[1800px] mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl hover:bg-primary/10 transition-all duration-200 shrink-0"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20 shrink-0">
                <SearchIcon className="w-5 h-5 sm:w-6 sm:h-6 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate">
                  LinkedIn Lead Scraper
                </h1>
                <p className="text-muted-foreground text-xs sm:text-sm hidden sm:block">
                  Discover and connect with top talent
                </p>
              </div>
            </div>
          </div>
          
          {/* Mobile: Show sheet trigger / Desktop: Show toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {isMobile ? (
              <SavedSearchesMobile />
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSavedSearches(!showSavedSearches)}
                className="gap-2 h-9 transition-all duration-200 hover:bg-primary/5 hover:border-primary/30"
              >
                {showSavedSearches ? (
                  <>
                    <PanelLeftClose className="w-4 h-4" />
                    <span className="hidden lg:inline">Hide Searches</span>
                  </>
                ) : (
                  <>
                    <PanelLeft className="w-4 h-4" />
                    <span className="hidden lg:inline">Show Searches</span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="mb-6">
        <StatsCards />
      </div>

      {/* Main Content - Flex Layout */}
      <div className="flex gap-4 lg:gap-6">
        {/* Left Column - Saved Searches (Desktop Only, Collapsible) */}
        {!isMobile && showSavedSearches && (
          <aside className="w-64 xl:w-72 shrink-0 transition-all duration-300 ease-in-out">
            <div className="sticky top-6">
              <SavedSearches
                activeSessionId={activeSessionId}
                onSessionSelect={fetchLeads}
                refreshTrigger={refreshTrigger}
              />
            </div>
          </aside>
        )}

        {/* Right Column - Search Form & Results */}
        <main className="flex-1 min-w-0 space-y-4 lg:space-y-6">
          {/* Search Form */}
          <SearchForm onSubmit={handleFormSubmit} isLoading={isLoading} />

          {/* Results Section */}
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
        </main>
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
