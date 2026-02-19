import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Eye, Pause, Play, Pencil, Trash2, MoreHorizontal, Briefcase, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface JobCardProps {
  job: any;
  applicationCounts: { total: number; strong: number; good: number; maybe: number; not_qualified: number };
  onStatusToggle: () => void;
  onEdit?: (job: any) => void;
  onDelete?: (jobId: string) => void;
}

const JobCard = ({ job, applicationCounts, onStatusToggle, onEdit, onDelete }: JobCardProps) => {
  const navigate = useNavigate();
  const isActive = job.status === "active";

  const handleCopy = () => {
    navigator.clipboard.writeText(`${window.location.origin}/apply/${job.slug}`);
    toast.success("Link copied!");
  };

  const handleToggleStatus = async () => {
    const newStatus = isActive ? "paused" : "active";
    await supabase.from("screening_jobs").update({ status: newStatus }).eq("id", job.id);
    onStatusToggle();
    toast.success(`Job ${newStatus === "active" ? "activated" : "paused"}`);
  };

  const handleDelete = async () => {
    const { error } = await supabase.from("screening_jobs").delete().eq("id", job.id);
    if (error) {
      toast.error("Failed to delete job. It may have existing applications.");
      return;
    }
    toast.success("Job deleted");
    onDelete?.(job.id);
  };

  return (
    <div className="relative group rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden">
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${isActive ? "bg-primary" : "bg-muted-foreground/30"}`} />

      <div className="pl-5 pr-4 py-4 md:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Left: Icon + Info */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? "bg-primary/15 border border-primary/25" : "bg-muted/50 border border-border/50"}`}>
              <Briefcase className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <h3 className="font-semibold text-foreground leading-tight truncate">{job.title}</h3>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                    : "bg-muted/50 text-muted-foreground border-border/50"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
                  {isActive ? "Active" : "Paused"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{job.company_name} · {format(new Date(job.created_at), "MMM d, yyyy")}</p>

              {/* Applicant stat pills */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground">
                  <Users className="h-3 w-3" />{applicationCounts.total} total
                </span>
                {applicationCounts.strong > 0 && (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                    {applicationCounts.strong} strong
                  </span>
                )}
                {applicationCounts.good > 0 && (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400">
                    {applicationCounts.good} good
                  </span>
                )}
                {applicationCounts.maybe > 0 && (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-muted/40 border border-border/40 text-muted-foreground">
                    {applicationCounts.maybe} maybe
                  </span>
                )}
                {applicationCounts.not_qualified > 0 && (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/25 text-destructive">
                    {applicationCounts.not_qualified} not qualified
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 shrink-0 border-t sm:border-t-0 border-border/40 pt-3 sm:pt-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/screening-jobs/${job.id}`)}
              className="border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              View Applicants
            </Button>

            <AlertDialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 border border-border/40 hover:border-border/70">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2" /> Copy Screening Link
                  </DropdownMenuItem>
                  {onEdit && (
                    <DropdownMenuItem onClick={() => onEdit(job)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit Job
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleToggleStatus}>
                    {isActive ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                    {isActive ? "Pause Job" : "Activate Job"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete Job
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                </DropdownMenuContent>
              </DropdownMenu>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{job.title}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this job and all its applications. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobCard;
