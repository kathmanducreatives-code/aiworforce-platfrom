import * as React from "react";
import { Check, ChevronsUpDown, Building2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
// Label import removed

const INDUSTRIES = [
    "SaaS",
    "Fintech",
    "Healthcare",
    "E-commerce",
    "AI/ML",
    "Recruitment",
    "Marketing",
    "Real Estate",
    "Finance",
    "Technology",
    "Consulting",
    "Education",
    "Manufacturing",
    "Logistics",
    "Cybersecurity",
    "Biotech",
    "Construction",
    "Legal",
    "Media",
    "Non-profit"
];

interface IndustryMultiSelectProps {
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
}

export const IndustryMultiSelect = ({
    value = [],
    onChange,
    placeholder = "Select industries...",
}: IndustryMultiSelectProps) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");

    const handleSelect = (industry: string) => {
        if (value.includes(industry)) {
            onChange(value.filter((v) => v !== industry));
        } else {
            onChange([...value, industry]);
        }
    };

    const handleRemove = (industry: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        onChange(value.filter((v) => v !== industry));
    };

    const filteredIndustries = INDUSTRIES.filter(
        (industry) =>
            industry.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-2">

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="Select industries"
                        className={cn(
                            "w-full h-9 lg:h-10 justify-between bg-background/50 border-border/50 hover:bg-background/80 hover:border-primary/30 transition-colors text-sm font-normal",
                            !value.length && "text-muted-foreground"
                        )}
                    >
                        <span className="truncate">
                            {value.length > 0
                                ? `${value.length} selected`
                                : placeholder}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover border-border/50 shadow-lg"
                    align="start"
                    sideOffset={4}
                >
                    <Command className="bg-transparent">
                        <CommandInput
                            placeholder="Search industries..."
                            value={search}
                            onValueChange={setSearch}
                            className="h-9 text-sm"
                        />
                        <CommandList className="max-h-[280px] overflow-y-auto">
                            <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">
                                No industry found.
                            </CommandEmpty>

                            <CommandGroup>
                                {filteredIndustries.map((industry) => {
                                    const isSelected = value.includes(industry);
                                    return (
                                        <CommandItem
                                            key={industry}
                                            value={industry}
                                            onSelect={() => handleSelect(industry)}
                                            className="flex items-center gap-2 cursor-pointer hover:bg-primary/10"
                                        >
                                            <div className={cn(
                                                "flex items-center justify-center w-4 h-4 border rounded-sm mr-2",
                                                isSelected
                                                    ? "bg-primary border-primary text-primary-foreground"
                                                    : "border-muted-foreground/30 opacity-50 [&_svg]:invisible"
                                            )}>
                                                <Check className={cn("h-3 w-3")} />
                                            </div>
                                            <span className="flex-1 truncate">{industry}</span>
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            {/* Selected badges */}
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                    {value.map((industry) => (
                        <Badge
                            key={industry}
                            variant="secondary"
                            className="px-2 py-1 text-xs cursor-pointer hover:bg-destructive/20 hover:text-destructive transition-colors group bg-primary/10 text-primary border-primary/20"
                        >
                            <span className="truncate">{industry}</span>
                            <X
                                className="w-2.5 h-2.5 ml-1 opacity-60 group-hover:opacity-100 shrink-0"
                                onClick={(e) => handleRemove(industry, e)}
                            />
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
};
// End of component
