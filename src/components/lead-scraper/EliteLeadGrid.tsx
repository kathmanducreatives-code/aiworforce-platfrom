import { useState, useMemo } from "react";
import {
    ArrowUpDown,
    MoreHorizontal,
    ExternalLink,
    Mail,
    Trash2,
    Brain,
    CheckSquare,
    Square
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MatchScore } from "./MatchScore";
import { CandidateDetailModal } from "./CandidateDetailModal";
import type { LinkedInLead } from "./LeadTable"; // Temporarily importing type until we fully migrate

interface LeadWithScore extends LinkedInLead {
    match_score?: number;
}

interface EliteLeadGridProps {
    leads: LinkedInLead[];
    isLoading: boolean;
    selectedLeads: Set<string>;
    onSelectLead: (id: string, selected: boolean) => void;
    onSelectAll: (selected: boolean) => void;
    onLeadClick: (lead: LinkedInLead) => void;
    onRunDeepSearch: (lead: LinkedInLead) => void;
    onDeleteLead: (lead: LinkedInLead) => void;
    runningDeepSearchIds: Set<string>;
    suggestions?: Array<{ label: string; action: string; value?: string }>;
    onApplySuggestion?: (suggestion: { label: string; action: string; value?: string }) => void;
    targetProfileId?: string | null;
}

type SortField = "candidate_name" | "job_title" | "company" | "scraped_at" | "match_score";
type SortOrder = "asc" | "desc";

