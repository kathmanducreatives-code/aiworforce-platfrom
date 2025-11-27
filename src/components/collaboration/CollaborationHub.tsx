import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CollaborationRoom } from "@/types/Collaboration";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import RoomList from "./RoomList";
import RoomView from "./RoomView";
import CreateRoomDialog from "./CreateRoomDialog";

interface CollaborationHubProps {
  onClose: () => void;
}

const CollaborationHub = ({ onClose }: CollaborationHubProps) => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [rooms, setRooms] = useState<CollaborationRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CollaborationRoom | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRooms();
  }, [user]);

  const fetchRooms = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('collaboration_rooms')
        .select(`
          *,
          collaboration_room_members!inner(user_id)
        `)
        .eq('collaboration_room_members.user_id', user.id)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRooms(data || []);
    } catch (error) {
      console.error('Error fetching rooms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRoom = () => {
    fetchRooms();
    setShowCreateDialog(false);
  };

  return (
    <div className={`fixed ${isMobile ? 'left-0 right-0 w-full' : 'left-64 w-96'} top-0 h-screen bg-card/95 backdrop-blur-md border-l border-border/50 shadow-lg z-30 flex flex-col`}>
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-foreground">Collaboration</h2>
        </div>
        {!activeRoom && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCreateDialog(true)}
            className="h-8 w-8"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeRoom ? (
          <RoomView
            room={activeRoom}
            onBack={() => setActiveRoom(null)}
          />
        ) : (
          <RoomList
            rooms={rooms}
            onSelectRoom={setActiveRoom}
            loading={loading}
          />
        )}
      </ScrollArea>

      <CreateRoomDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreateRoom}
      />
    </div>
  );
};

export default CollaborationHub;
