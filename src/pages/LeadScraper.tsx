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
    
    // Only add to current view if it matches the active session or we're viewing all
    if (!activeSessionId || newLead.session_id === activeSessionId) {
      pendingLeads.current.push(newLead);
      setLeads((prev) => [newLead, ...prev]);
      showToast();
    }
    
    // Refresh saved searches to update counts
    setRefreshTrigger((prev) => prev + 1);
  }, [showToast, activeSessionId]);

  useEffect(() => {
    fetchLeads();

    // Optimized realtime subscription
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 right-20 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative container mx-auto px-4 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              className="hover:bg-primary/10 flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent">
                LinkedIn Lead Scraper
              </h1>
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                Discover and connect with top talent
              </p>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <StatsCards />

        {/* Main Layout - Two Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Left Column - Saved Searches */}
          <div className="lg:col-span-1">
            <SavedSearches
              activeSessionId={activeSessionId}
              onSessionSelect={fetchLeads}
              refreshTrigger={refreshTrigger}
            />
          </div>

          {/* Right Column - Search Form & Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search Form */}
            <SearchForm onSubmit={handleFormSubmit} isLoading={isLoading} />

            {/* Results Section */}
            <div className="rounded-xl border border-border/30 bg-card/50 backdrop-blur-sm p-4 sm:p-6 shadow-[0_0_30px_rgba(0,0,0,0.5)] hover:border-primary/30 transition-all duration-300">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-cyan-500 bg-clip-text text-transparent">
                    {activeSessionName ? activeSessionName : "All Leads"}
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    {leads.length} lead{leads.length !== 1 ? "s" : ""} found
                    {activeSessionId && (
                      <Button
                        variant="link"
                        size="sm"
                        className="text-xs text-primary ml-2 h-auto p-0"
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
            </div>
          </div>
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
