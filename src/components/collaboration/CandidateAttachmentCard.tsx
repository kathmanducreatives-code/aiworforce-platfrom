import { useState, useEffect } from "react";
import { CandidateAttachment, UnifiedCandidate } from "@/types/Collaboration";
import { fetchUnifiedCandidate, checkContactHistory, recordContact } from "@/services/candidateService";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, MessageSquare, Tag, Phone, Edit2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import ContactWarningDialog from "./ContactWarningDialog";
import CandidateComments from "./CandidateComments";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface CandidateAttachmentCardProps {
  attachment: CandidateAttachment;
  roomId: string;
}

const CandidateAttachmentCard = ({ attachment, roomId }: CandidateAttachmentCardProps) => {
  const { toast } = useToast();
  const [candidate, setCandidate] = useState<UnifiedCandidate | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showComments, setShowComments] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(attachment.custom_notes || "");

  useEffect(() => {
    loadCandidate();
  }, [attachment]);

  const loadCandidate = async () => {
    const data = await fetchUnifiedCandidate(attachment.candidate_source, attachment.candidate_id);
    setCandidate(data);
    setLoading(false);
  };

  const handleMarkContacted = async () => {
    const history = await checkContactHistory(attachment.candidate_source, attachment.candidate_id);
    
    if (history) {
      setShowWarning(true);
    } else {
      proceedWithContact();
    }
  };

  const proceedWithContact = async () => {
    const success = await recordContact(
      attachment.candidate_source,
      attachment.candidate_id,
      'email',
      'Contacted from collaboration hub'
    );

    if (success) {
      toast({
        title: "Contact recorded",
        description: "This candidate has been marked as contacted",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to record contact",
        variant: "destructive",
      });
    }
    setShowWarning(false);
  };

  const handleSaveNotes = async () => {
    const { error } = await supabase
      .from("collaboration_candidate_attachments")
      .update({ custom_notes: notes })
      .eq("id", attachment.id);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to save notes",
        variant: "destructive",
      });
    } else {
      setEditingNotes(false);
      toast({
        title: "Notes saved",
        description: "Your notes have been updated",
      });
    }
  };

  if (loading || !candidate) {
    return <Card className="p-3"><p className="text-sm text-muted-foreground">Loading...</p></Card>;
  }

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case 'resume_screening': return 'bg-blue-500/10 text-blue-500';
      case 'deep_search': return 'bg-purple-500/10 text-purple-500';
      case 'linkedin_scraper': return 'bg-green-500/10 text-green-500';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case 'resume_screening': return 'Resume';
      case 'deep_search': return 'Deep Search';
      case 'linkedin_scraper': return 'LinkedIn';
      default: return source;
    }
  };

  return (
    <>
      <Card className="p-3 hover:bg-muted/50 transition-colors">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm text-foreground truncate">
                {candidate.name}
              </h4>
              <Badge variant="outline" className={`text-xs ${getSourceBadgeColor(candidate.source)}`}>
                {getSourceLabel(candidate.source)}
              </Badge>
            </div>

            {(candidate.title || candidate.company) && (
              <p className="text-xs text-muted-foreground truncate">
                {candidate.title} {candidate.title && candidate.company && '•'} {candidate.company}
              </p>
            )}

            {candidate.fitScore !== undefined && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-muted-foreground">Fit Score:</span>
                <Badge variant={candidate.fitScore >= 80 ? 'default' : 'secondary'} className="text-xs">
                  {candidate.fitScore}%
                </Badge>
              </div>
            )}

            {attachment.tags && attachment.tags.length > 0 && (
              <div className="flex items-center gap-1 mt-2 flex-wrap">
                <Tag className="h-3 w-3 text-muted-foreground" />
                {attachment.tags.map((tag) => (
                  <Badge key={tag.id} variant="outline" className="text-xs">
                    {tag.tag}
                  </Badge>
                ))}
              </div>
            )}

            {attachment.custom_notes && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Notes</span>
                  {!editingNotes && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingNotes(true)}
                      className="h-6 px-2"
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
                {editingNotes ? (
                  <div className="space-y-2">
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="min-h-[60px] text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveNotes} className="h-7 text-xs">
                        <Save className="h-3 w-3 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingNotes(false);
                          setNotes(attachment.custom_notes || "");
                        }}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {attachment.custom_notes}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleMarkContacted}
            >
              <Phone className="h-3 w-3" />
            </Button>
            {candidate.linkedin_url && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => window.open(candidate.linkedin_url, '_blank')}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <Collapsible open={showComments} onOpenChange={setShowComments} className="mt-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs">
              <MessageSquare className="h-3 w-3 mr-2" />
              {showComments ? "Hide Comments" : "Show Comments"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CandidateComments attachmentId={attachment.id} />
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ContactWarningDialog
        open={showWarning}
        onOpenChange={setShowWarning}
        onProceed={proceedWithContact}
        candidateName={candidate.name}
        candidateSource={attachment.candidate_source}
        candidateId={attachment.candidate_id}
      />
    </>
  );
};

export default CandidateAttachmentCard;
