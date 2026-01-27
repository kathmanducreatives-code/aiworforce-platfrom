import { useState } from "react";
import { Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ICPProfile } from "@/types/icp";
import { ICPProfileCard } from "@/components/icp/ICPProfileCard";
import { CreateICPDialog } from "@/components/icp/CreateICPDialog";

const ICPManager = () => {
    const [profiles, setProfiles] = useState<ICPProfile[]>([]);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

    const handleCreateProfile = (profile: ICPProfile) => {
        setProfiles([...profiles, profile]);
        setIsCreateDialogOpen(false);
    };

    const handleDeleteProfile = (id: string) => {
        setProfiles(profiles.filter(p => p.id !== id));
    };

    return (
        <div className="min-h-screen bg-background p-6 space-y-6">
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
                <Button
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="gap-2 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all"
                >
                    <Plus className="w-4 h-4" />
                    Create New Profile
                </Button>
            </div>

            {/* Profile Cards Grid */}
            {profiles.length === 0 ? (
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {profiles.map((profile) => (
                        <ICPProfileCard
                            key={profile.id}
                            profile={profile}
                            onDelete={handleDeleteProfile}
                        />
                    ))}
                </div>
            )}

            {/* Create Dialog */}
            <CreateICPDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
                onSuccess={handleCreateProfile}
            />
        </div>
    );
};

export default ICPManager;
