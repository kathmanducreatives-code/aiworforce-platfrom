import { useState } from "react";
import { Sparkles, Search, Loader2, Zap, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface AISearchBarProps {
  onSearch: (query: string, mode: 'standard' | 'advanced') => void;
  isLoading?: boolean;
  loadingLabel?: string;
  placeholder?: string;
}

export const AISearchBar = ({
  onSearch,
  isLoading = false,
  loadingLabel = "Starting scrape...",
  placeholder = "E.g. Engineers in New York in software companies with more than 500 employees",
}: AISearchBarProps) => {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<'standard' | 'advanced'>('standard');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim(), mode);
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div className="text-center sm:text-left">
          <h2 className="text-2xl sm:text-3xl font-light italic text-foreground mb-1">
            Start your search with AI
          </h2>
          <p className="text-sm text-muted-foreground">
            Describe who you're looking for in plain English
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-muted/40 p-2 rounded-xl border border-border/50">
          <div className="flex items-center space-x-2">
            <Label htmlFor="search-mode" className="text-xs font-medium cursor-pointer">
              {mode === 'standard' ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Zap className="w-3.5 h-3.5" />
                  Standard
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-primary">
                  <Globe className="w-3.5 h-3.5" />
                  Advanced (Firecrawl)
                </span>
              )}
            </Label>
            <Switch
              id="search-mode"
              checked={mode === 'advanced'}
              onCheckedChange={(checked) => setMode(checked ? 'advanced' : 'standard')}
              disabled={isLoading}
            />
          </div>
          {mode === 'advanced' && (
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 animate-pulse text-[10px] py-0">
              BETA
            </Badge>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'advanced' ? "Find SaaS founders on Twitter who raised seed rounds recently..." : placeholder}
            className="h-12 sm:h-14 pl-12 pr-4 text-base bg-background/80 border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all duration-200"
            disabled={isLoading}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={isLoading || !query.trim()}
          className={`h-12 sm:h-14 px-6 sm:px-8 gap-2 rounded-xl shadow-lg transition-all duration-200 ${
            mode === 'advanced' 
              ? "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-purple-500/20" 
              : "bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-primary/20"
          } ${isLoading ? "animate-pulse" : ""}`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="hidden sm:inline">{loadingLabel}</span>
            </>
          ) : (
            <>
              {mode === 'advanced' ? <Globe className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
              <span>{mode === 'advanced' ? "Advanced Search" : "AI Search"}</span>
            </>
          )}
        </Button>
      </form>
      
      {mode === 'advanced' && (
        <p className="mt-3 text-[11px] text-center text-muted-foreground animate-in fade-in slide-in-from-top-1">
          Advanced mode uses <strong>Firecrawl Deep Search</strong> to find leads across the open web, social profiles, and news.
        </p>
      )}
    </div>
  );
};
