import * as React from "react";
import { Check, X, Building2, Search, ChevronRight, Briefcase } from "lucide-react";
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
import { INDUSTRIES } from "@/data/industries";

interface IndustryMultiSelectProps {
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
}

export const IndustryMultiSelect = ({
    value = [],
    onChange,
    placeholder = "Search industries...",
}: IndustryMultiSelectProps) => {
    const [isActive, setIsActive] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);

    const filteredIndustries = React.useMemo(() => {
        if (!search) return INDUSTRIES.slice(0, 50);
        const lower = search.toLowerCase();
        return INDUSTRIES.filter(i => i.label.toLowerCase().includes(lower)).slice(0, 50);
    }, [search]);

    const handleSelect = (id: number) => {
        const idStr = id.toString();
        if (value.includes(idStr)) {
            onChange(value.filter((v) => v !== idStr));
        } else {
            onChange([...value, idStr]);
        }
        inputRef.current?.focus();
    };

    const handleRemove = (idStr: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        onChange(value.filter((v) => v !== idStr));
    };

    const getLabel = (idStr: string) => {
        const numId = parseInt(idStr);
        const ind = INDUSTRIES.find(i => i.id === numId);
        return ind ? ind.label : idStr;
    };

    return (
        <div className={cn(
            "relative transition-all duration-300 ease-out-quart rounded-xl border",
            isActive
                ? "bg-card border-primary shadow-primary z-50 scale-[1.02]"
                : "bg-card border-border hover:border-primary/60 hover:shadow-md"
        )}>
            {/* Header / Trigger Area */}
            <div
                className="flex flex-col gap-3 p-4 cursor-text"
                onClick={() => { setIsActive(true); inputRef.current?.focus(); }}
            >
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 text-foreground">
                        <Briefcase className="w-5 h-5 shrink-0 text-primary" />
                        <span className="text-sm tracking-wide uppercase text-foreground font-bold">Target Industries</span>
                    </div>
                </div>

                {/* Selected Chips */}
                <div className="flex flex-wrap gap-2 min-h-[32px]">
                    {value.map((idStr) => (
                        <Badge
                            key={idStr}
                            variant="secondary"
                            className="bg-primary/10 text-primary border border-primary/30 px-2 py-1 h-8 text-sm gap-1 hover:bg-primary/20 transition-colors animate-in fade-in zoom-in-50 duration-200"
                        >
                            {getLabel(idStr)}
                            <button
                                type="button"
                                className="ml-1 rounded-full p-0.5 hover:bg-primary/20 hover:text-primary transition-colors"
                                onClick={(e) => handleRemove(idStr, e)}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </Badge>
                    ))}
                    <input
                        ref={inputRef}
                        type="text"
                        className="bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground h-8 min-w-[200px] flex-1 text-sm font-medium"
                        placeholder={value.length === 0 ? placeholder : ""}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onFocus={() => setIsActive(true)}
                        onBlur={() => setTimeout(() => setIsActive(false), 200)}
                    />
                </div>
            </div>

            {/* Sliding Dropdown Content */}
            <div className={cn(
                "overflow-hidden transition-all duration-300 ease-out-quart rounded-b-xl",
                isActive ? "max-h-[300px] border-t border-border opacity-100" : "max-h-0 opacity-0 border-t-0"
            )}>
                <div className="bg-muted/50 backdrop-blur-sm p-2">
                    <div className="max-h-[290px] overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent pr-1">
                        {filteredIndustries.length === 0 && (
                            <div className="py-6 text-center text-muted-foreground text-sm">
                                <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                                No industries found matching "{search}"
                            </div>
                        )}

                        <div className="grid grid-cols-1 gap-1">
                            {filteredIndustries.map((ind) => {
                                const isSelected = value.includes(ind.id.toString());
                                return (
                                    <div
                                        key={ind.id}
                                        className={cn(
                                            "flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all",
                                            isSelected
                                                ? "bg-primary/10 text-primary"
                                                : "text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm"
                                        )}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleSelect(ind.id);
                                        }}
                                    >
                                        <div className={cn(
                                            "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                                            isSelected
                                                ? "border-primary bg-primary"
                                                : "border-border bg-card"
                                        )}>
                                            {isSelected && <Check className="w-3 h-3 text-white" />}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{ind.label}</span>
                                            {ind.hierarchy && <span className="text-[10px] opacity-50 truncate max-w-[300px]">{ind.hierarchy}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Active Indicator Line */}
            <div className={cn(
                "absolute bottom-0 left-0 h-[2px] bg-primary transition-all duration-500 ease-out",
                isActive ? "w-full shadow-primary" : "w-0"
            )} />
        </div>
    );
};