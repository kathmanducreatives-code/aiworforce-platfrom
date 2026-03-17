import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Share2, Layers, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import MetricCard from "@/components/shared/MetricCard";
import DriftAlert from "@/components/distribution/DriftAlert";
import AddPlatformModal from "@/components/distribution/AddPlatformModal";
import PlatformCard from "@/components/distribution/PlatformCard";

export default function JobDistribution() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>("all");
  const [postings, setPostings] = useState<any[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    if (user) {
      supabase.from("screening_jobs").select("*").eq("user_id", user.id).then(({ data }) => {
        if (data) setJobs(data);
      });
    }
  }, [user]);

  const loadPostings = async () => {
    if (!user) return;
    const { data } = await (supabase as any).from("job_distribution_postings").select("*");
    if (data) setPostings(data);
    setInitialLoading(false);
  };

  useEffect(() => {
    loadPostings();
  }, [user]);

  // Determine filtered postings
  const filteredPostings = selectedTab === "all"
    ? postings
    : postings.filter(p => p.job_id === selectedTab);

  // Stats calculation
  const totalPlatforms = filteredPostings.length;
  const activeCount = filteredPostings.filter(p => p.is_active && p.scrape_status !== 'removed').length;
  const driftCount = filteredPostings.filter(p => p.drift_detected).length;
  const removedCount = filteredPostings.filter(p => !p.is_active || p.scrape_status === 'removed').length;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 py-6 space-y-6">
        <PageHeader
          title="Job Distribution"
          subtitle="Monitor every platform your jobs are posted on"
          primaryAction={{
            label: 'Add Platform',
            onClick: () => setAddModalOpen(true),
            icon: <Plus className="w-4 h-4" />,
          }}
        />

        {/* Stat Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Total Platforms"
            value={initialLoading ? null : totalPlatforms}
            icon={<Layers className="h-4 w-4 text-primary" />}
          />
          <MetricCard
            label="Active"
            value={initialLoading ? null : activeCount}
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          />
          <MetricCard
            label="Drift Detected"
            value={initialLoading ? null : driftCount}
            icon={<AlertTriangle className="h-4 w-4 text-yellow-500" />}
          />
          <MetricCard
            label="Removed"
            value={initialLoading ? null : removedCount}
            icon={<Trash2 className="h-4 w-4 text-destructive" />}
          />
        </div>

        {/* Drift Alert Banner conditionally rendered */}
        {driftCount > 0 && <DriftAlert count={driftCount} />}

        {postings.length === 0 && !initialLoading ? (
          <div className="text-center p-12 bg-card rounded-2xl border border-dashed border-border/50 mt-8">
            <Share2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground">No platforms tracked yet</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-sm mx-auto">
              Paste the URLs where you've posted this job and ScreeningPilot will watch them for changes and removals.
            </p>
            <Button onClick={() => setAddModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" /> Add Platform
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-6">
            <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
              <TabsList className="bg-muted/50 border border-border/50 rounded-lg p-1 h-auto flex-wrap justify-start">
                <TabsTrigger value="all" className="rounded-md px-4 py-2 text-sm">
                  All ({postings.length})
                </TabsTrigger>
                {jobs.map(job => {
                  const count = postings.filter(p => p.job_id === job.id).length;
                  if (count === 0 && selectedTab !== job.id) return null; // Only show tabs for jobs with platforms
                  return (
                    <TabsTrigger key={job.id} value={job.id} className="rounded-md px-4 py-2 text-sm">
                      {job.title} ({count})
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <TabsContent value={selectedTab} className="mt-6 focus-visible:outline-none">
                {filteredPostings.length === 0 ? (
                  <div className="text-center p-16 border border-border/50 bg-card rounded-2xl text-muted-foreground">
                    No platforms tracked for this job.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {filteredPostings.map(post => {
                      const originalJob = jobs.find(j => j.id === post.job_id);
                      return (
                        <PlatformCard
                          key={post.id}
                          posting={post}
                          originalJob={originalJob}
                          onSynced={loadPostings}
                        />
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        <AddPlatformModal
          open={addModalOpen}
          onOpenChange={setAddModalOpen}
          jobs={jobs}
          onAdded={() => {
            loadPostings();
            // Switch tab to the newly added job's tab if not all? Handled broadly via reload.
          }}
        />
      </div>
    </div>
  );
}
