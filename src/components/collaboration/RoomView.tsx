import { useState, useEffect } from "react";
import { CollaborationRoom, CollaborationMessage, CandidateAttachment } from "@/types/Collaboration";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Paperclip } from "lucide-react";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import AttachCandidateDialog from "./AttachCandidateDialog";
import CandidateAttachmentCard from "./CandidateAttachmentCard";

interface RoomViewProps {
  room: CollaborationRoom;
  onBack: () => void;
}

const RoomView = ({ room, onBack }: RoomViewProps) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<CollaborationMessage[]>([]);
  const [attachments, setAttachments] = useState<CandidateAttachment[]>([]);
  const [showAttachDialog, setShowAttachDialog] = useState(false);

  useEffect(() => {
    fetchMessages();
    fetchAttachments();
    subscribeToMessages();
    subscribeToAttachments();
  }, [room.id]);

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from('collaboration_messages')
      .select('*')
      .eq('room_id', room.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setMessages(data as CollaborationMessage[]);
    }
  };

  const fetchAttachments = async () => {
    const { data, error } = await supabase
      .from('collaboration_candidate_attachments')
      .select(`
        *,
        tags:collaboration_candidate_tags(*),
        comments:collaboration_candidate_comments(*)
      `)
      .eq('room_id', room.id)
      .order('attached_at', { ascending: false });

    if (!error && data) {
      setAttachments(data as CandidateAttachment[]);
    }
  };

  const subscribeToMessages = () => {
    const channel = supabase
      .channel(`room-messages-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collaboration_messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as CollaborationMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const subscribeToAttachments = () => {
    const channel = supabase
      .channel(`room-attachments-${room.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_candidate_attachments',
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          fetchAttachments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSendMessage = async (content: string, mentions: string[]) => {
    if (!user) return;

    const { error } = await supabase
      .from('collaboration_messages')
      .insert({
        room_id: room.id,
        user_id: user.id,
        content,
        mentions,
      });

    if (error) {
      console.error('Error sending message:', error);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Room Header */}
      <div className="p-4 border-b border-border/50 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-8 w-8"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">{room.name}</h3>
          {room.description && (
            <p className="text-xs text-muted-foreground">{room.description}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowAttachDialog(true)}
          className="h-8 w-8"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="p-4 border-b border-border/50">
          <h4 className="text-sm font-medium text-foreground mb-2">Candidates</h4>
          <ScrollArea className="h-32">
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <CandidateAttachmentCard
                  key={attachment.id}
                  attachment={attachment}
                  roomId={room.id}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1">
        <MessageList messages={messages} />
      </ScrollArea>

      {/* Input */}
      <MessageInput onSend={handleSendMessage} />

      <AttachCandidateDialog
        open={showAttachDialog}
        onOpenChange={setShowAttachDialog}
        roomId={room.id}
        onAttached={fetchAttachments}
      />
    </div>
  );
};

export default RoomView;
