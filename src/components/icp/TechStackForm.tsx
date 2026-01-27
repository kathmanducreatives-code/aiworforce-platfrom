import { Label } from "@/components/ui/label";
import { ICPFormData, TECH_STACK_OPTIONS } from "@/types/icp";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface TechStackFormProps {
    value: ICPFormData;
    onChange: (value: ICPFormData) => void;
}

export const TechStackForm = ({ value, onChange }: TechStackFormProps) => {
    const handleToggleTech = (techValue: string) => {
        const newTechStack = value.tech_stack.includes(techValue)
            ? value.tech_stack.filter(t => t !== techValue)
            : [...value.tech_stack, techValue];
        onChange({ ...value, tech_stack: newTechStack });
    };

    const handleRemoveTech = (techValue: string) => {
        onChange({ ...value, tech_stack: value.tech_stack.filter(t => t !== techValue) });
    };

    // Group by category
    const categories = Array.from(new Set(TECH_STACK_OPTIONS.map(t => t.category)));

    return (
        <div className="space-y-6">
            <div className="px-1">
                <p className="text-sm text-muted-foreground mb-4">
                    Select the technologies your ideal customers use. This is optional but helps with precision matching.
                </p>

                {/* Selected Tech Stack */}
                {value.tech_stack.length > 0 && (
                    <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border">
                        <Label className="text-xs text-muted-foreground mb-2 block">
                            Selected ({value.tech_stack.length})
                        </Label>
                        <div className="flex flex-wrap gap-2">
                            {value.tech_stack.map((tech) => {
                                const option = TECH_STACK_OPTIONS.find(t => t.value === tech);
                                return (
                                    <Badge
                                        key={tech}
                                        variant="secondary"
                                        className="px-2 py-1 text-xs cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group bg-primary/10 text-primary border-primary/20"
                                    >
                                        <span>{option?.label || tech}</span>
                                        <X
                                            className="w-3 h-3 ml-1 opacity-60 group-hover:opacity-100"
                                            onClick={() => handleRemoveTech(tech)}
                                        />
                                    </Badge>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Tech Stack Options by Category */}
                <div className="space-y-4">
                    {categories.map((category) => (
                        <div key={category}>
                            <Label className="text-sm font-medium mb-3 block">{category}</Label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {TECH_STACK_OPTIONS
                                    .filter(t => t.category === category)
                                    .map((tech) => (
                                        <label
                                            key={tech.value}
                                            htmlFor={tech.value}
                                            className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                                        >
                                            <Checkbox
                                                id={tech.value}
                                                checked={value.tech_stack.includes(tech.value)}
                                                onCheckedChange={() => handleToggleTech(tech.value)}
                                            />
                                            <span className="text-sm font-medium">{tech.label}</span>
                                        </label>
                                    ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
