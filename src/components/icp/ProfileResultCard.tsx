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
    email?: string; // Email field for reveal functionality
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
    const [isExpanded, setIsExpanded] = useState(false); // Kept for legacy or if we want both
    const [showDetail, setShowDetail] = useState(false);
    // const [deepSearchResult, setDeepSearchResult] = useState<ICPResponse['deep_search_result'] | null>(null); // Removed deep search
    const [revealingEmail, setRevealingEmail] = useState<string | null>(null);
    const [revealedEmails, setRevealedEmails] = useState<Record<string, string>>({});
    const { toast } = useToast();

    const handleRevealEmail = async (profile: ProfileResult) => {
        if (revealedEmails[profile.id]) return; // Already revealed
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
            // Call API with updated signature: profile_id, linkedin_url, session_id
            const response = await icpAPI.revealEmail(profile.id, profile.linkedin_url, sessionId);

            // Special handling: Email Not Found (success: false, email: null) from our updated icp.ts logic
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

            // Standard success path (async job started)
            if (response.success) {
                toast({
                    title: "Email Discovery Started",
                    description: "Finding email address...",
                    className: "border-[#00FF85] text-[#00FF85]"
                });
                // Note: We keep the loading state until the realtime update arrives
                // The useEffect below will clear it when the email is updated
            } else {
                // Other API failures
                toast({
                    title: "Failed",
                    description: response.error?.message || "Could not start email discovery",
                    variant: "destructive"
                });
                setRevealingEmail(null); // Clear loading state on error
            }
        } catch (error) {
            console.error("Reveal email failed", error);
            toast({ title: "Failed", description: "Could not reveal email", variant: "destructive" });
            setRevealingEmail(null); // Clear loading state on error
        }
    };

    // Monitor profile changes - when email arrives via Supabase realtime, clear loading state
    useEffect(() => {
        // If we were revealing email for this profile and now it has an email, clear loading state
        if (revealingEmail === profile.id && profile.email) {
            setRevealingEmail(null);
            toast({
                title: "Email Found!",
                description: profile.email,
                className: "border-[#00FF85] text-[#00FF85]"
            });
        }
    }, [profile.email, revealingEmail, profile.id, toast]);

    // Color coding based on match score
    const getScoreColor = (score: number = 0) => {
        if (score >= 90) return "text-[#00FF85] border-[#00FF85]";
        if (score >= 75) return "text-emerald-400 border-emerald-400";
        return "text-yellow-400 border-yellow-400";
    };

    const scoreColor = getScoreColor(profile.similarity_score);

    // Animation variants
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
                className="bg-[#121212] border-white/5 overflow-hidden hover:border-[#00FF85]/30 transition-all duration-300 group shadow-lg shadow-black/50 relative cursor-pointer"
                onClick={() => setShowDetail(true)}
            >
                {/* Header Section */}
                <div className="p-5 pt-10 flex items-start gap-4 relative">
                    {/* Similarity Score Badge (Top Right) */}
                    {/* Match Strength Badge (Top Right) */}
                    {profile.similarity_score && (() => {
                        const badge = matchGetBadge(profile.similarity_score);
                        return (
                            <div className={cn(
                                "absolute top-3 right-3 z-20 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-bold transition-transform hover:scale-105 border backdrop-blur-md",
                                badge.gradient
                            )}>
                                <span className="text-sm drop-shadow-sm">{badge.emoji}</span>
                                <span className="tracking-wide drop-shadow-sm">{badge.label}</span>
                                <span className="ml-1.5 pl-1.5 border-l border-white/20 font-mono opacity-80">
                                    {profile.similarity_score}%
                                </span>
                            </div>
                        );
                    })()}

                    {/* Avatar */}
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-[#1A1A1A] border-2 border-white/10 flex items-center justify-center overflow-hidden shadow-xl">
                            {profile.photo_url ? (
                                <img src={profile.photo_url} alt={profile.name} className="w-full h-full object-cover" />
                            ) : (
                                <User className="w-8 h-8 text-muted-foreground/50" />
                            )}
                        </div>
                        {/* LinkedIn Icon Absolute */}
                        {profile.linkedin_url && (
                            <a
                                href={profile.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="absolute -bottom-1 -right-1 bg-[#0077b5] p-1 rounded-full text-white hover:scale-110 transition-transform shadow-lg"
                                title="View on LinkedIn"
                            >
                                <Linkedin className="w-3 h-3 fill-current" />
                            </a>
                        )}
                    </div>

                    {/* Basic Info */}
                    <div className="flex-1 min-w-0 pr-16">
                        <h3 className="text-lg font-bold text-white group-hover:text-[#00FF85] transition-colors truncate">
                            {profile.name}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-gray-300 mt-0.5 truncate">
                            <span className="font-medium text-white">{profile.current_title}</span>
                            <span className="text-gray-600">•</span>
                            <span className="text-emerald-400/90">{profile.current_company}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            {profile.location && (
                                <div className="flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {profile.location}
                                </div>
                            )}
                            {profile.years_experience !== undefined && (
                                <div className="flex items-center gap-1">
                                    <Briefcase className="w-3 h-3" />
                                    {profile.years_experience}+ YOE
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent w-full" />

                {/* Body / Summary */}
                <div className="p-4 pt-3 space-y-3">
                    {/* Skills Tags */}
                    {Array.isArray(profile.top_skills) && profile.top_skills.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {profile.top_skills.slice(0, 4).map((skill, idx) => (
                                <Badge key={`${skill}-${idx}`} variant="secondary" className="bg-[#1A1A1A] text-gray-300 border-white/5 hover:bg-white/10 text-[10px] px-2 py-0.5 font-normal">
                                    {typeof skill === 'string' ? skill : JSON.stringify(skill)}
                                </Badge>
                            ))}
                            {profile.top_skills.length > 4 && (
                                <span className="text-[10px] text-muted-foreground self-center">+{profile.top_skills.length - 4}</span>
                            )}
                        </div>
                    )}

                    {/* Why this match (Snippet) */}
                    {profile.match_reason && (
                        <div className="bg-[#00FF85]/5 border border-[#00FF85]/10 rounded-lg p-3 text-xs text-gray-300">
                            <div className="flex items-center gap-1.5 mb-1 text-[#00FF85] font-semibold text-[10px] uppercase tracking-wider">
                                <CheckCircle2 className="w-3 h-3" /> Why this match
                            </div>
                            <p className="line-clamp-2 opacity-80">{profile.match_reason}</p>
                        </div>
                    )}
                </div>

                {/* Expanded Details */}
                <AnimatePresence>
                    {isExpanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="bg-[#161616] border-t border-white/5 px-5 py-4 space-y-4 overflow-hidden"
                        >
                            {/* Work History */}
                            {Array.isArray(profile.work_history) && profile.work_history.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                                        <Briefcase className="w-3 h-3" /> Experience
                                    </h4>
                                    <div className="space-y-3 pl-1 border-l border-white/10 ml-1.5">
                                        {profile.work_history.slice(0, 3).map((job, idx) => (
                                            <div key={idx} className="pl-3 relative">
                                                <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-white/20" />
                                                <div className="text-sm font-medium text-white">{job?.title || 'Unknown Title'}</div>
                                                <div className="text-xs text-gray-400">{job?.company || 'Unknown Company'} <span className="text-gray-600">•</span> {job?.duration || ''}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Education */}
                            {Array.isArray(profile.education) && profile.education.length > 0 && (
                                <div>
                                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                                        <GraduationCap className="w-3 h-3" /> Education
                                    </h4>
                                    <div className="space-y-2">
                                        {profile.education.map((edu, idx) => (
                                            <div key={idx} className="bg-black/20 rounded-md p-2 text-xs flex justify-between items-center">
                                                <span className="text-gray-300 truncate">{edu?.school || 'Unknown School'}</span>
                                                <Badge variant="outline" className="text-[10px] border-white/10 text-gray-500 scale-90">{edu?.degree || 'Degree'}</Badge>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Footer Actions */}
                <div className="p-3 bg-[#0A0A0A] border-t border-white/5 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-white/10 hover:border-[#00FF85] hover:text-[#00FF85] hover:bg-[#00FF85]/10 text-xs px-2"
                            onClick={() => onSave?.(profile.id)}
                            title="Save Profile"
                        >
                            <Bookmark className="w-3 h-3 mr-1" /> Save
                        </Button>

                        {/* LinkedIn Action - Primary */}
                        {profile.linkedin_url && (
                            <Button
                                size="sm"
                                className="h-8 bg-[#0077b5] text-white hover:bg-[#0077b5]/90 border border-transparent hover:border-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all duration-300 group/linkedin"
                                onClick={() => window.open(profile.linkedin_url, '_blank')}
                            >
                                <Linkedin className="w-3.5 h-3.5 mr-1.5 fill-white group-hover/linkedin:scale-110 transition-transform" />
                                LinkedIn
                            </Button>
                        )}

                        {/* Reveal Email Action (Green/Red) */}
                        <AnimatePresence mode="wait">
                            {(profile.email || revealedEmails[profile.id]) ? (
                                <motion.div
                                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className={cn(
                                        "h-8 px-3 rounded-md border flex items-center gap-2 text-xs font-medium relative group/email cursor-pointer",
                                        (profile.email === "Not Found" || revealedEmails[profile.id] === "Not Found")
                                            ? "bg-red-500/10 border-red-500/20 text-red-500"
                                            : "bg-[#00FF85]/10 border-[#00FF85]/20 text-[#00FF85] pr-8" // Extra padding for copy icon
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const email = profile.email || revealedEmails[profile.id];
                                        if (email !== "Not Found") {
                                            navigator.clipboard.writeText(email!);
                                            toast({ title: "Copied", description: "Email copied to clipboard", className: "border-[#00FF85] text-[#00FF85]" });
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
                                            {/* Confidence Dot */}
                                            <div className={cn(
                                                "w-2 h-2 rounded-full",
                                                profile.email_confidence === 'low' ? "bg-amber-500" :
                                                    profile.email_confidence === 'medium' ? "bg-emerald-400" :
                                                        "bg-[#00FF85]"
                                            )} title={`Confidence: ${profile.email_confidence || 'High'}`} />

                                            <span className="truncate max-w-[140px]">{profile.email || revealedEmails[profile.id]}</span>

                                            {/* Copy Icon (Absolute Right) */}
                                            <div className="absolute right-2 opacity-0 group-hover/email:opacity-100 transition-opacity">
                                                <Copy className="w-3.5 h-3.5 text-emerald-400" />
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
                                        className="h-8 border-[#00FF85] text-[#00FF85] hover:bg-[#00FF85]/10 hover:text-[#00FF85] transition-all duration-300 font-semibold disabled:opacity-50 disabled:cursor-not-allowed group/reveal"
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
                                                <Mail className="w-3.5 h-3.5 mr-1.5 group-hover/reveal:scale-110 transition-transform" />
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
                deepSearchResult={undefined} // No longer passing deep search result from here
                revealedEmail={revealedEmails[profile.id]}
                open={showDetail}
                onOpenChange={setShowDetail}
            />
        </motion.div>
    );
};
