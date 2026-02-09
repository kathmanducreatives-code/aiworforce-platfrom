import { ICPFormData } from "@/types/icp";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface PersonaIntentFormProps {
    value: ICPFormData;
    onChange: (data: ICPFormData) => void;
}

export const PersonaIntentForm = ({ value, onChange }: PersonaIntentFormProps) => {
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-2">
                <h3 className="text-lg font-medium text-foreground">Persona Intent</h3>
                <p className="text-sm text-muted-foreground">
                    Define the core traits and requirements for your ideal candidate.
                </p>
            </div>

            <Card className="backdrop-blur-xl bg-black/30 border-white/20 shadow-lg">
                <CardContent className="p-6 space-y-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-primary/20">
                            <Sparkles className="w-5 h-5 text-primary" />
                        </div>
                        <div className="space-y-1 flex-1">
                            <Label htmlFor="requirements" className="text-base font-semibold">
                                Candidate Requirements
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Explain in plain English who you are looking for (e.g., specific skills, traits, or background).
                            </p>
                        </div>
                    </div>

                    <div className="relative">
                        <Textarea
                            id="requirements"
                            placeholder="I'm looking for a Product Manager with 5+ years of experience in B2B SaaS, specifically with API-first products. They should have a background in engineering or data science..."
                            className="min-h-[200px] resize-none bg-black/20 border-white/10 focus:border-primary/50 text-base leading-relaxed p-4"
                            value={value.candidate_requirements || ""}
                            maxLength={500}
                            onChange={(e) => onChange({ ...value, candidate_requirements: e.target.value })}
                        />
                        <div className="absolute bottom-3 right-3 text-xs text-muted-foreground bg-black/40 px-2 py-1 rounded backdrop-blur-md">
                            {(value.candidate_requirements || "").length}/500 characters
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
