import { Dialog, DialogContent } from "@/components/ui/dialog";
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
            <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col p-0 bg-background border border-border sm:rounded-xl overflow-hidden shadow-2xl">

                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b border-border bg-card">
                    <div className="flex items-center gap-5">
                        <Avatar className="w-16 h-16 border-2 border-primary/20">
                            <AvatarImage src={candidate.avatar_url} />
                            <AvatarFallback className="bg-muted text-primary text-xl font-bold">
                                {candidate.name.charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
                                {candidate.name}
                                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/20">
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
                    <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} className="text-muted-foreground hover:text-foreground">
                        <X className="w-6 h-6" />
                    </Button>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">

                    {/* Left Column: Experience Timeline */}
                    <div className="border-r border-border flex flex-col bg-background">
                        <div className="p-4 border-b border-border bg-card/60 backdrop-blur">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Briefcase className="w-4 h-4" />
                                Career Trajectory
                            </h3>
                        </div>
                        <ScrollArea className="flex-1 p-6">
                            <div className="relative pl-6 space-y-8 border-l border-border ml-3">
                                {candidate.experience.map((exp, idx) => (
                                    <div key={idx} className="relative">
                                        <div className={`absolute -left-[31px] top-1 w-4 h-4 rounded-full border-2 ${idx === 0 ? 'bg-primary border-primary shadow-[var(--shadow-glow)]' : 'bg-card border-border'}`} />
                                        <div className="flex flex-col gap-1">
                                            <h4 className={`text-base font-semibold ${idx === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                                                {exp.title}
                                            </h4>
                                            <div className="text-sm text-primary font-medium">{exp.company}</div>
                                            <div className="text-xs text-muted-foreground/60 font-mono">{exp.duration}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Right Column: AI Logic DNA */}
                    <div className="flex flex-col bg-card/30">
                        <div className="p-4 border-b border-border bg-card/60 backdrop-blur">
                            <h3 className="text-sm font-semibold uppercase tracking-wider text-primary flex items-center gap-2">
                                <Brain className="w-4 h-4" />
                                AI Logic DNA
                            </h3>
                        </div>
                        <ScrollArea className="flex-1 p-6">
                            <div className="prose prose-invert prose-sm max-w-none">
                                <div className="bg-card border border-border rounded-xl p-6 shadow-xl">
                                    <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                                        {candidate.match_justification || "Analysis pending..."}
                                    </p>
                                </div>
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-border bg-card flex justify-end gap-3 shrink-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border hover:bg-muted">
                        Close
                    </Button>
                    <Button
                        onClick={() => onApprove?.(candidate)}
                        className="bg-primary text-primary-foreground hover:bg-primary/90 font-bold px-8 shadow-[var(--shadow-glow)]"
                    >
                        <CheckCircle2 className="w-5 h-5 mr-2" />
                        Approve & Pipeline
                    </Button>
                </div>

            </DialogContent>
        </Dialog>
    );
};
