import { useState, useEffect } from "react";
import { Folder, FolderOpen, ChevronDown, ChevronRight, Users, Trash2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";

interface ScrapingSession {
  id: string;
  name: string | null;
  search_criteria: any;
  total_leads: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  actual_lead_count?: number;
}

interface SavedSearchesProps {
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string | null) => void;
  refreshTrigger?: number;
}

export const SavedSearches = ({
  activeSessionId,
  onSessionSelect,
  refreshTrigger,
}: SavedSearchesProps) => {
  const [sessions, setSessions] = useState<ScrapingSession[]>([]);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [unassignedCount, setUnassignedCount] = useState(0);

  useEffect(() => {
    fetchSessions();
    
    const sessionsChannel = supabase
      .channel("saved-searches-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scraping_sessions" },
        () => fetchSessions()
      )
      .subscribe();

    const leadsChannel = supabase
      .channel("leads-count-updates")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "linkedin_leads" },
        () => fetchSessions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionsChannel);
      supabase.removeChannel(leadsChannel);
    };
  }, [refreshTrigger]);

  const fetchSessions = async () => {
    setIsLoading(true);
    
    // Fetch sessions
    const { data: sessionsData, error: sessionsError } = await supabase
      .from("scraping_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (sessionsError || !sessionsData) {
      setIsLoading(false);
      return;
    }

    // Fetch actual lead counts per session
    const { data: leadCounts, error: leadsError } = await supabase
      .from("linkedin_leads")
      .select("session_id");

    if (!leadsError && leadCounts) {
      // Count leads per session
      const countMap: Record<string, number> = {};
      let unassigned = 0;
      
      leadCounts.forEach((lead) => {
        if (lead.session_id) {
          countMap[lead.session_id] = (countMap[lead.session_id] || 0) + 1;
        } else {
          unassigned++;
        }
      });

      setUnassignedCount(unassigned);

      // Merge counts with sessions
      const sessionsWithCounts = sessionsData.map((session) => ({
        ...session,
        actual_lead_count: countMap[session.id] || 0,
      }));

      setSessions(sessionsWithCounts as ScrapingSession[]);
    } else {
      setSessions(sessionsData as ScrapingSession[]);
    }
    
    setIsLoading(false);
  };

  const toggleExpanded = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionId)) {
        newSet.delete(sessionId);
      } else {
        newSet.add(sessionId);
      }
      return newSet;
    });
  };

  const handleDeleteSession = async (sessionId: string) => {
    // First delete all leads associated with this session
    const { error: leadsError } = await supabase
      .from("linkedin_leads")
      .delete()
      .eq("session_id", sessionId);

    if (leadsError) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete leads. Please try again.",
      });
      return;
    }

    // Then delete the session
    const { error: sessionError } = await supabase
      .from("scraping_sessions")
      .delete()
      .eq("id", sessionId);

    if (sessionError) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete search. Please try again.",
      });
      return;
    }

    toast({
      title: "Search Deleted",
      description: "The search and all its leads have been removed.",
    });

    if (activeSessionId === sessionId) {
      onSessionSelect(null);
    }
    fetchSessions();
  };

  const getSessionName = (session: ScrapingSession) => {
    if (session.name) return session.name;
    const criteria = session.search_criteria;
    if (criteria?.searchQuery) return criteria.searchQuery;
    if (criteria?.currentJobTitles?.length) return criteria.currentJobTitles[0];
    if (criteria?.locations?.length) return criteria.locations[0];
    return "Untitled Search";
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Folder className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Saved Searches</h2>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-4 h-fit">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Saved Searches</h2>
        </div>
        <Badge variant="secondary" className="text-xs">
          {sessions.length}
        </Badge>
      </div>

      <Button
        variant={!activeSessionId ? "default" : "outline"}
        size="sm"
        onClick={() => onSessionSelect(null)}
        className="w-full mb-3 h-9"
      >
        View All Leads
      </Button>

      {unassignedCount > 0 && (
        <div className="mb-4 p-2 rounded-lg border border-border bg-muted/30 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Unassigned leads</span>
          <Badge variant="outline" className="text-xs">
            {unassignedCount}
          </Badge>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Folder className="w-6 h-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No saved searches</h3>
          <p className="text-xs text-muted-foreground">
            Start a search to see results here
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[320px]">
          <div className="space-y-1.5 pr-2">
            {sessions.map((session) => {
              const isExpanded = expandedSessions.has(session.id);
              const isActive = activeSessionId === session.id;

              return (
                <Collapsible
                  key={session.id}
                  open={isExpanded}
                  onOpenChange={() => toggleExpanded(session.id)}
                >
                  <div
                    className={`rounded-lg border transition-all duration-200 ${
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 p-3">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>

                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => onSessionSelect(session.id)}
                      >
                        <div className="flex items-center gap-2">
                          {isActive ? (
                            <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium text-sm truncate text-foreground">
                            {getSessionName(session)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="secondary" className="text-xs h-6 px-2">
                          <Users className="w-3 h-3 mr-1" />
                          {session.actual_lead_count ?? session.total_leads}
                        </Badge>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Search?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{getSessionName(session)}" and all {session.actual_lead_count ?? session.total_leads} leads in it. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteSession(session.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>

                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-0 border-t border-border">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-3">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>
                              {formatDistanceToNow(new Date(session.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          <Badge
                            variant={session.status === "completed" ? "default" : "secondary"}
                            className="text-xs h-5 capitalize"
                          >
                            {session.status}
                          </Badge>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-3 h-8"
                          onClick={() => onSessionSelect(session.id)}
                        >
                          View Leads
                        </Button>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};