import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { ICPFormData, COMPANY_SIZES } from "@/types/icp";
import { TargetIndustrySelector } from "./TargetIndustrySelector";
import { LocationMultiSelect } from "@/components/lead-scraper/LocationMultiSelect";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { GradientSlider } from "@/components/ui/GradientSlider";

interface CompanyBlueprintFormProps {
    value: ICPFormData;
    onChange: (value: ICPFormData) => void;
}

export const CompanyBlueprintForm = ({ value, onChange }: CompanyBlueprintFormProps) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Targeting Constraints</h2>
                <p className="text-muted-foreground text-sm">Define the firmographic parameters for your Ideal Customer Profile.</p>
            </div>

            <div className="space-y-6">
                {/* Profile Name & Company Size Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <div className="relative group">
                            <Input
                                id="profile_name"
                                placeholder="e.g., Enterprise SaaS Companies"
                                value={value.name}
                                onChange={(e) => onChange({ ...value, name: e.target.value })}
                                className="h-14 bg-card border border-border/40 rounded-xl hover:border-primary/40 focus:border-primary focus:ring-0 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.1)] transition-all pl-4 text-base text-foreground placeholder:text-muted-foreground/50"
                            />
                            <div className="absolute -top-2.5 left-3 bg-background px-1 text-xs font-semibold text-primary tracking-wide transition-colors">
                                Profile Name
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Select
                            value={value.company_size}
                            onValueChange={(company_size) => onChange({ ...value, company_size })}
                        >
                            <SelectTrigger id="company_size" className="h-14 bg-card border border-border/40 rounded-xl hover:border-primary/40 focus:ring-primary/20 data-[state=open]:border-primary data-[state=open]:shadow-[0_0_15px_hsl(var(--primary)/0.15)] transition-all text-foreground">
                                <SelectValue placeholder="Select company size" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border border-primary/30 text-foreground rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                                {COMPANY_SIZES.map((size) => (
                                    <SelectItem key={size.value} value={size.value} className="focus:bg-primary/10 focus:text-primary cursor-pointer py-3">
                                        {size.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Industry & Location */}
                <div className="space-y-6">
                    <TargetIndustrySelector
                        includedIndustryIds={value.industries || []}
                        excludedIndustryIds={value.excluded_industries || []}
                        onChange={(included, excluded) => onChange({
                            ...value,
                            industries: included,
                            excluded_industries: excluded
                        })}
                    />

                    <LocationMultiSelect
                        value={value.company_location || []}
                        onChange={(company_location) => onChange({ ...value, company_location })}
                        placeholder="Select target regions or countries..."
                    />
                </div>

                {/* Target Results Count */}
                <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-primary text-xs uppercase tracking-wider font-bold ml-1 drop-shadow-sm">
                            How many profiles do you need?
                        </Label>
                        <Badge variant="outline" className="text-primary border-primary/30 bg-primary/10 font-mono">
                            {value.target_results_count || 50} Profiles
                        </Badge>
                    </div>

                    <div className="bg-card p-6 rounded-xl border border-primary/20 hover:border-primary/40 transition-colors">
                        <GradientSlider
                            defaultValue={[value.target_results_count || 50]}
                            value={[value.target_results_count || 50]}
                            max={500}
                            min={10}
                            step={10}
                            customMarkers={[50, 100, 250, 500]}
                            onValueChange={(val) => onChange({ ...value, target_results_count: val[0] })}
                            className="py-4 cursor-pointer"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
