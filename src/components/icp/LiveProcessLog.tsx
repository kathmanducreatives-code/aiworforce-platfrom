import { useState, useEffect } from "react";
import { Check, Loader2, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveProcessLogProps {
    status: 'idle' | 'running' | 'completed';
    onComplete?: () => void;
}

const PROCESS_STEPS = [
    "🔍 Locating LinkedIn profile...",
    "🛰️ Establishing secure connection to Apify...",
    "📥 Extracting career history and education...",
    "🧠 Claude 3.5 is analyzing candidate patterns...",
    "🎯 GPT-4 is drafting your sourcing strategy..."
];

export const LiveProcessLog = ({ status, onComplete }: LiveProcessLogProps) => {
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (status !== 'running') return;

        let interval: ReturnType<typeof setInterval>;

        const startTime = Date.now();

        interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            let newProgress = 0;

            if (elapsed < 1000) {
                newProgress = Math.min(25, (elapsed / 1000) * 25);
            } else if (elapsed < 4000) {
                newProgress = 25 + ((elapsed - 1000) / 3000) * 35;
            } else if (elapsed < 10000) {
                newProgress = 60 + ((elapsed - 4000) / 6000) * 30;
            } else {
                newProgress = 90 + Math.min(8, ((elapsed - 10000) / 5000) * 8);
            }

            setProgress(newProgress);

            if (newProgress < 20) setCurrentStepIndex(0);
            else if (newProgress < 40) setCurrentStepIndex(1);
            else if (newProgress < 60) setCurrentStepIndex(2);
            else if (newProgress < 80) setCurrentStepIndex(3);
            else setCurrentStepIndex(4);

        }, 100);

        return () => clearInterval(interval);
    }, [status]);

    useEffect(() => {
        if (status === 'completed') {
            setProgress(100);
            setCurrentStepIndex(PROCESS_STEPS.length);
            if (onComplete) {
                setTimeout(onComplete, 800);
            }
        }
    }, [status, onComplete]);

    return (
        <div className="w-full max-w-md mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-500">
            {/* Terminal Window */}
            <div className="relative overflow-hidden rounded-xl bg-background border border-primary/20 shadow-[0_0_30px_hsl(var(--primary)/0.1)] font-mono text-sm">

                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-2 bg-card border-b border-border/30">
                    <Terminal className="w-4 h-4 text-primary" />
                    <span className="text-xs text-muted-foreground">icp-intelligence-agent --live</span>
                    <div className="ml-auto flex gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-destructive/20" />
                        <div className="w-2 h-2 rounded-full bg-yellow-500/20" />
                        <div className="w-2 h-2 rounded-full bg-primary/50 animate-pulse" />
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {PROCESS_STEPS.map((step, index) => {
                        const isCompleted = index < currentStepIndex || status === 'completed';
                        const isCurrent = index === currentStepIndex && status !== 'completed';
                        const isPending = index > currentStepIndex && status !== 'completed';

                        return (
                            <div
                                key={index}
                                className={cn(
                                    "flex items-start gap-3 transition-all duration-300",
                                    isPending && "opacity-30 blur-[0.5px]",
                                    isCurrent && "opacity-100 translate-x-1",
                                    isCompleted && "opacity-60"
                                )}
                            >
                                <div className={cn(
                                    "mt-0.5 w-4 h-4 flex items-center justify-center rounded-full border text-[10px]",
                                    isCompleted ? "bg-primary/20 border-primary text-primary" :
                                        isCurrent ? "border-primary text-primary animate-spin" :
                                            "border-border text-muted-foreground"
                                )}>
                                    {isCompleted ? <Check className="w-2.5 h-2.5" /> :
                                        isCurrent ? <Loader2 className="w-2.5 h-2.5" /> :
                                            <div className="w-1 h-1 rounded-full bg-current" />}
                                </div>
                                <span className={cn(
                                    "text-sm",
                                    isCurrent ? "text-primary font-semibold tracking-wide" : "text-muted-foreground"
                                )}>
                                    {step}
                                </span>
                            </div>
                        );
                    })}
                </div>

                {/* Footer Progress Bar */}
                <div className="relative h-1 bg-card">
                    <div
                        className="absolute top-0 left-0 h-full bg-primary transition-all duration-300 ease-out shadow-[0_0_10px_hsl(var(--primary))]"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            <div className="text-center">
                <p className="text-xs text-muted-foreground animate-pulse">
                    {status === 'completed' ? "Process complete" : "Agent is running operations..."}
                </p>
            </div>
        </div>
    );
};
