import {
    Dialog,
    DialogContent,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    User, MapPin, Briefcase, GraduationCap, Linkedin, CheckCircle2, X,
    Copy, Check, Mail, Bookmark, Download, Share2, ExternalLink,
    ChevronRight, ChevronLeft, Building2, Calendar, Phone
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

    // Determine the email to show
    const displayEmail = profile?.email || deepSearchResult?.email || (revealedEmail !== "Not Found" ? revealedEmail : null);
    const isNotFound = revealedEmail === "Not Found" || profile?.email === "Not Found";

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        toast({ title: "Copied", description: `${label} copied to clipboard`, className: "border-[#00FF85] text-[#00FF85]" });
        setTimeout(() => setCopied(null), 2000);
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!open) return;
            if (e.key === 'Escape') {
                onOpenChange(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onOpenChange]);

    if (!profile) return null;

    // Generate bio if not available
    const generateBio = () => {
        if (profile.headline) return profile.headline;
        const skills = profile.top_skills?.slice(0, 3).join(', ') || 'various skills';
        const experience = profile.years_experience ? `${profile.years_experience}+ years` : 'extensive';
        return `${profile.current_title || 'Professional'} with ${experience} of experience specializing in ${skills}.`;
    };

    // Categorize skills
    const categorizeSkills = () => {
        if (!profile.top_skills || profile.top_skills.length === 0) return [];

        const categories: { [key: string]: string[] } = {
            'Core Expertise': [],
            'Industry Knowledge': [],
            'Tools & Platforms': [],
            'Other Skills': []
        };

        // Simple categorization logic - you can enhance this
        profile.top_skills.forEach(skill => {
            const skillStr = typeof skill === 'string' ? skill : JSON.stringify(skill);
            const lower = skillStr.toLowerCase();

            if (lower.includes('recruit') || lower.includes('talent') || lower.includes('hiring') || lower.includes('sourcing')) {
                categories['Core Expertise'].push(skillStr);
            } else if (lower.includes('healthcare') || lower.includes('tech') || lower.includes('finance') || lower.includes('industry')) {
                categories['Industry Knowledge'].push(skillStr);
            } else if (lower.includes('linkedin') || lower.includes('ats') || lower.includes('software') || lower.includes('platform')) {
                categories['Tools & Platforms'].push(skillStr);
            } else {
                categories['Other Skills'].push(skillStr);
            }
        });

        return Object.entries(categories)
            .filter(([_, skills]) => skills.length > 0)
            .map(([category, skills]) => ({ category, skills }));
    };

    const skillCategories = categorizeSkills();
    const topCategories = skillCategories.slice(0, 3);
    const totalSkills = profile.top_skills?.length || 0;

    // Match badge helper - uses shared config
    const getMatchBadgeLocal = (score: number) => {
        const b = sharedGetMatchBadge(score);
        return { emoji: b.emoji, label: b.label, color: b.gradient };
    };

    const matchBadge = profile.similarity_score ? getMatchBadgeLocal(profile.similarity_score) : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-none h-screen p-0 m-0 fixed right-0 top-0 translate-x-0 translate-y-0 w-[70%] bg-[#0A0A0A] border-l border-white/10 text-white gap-0 shadow-2xl data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
                style={{ animation: 'slideInFromRight 0.3s ease-out' }}
            >
                {/* Sticky Header */}
                <div className="sticky top-0 z-50 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-white/10">
                    {/* Close Button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 top-4 text-white/50 hover:text-white hover:bg-white/10 z-50"
                        onClick={() => onOpenChange(false)}
                    >
                        <X className="h-5 w-5" />
                    </Button>

                    {/* Profile Header */}
                    <div className="p-6 pb-4">
                        <div className="flex items-start justify-between gap-6">
                            {/* Left: Photo + Info */}
                            <div className="flex items-start gap-4 flex-1">
                                <div className="w-20 h-20 rounded-full border-2 border-white/10 bg-[#1A1A1A] overflow-hidden shadow-xl shrink-0">
                                    {profile.photo_url ? (
                                        <img src={profile.photo_url} alt={profile.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            <User className="w-10 h-10 text-muted-foreground/50" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-2xl font-bold text-white mb-1 truncate">{profile.name}</h2>
                                    <p className="text-base text-gray-300 mb-2">
                                        {profile.current_title}
                                        {profile.current_company && (
                                            <>
                                                <span className="text-gray-600 mx-2">at</span>
                                                <a
                                                    href={`https://www.linkedin.com/company/${profile.current_company}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-emerald-400 hover:underline inline-flex items-center gap-1"
                                                >
                                                    {profile.current_company}
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                            </>
                                        )}
                                    </p>
                                    <div className="flex items-center gap-3 text-sm text-gray-400">
                                        {profile.location && (
                                            <div className="flex items-center gap-1">
                                                <MapPin className="w-4 h-4" />
                                                {profile.location}
                                            </div>
                                        )}
                                        {profile.years_experience !== undefined && (
                                            <div className="flex items-center gap-1">
                                                <Briefcase className="w-4 h-4" />
                                                {profile.years_experience}+ Years
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Match Badge */}
                            {matchBadge && (
                                <div className={cn(
                                    "px-4 py-2 rounded-full flex items-center gap-2 text-sm font-bold border shrink-0",
                                    matchBadge.color
                                )}>
                                    <span className="text-base">{matchBadge.emoji}</span>
                                    <span>{matchBadge.label}</span>
                                    <span className="ml-1 pl-2 border-l border-current/30 font-mono">
                                        {profile.similarity_score}%
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Action Buttons Row */}
                    <div className="px-6 pb-4 flex items-center gap-2 flex-wrap">
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-white/10 hover:border-[#00FF85] hover:text-[#00FF85]"
                        >
                            <Bookmark className="w-4 h-4 mr-2" />
                            Save Lead
                        </Button>

                        {!displayEmail && !isNotFound && (
                            <Button
                                size="sm"
                                className="h-9 bg-[#00FF85] text-black hover:bg-[#00FF85]/90"
                                onClick={() => setShowEmail(true)}
                            >
                                <Mail className="w-4 h-4 mr-2" />
                                Reveal Email
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-white/10 hover:border-emerald-400 hover:text-emerald-400"
                        >
                            Add to Campaign
                        </Button>

                        {profile.linkedin_url && (
                            <Button
                                size="sm"
                                className="h-9 bg-[#0077b5] hover:bg-[#0077b5]/90 text-white"
                                onClick={() => window.open(profile.linkedin_url, '_blank')}
                            >
                                <Linkedin className="w-4 h-4 mr-2 fill-current" />
                                View on LinkedIn
                            </Button>
                        )}

                        <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-white/10 hover:border-white/30"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Export
                        </Button>
                    </div>
                </div>

                {/* Scrollable Content */}
                <ScrollArea className="flex-1 h-[calc(100vh-240px)]">
                    <div className="p-6 space-y-6">
                        {/* Section 1: About/Bio */}
                        <section className="space-y-3">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                                <User className="w-4 h-4" />
                                About
                            </h3>
                            <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                <p className="text-gray-300 leading-relaxed">
                                    {generateBio()}
                                </p>
                            </div>
                        </section>

                        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                        {/* Section 2: Contact Information */}
                        <section className="space-y-3">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                Contact Information
                            </h3>
                            <div className="bg-[#111] border border-white/5 rounded-lg p-4 space-y-3">
                                {/* Email */}
                                <div className="flex items-center justify-between group">
                                    <div className="flex items-center gap-3 flex-1">
                                        <Mail className="w-4 h-4 text-gray-500" />
                                        <div className="flex-1">
                                            <div className="text-xs text-gray-500 mb-0.5">Email</div>
                                            {displayEmail ? (
                                                <div className="flex items-center gap-2">
                                                    {profile.email_confidence && (
                                                        <div className={cn(
                                                            "w-2 h-2 rounded-full shrink-0",
                                                            profile.email_confidence === 'low' ? "bg-amber-500" :
                                                                profile.email_confidence === 'medium' ? "bg-emerald-400" :
                                                                    "bg-[#00FF85]"
                                                        )} />
                                                    )}
                                                    <span className="text-white font-mono text-sm">{displayEmail}</span>
                                                </div>
                                            ) : isNotFound ? (
                                                <span className="text-red-400 text-sm">Not Found</span>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 px-2 text-[#00FF85] hover:bg-[#00FF85]/10"
                                                    onClick={() => setShowEmail(true)}
                                                >
                                                    Click to reveal
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    {displayEmail && (
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => handleCopy(displayEmail, 'Email')}
                                        >
                                            {copied === 'Email' ? <Check className="w-4 h-4 text-[#00FF85]" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                    )}
                                </div>

                                {/* LinkedIn */}
                                {profile.linkedin_url && (
                                    <div className="flex items-center justify-between group">
                                        <div className="flex items-center gap-3 flex-1">
                                            <Linkedin className="w-4 h-4 text-[#0077b5]" />
                                            <div className="flex-1">
                                                <div className="text-xs text-gray-500 mb-0.5">LinkedIn</div>
                                                <a
                                                    href={profile.linkedin_url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-[#0077b5] text-sm hover:underline truncate block max-w-md"
                                                >
                                                    {profile.linkedin_url}
                                                </a>
                                            </div>
                                        </div>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={() => handleCopy(profile.linkedin_url!, 'LinkedIn URL')}
                                        >
                                            {copied === 'LinkedIn URL' ? <Check className="w-4 h-4 text-[#00FF85]" /> : <Copy className="w-4 h-4" />}
                                        </Button>
                                    </div>
                                )}

                                {/* Location */}
                                {profile.location && (
                                    <div className="flex items-center gap-3">
                                        <MapPin className="w-4 h-4 text-gray-500" />
                                        <div>
                                            <div className="text-xs text-gray-500 mb-0.5">Location</div>
                                            <span className="text-white text-sm">{profile.location}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>

                        <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                        {/* Section 3: Match Analysis */}
                        {profile.match_reason && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4" />
                                        Match Analysis
                                    </h3>
                                    <div className="bg-[#00FF85]/5 border border-[#00FF85]/20 rounded-lg p-4">
                                        {/* Progress Bar */}
                                        <div className="mb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-sm text-gray-400">Match Score</span>
                                                <span className="text-lg font-bold text-[#00FF85]">{profile.similarity_score}%</span>
                                            </div>
                                            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-[#00FF85] to-emerald-400 rounded-full transition-all duration-500"
                                                    style={{ width: `${profile.similarity_score}%` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Match Reason */}
                                        <p className="text-gray-300 leading-relaxed text-sm">
                                            {profile.match_reason}
                                        </p>
                                    </div>
                                </section>
                                <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                            </>
                        )}

                        {/* Section 4: Skills & Expertise (Categorized) */}
                        {skillCategories.length > 0 && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">
                                        Skills & Expertise
                                    </h3>
                                    <div className="space-y-4">
                                        {(showAllSkills ? skillCategories : topCategories).map(({ category, skills }) => (
                                            <div key={category} className="bg-[#111] border border-white/5 rounded-lg p-4">
                                                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                                                    {category}
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {skills.map((skill, idx) => (
                                                        <Badge
                                                            key={idx}
                                                            variant="secondary"
                                                            className="bg-white/5 border-white/10 hover:bg-white/10 text-gray-300"
                                                        >
                                                            {skill}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}

                                        {skillCategories.length > 3 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="w-full text-[#00FF85] hover:bg-[#00FF85]/10"
                                                onClick={() => setShowAllSkills(!showAllSkills)}
                                            >
                                                {showAllSkills ? 'Show less' : `Show all ${totalSkills} skills`}
                                            </Button>
                                        )}
                                    </div>
                                </section>
                                <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                            </>
                        )}

                        {/* Section 5: Career Timeline */}
                        {profile.work_history && profile.work_history.length > 0 && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                                        <Briefcase className="w-4 h-4" />
                                        Career Timeline
                                    </h3>
                                    <div className="space-y-4 relative border-l border-white/10 ml-2 pl-6">
                                        {profile.work_history.map((job, idx) => (
                                            <div key={idx} className="relative">
                                                <div className="absolute -left-[29px] top-1.5 w-3 h-3 rounded-full bg-[#1A1A1A] border-2 border-emerald-500/50" />
                                                <div className="bg-[#111] border border-white/5 rounded-lg p-4">
                                                    <div className="flex items-start gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                                            <Building2 className="w-5 h-5 text-gray-500" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <h4 className="text-white font-semibold">{job.title || 'Unknown Title'}</h4>
                                                            <p className="text-emerald-400 text-sm">{job.company || 'Unknown Company'}</p>
                                                            {job.duration && (
                                                                <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                                                                    <Calendar className="w-3 h-3" />
                                                                    {job.duration}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                                <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                            </>
                        )}

                        {/* Section 6: Education */}
                        {profile.education && profile.education.length > 0 && (
                            <section className="space-y-3">
                                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 flex items-center gap-2">
                                    <GraduationCap className="w-4 h-4" />
                                    Education
                                </h3>
                                <div className="space-y-3">
                                    {profile.education.map((edu, idx) => (
                                        <div key={idx} className="bg-[#111] border border-white/5 rounded-lg p-4">
                                            <h4 className="text-white font-semibold text-sm">{edu.school || 'Unknown School'}</h4>
                                            <p className="text-gray-400 text-xs mt-1">{edu.degree || 'Degree'}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};
