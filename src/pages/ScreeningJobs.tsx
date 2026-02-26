import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CreateJobForm from "@/components/screening/CreateJobForm";
import JobCard from "@/components/screening/JobCard";
import { Briefcase, BarChart3, Users, TrendingUp, Pause, Plus } from "lucide-react";
import { ScreeningAnalyticsDashboard } from "@/components/screening/analytics/ScreeningAnalyticsDashboard";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import EmptyState from "@/components/shared/EmptyState";
import SkeletonCard from "@/components/shared/SkeletonCard";
import SlideOverPanel from "@/components/shared/SlideOverPanel";

const ScreeningJobs = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [appCounts, setAppCounts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showCreatePanel, setShowCreatePanel] = useState(false);

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
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6">
        <ScreeningAnalyticsDashboard
          jobs={jobs}
          applications={applications}
          onBack={() => setShowAnalytics(false)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
      <PageHeader
        title="Job Screening"
        subtitle="Create AI-powered screening links and manage applicants"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Job Screening' }]}
        primaryAction={{
          label: 'Create Job',
          onClick: () => setShowCreatePanel(true),
          icon: <Plus className="h-4 w-4" />,
        }}
        secondaryActions={[{
          label: 'Analytics',
          onClick: () => setShowAnalytics(true),
          icon: <BarChart3 className="h-4 w-4" />,
        }]}
      />

      {/* KPI Row */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="Total Applicants"
            value={totalApplicants}
            icon={<Users className="h-4 w-4 text-blue-500" />}
          />
          <MetricCard
            label="Active Jobs"
            value={activeJobs}
            icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          />
          <MetricCard
            label="Paused"
            value={pausedJobs}
            icon={<Pause className="h-4 w-4 text-muted-foreground" />}
          />
        </div>
      )}

      {/* Jobs List */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-semibold text-foreground">Your Screening Jobs</h2>
          {!loading && jobs.length > 0 && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold border border-primary/20">
              {jobs.length}
            </span>
          )}
        </div>

        {loading ? (
          <SkeletonCard variant="card" count={3} className="space-y-3" />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="h-7 w-7 text-muted-foreground/60" />}
            title="No screening jobs yet"
            description="Create your first screening job to start receiving AI-scored applications."
            actionLabel="Create Job"
            onAction={() => setShowCreatePanel(true)}
            actionIcon={<Plus className="h-4 w-4" />}
          />
        ) : (
          <div className="space-y-3">
            {jobs.map((job, index) => (
              <div key={job.id} className="animate-in fade-in-0 slide-in-from-bottom-2" style={{ animationDelay: `${index * 60}ms` }}>
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

      {/* Create Job Slide-Over Panel */}
      <SlideOverPanel
        open={showCreatePanel}
        onClose={() => setShowCreatePanel(false)}
        title="Create Screening Job"
        description="Configure your role and generate an AI screening link"
        width="xl"
      >
        <CreateJobForm onJobCreated={() => { fetchJobs(); setShowCreatePanel(false); }} />
      </SlideOverPanel>
    </div>
  );
};

export default ScreeningJobs;
