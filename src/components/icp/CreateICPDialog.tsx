import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ICPProfile, ICPFormData } from "@/types/icp";
import { CompanyBlueprintForm } from "./CompanyBlueprintForm";
import { TechStackForm } from "./TechStackForm";
import { SmartScoringForm } from "./SmartScoringForm";
import { toast } from "sonner";

interface CreateICPDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: (profile: ICPProfile) => void;
}

type Step = "blueprint" | "tech" | "scoring";

const DEFAULT_FORM_DATA: ICPFormData = {
    name: "",
    industries: [],
    revenue_range: "",
    company_size: "",
    tech_stack: [],
    scoring_weights: {
        industry: 25,
        revenue: 25,
        size: 25,
        tech: 25,
    },
};

export const CreateICPDialog = ({ open, onOpenChange, onSuccess }: CreateICPDialogProps) => {
    const [currentStep, setCurrentStep] = useState<Step>("blueprint");
    const [formData, setFormData] = useState<ICPFormData>(DEFAULT_FORM_DATA);

    const getStepNumber = () => {
        if (currentStep === "blueprint") return 1;
        if (currentStep === "tech") return 2;
        return 3;
    };

    const getStepLabel = () => {
        switch (currentStep) {
            case "blueprint": return "Company Blueprint";
            case "tech": return "Tech Stack";
            case "scoring": return "Smart Scoring";
        }
    };

    const canProceed = () => {
        if (currentStep === "blueprint") {
            return formData.name.trim() && formData.industries.length > 0 && formData.revenue_range && formData.company_size;
        }
        if (currentStep === "tech") {
            return true; // Tech stack is optional
        }
        if (currentStep === "scoring") {
            const total = Object.values(formData.scoring_weights).reduce((sum, val) => sum + val, 0);
            return total === 100;
        }
        return true;
    };

    const goToNextStep = () => {
        if (currentStep === "blueprint") setCurrentStep("tech");
        else if (currentStep === "tech") setCurrentStep("scoring");
    };

    const goToPrevStep = () => {
        if (currentStep === "scoring") setCurrentStep("tech");
        else if (currentStep === "tech") setCurrentStep("blueprint");
    };

    const handleCreate = () => {
        if (!canProceed()) {
            toast.error("Please ensure scoring weights sum to 100%");
            return;
        }

        const newProfile: ICPProfile = {
            id: `icp_${Date.now()}`,
            ...formData,
            target_score: 75, // Default target score
            created_at: new Date().toISOString(),
        };

        onSuccess(newProfile);
        setFormData(DEFAULT_FORM_DATA);
        setCurrentStep("blueprint");
        toast.success("ICP Profile created successfully!");
    };

    const handleClose = () => {
        setFormData(DEFAULT_FORM_DATA);
        setCurrentStep("blueprint");
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-2xl max-h-[95vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <DialogTitle>Create ICP Profile</DialogTitle>
                    <DialogDescription className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground">
                            Step {getStepNumber()} of 3
                        </span>
                        <span>{getStepLabel()}</span>
                    </DialogDescription>
                </DialogHeader>

                {/* Form Content */}
                <div className="flex-1 min-h-0 overflow-y-auto px-1">
                    <div className="space-y-6 py-4">
                        {currentStep === "blueprint" && (
                            <CompanyBlueprintForm
                                value={formData}
                                onChange={setFormData}
                            />
                        )}

                        {currentStep === "tech" && (
                            <TechStackForm
                                value={formData}
                                onChange={setFormData}
                            />
                        )}

                        {currentStep === "scoring" && (
                            <SmartScoringForm
                                value={formData}
                                onChange={setFormData}
                            />
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 flex justify-between pt-4 border-t">
                    <Button
                        variant="outline"
                        onClick={currentStep === "blueprint" ? handleClose : goToPrevStep}
                    >
                        {currentStep === "blueprint" ? (
                            "Cancel"
                        ) : (
                            <>
                                <ChevronLeft className="w-4 h-4 mr-1" />
                                Back
                            </>
                        )}
                    </Button>

                    {currentStep === "scoring" ? (
                        <Button
                            onClick={handleCreate}
                            disabled={!canProceed()}
                            className="bg-primary hover:bg-primary/90"
                        >
                            Create Profile
                        </Button>
                    ) : (
                        <Button
                            onClick={goToNextStep}
                            disabled={!canProceed()}
                        >
                            Next
                            <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
