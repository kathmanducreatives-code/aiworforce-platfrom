import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

export default function DriftAlert({ count }: { count: number }) {
    const [dismissed, setDismissed] = useState(false);

    if (count === 0 || dismissed) return null;

    return (
        <div className="w-full relative p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-start sm:items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 sm:mt-0 mt-0.5" />
            <div className="text-sm text-yellow-600 dark:text-yellow-400 font-medium flex-1">
                ⚠ {count} posting(s) no longer match your original job description. Review the flagged cards below.
            </div>
            <button
                onClick={() => setDismissed(true)}
                className="p-1 rounded-md text-yellow-600/60 hover:text-yellow-600 hover:bg-yellow-500/20 transition-colors shrink-0"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
