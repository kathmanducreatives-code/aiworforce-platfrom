import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain, Mail, Loader2, Copy, Check, Search, UserPlus, ChevronLeft, ChevronRight, FileText, Briefcase, Sliders } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TemplateSelector } from "./TemplateSelector";
import { RoleBriefingForm, RoleBriefing } from "./RoleBriefingForm";
import { ScenarioCoverageConfig, ScenarioConfig } from "./ScenarioCoverageConfig";
import { TemplatePreviewDialog } from "./TemplatePreviewDialog";

interface Candidate {
  id: string;
  candidate_name: string;
  email: string | null;
  recruitment_name: string | null;
}

interface CreateScreeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = "role_briefing" | "template" | "scenario_coverage" | "candidate";

const DEFAULT_ROLE_BRIEFING: RoleBriefing = {
  role_title: "",
  skills_expected: "",
  experience_required: "",
  key_traits: [],
};

const DEFAULT_SCENARIO_CONFIG: ScenarioConfig = {
  total_limit: 3,
  category_limits: {
    ambiguity: 1,
    accountability: 1,
    time_pressure: 1,
    competing_priorities: 0,
    conflict_resolution: 0,
  },
};

const CreateScreeningDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: CreateScreeningDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Step 1: Role Briefing
  const [roleBriefing, setRoleBriefing] = useState<RoleBriefing>(DEFAULT_ROLE_BRIEFING);
  
  // Step 2: Template Selection
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateCategoryCounts, setTemplateCategoryCounts] = useState<Record<string, number>>({});
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  
  // Step 3: Scenario Coverage
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig>(DEFAULT_SCENARIO_CONFIG);
  
  // Step 4: Candidate Selection
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [sendEmail, setSendEmail] = useState(true);
  
  // Result
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>("role_briefing");

  useEffect(() => {
    if (open) {
      fetchCandidates();
    } else {
      // Reset state on close
      setRoleBriefing(DEFAULT_ROLE_BRIEFING);
      setSelectedTemplateId(null);
      setTemplateCategoryCounts({});
      setScenarioConfig(DEFAULT_SCENARIO_CONFIG);
      setSelectedCandidate(null);
      setGeneratedUrl(null);
      setCopied(false);
      setSearchQuery("");
      setCurrentStep("role_briefing");
    }
  }, [open]);

  // Fetch template category counts when template is selected
  useEffect(() => {
    if (selectedTemplateId) {
      fetchTemplateCategoryCounts(selectedTemplateId);
    }
  }, [selectedTemplateId]);

  const fetchCandidates = async () => {
    const { data, error } = await supabase
      .from('resume_analyses')
      .select('id, candidate_name, email, recruitment_name')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to fetch candidates:', error);
      return;
    }

    setCandidates(data || []);
  };

  const fetchTemplateCategoryCounts = async (templateId: string) => {
    const { data, error } = await supabase
      .from('screening_template_questions')
      .select('category')
      .eq('template_id', templateId);
    
    if (error) {
      console.error('Failed to fetch template questions:', error);
      return;
    }

    const counts: Record<string, number> = {};
    data?.forEach(q => {
      counts[q.category] = (counts[q.category] || 0) + 1;
    });
    setTemplateCategoryCounts(counts);

    // Update scenario config with available categories
    const newLimits: Record<string, number> = {};
    Object.keys(counts).forEach(cat => {
      newLimits[cat] = Math.min(counts[cat], 1);
    });
    setScenarioConfig(prev => ({
      ...prev,
      category_limits: { ...prev.category_limits, ...newLimits },
    }));
  };

  const filteredCandidates = candidates.filter(c =>
    c.candidate_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.recruitment_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleGenerate = async () => {
    if (!selectedCandidate) {
      toast.error('Please select a candidate');
      return;
    }

    try {
      setIsLoading(true);

      const { data, error } = await supabase.functions.invoke('generate-screening-invite', {
        body: {
          candidate_id: selectedCandidate.id,
          template_id: selectedTemplateId,
          role_briefing: roleBriefing.role_title ? roleBriefing : null,
          scenario_config: scenarioConfig,
          scenario_count: scenarioConfig.total_limit,
          expires_in_days: parseInt(expiresInDays),
          send_email: sendEmail && !!selectedCandidate.email,
        },
      });

      if (error) throw error;

      setGeneratedUrl(data.screening_url);

      if (data.existing) {
        toast.info('An active screening session already exists for this candidate');
      } else {
        toast.success(
          sendEmail && selectedCandidate.email
            ? 'Screening invite sent successfully!'
            : 'Screening link generated!'
        );
      }

      onSuccess?.();

    } catch (err: any) {
      console.error('Failed to generate invite:', err);
      toast.error('Failed to generate screening invite');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedUrl) return;
    
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const goToNextStep = () => {
    if (currentStep === "role_briefing") setCurrentStep("template");
    else if (currentStep === "template") setCurrentStep("scenario_coverage");
    else if (currentStep === "scenario_coverage") setCurrentStep("candidate");
  };

  const goToPrevStep = () => {
    if (currentStep === "candidate") setCurrentStep("scenario_coverage");
    else if (currentStep === "scenario_coverage") setCurrentStep("template");
    else if (currentStep === "template") setCurrentStep("role_briefing");
  };

  const canProceed = () => {
    if (currentStep === "role_briefing") return true; // Optional step
    if (currentStep === "template") return !!selectedTemplateId;
    if (currentStep === "scenario_coverage") return scenarioConfig.total_limit > 0;
    if (currentStep === "candidate") return !!selectedCandidate;
    return true;
  };

  const getStepNumber = () => {
    if (currentStep === "role_briefing") return 1;
    if (currentStep === "template") return 2;
    if (currentStep === "scenario_coverage") return 3;
    return 4;
  };

  const getStepLabel = () => {
    switch (currentStep) {
      case "role_briefing": return "Role Briefing";
      case "template": return "Select Template";
      case "scenario_coverage": return "Scenario Coverage";
      case "candidate": return "Select Candidate & Generate";
    }
  };

  const getStepIcon = () => {
    switch (currentStep) {
      case "role_briefing": return <Briefcase className="w-4 h-4" />;
      case "template": return <FileText className="w-4 h-4" />;
      case "scenario_coverage": return <Sliders className="w-4 h-4" />;
      case "candidate": return <UserPlus className="w-4 h-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStepIcon()}
            Create Behavioral Screening
          </DialogTitle>
          <DialogDescription>
            {generatedUrl 
              ? "Your screening link is ready"
              : `Step ${getStepNumber()} of 4: ${getStepLabel()}`
            }
          </DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <Label className="text-sm text-muted-foreground mb-2 block">Screening Link for {selectedCandidate?.candidate_name}</Label>
              <div className="flex gap-2">
                <code className="flex-1 bg-background p-2 rounded text-xs break-all">
                  {generatedUrl}
                </code>
                <Button size="icon" variant="outline" onClick={copyToClipboard}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {sendEmail && selectedCandidate?.email
                ? `An email has been sent to ${selectedCandidate.email} with this link.`
                : 'Share this link with the candidate to begin their screening.'}
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4 pr-4">
              {/* Step 1: Role Briefing */}
              {currentStep === "role_briefing" && (
                <RoleBriefingForm value={roleBriefing} onChange={setRoleBriefing} />
              )}

              {/* Step 2: Template Selection */}
              {currentStep === "template" && (
                <div className="space-y-3">
                  <TemplateSelector
                    selectedTemplateId={selectedTemplateId}
                    onSelect={setSelectedTemplateId}
                    onPreview={setPreviewTemplateId}
                  />
                </div>
              )}

              {/* Step 3: Scenario Coverage */}
              {currentStep === "scenario_coverage" && (
                <ScenarioCoverageConfig 
                  value={scenarioConfig} 
                  onChange={setScenarioConfig}
                  templateCategoryCounts={templateCategoryCounts}
                />
              )}

              {/* Step 4: Candidate Selection */}
              {currentStep === "candidate" && (
                <div className="space-y-4">
                  {/* Candidate Search */}
                  <div className="space-y-3">
                    <Label>Select Candidate</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name, email, or position..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <ScrollArea className="h-40 border rounded-lg">
                      <div className="p-2 space-y-1">
                        {filteredCandidates.length === 0 ? (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            No candidates found
                          </p>
                        ) : (
                          filteredCandidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              onClick={() => setSelectedCandidate(candidate)}
                              className={`w-full text-left p-3 rounded-lg transition-colors ${
                                selectedCandidate?.id === candidate.id
                                  ? "bg-primary/10 border border-primary/20"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <p className="font-medium">{candidate.candidate_name}</p>
                              <p className="text-sm text-muted-foreground">
                                {candidate.email || 'No email'} • {candidate.recruitment_name || 'No position'}
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Configuration when candidate is selected */}
                  {selectedCandidate && (
                    <>
                      <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                        <p className="font-medium">{selectedCandidate.candidate_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedCandidate.email || 'No email'} • {selectedCandidate.recruitment_name || 'No position'}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Link Expiration</Label>
                        <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="3">3 days</SelectItem>
                            <SelectItem value="7">7 days</SelectItem>
                            <SelectItem value="14">14 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {selectedCandidate.email && (
                        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">Send Email Invite</p>
                              <p className="text-xs text-muted-foreground">{selectedCandidate.email}</p>
                            </div>
                          </div>
                          <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
                        </div>
                      )}

                      {!selectedCandidate.email && (
                        <p className="text-sm text-muted-foreground">
                          No email on file. You'll receive a link to share manually.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          {generatedUrl ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <div className="flex w-full justify-between">
              <Button
                variant="outline"
                onClick={currentStep === "role_briefing" ? handleClose : goToPrevStep}
              >
                {currentStep === "role_briefing" ? (
                  "Cancel"
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back
                  </>
                )}
              </Button>
              
              {currentStep === "candidate" ? (
                <Button 
                  onClick={handleGenerate} 
                  disabled={isLoading || !selectedCandidate}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Brain className="w-4 h-4 mr-2" />
                      Generate Invite
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={goToNextStep} disabled={!canProceed()}>
                  {currentStep === "role_briefing" ? "Next (Optional)" : "Next"}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Template Preview Dialog */}
      <TemplatePreviewDialog
        templateId={previewTemplateId}
        open={!!previewTemplateId}
        onOpenChange={(open) => !open && setPreviewTemplateId(null)}
      />
    </Dialog>
  );
};

export default CreateScreeningDialog;
