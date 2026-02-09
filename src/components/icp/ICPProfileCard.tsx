import { ICPProfile } from "@/types/icp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Edit, Check } from "lucide-react";
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

export const ICPProfileCard = ({ profile, onDelete, onClick, selected = false, onSelect, selectionMode = false }: ICPProfileCardProps) => {
    // Comprehensive null safety
    if (!profile) {
        console.error('[ICPProfileCard] Received null profile');
        return null;
    }

    const getScoreColor = (score: number) => {
        if (score >= 80) return "text-green-500";
        if (score >= 60) return "text-yellow-500";
        return "text-red-500";
    };

    const getScoreBgColor = (score: number) => {
        if (score >= 80) return "bg-green-500/10 border-green-500/20";
        if (score >= 60) return "bg-yellow-500/10 border-yellow-500/20";
        return "bg-red-500/10 border-red-500/20";
    };

    const targetScore = profile.target_score || 75;

    // Safeguard missing arrays and fields
    const industries = Array.isArray(profile.industries) ? profile.industries : [];
    const techStack = Array.isArray(profile.tech_stack) ? profile.tech_stack : [];
    const revenue = profile.revenue_range || "Unknown";
    const size = profile.company_size || "Unknown";
    const profileName = profile.name || "Untitled Session";
    const createdAt = profile.created_at || new Date().toISOString();

    const handleCardClick = (e: React.MouseEvent) => {
        // If in selection mode, toggle selection
        if (selectionMode && onSelect) {
            e.stopPropagation();
            onSelect(profile.id, !selected);
        } else if (onClick) {
            onClick();
        }
    };

    const handleCheckboxChange = (checked: boolean) => {
        if (onSelect) {
            onSelect(profile.id, checked);
        }
    };

    try {
        return (
            <div
                onClick={handleCardClick}
                className={cn(
                    "rounded-xl border bg-card/80 backdrop-blur-sm p-6 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 space-y-4 cursor-pointer relative",
                    selected ? "border-primary/60 bg-primary/5 ring-2 ring-primary/30" : "border-border/50 hover:border-primary/30"
                )}
            >
                {/* Selection Checkbox Overlay */}
                {selectionMode && (
                    <div
                        className="absolute top-4 left-4 z-10"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Checkbox
                            checked={selected}
                            onCheckedChange={handleCheckboxChange}
                            className="h-5 w-5 border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                    </div>
                )}

                {/* Selected Indicator Badge */}
                {selected && (
                    <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-primary/90 text-primary-foreground px-3 py-1 rounded-full text-xs font-semibold">
                        <Check className="h-3 w-3" />
                        Selected
                    </div>
                )}

                {/* Header */}
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold mb-1">{profileName}</h3>
                        <p className="text-xs text-muted-foreground">
                            Created {new Date(createdAt).toLocaleDateString()}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                            onClick={(e) => { e.stopPropagation(); }} /* Prevent card click */
                        >
                            <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onDelete(profile.id); }}
                            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Industries */}
                <div>
                    <p className="text-xs text-muted-foreground mb-2">Industries</p>
                    <div className="flex flex-wrap gap-1.5">
                        {industries.slice(0, 3).map((industry, idx) => (
                            <Badge
                                key={`${industry}-${idx}`}
                                variant="secondary"
                                className="text-xs bg-primary/10 text-primary border-primary/20"
                            >
                                {industry}
                            </Badge>
                        ))}
                        {industries.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                                +{industries.length - 3} more
                            </Badge>
                        )}
                        {industries.length === 0 && (
                            <span className="text-xs text-muted-foreground italic">No industries specified</span>
                        )}
                    </div>
                </div>

                {/* Company Details */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Revenue</p>
                        <p className="font-medium">{revenue.replace(/_/g, ' ')}</p>
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground mb-1">Size</p>
                        <p className="font-medium">{size.replace(/_/g, ' ')}</p>
                    </div>
                </div>

                {/* Tech Stack */}
                {techStack.length > 0 && (
                    <div>
                        <p className="text-xs text-muted-foreground mb-2">Tech Stack</p>
                        <div className="flex flex-wrap gap-1.5">
                            {techStack.slice(0, 4).map((tech, idx) => (
                                <Badge key={`${tech}-${idx}`} variant="outline" className="text-xs">
                                    {tech}
                                </Badge>
                            ))}
                            {techStack.length > 4 && (
                                <Badge variant="outline" className="text-xs">
                                    +{techStack.length - 4}
                                </Badge>
                            )}
                        </div>
                    </div>
                )}

                {/* Target Score */}
                <div className={`rounded-lg border p-3 ${getScoreBgColor(targetScore)}`}>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Target Score</span>
                        <span className={`text-2xl font-bold ${getScoreColor(targetScore)}`}>
                            {targetScore}%
                        </span>
                    </div>
                </div>
            </div>
        );
    } catch (error) {
        console.error('[ICPProfileCard] Render error:', error, 'Profile:', profile);
        return (
            <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-6">
                <p className="text-red-500 text-sm font-mono">Error rendering profile card</p>
                <p className="text-xs text-muted-foreground mt-1">ID: {profile?.id || 'unknown'}</p>
            </div>
        );
    }
};
