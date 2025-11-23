import { useEffect, useState } from "react";
import { ContactHistory, CandidateSource } from "@/types/Collaboration";
import { checkContactHistory } from "@/services/candidateService";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ContactWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProceed: () => void;
  candidateName: string;
  candidateSource: CandidateSource;
  candidateId: string;
}

const ContactWarningDialog = ({
  open,
  onOpenChange,
  onProceed,
  candidateName,
  candidateSource,
  candidateId,
}: ContactWarningDialogProps) => {
  const [history, setHistory] = useState<ContactHistory | null>(null);

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open, candidateSource, candidateId]);

  const loadHistory = async () => {
    const data = await checkContactHistory(candidateSource, candidateId);
    setHistory(data);
  };

  if (!history) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <AlertDialogTitle>Candidate Already Contacted</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-2">
            <p>
              <strong>{candidateName}</strong> was already contacted{' '}
              {formatDistanceToNow(new Date(history.contacted_at), { addSuffix: true })}.
            </p>
            
            {history.contact_method && (
              <p>
                <strong>Method:</strong> {history.contact_method}
              </p>
            )}
            
            {history.notes && (
              <div className="mt-2 p-2 bg-muted rounded-md">
                <p className="text-xs font-medium mb-1">Previous notes:</p>
                <p className="text-xs">{history.notes}</p>
              </div>
            )}

            <p className="mt-4 text-foreground">
              Are you sure you want to contact them again? This might result in duplicate outreach.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onProceed}>
            Contact Anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ContactWarningDialog;
