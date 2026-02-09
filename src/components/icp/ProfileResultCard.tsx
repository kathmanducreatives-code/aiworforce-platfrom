import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { icpAPI, ICPResponse } from "@/lib/api/icp";
import {
    User, MapPin, Briefcase, GraduationCap, Linkedin,
    ChevronDown, ChevronUp, Star, CheckCircle2,
    ExternalLink, Mail, Bookmark, ScanSearch, X, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { getMatchBadge as matchGetBadge } from "@/lib/matchBadges";

export interface ProfileResult {
    id: string;
    name: string;
    photo_url?: string;
    headline?: string;
    current_title?: string;
    current_company?: string;
    location?: string;
    seniority_level?: string;
    years_experience?: number;
    similarity_score?: number;
    match_quality?: 'strong' | 'good' | 'moderate';
    linkedin_url?: string;
    top_skills?: string[];
    education?: { school: string; degree: string }[];
    work_history?: { company: string; title: string; duration?: string }[];
    match_reason?: string;
    tier_source?: number;
    inserted_at?: string;
    email?: string;
    email_confidence?: 'high' | 'medium' | 'low' | 'none';
    email_source?: string;
}

interface ProfileResultCardProps {
    profile: ProfileResult;
    sessionId?: string;
    onSave?: (id: string) => void;
    onReveal?: (id: string) => void;
    isEnriching?: boolean;
}

import { ProfileDetailModal } from "./ProfileDetailModal";

export const ProfileResultCard = ({ profile, sessionId, onSave, onReveal, isEnriching }: ProfileResultCardProps) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showDetail, setShowDetail] = useState(false);
    const [revealingEmail, setRevealingEmail] = useState<string | null>(null);
    const [revealedEmails, setRevealedEmails] = useState<Record<string, string>>({});
    const { toast } = useToast();

    const handleRevealEmail = async (profile: ProfileResult) => {
        if (revealedEmails[profile.id]) return;
        if (!profile.linkedin_url) {
            toast({ title: "Error", description: "No LinkedIn URL available", variant: "destructive" });
            return;
        }
        if (!sessionId) {
            toast({ title: "Error", description: "Session ID not available", variant: "destructive" });
            return;
        }

        setRevealingEmail(profile.id);

        try {
            const response = await icpAPI.revealEmail(profile.id, profile.linkedin_url, sessionId);

            if (response.email === null && response.success === false) {
                setRevealedEmails(prev => ({ ...prev, [profile.id]: "Not Found" }));
                setRevealingEmail(null);
                toast({
                    title: "Email Not Found",
                    description: "No verified email address found for this profile.",
                    variant: "destructive"
                });
                return;
            }

            if (response.success) {
                toast({
                    title: "Email Discovery Started",
                    description: "Finding email address...",
                    className: "border-primary/30 text-primary"
                });
            } else {
                toast({
                    title: "Failed",
                    description: response.error?.message || "Could not start email discovery",
                    variant: "destructive"
                });
                setRevealingEmail(null);
            }
        } catch (error) {
            console.error("Reveal email failed", error);
            toast({ title: "Failed", description: "Could not reveal email", variant: "destructive" });
            setRevealingEmail(null);
        }
    };

    useEffect(() => {
        if (revealingEmail === profile.id && profile.email) {
            setRevealingEmail(null);
            toast({
                title: "Email Found!",
                description: profile.email,
                className: "border-primary/30 text-primary"
            });
        }
    }, [profile.email, revealingEmail, profile.id, toast]);

    const getScoreColor = (score: number = 0) => {
        if (score >= 90) return "text-primary border-primary";
        if (score >= 75) return "text-emerald-400 border-emerald-400";
        return "text-yellow-400 border-yellow-400";
    };

    const scoreColor = getScoreColor(profile.similarity_score);

    const cardVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            layout
        >
            <Card
                className="bg-card/80 border-border/40 overflow-hidden hover:border-primary/30 transition-all duration-300 group shadow-lg shadow-black/40 relative cursor-pointer backdrop-blur-sm"
                onClick={() => setShowDetail(true)}
            >
                {/* Match Badge - Flush top banner */}
                {profile.similarity_score != null && (() => {
                    const badge = matchGetBadge(profile.similarity_score);
                    return (
                        <div className={cn(
                            "flex items-center justify-between px-5 py-2.5 border-b border-border/30",
                            badge.gradient.replace('border-', 'border-b-')
                        )}>
                            <div className="flex items-center gap-2">
                                <span className="text-base">{badge.emoji}</span>
                                <span className="text-xs font-semibold tracking-wide">{badge.label}</span>
                            </div>
                            <span className="text-sm font-mono font-bold tabular-nums">{profile.similarity_score}%</span>
                        </div>
                    );
                })()}

                {/* Profile Header */}
                <div className="px-5 pt-5 pb-4 flex items-start gap-4">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                        <div className="w-14 h-14 rounded-xl bg-muted/50 border border-border/60 flex items-center justify-center overflow-hidden ring-1 ring-border/20">
                            {profile.photo_url ? (
                                <img src={profile.photo_url} alt={profile.name} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-6 h-6 text-muted-foreground/40" />
                            )}
                        </div>
                        {profile.linkedin_url && (
                            <a
                                href={profile.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="absolute -bottom-1.5 -right-1.5 bg-[#0077b5] p-1 rounded-md text-white hover:scale-110 transition-transform shadow-md"
                                title="View on LinkedIn"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Linkedin className="w-3 h-3 fill-current" />
                            </a>
                        )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                        <h3 className="text-[15px] font-semibold text-foreground group-hover:text-primary transition-colors truncate leading-tight">
                            {profile.name}
                        </h3>
                        <p className="text-sm text-muted-foreground truncate leading-snug">
                            {profile.current_title}
                            {profile.current_company && (
                                <span className="text-primary/80 font-medium"> · {profile.current_company}</span>
                            )}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/70 pt-0.5">
                            {profile.location && (
                                <span className="flex items-center gap-1 truncate">
                                    <MapPin className="w-3 h-3 flex-shrink-0" />
                                    <span className="truncate">{profile.location}</span>
                                </span>
                            )}
                            {profile.years_experience !== undefined && (
                                <span className="flex items-center gap-1 flex-shrink-0">
                                    <Briefcase className="w-3 h-3" />
                                    {profile.years_experience}+ YOE
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Skills + Match Reason */}
                {(
                    (Array.isArray(profile.top_skills) && profile.top_skills.length > 0) ||
                    profile.match_reason
                ) && (
                    <div className="px-5 pb-4 space-y-3">
                        {Array.isArray(profile.top_skills) && profile.top_skills.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {profile.top_skills.slice(0, 4).map((skill, idx) => (
                                    <Badge key={`${skill}-${idx}`} variant="secondary" className="bg-muted/40 text-muted-foreground border-border/30 text-[10px] px-2 py-0.5 font-normal rounded-md">
                                        {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                                    </Badge>
                                ))}
                                {profile.top_skills.length > 4 && (
                                    <span className="text-[10px] text-muted-foreground/50 self-center">+{profile.top_skills.length - 4}</span>
                                )}
                            </div>
                        )}

                        {profile.match_reason && (
                            <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                                <div className="flex items-center gap-1.5 mb-1.5 text-primary text-[10px] font-semibold uppercase tracking-widest">
                                    <CheckCircle2 className="w-3 h-3" /> Match Insight
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{profile.match_reason}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Expanded Details */}
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="bg-muted/20 border-t border-border/30 px-5 py-4 space-y-4 overflow-hidden"
                        >
                            {Array.isArray(profile.work_history) && profile.work_history.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                                        <Briefcase className="w-3 h-3" /> Experience
                                    </h4>
                                    <div className="space-y-3 pl-1 border-l border-border/40 ml-1.5">
                                        {profile.work_history.slice(0, 3).map((job, idx) => (
                                            <div key={idx} className="pl-3 relative">
                                                <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-muted-foreground/30" />
                                                <div className="text-sm font-medium text-foreground">{job?.title || 'Unknown Title'}</div>
                                                <div className="text-xs text-muted-foreground">{job?.company || 'Unknown Company'} <span className="text-muted-foreground/40">•</span> {job?.duration || ''}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {Array.isArray(profile.education) && profile.education.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                                        <GraduationCap className="w-3 h-3" /> Education
                                    </h4>
                                    <div className="space-y-2">
                                        {profile.education.map((edu, idx) => (
                                            <div key={idx} className="bg-muted/30 rounded-md p-2 text-xs flex justify-between items-center">
                                                <span className="text-muted-foreground truncate">{edu?.school || 'Unknown School'}</span>
                                                <Badge variant="outline" className="text-[10px] border-border/40 text-muted-foreground/60 scale-90">{edu?.degree || 'Degree'}</Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Actions */}
                <div className="px-5 py-3 bg-muted/10 border-t border-border/30 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-border/40 hover:border-primary hover:text-primary hover:bg-primary/10 text-xs px-3"
                            onClick={() => onSave?.(profile.id)}
                            title="Save Profile"
                        >
                            <Bookmark className="w-3 h-3 mr-1.5" /> Save
                        </Button>

                        {profile.linkedin_url && (
                            <Button
                                size="sm"
                                className="h-8 bg-[#0077b5] text-white hover:bg-[#0077b5]/90 transition-all duration-300 text-xs"
                                onClick={() => window.open(profile.linkedin_url, '_blank')}
                            >
                                <Linkedin className="w-3.5 h-3.5 mr-1.5 fill-white" />
                                LinkedIn
                            </Button>
                        )}

                        <AnimatePresence mode="wait">
                            {(profile.email || revealedEmails[profile.id]) ? (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className={cn(
                                        "h-8 px-3 rounded-md border flex items-center gap-2 text-xs font-medium relative group/email cursor-pointer",
                                        (profile.email === "Not Found" || revealedEmails[profile.id] === "Not Found")
                                            ? "bg-destructive/10 border-destructive/20 text-destructive"
                                            : "bg-primary/10 border-primary/20 text-primary pr-8"
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const email = profile.email || revealedEmails[profile.id];
                                        if (email !== "Not Found") {
                                            navigator.clipboard.writeText(email!);
                                            toast({ title: "Copied", description: "Email copied to clipboard" });
                                        }
                                    }}
                                >
                                    {(profile.email === "Not Found" || revealedEmails[profile.id] === "Not Found") ? (
                                        <>
                                            <X className="w-3.5 h-3.5" />
                                            <span>Not Found</span>
                                        </>
                                    ) : (
                                        <>
                                            <div className={cn(
                                                "w-2 h-2 rounded-full",
                                                profile.email_confidence === 'low' ? "bg-amber-500" :
                                                    profile.email_confidence === 'medium' ? "bg-emerald-400" :
                                                        "bg-primary"
                                            )} title={`Confidence: ${profile.email_confidence || 'High'}`} />
                                            <span className="truncate max-w-[140px]">{profile.email || revealedEmails[profile.id]}</span>
                                            <div className="absolute right-2 opacity-0 group-hover/email:opacity-100 transition-opacity">
                                                <Copy className="w-3.5 h-3.5 text-primary" />
                                            </div>
                                        </>
                                    )}
                                </motion.div>
                            ) : (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                >
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 border-primary text-primary hover:bg-primary/10 transition-all duration-300 font-semibold disabled:opacity-50 text-xs"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRevealEmail(profile);
                                        }}
                                        disabled={!!revealingEmail || !!isEnriching}
                                    >
                                        {(revealingEmail === profile.id || !!isEnriching) ? (
                                            <>
                                                <ScanSearch className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                                Revealing...
                                            </>
                                        ) : (
                                            <>
                                                <Mail className="w-3.5 h-3.5 mr-1.5" />
                                                Reveal Email
                                            </>
                                        )}
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </Card>

            <ProfileDetailModal
                profile={profile}
                deepSearchResult={undefined}
                revealedEmail={revealedEmails[profile.id]}
                open={showDetail}
                onOpenChange={setShowDetail}
            />
        </motion.div>
    );
};
