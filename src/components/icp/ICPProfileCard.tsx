import { ICPProfile } from "@/types/icp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Edit } from "lucide-react";

interface ICPProfileCardProps {
    profile: ICPProfile;
    onDelete: (id: string) => void;
}

export const ICPProfileCard = ({ profile, onDelete }: ICPProfileCardProps) => {
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

    return (
        <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">{profile.name}</h3>
                    <p className="text-xs text-muted-foreground">
                        Created {new Date(profile.created_at).toLocaleDateString()}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                    >
                        <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(profile.id)}
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
                    {profile.industries.slice(0, 3).map((industry) => (
                        <Badge
                            key={industry}
                            variant="secondary"
                            className="text-xs bg-primary/10 text-primary border-primary/20"
                        >
                            {industry}
                        </Badge>
                    ))}
                    {profile.industries.length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                            +{profile.industries.length - 3} more
                        </Badge>
                    )}
                </div>
            </div>

            {/* Company Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Revenue</p>
                    <p className="font-medium">{profile.revenue_range.replace(/_/g, ' ')}</p>
                </div>
                <div>
                    <p className="text-xs text-muted-foreground mb-1">Size</p>
                    <p className="font-medium">{profile.company_size.replace(/_/g, ' ')}</p>
                </div>
            </div>

            {/* Tech Stack */}
            {profile.tech_stack.length > 0 && (
                <div>
                    <p className="text-xs text-muted-foreground mb-2">Tech Stack</p>
                    <div className="flex flex-wrap gap-1.5">
                        {profile.tech_stack.slice(0, 4).map((tech) => (
                            <Badge key={tech} variant="outline" className="text-xs">
                                {tech}
                            </Badge>
                        ))}
                        {profile.tech_stack.length > 4 && (
                            <Badge variant="outline" className="text-xs">
                                +{profile.tech_stack.length - 4}
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
};
