import { useState, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

interface MessageInputProps {
  onSend: (content: string, mentions: string[]) => void;
}

const MessageInput = ({ onSend }: MessageInputProps) => {
  const [content, setContent] = useState("");

  const handleSend = () => {
    if (!content.trim()) return;

    // Extract mentions (simple implementation)
    const mentions: string[] = [];
    const mentionRegex = /@(\w+)/g;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    onSend(content.trim(), mentions);
    setContent("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-border/50">
      <div className="flex gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Use @name to mention)"
          className="min-h-[60px] resize-none"
        />
        <Button
          onClick={handleSend}
          disabled={!content.trim()}
          size="icon"
          className="h-[60px] w-12"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default MessageInput;
