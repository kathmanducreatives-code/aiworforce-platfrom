import { ReactNode, useState } from 'react';
import { Search, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface SortOption {
    label: string;
    value: string;
}

interface FilterBarProps {
    searchValue: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    sortOptions?: SortOption[];
    currentSort?: string;
    onSortChange?: (value: string) => void;
    onFilterClick?: () => void;
    filterCount?: number;
    actions?: ReactNode;
    className?: string;
}

const FilterBar = ({
    searchValue, onSearchChange, searchPlaceholder = 'Search...',
    sortOptions, currentSort, onSortChange,
    onFilterClick, filterCount = 0,
    actions, className,
}: FilterBarProps) => {
    const currentSortLabel = sortOptions?.find(o => o.value === currentSort)?.label || 'Sort';

    return (
        <div className={cn('flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-4', className)}>
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="pl-9 h-9 rounded-lg border-border bg-background text-sm"
                />
            </div>

            {/* Sort */}
            {sortOptions && onSortChange && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg border-border text-sm h-9">
                            {currentSortLabel}
                            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[150px]">
                        {sortOptions.map((option) => (
                            <DropdownMenuItem
                                key={option.value}
                                onClick={() => onSortChange(option.value)}
                                className={cn(option.value === currentSort && 'bg-primary/10 text-primary')}
                            >
                                {option.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}

            {/* Filter button */}
            {onFilterClick && (
                <Button variant="outline" size="sm" onClick={onFilterClick} className="gap-1.5 rounded-lg border-border text-sm h-9">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Filters
                    {filterCount > 0 && (
                        <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                            {filterCount}
                        </span>
                    )}
                </Button>
            )}

            {/* Extra actions slot */}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    );
};

export default FilterBar;
