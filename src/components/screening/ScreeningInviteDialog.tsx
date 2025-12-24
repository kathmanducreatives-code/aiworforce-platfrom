import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain, Mail, Loader2, Copy, Check } from "lucide-react";

interface ScreeningInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateName: string;
  candidateEmail?: string;
}

const ScreeningInviteDialog = ({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  candidateEmail,
}: ScreeningInviteDialogProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [scenarioCount, setScenarioCount] = useState("3");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [sendEmail, setSendEmail] = useState(!!candidateEmail);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    try {
      setIsLoading(true);

      const { data, error } = await supabase.functions.invoke('generate-screening-invite', {
        body: {
          candidate_id: candidateId,
          scenario_count: parseInt(scenarioCount),
          expires_in_days: parseInt(expiresInDays),
          send_email: sendEmail && !!candidateEmail,
        },
      });

      if (error) throw error;

      setGeneratedUrl(data.screening_url);

      if (data.existing) {
        toast.info('An active screening session already exists for this candidate');
      } else {
        toast.success(
          sendEmail && candidateEmail
            ? 'Screening invite sent successfully!'
            : 'Screening link generated!'
        );
      }

    } catch (err: any) {
      console.error('Failed to generate invite:', err);
      toast.error('Failed to generate screening invite');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!generatedUrl) return;
    
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy link');
    }
  };

  const handleClose = () => {
    setGeneratedUrl(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Invite to Behavioral Screening
          </DialogTitle>
          <DialogDescription>
            Send an Adaptive Stress-Based Screening™ invite to {candidateName}
          </DialogDescription>
        </DialogHeader>

        {generatedUrl ? (
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <Label className="text-sm text-muted-foreground mb-2 block">Screening Link</Label>
              <div className="flex gap-2">
                <code className="flex-1 bg-background p-2 rounded text-xs break-all">
                  {generatedUrl}
                </code>
                <Button size="icon" variant="outline" onClick={copyToClipboard}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {sendEmail && candidateEmail
                ? `An email has been sent to ${candidateEmail} with this link.`
                : 'Share this link with the candidate to begin their screening.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Number of Scenarios</Label>
              <Select value={scenarioCount} onValueChange={setScenarioCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 scenarios (~8 min)</SelectItem>
                  <SelectItem value="3">3 scenarios (~12 min)</SelectItem>
                  <SelectItem value="4">4 scenarios (~15 min)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Link Expiration</Label>
              <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {candidateEmail && (
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Send Email Invite</p>
                    <p className="text-xs text-muted-foreground">{candidateEmail}</p>
                  </div>
                </div>
                <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
              </div>
            )}

            {!candidateEmail && (
              <p className="text-sm text-muted-foreground">
                No email on file. You'll receive a link to share manually.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {generatedUrl ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Generate Invite
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ScreeningInviteDialog;
