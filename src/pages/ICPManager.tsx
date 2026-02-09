import { useState, useMemo, lazy, Suspense } from "react";
import { Plus, Target, Loader2, CheckSquare, Square, Trash2, Search, Users, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ICPProfile } from "@/types/icp";
import { ICPProfileCard } from "@/components/icp/ICPProfileCard";
import { useNavigate } from "react-router-dom";
import { useICPSessions } from "@/hooks/useICPSessions";
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CreateICPDialog = lazy(() => import("@/components/icp/CreateICPDialog").then(module => ({ default: module.CreateICPDialog })));

const ICPManager = () => {
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
    const [selectionMode, setSelectionMode] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const navigate = useNavigate();
    const { toast } = useToast();

    const { sessions, isLoading, isValidating, error, hasMore, loadMore, deleteSessions, refresh } = useICPSessions({
        pageSize: 20
    });

    // Compute aggregate stats
    const stats = useMemo(() => {
        const totalCandidates = sessions.reduce((sum, s) => sum + (s.candidate_count || 0), 0);
        const withScores = sessions.filter(s => (s.avg_score || 0) > 0);
        const avgMatchScore = withScores.length > 0
            ? Math.round(withScores.reduce((sum, s) => sum + (s.avg_score || 0), 0) / withScores.length)
            : 0;
        const totalStrong = sessions.reduce((sum, s) => sum + (s.strong_matches_count || 0), 0);
        return { totalSessions: sessions.length, totalCandidates, avgMatchScore, totalStrong };
    }, [sessions]);

    // Filter sessions by search
    const filteredSessions = useMemo(() => {
        if (!searchQuery.trim()) return sessions;
        const q = searchQuery.toLowerCase();
        return sessions.filter(s =>
            (s.name || '').toLowerCase().includes(q) ||
            (s.industries || []).some(i => String(i).toLowerCase().includes(q)) ||
            (s.industry_names || []).some(i => String(i).toLowerCase().includes(q))
        );
    }, [sessions, searchQuery]);

    // Selection handlers
    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedSessions(new Set(filteredSessions.map(s => s.id)));
        } else {
            setSelectedSessions(new Set());
        }
    };

    const handleSelectSession = (id: string, selected: boolean) => {
        const newSelection = new Set(selectedSessions);
        if (selected) newSelection.add(id);
        else newSelection.delete(id);
        setSelectedSessions(newSelection);
    };

    const handleBulkDelete = async () => {
        const sessionIds = Array.from(selectedSessions);
        if (sessionIds.length === 0) return;

        setIsDeleting(true);
        try {
            await deleteSessions(sessionIds);
            toast({
                title: "Deleted successfully",
                description: `Removed ${sessionIds.length} session${sessionIds.length > 1 ? 's' : ''}`,
                className: "border-primary/30 text-primary"
            });
            setSelectedSessions(new Set());
            setSelectionMode(false);
        } catch (error: any) {
            toast({ title: "Delete Failed", description: error.message || "Failed to delete sessions", variant: "destructive" });
        } finally {
            setIsDeleting(false);
            setShowDeleteDialog(false);
        }
    };

    const handleCreateProfile = (profile: ICPProfile) => {
        refresh();
        setIsCreateDialogOpen(false);
    };

    const handleDeleteProfile = async (id: string) => {
        setIsDeleting(true);
        try {
            await deleteSessions([id]);
            toast({ title: "Session deleted", className: "border-primary/30 text-primary" });
        } catch (error: any) {
            toast({ title: "Delete Failed", description: error.message, variant: "destructive" });
        } finally {
            setIsDeleting(false);
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground">
                <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mb-4" />
                <div className="font-mono text-sm text-primary">Initializing Engine...</div>
                <div className="font-mono text-xs text-muted-foreground mt-2">Loading sessions...</div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
                <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
                    <Target className="w-8 h-8 text-destructive" />
                </div>
                <h2 className="text-xl font-bold mb-2">Error Loading Dashboard</h2>
                <p className="text-muted-foreground mb-6 text-center max-w-md">{error.message}</p>
                <Button onClick={refresh} variant="outline">Retry</Button>
            </div>
        );
    }

    const allSelected = filteredSessions.length > 0 && selectedSessions.size === filteredSessions.length;
    const someSelected = selectedSessions.size > 0 && selectedSessions.size < filteredSessions.length;

    return (
        <div className="min-h-screen bg-background p-4 sm:p-6 space-y-5 pb-32">
            {/* Header - responsive */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Target className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold truncate">ICP Intelligence</h1>
                        <p className="text-muted-foreground text-sm hidden sm:block">
                            Manage your Ideal Customer Profile search strategies
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {sessions.length > 0 && (
                        <Button
                            variant={selectionMode ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => { setSelectionMode(!selectionMode); setSelectedSessions(new Set()); }}
                            className="gap-1.5"
                        >
                            {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            <span className="hidden sm:inline">{selectionMode ? "Cancel" : "Select"}</span>
                        </Button>
                    )}
                    <Button
                        onClick={() => setIsCreateDialogOpen(true)}
                        size="sm"
                        className="gap-1.5 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all"
                    >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline">Create Profile</span>
                        <span className="sm:hidden">New</span>
                    </Button>
                </div>
            </div>

            {/* Stats Bar */}
            {sessions.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { label: "Sessions", value: stats.totalSessions, icon: Target, color: "text-primary" },
                        { label: "Candidates", value: stats.totalCandidates, icon: Users, color: "text-blue-400" },
                        { label: "Avg Match", value: `${stats.avgMatchScore}%`, icon: TrendingUp, color: "text-emerald-400" },
                        { label: "Strong Matches", value: stats.totalStrong, icon: Zap, color: "text-yellow-400" },
                    ].map((stat) => (
                        <div key={stat.label} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm p-3">
                            <stat.icon className={`w-4 h-4 ${stat.color} flex-shrink-0`} />
                            <div className="min-w-0">
                                <p className="text-lg font-bold leading-none">{stat.value}</p>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{stat.label}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Search Bar */}
            {sessions.length > 0 && (
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search sessions by name or industry..."
                        className="pl-9 h-9 bg-card/40 border-border/50 focus:border-primary/50"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {/* Selection Mode Header */}
            {selectionMode && filteredSessions.length > 0 && (
                <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-3 border border-border">
                    <Checkbox
                        checked={allSelected}
                        ref={(el) => { if (el) (el as any).indeterminate = someSelected; }}
                        onCheckedChange={handleSelectAll}
                        className="h-5 w-5"
                    />
                    <span className="text-sm font-medium">
                        {selectedSessions.size > 0
                            ? `${selectedSessions.size} of ${filteredSessions.length} selected`
                            : "Select all sessions"
                        }
                    </span>
                </div>
            )}

            {/* Profile Cards Grid */}
            {filteredSessions.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-16">
                    <Search className="w-10 h-10 text-muted-foreground/50 mb-4" />
                    <h2 className="text-lg font-semibold mb-1">No matching sessions</h2>
                    <p className="text-muted-foreground text-sm">Try a different search term</p>
                </div>
            ) : sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                    <div className="w-20 h-20 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center mb-6">
                        <Target className="w-10 h-10 text-primary/60" />
                    </div>
                    <h2 className="text-2xl font-semibold mb-2">No ICP Profiles Yet</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">
                        Create your first Ideal Customer Profile to start matching leads with precision scoring
                    </p>
                    <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
                        <Plus className="w-4 h-4" /> Create Your First Profile
                    </Button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredSessions.map((profile) => (
                            <ICPProfileCard
                                key={profile.id}
                                profile={profile}
                                selected={selectedSessions.has(profile.id)}
                                selectionMode={selectionMode}
                                onSelect={handleSelectSession}
                                onDelete={handleDeleteProfile}
                                onClick={() => { if (!selectionMode) navigate(`/icp/results/${profile.id}`); }}
                            />
                        ))}
                    </div>

                    {hasMore && (
                        <div className="flex justify-center pt-4">
                            <Button onClick={loadMore} variant="outline" disabled={isValidating} className="gap-2">
                                {isValidating ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading...</> : <>Load More</>}
                            </Button>
                        </div>
                    )}
                </>
            )}

            {/* Floating Bulk Action Bar */}
            <AnimatePresence>
                {selectedSessions.size > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
                    >
                        <div className="bg-card/95 backdrop-blur-lg border-2 border-border shadow-2xl shadow-black/50 rounded-2xl px-5 py-3 flex items-center gap-4">
                            <span className="text-sm font-semibold whitespace-nowrap">
                                {selectedSessions.size} selected
                            </span>
                            <div className="h-5 w-px bg-border" />
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setShowDeleteDialog(true)}
                                disabled={isDeleting}
                                className="gap-2"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete Confirmation AlertDialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedSessions.size} session{selectedSessions.size > 1 ? 's' : ''}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the selected sessions and all related candidate data. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleBulkDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Deleting...</> : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Lazy Loaded Create Dialog */}
            {isCreateDialogOpen && (
                <Suspense fallback={
                    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-[60]">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                }>
                    <CreateICPDialog
                        open={isCreateDialogOpen}
                        onOpenChange={setIsCreateDialogOpen}
                        onSuccess={handleCreateProfile}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default ICPManager;
