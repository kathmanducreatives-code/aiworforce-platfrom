import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, User, Mail, Video, Phone, MapPin, FileText, X, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Interview, STATUS_LABELS } from '@/types/Interview';

interface InterviewNotesDialogProps {
  interview: Interview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateNotes: (id: string, notes: string) => Promise<void>;
  onCancel: (id: string) => void;
  onComplete: (id: string) => void;
}

const InterviewNotesDialog = ({
  interview,
  open,
  onOpenChange,
  onUpdateNotes,
  onCancel,
  onComplete,
}: InterviewNotesDialogProps) => {
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (interview) {
      setNotes(interview.notes || '');
      setHasChanges(false);
    }
  }, [interview]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    setHasChanges(value !== (interview?.notes || ''));
  };

  const handleSave = async () => {
    if (!interview || !hasChanges) return;
    
    setIsSaving(true);
    try {
      await onUpdateNotes(interview.id, notes);
      setHasChanges(false);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-primary/10 text-primary border-primary/20';
      case 'completed':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'cancelled':
        return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'no_show':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getLocationIcon = () => {
    if (interview?.meeting_link) return <Video className="h-4 w-4" />;
    if (interview?.location) return <MapPin className="h-4 w-4" />;
    return <Phone className="h-4 w-4" />;
  };

  if (!interview) return null;

  const scheduledDate = new Date(interview.scheduled_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Interview Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Interview Info */}
          <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{interview.candidate_name}</span>
              </div>
              <Badge className={getStatusColor(interview.status)}>
                {STATUS_LABELS[interview.status]}
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{interview.candidate_email}</span>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>{format(scheduledDate, 'EEEE, MMMM d, yyyy')}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{format(scheduledDate, 'h:mm a')} ({interview.duration_minutes} min)</span>
              </div>
            </div>

            {(interview.meeting_link || interview.location) && (
              <div className="flex items-center gap-2 text-sm">
                {getLocationIcon()}
                {interview.meeting_link ? (
                  <a
                    href={interview.meeting_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline truncate"
                  >
                    {interview.meeting_link}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{interview.location}</span>
                )}
              </div>
            )}
          </div>

          {/* Notes Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Internal Notes
            </label>
            <Textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Add internal notes about this interview..."
              rows={5}
              className="resize-none"
            />
            {hasChanges && (
              <p className="text-xs text-muted-foreground">
                You have unsaved changes
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {interview.status === 'scheduled' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onComplete(interview.id);
                    onOpenChange(false);
                  }}
                  className="flex-1 sm:flex-none"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Complete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onCancel(interview.id);
                    onOpenChange(false);
                  }}
                  className="flex-1 sm:flex-none text-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="flex-1 sm:flex-none"
            >
              {isSaving ? 'Saving...' : 'Save Notes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InterviewNotesDialog;
