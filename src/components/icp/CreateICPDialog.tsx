import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Rocket, Loader2, Save } from "lucide-react";
import { ICPProfile, ICPFormData, ICPDraft, ICPPhase, ICPCandidate } from "@/types/icp";
import { CompanyBlueprintForm } from "./CompanyBlueprintForm";
import { ICPCandidateCard } from "./ICPCandidateCard";
import { ICPCandidateModal } from "./ICPCandidateModal";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonaIntentForm } from "./PersonaIntentForm";
import { LookalikeForm } from "./LookalikeForm";
import { StrategyPreviewStep } from "./StrategyPreviewStep";
import { toast } from "sonner";
import { icpAPI } from "@/lib/api/icp";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";

interface CreateICPDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: (profile: ICPProfile, results?: any) => void;
}

type Step = "account" | "persona" | "lookalike" | "strategy";

const DEFAULT_FORM_DATA: ICPFormData = {
    name: "",
    industries: [],
    tech_stack: [],
    company_size: "",
    company_location: [],
    hiringIntensity: "Medium",
    target_results_count: 50,
    featureWeights: {
        education: 100,
        experience: 100,
        skills: 100,
        seniority: 100
    },
    scoring_weights: {
        industry: 25,
        revenue: 25,
        size: 25,
        tech: 25
    },
    candidate_requirements: "",
    generated_strategy: "",
    final_query: ""
};

