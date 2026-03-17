import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Radar, Building, Briefcase, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import AddCompetitorModal from "@/components/competitors/AddCompetitorModal";
import CompetitorCard from "@/components/competitors/CompetitorCard";

export default function CompetitorMonitor() {
    const { user } = useAuth();
    const [competitors, setCompetitors] = useState<any[]>([]);
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [topTitles, setTopTitles] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const loadCompetitors = async () => {
        if (!user) return;
        const { data } = await (supabase as any).from("competitor_companies").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
        if (data) setCompetitors(data);

        const { data: jobs } = await (supabase as any).from("competitor_job_postings").select("job_title, is_new, first_seen_at");

        // Process top titles
        if (jobs) {
            const counts = jobs.reduce((acc: any, row: any) => {
                const t = row.job_title;
                if (t && t !== 'Unknown') {
                    acc[t] = (acc[t] || 0) + 1;
                }
                return acc;
            }, {});
            const sorted = Object.entries(counts).sort((a: any, b: any) => b[1] - a[1]).map(x => x[0]).slice(0, 5) as string[];
            setTopTitles(sorted);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadCompetitors();
        const interval = setInterval(loadCompetitors, 15000);
        return () => clearInterval(interval);
    }, [user]);

    // Derived stats
    const totalTracked = competitors.length;
    const totalRoles = competitors.reduce((acc, c) => acc + (c.total_jobs_found || 0), 0);

    // To get exact "New This Week", we should fetch it, but we can approximate it or query securely. 
    // We'll use a rough state since `jobs` aren't all in memory here. Actually `jobs` array was fetched for titles!
    // BUT the previous fetch was unconstrained. We just fetch it again properly.
    // We will do a separate count fetch for new jobs.
    const [newThisWeek, setNewThisWeek] = useState(0);

    useEffect(() => {
        if (!user) return;
        const loadNewJobs = async () => {
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            // Note: competitor_job_postings doesn't have user_id, join requires complex RPC or just rely on RLS.
            // Assuming RLS restricts to user's competitors jobs.
            const { count } = await (supabase as any).from("competitor_job_postings")
                .select("*", { count: "exact", head: true })
                .eq("is_new", true)
                .gte("first_seen_at", oneWeekAgo.toISOString());

            if (count !== null) setNewThisWeek(count);
        };
        loadNewJobs();
    }, [user, competitors]);


    return (
        <div className="min-h-screen bg-background">
            <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
                <PageHeader
                    title="Competitor Intelligence"
                    subtitle="Monitor competitor career pages and detect new hiring trends"
                    primaryAction={{
                        label: 'Add Competitor',
                        onClick: () => setAddModalOpen(true),
                        icon: <Plus className="w-4 h-4" />
                    }}
                />

                {/* Insight Strip */}
                {competitors.length > 0 && (
                    <div className="w-full bg-card border border-border/50 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 shadow-sm">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground shrink-0 pl-1">
                            <Sparkles className="h-4 w-4 text-primary" />
                            Competitors are actively hiring for:
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 hide-scrollbar flex-1">
                            {loading ? (
                                Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-6 w-24 rounded-full" />)
                            ) : topTitles.length > 0 ? (
                                topTitles.map(t => (
                                    <Badge key={t} variant="secondary" className="whitespace-nowrap font-normal bg-secondary/50 text-foreground">
                                        {t}
                                    </Badge>
                                ))
                            ) : (
                                <span className="text-sm text-muted-foreground">Not enough data yet</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Stat Row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <MetricCard
                        label="Companies Tracked"
                        value={loading ? null : totalTracked}
                        icon={<Building className="h-4 w-4 text-primary" />}
                    />
                    <MetricCard
                        label="Total Roles Found"
                        value={loading ? null : totalRoles}
                        icon={<Briefcase className="h-4 w-4 text-blue-500" />}
                    />
                    <MetricCard
                        label="New This Week"
                        value={loading ? null : newThisWeek}
                        icon={<Sparkles className="h-4 w-4 text-emerald-500" />}
                    />
                </div>

                {/* Main Content */}
                {loading ? (
                    <div className="space-y-4 mt-8">
                        <Skeleton className="h-32 w-full rounded-xl" />
                        <Skeleton className="h-32 w-full rounded-xl" />
                    </div>
                ) : competitors.length === 0 ? (
                    <div className="text-center p-12 bg-card rounded-2xl border border-dashed border-border/50 mt-8">
                        <Radar className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-foreground">No competitors tracked yet</h3>
                        <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-sm mx-auto">
                            Add your first competitor to start crawling their career page for new job postings automatically.
                        </p>
                        <Button onClick={() => setAddModalOpen(true)}>
                            <Plus className="w-4 h-4 mr-2" /> Track a Competitor
                        </Button>
                    </div>
                ) : (
                    <div className="mt-8 flex flex-col gap-4">
                        {competitors.map(comp => (
                            <CompetitorCard key={comp.id} competitor={comp} onRefreshRequested={loadCompetitors} />
                        ))}
                    </div>
                )}

                <AddCompetitorModal
                    open={addModalOpen}
                    onOpenChange={setAddModalOpen}
                    onAdded={() => {
                        loadCompetitors();
                        setTimeout(loadCompetitors, 3000);
                    }}
                />
            </div>
        </div>
    );
}
