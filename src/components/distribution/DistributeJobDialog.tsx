import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Linkedin, Globe, Briefcase, Rss, Loader2, Share2 } from "lucide-react";

interface DistributeJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  jobTitle: string;
  onDistributed: () => void;
}

const platforms = [
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, description: "Deep link to LinkedIn job posting form" },
  { id: "indeed", label: "Indeed", icon: Briefcase, description: "Generate XML feed for Indeed crawling" },
  { id: "wellfound", label: "Wellfound", icon: Globe, description: "Pre-filled application link" },
  { id: "xml_feed", label: "Custom XML Feed", icon: Rss, description: "ATS-compatible XML/JSON feed URL" },
];

const DistributeJobDialog = ({ open, onOpenChange, jobId, jobTitle, onDistributed }: DistributeJobDialogProps) => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleDistribute = async () => {
    if (!user || selected.length === 0) return;
    setLoading(true);

    const feedUrl = `${window.location.origin}/api/job-feed?user=${user.id}`;
    const records = selected.map(platform => ({
      job_id: jobId,
      user_id: user.id,
      platform,
      status: platform === "xml_feed" ? "posted" : "pending",
      feed_url: platform === "xml_feed" ? feedUrl : null,
    }));

    const { error } = await supabase.from("job_distribution_status" as any).insert(records as any);
    setLoading(false);

    if (error) {
      toast.error("Failed to distribute job");
      return;
    }

    toast.success(`Job distributed to ${selected.length} platform(s)!`);
    setSelected([]);
    onDistributed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card/95 backdrop-blur-xl border-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Distribute Job
          </DialogTitle>
          <DialogDescription>Select platforms to distribute "{jobTitle}"</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {platforms.map(p => (
            <label
              key={p.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                selected.includes(p.id)
                  ? "border-primary/40 bg-primary/5"
                  : "border-border/50 hover:border-border"
              }`}
            >
              <Checkbox
                checked={selected.includes(p.id)}
                onCheckedChange={() => toggle(p.id)}
              />
              <p.icon className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleDistribute} disabled={loading || selected.length === 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Share2 className="h-4 w-4 mr-2" />}
            Distribute ({selected.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DistributeJobDialog;
