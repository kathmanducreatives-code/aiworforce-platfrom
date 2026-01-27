import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ICPFormData } from "@/types/icp";
import { AlertCircle } from "lucide-react";

interface SmartScoringFormProps {
    value: ICPFormData;
    onChange: (value: ICPFormData) => void;
}

export const SmartScoringForm = ({ value, onChange }: SmartScoringFormProps) => {
    const total = Object.values(value.scoring_weights).reduce((sum, val) => sum + val, 0);
    const isValid = total === 100;

    const updateWeight = (key: keyof typeof value.scoring_weights, newValue: number) => {
        onChange({
            ...value,
            scoring_weights: {
                ...value.scoring_weights,
                [key]: newValue,
            },
        });
    };

    return (
        <div className="space-y-6">
            <div className="px-1">
                <p className="text-sm text-muted-foreground mb-4">
                    Adjust the importance of each matching criterion. Weights must sum to 100%.
                </p>

                {/* Total Weight Indicator */}
                <div className={`mb-6 p-4 rounded-lg border ${isValid
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-yellow-500/10 border-yellow-500/20'
                    }`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {!isValid && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                            <span className="text-sm font-medium">Total Weight</span>
                        </div>
                        <span className={`text-2xl font-bold ${isValid ? 'text-green-500' : 'text-yellow-500'
                            }`}>
                            {total}%
                        </span>
                    </div>
                    {!isValid && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                            Adjust weights to sum to exactly 100%
                        </p>
                    )}
                </div>

                {/* Industry Weight */}
                <div className="space-y-3 mb-6">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="industry_weight">Industry Match</Label>
                        <span className="text-sm font-medium text-primary">{value.scoring_weights.industry}%</span>
                    </div>
                    <Slider
                        id="industry_weight"
                        value={[value.scoring_weights.industry]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(vals) => updateWeight('industry', vals[0])}
                        className="w-full"
                    />
                </div>

                {/* Revenue Weight */}
                <div className="space-y-3 mb-6">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="revenue_weight">Revenue Match</Label>
                        <span className="text-sm font-medium text-primary">{value.scoring_weights.revenue}%</span>
                    </div>
                    <Slider
                        id="revenue_weight"
                        value={[value.scoring_weights.revenue]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(vals) => updateWeight('revenue', vals[0])}
                        className="w-full"
                    />
                </div>

                {/* Size Weight */}
                <div className="space-y-3 mb-6">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="size_weight">Company Size Match</Label>
                        <span className="text-sm font-medium text-primary">{value.scoring_weights.size}%</span>
                    </div>
                    <Slider
                        id="size_weight"
                        value={[value.scoring_weights.size]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(vals) => updateWeight('size', vals[0])}
                        className="w-full"
                    />
                </div>

                {/* Tech Stack Weight */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="tech_weight">Tech Stack Match</Label>
                        <span className="text-sm font-medium text-primary">{value.scoring_weights.tech}%</span>
                    </div>
                    <Slider
                        id="tech_weight"
                        value={[value.scoring_weights.tech]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={(vals) => updateWeight('tech', vals[0])}
                        className="w-full"
                    />
                </div>
            </div>
        </div>
    );
};
