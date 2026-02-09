import { useState, lazy, Suspense } from "react";
import { Plus, Target, Loader2, CheckSquare, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ICPProfile } from "@/types/icp";
import { ICPProfileCard } from "@/components/icp/ICPProfileCard";
import { useNavigate } from "react-router-dom";
import { useICPSessions } from "@/hooks/useICPSessions";
import { useToast } from "@/components/ui/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";

// Lazy load the sensitive dialog to prevent import crashes
const CreateICPDialog = lazy(() => import("@/components/icp/CreateICPDialog").then(module => ({ default: module.CreateICPDialog })));

const ICPManager = () => {
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
    const [selectionMode, setSelectionMode] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const navigate = useNavigate();
    const { toast } = useToast();

    // Use custom hook for data fetching with pagination and caching
    const { sessions, isLoading, isValidating, error, hasMore, loadMore, deleteSessions, refresh } = useICPSessions({
        pageSize: 20
    });

    // Selection handlers
    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedSessions(new Set(sessions.map(s => s.id)));
        } else {
            setSelectedSessions(new Set());
        }
    };

    const handleSelectSession = (id: string, selected: boolean) => {
        const newSelection = new Set(selectedSessions);
        if (selected) {
            newSelection.add(id);
        } else {
            newSelection.delete(id);
        }
        setSelectedSessions(newSelection);
    };

    const handleBulkDelete = async () => {
        const sessionIds = Array.from(selectedSessions);
        if (sessionIds.length === 0) return;

        const confirmMessage = `Are you sure you want to delete ${sessionIds.length} session${sessionIds.length > 1 ? 's' : ''}? This will also delete all related candidates.`;
        if (!confirm(confirmMessage)) return;

        setIsDeleting(true);
        try {
            await deleteSessions(sessionIds);
            toast({
                title: "Success",
                description: `Deleted ${sessionIds.length} session${sessionIds.length > 1 ? 's' : ''} successfully`,
                className: "border-[#00FF85] text-[#00FF85]"
            });
            setSelectedSessions(new Set());
            setSelectionMode(false);
        } catch (error: any) {
            console.error('[ICPManager] Bulk delete failed:', error);
            toast({
                title: "Delete Failed",
                description: error.message || "Failed to delete sessions",
                variant: "destructive"
            });
        } finally {
            setIsDeleting(false);
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
            toast({
                title: "Success",
                description: "Session deleted successfully",
                className: "border-[#00FF85] text-[#00FF85]"
            });
        } catch (error: any) {
            toast({
                title: "Delete Failed",
                description: error.message || "Failed to delete session",
                variant: "destructive"
            });
        } finally {
            setIsDeleting(false);
        }
    };

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-[#050505] text-white">
                <div className="w-8 h-8 rounded-full border-2 border-[#00FF85] border-t-transparent animate-spin mb-4" />
                <div className="font-mono text-sm text-[#00FF85]">Initializing Engine...</div>
                <div className="font-mono text-xs text-gray-500 mt-2">Loading sessions...</div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background p-6">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                    <Target className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">Error Loading Dashboard</h2>
                <p className="text-muted-foreground mb-6 text-center max-w-md">{error.message}</p>
                <Button onClick={refresh} variant="outline">Retry</Button>
            </div>
        );
    }

    const allSelected = sessions.length > 0 && selectedSessions.size === sessions.length;
    const someSelected = selectedSessions.size > 0 && selectedSessions.size < sessions.length;

    return (
        <div className="min-h-screen bg-background p-6 space-y-6 pb-32">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Target className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">ICP Intelligence</h1>
                        <p className="text-muted-foreground">
                            Manage your Ideal Customer Profile search strategies
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {sessions.length > 0 && (
                        <Button
                            variant={selectionMode ? "secondary" : "outline"}
                            onClick={() => {
                                setSelectionMode(!selectionMode);
                                setSelectedSessions(new Set());
                            }}
                            className="gap-2"
                        >
                            {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                            {selectionMode ? "Cancel Selection" : "Select"}
                        </Button>
                    )}
                    <Button
                        onClick={() => setIsCreateDialogOpen(true)}
                        className="gap-2 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all"
                    >
                        <Plus className="w-4 h-4" />
                        Create New Profile
                    </Button>
                </div>
            </div>

            {/* Selection Mode Header */}
            {selectionMode && sessions.length > 0 && (
                <div className="flex items-center gap-3 bg-muted/50 rounded-lg p-4 border border-border">
                    <Checkbox
                        checked={allSelected}
                        ref={(el) => {
                            if (el) {
                                (el as any).indeterminate = someSelected;
                            }
                        }}
                        onCheckedChange={handleSelectAll}
                        className="h-5 w-5"
                    />
                    <span className="text-sm font-medium">
                        {selectedSessions.size > 0
                            ? `${selectedSessions.size} of ${sessions.length} selected`
                            : "Select all sessions"
                        }
                    </span>
                </div>
            )}

            {/* Profile Cards Grid */}
            {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                    <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mb-6">
                        <Target className="w-10 h-10 text-muted-foreground" />
                    </div>
                    <h2 className="text-2xl font-semibold mb-2">No ICP Profiles Yet</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">
                        Create your first Ideal Customer Profile to start matching leads with precision scoring
                    </p>
                    <Button
                        onClick={() => setIsCreateDialogOpen(true)}
                        className="gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        Create Your First Profile
                    </Button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sessions.map((profile) => (
                            <ICPProfileCard
                                key={profile.id}
                                profile={profile}
                                selected={selectedSessions.has(profile.id)}
                                selectionMode={selectionMode}
                                onSelect={handleSelectSession}
                                onDelete={handleDeleteProfile}
                                onClick={() => {
                                    if (!selectionMode) {
                                        navigate(`/icp/results/${profile.id}`);
                                    }
                                }}
                            />
                        ))}
                    </div>

                    {/* Load More Button */}
                    {hasMore && (
                        <div className="flex justify-center pt-6">
                            <Button
                                onClick={loadMore}
                                variant="outline"
                                disabled={isValidating}
                                className="gap-2"
                            >
                                {isValidating ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    <>Load More</>
                                )}
                            </Button>
                        </div>
                    )}
                </>
            )}

            {/* Floating Action Bar for Bulk Actions */}
            <AnimatePresence>
                {selectedSessions.size > 0 && (
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
                    >
                        <div className="bg-card/95 backdrop-blur-lg border-2 border-border shadow-2xl shadow-black/50 rounded-2xl px-6 py-4 flex items-center gap-4">
                            <span className="text-sm font-semibold">
                                {selectedSessions.size} session{selectedSessions.size > 1 ? 's' : ''} selected
                            </span>
                            <div className="h-6 w-px bg-border" />
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={handleBulkDelete}
                                disabled={isDeleting}
                                className="gap-2 bg-red-600 hover:bg-red-700"
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        Delete Selected
                                    </>
                                )}
                            </Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Lazy Loaded Dialog with Suspense */}
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