export const EliteLeadGrid = ({
    leads,
    isLoading,
    selectedLeads,
    onSelectLead,
    onSelectAll,
    onLeadClick,
    onRunDeepSearch,
    onDeleteLead,
    runningDeepSearchIds,
    suggestions = [],
    onApplySuggestion,
    targetProfileId,
}: EliteLeadGridProps) => {
    const [sortField, setSortField] = useState<SortField>("scraped_at");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

    // Mock match scores - strictly for visual demonstration as per "Elite" requirements
    // In a real app, this would come from the backend.
    // We use stable randoms based on ID to keep it consistent during renders
    const leadsWithScores = useMemo(() => {
        if (!targetProfileId) return leads;

        return leads.map(lead => {
            // Simple hash to get a consistent pseudo-random score between 60 and 98
            const hash = lead.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const score = 60 + (hash % 39);
            return { ...lead, match_score: score };
        });
    }, [leads, targetProfileId]);

    const sortedLeads = useMemo(() => {
        return [...leadsWithScores].sort((a, b) => {
            const aValue = a[sortField] || "";
            const bValue = b[sortField] || "";

            if (sortOrder === "asc") {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });
    }, [leadsWithScores, sortField, sortOrder]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortOrder("desc"); // Default to desc for most things
        }
    };

    const handleSelectAll = (checked: boolean) => {
        onSelectAll(checked);
    };

    // Modal State
    const [viewingLeadId, setViewingLeadId] = useState<string | null>(null);

    const handleOpenModal = (lead: LinkedInLead) => {
        setViewingLeadId(lead.id);
    };

    const handleCloseModal = () => {
        setViewingLeadId(null);
    };

    const viewingLeadIndex = useMemo(() => {
        if (!viewingLeadId) return -1;
        return sortedLeads.findIndex(l => l.id === viewingLeadId);
    }, [viewingLeadId, sortedLeads]);

    const activeLead = viewingLeadIndex >= 0 ? sortedLeads[viewingLeadIndex] : null;

    const handleNextLead = () => {
        if (viewingLeadIndex >= 0 && viewingLeadIndex < sortedLeads.length - 1) {
            setViewingLeadId(sortedLeads[viewingLeadIndex + 1].id);
        }
    };

    const handlePrevLead = () => {
        if (viewingLeadIndex > 0) {
            setViewingLeadId(sortedLeads[viewingLeadIndex - 1].id);
        }
    };

    if (isLoading) {
        return (
            <div className="space-y-4">
                {/* Skeleton Header */}
                <div className="h-12 w-full bg-muted/20 rounded-xl animate-pulse" />
                {/* Skeleton Rows */}
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-card/30">
                        <Skeleton className="h-5 w-5 rounded" />
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-3 w-1/4" />
                        </div>
                        <Skeleton className="h-8 w-24 rounded-full" />
                    </div>
                ))}
            </div>
        );
    }

    if (leads.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center mb-6 shadow-inner">
                    <Brain className="w-10 h-10 text-muted-foreground/50" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">No leads discovered yet</h3>
                <p className="text-muted-foreground max-w-md mb-6">
                    {suggestions.length > 0
                        ? "We found fewer results than requested. Try these optimizations:"
                        : "Use the AI Search above to find your first candidates. The elite dashboard is waiting for data."}
                </p>

                {suggestions.length > 0 && onApplySuggestion && (
                    <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                        {suggestions.map((suggestion, idx) => (
                            <Button
                                key={idx}
                                variant="outline"
                                className="bg-background/50 border-primary/20 hover:border-primary/50 text-xs gap-2"
                                onClick={() => onApplySuggestion(suggestion)}
                            >
                                <Brain className="w-3 h-3 text-primary" />
                                {suggestion.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const allSelected = leads.length > 0 && selectedLeads.size === leads.length;

    return (
        <div className="space-y-2">
            {/* Grid Header */}
            <div className={`grid ${targetProfileId
                ? "grid-cols-[auto_minmax(200px,1.2fr)_minmax(200px,1.5fr)_minmax(180px,1.5fr)_minmax(150px,1fr)_minmax(100px,0.8fr)_80px_minmax(180px,auto)]"
                : "grid-cols-[auto_minmax(200px,1.2fr)_minmax(200px,1.5fr)_minmax(180px,1.5fr)_minmax(150px,1fr)_minmax(100px,0.8fr)_minmax(180px,auto)]"
                } gap-4 items-center px-6 py-3 rounded-xl bg-card/40 backdrop-blur-sm border border-border/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 z-10 shadow-sm`}>
                <div className="flex items-center w-8">
                    <Checkbox
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                        className="border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                </div>

                <div className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1" onClick={() => toggleSort("candidate_name")}>
                    Name
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                </div>

                <div className="cursor-pointer hover:text-foreground transition-colors flex items-center gap-1" onClick={() => toggleSort("job_title")}>
                    Title
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                </div>

                <div className="hidden lg:flex cursor-pointer hover:text-foreground transition-colors items-center gap-1" onClick={() => toggleSort("company")}>
                    Company
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                </div>

                <div className="hidden xl:flex cursor-pointer hover:text-foreground transition-colors items-center gap-1">
                    Location
                </div>

                <div className="hidden 2xl:flex cursor-pointer hover:text-foreground transition-colors items-center gap-1">
                    LinkedIn
                </div>

                {targetProfileId && (
                    <div className="hidden lg:flex cursor-pointer hover:text-foreground transition-colors items-center gap-1" onClick={() => toggleSort("match_score")}>
                        Match
                        <ArrowUpDown className="w-3 h-3 opacity-50" />
                    </div>
                )}

                <div className="flex justify-end">
                    Actions
                </div>
            </div>

            {/* Grid Rows */}
            <div className="space-y-2.5">
                {sortedLeads.map((lead) => {
                    const isSelected = selectedLeads.has(lead.id);

                    return (
                        <div
                            key={lead.id}
                            onClick={(e) => {
                                // Ignore clicks on checkbox or buttons
                                if ((e.target as HTMLElement).closest('button, [role="checkbox"], a')) return;
                                // onLeadClick(lead); // Use internal modal instead
                                handleOpenModal(lead);
                            }}
                            className={`
                group relative grid ${targetProfileId
                                    ? "grid-cols-[auto_minmax(200px,1.2fr)_minmax(200px,1.5fr)_minmax(180px,1.5fr)_minmax(150px,1fr)_minmax(100px,0.8fr)_80px_minmax(180px,auto)]"
                                    : "grid-cols-[auto_minmax(200px,1.2fr)_minmax(200px,1.5fr)_minmax(180px,1.5fr)_minmax(150px,1fr)_minmax(100px,0.8fr)_minmax(180px,auto)]"
                                } gap-4 items-center px-6 py-4 rounded-xl 
                border transition-all duration-200 cursor-pointer
                ${isSelected
                                    ? "bg-primary/5 border-primary/20 shadow-md shadow-primary/5"
                                    : "bg-card/40 border-border/40 hover:bg-card/60 hover:border-border/60 hover:shadow-sm"
                                }
              `}
                        >
                            {/* Checkbox */}
                            <div className="w-8 flex items-center justify-center">
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => onSelectLead(lead.id, checked as boolean)}
                                    className={`transition-opacity duration-200 ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                />
                            </div>

                            {/* Name */}
                            <div className="min-w-0">
                                <h4 className="font-semibold text-foreground truncate text-sm">{lead.candidate_name}</h4>
                            </div>

                            {/* Title */}
                            <div className="min-w-0">
                                <div className="text-sm text-foreground/90 truncate" title={lead.job_title || ""}>
                                    {lead.job_title || "—"}
                                </div>
                            </div>

                            {/* Company */}
                            <div className="hidden lg:block min-w-0">
                                <div className="text-sm text-muted-foreground truncate" title={lead.company || ""}>
                                    {lead.company || "—"}
                                </div>
                            </div>

                            {/* Location */}
                            <div className="hidden xl:block min-w-0">
                                <div className="text-sm text-muted-foreground truncate" title={lead.location || ""}>
                                    {lead.location || "—"}
                                </div>
                            </div>

                            {/* LinkedIn URL */}
                            <div className="hidden 2xl:block min-w-0">
                                {lead.linkedin_url ? (
                                    <a
                                        href={lead.linkedin_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary/80 hover:text-primary underline text-xs truncate block"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        Profile
                                    </a>
                                ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                )}
                            </div>

                            {/* Match Score */}
                            {targetProfileId && (
                                <div className="hidden lg:flex items-center justify-center">
                                    <MatchScore score={(lead as LeadWithScore).match_score || 0} />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex justify-end ml-auto items-center gap-2 flex-nowrap shrink-0">
                                {lead.linkedin_url && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            window.open(lead.linkedin_url, '_blank');
                                        }}
                                        className="h-8 w-8 p-0 lg:w-auto lg:px-3 lg:gap-2 text-xs font-medium bg-secondary/50 hover:bg-secondary/80 text-secondary-foreground transition-colors shrink-0"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                        <span className="hidden lg:inline">LinkedIn</span>
                                    </Button>
                                )}

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRunDeepSearch(lead);
                                    }}
                                    disabled={runningDeepSearchIds.has(lead.id)}
                                    className="h-8 w-8 p-0 lg:w-auto lg:px-3 lg:gap-2 text-xs font-medium hover:bg-primary/10 hover:text-primary transition-colors shrink-0"
                                >
                                    <Brain className="w-4 h-4" />
                                    <span className="hidden lg:inline">{runningDeepSearchIds.has(lead.id) ? "Analysis..." : "Analysis"}</span>
                                </Button>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background/50">
                                            <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => onRunDeepSearch(lead)}>
                                            <Brain className="w-4 h-4 mr-2" />
                                            Run Deep Search
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        {lead.linkedin_url && (
                                            <DropdownMenuItem asChild>
                                                <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">
                                                    <ExternalLink className="w-4 h-4 mr-2" />
                                                    LinkedIn
                                                </a>
                                            </DropdownMenuItem>
                                        )}
                                        {lead.contact_email && (
                                            <DropdownMenuItem asChild>
                                                <a href={`mailto:${lead.contact_email}`}>
                                                    <Mail className="w-4 h-4 mr-2" />
                                                    Email
                                                </a>
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => onDeleteLead(lead)}
                                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                        >
                                            <Trash2 className="w-4 h-4 mr-2" />
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </div>
                    );
                })}
            </div>
            {/* Detail Modal */}
            <CandidateDetailModal
                lead={activeLead as any} // Cast for now given the extended type
                isOpen={!!activeLead}
                onClose={handleCloseModal}
                onNext={handleNextLead}
                onPrev={handlePrevLead}
                hasNext={viewingLeadIndex < sortedLeads.length - 1}
                hasPrev={viewingLeadIndex > 0}
            />
        </div>
    );
};
