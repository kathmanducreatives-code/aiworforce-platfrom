import { ICPFormData } from "@/types/icp";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { GraduationCap, Briefcase, Brain, Clock } from "lucide-react";

interface FeatureWeightFormProps {
    value: ICPFormData;
    onChange: (data: ICPFormData) => void;
}

export const FeatureWeightForm = ({ value, onChange }: FeatureWeightFormProps) => {

    const handleToggle = (key: keyof typeof value.featureWeights) => {
        onChange({
            ...value,
            featureWeights: {
                ...value.featureWeights,
                [key]: !value.featureWeights?.[key]
            }
        });
    };

    const features = [
        {
            id: "education",
            label: "Degree & Education",
            description: "Match school tier and degree level",
            icon: GraduationCap
        },
        {
            id: "experience",
            label: "Experience Path",
            description: "Match people who worked at similar past companies",
            icon: Briefcase
        },
        {
            id: "skills",
            label: "Skill Density",
            description: "Match the top 5 most mentioned skills on the profile",
            icon: Brain
        },
        {
            id: "seniority",
            label: "Seniority",
            description: "Match total years in industry",
            icon: Clock
        }
    ] as const;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-2">
                <h3 className="text-lg font-medium">Feature Weighting</h3>
                <p className="text-sm text-muted-foreground">
                    Select which fields the AI should "Double Down" on to find candidates similar to your Lookalike.
                </p>
            </div>

            <div className="grid gap-4">
                {features.map((feature) => {
                    const isChecked = Boolean(value.featureWeights?.[feature.id]);
                    const Icon = feature.icon;
                    return (
                        <Card
                            key={feature.id}
                            className={`p-4 cursor-pointer transition-all duration-200 border-2 ${isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                                }`}
                            onClick={() => handleToggle(feature.id)}
                        >
                            <div className="flex items-start gap-4">
                                <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => handleToggle(feature.id)}
                                    className="mt-1"
                                />
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Icon className={`w-4 h-4 ${isChecked ? "text-primary" : "text-muted-foreground"}`} />
                                        <Label className="font-medium cursor-pointer">{feature.label}</Label>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        {feature.description}
                                    </p>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};
