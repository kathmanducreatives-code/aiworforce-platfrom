import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const roomSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Room name is required")
    .max(100, "Room name must be less than 100 characters"),
  description: z.string()
    .trim()
    .max(500, "Description must be less than 500 characters")
    .optional()
    .transform(val => val || undefined),
});

interface CreateRoomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const CreateRoomDialog = ({ open, onOpenChange, onCreated }: CreateRoomDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  const handleCreate = async () => {
    if (!user) return;

    // Validate input
    const result = roomSchema.safeParse({ name, description });
    if (!result.success) {
      const fieldErrors: { name?: string; description?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === 'name') fieldErrors.name = err.message;
        if (err.path[0] === 'description') fieldErrors.description = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      // Create room
      const { data: room, error: roomError } = await supabase
        .from('collaboration_rooms')
        .insert({
          name: result.data.name,
          description: result.data.description || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (roomError) throw roomError;

      // Add creator as member
      const { error: memberError } = await supabase
        .from('collaboration_room_members')
        .insert({
          room_id: room.id,
          user_id: user.id,
        });

      if (memberError) throw memberError;

      toast({
        title: "Room created",
        description: "Your collaboration room is ready",
      });

      setName("");
      setDescription("");
      onCreated();
    } catch (error) {
      console.error('Error creating room:', error);
      toast({
        title: "Error",
        description: "Failed to create room",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Collaboration Room</DialogTitle>
          <DialogDescription>
            Create a new room to collaborate with your team on candidates
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Room Name</Label>
            <Input
              id="name"
              placeholder="e.g., Senior Developer Search"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
              }}
              className={errors.name ? "border-destructive" : ""}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Brief description of what this room is for"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors.description) setErrors(prev => ({ ...prev, description: undefined }));
              }}
              className={errors.description ? "border-destructive" : ""}
              rows={3}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? "Creating..." : "Create Room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateRoomDialog;
