import { motion } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    ExternalLink,
    Briefcase,
    Sparkles,
    MapPin,
    Building2,
    Eye
} from "lucide-react";
import { type LinkedInLead } from "./LeadTable";

export interface ICPLead extends LinkedInLead {
    match_score?: number;
    match_reason?: string;
    skills?: string[];
    work_history?: Array<{
        company: string;
        logo_url?: string;
        duration?: string;
    }>;
}

interface ICPLeadCardProps {
    lead: ICPLead;
    onClick: () => void;
}

export const ICPLeadCard = ({ lead, onClick }: ICPLeadCardProps) => {
    return (
        <motion.div
            whileHover={{ scale: 1.02, y: -2 }}
            transition={{ duration: 0.2 }}
            onClick={onClick}
            className="group relative w-full bg-card border border-border hover:border-primary/30 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-lg"
        >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            <div className="p-4 space-y-4 relative z-10">
                <div className="flex items-start gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                        <AvatarImage src={lead.linkedin_url ? `https://logo.clearbit.com/${new URL(lead.linkedin_url).hostname}` : undefined} />
                        <AvatarFallback className="bg-muted text-primary text-xs font-bold">
                            {lead.candidate_name.charAt(0)}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                                {lead.candidate_name}
                            </h3>
                            {lead.match_score && (
                                <span className="text-[10px] font-mono font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                                    {lead.match_score}%
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                            <span className="truncate">{lead.job_title}</span>
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/70">
                            <span className="flex items-center gap-1 truncate max-w-[100px]">
                                <Building2 className="w-3 h-3" />
                                {lead.company}
                            </span>
                            <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/40" />
                            <span className="flex items-center gap-1 truncate">
                                <MapPin className="w-3 h-3" />
                                {lead.location}
                            </span>
                        </div>
                    </div>

                    <a
                        href={lead.linkedin_url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary transition-colors p-1"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </a>
                </div>

                <div className="bg-muted/40 rounded-lg p-2.5 border border-border/50">
                    <div className="flex items-center gap-1.5 mb-1.5">
                        <Sparkles className="w-3 h-3 text-primary" />
                        <span className="text-[10px] text-primary font-medium uppercase tracking-wider">AI Signal</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {lead.match_reason || "Strong match based on current role and industry experience alignment."}
                    </p>
                </div>

                {lead.work_history && lead.work_history.length > 0 && (
                    <div className="space-y-1.5">
                        <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            Trajectory
                        </span>
                        <div className="flex items-center gap-1.5">
                            {lead.work_history.slice(0, 3).map((job, i) => (
                                <div key={i} className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden relative">
                                    <div className="absolute inset-0 bg-primary/25 w-full hover:bg-primary/45 transition-colors" />
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground/70 px-0.5">
                            {lead.work_history.slice(0, 3).map((job, i) => (
                                <span key={i} className="truncate max-w-[60px]">{job.company}</span>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                    {(lead.skills || ["Strategy", "Leadership", "Product"]).slice(0, 3).map((skill, i) => (
                        <span
                            key={i}
                            className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
                        >
                            {skill}
                        </span>
                    ))}
                </div>

                <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <Button
                        size="sm"
                        variant="secondary"
                        className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs font-semibold shadow-[var(--shadow-glow)]"
                    >
                        <Eye className="w-3 h-3 mr-1.5" />
                        View Evidence
                    </Button>
                </div>
            </div>
        </motion.div>
    );
};
