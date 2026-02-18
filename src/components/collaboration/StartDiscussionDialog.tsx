import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CandidateSource } from "@/types/Collaboration";
import { useNavigate } from "react-router-dom";

interface StartDiscussionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    candidateId: string;
    candidateName: string;
    candidateSource: CandidateSource;
    onSuccess?: () => void;
}

export default function StartDiscussionDialog({
    open,
    onOpenChange,
    candidateId,
    candidateName,
    candidateSource,
    onSuccess
}: StartDiscussionDialogProps) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [roomName, setRoomName] = useState(`${candidateName} - Discussion`);
    const [loading, setLoading] = useState(false);

    const handleCreate = async () => {
        if (!user) return;
        setLoading(true);

        try {
            // 1. Create Room
            const { data: room, error: roomError } = await supabase
                .from('collaboration_rooms')
                .insert({
                    name: roomName,
                    created_by: user.id
                })
                .select()
                .single();

            if (roomError) throw roomError;

            // 2. Attach Candidate
            const { error: attachError } = await supabase
                .from('collaboration_candidate_attachments')
                .insert({
                    room_id: room.id,
                    candidate_id: candidateId,
                    candidate_source: candidateSource,
                    attached_by: user.id
                });

            if (attachError) throw attachError;

            // 3. Add self as member
            await supabase
                .from('collaboration_room_members')
                .insert({
                    room_id: room.id,
                    user_id: user.id
                });

            toast.success("Discussion started");
            onOpenChange(false);
            if (onSuccess) onSuccess();

            // Optional: Navigate to collaboration hub
            // navigate(`/collaboration?room=${room.id}`);

        } catch (error) {
            console.error(error);
            toast.error("Failed to start discussion");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Start Discussion</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Room Name</Label>
                        <Input value={roomName} onChange={e => setRoomName(e.target.value)} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        A new collaboration room will be created for discussing <strong>{candidateName}</strong>.
                    </p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleCreate} disabled={loading}>
                        {loading ? "Creating..." : "Create & Discuss"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
