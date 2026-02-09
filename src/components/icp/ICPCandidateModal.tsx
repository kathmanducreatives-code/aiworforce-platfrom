import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Briefcase, Building2, CheckCircle2, MapPin, X } from "lucide-react";
import { ICPCandidate } from "@/types/icp";

interface ICPCandidateModalProps {
    candidate: ICPCandidate | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onApprove?: (candidate: ICPCandidate) => void;
}

export const ICPCandidateModal = ({ candidate, open, onOpenChange, onApprove }: ICPCandidateModalProps) => {
    if (!candidate) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col p-0 bg-[#0B0B0B] border border-[#262626] sm:rounded-xl overflow-hidden shadow-2xl">

                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b border-[#262626] bg-[#161616]">
                    <div className="flex items-center gap-5">
                        <Avatar className="w-16 h-16 border-2 border-[#00FF85]/20">
                            <AvatarImage src={candidate.avatar_url} />
                            <AvatarFallback className="bg-[#262626] text-[#00FF85] text-xl font-bold">
                                {candidate.name.charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                {candidate.name}
                                <Badge variant="outline" className="bg-[#00FF85]/10 text-[#00FF85] border-[#00FF85]/30 hover:bg-[#00FF85]/20">
                                    {candidate.match_score}% Match
                                </Badge>
                            </h2>
                            <p className="text-lg text-muted-foreground mt-1">{candidate.headline}</p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground/80">
                                <span className="flex items-center gap-1.5">
                                    <Building2 className="w-4 h-4" />
                                    {candidate.current_company}
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <MapPin className="w-4 h-4" />
                                    {candidate.location}
                                </span>
                            </div>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-white">
                        <X className="w-6 h-6" />
                    </Button>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">

                    {/* Left Column: Experience Timeline */}
                    <div className="border-r border-[#262626] flex flex-col bg-[#0B0B0B]">
                        <div className="p-4 border-b border-[#262626] bg-[#0B0B0B]/50 backdrop-blur">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Briefcase className="w-4 h-4" />
                                Career Trajectory
                            </h3>
                        </div>
                        <ScrollArea className="flex-1 p-6">
                            <div className="relative pl-6 space-y-8 border-l border-[#262626] ml-3">
                                {candidate.experience.map((exp, idx) => (
                                    <div key={idx} className="relative">
                                        <div className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 ${idx === 0 ? 'bg-[#00FF85] border-[#00FF85] shadow-[0_0_10px_rgba(0,255,133,0.4)]' : 'bg-[#161616] border-[#262626]'}`} />
                                        <div className="flex flex-col gap-1">
                                            <h4 className={`text-base font-semibold ${idx === 0 ? 'text-white' : 'text-muted-foreground'}`}>
                                                {exp.title}
                                            </h4>
                                            <div className="text-sm text-[#00FF85] font-medium">{exp.company}</div>
                                            <div className="text-xs text-muted-foreground/60 font-mono">{exp.duration}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Right Column: AI Logic DNA */}
                    <div className="flex flex-col bg-[#161616]/30">
                        <div className="p-4 border-b border-[#262626] bg-[#0B0B0B]/50 backdrop-blur">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-[#00FF85] flex items-center gap-2">
                                <Brain className="w-4 h-4" />
                                AI Logic DNA
                            </h3>
                        </div>
                        <ScrollArea className="flex-1 p-6">
                            <div className="prose prose-invert prose-sm max-w-none">
                                <div className="bg-[#161616] border border-[#262626] rounded-xl p-6 shadow-xl">
                                    <p className="text-gray-300 leading-relaxed whitespace-pre-line">
                                        {candidate.match_justification || "Analysis pending..."}
                                    </p>
                                </div>
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-[#262626] bg-[#161616] flex justify-end gap-3 shrink-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10 hover:bg-white/5">
                        Close
                    </Button>
                    <Button
                        onClick={() => onApprove?.(candidate)}
                        className="bg-[#00FF85] text-black hover:bg-[#00FF85]/90 font-bold px-8 shadow-[0_0_20px_rgba(0,255,133,0.2)]"
                    >
                        <CheckCircle2 className="w-5 h-5 mr-2" />
                        Approve & Pipeline
                    </Button>
                </div>

            </DialogContent>
        </Dialog>
    );
};
