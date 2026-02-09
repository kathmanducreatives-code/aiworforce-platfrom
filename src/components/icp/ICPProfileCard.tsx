import { ICPProfile } from "@/types/icp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Check, Users, TrendingUp, Clock, Zap } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface ICPProfileCardProps {
    profile: ICPProfile;
    onDelete: (id: string) => void;
    onClick?: () => void;
    selected?: boolean;
    onSelect?: (id: string, selected: boolean) => void;
    selectionMode?: boolean;
}

const getStatusConfig = (status?: string) => {
    switch (status) {
        case 'completed':
        case 'SUCCEEDED':
            return { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
        case 'running':
        case 'RUNNING':
        case 'in_progress':
            return { label: 'Running', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse' };
        case 'failed':
        case 'FAILED':
            return { label: 'Failed', className: 'bg-red-500/15 text-red-400 border-red-500/30' };
        case 'draft':
            return { label: 'Draft', className: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
        default:
            return { label: 'Pending', className: 'bg-muted text-muted-foreground border-border' };
    }
};

const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-yellow-400";
    if (score >= 40) return "text-orange-400";
    return "text-muted-foreground";
};

const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
};

export const ICPProfileCard = ({ profile, onDelete, onClick, selected = false, onSelect, selectionMode = false }: ICPProfileCardProps) => {
    if (!profile) return null;

    const statusConfig = getStatusConfig(profile.status || profile.scrape_status);
    const industries = Array.isArray(profile.industry_names) && profile.industry_names.length > 0
        ? profile.industry_names
        : Array.isArray(profile.industries) ? profile.industries : [];
    const locations = Array.isArray(profile.location) ? profile.location : [];
    const candidateCount = profile.candidate_count || profile.results_count || 0;
    const avgScore = profile.avg_score || 0;
    const strongMatches = profile.strong_matches_count || 0;

    const handleCardClick = (e: React.MouseEvent) => {
        if (selectionMode && onSelect) {
            e.stopPropagation();
            onSelect(profile.id, !selected);
        } else if (onClick) {
            onClick();
        }
    };

    return (
        <div
            onClick={handleCardClick}
            className={cn(
                "group rounded-xl border bg-card/60 backdrop-blur-sm p-5 transition-all duration-300 cursor-pointer relative overflow-hidden",
                "hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30 hover:-translate-y-0.5",
                selected ? "border-primary/60 bg-primary/5 ring-2 ring-primary/30" : "border-border/50"
            )}
        >
            {/* Selection Checkbox */}
            {selectionMode && (
                <div className="absolute top-4 left-4 z-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) => onSelect?.(profile.id, !!checked)}
                        className="h-5 w-5 border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                </div>
            )}

            {/* Selected Badge */}
            {selected && (
                <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-primary/90 text-primary-foreground px-2.5 py-1 rounded-full text-xs font-semibold">
                    <Check className="h-3 w-3" />
                    Selected
                </div>
            )}

            {/* Header Row */}
            <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold truncate mb-1">{profile.name || "Untitled Session"}</h3>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 border", statusConfig.className)}>
                            {statusConfig.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(profile.created_at)}
                        </span>
                    </div>
                </div>
                {!selectionMode && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); onDelete(profile.id); }}
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2.5 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center justify-center gap-1 mb-1">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <span className="text-lg font-bold">{candidateCount}</span>
                    <p className="text-[10px] text-muted-foreground">Candidates</p>
                </div>
                <div className="text-center p-2.5 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center justify-center gap-1 mb-1">
                        <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <span className={cn("text-lg font-bold", getScoreColor(avgScore))}>{avgScore}%</span>
                    <p className="text-[10px] text-muted-foreground">Avg Match</p>
                </div>
                <div className="text-center p-2.5 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center justify-center gap-1 mb-1">
                        <Zap className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <span className="text-lg font-bold text-emerald-400">{strongMatches}</span>
                    <p className="text-[10px] text-muted-foreground">Strong</p>
                </div>
            </div>

            {/* Industries */}
            {industries.length > 0 && (
                <div className="mb-3">
                    <div className="flex flex-wrap gap-1.5">
                        {industries.slice(0, 3).map((industry, idx) => (
                            <Badge
                                key={`${industry}-${idx}`}
                                variant="secondary"
                                className="text-[10px] bg-primary/10 text-primary border-primary/20 px-2 py-0.5"
                            >
                                {typeof industry === 'string' ? industry : String(industry)}
                            </Badge>
                        ))}
                        {industries.length > 3 && (
                            <Badge variant="secondary" className="text-[10px] px-2 py-0.5">
                                +{industries.length - 3}
                            </Badge>
                        )}
                    </div>
                </div>
            )}

            {/* Company Details (only show if meaningful) */}
            {(profile.company_size || locations.length > 0) && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {profile.company_size && (
                        <span>{profile.company_size.replace(/_/g, ' ')}</span>
                    )}
                    {profile.company_size && locations.length > 0 && (
                        <span className="text-border">·</span>
                    )}
                    {locations.length > 0 && (
                        <span className="truncate">{locations.slice(0, 2).join(', ')}</span>
                    )}
                </div>
            )}
        </div>
    );
};
