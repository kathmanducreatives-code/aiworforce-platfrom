import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Brain, Loader2, ChevronLeft, ChevronRight, Sparkles, Eye, Sliders, Share2 } from "lucide-react";
import { RequirementsForm, RequirementsData } from "./RequirementsForm";
import { QuestionPreview, GeneratedQuestion } from "./QuestionPreview";
import { InterviewSettingsForm, InterviewSettings } from "./InterviewSettingsForm";
import { ShareScreening } from "./ShareScreening";

interface CreateScreeningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = "requirements" | "preview" | "settings" | "share";

const DEFAULT_REQUIREMENTS: RequirementsData = {
  free_text: "",
  role_title: "",
  industry: "",
  experience_level: "mid",
  required_skills: [],
  culture_keywords: [],
};

const DEFAULT_SETTINGS: InterviewSettings = {
  questionCount: 8,
  enabledTypes: ["accountability", "culture_fit", "red_flag", "skill"],
};

const STEP_META: Record<Step, { number: number; label: string; icon: React.ReactNode }> = {
  requirements: { number: 1, label: "Define Requirements", icon: <Sparkles className="w-4 h-4" /> },
  preview: { number: 2, label: "Preview Questions", icon: <Eye className="w-4 h-4" /> },
  settings: { number: 3, label: "Interview Settings", icon: <Sliders className="w-4 h-4" /> },
  share: { number: 4, label: "Share Screening", icon: <Share2 className="w-4 h-4" /> },
};

const CreateScreeningDialog = ({ open, onOpenChange, onSuccess }: CreateScreeningDialogProps) => {
  const [currentStep, setCurrentStep] = useState<Step>("requirements");
  const [requirements, setRequirements] = useState<RequirementsData>(DEFAULT_REQUIREMENTS);
  const [generatedQuestions, setGeneratedQuestions] = useState<GeneratedQuestion[]>([]);
  const [settings, setSettings] = useState<InterviewSettings>(DEFAULT_SETTINGS);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrentStep("requirements");
      setRequirements(DEFAULT_REQUIREMENTS);
      setGeneratedQuestions([]);
      setSettings(DEFAULT_SETTINGS);
      setGeneratedUrl(null);
    }
  }, [open]);

  const canProceed = () => {
    switch (currentStep) {
      case "requirements": return !!requirements.role_title && requirements.required_skills.length > 0;
      case "preview": return generatedQuestions.length > 0;
      case "settings": return settings.enabledTypes.length > 0 && settings.questionCount >= 5;
      default: return true;
    }
  };

  const goNext = () => {
    const steps: Step[] = ["requirements", "preview", "settings", "share"];
    const idx = steps.indexOf(currentStep);
    if (idx < steps.length - 1) setCurrentStep(steps[idx + 1]);
  };

  const goBack = () => {
    const steps: Step[] = ["requirements", "preview", "settings", "share"];
    const idx = steps.indexOf(currentStep);
    if (idx > 0) setCurrentStep(steps[idx - 1]);
  };

  const meta = STEP_META[currentStep];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {meta.icon}
            AI Behavioral Screening
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground">
              Step {meta.number} of 4
            </span>
            <span>{meta.label}</span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
          <div className="pr-4 pb-4 space-y-4">
            {currentStep === "requirements" && (
              <RequirementsForm value={requirements} onChange={setRequirements} />
            )}

            {currentStep === "preview" && (
              <QuestionPreview
                requirements={requirements}
                questions={generatedQuestions}
                onQuestionsChange={setGeneratedQuestions}
              />
            )}

            {currentStep === "settings" && (
              <InterviewSettingsForm
                value={settings}
                onChange={setSettings}
                questions={generatedQuestions}
              />
            )}

            {currentStep === "share" && (
              <ShareScreening
                requirements={requirements}
                questions={generatedQuestions}
                settings={settings}
                generatedUrl={generatedUrl}
                onUrlGenerated={(url) => {
                  setGeneratedUrl(url);
                  onSuccess?.();
                }}
              />
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <div className="flex w-full justify-between">
            <Button
              variant="outline"
              onClick={currentStep === "requirements" ? () => onOpenChange(false) : goBack}
            >
              {currentStep === "requirements" ? "Cancel" : (
                <>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </>
              )}
            </Button>

            {currentStep !== "share" && (
              <Button onClick={goNext} disabled={!canProceed()}>
                {currentStep === "requirements" ? (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Generate Questions
                  </>
                ) : (
                  "Next"
                )}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}

            {currentStep === "share" && (
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateScreeningDialog;
