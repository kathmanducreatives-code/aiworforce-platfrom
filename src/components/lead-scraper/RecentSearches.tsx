import { useState, useEffect } from "react";
import { Clock, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

interface RecentSearch {
  id: string;
  name: string | null;
  search_criteria: any;
  total_leads: number;
  created_at: string;
}

interface RecentSearchesProps {
  onSearchSelect: (sessionId: string) => void;
  refreshTrigger?: number;
  limit?: number;
}

export const RecentSearches = ({
  onSearchSelect,
  refreshTrigger = 0,
  limit = 5,
}: RecentSearchesProps) => {
  const [searches, setSearches] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchRecentSearches();
  }, [refreshTrigger, limit]);

  const fetchRecentSearches = async () => {
    setIsLoading(true);
    
    const { data, error } = await supabase
      .from("scraping_sessions")
      .select("id, name, search_criteria, total_leads, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error && data) {
      setSearches(data);
    }
    
    setIsLoading(false);
  };

  const getSearchName = (search: RecentSearch) => {
    if (search.name) return search.name;
    const criteria = search.search_criteria;
    if (criteria?.searchQuery) return criteria.searchQuery;
    if (criteria?.currentJobTitles?.length) return criteria.currentJobTitles[0];
    if (criteria?.locations?.length) return criteria.locations[0];
    return "Untitled Search";
  };

  const getSearchSummary = (search: RecentSearch) => {
    const criteria = search.search_criteria;
    const parts: string[] = [];
    
    if (criteria?.currentJobTitles?.length) {
      parts.push(`${criteria.currentJobTitles.length} job title${criteria.currentJobTitles.length > 1 ? 's' : ''}`);
    }
    if (criteria?.locations?.length) {
      parts.push(`${criteria.locations.length} location${criteria.locations.length > 1 ? 's' : ''}`);
    }
    if (criteria?.currentCompanies?.length) {
      parts.push(`${criteria.currentCompanies.length} compan${criteria.currentCompanies.length > 1 ? 'ies' : 'y'}`);
    }
    
    return parts.join(' · ') || 'No filters';
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-4">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Recent Searches</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Clock className="w-4 h-4 text-primary" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Recent Searches</h3>
        </div>
        <Badge variant="secondary" className="text-xs">
          {searches.length}
        </Badge>
      </div>

      {searches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
          <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <Search className="w-5 h-5 text-muted-foreground/60" />
          </div>
          <p className="text-xs text-muted-foreground">No recent searches yet</p>
        </div>
      ) : (
        <ScrollArea className="h-[240px]">
          <div className="p-2 space-y-1">
            {searches.map((search) => (
              <Button
                key={search.id}
                variant="ghost"
                className="w-full justify-start h-auto py-3 px-3 hover:bg-muted/50 group"
                onClick={() => onSearchSelect(search.id)}
              >
                <div className="flex items-start gap-3 w-full min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Search className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-foreground truncate">
                      {getSearchName(search)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {getSearchSummary(search)}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {formatDistanceToNow(new Date(search.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                </div>
              </Button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
