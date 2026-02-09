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
            className="group relative w-full bg-[#161616] border border-[#262626] hover:border-[#00FF85]/30 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-[0_0_20px_rgba(0,255,133,0.1)] flex flex-col"
        >
            {/* Emerald Glow on Hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#00FF85]/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="p-5 flex flex-col h-full relative z-10">
                {/* Header */}
                <div className="flex items-start gap-4 mb-4">
                    <Avatar className="w-12 h-12 border-2 border-[#262626] group-hover:border-[#00FF85]/50 transition-colors">
                        <AvatarImage src={candidate.avatar_url} />
                        <AvatarFallback className="bg-[#262626] text-[#00FF85] font-bold">
                            {candidate.name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-white truncate group-hover:text-[#00FF85] transition-colors">
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
                    {/* Match Score Badge */}
                    {candidate.match_score && (() => {
                        const score = candidate.match_score;
                        let badge = { emoji: '🤔', color: 'text-gray-400 bg-gray-500/10 border-gray-500/50 shadow-[0_0_10px_rgba(156,163,175,0.2)]' };

                        if (score >= 75) badge = { emoji: '💪', color: 'text-[#00FF85] bg-[#00FF85]/10 border-[#00FF85] shadow-[0_0_20px_rgba(0,255,133,0.4)]' };
                        else if (score >= 60) badge = { emoji: '👍', color: 'text-blue-400 bg-blue-500/10 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.2)]' };
                        else if (score >= 50) badge = { emoji: '👌', color: 'text-purple-400 bg-purple-500/10 border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.2)]' };
                        else if (score >= 40) badge = { emoji: '🤝', color: 'text-orange-400 bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/50 shadow-[0_0_10px_rgba(249,115,22,0.2)]' };

                        return (
                            <div className={`px-2 py-1 rounded-md text-xs font-bold border flex items-center gap-1.5 ${badge.color}`}>
                                <span>{badge.emoji}</span>
                                <span>{score}%</span>
                            </div>
                        );
                    })()}
                </div>

                {/* Experience Pulse (Middle) */}
                <div className="flex-1 mb-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-mono">Experience Pulse</p>
                    <div className="relative pl-3 border-l-2 border-[#262626] space-y-3">
                        {candidate.experience.slice(0, 2).map((exp, idx) => (
                            <div key={idx} className="relative">
                                {/* Dot */}
                                <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-[#00FF85]/50 group-hover:bg-[#00FF85] transition-colors shadow-[0_0_5px_rgba(0,255,133,0.3)]" />
                                <div className="text-xs font-medium text-white">{exp.company}</div>
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

                {/* Footer Action */}
                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between">
                    <span className="text-[10px] font-mono text-muted-foreground group-hover:text-[#00FF85]/70 transition-colors">
                        Click for Evidence DNA
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[#00FF85] hover:text-[#00FF85] hover:bg-[#00FF85]/10 rounded-lg group/btn"
                    >
                        <Eye className="w-3 h-3 mr-1.5" />
                        View Evidence
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};
