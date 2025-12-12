import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { leadScraperApi } from "@/services/leadScraperApi";
import { sessionApi } from "@/services/sessionApi";
import { StatsCards } from "@/components/lead-scraper/StatsCards";
import { SearchForm, type SearchFormData } from "@/components/lead-scraper/SearchForm";
import { LeadTable, type LinkedInLead } from "@/components/lead-scraper/LeadTable";
import { SavedSearches } from "@/components/lead-scraper/SavedSearches";
import { NameSearchDialog } from "@/components/lead-scraper/NameSearchDialog";

export default function LeadScraper() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LinkedInLead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingLeads, setIsFetchingLeads] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState<string | null>(null);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [pendingFormData, setPendingFormData] = useState<SearchFormData | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const lastToastTime = useRef(0);
  const pendingLeads = useRef<LinkedInLead[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);

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

      setActiveSessionId(session.id);
      setActiveSessionName(searchName);
      fetchLeads(session.id);
      setNameDialogOpen(false);
      setPendingFormData(null);
    } catch (error) {
      console.error("Error initiating scraping:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start scraping. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-background">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/3 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-cyan-500/3 rounded-full blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="h-10 w-10 rounded-xl hover:bg-primary/10 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
                LinkedIn Lead Scraper
              </h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Discover and connect with top talent
              </p>
            </div>
          </div>
        </header>

        {/* Stats Cards */}
        <StatsCards />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column - Saved Searches */}
          <aside className="lg:col-span-4 xl:col-span-3">
            <SavedSearches
              activeSessionId={activeSessionId}
              onSessionSelect={fetchLeads}
              refreshTrigger={refreshTrigger}
            />
          </aside>

          {/* Right Column - Search Form & Results */}
          <main className="lg:col-span-8 xl:col-span-9 space-y-6">
            {/* Search Form */}
            <SearchForm onSubmit={handleFormSubmit} isLoading={isLoading} />

            {/* Results Section */}
            <section className="rounded-xl border border-border bg-card p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    {activeSessionName ? activeSessionName : "All Leads"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {leads.length} lead{leads.length !== 1 ? "s" : ""} found
                    {activeSessionId && (
                      <Button
                        variant="link"
                        size="sm"
                        className="text-sm text-primary ml-2 h-auto p-0"
                        onClick={() => fetchLeads(null)}
                      >
                        View All
                      </Button>
                    )}
                  </p>
                </div>
              </div>

              <LeadTable
                leads={leads}
                isLoading={isFetchingLeads}
                onDownloadCSV={downloadCSV}
                onLeadDeleted={() => {
                  fetchLeads(activeSessionId);
                  setRefreshTrigger((prev) => prev + 1);
                }}
              />
            </section>
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