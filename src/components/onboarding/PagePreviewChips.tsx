// Step 2 "What we will read" preview.
// Shows the pages Agentory intends to fetch — not a live crawl.

import { FileText, DollarSign, Layers, Users, Info, Briefcase } from 'lucide-react';

const PAGES = [
  { label: 'Homepage', icon: FileText },
  { label: 'Pricing', icon: DollarSign },
  { label: 'Features', icon: Layers },
  { label: 'About', icon: Info },
  { label: 'Customers', icon: Users },
  { label: 'Careers', icon: Briefcase },
];

export function PagePreviewChips() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">What we will read</p>
        <span className="text-[10px] uppercase tracking-[0.14em] text-primary/80">Up to 10 pages · no broad crawl</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PAGES.map(({ label, icon: Icon }) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/50 px-2.5 py-1 text-[11px] text-foreground/80"
          >
            <Icon className="h-3 w-3 text-primary/80" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
