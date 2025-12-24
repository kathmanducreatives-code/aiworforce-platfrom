import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { Briefcase, Plus, Building2, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import JobPostingForm from "@/components/job-board/JobPostingForm";
import JobListingsTable from "@/components/job-board/JobListingsTable";
import PostToBoardsDialog from "@/components/job-board/PostToBoardsDialog";

export interface JobPosting {
  id: string;
  user_id: string;
  title: string;
  company_name: string;
  location: string;
  job_type: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  description: string;
  requirements: string[];
  benefits: string[];
  remote_option: string;
  experience_level: string | null;
  posted_boards: Record<string, { status: string; posted_at: string; url?: string }>;
  status: string;
  created_at: string;
  updated_at: string;
}

const JobBoard = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobPosting | null>(null);
  const [postingDialogJob, setPostingDialogJob] = useState<JobPosting | null>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["job-postings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_postings")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data as JobPosting[];
    },
    enabled: !!user,
  });

  const createMutation = useMutation({
    mutationFn: async (job: Partial<JobPosting>) => {
      const insertData = {
        title: job.title!,
        company_name: job.company_name!,
        location: job.location!,
        job_type: job.job_type!,
        description: job.description!,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        salary_currency: job.salary_currency,
        requirements: job.requirements,
        benefits: job.benefits,
        remote_option: job.remote_option,
        experience_level: job.experience_level,
        status: job.status,
        user_id: user?.id!,
      };
      
      const { data, error } = await supabase
        .from("job_postings")
        .insert(insertData)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-postings"] });
      toast({ title: "Job posting created successfully" });
      setShowForm(false);
    },
    onError: (error) => {
      toast({ title: "Error creating job posting", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...job }: Partial<JobPosting> & { id: string }) => {
      const { data, error } = await supabase
        .from("job_postings")
        .update(job)
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-postings"] });
      toast({ title: "Job posting updated successfully" });
      setEditingJob(null);
      setShowForm(false);
    },
    onError: (error) => {
      toast({ title: "Error updating job posting", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("job_postings")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-postings"] });
      toast({ title: "Job posting deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting job posting", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (job: Partial<JobPosting>) => {
    if (editingJob) {
      updateMutation.mutate({ ...job, id: editingJob.id });
    } else {
      createMutation.mutate(job);
    }
  };

  const handleEdit = (job: JobPosting) => {
    setEditingJob(job);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingJob(null);
  };

  const handleUpdateBoards = (job: JobPosting, boards: Record<string, { status: string; posted_at: string; url?: string }>) => {
    updateMutation.mutate({ id: job.id, posted_boards: boards });
  };

  // Stats
  const totalJobs = jobs.length;
  const activeJobs = jobs.filter(j => j.status === "active").length;
  const draftJobs = jobs.filter(j => j.status === "draft").length;
  const postedToBoards = jobs.filter(j => Object.keys(j.posted_boards || {}).length > 0).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
              <Briefcase className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Job Board</h1>
              <p className="text-muted-foreground text-sm">Post jobs to Indeed, LinkedIn, and Glassdoor</p>
            </div>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Job Posting
            </Button>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">{totalJobs}</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-green-500" />
                <span className="text-2xl font-bold">{activeJobs}</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Drafts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-yellow-500" />
                <span className="text-2xl font-bold">{draftJobs}</span>
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-card/50 backdrop-blur-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Posted to Boards</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-blue-500" />
                <span className="text-2xl font-bold">{postedToBoards}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        {showForm ? (
          <JobPostingForm
            job={editingJob}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={createMutation.isPending || updateMutation.isPending}
          />
        ) : (
          <JobListingsTable
            jobs={jobs}
            isLoading={isLoading}
            onEdit={handleEdit}
            onDelete={(id) => deleteMutation.mutate(id)}
            onPostToBoards={setPostingDialogJob}
          />
        )}

        {/* Post to Boards Dialog */}
        <PostToBoardsDialog
          job={postingDialogJob}
          open={!!postingDialogJob}
          onOpenChange={(open) => !open && setPostingDialogJob(null)}
          onUpdate={handleUpdateBoards}
        />
      </div>
    </div>
  );
};

export default JobBoard;
