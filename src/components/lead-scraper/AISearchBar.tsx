import { useState } from "react";
import { Sparkles, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AISearchBarProps {
  onSearch: (query: string) => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <div className="w-full">
      <div className="text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-light italic text-foreground mb-2">
          Start your search with AI
        </h2>
        <p className="text-sm text-muted-foreground">
          Describe who you're looking for in plain English
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="h-12 sm:h-14 pl-12 pr-4 text-base bg-background/80 border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all duration-200"
            disabled={isLoading}
          />
        </div>
        <Button
          type="submit"
          size="lg"
          disabled={isLoading || !query.trim()}
          className={`h-12 sm:h-14 px-6 sm:px-8 gap-2 rounded-xl bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20 transition-all duration-200 ${isLoading ? "animate-pulse" : ""
            }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="hidden sm:inline">{loadingLabel}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              <span>AI Search</span>
            </>
          )}
        </Button>
      </form>
    </div>
  );
};
