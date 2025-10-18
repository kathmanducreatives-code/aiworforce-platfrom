import { useEffect, useState } from "react";
import { Clock, Search, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface SearchCriteria {
  jobTitle?: string;
  location?: string;
  keywords?: string[];
  experienceLevel?: string;
  industry?: string;
  numberOfLeads?: number;
}

interface ScrapingSession {
  id: string;
  search_criteria: SearchCriteria;
  total_leads: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionSelect: (sessionId: string) => void;
  activeSessionId: string | null;
}

export const HistoryPanel = ({
  open,
  onOpenChange,
  onSessionSelect,
  activeSessionId,
}: HistoryPanelProps) => {
  const [sessions, setSessions] = useState<ScrapingSession[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchSessions();
      
      // Set up realtime subscription
      const channel = supabase
        .channel("sessions-updates")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "scraping_sessions" },
          () => fetchSessions()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [open]);

  const fetchSessions = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("scraping_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setSessions(data as ScrapingSession[]);
    }
    setIsLoading(false);
  };

  const handleClearHistory = async () => {
    const { error } = await supabase
      .from("scraping_sessions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all

    if (!error) {
      setSessions([]);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-destructive" />;
      case "processing":
        return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const filteredSessions = sessions.filter((session) => {
    const criteria = session.search_criteria;
    return (
      criteria.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      criteria.location?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      criteria.industry?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[500px] bg-background/95 backdrop-blur-xl border-border/50">
        <SheetHeader>
          <SheetTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-cyan-500 bg-clip-text text-transparent">
            Scraping History
          </SheetTitle>
          <SheetDescription>
            View and load previous scraping sessions
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search sessions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={handleClearHistory}
              title="Clear all history"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-240px)]">
            <div className="space-y-3 pr-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Clock className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No history yet</h3>
                  <p className="text-sm text-muted-foreground">
                    Your scraping sessions will appear here
                  </p>
                </div>
              ) : (
                filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => {
                      onSessionSelect(session.id);
                      onOpenChange(false);
                    }}
                    className={`p-4 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
                      activeSessionId === session.id
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-border/50 hover:border-primary/50 bg-card/50"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h4 className="font-semibold text-sm mb-1">
                          {session.search_criteria.jobTitle || "Untitled Search"}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                          {session.search_criteria.location || "No location"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(session.status)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="secondary" className="text-xs">
                        {session.total_leads} leads
                      </Badge>
                      {session.search_criteria.experienceLevel && (
                        <Badge variant="outline" className="text-xs capitalize">
                          {session.search_criteria.experienceLevel}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {formatDistanceToNow(new Date(session.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                      <span className="capitalize">{session.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};
