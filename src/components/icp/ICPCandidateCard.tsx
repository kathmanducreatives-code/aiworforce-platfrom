import { motion } from "framer-motion";
import { ICPCandidate } from "@/types/icp";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Building2, Eye, MapPin } from "lucide-react";

interface ICPCandidateCardProps {
    candidate: ICPCandidate;
    onClick: () => void;
}

export const ICPCandidateCard = ({ candidate, onClick }: ICPCandidateCardProps) => {
    return (
        <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            transition={{ duration: 0.2 }}
            onClick={onClick}
            className="group relative w-full bg-card border border-border hover:border-primary/40 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg flex flex-col"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="p-5 flex flex-col h-full relative z-10">
                <div className="flex items-start gap-4 mb-4">
                    <Avatar className="w-12 h-12 border-2 border-border group-hover:border-primary/50 transition-colors">
                        <AvatarImage src={candidate.avatar_url} />
                        <AvatarFallback className="bg-muted text-primary font-bold">
                            {candidate.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {candidate.name}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate" title={candidate.headline}>
                            {candidate.headline}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground/80">
                            <span className="flex items-center gap-1">
                                <Building2 className="w-3 h-3" />
                                {candidate.current_company}
                            </span>
                            <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3" />
                                {candidate.location}
                            </span>
                        </div>
                    </div>
                    {candidate.match_score && (() => {
                        const score = candidate.match_score;
                        let badge = { emoji: '🤔', color: 'text-muted-foreground bg-muted/60 border-border shadow-sm' };

                        if (score >= 75) badge = { emoji: '💪', color: 'text-primary bg-primary/10 border-primary/40 shadow-[var(--shadow-glow)]' };
                        else if (score >= 60) badge = { emoji: '👍', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/40 shadow-sm' };
                        else if (score >= 50) badge = { emoji: '👌', color: 'text-amber-400 bg-amber-500/10 border-amber-500/40 shadow-sm' };
                        else if (score >= 40) badge = { emoji: '🤝', color: 'text-orange-400 bg-orange-500/10 border-orange-500/40 shadow-sm' };

                        return (
                            <div className={`px-2 py-1 rounded-md text-xs font-bold border flex items-center gap-1.5 ${badge.color}`}>
                                <span>{badge.emoji}</span>
                                <span>{score}%</span>
                            </div>
                        );
                    })()}
                </div>

                <div className="flex-1 mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-mono">Experience Pulse</p>
                    <div className="relative pl-3 border-l-2 border-border space-y-3">
                        {candidate.experience.slice(0, 2).map((exp, idx) => (
                            <div key={idx} className="relative">
                                <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-primary/50 group-hover:bg-primary transition-colors shadow-sm" />
                                <div className="text-xs font-medium text-foreground">{exp.company}</div>
                                <div className="text-[10px] text-muted-foreground">{exp.title}</div>
                            </div>
                        ))}
                        {candidate.experience.length > 2 && (
                            <div className="text-[10px] text-muted-foreground/60 pl-1">
                                +{candidate.experience.length - 2} more roles...
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-auto pt-4 border-t border-border/40 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground group-hover:text-primary/70 transition-colors">
                        Click for Evidence DNA
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-primary hover:text-primary hover:bg-primary/10 rounded-lg group/btn"
                    >
                        <Eye className="w-3 h-3 mr-1.5" />
                        View Evidence
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};
