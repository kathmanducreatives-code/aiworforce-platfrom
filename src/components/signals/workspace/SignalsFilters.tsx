// SignalsFilters — search, category, review status and verification, all of which FILTER
// (Signals recovery): categories and review statuses come from the shared presenter
// (lib/signalCardView.ts), the same one the tabs and counters use. No placeholder controls.

import { useState } from 'react';
import { Search, SlidersHorizontal, ChevronDown, Check, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ReviewFilter, SignalCategoryFilter } from '@/lib/signalCardView';
import { GLASS_CHIP, GLASS_INPUT, GLASS_PANEL } from '@/components/layout/workspaceStyles';

/** Kept as the page's name for the category filter. */
export type SecondaryCategory = SignalCategoryFilter;

const CATEGORY_OPTIONS: { id: SignalCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All categories' },
  { id: 'hiring', label: 'Hiring' },
  { id: 'expansion', label: 'Expansion' },
  { id: 'funding', label: 'Funding' },
  { id: 'leadership', label: 'Leadership changes' },
  { id: 'technology', label: 'Technology adoption' },
  { id: 'launch', label: 'Product launches' },
  { id: 'competitor', label: 'Competitor moves' },
  { id: 'linkedin', label: 'LinkedIn activity' },
  { id: 'comments', label: 'Comments' },
  { id: 'workflows', label: 'Workflow trends' },
  { id: 'people', label: 'Decision-makers' },
];

const REVIEW_OPTIONS: { id: ReviewFilter; label: string }[] = [
  { id: 'all', label: 'All (hide ignored)' },
  { id: 'unreviewed', label: 'Not reviewed' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'saved', label: 'Saved' },
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
  query, onQueryChange, secondary, onSecondaryChange, reviewFilter, onReviewFilterChange,
  showUnverified, onShowUnverifiedChange, accentHex,
}: Props) {
  const [expanded, setExpanded] = useState(reviewFilter !== 'all');

  return (
    <div className={cn('rounded-xl', GLASS_PANEL)}>
      <div className="flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search signals, companies, sources…"
            aria-label="Search signals"
            className={cn('h-8 w-full rounded-lg py-1.5 pl-8 pr-3 text-[13px]', GLASS_INPUT)}
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <button className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px]', GLASS_CHIP)} aria-label="Category">
              <span>{CATEGORY_OPTIONS.find((o) => o.id === secondary)?.label ?? 'All categories'}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            {CATEGORY_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => onSecondaryChange(o.id)}
                className={cn(
                  'ag-menu-item flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--ag-fill-hover)]',
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
          aria-pressed={showUnverified}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px]',
            showUnverified
              ? 'border border-amber-500/35 bg-amber-500/[0.08] text-amber-200 transition-colors'
              : GLASS_CHIP,
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          {showUnverified ? 'Showing unverified' : 'Verified only'}
        </button>

        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px]', GLASS_CHIP)}
          data-active={expanded || reviewFilter !== 'all' || undefined}
          aria-expanded={expanded}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Review status{reviewFilter !== 'all' ? ` · ${REVIEW_OPTIONS.find((o) => o.id === reviewFilter)?.label}` : ''}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.05] px-3 py-2" role="radiogroup" aria-label="Review status">
          {REVIEW_OPTIONS.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={reviewFilter === o.id}
              onClick={() => onReviewFilterChange(o.id)}
              className={cn('inline-flex h-7 items-center rounded-md px-2.5 text-[12px]', GLASS_CHIP)}
              style={reviewFilter === o.id ? { color: accentHex, borderColor: `${accentHex}55` } : undefined}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
