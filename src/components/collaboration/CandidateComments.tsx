import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CandidateComment } from "@/types/Collaboration";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CandidateCommentsProps {
  attachmentId: string;
}

const CandidateComments = ({ attachmentId }: CandidateCommentsProps) => {
  const [comments, setComments] = useState<CandidateComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchComments();
    subscribeToComments();
  }, [attachmentId]);

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from("collaboration_candidate_comments")
      .select("*")
      .eq("attachment_id", attachmentId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      // Fetch profiles separately
      const userIds = data.map(c => c.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      setComments(data.map(comment => ({
        ...comment,
        profile: comment.user_id ? profileMap.get(comment.user_id) : undefined
      })));
    }
  };

  const subscribeToComments = () => {
    const channel = supabase
      .channel(`comments-${attachmentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "collaboration_candidate_comments",
          filter: `attachment_id=eq.${attachmentId}`,
        },
        () => {
          fetchComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !user) return;

    setLoading(true);
    const { error } = await supabase
      .from("collaboration_candidate_comments")
      .insert({
        attachment_id: attachmentId,
        user_id: user.id,
        comment: newComment.trim(),
      });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    } else {
      setNewComment("");
      toast({
        title: "Comment added",
        description: "Your comment has been posted",
      });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <MessageSquare className="h-4 w-4" />
        <span>Comments ({comments.length})</span>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div key={comment.id} className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">
                  {comment.profile?.full_name || "Team Member"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{comment.comment}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          className="min-h-[80px]"
        />
        <Button
          onClick={handleAddComment}
          disabled={!newComment.trim() || loading}
          size="icon"
          className="h-[80px] w-12 flex-shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default CandidateComments;
