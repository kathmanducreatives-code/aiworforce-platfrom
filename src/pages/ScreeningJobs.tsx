import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CreateJobForm from "@/components/screening/CreateJobForm";
import JobCard from "@/components/screening/JobCard";
import { Briefcase, BarChart3, Users, TrendingUp, Pause, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScreeningAnalyticsDashboard } from "@/components/screening/analytics/ScreeningAnalyticsDashboard";

const ScreeningJobs = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [appCounts, setAppCounts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const fetchJobs = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("screening_jobs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setJobs(data || []);

    if (data && data.length > 0) {
      const { data: apps } = await supabase
        .from("screening_applications")
        .select("id, job_id, match_category, status, recruiter_status, total_time_seconds, match_score, created_at")
        .in("job_id", data.map(j => j.id));

      setApplications(apps || []);

      const counts: Record<string, any> = {};
      data.forEach(j => {
        const jobApps = (apps || []).filter(a => a.job_id === j.id);
        counts[j.id] = {
          total: jobApps.length,
          strong: jobApps.filter(a => a.match_category === "strong_fit").length,
          good: jobApps.filter(a => a.match_category === "good_fit").length,
          maybe: jobApps.filter(a => a.match_category === "maybe").length,
          not_qualified: jobApps.filter(a => a.match_category === "not_qualified").length,
        };
      });
      setAppCounts(counts);
    }
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, [user]);

  const totalApplicants = applications.length;
  const activeJobs = jobs.filter(j => j.status === "active").length;
  const pausedJobs = jobs.filter(j => j.status === "paused").length;

  if (showAnalytics) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <ScreeningAnalyticsDashboard
          jobs={jobs}
          applications={applications}
          onBack={() => setShowAnalytics(false)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 md:space-y-8 max-w-5xl mx-auto">
      {/* Premium Header */}
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-6 md:p-8">
        <div className="absolute top-0 right-0 opacity-5 pointer-events-none">
          <Briefcase className="h-48 w-48 text-primary -mt-8 -mr-8" />
        </div>
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">Job Screening</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Create AI-powered screening links and manage applicants</p>
          </div>
          <Button variant="outline" onClick={() => setShowAnalytics(true)} className="border-border/60 hover:border-primary/40 hover:bg-primary/5 shrink-0">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </Button>
        </div>

        {/* Stats Row */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="bg-background/40 rounded-lg p-3 border border-border/40">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total Applicants</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{totalApplicants}</p>
            </div>
            <div className="bg-emerald-500/5 rounded-lg p-3 border border-emerald-500/20">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-xs text-muted-foreground">Active Jobs</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400">{activeJobs}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 border border-border/40">
              <div className="flex items-center gap-2 mb-1">
                <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Paused</span>
              </div>
              <p className="text-2xl font-bold text-muted-foreground">{pausedJobs}</p>
            </div>
          </div>
        )}
      </div>

      <CreateJobForm onJobCreated={fetchJobs} />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Your Screening Jobs</h2>
          {!loading && jobs.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-primary/15 text-primary text-xs font-semibold border border-primary/25">
              {jobs.length}
            </span>
          )}
          <div className="flex-1 h-px bg-border/50" />
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                    <div className="flex gap-2 mt-3">
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-8 w-28 rounded-md" />
                    <Skeleton className="h-8 w-8 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border/60 bg-card/30">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 border border-primary/20">
              <Briefcase className="h-8 w-8 text-primary/60" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No screening jobs yet</h3>
            <p className="text-sm text-muted-foreground max-w-xs">Create your first screening job above to start receiving AI-scored applications.</p>
            <div className="flex items-center gap-1.5 mt-4 text-xs text-primary/70">
              <Plus className="h-3.5 w-3.5" />
              <span>Use the form above to get started</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job, index) => (
              <div key={job.id} className="animate-fade-in" style={{ animationDelay: `${index * 60}ms` }}>
                <JobCard
                  job={job}
                  applicationCounts={appCounts[job.id] || { total: 0, strong: 0, good: 0, maybe: 0, not_qualified: 0 }}
                  onStatusToggle={fetchJobs}
                  onDelete={fetchJobs}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ScreeningJobs;
