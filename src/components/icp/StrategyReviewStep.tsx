import { ICPFormData } from "@/types/icp";
import { INDUSTRIES } from "@/data/industries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Rocket, Building2, MapPin, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface StrategyReviewStepProps {
    value: ICPFormData;
}

export const StrategyReviewStep = ({ value }: StrategyReviewStepProps) => {

    const getIndustryLabel = (id: number) => {
        return INDUSTRIES.find(i => i.id === id)?.label || `Industry ${id}`;
    };

    // Generate Plain English Summary
    const industryStr = value.industries.map(id => getIndustryLabel(id)).join(", ") || "various industries";
    const locationStr = value.company_location?.length ? value.company_location.join(", ") : "Global";
    const lookalikeName = value.lookalikeProfile?.name || "the candidate";

    // Construct the narrative
    const narrative = `Targeting Lookalikes of ${lookalikeName} in the ${industryStr} sector at firms with ${value.company_size} staff in ${locationStr}.`;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-[300px]">
            <div className="space-y-2">
                <h3 className="text-lg font-medium">Verification</h3>
                <p className="text-sm text-muted-foreground">
                    Review your strategy before launching the AI agent.
                </p>
            </div>

            <Card className="bg-primary/5 border-primary/20">
                <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                        <Rocket className="w-5 h-5 text-primary mt-1" />
                        <div className="space-y-1">
                            <h4 className="font-medium text-primary">Search Strategy</h4>
                            <p className="text-lg font-medium leading-relaxed">
                                "{narrative}"
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Account Definition</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                            <Building2 className="w-4 h-4 text-muted-foreground" />
                            <span>{industryStr}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <span>{value.company_size}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <span>{locationStr}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Match Priorities</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(value.featureWeights || {}).map(([key, val]) => (
                                <Badge key={key} variant="outline" className="bg-background">
                                    {key.charAt(0).toUpperCase() + key.slice(1)}: {val}%
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
