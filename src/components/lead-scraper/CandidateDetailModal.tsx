import { useEffect } from "react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
    X,
    ChevronLeft,
    ChevronRight,
    MapPin,
    Linkedin,
    Mail,
    Briefcase,
    GraduationCap,
    Brain,
    Sparkles,
    Building2
} from "lucide-react";
import { LinkedInLead } from "./LeadTable";
import { MatchScore } from "./MatchScore";

// Extended type to support match score if not already in LinkedInLead
interface LeadWithScore extends LinkedInLead {
    match_score?: number;
    match_reason?: string;
    skills?: string[];
    work_history?: any[]; // Allow flexibility for now
    summary?: string;
    headline?: string;
    photo_url?: string;
}

interface CandidateDetailModalProps {
    lead: LeadWithScore | null;
    isOpen: boolean;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    hasNext: boolean;
    hasPrev: boolean;
}

export const CandidateDetailModal = ({
    lead,
    isOpen,
    onClose,
    onNext,
    onPrev,
    hasNext,
    hasPrev
}: CandidateDetailModalProps) => {

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;

            if (e.key === "ArrowRight" && hasNext) {
                onNext();
            } else if (e.key === "ArrowLeft" && hasPrev) {
                onPrev();
            } else if (e.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, hasNext, hasPrev, onNext, onPrev, onClose]);

    if (!lead) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] w-full h-[95vh] p-0 gap-0 bg-[#0B0B0B] border-[#00FF85]/20 text-foreground overflow-hidden rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8)] focus-visible:outline-none">

                {/* 1. Header: Sticky Top Bar */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0B0B0B]/95 backdrop-blur-md z-50 sticky top-0 h-[80px]">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClose}
                            className="rounded-full hover:bg-white/10 text-muted-foreground hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-3">
                                {lead.candidate_name}
                                {lead.match_score && (
                                    <Badge className="bg-[#00FF85]/10 text-[#00FF85] border-[#00FF85]/20 hover:bg-[#00FF85]/20 px-2 py-0.5 text-xs font-mono">
                                        {lead.match_score}% MATCH
                                    </Badge>
                                )}
                            </h2>
                            <p className="text-sm text-muted-foreground flex items-center gap-2">
                                <Briefcase className="w-3.5 h-3.5" />
                                {lead.job_title || "No Title"}
                                {lead.company && (
                                    <>
                                        <span className="w-1 h-1 rounded-full bg-white/20" />
                                        <span className="text-white/60">{lead.company}</span>
                                    </>
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onPrev}
                            disabled={!hasPrev}
                            className="bg-black border-white/10 text-white hover:bg-white/5 disabled:opacity-30 rounded-lg"
                        >
                            <ChevronLeft className="w-4 h-4 mr-1" />
                            Prev
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onNext}
                            disabled={!hasNext}
                            className="bg-black border-white/10 text-white hover:bg-white/5 disabled:opacity-30 rounded-lg"
                        >
                            Next
                            <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    </div>
                </div>

                {/* Body Content: 2-Col Layout */}
                <div className="flex h-[calc(95vh-80px)] overflow-hidden">

                    {/* Left Column: Profile (30%) */}
                    <div className="w-[350px] flex-shrink-0 border-r border-white/10 bg-black/20 p-6 space-y-8 overflow-y-auto">

                        {/* Avatar */}
                        <div className="flex flex-col items-center text-center animate-in slide-in-from-left-4 duration-500">
                            <div className="w-32 h-32 rounded-full border-2 border-[#00FF85]/20 p-1 mb-4 shadow-[0_0_20px_rgba(0,255,133,0.1)]">
                                {lead.photo_url ? (
                                    <img
                                        src={lead.photo_url}
                                        alt={lead.candidate_name}
                                        className="w-full h-full rounded-full object-cover bg-muted"
                                    />
                                ) : (
                                    <div className="w-full h-full rounded-full bg-muted/10 flex items-center justify-center text-muted-foreground">
                                        <span className="text-4xl font-bold">{lead.candidate_name.charAt(0)}</span>
                                    </div>
                                )}
                            </div>

                            {lead.location && (
                                <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
                                    <MapPin className="w-3.5 h-3.5" />
                                    {lead.location}
                                </div>
                            )}

                            <div className="flex gap-2 w-full mt-2">
                                {lead.linkedin_url && (
                                    <Button
                                        className="flex-1 bg-[#0077B5] hover:bg-[#0077B5]/90 text-white rounded-xl"
                                        onClick={() => window.open(lead.linkedin_url!, '_blank')}
                                    >
                                        <Linkedin className="w-4 h-4 mr-2" />
                                        LinkedIn
                                    </Button>
                                )}
                                {lead.contact_email && (
                                    <Button
                                        variant="outline"
                                        className="flex-1 border-white/10 hover:bg-white/5 text-white rounded-xl"
                                        onClick={() => window.location.href = `mailto:${lead.contact_email}`}
                                    >
                                        <Mail className="w-4 h-4 mr-2" />
                                        Email
                                    </Button>
                                )}
                            </div>
                        </div>

                        <Separator className="bg-white/10" />

                        {/* Summary / Headline */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Brain className="w-3.5 h-3.5" />
                                About
                            </h3>
                            <p className="text-sm leading-relaxed text-white/80">
                                {lead.summary || lead.headline || "No summary available."}
                            </p>
                        </div>
                    </div>

                    {/* Right Column: Intelligence (70%) */}
                    <div className="flex-1 bg-transparent p-8 overflow-y-auto">
                        <div className="max-w-4xl mx-auto space-y-10 animate-in slide-in-from-right-8 duration-500">

                            {/* 1. Why this match? */}
                            <section className="space-y-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Sparkles className="w-5 h-5 text-[#00FF85]" />
                                    <h3 className="text-lg font-semibold text-white">Why this match?</h3>
                                </div>
                                <div className="bg-[#00FF85]/5 border border-[#00FF85]/20 rounded-xl p-6 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-[#00FF85]/10 blur-[60px] rounded-full pointer-events-none" />
                                    <p className="text-base text-white/90 leading-relaxed relative z-10">
                                        {lead.match_reason ||
                                            "This candidate was selected based on their strong alignment with your required job titles and industry experience. Their profile suggests a high probability of fit for the role."}
                                    </p>
                                </div>
                            </section>

                            {/* 2. Skills Cloud */}
                            {lead.skills && lead.skills.length > 0 && (
                                <section className="space-y-4">
                                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                        <Brain className="w-5 h-5 text-purple-400" />
                                        Top Skills
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {lead.skills.slice(0, 15).map((skill, i) => (
                                            <Badge
                                                key={i}
                                                variant="secondary"
                                                className="bg-white/5 hover:bg-white/10 text-white/80 border-white/5 py-1.5 px-3 rounded-lg text-sm"
                                            >
                                                {skill}
                                            </Badge>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {/* 3. Work History Timeline */}
                            <section className="space-y-6">
                                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                    <Briefcase className="w-5 h-5 text-blue-400" />
                                    Experience
                                </h3>

                                <div className="space-y-6 relative pl-4 border-l border-white/10 ml-2">
                                    {/* Mock work history if none exists for demo */}
                                    {(lead.work_history && lead.work_history.length > 0 ? lead.work_history : [
                                        {
                                            title: lead.job_title,
                                            company: lead.company,
                                            date: "Present",
                                            description: "Current Role (Scraped data would appear here)"
                                        }
                                    ]).map((job: any, i: number) => (
                                        <div key={i} className="relative pl-6">
                                            {/* Timeline dot */}
                                            <div className="absolute -left-[21px] top-1.5 w-3 h-3 rounded-full bg-[#0B0B0B] border-2 border-white/20 group-hover:border-[#00FF85] transition-colors" />

                                            <div className="group rounded-xl p-4 hover:bg-white/5 transition-colors border border-transparent hover:border-white/5">
                                                <h4 className="text-base font-semibold text-white">{job.title}</h4>
                                                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1 mb-2">
                                                    <Building2 className="w-3.5 h-3.5" />
                                                    <span>{job.company}</span>
                                                    <span className="text-white/20">•</span>
                                                    <span>{job.date || job.duration}</span>
                                                </div>
                                                {job.description && (
                                                    <p className="text-sm text-white/60 leading-relaxed">
                                                        {job.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
