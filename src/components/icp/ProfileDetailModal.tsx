import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    User, MapPin, Briefcase, GraduationCap, Linkedin, CheckCircle2, X,
    Copy, Check, Mail, Bookmark, Download, ExternalLink,
    Building2, Calendar, Sparkles
} from "lucide-react";
import { ProfileResult } from "@/types/icp";
import { cn } from "@/lib/utils";
import { ICPResponse } from "@/lib/api/icp";
import { getMatchBadge as sharedGetMatchBadge } from "@/lib/matchBadges";
import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";

interface ProfileDetailModalProps {
    profile: ProfileResult | null;
    deepSearchResult?: ICPResponse['deep_search_result'] | null;
    revealedEmail?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const ProfileDetailModal = ({ profile, deepSearchResult, revealedEmail, open, onOpenChange }: ProfileDetailModalProps) => {
    const [showEmail, setShowEmail] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);
    const [showAllSkills, setShowAllSkills] = useState(false);
    const { toast } = useToast();

    const displayEmail = profile?.email || deepSearchResult?.email || (revealedEmail !== "Not Found" ? revealedEmail : null);
    const isNotFound = revealedEmail === "Not Found" || profile?.email === "Not Found";

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        toast({ title: "Copied", description: `${label} copied to clipboard`, className: "border-primary text-primary" });
        setTimeout(() => setCopied(null), 2000);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!open) return;
            if (e.key === 'Escape') onOpenChange(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onOpenChange]);

    if (!profile) return null;

    // Generate bio if not available
    const generateBio = () => {
        // Debug logs for data issues
        console.log('Profile Data Debug:', {
            name: profile.name,
            work_history: profile.work_history,
            education: profile.education,
            work_type: typeof profile.work_history,
            edu_type: typeof profile.education,
            raw_profile: profile
        });

        if (profile.headline) return profile.headline;
        const skills = profile.top_skills?.slice(0, 3).join(', ') || 'various skills';
        const experience = profile.years_experience ? `${profile.years_experience}+ years` : 'extensive';
        return `${profile.current_title || 'Professional'} with ${experience} of experience specializing in ${skills}.`;
    };

    const categorizeSkills = () => {
        if (!profile.top_skills || profile.top_skills.length === 0) return [];
        const categories: { [key: string]: string[] } = {
            'Industry Knowledge': [],
            'Other Skills': []
        };
        profile.top_skills.forEach(skill => {
            const skillStr = typeof skill === 'string' ? skill : JSON.stringify(skill);
            const lower = skillStr.toLowerCase();
            if (lower.includes('healthcare') || lower.includes('tech') || lower.includes('finance') || lower.includes('industry') || lower.includes('oil') || lower.includes('gas')) {
                categories['Industry Knowledge'].push(skillStr);
            } else {
                categories['Other Skills'].push(skillStr);
            }
        });
        return Object.entries(categories)
            .filter(([_, skills]) => skills.length > 0)
            .map(([category, skills]) => ({ category, skills }));
    };

    const skillCategories = categorizeSkills();
    const totalSkills = profile.top_skills?.length || 0;
    const visibleSkillLimit = 12;
    const allSkills = profile.top_skills || [];

    const matchBadge = profile.similarity_score ? sharedGetMatchBadge(profile.similarity_score) : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-none h-screen p-0 m-0 fixed right-0 top-0 translate-x-0 translate-y-0 w-full sm:w-[75%] lg:w-[60%] xl:w-[52%] bg-background border-l border-border/50 text-foreground gap-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
                style={{ animation: 'slideInFromRight 0.3s ease-out' }}
            >
                {/* ── Sticky Header ── */}
                <div className="sticky top-0 z-50 bg-background/95 backdrop-blur-xl border-b border-border/50">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 top-4 text-muted-foreground hover:text-foreground hover:bg-accent/50 z-50 rounded-full"
                        onClick={() => onOpenChange(false)}
                    >
                        <X className="h-4 w-4" />
                    </Button>

                    <div className="p-6 pb-5">
                        <div className="flex items-start gap-5">
                            {/* Avatar */}
                            <div className="w-16 h-16 rounded-xl border border-border/60 bg-card overflow-hidden shadow-lg shrink-0 ring-1 ring-primary/10">
                                {profile.photo_url ? (
                                    <img src={profile.photo_url} alt={profile.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-muted/30">
                                        <User className="w-7 h-7 text-muted-foreground/40" />
                                    </div>
                                )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 pt-0.5">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <h2 className="text-xl font-bold text-foreground truncate leading-tight">{profile.name}</h2>
                                        <p className="text-sm text-muted-foreground mt-1 leading-snug">
                                            {profile.current_title}
                                            {profile.current_company && (
                                                <>
                                                    <span className="mx-1.5 text-border">·</span>
                                                    <a
                                                        href={`https://www.linkedin.com/company/${profile.current_company}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                                                    >
                                                        {profile.current_company}
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                </>
                                            )}
                                        </p>
                                    </div>

                                    {/* Match Badge */}
                                    {matchBadge && (
                                        <div className={cn(
                                            "px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold border shrink-0",
                                            matchBadge.gradient
                                        )}>
                                            <span>{matchBadge.emoji}</span>
                                            <span className="font-mono tabular-nums">{profile.similarity_score}%</span>
                                        </div>
                                    )}
                                </div>

                                {/* Meta chips */}
                                <div className="flex items-center gap-3 mt-2.5">
                                    {profile.location && (
                                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-md">
                                            <MapPin className="w-3 h-3" />
                                            {profile.location}
                                        </span>
                                    )}
                                    {profile.years_experience !== undefined && (
                                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-md">
                                            <Briefcase className="w-3 h-3" />
                                            {profile.years_experience}+ yrs
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
                        <Button size="sm" variant="outline" className="h-8 text-xs border-border/50 hover:border-primary/50 hover:text-primary rounded-lg">
                            <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                            Save
                        </Button>
                        {!displayEmail && !isNotFound && (
                            <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg">
                                <Mail className="w-3.5 h-3.5 mr-1.5" />
                                Reveal Email
                            </Button>
                        )}
                        {profile.linkedin_url && (
                            <Button
                                size="sm"
                                className="h-8 text-xs bg-[#0077b5] hover:bg-[#0077b5]/90 text-white rounded-lg"
                                onClick={() => window.open(profile.linkedin_url, '_blank')}
                            >
                                <Linkedin className="w-3.5 h-3.5 mr-1.5 fill-current" />
                                LinkedIn
                            </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 text-xs border-border/50 hover:border-border rounded-lg">
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Export
                        </Button>
                    </div>
                </div>

                {/* ── Scrollable Body ── */}
                <ScrollArea className="flex-1 h-[calc(100vh-220px)]">
                    <div className="p-6 space-y-5">

                        {/* Two-column grid: Contact + Match */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Contact Card */}
                            <div className="bg-card/60 border border-border/40 rounded-xl p-5 space-y-4">
                                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <Mail className="w-3.5 h-3.5" />
                                    Contact
                                </h3>

                                {/* Email row */}
                                <div className="flex items-center justify-between group">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                            <Mail className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Email</div>
                                            {displayEmail ? (
                                                <div className="flex items-center gap-1.5">
                                                    {profile.email_confidence && (
                                                        <div className={cn(
                                                            "w-1.5 h-1.5 rounded-full shrink-0",
                                                            profile.email_confidence === 'low' ? "bg-amber-500" :
                                                                profile.email_confidence === 'medium' ? "bg-emerald-400" : "bg-primary"
                                                        )} />
                                                    )}
                                                    <span className="text-foreground font-mono text-sm truncate">{displayEmail}</span>
                                                </div>
                                            ) : isNotFound ? (
                                                <span className="text-destructive text-sm">Not Found</span>
                                            ) : (
                                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-primary hover:bg-primary/10" onClick={() => setShowEmail(true)}>
                                                    Click to reveal
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {displayEmail && (
                                        <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity rounded-md" onClick={() => handleCopy(displayEmail, 'Email')}>
                                            {copied === 'Email' ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                        </Button>
                                    )}
                                </div>

                                {/* LinkedIn row */}
                                {profile.linkedin_url && (
                                    <div className="flex items-center justify-between group">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-[#0077b5]/10 flex items-center justify-center shrink-0">
                                                <Linkedin className="w-4 h-4 text-[#0077b5]" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">LinkedIn</div>
                                                <a href={profile.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0077b5] text-sm hover:underline truncate block max-w-[200px]">
                                                    {profile.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, '').replace(/\/$/, '')}
                                                </a>
                                            </div>
                                        </div>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity rounded-md" onClick={() => handleCopy(profile.linkedin_url!, 'LinkedIn URL')}>
                                            {copied === 'LinkedIn URL' ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                        </Button>
                                    </div>
                                )}

                                {/* Location row */}
                                {profile.location && (
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                                            <MapPin className="w-4 h-4 text-muted-foreground" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Location</div>
                                            <span className="text-foreground text-sm">{profile.location}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Match Analysis Card */}
                            {profile.match_reason && profile.similarity_score && (
                                <div className="bg-card/60 border border-primary/20 rounded-xl p-5 space-y-4">
                                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                                        Match Analysis
                                    </h3>

                                    {/* Score visual */}
                                    <div className="flex items-center gap-4">
                                        <div className="relative w-14 h-14 shrink-0">
                                            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                                                <circle cx="28" cy="28" r="24" fill="none" stroke="hsl(var(--muted))" strokeWidth="4" opacity="0.3" />
                                                <circle cx="28" cy="28" r="24" fill="none" stroke="hsl(var(--primary))" strokeWidth="4"
                                                    strokeDasharray={`${(profile.similarity_score / 100) * 150.8} 150.8`}
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-primary tabular-nums">
                                                {profile.similarity_score}
                                            </span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-foreground mb-0.5">
                                                {matchBadge?.emoji} {matchBadge?.label}
                                            </div>
                                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                                                {profile.match_reason}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* If no match reason, fill with About */}
                            {!profile.match_reason && (
                                <div className="bg-card/60 border border-border/40 rounded-xl p-5 space-y-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <User className="w-3.5 h-3.5" />
                                        About
                                    </h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                        {generateBio()}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* About section (if match_reason exists, show about separately) */}
                        {profile.match_reason && (
                            <div className="bg-card/60 border border-border/40 rounded-xl p-5 space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                    <User className="w-3.5 h-3.5" />
                                    About
                                </h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {generateBio()}
                                </p>
                            </div>
                        )}

                        {/* Skills & Expertise */}
                        {allSkills.length > 0 && (
                            <div className="bg-card/60 border border-border/40 rounded-xl p-5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                                        Skills & Expertise
                                    </h3>
                                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">{totalSkills} skills</span>
                                </div>

                                {skillCategories.map(({ category, skills }) => (
                                    <div key={category} className="space-y-2">
                                        <h4 className="text-[10px] font-semibold text-primary uppercase tracking-widest">
                                            {category}
                                        </h4>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(showAllSkills ? skills : skills.slice(0, visibleSkillLimit)).map((skill, idx) => (
                                                <Badge
                                                    key={idx}
                                                    variant="secondary"
                                                    className="bg-muted/40 border border-border/40 hover:bg-muted/60 text-muted-foreground text-[11px] font-medium px-2.5 py-0.5 rounded-md transition-colors"
                                                >
                                                    {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                                {totalSkills > visibleSkillLimit && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full h-8 text-xs text-primary hover:bg-primary/10 rounded-lg"
                                        onClick={() => setShowAllSkills(!showAllSkills)}
                                    >
                                        {showAllSkills ? 'Show less' : `Show all ${totalSkills} skills`}
                                    </Button>
                                )}
                            </div>
                        )}

                        {/* Two-column: Career + Education */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Career Timeline — spans 2 cols */}
                            {profile.work_history && profile.work_history.length > 0 && (
                                <div className={cn(
                                    "bg-card/60 border border-border/40 rounded-xl p-5 space-y-4",
                                    profile.education && profile.education.length > 0 ? "lg:col-span-2" : "lg:col-span-3"
                                )}>
                                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <Briefcase className="w-3.5 h-3.5" />
                                        Career Timeline
                                    </h3>
                                    <div className="space-y-0 relative ml-3">
                                        <div className="absolute left-0 top-2 bottom-2 w-px bg-border/60" />
                                        {profile.work_history.map((job, idx) => (
                                            <div key={idx} className="relative pl-6 py-2.5 first:pt-0 last:pb-0">
                                                <div className={cn(
                                                    "absolute left-[-3px] top-3 first:top-1 w-[7px] h-[7px] rounded-full border-2",
                                                    idx === 0 ? "border-primary bg-primary/30" : "border-border bg-card"
                                                )} />
                                                <h4 className="text-sm font-semibold text-foreground leading-tight">{job.title || 'Unknown Title'}</h4>
                                                <p className="text-xs text-primary mt-0.5">{job.company || 'Unknown Company'}</p>
                                                {job.duration && (
                                                    <p className="text-[11px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        {job.duration}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Education */}
                            {profile.education && profile.education.length > 0 && (
                                <div className={cn(
                                    "bg-card/60 border border-border/40 rounded-xl p-5 space-y-4",
                                    !(profile.work_history && profile.work_history.length > 0) && "lg:col-span-3"
                                )}>
                                    <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                                        <GraduationCap className="w-3.5 h-3.5" />
                                        Education
                                    </h3>
                                    <div className="space-y-3">
                                        {profile.education.map((edu, idx) => (
                                            <div key={idx} className="flex items-start gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0 mt-0.5">
                                                    <GraduationCap className="w-4 h-4 text-muted-foreground" />
                                                </div>
                                                <div>
                                                    <h4 className="text-sm font-semibold text-foreground leading-tight">{edu.school || 'Unknown School'}</h4>
                                                    {edu.degree && <p className="text-xs text-muted-foreground mt-0.5">{edu.degree}</p>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};
