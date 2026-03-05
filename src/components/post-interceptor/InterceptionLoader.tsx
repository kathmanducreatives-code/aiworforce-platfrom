import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InterceptionLoaderProps {
    onComplete: () => void;
}

const STEPS = [
    { text: '> Connecting to LinkedIn data layer...', delay: 0 },
    { text: '> Scraping post comments...', delay: 1000 },
    { text: '> Filtering out recruiters and spam...', delay: 2400 },
    { text: '> Enriching commenter profiles...', delay: 4000 },
    { text: '> Claude is analyzing buying signals...', delay: 5600 },
    { text: '> Scoring leads by intent level...', delay: 7200 },
    { text: '> Generating personalized DMs...', delay: 8800 },
    { text: '> Writing leads to database...', delay: 10200 },
    { text: '✓ Done. Loading your leads...', delay: 11600, done: true },
];

const InterceptionLoader = ({ onComplete }: InterceptionLoaderProps) => {
    const [visibleSteps, setVisibleSteps] = useState<number[]>([]);

    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];

        STEPS.forEach((step, index) => {
            const t = setTimeout(() => {
                setVisibleSteps(prev => [...prev, index]);

                if (step.done) {
                    // Give a brief beat after "Done" before transitioning
                    setTimeout(onComplete, 900);
                }
            }, step.delay);
            timers.push(t);
        });

        return () => timers.forEach(clearTimeout);
    }, [onComplete]);

    return (
        <div className="min-h-full flex flex-col items-center justify-center px-6 py-16">
            {/* Terminal window */}
            <div className="w-full max-w-xl">
                {/* Window chrome */}
                <div className="flex items-center gap-1.5 px-4 py-3 bg-zinc-900 rounded-t-2xl border border-border">
                    <div className="w-3 h-3 rounded-full bg-red-500/80" />
                    <div className="w-3 h-3 rounded-full bg-amber-400/80" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                    <div className="flex items-center gap-1.5 ml-3">
                        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground font-mono">interceptor — bash</span>
                    </div>
                </div>

                {/* Terminal body */}
                <div className="bg-zinc-950 border border-t-0 border-border rounded-b-2xl px-6 py-6 min-h-[280px] font-mono text-sm">
                    <div className="space-y-2">
                        {STEPS.map((step, index) => {
                            const isVisible = visibleSteps.includes(index);
                            const isDone = step.done;
                            return (
                                <p
                                    key={index}
                                    className={cn(
                                        'transition-all duration-300',
                                        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
                                        isDone ? 'text-emerald-400 font-medium' : 'text-emerald-500/80',
                                    )}
                                >
                                    {step.text}
                                    {/* Blinking cursor on last visible step */}
                                    {isVisible && index === Math.max(...visibleSteps) && !isDone && (
                                        <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 align-middle animate-pulse" />
                                    )}
                                </p>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Progress indicator */}
            <div className="mt-8 text-center">
                <p className="text-sm text-muted-foreground mb-4">
                    n8n + Claude AI is processing your post. This takes ~15–60 seconds.
                </p>
                <div className="w-64 h-1.5 bg-muted rounded-full overflow-hidden mx-auto">
                    <div
                        className="h-full bg-gradient-to-r from-primary to-violet-400 rounded-full transition-all duration-1000"
                        style={{
                            width: `${Math.round((visibleSteps.length / STEPS.length) * 100)}%`,
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

export default InterceptionLoader;
