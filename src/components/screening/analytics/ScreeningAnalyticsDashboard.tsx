import { useMemo } from "react";
import { ArrowLeft, Users, Filter, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConversionFunnelChart } from "./ConversionFunnelChart";
import { TimeMetricsCard } from "./TimeMetricsCard";

interface ScreeningAnalyticsDashboardProps {
    jobs: any[];
    applications: any[];
    onBack: () => void;
}

export const ScreeningAnalyticsDashboard = ({ jobs, applications, onBack }: ScreeningAnalyticsDashboardProps) => {

    const metrics = useMemo(() => {
        // 1. Funnel Data
        const totalApplications = applications.length;

        // In a real app, we'd track "views" and "starts" separately. 
        // For now, we'll estimate "Started" as total applications, and "Completed" as those with status != 'new'
        const started = totalApplications;
        const completed = applications.filter(a => a.status === 'completed' || a.status === 'screening' || a.match_score > 0).length;
        const qualified = applications.filter(a => a.match_category === 'strong_fit' || a.match_category === 'good_fit').length;
        const hired = applications.filter(a => a.recruiter_status === 'hired').length;

        const funnelData = [
            { stage: "Applied", count: started, fill: "#3b82f6" }, // Blue
            { stage: "Completed", count: completed, fill: "#8b5cf6" }, // Violet
            { stage: "Qualified", count: qualified, fill: "#10b981" }, // Emerald
            { stage: "Hired", count: hired, fill: "#f59e0b" }, // Amber
        ];

        // 2. Time Metrics
        const times = applications
            .filter(a => a.total_time_seconds > 0)
            .map(a => a.total_time_seconds);

        const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
        const minTime = times.length ? Math.min(...times) : 0;
        const maxTime = times.length ? Math.max(...times) : 0;

        // 3. Match Quality Distribution
        const matchDistribution = {
            strong: applications.filter(a => a.match_category === 'strong_fit').length,
            good: applications.filter(a => a.match_category === 'good_fit').length,
            maybe: applications.filter(a => a.match_category === 'maybe').length,
            unqualified: applications.filter(a => a.match_category === 'not_qualified').length,
        };

        return {
            funnelData,
            timeMetrics: { avg: avgTime, min: minTime, max: maxTime },
            matchDistribution
        };
    }, [applications]);

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Analytics Dashboard</h2>
                    <p className="text-sm text-muted-foreground">Insights across {jobs.length} active jobs</p>
                </div>
            </div>

            {/* Top Level KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Total Applicants</p>
                            <h3 className="text-2xl font-bold">{applications.length}</h3>
                        </div>
                        <Users className="h-8 w-8 text-primary/20" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Qualified Rate</p>
                            <h3 className="text-2xl font-bold">
                                {applications.length ? Math.round((metrics.funnelData[2].count / applications.length) * 100) : 0}%
                            </h3>
                        </div>
                        <Target className="h-8 w-8 text-emerald-500/20" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Completion Rate</p>
                            <h3 className="text-2xl font-bold">
                                {applications.length ? Math.round((metrics.funnelData[1].count / applications.length) * 100) : 0}%
                            </h3>
                        </div>
                        <Filter className="h-8 w-8 text-violet-500/20" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Hires Made</p>
                            <h3 className="text-2xl font-bold">{metrics.funnelData[3].count}</h3>
                        </div>
                        <Users className="h-8 w-8 text-amber-500/20" />
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Funnel Chart */}
                <ConversionFunnelChart data={metrics.funnelData} />

                {/* Time Metrics */}
                <TimeMetricsCard
                    averageTimeSeconds={metrics.timeMetrics.avg}
                    fastestTimeSeconds={metrics.timeMetrics.min}
                    slowestTimeSeconds={metrics.timeMetrics.max}
                />
            </div>

            {/* Match Quality Breakdown */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-medium">Match Quality Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {Object.entries(metrics.matchDistribution).map(([key, count]) => {
                            const total = applications.length || 1;
                            const pct = Math.round((count / total) * 100);
                            const color =
                                key === 'strong' ? 'bg-emerald-500' :
                                    key === 'good' ? 'bg-amber-500' :
                                        key === 'maybe' ? 'bg-muted-foreground' : 'bg-red-500';

                            const label =
                                key === 'strong' ? 'Strong Fit' :
                                    key === 'good' ? 'Good Fit' :
                                        key === 'maybe' ? 'Maybe' : 'Not Qualified';

                            return (
                                <div key={key} className="space-y-1">
                                    <div className="flex justify-between text-sm">
                                        <span className="font-medium">{label}</span>
                                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                                    </div>
                                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