export const CreateICPDialog = ({ open, onOpenChange, onSuccess }: CreateICPDialogProps) => {
    const [currentStep, setCurrentStep] = useState<Step>("account");
    const [formData, setFormData] = useState<ICPFormData>(DEFAULT_FORM_DATA);
    const [draftId, setDraftId] = useState<string>("");
    const [sessionId, setSessionId] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [liveResults, setLiveResults] = useState<any[] | null>(null);
    const [selectedCandidate, setSelectedCandidate] = useState<ICPCandidate | null>(null);

    const USER_ID = "user_v1_mock";
    const WORKSPACE_ID = "ws_v1_mock";

    useEffect(() => {
        if (open && !sessionId && !draftId) {
            const newSessionId = crypto.randomUUID();
            setSessionId(newSessionId);
            console.log('Detailed Debug: Generated new session_id on mount:', newSessionId);
        }
    }, [open, sessionId, draftId]);

    useEffect(() => {
        if (!open) {
            setFormData(DEFAULT_FORM_DATA);
            setCurrentStep("account");
            setDraftId("");
            setSessionId("");
            setLiveResults(null);
        } else {
            const savedDraftId = localStorage.getItem('active_icp_draft_id');
            if (savedDraftId) {
                console.log("Found active draft:", savedDraftId);
                setDraftId(savedDraftId);
                restoreDraft(savedDraftId);
            }
        }
    }, [open]);

    const restoreDraft = async (id: string) => {
        try {
            setIsLoading(true);
            const response = await icpAPI.loadDraft(id, USER_ID);

            if (!response || !response.success || !response.draft) {
                console.warn("Draft not found or error:", response.error);
                localStorage.removeItem('active_icp_draft_id');
                return;
            }

            const draft = response.draft as ICPDraft;
            console.log("Restoring draft state:", draft);

            const restoredData: ICPFormData = {
                ...DEFAULT_FORM_DATA,
                name: draft.role_titles?.[0] || "",
                industries: draft.industries || [],
                company_size: draft.company_size?.[0] || "",
                company_location: draft.company_location,
                hiringIntensity: draft.hiring_intensity,
                candidate_requirements: draft.candidate_requirements,
                lookalikeProfile: draft.extracted_profile,
                generated_strategy: draft.ai_targeting_strategy,
                strategyData: draft.execution_params,
            };

            setFormData(restoredData);
            setSessionId(id);

            switch (draft.current_phase) {
                case 'completed':
                case 'post_scrape_scored':
                case 'scrape_executed':
                case 'pre_scrape_ready':
                case 'ai_strategy_generated':
                    setCurrentStep("strategy");
                    break;
                case 'profile_extracted':
                    setCurrentStep("lookalike");
                    if (draft.candidate_requirements) setCurrentStep("strategy");
                    break;
                case 'input_collected':
                    if (draft.candidate_requirements) setCurrentStep("lookalike");
                    else setCurrentStep("persona");
                    break;
                default:
                    setCurrentStep("account");
            }

        } catch (err) {
            console.error("Failed to restore draft:", err);
            toast.error("Failed to restore previous session.");
        } finally {
            setIsLoading(false);
        }
    };

    const persistDraft = async (phase: ICPPhase, stepOverride?: Step) => {
        setIsLoading(true);
        try {
            const draftPayload: ICPDraft = {
                id: draftId || undefined,
                user_id: USER_ID,
                workspace_id: WORKSPACE_ID,
                version: 2,
                current_phase: phase,
                current_step: stepOverride ? (stepOverride === 'account' ? 1 : stepOverride === 'persona' ? 2 : stepOverride === 'lookalike' ? 3 : 4) : 1,
                role_titles: [formData.name],
                industries: formData.industries,
                company_size: [formData.company_size],
                company_location: formData.company_location || [],
                hiring_intensity: formData.hiringIntensity || 'Medium',
                candidate_requirements: formData.candidate_requirements,
                extracted_profile: formData.lookalikeProfile,
                ai_targeting_strategy: formData.generated_strategy || formData.strategyData?.search_logic_dna,
                execution_params: formData.strategyData,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const result = await icpAPI.saveDraft(draftPayload);
            if (result.success && result.draft_id) {
                setDraftId(result.draft_id);
                setSessionId(result.draft_id);
                localStorage.setItem('active_icp_draft_id', result.draft_id);
            }
        } catch (e) {
            console.error("Auto-save failed:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleNextStep = async () => {
        const currentSessionId = sessionId || draftId;

        if (!currentSessionId) {
            toast.error("Session not initialized. Please close and reopen the wizard.");
            return;
        }

        if (currentStep === "account") {
            try {
                setIsLoading(true);
                console.log('Detailed Debug: Step 1 - Sending with session_id:', currentSessionId);

                const result = await icpAPI.saveAccountDefinition({
                    session_id: currentSessionId,
                    account_data: {
                        name: formData.name,
                        industries: formData.industries,
                        size: formData.company_size,
                        location: formData.company_location,
                        hiring_intensity: formData.hiringIntensity
                    }
                });

                if (result.session_id) {
                    setSessionId(result.session_id);
                    if (!draftId) setDraftId(result.session_id);
                }

                await persistDraft('input_collected', 'persona');
                setCurrentStep("persona");
            } catch (e: any) {
                console.error("Failed to save account definition:", e);
                toast.error(e.message || "Failed to save account definition");
            } finally {
                setIsLoading(false);
            }
        }
        else if (currentStep === "persona") {
            try {
                if (!formData.candidate_requirements.trim()) {
                    toast.error("Please describe your ideal candidate");
                    return;
                }

                setIsLoading(true);
                console.log('Detailed Debug: Step 2 - Sending with session_id:', currentSessionId);

                await icpAPI.savePersonaIntent(currentSessionId, formData.candidate_requirements);

                await persistDraft('input_collected', 'lookalike');
                setCurrentStep("lookalike");
            } catch (e: any) {
                console.error("Failed to save persona:", e);
                toast.error(e.message || "Failed to save persona");
            } finally {
                setIsLoading(false);
            }
        }
        else if (currentStep === "lookalike") {
            if (formData.lookalikeProfile) {
                await persistDraft('profile_extracted', 'strategy');
                setCurrentStep("strategy");
            } else {
                toast.error("Please analyze a profile first.");
            }
        }
    };

    const handlePrevStep = () => {
        if (currentStep === "strategy") setCurrentStep("lookalike");
        else if (currentStep === "lookalike") setCurrentStep("persona");
        else if (currentStep === "persona") setCurrentStep("account");
    };

    const getStepNumber = () => {
        switch (currentStep) {
            case "account": return 1;
            case "persona": return 2;
            case "lookalike": return 3;
            case "strategy": return 4;
            default: return 1;
        }
    };

    const getStepLabel = () => {
        switch (currentStep) {
            case "account": return "Company Blueprint";
            case "persona": return "Persona Intent";
            case "lookalike": return "Lookalike Analysis";
            case "strategy": return "Strategy & Launch";
            default: return "";
        }
    };

    const canProceed = () => {
        switch (currentStep) {
            case "account":
                return formData.name.length > 0 && formData.industries.length > 0;
            case "persona":
                return !!formData.candidate_requirements && formData.candidate_requirements.length > 10;
            case "lookalike":
                return !!formData.lookalikeProfile;
            case "strategy":
                return true;
            default:
                return false;
        }
    };

    const navigate = useNavigate();

    const handleLaunch = async () => {
        const activeSessionId = sessionId || draftId;

        if (!activeSessionId) {
            toast.error("Session missing. Cannot launch.");
            return;
        }

        setIsLaunching(true);
        try {
            console.log('Detailed Debug: Step 4 - Launching with session_id:', activeSessionId);

            await persistDraft('pre_scrape_ready');
            const result = await icpAPI.startScraping(activeSessionId);
            await persistDraft('scrape_executed');

            toast.success("ICP Generation Launched!");
            onSuccess(formData as any, result);

            navigate(`/icp/results/${activeSessionId}`);
            onOpenChange(false);
        } catch (error) {
            console.error("Launch failed", error);
            toast.error("Strategy launch failed.");
        } finally {
            setIsLaunching(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[95vh] h-auto flex flex-col bg-background border border-primary/20 shadow-[0_0_15px_hsl(var(--primary)/0.1)] p-0 overflow-hidden text-foreground rounded-xl">
                <DialogHeader className="flex-shrink-0 p-6 border-b border-primary/30 bg-card">
                    <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">ICP Intelligence Wizard</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20 shadow-[0_0_10px_hsl(var(--primary)/0.1)]">
                            Step {getStepNumber()} of 4
                        </span>
                        <span className="text-muted-foreground ml-1 font-medium">{getStepLabel()}</span>
                        {sessionId && <span className="text-xs text-muted-foreground ml-auto font-mono opacity-70">ID: {sessionId.slice(0, 8)}...</span>}
                    </DialogDescription>
                </DialogHeader>

                {/* Form Content */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent">
                    {isLoading ? (
                        <div className="h-full flex flex-col items-center justify-center space-y-6">
                            {/* Scanning Animation */}
                            <div className="relative w-64 h-2 bg-card rounded-full overflow-hidden border border-border/30">
                                <div className="absolute top-0 left-0 h-full w-full bg-primary blur-[4px] animate-[scan-line_1.5s_infinite_linear]" />
                            </div>

                            <div className="text-center space-y-2">
                                <div className="text-lg font-medium text-foreground tracking-wide">
                                    Processing Data...
                                </div>
                                <p className="text-sm text-primary/80 font-mono">
                                    Analyzing input vector · saving context
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div key={currentStep} className="animate-in fade-in slide-in-from-right-8 duration-500 ease-out-quart">
                            {currentStep === "account" && (
                                <CompanyBlueprintForm value={formData} onChange={setFormData} />
                            )}
                            {currentStep === "persona" && (
                                <PersonaIntentForm value={formData} onChange={setFormData} />
                            )}
                            {currentStep === "lookalike" && (
                                <LookalikeForm
                                    value={formData}
                                    onChange={setFormData}
                                    sessionId={sessionId}
                                />
                            )}
                            {currentStep === "strategy" && (
                                <div className="space-y-6">
                                    <StrategyPreviewStep value={formData} onChange={setFormData} sessionId={sessionId} />

                                    {/* Live Results Section */}
                                    <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
                                        <h4 className="text-md font-medium mb-3 flex items-center gap-2 text-foreground">
                                            {isLaunching ? (
                                                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                                            ) : (
                                                <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.8)]" />
                                            )}
                                            {isLaunching ? "Scanning & Analyzing Candidates..." : "Deep Search Results"}
                                        </h4>

                                        {/* Loading Skeleton */}
                                        {isLaunching && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {[1, 2, 3].map((i) => (
                                                    <div key={i} className="h-[200px] bg-card border border-border/40 rounded-xl p-5 space-y-4">
                                                        <div className="flex gap-4">
                                                            <Skeleton className="w-12 h-12 rounded-full bg-muted" />
                                                            <div className="space-y-2 flex-1">
                                                                <Skeleton className="h-4 w-3/4 bg-muted" />
                                                                <Skeleton className="h-3 w-1/2 bg-muted" />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2 pl-3 border-l-2 border-muted">
                                                            <Skeleton className="h-3 w-full bg-muted" />
                                                            <Skeleton className="h-3 w-2/3 bg-muted" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Results Grid */}
                                        {liveResults && !isLaunching && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {liveResults?.map((candidate, idx) => (
                                                    <ICPCandidateCard
                                                        key={idx}
                                                        candidate={candidate}
                                                        onClick={() => setSelectedCandidate(candidate)}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        {/* Empty State */}
                                        {!isLaunching && (!liveResults || liveResults.length === 0) && (
                                            <div className="relative text-center py-14 border border-dashed border-border/30 rounded-2xl bg-gradient-to-b from-card/60 to-background/40 overflow-hidden">
                                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,hsl(var(--primary)/0.03),transparent_70%)]" />
                                                <div className="relative space-y-2">
                                                    <div className="w-10 h-10 mx-auto rounded-xl bg-primary/10 flex items-center justify-center border border-primary/15 mb-3">
                                                        <Rocket className="w-5 h-5 text-primary/60" />
                                                    </div>
                                                    <p className="text-muted-foreground/80 text-sm font-medium">Launch the strategy to find candidates.</p>
                                                    <p className="text-muted-foreground/40 text-xs">Click "Start Scraping" to begin the search</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <ICPCandidateModal
                                candidate={selectedCandidate}
                                open={!!selectedCandidate}
                                onOpenChange={(open) => !open && setSelectedCandidate(null)}
                                onApprove={(c) => {
                                    toast.success(`${c.name} added to pipeline!`);
                                    setSelectedCandidate(null);
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 flex justify-between p-6 border-t border-primary/30 bg-card">
                    <Button
                        variant="ghost"
                        onClick={currentStep === "account" ? () => onOpenChange(false) : handlePrevStep}
                        className="hover:bg-accent text-muted-foreground hover:text-foreground"
                        disabled={isLoading || isLaunching}
                    >
                        {currentStep === "account" ? "Cancel" : <><ChevronLeft className="w-4 h-4 mr-1" /> Back</>}
                    </Button>

                    {currentStep === "strategy" ? (
                        <div className="flex gap-3">
                            <Button
                                variant="outline"
                                className="border-primary/30 text-primary hover:bg-primary/10 hover:border-primary gap-2 transition-all shadow-[0_0_10px_hsl(var(--primary)/0.05)]"
                                onClick={() => toast.success("Template saved!")}
                                disabled={isLaunching}
                            >
                                <Save className="w-4 h-4" />
                                Save as Template
                            </Button>

                            {liveResults && (
                                <Button onClick={() => onOpenChange(false)} variant="outline" className="border-border hover:bg-accent">
                                    Done
                                </Button>
                            )}
                            <Button
                                onClick={handleLaunch}
                                disabled={isLaunching || !formData.candidate_requirements}
                                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 shadow-[var(--shadow-glow)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.4)] min-w-[150px] font-semibold transition-all duration-300"
                            >
                                {isLaunching ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Scraping...
                                    </>
                                ) : (
                                    <>
                                        <Rocket className="w-4 h-4" />
                                        {liveResults ? "Restart Scrape" : "Start Scraping"}
                                    </>
                                )}
                            </Button>
                        </div>
                    ) : (
                        <Button
                            onClick={handleNextStep}
                            disabled={!canProceed() || isLoading}
                            className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-[var(--shadow-glow)] hover:shadow-[0_0_25px_hsl(var(--primary)/0.3)] transition-all duration-300"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Next <ChevronRight className="w-4 h-4 ml-1" /></>}
                        </Button>
                    )}
                </div>
            </DialogContent>

            {/* Debug info - remove after testing */}
            {open && (
                <div style={{ position: 'fixed', bottom: 10, left: 10, background: 'hsl(var(--background))', color: 'hsl(var(--primary))', padding: 8, fontSize: 12, fontFamily: 'monospace', zIndex: 9999, border: '1px solid hsl(var(--border))' }}>
                    Session: {sessionId || draftId || 'NOT SET'}
                </div>
            )}
        </Dialog>
    );
};
