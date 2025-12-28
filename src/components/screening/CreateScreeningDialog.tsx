import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain, Mail, Loader2, Copy, Check, Search, UserPlus, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TemplateSelector } from "./TemplateSelector";

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

type Step = "template" | "candidate" | "configure";

const CreateScreeningDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: CreateScreeningDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [scenarioCount, setScenarioCount] = useState("3");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [sendEmail, setSendEmail] = useState(true);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>("template");

  useEffect(() => {
    if (open) {
      fetchCandidates();
    } else {
      // Reset state on close
      setSelectedTemplateId(null);
      setSelectedCandidate(null);
      setGeneratedUrl(null);
      setCopied(false);
      setSearchQuery("");
      setCurrentStep("template");
    }
  }, [open]);

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
          scenario_count: parseInt(scenarioCount),
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
    if (currentStep === "template") setCurrentStep("candidate");
    else if (currentStep === "candidate") setCurrentStep("configure");
  };

  const goToPrevStep = () => {
    if (currentStep === "configure") setCurrentStep("candidate");
    else if (currentStep === "candidate") setCurrentStep("template");
  };

  const canProceed = () => {
    if (currentStep === "template") return !!selectedTemplateId;
    if (currentStep === "candidate") return !!selectedCandidate;
    return true;
  };

  const getStepNumber = () => {
    if (currentStep === "template") return 1;
    if (currentStep === "candidate") return 2;
    return 3;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Create Behavioral Screening
          </DialogTitle>
          <DialogDescription>
            {generatedUrl 
              ? "Your screening link is ready"
              : `Step ${getStepNumber()} of 3: ${
                  currentStep === "template" ? "Select Template" :
                  currentStep === "candidate" ? "Select Candidate" :
                  "Configure & Generate"
                }`
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
          <div className="space-y-4">
            {/* Step 1: Template Selection */}
            {currentStep === "template" && (
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Select Screening Template
                </Label>
                <ScrollArea className="h-64">
                  <TemplateSelector
                    selectedTemplateId={selectedTemplateId}
                    onSelect={setSelectedTemplateId}
                  />
                </ScrollArea>
              </div>
            )}

            {/* Step 2: Candidate Selection */}
            {currentStep === "candidate" && (
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
                <ScrollArea className="h-48 border rounded-lg">
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
            )}

            {/* Step 3: Configuration */}
            {currentStep === "configure" && selectedCandidate && (
              <>
                {/* Selected Candidate Display */}
                <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{selectedCandidate.candidate_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedCandidate.email || 'No email'} • {selectedCandidate.recruitment_name || 'No position'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Configuration Options */}
                <div className="space-y-2">
                  <Label>Number of Scenarios</Label>
                  <Select value={scenarioCount} onValueChange={setScenarioCount}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 scenarios (~8 min)</SelectItem>
                      <SelectItem value="3">3 scenarios (~12 min)</SelectItem>
                      <SelectItem value="4">4 scenarios (~15 min)</SelectItem>
                    </SelectContent>
                  </Select>
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

        <DialogFooter>
          {generatedUrl ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <div className="flex w-full justify-between">
              <Button
                variant="outline"
                onClick={currentStep === "template" ? handleClose : goToPrevStep}
              >
                {currentStep === "template" ? (
                  "Cancel"
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Back
                  </>
                )}
              </Button>
              
              {currentStep === "configure" ? (
                <Button 
                  onClick={handleGenerate} 
                  disabled={isLoading}
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
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateScreeningDialog;
