// SignalsFilters — collapsible compact filter row for the Signals workspace.
// Contains search, secondary category (More), review status, and verified toggle.

import { useState } from 'react';
import { Search, SlidersHorizontal, ChevronDown, Check, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ReviewFilter } from '@/lib/signalReviewModel';

export type SecondaryCategory =
  | 'all'
  | 'funding'
  | 'linkedin'
  | 'comments'
  | 'workflows'
  | 'people'
  | 'saved'
  | 'reviewed'
  | 'ignored';

const SECONDARY_OPTIONS: { id: SecondaryCategory; label: string }[] = [
  { id: 'all', label: 'All categories' },
  { id: 'funding', label: 'Funding' },
  { id: 'linkedin', label: 'LinkedIn posts' },
  { id: 'comments', label: 'Comments' },
  { id: 'workflows', label: 'Workflow trends' },
  { id: 'people', label: 'Decision-makers' },
  { id: 'saved', label: 'Saved' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'ignored', label: 'Ignored' },
];

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  secondary: SecondaryCategory;
  onSecondaryChange: (v: SecondaryCategory) => void;
  reviewFilter: ReviewFilter;
  onReviewFilterChange: (v: ReviewFilter) => void;
  showUnverified: boolean;
  onShowUnverifiedChange: (v: boolean) => void;
  accentHex: string;
}

export default function SignalsFilters({
  query,
  onQueryChange,
  secondary,
  onSecondaryChange,
  showUnverified,
  onShowUnverifiedChange,
  accentHex,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/[0.05] bg-card/20">
      <div className="flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search signals…"
            className="w-full rounded-md border border-white/[0.06] bg-black/30 py-1.5 pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1"
            style={{ outlineColor: accentHex } as React.CSSProperties}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
              <span>{SECONDARY_OPTIONS.find((o) => o.id === secondary)?.label ?? 'More'}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 border-white/10 bg-[#0a0a0a]/95 p-1 backdrop-blur-xl">
            {SECONDARY_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => onSecondaryChange(o.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-white/[0.05]',
                  secondary === o.id ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {o.label}
                {secondary === o.id && <Check className="h-3.5 w-3.5" style={{ color: accentHex }} />}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        <button
          onClick={() => onShowUnverifiedChange(!showUnverified)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors',
            showUnverified
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-white/[0.06] bg-black/30 text-muted-foreground hover:text-foreground',
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          {showUnverified ? 'Showing unverified' : 'Verified only'}
        </button>

        <button
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-black/30 px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.05] px-3 py-2 text-[12px] text-muted-foreground/70">
          Additional filters coming from your saved views live here — for now, use the search and category selector above.
        </div>
      )}
    </div>
  );
}
