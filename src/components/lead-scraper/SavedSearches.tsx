import { useState, useEffect } from "react";
import { Folder, FolderOpen, ChevronDown, ChevronRight, Users, Trash2, Calendar, Pencil, UserMinus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState<ScrapingSession | null>(null);
  const [newName, setNewName] = useState("");

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

  const handleDeleteLeadsOnly = async (sessionId: string, leadCount: number) => {
    const { error } = await supabase
      .from("linkedin_leads")
      .delete()
      .eq("session_id", sessionId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete leads. Please try again.",
      });
      return;
    }

    toast({
      title: "Leads Deleted",
      description: `${leadCount} leads have been removed from this folder.`,
    });

    fetchSessions();
  };

  const handleRenameSession = async () => {
    if (!sessionToRename || !newName.trim()) return;

    const { error } = await supabase
      .from("scraping_sessions")
      .update({ name: newName.trim() })
      .eq("id", sessionToRename.id);

    if (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to rename folder. Please try again.",
      });
      return;
    }

    toast({
      title: "Folder Renamed",
      description: `Folder has been renamed to "${newName.trim()}".`,
    });

    setRenameDialogOpen(false);
    setSessionToRename(null);
    setNewName("");
    fetchSessions();
  };

  const openRenameDialog = (session: ScrapingSession) => {
    setSessionToRename(session);
    setNewName(getSessionName(session));
    setRenameDialogOpen(true);
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
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm h-fit transition-all duration-200 hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Folder className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Saved Searches</h2>
        </div>
        <Badge variant="secondary" className="text-xs font-medium">
          {sessions.length}
        </Badge>
      </div>

      <div className="p-3">
        <Button
          variant={!activeSessionId ? "default" : "outline"}
          size="sm"
          onClick={() => onSessionSelect(null)}
          className="w-full h-9 text-sm font-medium transition-all duration-200"
        >
          View All Leads
        </Button>
      </div>

      {unassignedCount > 0 && (
        <div className="mx-3 mb-3 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Unassigned leads</span>
          <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-600">
            {unassignedCount}
          </Badge>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <Folder className="w-6 h-6 text-muted-foreground/60" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No saved searches</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Start a search to see results here
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[280px]">
          <div className="space-y-1.5 px-3 pb-3">
            {sessions.map((session) => {
              const isExpanded = expandedSessions.has(session.id);
              const isActive = activeSessionId === session.id;
              const sessionName = getSessionName(session);

              return (
                <Collapsible
                  key={session.id}
                  open={isExpanded}
                  onOpenChange={() => toggleExpanded(session.id)}
                >
                  <div
                    className={`rounded-lg border transition-all duration-200 overflow-hidden ${
                      isActive
                        ? "border-primary/50 bg-primary/5 shadow-sm"
                        : "border-border/50 hover:border-primary/30 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      <CollapsibleTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 shrink-0 hover:bg-muted/50"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </CollapsibleTrigger>

                      <div
                        className="flex-1 min-w-0 cursor-pointer group"
                        onClick={() => onSessionSelect(session.id)}
                      >
                        <div className="flex items-center gap-2">
                          {isActive ? (
                            <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-muted-foreground group-hover:text-primary/70 shrink-0 transition-colors" />
                          )}
                          <span 
                            className="font-medium text-xs text-foreground truncate max-w-[120px]"
                            title={sessionName}
                          >
                            {sessionName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Badge 
                          variant="secondary" 
                          className="text-[10px] h-5 px-1.5 font-medium tabular-nums"
                        >
                          <Users className="w-2.5 h-2.5 mr-0.5" />
                          {session.actual_lead_count ?? session.total_leads}
                        </Badge>
                        
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Search?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{sessionName}" and all {session.actual_lead_count ?? session.total_leads} leads in it. This action cannot be undone.
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
                      <div className="px-2.5 pb-2.5 pt-0 border-t border-border/30">
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-2.5 flex-wrap">
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
                            className="text-[10px] h-4 capitalize"
                          >
                            {session.status}
                          </Badge>
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex flex-col gap-1.5 mt-2.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full h-7 text-xs"
                            onClick={() => onSessionSelect(session.id)}
                          >
                            View Leads
                          </Button>
                          
                          <div className="flex gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 h-7 text-xs gap-1"
                              onClick={() => openRenameDialog(session)}
                            >
                              <Pencil className="w-3 h-3" />
                              Rename
                            </Button>
                            
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="flex-1 h-7 text-xs gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
                                  disabled={(session.actual_lead_count ?? session.total_leads) === 0}
                                >
                                  <UserMinus className="w-3 h-3" />
                                  Clear Leads
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Clear All Leads?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete all {session.actual_lead_count ?? session.total_leads} leads from "{sessionName}". The folder will remain but will be empty. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteLeadsOnly(session.id, session.actual_lead_count ?? session.total_leads)}
                                    className="bg-amber-600 hover:bg-amber-700"
                                  >
                                    Clear Leads
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for this search folder.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="folder-name" className="text-sm font-medium">
              Folder Name
            </Label>
            <Input
              id="folder-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter folder name..."
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameSession();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameSession} disabled={!newName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};