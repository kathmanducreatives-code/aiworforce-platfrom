import { AlertTriangle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SearchHealthProps {
    metadata?: {
        actual_count: number;
        requested_count: number;
    };
    suggestions?: Array<{
        label: string;
        action: string;
        value?: string;
    }>;
    onApplySuggestion: (suggestion: { action: string; value?: string }) => void;
}

export const SearchHealth = ({ metadata, suggestions, onApplySuggestion }: SearchHealthProps) => {
    if (!metadata || metadata.actual_count >= metadata.requested_count * 0.8) {
        return null;
    }

    const isLowResults = metadata.actual_count < metadata.requested_count;

    if (!isLowResults || !suggestions?.length) return null;

    return (
        <div className="mb-6 rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-orange-500/20 text-orange-500 shrink-0 mt-0.5">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-orange-500">
                            Low Result Count ({metadata.actual_count}/{metadata.requested_count})
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                            We found fewer candidates than requested. This usually happens when filters are too strict. Try applying these AI suggestions:
                        </p>
                    </div>
                </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 pl-0 sm:pl-[52px]">
                {suggestions.map((suggestion, idx) => (
                    <Button
                        key={idx}
                        variant="outline"
                        size="sm"
                        onClick={() => onApplySuggestion(suggestion)}
                        className="border-orange-500/30 hover:bg-orange-500/10 hover:border-orange-500/50 text-orange-600 dark:text-orange-400 gap-2 h-8"
                    >
                        <Lightbulb className="w-3.5 h-3.5" />
                        {suggestion.label}
                    </Button>
                ))}
            </div>
        </div>
    );
};
