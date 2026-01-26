import { useMemo } from "react";

interface MatchScoreProps {
    score: number;
}

export const MatchScore = ({ score }: MatchScoreProps) => {
    const { color, trackColor } = useMemo(() => {
        if (score >= 90) return { color: "text-emerald-500", trackColor: "text-emerald-500/10" };
        if (score >= 70) return { color: "text-amber-500", trackColor: "text-amber-500/10" };
        return { color: "text-red-500", trackColor: "text-red-500/10" };
    }, [score]);

    // Radius of the circle
    const radius = 16;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (score / 100) * circumference;

    return (
        <div className="flex items-center gap-2">
            <div className="relative w-10 h-10 flex items-center justify-center">
                {/* Background Circle */}
                <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
                    <circle
                        className={trackColor}
                        strokeWidth="3"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="20"
                        cy="20"
                    />
                    {/* Progress Circle */}
                    <circle
                        className={`${color} transition-all duration-1000 ease-out`}
                        strokeWidth="3"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="20"
                        cy="20"
                    />
                </svg>
                <span className={`absolute text-[10px] font-bold ${color}`}>
                    {score}
                </span>
            </div>
        </div>
    );
};
