import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Share2, Linkedin, Globe, Briefcase, Rss, RefreshCw, ExternalLink, Trash2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import DistributeJobDialog from "@/components/distribution/DistributeJobDialog";
import DistributionStatusBadge from "@/components/distribution/DistributionStatusBadge";
import FeedUrlCard from "@/components/distribution/FeedUrlCard";
import { toast } from "sonner";

interface DistributionRow {
  id: string;
  job_id: string;
  platform: string;
  status: string;
  external_job_id: string | null;
  posted_at: string | null;
  last_synced_at: string | null;
  feed_url: string | null;
  error_message: string | null;
  created_at: string;
  job_title?: string;
  company_name?: string;
}

const platformIcons: Record<string, any> = {
  linkedin: Linkedin,
  indeed: Briefcase,
  wellfound: Globe,
  xml_feed: Rss,
};

const platformLabels: Record<string, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  wellfound: "Wellfound",
  xml_feed: "XML Feed",
};

const JobDistribution = () => {
  const { user } = useAuth();
  const [distributions, setDistributions] = useState<DistributionRow[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [distributeDialogOpen, setDistributeDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<{ id: string; title: string } | null>(null);

  const fetchData = async () => {
    if (!user) return;
    setLoading(true);

    const [distRes, jobsRes] = await Promise.all([
      supabase.from("job_distribution_status" as any).select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("screening_jobs").select("id, title, company_name, status").eq("user_id", user.id),
    ]);

    const jobsData = (jobsRes.data || []) as any[];
    const jobMap = new Map(jobsData.map((j: any) => [j.id, j]));

    const rows = ((distRes.data || []) as any[]).map((d: any) => ({
      ...d,
      job_title: jobMap.get(d.job_id)?.title || "Unknown",
      company_name: jobMap.get(d.job_id)?.company_name || "",
    }));

    setDistributions(rows);
    setJobs(jobsData);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleDelete = async (id: string) => {
    await supabase.from("job_distribution_status" as any).delete().eq("id", id);
    toast.success("Distribution removed");
    fetchData();
  };

  const handleSync = async (id: string) => {
    await supabase.from("job_distribution_status" as any).update({ last_synced_at: new Date().toISOString(), status: "posted" } as any).eq("id", id);
    toast.success("Synced!");
    fetchData();
  };

  // Group by job
  const grouped = distributions.reduce<Record<string, DistributionRow[]>>((acc, d) => {
    const key = d.job_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});

  const feedUrl = user ? `${window.location.origin}/api/job-feed?user=${user.id}` : "";

  const stats = {
    total: distributions.length,
    posted: distributions.filter(d => d.status === "posted").length,
    pending: distributions.filter(d => d.status === "pending").length,
    failed: distributions.filter(d => d.status === "failed").length,
  };

  return (
    <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
      <PageHeader
        title="Job Distribution"
        subtitle="Track and manage multi-platform job postings"
        breadcrumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Job Distribution' }]}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total" value={stats.total} icon={<Share2 className="h-4 w-4 text-blue-500" />} />
        <MetricCard label="Posted" value={stats.posted} icon={<Globe className="h-4 w-4 text-emerald-500" />} />
        <MetricCard label="Pending" value={stats.pending} icon={<RefreshCw className="h-4 w-4 text-amber-500" />} />
        <MetricCard label="Failed" value={stats.failed} icon={<Trash2 className="h-4 w-4 text-red-500" />} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {jobs.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="bg-background border border-border/60 rounded-lg px-3 py-2 text-sm"
              onChange={e => {
                const j = jobs.find((j: any) => j.id === e.target.value);
                if (j) setSelectedJob({ id: j.id, title: j.title });
              }}
              defaultValue=""
            >
              <option value="" disabled>Select a job to distribute...</option>
              {jobs.map((j: any) => (
                <option key={j.id} value={j.id}>{j.title} — {j.company_name}</option>
              ))}
            </select>
            <Button
              onClick={() => selectedJob && setDistributeDialogOpen(true)}
              disabled={!selectedJob}
              size="sm"
            >
              <Share2 className="h-4 w-4 mr-1" /> Distribute
            </Button>
          </div>
        )}
      </div>

      {/* Feed URL */}
      {distributions.some(d => d.platform === "xml_feed") && (
        <FeedUrlCard feedUrl={feedUrl} />
      )}

      {/* Distribution List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : distributions.length === 0 ? (
        <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-12 text-center">
          <Share2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-semibold text-lg">No distributions yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Select a screening job above and distribute it to multiple platforms.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([jobId, items]) => (
            <div key={jobId} className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm overflow-hidden hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
              <div className="p-4 border-b border-border/30 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{items[0].job_title}</h3>
                  <p className="text-xs text-muted-foreground">{items[0].company_name}</p>
                </div>
                <span className="text-xs text-muted-foreground">{items.length} platform(s)</span>
              </div>
              <div className="divide-y divide-border/30">
                {items.map(d => {
                  const Icon = platformIcons[d.platform] || Globe;
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                      <Icon className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium w-24">{platformLabels[d.platform] || d.platform}</span>
                      <DistributionStatusBadge status={d.status} />
                      {d.last_synced_at && (
                        <span className="text-xs text-muted-foreground ml-auto hidden md:block">
                          Synced {new Date(d.last_synced_at).toLocaleDateString()}
                        </span>
                      )}
                      <div className="flex items-center gap-1 ml-auto md:ml-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSync(d.id)} title="Sync">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => handleDelete(d.id)} title="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedJob && (
        <DistributeJobDialog
          open={distributeDialogOpen}
          onOpenChange={setDistributeDialogOpen}
          jobId={selectedJob.id}
          jobTitle={selectedJob.title}
          onDistributed={fetchData}
        />
      )}
    </div>
  );
};

export default JobDistribution;
