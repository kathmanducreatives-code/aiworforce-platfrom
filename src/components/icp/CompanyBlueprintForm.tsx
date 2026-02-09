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
                <h2 className="text-2xl font-semibold tracking-tight text-white">Targeting Constraints</h2>
                <p className="text-muted-foreground text-sm">Define the firmographic parameters for your Ideal Customer Profile.</p>
            </div>

            <div className="space-y-6">
                {/* Profile Name & Company Size Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        {/* Styled Input Wrapper */}
                        <div className="relative group">
                            <Input
                                id="profile_name"
                                placeholder="e.g., Enterprise SaaS Companies"
                                value={value.name}
                                onChange={(e) => onChange({ ...value, name: e.target.value })}
                                className="h-14 bg-[#161616] border border-white/10 rounded-xl hover:border-[#00FF85]/40 focus:border-[#00FF85] focus:ring-0 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.1)] transition-all pl-4 text-base text-white placeholder:text-muted-foreground/50"
                            />
                            <div className="absolute -top-2.5 left-3 bg-[#0A0A0A] px-1 text-xs font-semibold text-[#00FF85] tracking-wide transition-colors">
                                Profile Name
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Select
                            value={value.company_size}
                            onValueChange={(company_size) => onChange({ ...value, company_size })}
                        >
                            <SelectTrigger id="company_size" className="h-14 bg-[#161616] border border-white/10 rounded-xl hover:border-[#00FF85]/40 focus:ring-[#00FF85]/20 data-[state=open]:border-[#00FF85] data-[state=open]:shadow-[0_0_15px_rgba(0,255,133,0.15)] transition-all text-white">
                                <SelectValue placeholder="Select company size" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#161616] border border-[#00FF85]/30 text-white rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                                {COMPANY_SIZES.map((size) => (
                                    <SelectItem key={size.value} value={size.value} className="focus:bg-[#00FF85]/10 focus:text-[#00FF85] cursor-pointer py-3">
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
                        <Label className="text-[#00FF85] text-xs uppercase tracking-wider font-bold ml-1 shadow-[0_0_10px_rgba(0,255,133,0.2)] drop-shadow-sm">
                            How many profiles do you need?
                        </Label>
                        <Badge variant="outline" className="text-[#00FF85] border-[#00FF85]/30 bg-[#00FF85]/10 font-mono">
                            {value.target_results_count || 50} Profiles
                        </Badge>
                    </div>

                    <div className="bg-[#161616] p-6 rounded-xl border border-[#00FF85]/20 hover:border-[#00FF85]/40 transition-colors">
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
