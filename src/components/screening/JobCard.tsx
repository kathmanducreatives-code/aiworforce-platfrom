import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Eye, Pause, Play, Pencil, Trash2 } from "lucide-react";
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

interface JobCardProps {
  job: any;
  applicationCounts: { total: number; strong: number; good: number; maybe: number; not_qualified: number };
  onStatusToggle: () => void;
  onEdit?: (job: any) => void;
  onDelete?: (jobId: string) => void;
}

const JobCard = ({ job, applicationCounts, onStatusToggle, onEdit, onDelete }: JobCardProps) => {
  const navigate = useNavigate();

  const handleCopy = () => {
    navigator.clipboard.writeText(`${window.location.origin}/apply/${job.slug}`);
    toast.success("Link copied!");
  };

  const handleToggleStatus = async () => {
    const newStatus = job.status === "active" ? "paused" : "active";
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
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-foreground truncate">{job.title}</h3>
              <Badge variant={job.status === "active" ? "default" : "secondary"} className="text-xs">
                {job.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{job.company_name} · Created {format(new Date(job.created_at), "MMM d, yyyy")}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
              <span className="text-foreground font-medium">{applicationCounts.total} total</span>
              {applicationCounts.strong > 0 && <span className="text-emerald-500">{applicationCounts.strong} strong</span>}
              {applicationCounts.good > 0 && <span className="text-amber-500">{applicationCounts.good} good</span>}
              {applicationCounts.maybe > 0 && <span className="text-muted-foreground">{applicationCounts.maybe} maybe</span>}
              {applicationCounts.not_qualified > 0 && <span className="text-destructive">{applicationCounts.not_qualified} not qualified</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 border-t sm:border-t-0 border-border/50 pt-2 sm:pt-0">
            <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy link" className="h-9 w-9">
              <Copy className="h-4 w-4" />
            </Button>
            {onEdit && (
              <Button variant="ghost" size="icon" onClick={() => onEdit(job)} title="Edit job" className="h-9 w-9">
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={handleToggleStatus} title={job.status === "active" ? "Pause" : "Activate"} className="h-9 w-9">
              {job.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate(`/screening-jobs/${job.id}`)} title="View applicants" className="h-9 w-9">
              <Eye className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Delete job" className="h-9 w-9 text-destructive hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
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
      </CardContent>
    </Card>
  );
};

export default JobCard;
