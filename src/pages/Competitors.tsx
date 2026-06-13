import CompetitorMonitor from "./CompetitorMonitor";

// Competitors page — unified shell over the existing CompetitorMonitor.
// Frontend-only Firecrawl warnings are hidden in production builds (handled in dev mode only).
export default function Competitors() {
  return (
    <div className="min-h-screen bg-transparent">
      <CompetitorMonitor />
    </div>
  );
}
