import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Clock, Eye, Download, MonitorOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ApplicantCardProps {
  application: any;
  onViewDetails: () => void;
}

const getCategoryStyle = (cat: string | null) => {
  switch (cat) {
    case "strong_fit": return { label: "Strong Fit", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    case "good_fit": return { label: "Good Fit", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
    case "maybe": return { label: "Maybe", color: "bg-muted text-muted-foreground border-border" };
    case "not_qualified": return { label: "Not Qualified", color: "bg-destructive/20 text-destructive border-destructive/30" };
    default: return { label: "Pending", color: "bg-muted text-muted-foreground border-border" };
  }
};

const ApplicantCard = ({ application, onViewDetails }: ApplicantCardProps) => {
  const extracted = application.extracted_data as any;
  const name = extracted?.name || "Unknown Candidate";
  const score = application.match_score;
  const cat = getCategoryStyle(application.match_category);
  const strengths = (application.strengths as any[] || []).slice(0, 3);
  const redFlags = (application.red_flags as any[] || []).slice(0, 2);
  const totalMinutes = Math.round((application.total_time_seconds || 0) / 60);

  const handleDownload = async () => {
    if (!application.resume_url) return;
    const { data } = await supabase.storage.from("screening-resumes").createSignedUrl(application.resume_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Failed to generate download link");
  };

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{name}</h3>
            <p className="text-xs text-muted-foreground">
              Applied {format(new Date(application.created_at), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {score != null && (
              <span className={`text-lg font-bold ${score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-400' : score >= 40 ? 'text-muted-foreground' : 'text-destructive'}`}>
                {score}%
              </span>
            )}
            <Badge variant="outline" className={cat.color}>{cat.label}</Badge>
          </div>
        </div>

        {strengths.length > 0 && (
          <div className="space-y-1">
            {strengths.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{typeof s === 'string' ? s : (s as any)?.text || JSON.stringify(s)}</span>
              </div>
            ))}
          </div>
        )}

        {redFlags.length > 0 && (
          <div className="space-y-1">
            {redFlags.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{typeof r === 'string' ? r : (r as any)?.text || JSON.stringify(r)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{totalMinutes}m</span>
            <span className="flex items-center gap-1"><MonitorOff className="h-3 w-3" />{application.tab_switches || 0} switches</span>
          </div>
          <div className="flex gap-1">
            {application.resume_url && (
              <Button variant="ghost" size="sm" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onViewDetails}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ApplicantCard;
