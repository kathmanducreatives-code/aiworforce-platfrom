import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Eye, Pause, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface JobCardProps {
  job: any;
  applicationCounts: { total: number; strong: number; good: number; maybe: number; not_qualified: number };
  onStatusToggle: () => void;
}

const JobCard = ({ job, applicationCounts, onStatusToggle }: JobCardProps) => {
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

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground truncate">{job.title}</h3>
              <Badge variant={job.status === "active" ? "default" : "secondary"} className="text-xs">
                {job.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{job.company_name} · Created {format(new Date(job.created_at), "MMM d, yyyy")}</p>
            <div className="flex gap-3 mt-2 text-xs">
              <span className="text-foreground font-medium">{applicationCounts.total} total</span>
              {applicationCounts.strong > 0 && <span className="text-emerald-500">{applicationCounts.strong} strong</span>}
              {applicationCounts.good > 0 && <span className="text-amber-500">{applicationCounts.good} good</span>}
              {applicationCounts.maybe > 0 && <span className="text-muted-foreground">{applicationCounts.maybe} maybe</span>}
              {applicationCounts.not_qualified > 0 && <span className="text-destructive">{applicationCounts.not_qualified} not qualified</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy link">
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleToggleStatus} title={job.status === "active" ? "Pause" : "Activate"}>
              {job.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate(`/screening-jobs/${job.id}`)} title="View applicants">
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default JobCard;
