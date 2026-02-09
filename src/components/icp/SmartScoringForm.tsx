
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button"; // Added Button
import { ICPFormData } from "@/types/icp";
import { AlertCircle, Calculator, Loader2, CheckCircle2 } from "lucide-react";
import { screeningAPI } from "@/lib/api/screening"; // Import API
import { toast } from "sonner";

interface SmartScoringFormProps {
    value: ICPFormData;
    onChange: (value: ICPFormData) => void;
}

export const SmartScoringForm = ({ value, onChange }: SmartScoringFormProps) => {
    const [isCalculating, setIsCalculating] = useState(false);
    const [calculatedScore, setCalculatedScore] = useState<{ score: number; match_level: string } | null>(null);

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
        // Reset calculation if weights change
        if (calculatedScore) setCalculatedScore(null);
    };

    const handleCalculate = async () => {
        if (!isValid) {
            toast.error("Weights must sum to 100%");
            return;
        }

        setIsCalculating(true);
        try {
            const result = await screeningAPI.calculateICPScore({
                icp_data: {
                    weights: value.scoring_weights
                }
            });

            setCalculatedScore(result);
            toast.success("Match Score Calculated!");

            // Optionally update parent state if there's a field for target_score
            // onChange({ ...value, target_score: result.score });

        } catch (error) {
            console.error("Calculation failed", error);
            toast.error("Failed to calculate score. Please try again.");
        } finally {
            setIsCalculating(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-[400px]">
            {/* Added min-height auto equivalent via min-h class and ensuring container grows */}
            <div className="px-1 space-y-6">
                <div>
                    <h3 className="text-lg font-medium mb-2">Smart Scoring Configuration</h3>
                    <p className="text-sm text-muted-foreground">
                        Adjust the importance of each matching criterion and calculate the projected match confidence.
                    </p>
                </div>

                {/* Total Weight Indicator */}
                <div className={`p - 4 rounded - lg border transition - colors ${isValid
                        ? 'bg-green-500/10 border-green-500/20'
                        : 'bg-yellow-500/10 border-yellow-500/20'
                    } `}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {!isValid && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                            <span className="text-sm font-medium">Total Weight Distribution</span>
                        </div>
                        <span className={`text - 2xl font - bold ${isValid ? 'text-green-500' : 'text-yellow-500'
                            } `}>
                            {total}%
                        </span>
                    </div>
                </div>

                {/* Weights Sliders */}
                <div className="grid gap-6">
                    <WeightSlider
                        label="Industry Match"
                        value={value.scoring_weights.industry}
                        onChange={(v) => updateWeight('industry', v)}
                    />
                    <WeightSlider
                        label="Revenue Match"
                        value={value.scoring_weights.revenue}
                        onChange={(v) => updateWeight('revenue', v)}
                    />
                    <WeightSlider
                        label="Company Size Match"
                        value={value.scoring_weights.size}
                        onChange={(v) => updateWeight('size', v)}
                    />
                    <WeightSlider
                        label="Tech Stack Match"
                        value={value.scoring_weights.tech}
                        onChange={(v) => updateWeight('tech', v)}
                    />
                </div>

                {/* Calculation Section */}
                <div className="pt-4 border-t">
                    <div className="flex items-center justify-between">
                        <Button
                            onClick={handleCalculate}
                            disabled={!isValid || isCalculating}
                            className="w-full sm:w-auto"
                        >
                            {isCalculating ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    AI is calculating match scores...
                                </>
                            ) : (
                                <>
                                    <Calculator className="w-4 h-4 mr-2" />
                                    Calculate Projected Match Score
                                </>
                            )}
                        </Button>

                        {calculatedScore && (
                            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4">
                                <span className="text-sm text-muted-foreground">Projected Score:</span>
                                <div className="flex items-center gap-2 bg-primary/10 px-3 py-1.5 rounded-full">
                                    <CheckCircle2 className="w-4 h-4 text-primary" />
                                    <span className="font-bold text-primary">{calculatedScore.score}/100</span>
                                    <span className="text-xs text-primary/80">({calculatedScore.match_level})</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helper component for cleaner code
const WeightSlider = ({ label, value, onChange }: { label: string, value: number, onChange: (v: number) => void }) => (
    <div className="space-y-3">
        <div className="flex items-center justify-between">
            <Label>{label}</Label>
            <span className="text-sm font-medium text-primary bg-primary/10 px-2 py-0.5 rounded">{value}%</span>
        </div>
        <Slider
            value={[value]}
            min={0}
            max={100}
            step={5}
            onValueChange={(vals) => onChange(vals[0])}
            className="w-full"
        />
    </div>
);

