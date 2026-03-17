import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Radar, Briefcase, RefreshCw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// Helper to generate consistent avatar background colors from string hashes
const stringToColorClass = (str: string) => {
    const colors = [
        'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
        'bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30',
        'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
        'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
        'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
        'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30',
        'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
        'bg-violet-500/20 text-violet-600 dark:text-violet-400 border-violet-500/30',
        'bg-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30',
        'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/30',
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

export default function CompetitorCard({ competitor, onRefreshRequested }: { competitor: any, onRefreshRequested: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const [jobs, setJobs] = useState<any[]>([]);
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [showDelete, setShowDelete] = useState(false);

    useEffect(() => {
        if (expanded && jobs.length === 0) {
            setLoadingJobs(true);
            (supabase as any).from("competitor_job_postings")
                .select("*")
                .eq("competitor_id", competitor.id)
                .order("first_seen_at", { ascending: false })
                .then(({ data }: { data: any }) => {
                    if (data) setJobs(data);
                    setLoadingJobs(false);
                });
        }
    }, [expanded, competitor.id]);

    const handleRemove = async () => {
        try {
            await (supabase as any).from("competitor_companies").delete().eq("id", competitor.id);
            toast.success("Competitor removed");
            onRefreshRequested();
        } catch (e) {
            toast.error("Failed to remove competitor");
        } finally {
            setShowDelete(false);
        }
    };

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const newJobsCount = jobs.filter(j => j.is_new && new Date(j.first_seen_at) > oneWeekAgo).length;
    // If jobs not loaded yet, we can't show exact newJobsCount unless we fetch it. We'll show a generic indicator if we don't have jobs yet.

    const avatarColor = stringToColorClass(competitor.company_name);
    const initials = competitor.company_name.substring(0, 2).toUpperCase();

    return (
        <>
            <div className="border border-border/60 bg-card rounded-xl overflow-hidden flex flex-col transition-all hover:border-border/80 hover:shadow-sm">
                <div className="p-5">
                    {/* Top Header Row */}
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-4">
                            <div className={cn("h-12 w-12 rounded-full border flex items-center justify-center font-bold text-lg shrink-0", avatarColor)}>
                                {initials}
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg text-foreground leading-tight">{competitor.company_name}</h3>
                                <a href={competitor.careers_url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1 mt-0.5 truncate max-w-[250px] sm:max-w-md">
                                    {competitor.careers_url} <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground hidden sm:block text-right">
                            <div className="mb-1">
                                {competitor.crawl_status === 'crawling' ? (
                                    <span className="text-primary flex items-center gap-1 justify-end"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Crawling now...</span>
                                ) : (
                                    <span className="flex items-center gap-1 justify-end"><Radar className="h-3.5 w-3.5" /> Checked {competitor.last_crawled_at ? formatDistanceToNow(new Date(competitor.last_crawled_at), { addSuffix: true }) : 'Never'}</span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
                        <div className="flex flex-col">
                            <span className="text-2xl font-bold text-foreground tabular-nums">{competitor.total_jobs_found || 0}</span>
                            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Total Roles</span>
                        </div>
                        {/* If we had "removed" or accurate "new" stats we would put them here. */}
                        {expanded && newJobsCount > 0 && (
                            <div className="flex flex-col">
                                <span className="text-2xl font-bold text-emerald-500 tabular-nums">+{newJobsCount}</span>
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 uppercase tracking-wider font-medium">New This Week</span>
                            </div>
                        )}
                    </div>

                    {/* Mobile only last checked */}
                    <div className="text-xs text-muted-foreground sm:hidden mt-4 pt-4 border-t border-border/30">
                        {competitor.crawl_status === 'crawling' ? 'Crawling...' : `Checked ${competitor.last_crawled_at ? formatDistanceToNow(new Date(competitor.last_crawled_at), { addSuffix: true }) : 'Never'}`}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-5 py-3 bg-muted/20 border-t border-border/40 flex justify-between items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground hover:bg-muted/50 gap-2">
                        {expanded ? <><ChevronUp className="h-4 w-4" /> Hide Pipeline ({jobs.length})</> : <><ChevronDown className="h-4 w-4" /> View Pipeline</>}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={onRefreshRequested} disabled={competitor.crawl_status === 'crawling'} className="gap-2 border-primary/20 hover:border-primary/50 text-foreground">
                            <Radar className={`h-3.5 w-3.5 ${competitor.crawl_status === 'crawling' ? 'animate-pulse text-primary' : ''}`} /> {competitor.crawl_status === 'crawling' ? '...' : 'Crawl Now'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setShowDelete(true)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Expandable Table */}
                <div className={cn("grid transition-all duration-300 ease-in-out", expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden">
                        <div className="bg-muted/10 border-t border-border/50 max-h-[320px] overflow-y-auto">
                            {loadingJobs ? (
                                <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                                    <RefreshCw className="h-4 w-4 animate-spin" /> Loading jobs...
                                </div>
                            ) : jobs.length === 0 ? (
                                <div className="p-8 text-center text-sm text-muted-foreground">No jobs explicitly found yet.</div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-muted/30 sticky top-0 z-10">
                                        <TableRow className="border-border/50 hover:bg-transparent">
                                            <TableHead className="w-[300px] text-muted-foreground font-medium text-xs">Job Title</TableHead>
                                            <TableHead className="text-muted-foreground font-medium text-xs">Department</TableHead>
                                            <TableHead className="text-muted-foreground font-medium text-xs hidden sm:table-cell">Location</TableHead>
                                            <TableHead className="text-muted-foreground font-medium text-xs text-right">First Seen</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {jobs.map(j => {
                                            const isNew = j.is_new && new Date(j.first_seen_at) > oneWeekAgo;
                                            return (
                                                <TableRow key={j.id} className="border-border/30 group">
                                                    <TableCell className="font-medium py-3">
                                                        <div className="flex items-center gap-2">
                                                            <a href={j.job_url} target="_blank" className="text-primary hover:underline truncate max-w-[200px] sm:max-w-xs" rel="noreferrer" title={j.job_title}>
                                                                {j.job_title}
                                                            </a>
                                                            {isNew && <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 py-0 text-[10px] h-4">New</Badge>}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground py-3 text-xs">{j.department || '—'}</TableCell>
                                                    <TableCell className="text-muted-foreground py-3 text-xs hidden sm:table-cell">{j.location || '—'}</TableCell>
                                                    <TableCell className="text-muted-foreground py-3 text-xs text-right tabular-nums whitespace-nowrap">
                                                        {formatDistanceToNow(new Date(j.first_seen_at), { addSuffix: true })}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Stop Tracking Competitor?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove {competitor.company_name} from your list and delete all historical job tracking data.
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
