import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import CreateJobForm from "@/components/screening/CreateJobForm";
import JobCard from "@/components/screening/JobCard";
import { Briefcase, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <Briefcase className="h-5 w-5 md:h-6 md:w-6 text-primary" />
            Job Screening
          </h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">Create screening links and manage applicants</p>
        </div>
        <Button variant="outline" onClick={() => setShowAnalytics(true)}>
          <BarChart3 className="h-4 w-4 mr-2" />
          Analytics
        </Button>
      </div>

      <CreateJobForm onJobCreated={fetchJobs} />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Your Screening Jobs</h2>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No screening jobs yet. Create one above.</p>
        ) : (
          jobs.map(job => (
            <JobCard
              key={job.id}
              job={job}
              applicationCounts={appCounts[job.id] || { total: 0, strong: 0, good: 0, maybe: 0, not_qualified: 0 }}
              onStatusToggle={fetchJobs}
              onDelete={fetchJobs}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default ScreeningJobs;
