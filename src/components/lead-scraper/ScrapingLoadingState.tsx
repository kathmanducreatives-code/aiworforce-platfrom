import { useState, useEffect } from "react";
import { Loader2, Radio, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const SCRAPING_QUOTES = [
  "Scanning LinkedIn profiles for matches...",
  "Analyzing candidate data signals...",
  "Extracting professional insights...",
  "Processing network connections...",
  "Discovering potential leads...",
  "Crawling talent databases...",
  "Aggregating profile information...",
  "Matching candidates to your criteria...",
  "Evaluating experience patterns...",
  "Building your talent pipeline...",
];

interface ScrapingLoadingStateProps {
  searchName?: string;
  leadsFound?: number;
  onCancel?: () => void;
}

export function ScrapingLoadingState({
  searchName,
  leadsFound = 0,
  onCancel,
}: ScrapingLoadingStateProps) {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const [isQuoteFading, setIsQuoteFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsQuoteFading(true);
      setTimeout(() => {
        setCurrentQuoteIndex((prev) => (prev + 1) % SCRAPING_QUOTES.length);
        setIsQuoteFading(false);
      }, 300);
    }, 3500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 animate-pulse" />
      
      {/* Radar/scanning effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px]">
          <div className="absolute inset-0 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '3s' }} />
          <div className="absolute inset-8 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '3s', animationDelay: '0.5s' }} />
          <div className="absolute inset-16 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '3s', animationDelay: '1s' }} />
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center py-16 px-6">
        {/* Main loader */}
        <div className="relative mb-8">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          {/* Spinning ring */}
          <div className="w-20 h-20 rounded-full border-4 border-transparent border-t-primary animate-spin" />
          {/* Center icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Radio className="w-8 h-8 text-primary animate-pulse" />
          </div>
        </div>

        {/* Status text */}
        <div className="text-center space-y-3 mb-6">
          <h3 className="text-xl font-semibold text-foreground flex items-center gap-2 justify-center">
            <Zap className="w-5 h-5 text-primary" />
            Scraping in Progress
          </h3>
          {searchName && (
            <p className="text-sm text-muted-foreground">
              Search: <span className="font-medium text-foreground">{searchName}</span>
            </p>
          )}
        </div>

        {/* Rotating quotes */}
        <div className="h-6 flex items-center justify-center mb-6">
          <p
            className={`text-sm text-muted-foreground italic transition-opacity duration-300 ${
              isQuoteFading ? "opacity-0" : "opacity-100"
            }`}
          >
            "{SCRAPING_QUOTES[currentQuoteIndex]}"
          </p>
        </div>

        {/* Leads counter */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <span className="text-sm font-medium text-foreground">
            {leadsFound} {leadsFound === 1 ? "lead" : "leads"} found so far
          </span>
        </div>

        {/* Progress dots */}
        <div className="flex gap-1.5 mb-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary/60 animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>

        {/* Cancel button */}
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4 mr-1" />
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
