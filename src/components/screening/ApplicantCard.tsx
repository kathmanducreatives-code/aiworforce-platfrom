import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Clock, Eye, Download, MonitorOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ApplicantCardProps {
  application: any;
  onViewDetails: () => void;
}

const getCategoryConfig = (cat: string | null) => {
  switch (cat) {
    case "strong_fit": return { label: "Strong Fit", accent: "bg-emerald-500", bar: "from-emerald-500/30 to-emerald-500/5", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", avatar: "from-emerald-600/80 to-emerald-500/60" };
    case "good_fit": return { label: "Good Fit", accent: "bg-amber-500", bar: "from-amber-500/30 to-amber-500/5", badge: "bg-amber-500/15 text-amber-400 border-amber-500/30", avatar: "from-amber-600/80 to-amber-500/60" };
    case "maybe": return { label: "Maybe", accent: "bg-muted-foreground/40", bar: "from-muted/40 to-muted/5", badge: "bg-muted/50 text-muted-foreground border-border/50", avatar: "from-muted-foreground/40 to-muted-foreground/20" };
    case "not_qualified": return { label: "Not Qualified", accent: "bg-destructive", bar: "from-destructive/30 to-destructive/5", badge: "bg-destructive/15 text-destructive border-destructive/30", avatar: "from-destructive/60 to-destructive/40" };
    default: return { label: "Pending", accent: "bg-muted-foreground/30", bar: "from-muted/30 to-muted/5", badge: "bg-muted/40 text-muted-foreground border-border/40", avatar: "from-muted-foreground/30 to-muted-foreground/15" };
  }
};

const getScoreColor = (score: number | null) => {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-muted-foreground";
  return "text-destructive";
};

const ApplicantCard = ({ application, onViewDetails }: ApplicantCardProps) => {
  const extracted = application.extracted_data as any;
  const name = extracted?.name || "Unknown Candidate";
  const initials = name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();
  const score = application.match_score;
  const config = getCategoryConfig(application.match_category);
  const strengths = (application.strengths as any[] || []).slice(0, 2);
  const redFlags = (application.red_flags as any[] || []).slice(0, 2);
  const totalMinutes = Math.round((application.total_time_seconds || 0) / 60);

  const handleDownload = async () => {
    if (!application.resume_url) return;
    const { data } = await supabase.storage.from("screening-resumes").createSignedUrl(application.resume_url, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Failed to generate download link");
  };

  return (
    <div className="relative group rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 overflow-hidden flex flex-col">
      {/* Top accent gradient bar */}
      <div className={`h-0.5 w-full bg-gradient-to-r ${config.bar} flex-shrink-0`} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header: Avatar + Name + Score */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${config.avatar} flex items-center justify-center flex-shrink-0 text-white font-semibold text-sm border border-white/10`}>
              {initials || "?"}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-foreground text-sm leading-tight truncate">{name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(application.created_at), "MMM d, yyyy")}
              </p>
            </div>
          </div>
          {/* Score + Category */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {score != null && (
              <span className={`text-xl font-bold leading-none ${getScoreColor(score)}`}>
                {score}%
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${config.badge}`}>
              {config.label}
            </span>
          </div>
        </div>

        {/* Strengths */}
        {strengths.length > 0 && (
          <div className="space-y-1">
            {strengths.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span className="line-clamp-1">{typeof s === 'string' ? s : (s as any)?.text || JSON.stringify(s)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Red Flags */}
        {redFlags.length > 0 && (
          <div className="space-y-1">
            {redFlags.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span className="line-clamp-1">{typeof r === 'string' ? r : (r as any)?.text || JSON.stringify(r)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 mt-auto">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />{totalMinutes}m
            </span>
            <span className="flex items-center gap-1">
              <MonitorOff className="h-3 w-3" />{application.tab_switches || 0}
            </span>
          </div>
          <div className="flex gap-1.5">
            {application.resume_url && (
              <Button variant="ghost" size="sm" onClick={handleDownload} className="h-7 w-7 p-0 hover:bg-muted/50">
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onViewDetails} className="h-7 px-3 text-xs border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:text-primary">
              <Eye className="h-3.5 w-3.5 mr-1" /> Details
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApplicantCard;
