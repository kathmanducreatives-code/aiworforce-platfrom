import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RoomMember } from "@/types/Collaboration";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, UserPlus, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface RoomMembersPanelProps {
  roomId: string;
}

const RoomMembersPanel = ({ roomId }: RoomMembersPanelProps) => {
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMembers();
  }, [roomId]);

  const fetchMembers = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("collaboration_room_members")
      .select("*")
      .eq("room_id", roomId);

    if (!error && data) {
      // Fetch profiles separately
      const userIds = data.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, logo_url")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      setMembers(data.map(member => ({
        ...member,
        profile: member.user_id ? profileMap.get(member.user_id) : undefined
      })));
    }
    setLoading(false);
  };

  const getInitials = (name?: string) => {
    if (!name) return "TM";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="h-4 w-4 mr-2" />
          Members ({members.length})
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Room Members</SheetTitle>
          <SheetDescription>
            People who have access to this collaboration room
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading members...</p>
          ) : (
            members.map((member) => (
              <div key={member.id} className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={member.profile?.logo_url} />
                  <AvatarFallback>
                    {getInitials(member.profile?.full_name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {member.profile?.full_name || "Team Member"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Joined {new Date(member.joined_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RoomMembersPanel;
