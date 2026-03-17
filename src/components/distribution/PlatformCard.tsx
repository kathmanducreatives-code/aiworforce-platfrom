import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, RefreshCw, AlertTriangle, Trash2 } from "lucide-react";
import { firecrawl } from "@/lib/firecrawl";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function PlatformCard({ posting, originalJob, onSynced }: { posting: any, originalJob: any, onSynced: () => void }) {
    const { user } = useAuth();
    const [syncing, setSyncing] = useState(false);
    const [showDrift, setShowDrift] = useState(false);
    const [showDelete, setShowDelete] = useState(false);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const response = await (firecrawl as any).scrapeUrl(posting.platform_url, {
                formats: ['extract'],
                extract: {
                    prompt: "Is this job still active? Extract: current job title, description, salary if visible, applicant count if visible, whether the posting appears expired or removed"
                }
            });
            const data = response?.data || response;
            const extract = data?.extract;

            if (!extract) throw new Error("Could not extract data from the URL");

            const isRemoved = extract.posting_appears_expired_or_removed?.toString().toLowerCase().includes('true') || false;

            let driftDetected = false;
            let driftSummary = "";

            if (!isRemoved && extract.current_job_title && originalJob.title) {
                if (extract.current_job_title.toLowerCase() !== originalJob.title.toLowerCase()) {
                    driftDetected = true;
                    driftSummary = `Title drifted from "${originalJob.title}" to "${extract.current_job_title}".`;
                }
            }

            await (supabase as any).from("job_distribution_postings")
                .update({
                    last_scraped_at: new Date().toISOString(),
                    scrape_status: isRemoved ? 'removed' : 'active',
                    is_active: !isRemoved,
                    scraped_title: extract.current_job_title,
                    scraped_description: extract.description,
                    scraped_salary: extract.salary,
                    scraped_applicant_count: extract.applicant_count,
                    drift_detected: driftDetected,
                    drift_summary: driftSummary
                }).eq('id', posting.id);

            if (user) {
                await (supabase as any).from("firecrawl_scrape_logs").insert({
                    user_id: user.id,
                    feature: 'distribution_sync',
                    url: posting.platform_url,
                    status: 'success'
                });
            }

            toast.success(`Synced ${posting.platform_name} successfully`);
            onSynced();
        } catch (err) {
            toast.error("Sync failed");
            console.error(err);
        } finally {
            setSyncing(false);
        }
    };

    const handleRemove = async () => {
        try {
            await (supabase as any).from("job_distribution_postings").delete().eq("id", posting.id);
            toast.success("Platform removed");
            onSynced();
        } catch (e) {
            toast.error("Failed to remove platform");
        } finally {
            setShowDelete(false);
        }
    };

    const domain = new URL(posting.platform_url).hostname;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;

    const getStatusBadge = () => {
        if (!posting.is_active || posting.scrape_status === 'removed') return <Badge variant="destructive" className="ml-auto">Removed</Badge>;
        if (posting.drift_detected) return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30 ml-auto border border-yellow-500/30">Drift Detected</Badge>;
        if (posting.scrape_status === 'active') return <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 ml-auto border border-emerald-500/20">Active</Badge>;
        return <Badge variant="secondary" className="ml-auto">Pending</Badge>;
    };

    return (
        <>
            <div className="border border-border/50 bg-card/60 backdrop-blur-sm rounded-xl p-5 flex flex-col justify-between h-full hover:border-border transition-colors group">
                <div>
                    {/* Top Row */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="h-8 w-8 rounded-md bg-white p-1 border border-border/60 shrink-0">
                            <img src={faviconUrl} alt={`${posting.platform_name} icon`} className="h-full w-full object-contain" />
                        </div>
                        <h3 className="font-semibold text-foreground text-sm">{posting.platform_name}</h3>
                        {getStatusBadge()}
                    </div>

                    {/* Middle Row */}
                    <div className="mb-4">
                        <p className="font-semibold text-foreground text-base truncate">
                            {posting.scraped_title || originalJob?.title}
                            <span className="font-normal text-muted-foreground ml-1">at {originalJob?.company_name}</span>
                        </p>
                        <a href={posting.platform_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 mt-1 truncate">
                            {domain} <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>

                    {/* Data Row */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5 mb-4">
                        <div>
                            <span className="font-medium text-foreground">{posting.scraped_applicant_count || '—'}</span> Applicants
                        </div>
                        <div>
                            Last synced: {posting.last_scraped_at ? formatDistanceToNow(new Date(posting.last_scraped_at), { addSuffix: true }) : 'Never'}
                        </div>
                    </div>

                    {/* Drift Section */}
                    {posting.drift_detected && (
                        <div className="mb-4 p-3 rounded-md border border-yellow-500/30 bg-yellow-500/5 flex flex-col gap-2">
                            <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400 font-medium">
                                <AlertTriangle className="h-4 w-4 shrink-0" />
                                Content has changed since you posted
                            </div>
                            <Button variant="secondary" size="sm" onClick={() => setShowDrift(true)} className="bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20 w-fit">
                                View Diff
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer Row */}
                <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/40">
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-2 border-primary/20 hover:border-primary/50">
                        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Syncing...' : 'Sync Now'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowDelete(true)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <Dialog open={showDrift} onOpenChange={setShowDrift}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Content Diff: {posting.platform_name}</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-hidden flex flex-col md:flex-row gap-4 py-4 text-sm mt-2">
                        {/* Left Panel: Original */}
                        <div className="flex-1 border border-border/50 rounded-lg p-4 bg-muted/30 overflow-y-auto">
                            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4 pb-2 border-b border-border/50">Original (ScreeningPilot)</div>
                            <h3 className="font-bold text-lg text-foreground mb-1">{originalJob?.title}</h3>
                            <p className="text-primary mb-4">{originalJob?.company_name}</p>
                            <div className="whitespace-pre-wrap text-foreground/80 font-mono text-xs">
                                {originalJob?.description}
                            </div>
                        </div>

                        {/* Right Panel: Scraped */}
                        <div className="flex-1 border border-yellow-500/30 rounded-lg p-4 bg-yellow-500/5 overflow-y-auto">
                            <div className="text-xs font-semibold uppercase tracking-wider text-yellow-600 mb-4 pb-2 border-b border-yellow-500/30">Current ({posting.platform_name})</div>
                            <h3 className="font-bold text-lg text-foreground mb-1">{posting.scraped_title || 'N/A'}</h3>
                            <p className="text-primary mb-4">{originalJob?.company_name}</p>
                            <div className="whitespace-pre-wrap text-foreground/80 font-mono text-xs">
                                {posting.scraped_description || 'No description extracted.'}
                            </div>
                            {posting.drift_summary && (
                                <div className="mt-4 p-3 bg-background rounded border border-border text-xs">
                                    <strong>AI Summary:</strong> {posting.drift_summary}
                                </div>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Tracked Platform?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will stop tracking the job posting on {posting.platform_name}. The actual live job post will not be deleted, only our tracking of it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
