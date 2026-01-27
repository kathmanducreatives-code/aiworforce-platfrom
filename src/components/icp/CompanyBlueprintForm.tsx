import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ICPFormData, REVENUE_RANGES, COMPANY_SIZES } from "@/types/icp";
import { IndustryMultiSelect } from "@/components/lead-scraper/IndustryMultiSelect";

interface CompanyBlueprintFormProps {
    value: ICPFormData;
    onChange: (value: ICPFormData) => void;
}

export const CompanyBlueprintForm = ({ value, onChange }: CompanyBlueprintFormProps) => {
    return (
        <div className="space-y-6">
            {/* Profile Name */}
            <div className="space-y-2 px-1">
                <Label htmlFor="profile_name">Profile Name *</Label>
                <Input
                    id="profile_name"
                    placeholder="e.g., Enterprise SaaS Companies"
                    value={value.name}
                    onChange={(e) => onChange({ ...value, name: e.target.value })}
                />
            </div>

            {/* Industries */}
            <div className="space-y-2 px-1">
                <Label>Target Industries *</Label>
                <IndustryMultiSelect
                    value={value.industries}
                    onChange={(industries) => onChange({ ...value, industries })}
                    placeholder="Select industries..."
                />
            </div>

            {/* Revenue Range */}
            <div className="space-y-2 px-1">
                <Label htmlFor="revenue_range">Revenue Range *</Label>
                <Select
                    value={value.revenue_range}
                    onValueChange={(revenue_range) => onChange({ ...value, revenue_range })}
                >
                    <SelectTrigger id="revenue_range">
                        <SelectValue placeholder="Select revenue range" />
                    </SelectTrigger>
                    <SelectContent>
                        {REVENUE_RANGES.map((range) => (
                            <SelectItem key={range.value} value={range.value}>
                                {range.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Company Size */}
            <div className="space-y-2 px-1">
                <Label htmlFor="company_size">Company Size *</Label>
                <Select
                    value={value.company_size}
                    onValueChange={(company_size) => onChange({ ...value, company_size })}
                >
                    <SelectTrigger id="company_size">
                        <SelectValue placeholder="Select company size" />
                    </SelectTrigger>
                    <SelectContent>
                        {COMPANY_SIZES.map((size) => (
                            <SelectItem key={size.value} value={size.value}>
                                {size.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
};
