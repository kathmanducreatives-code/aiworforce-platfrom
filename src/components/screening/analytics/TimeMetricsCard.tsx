import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Timer, Zap } from "lucide-react";

interface TimeMetricsCardProps {
    averageTimeSeconds: number;
    fastestTimeSeconds: number;
    slowestTimeSeconds: number;
}

const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
};

export const TimeMetricsCard = ({ averageTimeSeconds, fastestTimeSeconds, slowestTimeSeconds }: TimeMetricsCardProps) => {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Time Metrics
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Timer className="h-4 w-4" />
                        <span>Average Completion</span>
                    </div>
                    <span className="font-bold text-lg">{formatTime(averageTimeSeconds)}</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Zap className="h-4 w-4 text-amber-500" />
                        <span>Fastest</span>
                    </div>
                    <span className="font-medium">{formatTime(fastestTimeSeconds)}</span>
                </div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span>Slowest</span>
                    </div>
                    <span className="font-medium">{formatTime(slowestTimeSeconds)}</span>
                </div>
            </CardContent>
        </Card>
    );
};
