import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CollaborationRoom } from "@/types/Collaboration";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import RoomList from "./RoomList";
import RoomView from "./RoomView";
import CreateRoomDialog from "./CreateRoomDialog";

interface CollaborationHubProps {
  isOpen: boolean;
  onClose: () => void;
  isSidebarCollapsed?: boolean;
}

const CollaborationHub = ({ isOpen, onClose, isSidebarCollapsed = false }: CollaborationHubProps) => {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<CollaborationRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CollaborationRoom | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchRooms = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
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
      toast({
        title: "Error loading rooms",
        description: "Failed to load collaboration rooms. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const handleCreateRoom = () => {
    fetchRooms();
    setShowCreateDialog(false);
  };

  // Calculate left position based on sidebar state
  const leftPosition = isMobile ? 'left-0' : isSidebarCollapsed ? 'left-16' : 'left-64';
  
  return (
    <div 
      className={`fixed ${isMobile ? 'right-0 w-full' : 'w-96'} ${leftPosition} top-0 h-screen bg-card/95 backdrop-blur-xl border-l border-border/50 shadow-[0_0_30px_rgba(0,0,0,0.5)] z-50 flex flex-col transition-all duration-300 ease-in-out ${
        isOpen 
          ? 'translate-x-0 opacity-100' 
          : '-translate-x-full opacity-0 pointer-events-none'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold bg-gradient-to-r from-primary via-cyan-500 to-primary bg-clip-text text-transparent">
            Collaboration
          </h2>
        </div>
        {!activeRoom && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCreateDialog(true)}
            className="h-8 w-8 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_15px_rgba(62,207,142,0.15)] transition-all"
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
