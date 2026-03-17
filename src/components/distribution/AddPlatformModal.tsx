import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AddPlatformModal({ open, onOpenChange, jobs, onAdded }: { open: boolean, onOpenChange: (open: boolean) => void, jobs: any[], onAdded: () => void }) {
    const [jobId, setJobId] = useState("");
    const [platform, setPlatform] = useState("");
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!jobId || !platform || !url) return toast.error("Please fill in all fields");
        if (!url.startsWith("https://")) return toast.error("Live URL must start with https://");

        setLoading(true);

        try {
            const { error } = await (supabase as any).from("job_distribution_postings").insert({
                job_id: jobId,
                platform_name: platform,
                platform_url: url,
                posted_at: new Date().toISOString()
            });
            if (error) throw error;
            toast.success("Platform added for tracking");
            onAdded();
            onOpenChange(false);
            setPlatform("");
            setUrl("");
            setJobId("");
        } catch (err) {
            toast.error("Failed to add platform");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Job Platform</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label>Select Job</Label>
                        <Select value={jobId} onValueChange={setJobId}>
                            <SelectTrigger className="bg-background/80 border-border/60">
                                <SelectValue placeholder="Which job is this for?" />
                            </SelectTrigger>
                            <SelectContent>
                                {jobs.map(j => (
                                    <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Platform Name</Label>
                        <Select value={platform} onValueChange={setPlatform}>
                            <SelectTrigger className="bg-background/80 border-border/60">
                                <SelectValue placeholder="Select platform..." />
                            </SelectTrigger>
                            <SelectContent>
                                {["LinkedIn", "Indeed", "Wellfound", "Glassdoor", "Lever", "Greenhouse", "Ashby", "Workday", "Company Site", "Other"].map(p => (
                                    <SelectItem key={p} value={p}>{p}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Live Job URL</Label>
                        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="bg-background/80 border-border/60" />
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Start Tracking
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
