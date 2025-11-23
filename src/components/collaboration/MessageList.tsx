import { CollaborationMessage } from "@/types/Collaboration";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface MessageListProps {
  messages: CollaborationMessage[];
}

const MessageList = ({ messages }: MessageListProps) => {
  const { user } = useAuth();

  if (messages.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No messages yet. Start the conversation!
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {messages.map((message) => {
        const isOwn = message.user_id === user?.id;
        const userName = 'Team Member'; // TODO: Fetch from profiles
        const initials = 'TM';

        return (
          <div
            key={message.id}
            className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <Avatar className="h-8 w-8 flex-shrink-0">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>

            <div className={`flex-1 ${isOwn ? 'text-right' : 'text-left'}`}>
              <div className="flex items-baseline gap-2 mb-1">
                {!isOwn && (
                  <span className="text-sm font-medium text-foreground">
                    {userName}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(message.created_at), { addSuffix: true })}
                </span>
              </div>

              <div
                className={`inline-block px-3 py-2 rounded-lg ${
                  isOwn
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MessageList;
