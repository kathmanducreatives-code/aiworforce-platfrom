import { CollaborationRoom } from "@/types/Collaboration";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface RoomListProps {
  rooms: CollaborationRoom[];
  onSelectRoom: (room: CollaborationRoom) => void;
  loading: boolean;
}

const RoomList = ({ rooms, onSelectRoom, loading }: RoomListProps) => {
  if (loading) {
    return (
      <div className="p-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className="p-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No collaboration rooms yet</p>
        <p className="text-sm text-muted-foreground mt-1">Create one to get started</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {rooms.map((room) => (
        <Button
          key={room.id}
          variant="ghost"
          className="w-full justify-start h-auto p-3 hover:bg-muted/50"
          onClick={() => onSelectRoom(room)}
        >
          <div className="flex items-start gap-3 w-full">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 text-left overflow-hidden">
              <p className="font-medium text-foreground truncate">{room.name}</p>
              {room.description && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {room.description}
                </p>
              )}
            </div>
          </div>
        </Button>
      ))}
    </div>
  );
};

export default RoomList;
