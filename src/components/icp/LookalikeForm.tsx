import { useState } from "react";
import { User, Brain, Briefcase, GraduationCap, Linkedin, Loader2, MapPin, Pencil, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { ICPFormData } from "@/types/icp";
import { icpAPI } from "@/lib/api/icp";

import { LiveProcessLog } from "./LiveProcessLog";

interface LookalikeFormProps {
    value: ICPFormData;
    onChange: (data: ICPFormData) => void;
    sessionId?: string;
}


export const LookalikeForm = ({ value, onChange, sessionId }: LookalikeFormProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [scrapedProfile, setScrapedProfile] = useState<any>(value.lookalikeProfile || null);
    const [error, setError] = useState("");
    const [imageError, setImageError] = useState(false);

    const handleAnalyze = async () => {
        const linkedInRegex = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/;

        if (!value.lookalikeUrl) {
            setError("Please enter a LinkedIn URL");
            return;
        }

        if (!linkedInRegex.test(value.lookalikeUrl)) {
            setError("Please enter a valid LinkedIn profile URL (e.g., https://linkedin.com/in/username)");
            return;
        }

        if (!sessionId) {
            toast.error("Session not initialized. Please restart the wizard.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setImageError(false);

        try {
            console.log('Detailed Debug: Step 3 - Sending with session_id:', sessionId);

            const rawResponse = await icpAPI.analyzeLookalikeProfile(sessionId, value.lookalikeUrl);

            if (!rawResponse) {
                throw new Error("No response received from analysis");
            }

            console.log("Analysis Raw Response:", rawResponse);

            const responseItem = Array.isArray(rawResponse) ? rawResponse[0] : rawResponse;
            const profileData = responseItem.profile || responseItem.data?.profile || responseItem;

            if (!profileData) {
                console.warn("Profile data missing in response", responseItem);
            }

            const generatedStrategy = responseItem.generated_strategy || responseItem.data?.generated_strategy;
            const searchLogicDna = responseItem.search_logic_dna || responseItem.data?.search_logic_dna;
            const firmographic = responseItem.firmographic_constraints || responseItem.data?.firmographic_constraints;
            const technical = responseItem.technical_execution || responseItem.data?.technical_execution;

            const rawProfile = profileData.profile || profileData;

            const mappedProfile = {
                ...rawProfile,
                total_years_experience: rawProfile.years_experience ? `${rawProfile.years_experience} Years` : rawProfile.total_years_experience,
                seniority_level: rawProfile.seniority || rawProfile.seniority_level,
                work_history: rawProfile.work_history || [],
                top_skills: rawProfile.top_skills || rawProfile.skills || []
            };

            setScrapedProfile(mappedProfile);

            const nextState: ICPFormData = {
                ...value,
                lookalikeProfile: mappedProfile,
                generated_strategy: generatedStrategy,
                strategyData: {
                    search_logic_dna: searchLogicDna,
                    technical_execution: technical,
                    firmographic_constraints: firmographic || {
                        location: value.company_location,
                        size: value.company_size,
                        industries: value.industries,
                        hiring_intensity: value.hiringIntensity
                    }
                },
                featureWeights: {
                    education: 100,
                    skills: 100,
                    experience: 100,
                    seniority: 100
                }
            };

            onChange(nextState);
            toast.success("Profile analyzed successfully!");
        } catch (err) {
            console.error("Analysis Error:", err);
            setError("Failed to analyze profile. Please check the URL and try again.");
            toast.error("Analysis failed");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] w-full">
                <LiveProcessLog status="running" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="text-center space-y-2 mb-8">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 ring-1 ring-primary/20 shadow-[0_0_20px_hsl(var(--primary)/0.1)]">
                    <Linkedin className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-2xl font-bold text-foreground tracking-tight">Import Lookalike Profile</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Provide a LinkedIn URL of your ideal candidate. Our AI will analyze their patterns to build your strategy.
                </p>
            </div>
            {/* URL Input */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Linkedin className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="https://linkedin.com/in/..."
                        value={value.lookalikeUrl || ""}
                        onChange={(e) => onChange({ ...value, lookalikeUrl: e.target.value })}
                        className="pl-9"
                    />
                </div>
                <Button
                    onClick={handleAnalyze}
                    disabled={isLoading || !value.lookalikeUrl}
                    className="min-w-[140px]"
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <Brain className="w-4 h-4 mr-2" />
                            Analyze
                        </>
                    )}
                </Button>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Analysis Result */}
            {scrapedProfile && (
                <div className="space-y-6">
                    {/* Premium Profile Preview Card */}
                    <Card className="border-border/40 bg-card/50 backdrop-blur-md shadow-2xl overflow-hidden relative group">
                        {/* Decorative background gradient */}
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

                        <CardHeader className="pb-6 border-b border-border/30 relative z-10">
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                                <div className="flex items-center gap-5">
                                    {/* Avatar with Gradient Border & Status */}
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full p-[2px] bg-gradient-to-br from-primary via-primary/50 to-transparent">
                                            <div className="w-full h-full rounded-full overflow-hidden bg-background flex items-center justify-center">
                                                {!imageError && scrapedProfile.photo_url ? (
                                                    <img
                                                        src={scrapedProfile.photo_url}
                                                        alt={scrapedProfile.name}
                                                        className="w-full h-full object-cover"
                                                        referrerPolicy="no-referrer"
                                                        onError={() => setImageError(true)}
                                                    />
                                                ) : (
                                                    <User className="w-8 h-8 text-muted-foreground/50" />
                                                )}
                                            </div>
                                        </div>
                                        {/* Status Dot */}
                                        <div className="absolute bottom-1 right-1 w-3.5 h-3.5 bg-emerald-500/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-background">
                                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                                                {scrapedProfile.name}
                                            </CardTitle>
                                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-primary/10 text-primary border-primary/20">
                                                Verified
                                            </Badge>
                                        </div>
                                        <CardDescription className="flex flex-col gap-1">
                                            <span className="font-medium text-muted-foreground text-sm">
                                                {scrapedProfile.headline || "No headline found"}
                                            </span>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                {scrapedProfile.company && (
                                                    <span className="flex items-center gap-1">
                                                        <Briefcase className="w-3 h-3 text-primary/70" /> {scrapedProfile.company}
                                                    </span>
                                                )}
                                                {scrapedProfile.location && (
                                                    <span className="flex items-center gap-1">
                                                        <MapPin className="w-3 h-3 text-primary/70" /> {scrapedProfile.location}
                                                    </span>
                                                )}
                                            </div>
                                        </CardDescription>
                                    </div>
                                </div>

                                <div className="flex gap-2 w-full md:w-auto">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            onChange({ ...value, lookalikeProfile: undefined });
                                            setScrapedProfile(null);
                                        }}
                                        className="gap-1.5 flex-1 md:flex-none border-border/40 hover:bg-accent"
                                    >
                                        <Pencil className="w-3.5 h-3.5" /> Edit
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleAnalyze}
                                        disabled={isLoading}
                                        className="gap-1.5 flex-1 md:flex-none hover:bg-primary/10 hover:text-primary"
                                    >
                                        <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                                        Re-analyze
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="grid gap-6 p-6 relative z-10">
                            {/* AI Insights Box */}
                            <div className="bg-primary/5 rounded-lg border border-primary/10 p-4 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-3 opacity-10">
                                    <Brain className="w-24 h-24 text-primary" />
                                </div>
                                <div className="relative z-10">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2 flex items-center gap-2">
                                        <Brain className="w-3.5 h-3.5" /> AI Insight
                                    </h4>
                                    <p className="text-sm text-foreground/80 leading-relaxed">
                                        {scrapedProfile.summary || scrapedProfile.experience_summary || "Analyzing interaction patterns and career trajectory..."}
                                    </p>
                                </div>
                            </div>

                            {/* Two Column Grid for Desktop */}
                            <div className="grid md:grid-cols-2 gap-6">
                                {/* Experience & Career Path */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                                        <Briefcase className="w-4 h-4 text-primary/80" /> Proven Pedigree
                                    </div>

                                    <div className="space-y-4 bg-accent/20 p-4 rounded-lg border border-border/30 hover:border-border/50 transition-colors">
                                        <div className="flex items-center justify-between">
                                            <Badge variant="outline" className="bg-emerald-500/5 text-emerald-500 border-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                                                {scrapedProfile.seniority_level || "Unknown Level"}
                                            </Badge>
                                            <span className="text-sm font-medium text-foreground/90">
                                                {scrapedProfile.total_years_experience || "0"} Years Exp.
                                            </span>
                                        </div>

                                        {/* Work History List */}
                                        <div className="space-y-3 pt-2 border-t border-border/30">
                                            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Work History</div>
                                            {scrapedProfile.work_history && scrapedProfile.work_history.length > 0 ? (
                                                <div className="space-y-3">
                                                    {scrapedProfile.work_history?.slice(0, 3).map((job: any, index: number) => (
                                                        <div key={index} className="text-xs group/job">
                                                            <div className="font-medium text-foreground flex justify-between">
                                                                <span>{job.title}</span>
                                                                <span className="text-muted-foreground/50 text-[10px] ml-2 shrink-0">{job.date_range || job.duration}</span>
                                                            </div>
                                                            <div className="text-muted-foreground group-hover/job:text-primary/80 transition-colors">
                                                                {job.company}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {scrapedProfile.work_history.length > 3 && (
                                                        <div className="text-[10px] text-muted-foreground/50 italic mt-1">
                                                            +{scrapedProfile.work_history.length - 3} more roles
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-muted-foreground italic">No work history found</div>
                                            )}
                                        </div>

                                        {/* Past Companies Cloud */}
                                        {scrapedProfile.past_companies && scrapedProfile.past_companies.length > 0 && (
                                            <div className="space-y-2 pt-2 border-t border-border/30">
                                                <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Company DNA</div>
                                                <div className="flex overflow-x-auto pb-2 gap-2 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                                                    {scrapedProfile.past_companies?.map((company: string, i: number) => (
                                                        <div key={i} className="whitespace-nowrap px-2.5 py-1 text-xs font-medium text-foreground/80 bg-accent/30 rounded border border-border/40 flex-shrink-0">
                                                            {company}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Industry Focus */}
                                        {scrapedProfile.work_history && scrapedProfile.work_history.length > 0 && scrapedProfile.work_history[0].industry && (
                                            <div className="pt-2 border-t border-border/30 flex items-center gap-2 text-xs text-muted-foreground">
                                                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                                                Focused in <span className="text-foreground/80 font-medium">{scrapedProfile.work_history[0].industry}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Education & Skills */}
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                                        <GraduationCap className="w-4 h-4 text-primary/80" /> Skills & Education
                                    </div>

                                    <div className="space-y-4 bg-accent/20 p-4 rounded-lg border border-border/30 hover:border-border/50 transition-colors h-full">
                                        <div className="space-y-2">
                                            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Top Skills</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {(scrapedProfile.top_skills && scrapedProfile.top_skills.length > 0) ? (
                                                    <>
                                                        {scrapedProfile.top_skills?.slice(0, 5).map((skill: string, i: number) => (
                                                            <Badge key={i} variant="secondary" className="bg-background/40 hover:bg-background/60 text-foreground/90 border-border/40 text-xs py-0.5">
                                                                {skill}
                                                            </Badge>
                                                        ))}
                                                        {scrapedProfile.top_skills.length > 5 && (
                                                            <Badge variant="outline" className="border-dashed border-border text-muted-foreground text-xs py-0.5">
                                                                +{scrapedProfile.top_skills.length - 5} more
                                                            </Badge>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground italic">No skills found</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t border-border/30">
                                            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider block mb-2">Education</span>

                                            {scrapedProfile.education && scrapedProfile.education.length > 0 ? (
                                                <div className="space-y-3">
                                                    {scrapedProfile.education?.map((edu: any, index: number) => (
                                                        <div key={index} className="text-xs">
                                                            <div className="font-medium text-foreground">{edu.school || "Unknown School"}</div>
                                                            <div className="text-muted-foreground">{edu.degree || edu.field_of_study ? `${edu.degree || ''} ${edu.field_of_study || ''}` : edu.display}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-muted-foreground italic">
                                                    {scrapedProfile.education_summary || "No education history found"}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
};
