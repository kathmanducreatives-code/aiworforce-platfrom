import { Button } from "@/components/ui/button";
import { Trash2, Download, X } from "lucide-react";

interface BulkActionBarProps {
    selectedCount: number;
    onClearSelection: () => void;
    onExport: () => void;
    onDelete: () => void;
}

export const BulkActionBar = ({
    selectedCount,
    onClearSelection,
    onExport,
    onDelete,
}: BulkActionBarProps) => {
    if (selectedCount === 0) return null;

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="flex items-center gap-2 lg:gap-4 p-2 pl-4 pr-2 bg-foreground text-background rounded-full shadow-2xl border border-white/10">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium whitespace-nowrap">
                        {selectedCount} selected
                    </span>
                    <div className="h-4 w-px bg-background/20" />
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onExport}
                        className="h-8 px-3 hover:bg-background/20 hover:text-background text-background/90"
                    >
                        <Download className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Export</span>
                    </Button>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onDelete}
                        className="h-8 px-3 hover:bg-red-500/20 hover:text-red-300 text-red-400"
                    >
                        <Trash2 className="w-4 h-4 mr-2" />
                        <span className="hidden sm:inline">Delete</span>
                    </Button>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClearSelection}
                    className="h-8 w-8 rounded-full hover:bg-background/20 text-background/70 hover:text-background ml-1"
                >
                    <X className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
};
