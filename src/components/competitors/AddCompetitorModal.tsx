import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { firecrawl } from "@/lib/firecrawl";
import { useAuth } from "@/hooks/useAuth";

export default function AddCompetitorModal({ open, onOpenChange, onAdded }: { open: boolean, onOpenChange: (open: boolean) => void, onAdded: () => void }) {
    const { user } = useAuth();
    const [name, setName] = useState("");
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || !url || !user) return toast.error("Please fill in all fields");
        if (!url.startsWith("http")) return toast.error("Careers page URL must start with http or https");
        setLoading(true);

        try {
            const { data: comp, error: compErr } = await (supabase as any).from("competitor_companies").insert({
                user_id: user.id,
                company_name: name,
                careers_url: url,
                crawl_status: 'crawling'
            }).select().single();

            if (compErr) throw compErr;

            // trigger firecrawl crawlUrl async in background without awaiting here for UI snappiness
            (firecrawl as any).crawlUrl(url, {
                limit: 50,
                scrapeOptions: {
                    formats: ['extract'],
                    extract: { prompt: "Find all job postings on this page. For each job return: title, URL, department, location, employment type as entirely separate objects." }
                }
            }).then(async (response: any) => {
                const jobs = response?.data?.[0]?.extract?.jobs || response?.[0]?.extract?.jobs || [];
                let foundCount = 0;
                if (Array.isArray(jobs)) {
                    foundCount = jobs.length;
                    for (const j of jobs) {
                        await (supabase as any).from("competitor_job_postings").insert({
                            competitor_id: comp.id,
                            job_title: j.title || 'Unknown',
                            job_url: j.url || j.URL || url,
                            department: j.department || null,
                            location: j.location || null,
                            employment_type: j.employment_type || null,
                            is_new: true,
                            raw_data: j
                        });
                    }
                }
                await (supabase as any).from("competitor_companies").update({
                    last_crawled_at: new Date().toISOString(),
                    crawl_status: 'completed',
                    total_jobs_found: foundCount
                }).eq("id", comp.id);

                await (supabase as any).from("firecrawl_scrape_logs").insert({
                    user_id: user.id,
                    feature: 'competitor_monitor',
                    url: url,
                    status: 'success',
                    response_summary: `Found ${foundCount} jobs`
                });
                toast.success(`Crawl finished. Found ${foundCount} jobs for ${name}.`);
            }).catch(async (e: any) => {
                await (supabase as any).from("competitor_companies").update({ crawl_status: 'failed' }).eq("id", comp.id);
                toast.error(`Crawl failed for ${name}`);
            });

            toast.success("Competitor added and crawl started.");
            onAdded();
            onOpenChange(false);
            setName("");
            setUrl("");
        } catch (err) {
            toast.error("Failed to add competitor");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Track a Competitor</DialogTitle>
                    <DialogDescription>
                        Enter the competitor's careers page URL. We will routinely crawl it to extract their latest open roles.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label>Company Name</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Corp" className="bg-background/80" />
                    </div>
                    <div className="space-y-2">
                        <Label>Careers Page URL</Label>
                        <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="bg-background/80" />
                        <p className="text-[11px] text-muted-foreground pl-1 mt-1">Make sure you link directly to the careers or jobs listing page (e.g., domain.com/careers).</p>
                    </div>
                    <Button type="submit" disabled={loading} className="w-full">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Start Crawling Jobs
                    </Button>
                </form>
            </DialogContent>
        </Dialog>
    );
}
