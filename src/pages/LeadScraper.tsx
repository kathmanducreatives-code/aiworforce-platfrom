import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { leadScraperApi } from "@/services/leadScraperApi";
import { sessionApi } from "@/services/sessionApi";
import { StatsCards } from "@/components/lead-scraper/StatsCards";
import { SearchForm, type SearchFormData } from "@/components/lead-scraper/SearchForm";
import { LeadTable, type LinkedInLead } from "@/components/lead-scraper/LeadTable";
import { HistoryPanel } from "@/components/lead-scraper/HistoryPanel";

export default function LeadScraper() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LinkedInLead[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingLeads, setIsFetchingLeads] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
    pendingLeads.current.push(newLead);
    
    setLeads((prev) => [newLead, ...prev]);
    
    // Debounced toast
    showToast();
  }, [showToast]);

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

  const fetchLeads = async (sessionId?: string) => {
    try {
      setIsFetchingLeads(true);
      let query = supabase
        .from("linkedin_leads")
        .select("*")
        .order("scraped_at", { ascending: false });

      if (sessionId) {
        query = query.eq("session_id", sessionId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLeads(data || []);
      if (sessionId) {
        setActiveSessionId(sessionId);
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

  const handleSubmit = async (formData: SearchFormData) => {
    try {
      setIsLoading(true);

      // Create a new scraping session
      const session = await sessionApi.createSession({
        search_criteria: formData,
        status: "processing",
      });

      console.log("Created session:", session);

      // Trigger the scraping webhook
      await leadScraperApi.scrapeLeads(formData, session.id);

      toast({
        title: "Scraping Initiated! 🚀",
        description: `Searching for up to ${formData.maxItems} candidates${formData.searchQuery ? ` matching "${formData.searchQuery}"` : ''}`,
      });

      // Update session to completed (in real implementation, this would be done by the webhook)
      setTimeout(async () => {
        await sessionApi.updateSession(session.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      }, 2000);

      setActiveSessionId(session.id);
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
    a.download = `linkedin-leads-${new Date().toISOString().split("T")[0]}.csv`;
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
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

            <Button
              onClick={() => setHistoryOpen(true)}
              variant="outline"
              className="gap-2 hover:bg-primary/5 hover:border-primary/50 transition-all w-full sm:w-auto"
              size="sm"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
              <span className="ml-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                {leads.length}
              </span>
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <StatsCards />

        {/* Search Form */}
        <div className="mb-8">
          <SearchForm onSubmit={handleSubmit} isLoading={isLoading} />
        </div>

        {/* Results Section */}
        <div className="rounded-xl border border-border/50 bg-card/50 p-4 sm:p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">Discovered Leads</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {leads.length} lead{leads.length !== 1 ? "s" : ""} found
              </p>
            </div>
          </div>

          <LeadTable
            leads={leads}
            isLoading={isFetchingLeads}
            onDownloadCSV={downloadCSV}
          />
        </div>
      </div>

      {/* History Panel */}
      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onSessionSelect={fetchLeads}
        activeSessionId={activeSessionId}
      />
    </div>
  );
}
