import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { ProfileResult, resolvePhotoUrl } from "@/components/icp/ProfileResultCard";
import { getMatchBadge } from "@/lib/matchBadges";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, User, MapPin, Briefcase, GraduationCap, Linkedin,
  Mail, Bookmark, Download, ExternalLink, Copy, Check,
  ChevronLeft, ChevronRight, Sparkles, Calendar, ScanSearch
} from "lucide-react";
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage
} from "@/components/ui/breadcrumb";
import { icpAPI } from "@/lib/api/icp";

const ICPCandidateDetail = () => {
  const { sessionId, candidateId } = useParams<{ sessionId: string; candidateId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [profile, setProfile] = useState<ProfileResult | null>(null);
  const [allProfiles, setAllProfiles] = useState<ProfileResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionName, setSessionName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [revealingEmail, setRevealingEmail] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!sessionId || !candidateId) return;
      setLoading(true);
      try {
        const [{ data: profiles }, { data: session }] = await Promise.all([
          supabase
            .from("candidate_profiles")
            .select("*")
            .eq("session_id", sessionId)
            .order("similarity_score", { ascending: false }),
          supabase
            .from("icp_lookalike_sessions")
            .select("profile_name")
            .eq("session_id", sessionId)
            .single(),
        ]);

        if (session?.profile_name) setSessionName(session.profile_name);

        if (profiles) {
          const mapped: ProfileResult[] = profiles.map((p: any) => ({
            id: p.id,
            name: p.name || "Unknown",
            photo_url: p.photo_url,
            headline: p.headline,
            current_title: p.current_title,
            current_company: p.current_company,
            location: p.location,
            seniority_level: p.seniority_level,
            years_experience: p.years_experience,
            similarity_score: p.similarity_score,
            match_quality: p.match_quality,
            linkedin_url: p.linkedin_url,
            top_skills: Array.isArray(p.top_skills) ? p.top_skills : [],
            education: Array.isArray(p.education) ? p.education : [],
            work_history: Array.isArray(p.work_history) ? p.work_history : [],
            match_reason: Array.isArray(p.match_reasons) ? p.match_reasons.join(". ") : p.match_reasons,
            tier_source: p.tier_source,
            inserted_at: p.inserted_at,
            email: p.email,
            email_confidence: p.email_confidence,
          }));
          setAllProfiles(mapped);
          const current = mapped.find((p) => p.id === candidateId);
          setProfile(current || null);
        }
      } catch (e) {
        console.error("Failed to load candidate", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [sessionId, candidateId]);

  const currentIndex = useMemo(
    () => allProfiles.findIndex((p) => p.id === candidateId),
    [allProfiles, candidateId]
  );
  const prevProfile = currentIndex > 0 ? allProfiles[currentIndex - 1] : null;
  const nextProfile = currentIndex < allProfiles.length - 1 ? allProfiles[currentIndex + 1] : null;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast({ title: "Copied", description: `${label} copied to clipboard`, className: "border-primary text-primary" });
    setTimeout(() => setCopied(null), 2000);
  };

  const handleRevealEmail = async () => {
    if (!profile || !profile.linkedin_url || !sessionId) return;
    setRevealingEmail(true);
    try {
      const response = await icpAPI.revealEmail(profile.id, profile.linkedin_url, sessionId);
      if (response.email === null && response.success === false) {
        toast({ title: "Email Not Found", description: "No verified email available.", variant: "destructive" });
      } else if (response.success) {
        toast({ title: "Email Discovery Started", description: "Finding email address...", className: "border-primary/30 text-primary" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to reveal email.", variant: "destructive" });
    } finally {
      setRevealingEmail(false);
    }
  };

  const generateBio = () => {
    if (!profile) return "";
    if (profile.headline) return profile.headline;
    const skills = profile.top_skills?.slice(0, 3).join(", ") || "various skills";
    const experience = profile.years_experience ? `${profile.years_experience}+ years` : "extensive";
    return `${profile.current_title || "Professional"} with ${experience} of experience specializing in ${skills}.`;
  };

  const categorizeSkills = () => {
    if (!profile?.top_skills || profile.top_skills.length === 0) return [];
    const categories: Record<string, string[]> = { "Industry Knowledge": [], "Other Skills": [] };
    profile.top_skills.forEach((skill) => {
      const s = typeof skill === "string" ? skill : JSON.stringify(skill);
      const lower = s.toLowerCase();
      if (["healthcare", "tech", "finance", "industry", "oil", "gas"].some((k) => lower.includes(k))) {
        categories["Industry Knowledge"].push(s);
      } else {
        categories["Other Skills"].push(s);
      }
    });
    return Object.entries(categories)
      .filter(([, skills]) => skills.length > 0)
      .map(([category, skills]) => ({ category, skills }));
  };

  const resolveCompanyLogo = (logo?: { url?: string; sizes?: { url: string; width: number; height: number }[] }): string | undefined => {
    if (!logo) return undefined;
    // Prefer smallest size for thumbnails
    const smallest = logo.sizes?.sort((a, b) => a.width - b.width)?.[0];
    return smallest?.url || logo.url;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8 flex flex-col items-center justify-center gap-4">
        <Skeleton className="h-8 w-64 bg-card" />
        <Skeleton className="h-[400px] w-full max-w-5xl bg-card rounded-xl" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-foreground">
        <p className="text-muted-foreground">Candidate not found.</p>
        <Button variant="outline" onClick={() => navigate(`/icp/results/${sessionId}`)}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Results
        </Button>
      </div>
    );
  }

  const matchBadge = profile.similarity_score ? getMatchBadge(profile.similarity_score) : null;
  const skillCategories = categorizeSkills();
  const totalSkills = profile.top_skills?.length || 0;
  const visibleSkillLimit = 12;
  const photoSrc = resolvePhotoUrl(profile.photo_url);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-md border-b border-border/30">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/icp/results/${sessionId}`)}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => navigate(`/icp/results/${sessionId}`)}
                  >
                    Lookalike Results
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{profile.name}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2 hidden sm:inline">
              {currentIndex + 1} of {allProfiles.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!prevProfile}
              onClick={() => prevProfile && navigate(`/icp/results/${sessionId}/candidate/${prevProfile.id}`)}
              className="h-8 border-border/40"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!nextProfile}
              onClick={() => nextProfile && navigate(`/icp/results/${sessionId}/candidate/${nextProfile.id}`)}
              className="h-8 border-border/40"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Left Sidebar — Sticky */}
          <aside className="w-full lg:w-[40%] lg:max-w-[480px] shrink-0">
            <div className="lg:sticky lg:top-[72px] space-y-5">
              {/* Profile Card */}
              <div className="bg-card border border-border/40 rounded-xl p-6 shadow-sm space-y-5">
                <div className="flex flex-col items-center text-center gap-4">
                  {/* Large circular avatar */}
                  <div className="w-40 h-40 rounded-full border-2 border-border/60 bg-card overflow-hidden shadow-lg ring-2 ring-primary/10">
                    {photoSrc ? (
                      <img src={photoSrc} alt={profile.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted/30">
                        <User className="w-16 h-16 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <h1 className="text-xl font-bold text-foreground">{profile.name}</h1>
                    <p className="text-sm text-muted-foreground">
                      {profile.current_title}
                      {profile.current_company && (
                        <>
                          <span className="mx-1.5 text-border">·</span>
                          <span className="text-foreground/80">{profile.current_company}</span>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Match Badge */}
                  {matchBadge && (
                    <div className={cn(
                      "px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-bold border",
                      matchBadge.gradient
                    )}>
                      <span>{matchBadge.emoji}</span>
                      <span>{matchBadge.label}</span>
                      <span className="font-mono tabular-nums">— {profile.similarity_score}%</span>
                    </div>
                  )}

                  {/* Meta chips */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {profile.location && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/30 px-2.5 py-1 rounded-md">
                        <MapPin className="w-3 h-3" />
                        {profile.location}
                      </span>
                    )}
                    {profile.years_experience !== undefined && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/30 px-2.5 py-1 rounded-md">
                        <Briefcase className="w-3 h-3" />
                        {profile.years_experience}+ years
                      </span>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 justify-center pt-2 border-t border-border/30">
                  <Button size="sm" variant="outline" className="h-9 text-xs border-border/50 hover:border-primary/50 hover:text-primary rounded-lg">
                    <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                    Save
                  </Button>
                  {!profile.email && (
                    <Button
                      size="sm"
                      className="h-9 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg"
                      onClick={handleRevealEmail}
                      disabled={revealingEmail}
                    >
                      {revealingEmail ? (
                        <><ScanSearch className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Revealing...</>
                      ) : (
                        <><Mail className="w-3.5 h-3.5 mr-1.5" /> Reveal Email</>
                      )}
                    </Button>
                  )}
                  {profile.linkedin_url && (
                    <Button
                      size="sm"
                      className="h-9 text-xs bg-[#0077b5] hover:bg-[#0077b5]/90 text-white rounded-lg"
                      onClick={() => window.open(profile.linkedin_url, "_blank")}
                    >
                      <Linkedin className="w-3.5 h-3.5 mr-1.5 fill-current" />
                      LinkedIn
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-9 text-xs border-border/50 hover:border-border rounded-lg">
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Export
                  </Button>
                </div>
              </div>
            </div>
          </aside>

          {/* Right Content — Scrollable */}
          <main className="flex-1 space-y-5 min-w-0">
            {/* About */}
            <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <User className="w-3.5 h-3.5" /> About
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{generateBio()}</p>
            </div>

            {/* Match Analysis */}
            {profile.match_reason && profile.similarity_score && (
              <div className="bg-card border border-primary/20 rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-primary" /> Match Analysis
                </h3>
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
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {profile.match_reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Career Timeline */}
            {profile.work_history && profile.work_history.length > 0 && (
              <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Briefcase className="w-3.5 h-3.5" /> Career Timeline
                </h3>
                <div className="space-y-0 relative ml-3">
                  <div className="absolute left-0 top-2 bottom-2 w-px bg-border/60" />
                  {profile.work_history.map((job, idx) => {
                    const jobTitle = job.position || job.title || "Unknown Title";
                    const company = job.companyName || job.company || "Unknown Company";
                    const companyLogo = resolveCompanyLogo(job.companyLogo);
                    const dateRange = job.startDate?.text
                      ? `${job.startDate.text} – ${job.endDate?.text || "Present"}`
                      : job.duration;

                    return (
                      <div key={idx} className="relative pl-6 py-3 first:pt-0 last:pb-0">
                        <div className={cn(
                          "absolute left-[-3px] top-4 w-[7px] h-[7px] rounded-full border-2",
                          idx === 0 ? "border-primary bg-primary/30" : "border-border bg-card"
                        )} />
                        <div className="flex items-start gap-3">
                          {/* Company logo */}
                          <div className="w-9 h-9 rounded-lg bg-muted/40 border border-border/30 flex items-center justify-center shrink-0 overflow-hidden">
                            {companyLogo ? (
                              <img src={companyLogo} alt={company} className="w-full h-full object-cover" />
                            ) : (
                              <Briefcase className="w-4 h-4 text-muted-foreground/50" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-foreground leading-tight">{jobTitle}</h4>
                            <p className="text-xs text-primary mt-0.5">
                              {job.companyLinkedinUrl ? (
                                <a
                                  href={job.companyLinkedinUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:underline inline-flex items-center gap-0.5"
                                >
                                  {company} <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : company}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 mt-1">
                              {dateRange && (
                                <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {dateRange}
                                </span>
                              )}
                              {job.duration && dateRange !== job.duration && (
                                <span className="text-[11px] text-muted-foreground/50">
                                  ({job.duration})
                                </span>
                              )}
                              {job.location && (
                                <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {job.location}
                                </span>
                              )}
                            </div>
                            {job.description && (
                              <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed line-clamp-3">
                                {job.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Education */}
            {profile.education && profile.education.length > 0 && (
              <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <GraduationCap className="w-3.5 h-3.5" /> Education
                </h3>
                <div className="space-y-4">
                  {profile.education.map((edu, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-muted/40 border border-border/30 flex items-center justify-center shrink-0 text-lg">
                        🎓
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-foreground leading-tight">
                          {edu.degree || edu.fieldOfStudy || "Degree"}
                        </h4>
                        <p className="text-xs text-primary mt-0.5">{edu.school || "Unknown Institution"}</p>
                        {edu.dateRange && (
                          <p className="text-[11px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {edu.dateRange}
                          </p>
                        )}
                        {edu.description && (
                          <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed line-clamp-2">
                            {edu.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skills & Expertise */}
            {totalSkills > 0 && (
              <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Skills & Expertise</h3>
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">{totalSkills} skills</span>
                </div>
                {skillCategories.map(({ category, skills }) => (
                  <div key={category} className="space-y-2">
                    <h4 className="text-[10px] font-semibold text-primary uppercase tracking-widest">{category}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {(showAllSkills ? skills : skills.slice(0, visibleSkillLimit)).map((skill, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="bg-muted/40 border border-border/40 hover:bg-muted/60 text-muted-foreground text-[11px] font-medium px-2.5 py-0.5 rounded-md transition-colors"
                        >
                          {skill}
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
                    {showAllSkills ? "Show less" : `Show all ${totalSkills} skills`}
                  </Button>
                )}
              </div>
            )}

            {/* Contact */}
            <div className="bg-card border border-border/40 rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" /> Contact
              </h3>

              {/* Email */}
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted/40 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">Email</div>
                    {profile.email ? (
                      <div className="flex items-center gap-1.5">
                        {profile.email_confidence && (
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            profile.email_confidence === "low" ? "bg-amber-500" :
                            profile.email_confidence === "medium" ? "bg-emerald-400" : "bg-primary"
                          )} />
                        )}
                        <span className="text-foreground font-mono text-sm truncate">{profile.email}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not yet revealed</span>
                    )}
                  </div>
                </div>
                {profile.email && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity rounded-md" onClick={() => handleCopy(profile.email!, "Email")}>
                    {copied === "Email" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                )}
              </div>

              {/* LinkedIn */}
              {profile.linkedin_url && (
                <div className="flex items-center justify-between group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#0077b5]/10 flex items-center justify-center shrink-0">
                      <Linkedin className="w-4 h-4 text-[#0077b5]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">LinkedIn</div>
                      <a href={profile.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0077b5] text-sm hover:underline truncate block max-w-[280px]">
                        {profile.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, "")}
                      </a>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity rounded-md" onClick={() => handleCopy(profile.linkedin_url!, "LinkedIn URL")}>
                    {copied === "LinkedIn URL" ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              )}

              {/* Location */}
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
          </main>
        </div>
      </div>

      {/* Bottom Nav — Mobile */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-md border-t border-border/30 lg:hidden">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!prevProfile}
            onClick={() => prevProfile && navigate(`/icp/results/${sessionId}/candidate/${prevProfile.id}`)}
            className="h-9 border-border/40"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} / {allProfiles.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!nextProfile}
            onClick={() => nextProfile && navigate(`/icp/results/${sessionId}/candidate/${nextProfile.id}`)}
            className="h-9 border-border/40"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ICPCandidateDetail;
